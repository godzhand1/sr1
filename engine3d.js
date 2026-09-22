// Team Gangsta Brawl — match engine.  Pure data + math (no Three.js
// dependency): player physics, hitscan/rocket combat, bots, team
// assignment, scores, respawns and match flow.  The host (or the
// offline player) is the bot/match authority; everyone is authoritative
// for their own shots (SR1-style trust-the-client netcode).
import { WEAPONS3D, WEAPON_INDEX, freshAmmo, freshReserve, lobbyAmmo, lobbyReserve } from './weapons3d.js';
import { makeBot, botThink } from './bots3d.js';
import { playWeapon, playReload, playReloadAt, playEmpty, playWeaponAt, playSlapAt, playThrowAt, playHitConfirmSfx, playBulletWhizAt, playHitTakenSfx, playFootstepAt, playEatAt, playExplosionAt, setListener as setAudioListener, setOccluder as setAudioOccluder } from '../streetfight/sounds.js';
import { KillTracker, speakAnnouncement, COUNTDOWN_LINES } from './announcer.js';
import {
  damageVehicle, updateVehicleVisuals, nearDriverDoor, nearPassengerDoor, onTopOfCar,
  nearBike, bikeSeatWorld, carSeatWorld, VEHICLE_CONSTS,
} from './vehicles3d.js';
import { MOVE, applySprintTap, sprintSpeedFor } from './movementConfig.js';
import { SURFACE_OF_PROP, SURFACE_CODE, surfaceFromCode, surfaceOfCollider, aabbFaceNormal, normalFromDir } from './render/surfaces.js';

// ── GLITCH TOGGLE ──────────────────────────────────────────────────────────
// When true: crouching with the AK47 while turning the right stick causes
// the gun to fire continuously in the direction of the turn until you stop
// rotating (aim forward again to shoot normally).
// Set to false to restore vanilla firing behaviour.
const AK47_CROUCH_TURN_GLITCH = true;
// ──────────────────────────────────────────────────────────────────────────

// ── AK47 FIRE MODES ────────────────────────────────────────────────────────
// Tapping fires one shot (semi). Holding transitions through burst then auto.
//
// Wire these 3 IDs in your sounds.js playWeapon() switch:
//   'ak47_single' → single sharp crack       (e.g. ak_single.ogg)
//   'ak47_burst'  → short 3-round rattle     (e.g. ak_burst.ogg)
//   'ak47_auto'   → sustained full-auto roar (e.g. ak_auto.ogg / looped)
//
const AK_SINGLE_CD     = 0.18;   // seconds between shots — tap / semi
const AK_BURST_CD      = 0.095;  // seconds between shots — burst
const AK_AUTO_CD       = 0.075;  // seconds between shots — full-auto
const AK_AUTO_THRESHOLD = 0.22;  // hold duration (s) before burst → full-auto
// ──────────────────────────────────────────────────────────────────────────

// ── A-TAP LOB GLITCH ───────────────────────────────────────────────────────
// When true: tapping A (jump) while firing any non-projectile weapon causes
// the bullet to arc upward and land somewhere in front of the player instead
// of travelling on the aim ray.  The landing point is randomised in a cone
// in front of the player (2–14 units ahead) so shots scatter unpredictably.
// The lob still consumes ammo and plays the normal fire sound.
// Set to false to restore normal bullet behaviour.
const A_TAP_LOB_GLITCH = true;
// Tuning:
const LOB_MIN_DIST = 2;    // minimum forward landing distance (units)
const LOB_MAX_DIST = 14;   // maximum forward landing distance (units)
const LOB_SIDE_SPREAD = 3; // max sideways drift left/right of forward axis
// ──────────────────────────────────────────────────────────────────────────

// Movement numbers live in movementConfig.js (`MOVE`) so the Movement Lab
// / admin balance page can retune them live (speeds, accel, stamina,
// rhythm-sprint, jump, gravity). Read MOVE.* at use sites, never cache.
const PLAYER_R = 0.45;
const EYE = 1.55;
const RESPAWN_T = 5.0;
const MATCH_DURATION = 300;          // 5 minutes

export const teamOf = (t) => (t === 'A' ? 'SAINTS' : 'ROLLERZ');

// Deterministic team split — gang members grouped, then balanced.
export function computeTeams(roster) {
  const sorted = [...roster].sort((a, b) => (a.id < b.id ? -1 : 1));
  const groups = new Map();
  for (const p of sorted) {
    const key = p.gangTag ? `g:${p.gangTag}` : `solo:${p.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    b.length - a.length || (a[0].id < b[0].id ? -1 : 1));
  const teams = {};
  let na = 0, nb = 0;
  // "First team" varies per match so solo joiners aren't ALWAYS put on
  // Saints. Derive parity from the first sorted player's ID char sum
  // so the choice is deterministic across every client, but flips
  // roughly 50/50 based on who joined the lobby first.
  const idHashFlip = sorted.length > 0
    ? ([...sorted[0].id].reduce((a, c) => a + c.charCodeAt(0), 0) & 1) === 1
    : false;
  for (const g of ordered) {
    // When counts are equal, prefer team B if the flip bit is on so
    // the leading player lands on Rollerz half the time.
    const toA = na < nb ? true : (na > nb ? false : !idHashFlip);
    for (const p of g) teams[p.id] = toA ? 'A' : 'B';
    if (toA) na += g.length; else nb += g.length;
  }
  return teams;
}

export function collideXZ(colliders, px, pz, r, half, playerY = 0, playerH = 1.6) {
  let x = px, z = pz;
  // Player horizontal collision against AABB walls. Colliders whose
  // TOP (c.h) is below the player's feet (playerY) are walked OVER —
  // the crate is already underneath us. Colliders whose top is below
  // (playerY + STEP_UP) are SHORT enough to step onto without
  // jumping; we let those pass through the horizontal blocker AND
  // rely on `topAt` to lift the player onto the step. This is what
  // makes stairways walkable without a mantle button.
  //
  // Floating platform support: colliders with `yBase > 0` (upper-
  // floor slabs, catwalks, overhangs) are only collide-tested against
  // players whose HEAD is at or above the platform's underside. A
  // player standing on the ground floor walks UNDER a 2nd-floor slab
  // with zero interference; the slab only blocks them once they've
  // climbed up onto the top.
  //
  // Slope collider support (iter158): for slope colliders `c.h` is
  // max(yStart, yEnd) — the CEILING of the slope, which is too high
  // to test against the low end. We resample the slope's effective
  // top at the player's XZ position so ramps and hill patches don't
  // read as walls when approached from the low side.
  const STEP_UP = 0.55;
  for (const c of colliders) {
    // Imported SR chunk collision grid — resolves against the real
    // street / wall geometry (see srCollisionGrid.js).
    if (c.grid) { [x, z] = c.grid.resolveXZ(x, z, r, playerY, playerH); continue; }
    let h = c.h != null ? c.h : Infinity;
    if (c.slope && Number.isFinite(h)) {
      const { yStart, yEnd, axis } = c.slope;
      const yS = Number.isFinite(yStart) ? yStart : c.h;
      const yE = Number.isFinite(yEnd)   ? yEnd   : c.h;
      let u = 0;
      // Diagonal (yawed) slope — rotate sample point into local
      // box frame first, then interpolate along the LOCAL axis.
      // iter163: adds arbitrary-yaw ramp support so 45°-rotated
      // ramps read as smooth inclines instead of falling back to
      // an axis-aligned mush. `slope.yaw` (radians), `slope.cx/cz`
      // (world centre) and `slope.localHalf` (half-span along the
      // tilt axis, LOCAL frame) are set by mapCustom3d when the
      // box yaw is not near-axis-aligned.
      //
      // Rotation convention matches three.js `mesh.rotation.y = yaw`:
      //   world = R_ThreeY(yaw) · local  →  reversing to get local:
      //     local_x = dx*cos(yaw) - dz*sin(yaw)
      //     local_z = dx*sin(yaw) + dz*cos(yaw)
      if (c.slope.yaw != null && c.slope.localHalf != null) {
        const cy = Math.cos(c.slope.yaw), sy = Math.sin(c.slope.yaw);
        const dxp = px - c.slope.cx, dzp = pz - c.slope.cz;
        const lc = (axis === 'z')
          ? (dxp * sy + dzp * cy)     // local Z
          : (dxp * cy - dzp * sy);    // local X
        const half = c.slope.localHalf;
        u = half > 1e-6 ? (lc + half) / (2 * half) : 0;
        u = Math.max(0, Math.min(1, u));
        h = yS + (yE - yS) * u;
      } else if (axis === 'z') {
        const span = c.z1 - c.z0;
        u = span > 1e-6 ? (pz - c.z0) / span : 0;
        u = Math.max(0, Math.min(1, u));
        h = yS + (yE - yS) * u;
      } else if (axis === 'r') {
        const cx = (c.x0 + c.x1) * 0.5, cz = (c.z0 + c.z1) * 0.5;
        const rx = (c.x1 - c.x0) * 0.5, rz = (c.z1 - c.z0) * 0.5;
        const rmax = Math.max(rx, rz) || 1;
        const dxr = (px - cx) / rmax, dzr = (pz - cz) / rmax;
        const rNorm = Math.min(1, Math.hypot(dxr, dzr));
        const t = 1 - rNorm;
        const sm = t * t * (3 - 2 * t);
        h = yE + (yS - yE) * sm;
      } else {
        const span = c.x1 - c.x0;
        u = span > 1e-6 ? (px - c.x0) / span : 0;
        u = Math.max(0, Math.min(1, u));
        h = yS + (yE - yS) * u;
      }
    }
    // Player is fully above this collider — no horizontal collision.
    if (playerY >= h - 0.01) continue;
    // Small step you can walk up onto — treat as walkable (topAt
    // handles the vertical lift on the same frame).
    if (h - playerY <= STEP_UP || c.step) continue;
    // Floating platform — skip if the player's head is BELOW the
    // platform's underside. Walking under an overhang / 2nd-floor
    // slab does not collide.
    const yBase = c.yBase != null ? c.yBase : 0;
    if (yBase > 0 && (playerY + playerH) <= yBase + 0.01) continue;
    const cx = Math.max(c.x0, Math.min(x, c.x1));
    const cz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Inside the box — push along the smallest penetration axis.
        const pen = [x - c.x0 + r, c.x1 - x + r, z - c.z0 + r, c.z1 - z + r];
        const m = Math.min(...pen);
        if (m === pen[0]) x = c.x0 - r;
        else if (m === pen[1]) x = c.x1 + r;
        else if (m === pen[2]) z = c.z0 - r;
        else z = c.z1 + r;
      }
    }
  }
  const lim = half - 1;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return [x, z];
}

// Highest collider top that supports a player at (px, pz, currentY).
// Used as the effective "ground" Y for gravity / jump landing — lets
// the player stand on top of crates, the catwalk, etc. Returns 0 (the
// arena floor) when nothing is underneath. Uses a TIGHT point-in-AABB
// test (no player-radius inflation) so brushing the edge of a tall
// building wall doesn't tag its roof as the player's support.
//
// FLOATING PLATFORM AWARENESS: a collider with `yBase > 0` (2nd-floor
// slab, roof cap, catwalk) only counts as ground if the player is
// AT OR ABOVE its underside. Players walking under a slab keep their
// support at whatever's actually below them — otherwise a falling
// player inside a building would snap to the roof.
//
// SLOPE COLLIDER SUPPORT: colliders with `slope: { yStart, yEnd, axis }`
// interpolate their top surface across the collider's footprint. When
// `axis === 'x'` the top varies linearly along X from yStart (at x0)
// to yEnd (at x1). When `axis === 'z'` it varies along Z. `axis === 'r'`
// (radial) attenuates from yStart at the centre to yEnd at the rim
// (used by the HILL PATCH primitive). `c.h` for a slope collider is
// max(yStart, yEnd) — the ceiling; the actual top at (px,pz) is
// computed here.
export function topAt(colliders, px, pz, currentY = Infinity) {
  let top = 0;
  for (const c of colliders) {
    if (c.grid) {
      const gt = c.grid.topAt(px, pz, currentY);
      if (gt > top) top = gt;
      continue;
    }
    if (c.h == null) continue;
    if (px < c.x0 || px > c.x1) continue;
    if (pz < c.z0 || pz > c.z1) continue;
    const yBase = c.yBase != null ? c.yBase : 0;
    // Skip floating platforms the player is currently BELOW. A small
    // 0.05m tolerance handles the "just stepped onto the slab" frame.
    if (yBase > 0 && currentY < yBase - 0.05) continue;
    // Slope colliders: interpolate the top surface from the point's
    // position within the box footprint.
    let effTop = c.h;
    if (c.slope) {
      const { yStart, yEnd, axis } = c.slope;
      const yS = Number.isFinite(yStart) ? yStart : c.h;
      const yE = Number.isFinite(yEnd)   ? yEnd   : c.h;
      let u = 0;
      // Diagonal (yawed) slope — see collideXZ for the full
      // rationale. Rotate the point into the box's local frame,
      // then interpolate along the LOCAL tilt axis.
      if (c.slope.yaw != null && c.slope.localHalf != null) {
        const cy = Math.cos(c.slope.yaw), sy = Math.sin(c.slope.yaw);
        const dxp = px - c.slope.cx, dzp = pz - c.slope.cz;
        const lc = (axis === 'z')
          ? (dxp * sy + dzp * cy)
          : (dxp * cy - dzp * sy);
        const half = c.slope.localHalf;
        u = half > 1e-6 ? (lc + half) / (2 * half) : 0;
        u = Math.max(0, Math.min(1, u));
        effTop = yS + (yE - yS) * u;
      } else if (axis === 'z') {
        const span = c.z1 - c.z0;
        u = span > 1e-6 ? (pz - c.z0) / span : 0;
      } else if (axis === 'r') {
        // Radial attenuation from centre to rim. Assumes the box is
        // (nearly) square; we clamp the corner overhang to keep the
        // profile symmetric.
        const cx = (c.x0 + c.x1) * 0.5, cz = (c.z0 + c.z1) * 0.5;
        const rx = (c.x1 - c.x0) * 0.5, rz = (c.z1 - c.z0) * 0.5;
        const rmax = Math.max(rx, rz) || 1;
        const dx = (px - cx) / rmax, dz = (pz - cz) / rmax;
        const rNorm = Math.min(1, Math.hypot(dx, dz));
        // Smoothstep for a soft, natural hill silhouette. yStart is
        // the peak (centre), yEnd is the rim.
        const t = 1 - rNorm;
        const s = t * t * (3 - 2 * t);
        effTop = yE + (yS - yE) * s;
        if (effTop > top) top = effTop;
        continue;
      } else { // 'x' (default)
        const span = c.x1 - c.x0;
        u = span > 1e-6 ? (px - c.x0) / span : 0;
      }
      if (c.slope.yaw == null || c.slope.localHalf == null) {
        // Axis-aligned path: clamp + linear interpolate.
        if (axis !== 'r') {
          u = Math.max(0, Math.min(1, u));
          effTop = yS + (yE - yS) * u;
        }
      }
    }
    if (effTop > top) top = effTop;
  }
  return top;
}

// Multi-sample foot support — samples `topAt` at the player's centre
// PLUS four cardinal points on their body radius, returns the MAX.
// Fixes the "trailing foot sinks through the sidewalk" issue when
// walking off a curb: as long as any part of the player's footprint
// is still on the curb, they stay lifted. Once fully clear, the
// downward-stair-smoothing block (see step()) drops them gracefully
// onto the lower surface. Uses cardinal-only (not diagonals) so
// there's no bias favouring diagonal ledges — cheap enough (5 point
// tests) to run every frame.
function sampleSupportY(colliders, px, pz, currentY, radius) {
  const r = radius > 0 ? radius : 0.4;
  const c  = topAt(colliders, px,     pz,     currentY);
  const nx = topAt(colliders, px + r, pz,     currentY);
  const nz = topAt(colliders, px,     pz + r, currentY);
  const mx = topAt(colliders, px - r, pz,     currentY);
  const mz = topAt(colliders, px,     pz - r, currentY);
  return Math.max(c, nx, nz, mx, mz);
}

// Ray vs XZ-AABB walls — returns nearest t or Infinity.
//
// Iter162 no_bullet — colliders flagged `no_bullet` (phantom stair
// movement slopes and similar invisible player-only geometry) are
// skipped so hitscan bullets pass right through them; the visible
// step boxes that live alongside handle real bullet blocking.
export function rayWalls(colliders, o, d, maxT, out) {
  let best = maxT;
  for (const c of colliders) {
    if (c.no_bullet) continue;
    if (c.grid) {
      const gt = c.grid.rayT(o, d, best);
      if (gt < best && gt > 0.01) {
        best = gt;
        if (out) { const n = c.grid.lastNormal; out.c = c; out.nx = n ? n.nx : undefined; out.ny = n ? n.ny : undefined; out.nz = n ? n.nz : undefined; }
      }
      continue;
    }
    let t0 = 0, t1 = best;
    let ok = true, axis = -1;
    // iter163: use collider `yBase` as the Y-slab floor so bullets
    // fired UNDER a 2nd-floor slab pass cleanly without clipping
    // the ceiling collider (which previously read from y=0 → c.h).
    const yLo = c.yBase != null ? c.yBase : 0;
    const axes = [
      [o.x, d.x, c.x0, c.x1],
      [o.y, d.y, yLo, c.h],
      [o.z, d.z, c.z0, c.z1],
    ];
    for (let i = 0; i < 3; i++) {
      const [oo, dd, lo, hi] = axes[i];
      if (Math.abs(dd) < 1e-8) {
        if (oo < lo || oo > hi) { ok = false; break; }
      } else {
        let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; axis = i; }
        t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 < best && t0 > 0.01) {
      best = t0;
      if (out) {
        // entry face normal: the slab we entered last, facing back along the ray
        out.c = c;
        out.nx = axis === 0 ? -Math.sign(d.x) : 0;
        out.ny = axis === 1 ? -Math.sign(d.y) : 0;
        out.nz = axis === 2 ? -Math.sign(d.z) : 0;
      }
    }
  }
  return best;
}

// Ray vs oriented vehicle body — returns t or Infinity. Uses the
// car's yaw to transform the ray into the car's local frame, then
// slab-tests an AABB centred on the car. Half extents come from
// VEHICLE_CONSTS (width × height × length). Used to make bullets
// actually CHIP the car HP instead of phasing through.
export function rayVehicleAABB(o, d, v, maxT) {
  const c = Math.cos(-v.yaw), s = Math.sin(-v.yaw);
  // Translate to car center then rotate inverse-yaw into local frame.
  const lx = (o.x - v.x) * c - (o.z - v.z) * s;
  const lz = (o.x - v.x) * s + (o.z - v.z) * c;
  const dlx = d.x * c - d.z * s;
  const dlz = d.x * s + d.z * c;
  const hx = 1.2, hy = 1.5, hz = 2.6;
  let t0 = 0.01, t1 = maxT;
  const slabs = [
    [lx, dlx, -hx, hx],
    [o.y - hy * 0.5, d.y, -hy * 0.5, hy * 0.5],   // y stays world (car y centred at hy/2)
    [lz, dlz, -hz, hz],
  ];
  for (const [oo, dd, lo, hi] of slabs) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < lo || oo > hi) return Infinity;
    } else {
      let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// Ray vs actor cylinder — returns t or Infinity.
function rayActor(o, d, a, radiusMult = 1) {
  const r = (PLAYER_R + 0.12) * radiusMult;
  const ox = o.x - a.x, oz = o.z - a.z;
  const A = d.x * d.x + d.z * d.z;
  const B = 2 * (ox * d.x + oz * d.z);
  const C = ox * ox + oz * oz - r * r;
  if (A < 1e-8) return Infinity;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return Infinity;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0.05) return Infinity;
  const y = o.y + d.y * t;
  const h = a.crouch ? 1.35 : 1.9;
  if (y < a.y || y > a.y + h) return Infinity;
  return t;
}

export class BrawlEngine {
  constructor({ build, palette, displayName, gangTag, matchSize, coop, arena, lobbyMode = false, gameMode = 'tdm', hillSeed = 0, noBots = false, holdStart = false }) {
    this.arena = arena;
    this.colliders = arena.colliders;
    this.spawns = arena.spawns;
    this.half = arena.half || 60;
    this.coop = coop || null;            // Coop3D or null (offline)
    this.lobbyMode = !!lobbyMode;        // chill warehouse — no bots
    this.noBots = !!noBots;              // ranked mode — human players only
    this.holdStart = !!holdStart;        // ranked pool: the pool broadcast starts the match, not the ready-up
    // Game mode: 'tdm' (team deathmatch — kills score) or 'koth' (king
    // of the hill — controlling a circle on the map scores per second).
    this.gameMode = gameMode === 'koth' ? 'koth' : 'tdm';
    // Dynamic team names — gang matches override these with the actual
    // gang names ("THE WESTSIDE" vs "VICE KINGS" etc.) so the HUD reads
    // GANG vs GANG instead of generic SAINTS vs ROLLERZ.
    this.teamNames = { A: 'SAINTS', B: 'ROLLERZ' };
    this.matchSize = Math.max(0, Math.min(6, matchSize || 3));
    // KOTH wins at 250 points (about 4 minutes of uncontested control).
    // TDM keeps the legacy first-to-N-kills target.
    this.targetKills = this.lobbyMode
      ? 0
      : (this.gameMode === 'koth'
          ? 250
          : Math.min(30, Math.max(1, this.matchSize) * 10));
    this.timeLeft = MATCH_DURATION;
    // Match phases: 'waiting' (everyone loading — nobody moves, no
    // countdown yet) → 'countdown' (announcer 3-2-1-GO, inputs / bot
    // fire gated) → 'play' → 'end'. The shell calls `setLocalReady()`
    // once every asset is resident; in coop the HOST starts the
    // countdown for everybody the moment every connected player is
    // ready (or forces it), solo starts it on the first pointer lock.
    // Lobby-mode maps skip all of it (no combat gate to enforce).
    this.phase = this.lobbyMode ? 'play' : 'waiting';
    this.countdownT = 0;
    this.localReady = this.lobbyMode;
    this.waitingT = 0;                   // seconds spent in 'waiting' (host "START ANYWAY" timer)
    this._pendingGo = false;             // a 'go' arrived while we were still loading
    this._countdownLastSpoken = null;
    this.winner = null;
    this.scores = { A: 0, B: 0 };
    this.killfeed = [];                  // [{t, text, color}]
    this.tracers = [];                   // [{ax..bz, t}]
    this.impacts = [];                   // [{x,y,z,t,big}]
    this.rockets = [];
    this.hitMarkerT = 0;
    this.damageFlashT = 0;
    // Most recent killstreak / multi-kill announcement earned by the
    // LOCAL PLAYER. Consumed by the HUD to render a big centered banner
    // ("DOUBLE KILL!", "RAMPAGE!" etc). tier is used for size + color.
    this.myAnnouncement = null;         // { text, tier, t } | null
    // ── STREET-FIGHT KUNG-FU COMBAT STATE ────────────────────────
    // Impact VFX pool — every successful melee/slap hit pushes one
    // entry here. view3d drains + renders as a brief flash sprite +
    // impact ring at (x, y, z). Auto-prune at frame start; capped to
    // 24 so a mob melee doesn't leak memory.
    this.meleeImpacts = [];              // [{x, y, z, t, kind, big}]
    // Camera shake — decayed toward 0 each frame; view3d applies a
    // random offset scaled by `.camShake` to the camera position for
    // AAA weight on impact. 1.0 = strong shake.
    this.camShake = 0;
    // Global HIT-STOP freeze — set on every successful melee connect.
    // While active, physics dt is scaled by 0.15 so the moment lands
    // with weight (a la Devil May Cry / Sekiro). Duration ~60ms.
    this.hitStopT = 0;
    // Cinematic slow-mo for the final match-ending kill. Set to
    // ~1.8s when `_endMatch` is triggered by a killing blow; the
    // main update scales dt by 0.35 while this ticks down.
    this.slowMoT = 0;
    // End-of-match state — set inside `_endMatch`. `endedByKill`
    // gates the slow-mo effect + the "GAME · SET · MATCH" flourish.
    this.endedByKill = false;
    this.endT = 0;                                       // real seconds since match ended
    this.t = 0;
    // ── KOTH hill state ──
    // arena.hillCandidates is [{id, x, z, radius, label}, ...]. Pick
    // one deterministically from the seed so online players load the
    // same hill on every client. `controller` = 'A' | 'B' | null,
    // `contested` true when both teams have a player inside.
    if (this.gameMode === 'koth' && Array.isArray(arena.hillCandidates) && arena.hillCandidates.length) {
      const cand = arena.hillCandidates;
      const pick = cand[((hillSeed | 0) % cand.length + cand.length) % cand.length];
      this.hill = { ...pick, controller: null, contested: false };
    } else {
      this.hill = null;
    }
    // KOTH score rate (points per second of uncontested control).
    this.HILL_SCORE_RATE = 1;
    // ── World pickups (center-of-map RPG + map-defined extras) ──
    // Single RPG drop at world origin; respawns 60s after being grabbed.
    // Maps may also expose `arena.weaponPickups: [{wpn, x, z, ammo?}]`
    // (e.g. AK spawns in CITY BLOCK and THE PROJECTS).
    this.pickups = [
      { id: 'rpg_center', wpn: 'rpg', x: 0, y: 1.0, z: 0, ammo: 1, available: true, respawnT: 0 },
    ];
    if (Array.isArray(arena.weaponPickups)) {
      for (let i = 0; i < arena.weaponPickups.length; i++) {
        const p = arena.weaponPickups[i];
        this.pickups.push({
          id: `map_${i}_${p.wpn}`,
          wpn: p.wpn,
          x: p.x, y: p.y != null ? p.y : 1.0, z: p.z,
          ammo: p.ammo != null ? p.ammo : 1,
          available: true, respawnT: 0,
        });
      }
    }
    this.PICKUP_RADIUS = 1.6;
    this.PICKUP_RESPAWN = 60;
    // Ephemeral weapon drops live ~25s until grabbed; any actor (player
    // or bot) that crosses them auto-picks them up.
    this.DROP_LIFE = 25;
    this._dropSeq = 0;

    this.me = {
      id: coop ? null : 'me',            // assigned on welcome when online
      name: displayName || 'YOU',
      gangTag: gangTag || null,
      team: 'A',
      bot: false,
      x: 0, y: 0, z: 0, vy: 0,
      yaw: 0, pitch: 0,
      hp: 100, dead: false, deadT: 0, respawnT: 0, spawnShield: 3.0,
      wpnIdx: WEAPON_INDEX.pistol,
      ammo: lobbyMode ? lobbyAmmo() : freshAmmo(),
      reserve: lobbyMode ? lobbyReserve() : freshReserve(),
      reloadT: 0, fireCd: 0, meleeT: 0,
      // Pimp-slap 360° spin — set by _melee when a slap fires. `slapSpinT`
      // ticks down over the animation duration; `slapSpinDir` (+1 = CW /
      // right, -1 = CCW / left) is captured from cmd.mvx at swing start.
      slapSpinT: 0, slapSpinDir: 1,
      kills: 0, deaths: 0,
      moving: 0, firing: false, crouch: false,
      // Jersey-barrier cover-hug state — set per-frame by the crouch/
      // cover scan (see `_scanCoverHug` in the movement tick). `null`
      // means "not hugging any barrier"; a number is the OUTWARD
      // normal angle (radians) pointing from the barrier toward the
      // player (the direction the player faces when peeking). The
      // damage handler uses this to soak incoming shots that came
      // from behind the barrier.
      hugCoverDir: null,
      hugCoverId: null,
      onGround: true,
      spawnT: 0,
      stamina: 100, sprinting: false, sprintTapT: 0, staminaLockT: 0,
      // Rhythm-sprint state — see movementConfig.applySprintTap.
      sprintTapCd: 0, sprintChain: 0, sprintBurstT: 0, sprintPerfectT: 0, lastSprintTap: null,
      eating: false, blocking: false, blockSway: 0,
      kickT: 0, punchLT: 0, gunMeleeT: 0,
      // KUNG-FU COMBO SYSTEM — count consecutive melee hits and vary
      // the animation played per punch/kick so a chain reads like a
      // real Ip-Man flurry (jab → cross → hook → uppercut, front kick
      // → roundhouse → axe kick). `comboCount` = number of hits landed
      // in the current chain; `comboLastT` = engine.t of the most
      // recent connect. Chain expires after COMBO_WINDOW_S with no hit.
      // `attackSeq` cycles independently for punches (P: 0..3) and
      // kicks (K: 0..2) so animation VARIETY doesn't need to be tied
      // to the combo count. `lastPunchVariant` / `lastKickVariant`
      // record which strike LATCH just fired so the character rig
      // can play the matching Liu-Kang-style animation curve.
      comboCount: 0, comboLastT: -999,
      attackSeqP: 0, attackSeqK: 0,
      lastPunchVariant: 0, lastKickVariant: 0,
      // LIU-KANG FLYING KICK — set when the input's `flyKick` edge
      // primes the special. During `flyKickT > 0` the character is
      // MID-AIR mid-kick: horizontal velocity is preserved, gravity
      // is reduced, and any actor caught in the extended-leg's cone
      // eats the huge damage + max-tier knockback.
      flyKickT: 0, flyKickDamageDone: false,
      // Timestamp of the last double-tap-W prime — remembered for a
      // short window so the SUBSEQUENT `kick` press can also trigger
      // the special (double-tap → kick combo).
      flyKickPrimedT: -999,
      aimHoldT: 0, tauntT: 0, taunt: null, eatT: 0,
      lastHitBy: null,
      hasPimpSlap: false,                // pickup flag — owns the brass-knuckles
      build, palette,
      // glitch state — tracks previous yaw so we can detect turning
      _prevYaw: 0,
      _glitchFiring: false,
      // Mantle / climb state — set by the JUMP+climbable detector
      // in updateMovement(); _burgerT counts down a +1m climb-reach
      // boost granted after a fresh cheeseburger eat.
      _mantleT: 0,
      _mantleFromY: 0, _mantleToY: 0,
      _mantleFromX: 0, _mantleToX: 0,
      _mantleFromZ: 0, _mantleToZ: 0,
      _burgerT: 0, _bites: 0,
      // Vault state — full "up over the fence and down the other side"
      // traversal state machine. `_vaultT` counts DOWN from
      // VAULT_DURATION to 0 across the whole animation. Sub-phases are
      // implicit from progress u ∈ [0..1]:
      //   u ∈ [0, 0.35]  → MOUNT   (hands snap to fence top, hips rise)
      //   u ∈ [0.35, 0.7] → PIVOT   (hips arc over the fence top)
      //   u ∈ [0.7, 1.0]  → DISMOUNT (feet land on the far side)
      _vaultT: 0,
      _vaultDur: 0,
      _vaultFromX: 0, _vaultFromY: 0, _vaultFromZ: 0,
      _vaultTopX: 0,  _vaultTopY: 0,  _vaultTopZ: 0,
      _vaultToX: 0,   _vaultToY: 0,   _vaultToZ: 0,
      _vaultYaw: 0,
      // Three-tier speed state — set every frame by movement update
      // and exposed on the snapshot so the HUD can render a WALK /
      // JOG / SPRINT indicator pill.
      walking: false, speedTier: 1,
      // Smoothed effective ground Y — lets stair traversal read as
      // a smooth vertical glide rather than a per-frame teleport.
      _stairY: 0,
      // AK47 fire-mode state
      _akHoldT: 0,       // how long trigger has been held this press
      _akBurstCount: 0,  // shots fired in the current burst window
      // A-tap lob glitch state
      _aTapLob: false,   // true for exactly one frame after A is tapped while firing
      _prevReload: false, // previous frame's cmd.reload for edge detection
      // ── Vehicle state ──
      // inCar = null when on foot. When riding: { id, role:'driver'|'passenger', burgerHeal:boolean }.
      inCar: null,
    };
    this.bots = new Map();               // id -> bot (authority only owns sims)
    this.remoteBots = new Map();         // id -> last bot state (non-authority)
    // ── Smart spawn (Gears-of-War style) ─────────────────────────
    // Recent kill locations (world XZ) so respawns steer AWAY from
    // active combat. Entries expire after `HOTSPOT_TTL_MS`.
    this.hotspots = [];
    this.HOTSPOT_TTL_MS = 10000;
    // Track the last picked spawn per team so `_pickSmartSpawn` can
    // penalise back-to-back reuse (avoids two teammates spawning on
    // the exact same pad in a row).
    this._lastSpawnPt = { A: null, B: null };
    // Vehicles — built lazily by Brawl3DGame after the scene exists.
    // engine.vehicles is the source-of-truth array; setVehicles() wires it in.
    this.vehicles = [];
    // Destructible environment (crates, barrels, glass, streetlights…)
    // is optional — maps that opt in call `setDestructibles`. Hitscan
    // and explosion paths quietly no-op if it's null.
    this.destructibles = null;
    // Announcer — tracks per-killer spree/multi state and returns
    // callout tiers ("Double Kill", "Killing Spree", "Rampage"). Runs
    // on every client; each client speaks the line locally when the
    // relevant kill event drains through.
    this.killTracker = new KillTracker();
    this.goFlashT = 0;
    // Audio occlusion: the 3D engine asks how walled-off a source is from
    // the listener before it builds the voice (low-pass + level drop).
    setAudioOccluder((x, y, z) => this._audioOcclusion(x, y, z));
    this._rebuildTeams();
    this._spawnMe(true);
  }

  // 0 = clear line of hearing, up to 0.9 behind several walls. Marches the
  // listener→source ray through the map colliders (SR grids included);
  // glass counts half, kerbs / crates below ear height are ignored.
  _audioOcclusion(sx, sy, sz) {
    const cols = this.colliders;
    if (!cols || !cols.length) return 0;
    if (this._occCols === undefined || this._occColsSrc !== cols || this._occColsLen !== cols.length) {
      this._occCols = cols.filter((c) => c.grid || c.h == null || c.h >= 1.0);
      this._occColsSrc = cols; this._occColsLen = cols.length;
    }
    const o = { x: this.me.x, y: this.me.y + 1.5, z: this.me.z };
    const tx = sx, ty = Math.max(sy, (this.me.y || 0) + 0.9), tz = sz;
    let dx = tx - o.x, dy = ty - o.y, dz = tz - o.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.5) return 0;
    dx /= dist; dy /= dist; dz /= dist;
    const d = { x: dx, y: dy, z: dz };
    const out = {};
    let occ = 0, travelled = 0, hits = 0;
    while (hits < 3 && travelled < dist - 0.3) {
      const t = rayWalls(this._occCols, o, d, dist - travelled, out);
      if (!(t < dist - travelled - 0.3)) break;
      hits++;
      occ += surfaceOfCollider(out.c) === 'glass' ? 0.25 : 0.5;
      const step = t + 0.3;
      o.x += dx * step; o.y += dy * step; o.z += dz * step; travelled += step;
    }
    return Math.min(0.9, occ);
  }

  // Brawl3DGame builds the car group set after scene creation and then
  // hands the array to the engine. Stored as a plain array for the
  // per-frame `_updateVehicles` loop.
  setVehicles(arr) { this.vehicles = arr || []; }
  setDestructibles(system) { this.destructibles = system || null; }

  get isAuthority() {
    return !this.coop || (this.coop.id && this.coop.hostId === this.coop.id);
  }

  // ── Ready-up / synchronized start ────────────────────────────────
  // Every connected player (self + coop remotes) with their assets
  // resident. Remotes flag readiness via the `rdy` evt (mirrored onto
  // coop.remotes[].ready by coop3d).
  readyRoster() {
    const rows = [{ id: this.me.id || 'me', name: this.me.name, ready: !!this.localReady, me: true }];
    if (this.coop) for (const rp of this.coop.remotes.values()) rows.push({ id: rp.id, name: rp.display, ready: !!rp.ready, me: false });
    return rows;
  }
  allReady() { return this.readyRoster().every((r) => r.ready); }

  setLocalReady() {
    if (this.localReady) return;
    this.localReady = true;
    if (this.coop) { this.coop.ready = true; this.coop.sendEvt({ k: 'rdy', v: 1 }); }
    // The host already fired the start while we were loading → catch up.
    if (this._pendingGo && this.phase === 'waiting') this.startCountdown(this._pendingGoSecs);
  }

  // Kick the 3-2-1-GO. Coop gets a longer fuse so everyone has time to
  // click into pointer lock after the shared start lands.
  startCountdown(seconds) {
    if (this.phase !== 'waiting') return;
    this.phase = 'countdown';
    this.countdownT = Math.max(0.5, seconds ?? (this.coop ? 5 : 3));
    this.timeLeft = MATCH_DURATION;
    // Call the number the HUD is showing right now (solo starts at "3").
    const first = Math.ceil(this.countdownT);
    this._countdownLastSpoken = first;
    if (COUNTDOWN_LINES[first]) speakAnnouncement(COUNTDOWN_LINES[first]);
  }

  // Host only: broadcast the shared start and run it locally.
  hostForceStart() {
    if (!this.isAuthority || this.phase !== 'waiting') return;
    if (this.coop) this.coop.sendEvt({ k: 'go', s: 5 });
    this.startCountdown(this.coop ? 5 : 3);
  }

  weapon() { return WEAPONS3D[this.me.wpnIdx]; }

  _feed(text, color = '#ffffff') {
    this.killfeed.push({ t: this.t, text, color });
    if (this.killfeed.length > 6) this.killfeed.shift();
  }

  // Structured kill event — renderer styles per-team colors and shows
  // the weapon used. Falls through to the same array as plain events.
  _killFeedKill({ killerName, killerTeam, victimName, victimTeam, weaponId, teamkill, killerId, victimId }) {
    this.killfeed.push({
      t: this.t,
      kill: true,
      killerName: killerName || '??',
      killerTeam: killerTeam || 'A',
      victimName: victimName || '??',
      victimTeam: victimTeam || 'B',
      weaponId: weaponId || 'pistol',
      teamkill: !!teamkill,
    });
    if (this.killfeed.length > 6) this.killfeed.shift();
    // Announcer — self-kills and team-kills don't count toward
    // spree/multi progression, and neither do phase != 'play' kills
    // (final-blow that clocks in as the horn goes off).
    if (this.phase !== 'play') return;
    if (victimId) this.killTracker.onDeath(victimId);   // any death ends the victim's streak
    if (teamkill) return;
    if (killerId && victimId && killerId === victimId) return;
    if (!killerId) return;
    const anns = this.killTracker.onKill(killerId, this.t);
    // Local-player announcements are ALSO surfaced to the HUD as a
    // giant centered banner (Halo / Unreal style). We keep only the
    // TOP tier so a triple-kill doesn't fight a double-kill on
    // screen at the same time.
    const myId = this.me?.id || 'me';
    if (killerId === myId && anns.length) {
      const top = anns[anns.length - 1];   // highest-tier announcement wins the banner
      this.myAnnouncement = {
        text: (top.text || String(top)).toString().toUpperCase(),
        tier: top.tier || anns.length,
        t: this.t,
      };
    }
    // Speak announcements locally — one line per tier hit this kill.
    // A slight stagger (200ms between the multi-kill and spree lines)
    // keeps overlapping tiers from talking over each other.
    let delay = 0;
    for (const a of anns) {
      if (delay === 0) speakAnnouncement(a);
      else setTimeout(() => speakAnnouncement(a), delay);
      delay += 900;
    }
  }

  // Spatial weapon SFX — pass source world-position. The audio module's
  // listener is updated every frame, so volume + pan are computed
  // relative to the local player. Falls back to centered playback if
  // src position isn't known.
  _playWeaponAt(weaponId, srcX, srcY, srcZ) {
    const cfg = WEAPONS3D[WEAPON_INDEX[weaponId]];
    // Explicit opt-out — weapons with `sfx: null` are silent (pipe
    // bombs while we still need the right blast/toss sample). EXCEPT
    // pipebomb — synthesize a fast "toss whoosh" so the throw doesn't
    // feel silent/laggy (user report iter191).
    if (weaponId === 'pipebomb' || (cfg && cfg.id === 'pipebomb')) {
      playThrowAt(srcX ?? 0, srcY ?? 1.35, srcZ ?? 0);
      return;
    }
    if (cfg && cfg.sfx === null) return;
    // Pimp-slap has no SR1 stream match — synthesize a wet slap SFX
    // via Web Audio (band-passed noise crack + low-freq body thud).
    if (weaponId === 'pimpslap' || (cfg && cfg.id === 'pimpslap')) {
      playSlapAt(srcX, srcY ?? 1.35, srcZ);
      return;
    }
    const sfx = (cfg && cfg.sfx) || weaponId || 'pistol';
    if (srcX == null) { playWeapon(sfx); return; }
    playWeaponAt(sfx, srcX, srcY ?? 1.35, srcZ);
  }

  // Own reload: upfront for me, relayed so teammates/enemies hear the
  // mag change spatially (~14 m) at my position.
  _playReload(w) {
    const id = w.sfx || w.id;
    playReload(id);
    if (this.coop) this.coop.sendEvt({ k: 'rld', w: id });
  }

  // ── World pickups (RPG drop + on-death weapon drops) ────────────
  // Per-frame tick: check if local player OR any bot is within radius
  // of any available pickup → grab it. Ephemeral drops are removed
  // after grab; world spawns respawn after PICKUP_RESPAWN.
  _updatePickups(dt) {
    // Filter expired drops.
    this.pickups = this.pickups.filter(p => {
      if (!p.ephemeral) return true;
      if (!p.available) return false;
      p.expireT = (p.expireT || 0) - dt;
      return p.expireT > 0;
    });
    const me = this.me;
    for (const p of this.pickups) {
      if (!p.available) {
        if (!p.ephemeral) {
          p.respawnT = (p.respawnT || 0) - dt;
          if (p.respawnT <= 0) { p.available = true; p.respawnT = 0; }
        }
        continue;
      }
      const idx = WEAPON_INDEX[p.wpn];
      if (idx == null) continue;
      const w = WEAPONS3D[idx];
      // Local player grab.
      if (!me.dead) {
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d <= this.PICKUP_RADIUS) {
          // Special: pimpslap is a melee pickup — no mag/reserve, just
          // flip the carry flag and auto-equip. The fist slot is
          // redirected to pimpslap while owned (see slotRequest path).
          if (p.wpn === 'pimpslap') {
            me.hasPimpSlap = true;
            me.wpnIdx = idx;
            me.fireCd = 0;
            this._grabPickup(p);
            this._feed('PIMP SLAP — RIGHT TRIGGER FOR 360° INSTAKILL', '#c084fc');
            continue;
          }
          // Pickup goes into the RESERVE by default (SR1 model: you
          // manually reload to feed the mag). EXCEPT — if you don't
          // currently own this weapon (no mag, no reserve), the first
          // pickup arrives pre-loaded: the pickup ammo goes straight
          // into the magazine so you can fire immediately.
          const grant = (p.ammo | 0) || w.mag || 1;
          const curMag = me.ammo[idx] | 0;
          const curRes = me.reserve[idx] | 0;
          const max = w.reserveMax || (w.mag * 3) || 30;
          const isFirstPickup = curMag === 0 && curRes === 0 && w.mag != null;
          if (isFirstPickup) {
            // Pre-loaded: pop a full mag straight into the chamber and
            // stash any leftover pickup rounds into the reserve.
            const magSize = w.mag || grant;
            me.ammo[idx] = Math.min(magSize, grant);
            const leftover = Math.max(0, grant - magSize);
            me.reserve[idx] = Math.min(max, leftover);
          } else {
            me.reserve[idx] = Math.min(max, curRes + grant);
          }
          // Pipe bombs are a "grenade slot" — the mag IS the pickup
          // supply, not a reload-fed magazine. Push the grant straight
          // into the ammo count instead of the reserve.
          if (p.wpn === 'pipebomb') {
            const curAmmo = me.ammo[idx] | 0;
            me.ammo[idx] = Math.min(w.mag || 2, curAmmo + grant);
            me.reserve[idx] = 0;
          }
          // Auto-equip ONLY if the player is currently bare-fisted
          // (wpnIdx === 0). Never stomp an active pimpslap / pistol /
          // picked-up weapon just because they walked over ammo — user
          // reported "playing as the pimp, every kill switches my gun".
          if (me.wpnIdx === 0) {
            me.wpnIdx = idx;
          }
          me.fireCd = Math.min(me.fireCd, 0.1);
          this._grabPickup(p);
          // Tailor the pickup toast — "PRE-LOADED" for first pickups
          // so the player knows the gun is immediately usable.
          const suffix = p.wpn === 'pipebomb'
            ? ''
            : (isFirstPickup ? ' — READY TO FIRE' : ' — RELOAD TO USE');
          this._feed(`PICKED UP ${w.name}${suffix}`, '#fde047');
          continue;
        }
      }
      // Authority bots — bots auto-grab any pickup they walk over.
      if (this.isAuthority) {
        for (const b of this.bots.values()) {
          if (b.dead) continue;
          const d = Math.hypot(p.x - b.x, p.z - b.z);
          if (d <= this.PICKUP_RADIUS) {
            if (p.wpn === 'pimpslap') {
              b.hasPimpSlap = true;
              b.wpn = 'pimpslap';
            } else {
              b.wpn = p.wpn;
            }
            this._grabPickup(p);
            break;
          }
        }
      }
    }
  }

  _grabPickup(p) {
    p.available = false;
    if (p.ephemeral) {
      p.expireT = 0;            // sweep next frame
    } else {
      p.respawnT = this.PICKUP_RESPAWN;
    }
    if (this.coop) this.coop.sendEvt({ k: 'pup', id: p.id, eph: !!p.ephemeral });
  }

  // Override pickup spawns for a non-deathmatch map ("The Lobby"). The
  // base RPG world pickup is replaced with a scattered set of pre-
  // placed weapon pickups across the warehouse so players can arm up.
  // Loadout already started restricted to pistol/bat/fists via
  // lobbyAmmo() in the constructor.
  applyLobbyMode(pickupSpawns) {
    this.pickups = (pickupSpawns || []).map((p, i) => ({
      id: p.id || `lobby_pickup_${i}`,
      wpn: p.wpn,
      x: p.x, y: 1.0, z: p.z,
      ammo: p.ammo || 1,
      available: true,
      respawnT: 0,
    }));
    // PICKUP_RESPAWN stays at the default 60s — same delay across all
    // maps so players have to compete for weapon control.
  }

  // Drop a weapon at world (x,z). Called from death paths. RPGs are NOT
  // dropped (they're center-of-map pickup only).
  _dropWeapon(wpnId, ammo, x, z) {
    const w = WEAPONS3D[WEAPON_INDEX[wpnId]];
    if (!w || w.mag == null) return;     // melee → no drop
    if (wpnId === 'rpg') return;         // RPG only from world spawn
    if ((ammo | 0) <= 0) return;         // empty → no drop
    this._dropSeq++;
    const drop = {
      id: `drop_${Math.floor(this.t)}_${this._dropSeq}`,
      wpn: wpnId,
      x, y: 0.6, z,
      ammo: Math.max(1, ammo | 0),
      available: true,
      ephemeral: true,
      expireT: this.DROP_LIFE,
    };
    this.pickups.push(drop);
    if (this.coop) this.coop.sendEvt({ k: 'drop', id: drop.id, w: wpnId, a: drop.ammo, x, z });
  }

  // Drop the PIMP SLAP / brass-knuckles pickup at (x,z). Called from
  // death paths when the victim was carrying it. Renders as a purple
  // pimp hat sitting on the ground (view3d.js handles the visual).
  _dropPimpSlap(x, z) {
    this._dropSeq++;
    const drop = {
      id: `pimpdrop_${Math.floor(this.t)}_${this._dropSeq}`,
      wpn: 'pimpslap',
      x, y: 0.6, z,
      ammo: 1,
      available: true,
      ephemeral: true,
      expireT: this.DROP_LIFE,
    };
    this.pickups.push(drop);
    if (this.coop) this.coop.sendEvt({ k: 'drop', id: drop.id, w: 'pimpslap', a: 1, x, z });
  }

  // ── Teams + bots ─────────────────────────────────────────────────
  _roster() {
    const r = [{ id: this.me.id || 'me', gangTag: this.me.gangTag }];
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) {
        r.push({ id: rp.id, gangTag: rp.gangTag });
      }
    }
    return r;
  }

  _rebuildTeams() {
    const teams = computeTeams(this._roster());
    this.me.team = teams[this.me.id || 'me'] || 'A';
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) rp.team = teams[rp.id] || 'B';
    }
    // Authority fills the remaining slots with bots — UNLESS we're in
    // the chill warehouse Lobby OR a ranked (human-only) match where
    // bots are explicitly disabled.
    if (this.isAuthority && !this.lobbyMode && !this.noBots) {
      const counts = { A: 0, B: 0 };
      counts[this.me.team]++;
      if (this.coop) for (const rp of this.coop.remotes.values()) counts[rp.team]++;
      const need = { A: Math.max(0, this.matchSize - counts.A), B: Math.max(0, this.matchSize - counts.B) };
      // Drop extra bots, add missing.
      const wanted = [];
      let bi = 0;
      for (const team of ['A', 'B']) {
        for (let k = 0; k < need[team]; k++) wanted.push({ idx: bi++, team });
      }
      const keep = new Set(wanted.map(w => `bot_${w.idx}`));
      for (const id of [...this.bots.keys()]) if (!keep.has(id)) this.bots.delete(id);
      for (const w of wanted) {
        const id = `bot_${w.idx}`;
        if (!this.bots.has(id)) {
          const b = makeBot(w.idx, w.team);
          this._spawnActor(b);
          this.bots.set(id, b);
        } else {
          this.bots.get(id).team = w.team;
        }
      }
    } else {
      this.bots.clear();
    }
  }

  _spawnActor(a) {
    const pts = this.spawns[a.team] || this.spawns.A;
    const p = this._pickSmartSpawn(a) || pts[Math.floor(Math.random() * pts.length)];
    a.x = p.x + (Math.random() - 0.5) * 3;
    a.z = p.z + (Math.random() - 0.5) * 3;
    // Spawn pads on imported SR maps carry the street height they sit on.
    a.y = Number.isFinite(p.y) ? p.y : 0; a.vy = 0;
    a.yaw = p.yaw;
    a.hp = 100; a.dead = false; a.deadT = 0;
    // 3-second post-spawn invulnerability so fresh spawns can't be
    // farmed by campers waiting on the respawn zone. `spawnShield`
    // is checked by `_dealDamage` — while > 0, damage is dropped.
    a.spawnShield = 3.0;
  }

  // ── Smart spawn selection (Gears of War style) ─────────────────
  // Scores every candidate spawn pad on the actor's team by:
  //   + distance from nearest enemy (further = safer)
  //   − line-of-sight to any enemy (never spawn with enemies looking
  //     straight at the pad)
  //   ± distance from allies (spawning near buddies is good; on top
  //     of them is bad)
  //   − anti-repeat (same pad twice in a row penalised)
  //   − recent-kill "hotspots" (respawning into a firefight is bad)
  //   + KOTH mode: bonus for pads closer to the hill so bots keep
  //     the objective contested
  // Returns the winning `{x, z, yaw}` pad (with a small random jitter
  // score to break exact ties). `null` when there are no candidates —
  // caller falls back to a random pick.
  _pickSmartSpawn(actor) {
    const pts = this.spawns[actor.team] || this.spawns.A;
    if (!pts || pts.length === 0) return null;
    if (pts.length === 1) return pts[0];

    const teamA = actor.team;
    const enemies = [];
    const allies = [];
    const seen = new Set();
    if (actor && actor.id) seen.add(actor.id);

    // Local player
    if (!this.me.dead && this.me.id !== actor.id) {
      (this.me.team === teamA ? allies : enemies).push({ x: this.me.x, z: this.me.z });
      seen.add(this.me.id);
    }
    // Remote players
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) {
        const s = rp.latest;
        if (!s || s.dead || seen.has(rp.id)) continue;
        const t = rp.team || s.team;
        (t === teamA ? allies : enemies).push({ x: s.x, z: s.z });
        seen.add(rp.id);
      }
    }
    // Bots
    const botSrc = this.isAuthority ? this.bots.values() : this.remoteBots.values();
    for (const b of botSrc) {
      if (b.dead || seen.has(b.id)) continue;
      (b.team === teamA ? allies : enemies).push({ x: b.x, z: b.z });
      seen.add(b.id);
    }

    const now = performance.now();
    const activeHotspots = this.hotspots.filter(h => now - h.t < this.HOTSPOT_TTL_MS);

    let bestScore = -Infinity;
    let bestPt = null;
    for (const p of pts) {
      let score = 0;

      // Enemy proximity — far is good, close is deadly.
      let nearestEnemy = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < nearestEnemy) nearestEnemy = d;
      }
      if (nearestEnemy < Infinity) {
        score += Math.min(40, nearestEnemy) * 3;
        // Massive penalty for enemies within 8 m — never spawn on top of them.
        if (nearestEnemy < 8) score -= (8 - nearestEnemy) * 30;
      }

      // Line-of-sight to any enemy — huge red flag.
      for (const e of enemies) {
        if (this._clearLineXZ(p.x, p.z, e.x, e.z)) {
          score -= 80;
          break;
        }
      }

      // Ally proximity — buddy up around ~12 m; too close or too far both drop score.
      let nearestAlly = Infinity;
      for (const a of allies) {
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        if (d < nearestAlly) nearestAlly = d;
      }
      if (nearestAlly < Infinity) {
        score += Math.max(0, 25 - Math.abs(nearestAlly - 12));
      }

      // Anti-repeat.
      if (this._lastSpawnPt[teamA] === p) score -= 20;

      // Hotspot decay penalty — recent deaths sting more than old ones.
      for (const hs of activeHotspots) {
        const d = Math.hypot(p.x - hs.x, p.z - hs.z);
        if (d < 18) {
          const age = Math.max(0, 1 - (now - hs.t) / this.HOTSPOT_TTL_MS);
          score -= (18 - d) * 2.5 * age;
        }
      }

      // KOTH: bonus for pads near the hill (keep the objective hot).
      if (this.gameMode === 'koth' && this.hill) {
        const d = Math.hypot(p.x - this.hill.x, p.z - this.hill.z);
        score += Math.max(0, 25 - d * 0.5);
      }

      // Jitter to break exact ties.
      score += Math.random() * 3;

      if (score > bestScore) {
        bestScore = score;
        bestPt = p;
      }
    }

    if (bestPt) this._lastSpawnPt[teamA] = bestPt;
    return bestPt;
  }

  // Segment-vs-AABB XZ line-of-sight check. Any collider with a top
  // ≥ 1.2 m blocks shoulder-height sight. Used by _pickSmartSpawn.
  _clearLineXZ(ax, az, bx, bz) {
    for (const c of this.colliders) {
      // Phantom stair slopes (`no_bullet`) don't block line-of-sight
      // for spawn scoring — they're invisible movement guides.
      if (c.no_bullet) continue;
      if ((c.h || 0) < 1.2) continue;
      const dx = bx - ax, dz = bz - az;
      let t0 = 0, t1 = 1;
      const clip = (p, q) => {
        if (Math.abs(p) < 1e-8) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else       { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      if (
        clip(-dx, ax - c.x0) && clip(dx, c.x1 - ax) &&
        clip(-dz, az - c.z0) && clip(dz, c.z1 - az)
      ) {
        if (t0 < t1) return false;
      }
    }
    return true;
  }

  // Log a death location as a "hotspot" so subsequent smart spawns
  // steer away. Trimmed by TTL each call so the list stays small.
  _registerHotspot(x, z) {
    const now = performance.now();
    this.hotspots = this.hotspots.filter(h => now - h.t < this.HOTSPOT_TTL_MS);
    this.hotspots.push({ x, z, t: now });
    if (this.hotspots.length > 32) this.hotspots.shift();
  }

  _spawnMe(first = false) {
    // Eject from any car FIRST so respawn doesn't strand us inside
    // a destroyed/parked vehicle.
    if (this.me.inCar) {
      const v = this.vehicles && this.vehicles.find(x => x.id === this.me.inCar.id);
      if (v) {
        if (this.me.inCar.role === 'driver') v.driver = null;
        else v.passenger = null;
        if (!v.driver && !v.passenger) v.team = null;
      }
      this.me.inCar = null;
    }
    this._spawnActor(this.me);
    this.me.ammo = this.lobbyMode ? lobbyAmmo() : freshAmmo();
    this.me.reserve = this.lobbyMode ? lobbyReserve() : freshReserve();
    this.me.reloadT = 0;
    this.me.wpnIdx = WEAPON_INDEX.pistol;
    this.me.spawnT = this.t;
    this.me._prevYaw = this.me.yaw;
    this.me._glitchFiring = false;
    this.me._akHoldT = 0;
    this.me._akBurstCount = 0;
    this.me._aTapLob = false;
    this.me._prevReload = false;
    if (!first) this.me.dead = false;
  }

  // All combat-relevant actors (for bot brains + hit tests).
  _allActors() {
    const list = [this.me];
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) {
        const s = rp.latest;
        if (!s) continue;
        list.push({
          id: rp.id, team: rp.team || 'B', bot: false,
          x: s.x || 0, y: s.y || 0, z: s.z || 0,
          dead: !!s.dead, crouch: !!s.crouch, remote: true, eat: !!s.eat,
        });
      }
    }
    if (this.isAuthority) {
      for (const b of this.bots.values()) list.push(b);
    } else {
      for (const b of this.remoteBots.values()) list.push(b);
    }
    return list;
  }

  // ── Main update ──────────────────────────────────────────────────
  update(dt, cmd, camRay) {
    // KUNG-FU HIT-STOP — while `hitStopT > 0`, physics runs at 15% speed
    // so a landed strike lands with weight (Sekiro-style). We apply it
    // as a dt scale rather than skipping frames so animations glide
    // instead of stutter.
    if (this.hitStopT > 0) {
      this.hitStopT = Math.max(0, this.hitStopT - dt);   // real-time decay
      dt = dt * 0.18;                                    // scale the world
    }
    // ── SLOW-MO FINAL KILL ────────────────────────────────────────
    // When a killing blow ends the match, the world runs at 35% for
    // ~1.8s so the ragdoll of the loser and the reaction of the
    // survivors read cinematically. Real-time decay + scaled dt (same
    // pattern as hit-stop) — ragdolls integrate with the same scaled
    // dt so their fall visibly slows too.
    if (this.slowMoT > 0) {
      this.slowMoT = Math.max(0, this.slowMoT - dt);
      dt = dt * 0.35;
    }
    this.t += dt;
    this.hitMarkerT = Math.max(0, this.hitMarkerT - dt);
    this.damageFlashT = Math.max(0, this.damageFlashT - dt);
    // Camera shake decays exponentially so it FEELs like it snaps back
    // (~200ms half-life) rather than lingers linearly.
    this.camShake = Math.max(0, this.camShake - dt * 3.4);
    // Prune old melee-impact VFX (each lives ~0.45s).
    if (this.meleeImpacts.length) {
      const cutoff = this.t - 0.45;
      this.meleeImpacts = this.meleeImpacts.filter(m => m.t > cutoff);
    }
    // Reset combo counter if the chain window fully lapsed — this is
    // separate from the input-side sequence reset so the HUD stops
    // showing "4-HIT COMBO" once the player stops fighting.
    if (this.me && this.t - this.me.comboLastT > 1.8) {
      this.me.comboCount = 0;
    }
    for (const tr of this.tracers) tr.t -= dt;
    this.tracers = this.tracers.filter(tr => tr.t > 0);
    for (const im of this.impacts) im.t -= dt;
    this.impacts = this.impacts.filter(im => im.t > 0);

    if (this.coop) this._drainCoop();

    if (this.phase === 'waiting') {
      this.waitingT += dt;
      // Host: the moment the whole roster is loaded, start everyone's
      // countdown together. Solo waits for the shell (first pointer lock).
      if (!this.holdStart && this.coop && this.isAuthority && this.localReady && this.allReady()) this.hostForceStart();
    } else if (this.phase === 'countdown') {
      const prevT = this.countdownT;
      this.countdownT = Math.max(0, this.countdownT - dt);
      // Announce the integer boundary as it's crossed. Only the local
      // client speaks; each player's engine countdowns are in lock-step
      // because they use the same lobby-side match-start signal.
      const prevSecond = Math.ceil(prevT);
      const nowSecond = Math.ceil(this.countdownT);
      if (prevSecond !== nowSecond) {
        // Speak the integer that was JUST reached (3 → 2 → 1 → GO).
        const line = COUNTDOWN_LINES[nowSecond];
        if (line && this._countdownLastSpoken !== nowSecond) {
          this._countdownLastSpoken = nowSecond;
          speakAnnouncement(line);
        }
      }
      // When the timer hits zero, unlock play. Spawn shields are
      // handed out per actor at spawn time so no per-actor grace is
      // needed here.
      if (this.countdownT <= 0) {
        this.phase = 'play';
        this.goFlashT = 0.9;             // HUD "GO!" beat, in step with the announcer
      }
      // While counting down, the local player and bots freeze (input
      // gate + `_updateBots` phase check enforce this). Everything
      // else — rendering, camera, network drain — keeps running.
    } else if (this.phase === 'play') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.goFlashT > 0) this.goFlashT = Math.max(0, this.goFlashT - dt);
      // The Lobby never ends — it's a hangout space, not a deathmatch.
      if (this.isAuthority && !this.lobbyMode) {
        if (Math.floor(this.scores.A) >= this.targetKills || Math.floor(this.scores.B) >= this.targetKills || this.timeLeft <= 0) {
          this._endMatch();
        }
      }
    }

    // During countdown OR after match-end, freeze player input
    // completely. Aim can still rotate (camera feels responsive) but
    // movement + shoot + jump are zeroed out until phase flips back
    // to 'play'. Match-end freeze lets the winning ragdoll play out
    // + gives the scoreboard sequence a clean beat.
    if (this.phase === 'waiting' || this.phase === 'countdown' || this.phase === 'end') {
      cmd = {
        ...cmd,
        mvx: 0, mvz: 0,
        fwd: 0, strafe: 0,
        fire: false, altFire: false, reload: false, jump: false, climb: false,
        melee: false, block: false, kick: false, punchL: false,
        crouch: false, sprint: false, walkHeld: false, sprintHeld: false, sprintTap: false,
        interact: false, eat: false, taunt: null, flyKick: false, gunMelee: false,
        wheel: false, slotRequest: -1,
      };
    }
    if (this.phase === 'end') {
      this.endT += dt;                   // count up so HUD can time flourishes
    }
    this._updateMe(dt, cmd, camRay);
    this._updateAimHover(dt, camRay);
    this._updateRockets(dt);
    this._updatePickups(dt);
    this._updateVehicles(dt);
    // Destructibles — tick debris + drain any barrel detonations.
    if (this.destructibles) {
      this.destructibles.update(dt);
      const boom = this.destructibles.drainExplosions();
      for (const b of boom) {
        // Barrels detonate as engine-owned rockets so all the existing
        // AOE damage, sound, and impact FX kick in for free. Chain the
        // AOE back into the destructible system for chain-detonation.
        this._explode({ x: b.x, y: b.y, z: b.z, wpnId: b.wpnId, mine: this.isAuthority || !this.coop });
        this.destructibles.splashDamage(b.x, b.y, b.z, b.blast, b.damage);
      }
    }
    if (this.isAuthority) this._updateBots(dt);
    this._updateFootsteps(dt);
    if (this.gameMode === 'koth' && this.hill) this._updateHill(dt);

    // Surround-sound listener follows the local player. Source positions
    // for remote shots/explosions are world-space → playWeaponAt computes
    // the distance falloff + stereo pan automatically.
    setAudioListener({ x: this.me.x, y: this.me.y + 1.5, z: this.me.z, yaw: this.me.yaw });

    // Voice chat — push the current audio routing context so peer
    // <audio> elements mute/unmute according to the team-and-alive
    // rules. Lobby = open mic; Brawl = team-only / dead-channel.
    if (this.coop && this.coop.voice.isEnabled()) {
      const ended = this.phase === 'end';
      this.coop.voice.setVoiceContext({
        phase: this.lobbyMode ? 'lobby' : (ended ? 'ended' : 'brawl'),
        myTeam: this.me.team,
        myAlive: !this.me.dead,
      });
      // Refresh per-peer team + alive state.
      for (const r of this.coop.remotes.values()) {
        const alive = !(r.latest && r.latest.dead);
        this.coop.voice.setPeerInfo(r.id, { team: r.team, alive });
      }
    }

    // Broadcast my state ~10Hz (includes bot states when authority).
    if (this.coop) {
      const m = this.me;
      const s = {
        x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2),
        yaw: +m.yaw.toFixed(3), pitch: +m.pitch.toFixed(3),
        hp: Math.round(m.hp), dead: m.dead, crouch: m.crouch,
        wpn: this.weapon().id, moving: +m.moving.toFixed(2),
        firing: m.firing, kills: m.kills, deaths: m.deaths, team: m.team,
        eat: m.eating, blk: m.blocking, kick: m.kickT > 0, pl: m.punchLT > 0,
        tnt: m.tauntT > 0 ? m.taunt : 0,
        spr: m.sprinting, gm: m.gunMeleeT > 0,
        ps: !!m.hasPimpSlap,
        // 3-tier speed indicator (0=WALK, 1=JOG, 2=SPRINT) + vault
        // progress (0..1) so remote clients can play the matching
        // stride cadence + vault pose. `kd` = knockdown timer (seconds
        // remaining) so pipe-bomb impact reads as PRONE on all
        // clients, not just the victim's.
        wlk: !!m.walking,
        st:  m.speedTier | 0,
        vlt: m._vaultT > 0 ? +Math.min(1, 1 - m._vaultT / (m._vaultDur || 1)).toFixed(3) : 0,
        kd:  m.knockDownT > 0 ? +m.knockDownT.toFixed(2) : 0,
        rd:  this.localReady ? 1 : 0,
      };
      if (this.isAuthority) {
        s.bots = [...this.bots.values()].map(b => ({
          id: b.id, name: b.name, team: b.team,
          x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2),
          yaw: +b.yaw.toFixed(3), wpn: b.wpn, hp: Math.round(b.hp),
          dead: b.dead, moving: +b.moving.toFixed(2), firing: b.firing,
          kills: b.kills, deaths: b.deaths,
        }));
        s.scores = this.scores;
        s.tl = Math.round(this.timeLeft);
        if (this.gameMode === 'koth' && this.hill) {
          s.hill = { c: this.hill.controller, ct: this.hill.contested };
        }
      }
      this.coop.sendState(s);
    }
  }

// ─────────────────────────────────────────────────────────────
// Aim hover (SR1-style stronger stick + slightly longer lock)
// ─────────────────────────────────────────────────────────────
_updateAimHover(dt, camRay) {
  this.aimStickyT = Math.max(0, (this.aimStickyT || 0) - dt);

  const o = { x: camRay.ox, y: camRay.oy, z: camRay.oz };
  const d = { x: camRay.dx, y: camRay.dy, z: camRay.dz };

  let best = rayWalls(this.colliders, o, d, 90);
  let hit = null;

  for (const a of this._allActors()) {
    if (a.id === (this.me.id || 'me') || a.dead) continue;

    // slightly more forgiving SR1-style target acquisition
    const t = rayActor(o, d, a, 1.2);
    if (t < best) { best = t; hit = a.id; }
  }

  if (hit) {
    this.aimStickyId = hit;
    this.aimStickyT = 5.0; // stronger stick (SR1 feel)
  } else if (this.aimStickyT <= 0) {
    this.aimStickyId = null;
  }
}


// ─────────────────────────────────────────────────────────────
// Player update (SR1-inspired combat pacing + restrictions)
// ─────────────────────────────────────────────────────────────
_updateMe(dt, cmd, camRay) {
  const m = this.me;
  const fists = this.weapon().id === 'fist';

  // init SR1-added state
  m.velX ||= 0;
  m.velZ ||= 0;
  m.swapT ||= 0;
  m.hitStunT ||= 0;
  m.knockDownT ||= 0;
  m._prevYaw ??= m.yaw;
  m._glitchFiring ??= false;
  m._akHoldT ??= 0;
  m._akBurstCount ??= 0;
  m._aTapLob ??= false;
  m._prevReload ??= false;

  if (m.swapT > 0) m.swapT -= dt;

  // ── death / respawn ───────────────────────────────────────
  if (m.dead) {
    m.deadT += dt;
    m.respawnT -= dt;
    m.firing = false;
    m._glitchFiring = false;

    if (m.respawnT <= 0 && this.phase === 'play') {
      this._spawnMe();
      m.deadT = 0;
    }
    return;
  }

  // ── spawn shield decay (3s post-spawn invulnerability) ────
  if (m.spawnShield) m.spawnShield = Math.max(0, m.spawnShield - dt);

  // ── hit stun (SR1 flinch system) ──────────────────────────
  if (m.hitStunT > 0) {
    m.hitStunT -= dt;
  }
  // ── PIPE-BOMB KNOCKDOWN ──────────────────────────────────
  // Direct pipe-bomb impact puts the target on their back for
  // ~1.6s. During knockdown the player can't move, fire, aim, or
  // switch weapons — the mesh reads as prone (see view3d).
  if (m.knockDownT > 0) m.knockDownT = Math.max(0, m.knockDownT - dt);
  const knocked = m.knockDownT > 0;

  // ── Vehicle entry/exit + in-car driving ───────────────────────
  this._handleVehicleInteract(cmd);
  if (m.inCar) {
    this._updateMyVehicle(dt, cmd);
    this._updateInCarCombat(dt, cmd, camRay);
    // Burger heal glitch — must have been held continuously since
    // entering, and player must have entered with HP < 100.
    if (m.inCar.burgerHeal && cmd.dpadDownHeld) {
      if (m.hp < 100) m.hp = Math.min(100, m.hp + 12 * dt);
    } else if (m.inCar.burgerHeal && !cmd.dpadDownHeld) {
      m.inCar.burgerHeal = false;  // breaking the hold ends the glitch
    }
    m.pitch = cmd.pitch;
    return;   // skip on-foot movement, jumping, melee, etc.
  }

  m.pitch = cmd.pitch;
  const camYaw = cmd.yaw;

  // ── eating — bite-synced heal (matches the burger animation:
  // 0.45 s raise, then one bite every 1.25 s). Standing, slowed walk.
  m.eating = !!cmd.eat && this.phase === 'play' && m.hp < 100;
  m.eatT = m.eating ? m.eatT + dt : 0;
  if (!m.eating) m._bites = 0;
  if (m.eating && m.onGround) {
    const bites = m.eatT < 0.45 ? 0 : Math.floor((m.eatT - 0.45) / 1.25) + 1;
    if (bites > (m._bites || 0)) {
      m._bites = bites;
      m.hp = Math.min(100, m.hp + 18);
      playEatAt(m.x, m.y + 1.3, m.z, true);
      // Cheeseburger climbing boost — eating to full grants +1m
      // climb reach for the next 10 s (helps reach the 4-stack top tier
      // and the catwalk without scaffolding).
      if (m.hp >= 99.9 && m._burgerT < 8) m._burgerT = 10;
    }
  }

  // ── taunts (SR1 interrupt rules preserved) ────────────────
  m.tauntT = Math.max(0, m.tauntT - dt);
  if (cmd.taunt && m.tauntT <= 0 && !m.eating && m.onGround && this.phase === 'play') {
    m.taunt = cmd.taunt;
    m.tauntT = cmd.taunt === 'dance' ? 3.4 : 2.2;
  }
  if (cmd.fire || cmd.kick || cmd.punchL) m.tauntT = 0;

  // ── block (heavier SR1 stance lock) ───────────────────────
  m.blocking = fists && (cmd.block || (cmd.lt && cmd.fire)) && !m.eating;
  m.blockSway = m.blocking ? Math.max(-1, Math.min(1, cmd.strafe)) : 0;

  // ── crouch ────────────────────────────────────────────────
  m.crouch = cmd.crouch && m.onGround;

  // ── Jersey-barrier cover hug ─────────────────────────────
  // While crouched AND stationary near a barrier, latch onto its
  // nearest face. `hugCoverDir` becomes the OUTWARD normal (angle,
  // radians) pointing from barrier → player, so the character
  // faces AWAY from the barrier (peeking outward). The damage
  // handler soaks 85% of shots that come in from the OPPOSITE side
  // (behind the barrier). Break the hug on stand, run, or step away.
  if (m.crouch && m.onGround && !m.dead) {
    this._scanCoverHug(m);
  } else {
    m.hugCoverDir = null;
    m.hugCoverId = null;
  }

  // ── sprint — hold (classic) or RHYTHM TAP (competitive) ──────
  // Hold RB/Shift = steady sprint, full drain. TAP = a short sprint
  // window; re-tapping inside the last `tapPerfectWindow` seconds of
  // that window is a PERFECT: a speed burst, a cheaper tap and +1
  // chain (top-speed bonus). Spamming early breaks the chain and pays
  // full price; a cooldown stops macro spam. All numbers live in MOVE.
  m.sprintTapCd = Math.max(0, (m.sprintTapCd || 0) - dt);
  m.sprintBurstT = Math.max(0, (m.sprintBurstT || 0) - dt);
  m.sprintPerfectT = Math.max(0, (m.sprintPerfectT || 0) - dt);
  const canSprintNow = !m.crouch && !m.blocking && !cmd.fire && cmd.fwd > 0.1 && m.hitStunT <= 0;
  if (cmd.sprintTap && canSprintNow && m.staminaLockT <= 0) {
    m.lastSprintTap = applySprintTap(m, MOVE);
  }
  m.sprintTapT = Math.max(0, (m.sprintTapT || 0) - dt);

  const wantSprint = (cmd.sprintHeld || m.sprintTapT > 0) && canSprintNow;

  const wasSprinting = !!m.sprinting;
  // After running dry you must recover to `sprintMinStart` before sprint
  // re-engages — stops the hold-RB-at-zero oscillation that pins stamina at 0.
  if (m.stamina >= MOVE.sprintMinStart) m.sprintWinded = false;
  m.sprinting = wantSprint && m.stamina > 0 && m.staminaLockT <= 0 && !m.sprintWinded;

  if (m.sprinting) {
    const drain = cmd.sprintHeld ? MOVE.staminaDrain : MOVE.staminaTapDrain;
    m.stamina = Math.max(0, m.stamina - drain * dt);
    if (m.stamina <= 0) { m.staminaLockT = MOVE.staminaLock; m.sprintWinded = true; m.sprintTapT = 0; m.sprintChain = 0; m.sprintBurstT = 0; }
  } else {
    m.staminaLockT = Math.max(0, m.staminaLockT - dt);
    if (m.staminaLockT <= 0) {
      m.stamina = Math.min(100, m.stamina + MOVE.staminaRegen * dt);
    }
  }

  // ── Three-tier speed selection (WALK / JOG / SPRINT) ──────
  // Speed tiers are ordered slow → fast. `speedTier` is exposed on
  // the snapshot so the HUD can render a tier pill (WALK / JOG /
  // SPRINT). Sprint takes precedence, then walk-modifier, else jog.
  //  0 = WALK (stealth / quiet — hold Ctrl on kb, partial-tilt on pad)
  //  1 = JOG  (default)
  //  2 = SPRINT (RB / Shift held, forward only)
  //
  // Crouch and blocking force JOG-tier (0 speed multiplier applied
  // downstream anyway; the speedTier stays 1 so the HUD doesn't
  // flicker to WALK when the player just crouches).
  m.walking = !!cmd.walkHeld && !m.sprinting && !m.crouch && !m.blocking;
  m.speedTier = m.sprinting ? 2 : (m.walking ? 0 : 1);

  // ── movement (SR1 heavier inertia + flinch slowdown) ─────
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  const fx = -sin, fz = -cos;
  const rx = cos, rz = -sin;

  let mx = fx * cmd.fwd + rx * cmd.strafe;
  let mz = fz * cmd.fwd + rz * cmd.strafe;

  const len = Math.hypot(mx, mz);
  m.moving = Math.min(1, len);

  if (len > 1) { mx /= len; mz /= len; }

  if (m.moving > 0.25) m.tauntT = 0;
  if (m.tauntT <= 0) m.taunt = null;

  // hit flinch slows movement (SR1 feel). Pipe-bomb knockdown fully
  // stops movement AND drops fire/melee input for the duration.
  let moveMul = (m.hitStunT > 0) ? 0.65 : 1;
  if (knocked) {
    moveMul = 0;
    mx = 0; mz = 0;
    m.moving = 0;
    // Kill hostile inputs — swallow fire, jump, kick etc. while
    // prone so the character can't magically shoot from the ground.
    cmd.fire = false; cmd.jump = false; cmd.climb = false;
    cmd.kick = false; cmd.punchL = false; cmd.gunMelee = false;
    cmd.taunt = null; cmd.flyKick = false; cmd.reload = false;
  }

  // block fully stops movement
  if (m.blocking) {
    mx = 0; mz = 0;
    m.moving = 0;
  }

  const tierSpd = m.crouch
    ? MOVE.crouch
    : m.eating ? MOVE.walk
    : (m.sprinting ? sprintSpeedFor(m, MOVE) : (m.walking ? MOVE.walk : MOVE.jog));
  const targetVX = mx * tierSpd * moveMul;
  const targetVZ = mz * tierSpd * moveMul;

  // Sprint LAUNCH — the first sprint frame snaps the ground velocity up
  // to `sprintStartSpeed` along the input direction so hitting RB feels
  // like a kick, not a slow ramp out of a standstill.
  if (m.sprinting && !wasSprinting && m.moving > 0.1 && MOVE.sprintStartSpeed > 0) {
    const cur = Math.hypot(m.velX, m.velZ);
    const launch = Math.min(tierSpd, MOVE.sprintStartSpeed) * moveMul;
    if (cur < launch) { m.velX = mx * launch; m.velZ = mz * launch; }
  }

  // SR1-style acceleration — snappier response to input but still has
  // a touch of inertia so stopping / turning feels grounded, not
  // like an ice-skate. Exponential form: identical feel at any frame
  // rate (the old `dt * 16` overshoots and oscillates below 16 fps).
  // Sprinting uses its own (higher) acceleration so the top speed is
  // reached within a couple of strides.
  const kVel = 1 - Math.exp(-(m.sprinting ? MOVE.sprintAccel : MOVE.accel) * dt);
  m.velX += (targetVX - m.velX) * kVel;
  m.velZ += (targetVZ - m.velZ) * kVel;
  // LIU-KANG FLYING KICK — while airborne mid-special, the player's
  // horizontal velocity is LOCKED to the launch direction so the
  // dropkick sails a full 5-6 meters instead of stopping cold when
  // the user releases the W key. Slight air-decay (0.92/frame) keeps
  // it from feeling infinitely rocket-propelled.
  if (m.flyKickT > 0) {
    const flyFx = Math.sin(m.yaw), flyFz = Math.cos(m.yaw);
    const flightSpd = 12 + 6 * (m.flyKickT / 0.60);   // fastest early, ease later
    m.velX = flyFx * flightSpd;
    m.velZ = flyFz * flightSpd;
  }

  const nx = m.x + m.velX * dt;
  const nz = m.z + m.velZ * dt;

  // ── VAULT (over-and-down fence traversal) ─────────────────────────
  // Runs before MANTLE so a thin fence gets a full over-the-top
  // trajectory even when it's also flagged climbable. Detection is
  // biased by facing direction (camYaw fwd vector) — the closest
  // barrier/thin collider in front, top height ≤ 2.2m, is vault-
  // eligible. Requires the player be either grounded OR mid-jump
  // (mantle-in-air already lifts onto tops; vault always lands on
  // the FAR SIDE). Motion runs on its own timer so the standard
  // controller can't fight it mid-flight.
  if (cmd.climb && m._vaultT <= 0 && m._mantleT <= 0) {
    const fwdX = -Math.sin(camYaw);
    const fwdZ = -Math.cos(camYaw);
    let bestC = null;
    let bestDist = 1e9;
    for (const c of this.colliders) {
      // Phantom stair slopes and other invisible-to-projectiles
      // colliders are also invisible to the vault detector — they're
      // movement-guidance helpers, not vaultable ledges. The visible
      // step boxes remain vault candidates as normal.
      if (c.no_bullet) continue;
      const top = c.h != null ? c.h : 0;
      if (top <= m.y + 0.05) continue;              // already above it
      if (top > m.y + 2.4) continue;                // too tall to vault
      // Prefer explicit barriers or thin climbable colliders.
      const eligible = c.barrier === true || c.climbable === true || top <= 2.2;
      if (!eligible) continue;
      const cxMid = (c.x0 + c.x1) * 0.5;
      const czMid = (c.z0 + c.z1) * 0.5;
      const cHalfX = (c.x1 - c.x0) * 0.5;
      const cHalfZ = (c.z1 - c.z0) * 0.5;
      // Skip full-height walls — vault needs a THIN obstacle so the
      // player has somewhere to land on the far side. Measure width
      // along the movement (facing) direction: project the collider's
      // half-diagonal onto the facing vector.
      const thickAlong = Math.abs(fwdX) * cHalfX + Math.abs(fwdZ) * cHalfZ;
      if (thickAlong > 1.5) continue;               // wall-like — not vaultable
      // Nearest point on the collider's AABB to the player.
      const nx2 = Math.max(c.x0, Math.min(m.x, c.x1));
      const nz2 = Math.max(c.z0, Math.min(m.z, c.z1));
      const dx0 = nx2 - m.x, dz0 = nz2 - m.z;
      const nearD = Math.hypot(dx0, dz0);
      if (nearD > 1.8) continue;                    // must be within ~1.8m of the fence
      // Player must be roughly FACING it (dot ≥ 0.45 → within ~63°
      // of the fence center from the player's facing direction).
      const dx = cxMid - m.x, dz = czMid - m.z;
      const dLen = Math.hypot(dx, dz) || 1e-4;
      const dot = (dx / dLen) * fwdX + (dz / dLen) * fwdZ;
      if (dot < 0.45) continue;
      if (nearD < bestDist) { bestDist = nearD; bestC = c; }
    }
    if (bestC) {
      // Compute landing position — same distance ahead but on the far
      // side of the collider along the facing axis. We reach 0.6m
      // past the far face to guarantee clearance.
      const topY = bestC.h;
      const cxMid = (bestC.x0 + bestC.x1) * 0.5;
      const czMid = (bestC.z0 + bestC.z1) * 0.5;
      const cHalfX = (bestC.x1 - bestC.x0) * 0.5;
      const cHalfZ = (bestC.z1 - bestC.z0) * 0.5;
      const clearX = cxMid + fwdX * (cHalfX + 0.8);
      const clearZ = czMid + fwdZ * (cHalfZ + 0.8);
      m._vaultDur = 0.75;
      m._vaultT = m._vaultDur;
      m._vaultFromX = m.x; m._vaultFromY = m.y; m._vaultFromZ = m.z;
      m._vaultTopX  = cxMid; m._vaultTopY = topY + 0.35; m._vaultTopZ = czMid;
      m._vaultToX   = clearX; m._vaultToY = 0;           m._vaultToZ = clearZ;
      m._vaultYaw   = Math.atan2(fwdX, fwdZ);          // face the direction of travel
      m.vy = 0; m.velX = 0; m.velZ = 0;
      cmd.climb = false; cmd.jump = false;
      // Rumble a quick "up over" cue.
      if (typeof this._rumble === 'function') this._rumble(0.35, 90);
    }
  }
  if (m._vaultT > 0) {
    m._vaultT -= dt;
    const u = 1 - Math.max(0, m._vaultT) / m._vaultDur;   // 0 → 1
    // Bezier-ish 3-point trajectory: FROM → TOP (apex) → TO.
    // Sub-phases: MOUNT (0..0.35), PIVOT (0.35..0.7), DISMOUNT (0.7..1).
    // Ease each linear segment so the apex is a real dwell, not a
    // discontinuity.
    if (u < 0.5) {
      const s = u / 0.5;
      const e = s * s * (3 - 2 * s);                       // smoothstep
      m.x = m._vaultFromX + (m._vaultTopX - m._vaultFromX) * e;
      m.z = m._vaultFromZ + (m._vaultTopZ - m._vaultFromZ) * e;
      m.y = m._vaultFromY + (m._vaultTopY - m._vaultFromY) * e;
    } else {
      const s = (u - 0.5) / 0.5;
      const e = s * s * (3 - 2 * s);
      m.x = m._vaultTopX + (m._vaultToX - m._vaultTopX) * e;
      m.z = m._vaultTopZ + (m._vaultToZ - m._vaultTopZ) * e;
      m.y = m._vaultTopY + (m._vaultToY - m._vaultTopY) * e;
    }
    // Face the direction of travel throughout the vault (smoothed).
    const dYaw = ((m._vaultYaw - m.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    m.yaw += dYaw * (1 - Math.exp(-12 * dt));
    m.vy = 0;
    m.velX = 0; m.velZ = 0;
    m.aimHoldT = 0;
    if (m._vaultT <= 0) {
      m._vaultT = 0;
      m.x = m._vaultToX; m.z = m._vaultToZ; m.y = m._vaultToY;
      m.onGround = true;
    }
    return;   // skip the rest of the movement tick during vault
  }

  // ── MANTLE / CLIMB ────────────────────────────────────────────────
  // Pressing X (or Space) while close to a climbable collider (top
  // within reach) starts a mantle: the player smoothly rises onto the
  // top over ~0.35s. Reach is current foot Y + 1.6 m standing; jumping
  // adds another ~1m (mid-air mantle); eating a cheeseburger gives
  // a +1m burger-boost for the next ~10s so the third crate tier
  // becomes reachable. Auto-walk-on-top (same level as tip) is the
  // "step-up" case below: if we're already AT the top's Y within
  // 0.05m, walking forward just registers as on-top.
  const burgerBoost = (m._burgerT || 0) > 0;
  const reachMax = 1.6 + (m.vy > 0.5 ? 0.9 : 0) + (burgerBoost ? 1.0 : 0);
  if ((cmd.jump || cmd.climb) && m._mantleT <= 0) {
    // Look for a climbable collider directly in front (within 1 m).
    const fwdX = -Math.sin(camYaw);
    const fwdZ = -Math.cos(camYaw);
    const probeX = m.x + fwdX * 0.7;
    const probeZ = m.z + fwdZ * 0.7;
    let bestTop = -1;
    let bestC = null;
    for (const c of this.colliders) {
      // Phantom stair slopes (`no_bullet`) are movement helpers, not
      // mantleable ledges — the visible step boxes provide real
      // mantle surfaces at each riser.
      if (c.no_bullet) continue;
      if (!c.climbable) continue;
      if (probeX < c.x0 - 0.05 || probeX > c.x1 + 0.05) continue;
      if (probeZ < c.z0 - 0.05 || probeZ > c.z1 + 0.05) continue;
      const top = c.h != null ? c.h : 0;
      if (top <= m.y + 0.05) continue;          // already above
      if (top > m.y + reachMax) continue;       // too high — out of reach
      if (top > bestTop) { bestTop = top; bestC = c; }
    }
    if (bestC) {
      m._mantleT = 0.35;
      m._mantleFromY = m.y;
      m._mantleToY = bestTop + 0.02;
      m._mantleToX = Math.max(bestC.x0 + 0.3, Math.min(bestC.x1 - 0.3, m.x + fwdX * 0.6));
      m._mantleToZ = Math.max(bestC.z0 + 0.3, Math.min(bestC.z1 - 0.3, m.z + fwdZ * 0.6));
      m._mantleFromX = m.x;
      m._mantleFromZ = m.z;
      m.vy = 0;
      m.velX = 0;
      m.velZ = 0;
      cmd.jump = false;       // swallow the jump so player doesn't also jump
      cmd.climb = false;
    }
  }
  if (m._mantleT > 0) {
    m._mantleT -= dt;
    const u = 1 - Math.max(0, m._mantleT) / 0.35;       // 0 → 1
    const e = u * u * (3 - 2 * u);                      // smoothstep
    m.x = m._mantleFromX + (m._mantleToX - m._mantleFromX) * e;
    m.z = m._mantleFromZ + (m._mantleToZ - m._mantleFromZ) * e;
    m.y = m._mantleFromY + (m._mantleToY - m._mantleFromY) * e;
    m.vy = 0;
    if (m._mantleT <= 0) {
      m._mantleT = 0;
      m.x = m._mantleToX; m.z = m._mantleToZ; m.y = m._mantleToY;
      m.onGround = true;
    }
    return;   // skip the rest of the movement tick during mantle
  }
  // Tick down the burger boost timer.
  if (m._burgerT > 0) m._burgerT -= dt;
  [m.x, m.z] = collideXZ(this.colliders, nx, nz, PLAYER_R, this.half, m.y, 1.6);

  // ── facing (SR1 combat lock + slower turning) ────────────
  m.aimHoldT = Math.max(0, m.aimHoldT - dt);

  if (cmd.fire || cmd.kick || cmd.punchL || m.blocking)
    m.aimHoldT = 1.75;

  let face = m.yaw;

  // ── PIMP-SLAP LEFT-STICK BODY STEERING ──────────────────
  // While the slap is active, the LEFT stick (movement input,
  // WASD / left-stick X&Y) directly drives the body yaw. Push
  // the stick toward the target — the character's whole torso
  // whips to face that direction so the slap arc lands where
  // the player is pointing. This intentionally OVERRIDES the
  // normal aim-hold (which locks face to camera when firing),
  // giving the player 1-to-1 tactile control over the slap
  // direction independent of where the camera is looking.
  //
  // If the player has no left-stick input during the slap, we
  // hold the current yaw (no drift) so a standing slap doesn't
  // fight the player.
  if (m.slapSpinT > 0) {
    if (len > 0.05) face = Math.atan2(-mx, -mz);
    else face = m.yaw;  // no stick input → hold current facing
  }
  else if (m.aimHoldT > 0) face = camYaw;
  else if (len > 0.05) face = Math.atan2(-mx, -mz);

  const dyaw = ((face - m.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // Yaw turn rate — 9/s when running free (body swings to the travel
  // direction in ~¼ s like a AAA third-person rig), 8 on aim-hold.
  // While the pimp-slap is active we CRANK it to 24 so a fast stick
  // flick whips the character through a full 360° manually, giving the
  // player total control over how far / how hard they swing.
  const turnRate = m.slapSpinT > 0
    ? 24
    : ((m.aimHoldT > 0) ? 8 : 9);
  const yawStep = dyaw * (1 - Math.exp(-turnRate * dt));
  m.yaw += yawStep;
  // Smoothed yaw rate (rad/s) — the rig leans into turns with it.
  m.yawRate = (m.yawRate || 0) + ((dt > 1e-4 ? yawStep / dt : 0) - (m.yawRate || 0)) * (1 - Math.exp(-10 * dt));

  // ── gravity / jump (SR1-like commitment) ─────────────────
  // LIU-KANG FLYING KICK — reduced gravity during the ~0.6s flight
  // so the character SAILS forward with a shallow arc instead of
  // falling out of the air by frame 6. Also HOLDS the launch
  // horizontal velocity so the player doesn't lose forward momentum.
  if (m.flyKickT > 0) {
    m.vy += MOVE.gravity * 0.35 * dt;                // 35% gravity in air
    m.flyKickT = Math.max(0, m.flyKickT - dt);
    // Damage cone check while the leg is extended — only pays out
    // once per fly-kick so a single launch = one victim.
    if (!m.flyKickDamageDone && m.flyKickT > 0.15) {
      const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
      for (const a of this._allActors()) {
        if (a.id === (m.id || 'me') || a.dead) continue;
        const dx = a.x - m.x, dz = a.z - m.z;
        const d = Math.hypot(dx, dz);
        if (d > 3.4) continue;                                                       // reach
        if ((dx * fx + dz * fz) / Math.max(0.001, d) < 0.4) continue;                // cone
        const nx = d > 0.001 ? dx / d : fx;
        const nz = d > 0.001 ? dz / d : fz;
        this._dealDamage(a, 65, 'fist', {
          dx: nx * 2.8, dy: 0.4, dz: nz * 2.8,                                       // MAX knockback
          srcX: m.x, srcY: m.y, srcZ: m.z,
        });
        a.vy = (a.vy || 0) + 8.5;                                                    // launcher
        // Impact VFX + hit-stop + heavy camera shake — signature K.O. moment.
        this.meleeImpacts.push({ x: a.x, y: (a.y || 0) + 1.45, z: a.z, t: this.t, kind: 'fist', big: true });
        if (this.meleeImpacts.length > 24) this.meleeImpacts.shift();
        this.hitStopT = 0.18;                    // long freeze
        this.camShake = 1.6;                     // strong shake
        m.comboCount = Math.min(9, m.comboCount + 2);
        m.comboLastT = this.t;
        m.flyKickDamageDone = true;
        break;
      }
    }
  } else {
    m.vy += MOVE.gravity * dt;
  }

  if (cmd.jump && m.onGround && !m.blocking && m.stamina >= 10) {
    // Burger boost: a fresh cheeseburger primes the next jump for ~1.6x
    // height, on top of the existing 1.4x "while-eating" bonus.
    const burgerJump = (m._burgerT > 0) ? 1.6 : 1.0;
    m.vy = MOVE.jumpV * (m.eating ? 1.4 : 1) * burgerJump;
    m.onGround = false;

    m.stamina = Math.max(0, m.stamina - 10);
    if (m.stamina <= 0) m.staminaLockT = MOVE.staminaLock;
  }

  m.y += m.vy * dt;

  // Land on the highest collider top under our feet ONLY when the
  // player was already above it last frame (i.e. descending). This
  // stops walking next to a tall building from snapping the player
  // up onto its roof just because the inflated footprint clips the
  // building's XZ box. `prevY` is passed to `topAt` so a player
  // BELOW a floating platform keeps their real support (the
  // ground floor, a crate top, etc.) instead of snapping upward.
  //
  // FOOT-EXTENT SAMPLING (iter158): use `sampleSupportY` which
  // probes four points on the player's radius. Fixes the trailing-
  // foot sink when walking off curbs/sidewalks/ledges — as long as
  // ANY point of the footprint is on a raised surface the player
  // stays lifted. Once the whole footprint clears the ledge, the
  // step-down smoothing below drops them gracefully onto the lower
  // surface instead of a one-frame teleport OR a floaty gravity
  // free-fall over the 20cm curb gap.
  const prevY = m.y - m.vy * dt;
  const supportY = sampleSupportY(this.colliders, m.x, m.z, prevY, PLAYER_R);
  const heightAboveSupport = m.y - supportY;

  // Unified landing / step-down / step-up snap.
  //
  // Fires when the player is descending or level AND is within
  // STEP_UP (0.55m) of the support. Covers three cases with one
  // smoothed path:
  //   (a) Standard landing after a fall — m.y has crossed supportY
  //       downward this frame (heightAboveSupport ≤ 0.02).
  //   (b) Small ledge step-DOWN — the multi-sample support just
  //       dropped from a curb/sidewalk to the road below. Old code
  //       flipped onGround=false, gravity took over, and the player
  //       free-fell the 20cm with a visible foot-poke. Now we
  //       smoothly drop Y at 12 m/s (matches step-UP rate for
  //       symmetric feel; entire curb transition in ~1-2 frames).
  //   (c) Standing still on the ground — heightAbove ≤ 0.02, snap.
  //
  // A real cliff drop (heightAboveSupport > 0.55) falls through to
  // the else branch, `onGround` toggles false, gravity accumulates
  // properly. A player MID-JUMP has vy > 0 so the guard fails and
  // they arc upward normally.
  if (m.vy <= 0 && heightAboveSupport <= 0.55 && prevY >= supportY - 0.02) {
    if (heightAboveSupport > 0.02) {
      m.y = Math.max(supportY, m.y - 12.0 * dt);
      if (Math.abs(m.y - supportY) < 0.01) m.y = supportY;
    } else {
      m.y = supportY;
    }
    m.vy = 0;
    m.onGround = true;
  } else if (m.y <= 0) {
    m.y = 0;
    m.vy = 0;
    m.onGround = true;
  } else {
    if (heightAboveSupport > 0.02) m.onGround = false;
  }

  // ── STAIR CLIMB (smooth step-up while grounded) ──────────────────
  // `collideXZ` already lets the player walk THROUGH short colliders
  // (h - playerY ≤ STEP_UP). Once past a step riser, supportY jumps
  // upward instantly. Without smoothing the player's Y snaps by the
  // full step height per frame — feels like a teleport. This block
  // ramps m.y toward supportY at 12 m/s so climbing a stairwell at
  // sprint pace (8 m/s move × 0.34m tread ≈ 42 ms/step) keeps the
  // vertical stride ahead of horizontal progress instead of the old
  // 8 m/s rate that made tall sprint stairs feel floaty. Snaps in
  // ~2 frames — imperceptible on the visual side either way.
  if (m.onGround && supportY > m.y + 0.02 && supportY - m.y <= 0.55) {
    const stairRise = Math.min(supportY - m.y, 12.0 * dt);
    m.y += stairRise;
    if (Math.abs(supportY - m.y) < 0.01) m.y = supportY;
    m.vy = 0;
  }

  // ── weapon switching (SR1-style committed swap) ───────────
  if (m.swapT > 0) {
    // lock player during swap (SR1 feel)
  }

  if (
    cmd.slotRequest >= 0 &&
    cmd.slotRequest < WEAPONS3D.length &&
    cmd.slotRequest !== m.wpnIdx &&
    m.swapT <= 0
  ) {
    // FIST slot is replaced by PIMP SLAP while the brass-knuckles
    // pickup is owned — redirect the request before the ownership
    // check so the wheel/digit shortcut still feels like "slot 0".
    let req = cmd.slotRequest;
    if (req === WEAPON_INDEX.fist && m.hasPimpSlap) req = WEAPON_INDEX.pimpslap;
    if (req !== m.wpnIdx) {
      // Block digit hotkey for slots the player doesn't own (lobby
      // mode hides the wheel slot anyway, but 1-7 keys would still
      // jump to it). Owned = melee or has any ammo / reserve.
      const want = WEAPONS3D[req];
      const ownedSlot = want.mag == null
        || (m.ammo[req] | 0) > 0
        || (m.reserve && (m.reserve[req] | 0) > 0);
      // Pimpslap requires the pickup flag too — never selectable otherwise.
      const pimpOk = req !== WEAPON_INDEX.pimpslap || m.hasPimpSlap;
      if (!ownedSlot || !pimpOk) {
        // Silently swallow the request.
      } else {
      m.wpnIdx = req;

      m.reloadT = 0;
      m.fireCd = Math.min(m.fireCd, 0.2);

      this._fireHeld = false;
      m._glitchFiring = false;
      m._akHoldT = 0;
      m._akBurstCount = 0;

      m.swapT = 0.15; // SR1 slower, committed swap
      }
    }
  }

  const w = this.weapon();

  // Edge-detect A (reload) button — used by both the reload block and
  // the lob glitch block below, so it must be computed first.
  const reloadEdge = !!(cmd.reload && !m._prevReload);

  // ── reload (fully committed SR1 behavior) ────────────────
  // Reload moves rounds from m.reserve[wpnIdx] into m.ammo[wpnIdx] up
  // to the magazine size. If the reserve is empty the request is
  // silently dropped (no infinite ammo glitch). The end-of-reload
  // transfer happens when reloadT ticks below 0.
  if (m.reloadT > 0) {
    m.reloadT -= dt;

    if (m.reloadT <= 0) {
      const need = w.mag - (m.ammo[m.wpnIdx] | 0);
      const take = Math.max(0, Math.min(need, m.reserve[m.wpnIdx] | 0));
      m.ammo[m.wpnIdx] = (m.ammo[m.wpnIdx] | 0) + take;
      m.reserve[m.wpnIdx] = (m.reserve[m.wpnIdx] | 0) - take;
    }
  } else if (cmd.reload && w.mag != null && !w.noReload && m.ammo[m.wpnIdx] < w.mag &&
             (m.reserve[m.wpnIdx] | 0) > 0 &&
             !(A_TAP_LOB_GLITCH && cmd.fire && reloadEdge)) {
    // Normal reload — blocked when lob glitch is consuming the A press
    // alongside the trigger (the glitch block below handles it instead),
    // when the weapon opts out of reload (pipe bombs), or when the
    // reserve is already empty.
    m.reloadT = w.reload;
    this._playReload(w);
  }

  // ── cooldown timers ───────────────────────────────────────
  m.fireCd = Math.max(0, m.fireCd - dt);
  m.meleeT = Math.max(0, m.meleeT - dt);
  m.kickT = Math.max(0, m.kickT - dt);
  m.punchLT = Math.max(0, m.punchLT - dt);
  m.gunMeleeT = Math.max(0, m.gunMeleeT - dt);
  m.slapSpinT = Math.max(0, (m.slapSpinT || 0) - dt);

  m.firing = false;

  // ── melee ────────────────────────────────────────────────
  // Combo timeout — if the chain has expired, snap the sequence back
  // to 0 so the next punch/kick starts on a jab / front-kick rather
  // than mid-combo hook / axe-kick out of nowhere.
  if (this.t - m.comboLastT > 1.6) {
    m.attackSeqP = 0;
    m.attackSeqK = 0;
  }

  // LIU-KANG FLYING KICK — the double-tap-forward edge PRIMES the
  // special for a short window. Two accepted trigger paths:
  //   • `cmd.flyKick` fires on the exact double-tap frame while W
  //     was held → launch immediately (fastest, most authentic)
  //   • `cmd.flyKick` fired within 0.35s AND player then presses
  //     `cmd.kick` → also launches (double-tap-then-kick combo)
  // Locked to on-ground fists so it can't be spammed mid-air or
  // interrupted by weapon poses.
  const FLYKICK_PRIME_WINDOW = 0.35;
  if (cmd.flyKick) m.flyKickPrimedT = this.t;
  const primed = (this.t - m.flyKickPrimedT) < FLYKICK_PRIME_WINDOW;
  const canFlyKick = fists && m.flyKickT <= 0 && m.onGround && !m.blocking && this.phase === 'play';
  if (canFlyKick && (cmd.flyKick || (primed && cmd.kick))) {
    // Launch — reset combos, boost forward velocity, add a small
    // vertical hop, mark the special so gravity treats us gentler.
    m.flyKickT = 0.60;                      // total animation duration
    m.flyKickDamageDone = false;
    m.flyKickPrimedT = -999;                // consume the prime
    m.attackSeqK = 0;                       // resync kick cycle for after
    m.comboLastT = this.t;
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    m.vx = fx * 18;                         // horizontal launch — 18m/s
    m.vz = fz * 18;
    m.vy = Math.max(m.vy, 4.8);             // small vertical hop
    m.onGround = false;
    // Skip any regular kick this frame.
    cmd = { ...cmd, kick: false, punchL: false };
  }

  // KICK — 3-cycle animation variety: front kick → roundhouse → axe kick.
  // Damage escalates with the sequence so the finisher hurts.
  if (cmd.kick && m.kickT <= 0 && !m.blocking && this.phase === 'play') {
    const kickTable = [
      { dmg: 28, range: 2.7, cd: 0.38 },   // 0: front push kick
      { dmg: 34, range: 2.9, cd: 0.42 },   // 1: roundhouse
      { dmg: 45, range: 2.9, cd: 0.55 },   // 2: axe kick / spin-kick finisher
    ];
    const idx = m.attackSeqK % kickTable.length;
    const K = kickTable[idx];
    this._melee({ id: 'fist', damage: K.dmg, range: K.range, kickVariant: idx }, cmd.yaw);
    m.kickT = K.cd;
    m.lastKickVariant = idx;
    m.attackSeqK = idx + 1;
  }

  // PUNCH — 4-cycle Ip-Man flurry: jab → cross → hook → uppercut.
  // Cooldown drops with each successive strike (bursts get faster)
  // then resets when the combo lapses.
  if (cmd.punchL && fists && m.punchLT <= 0 && !m.blocking && this.phase === 'play') {
    const punchTable = [
      { dmg: 16, range: 2.3, cd: 0.24 },   // 0: fast j                             ab
      { dmg: 22, range: 2.4, cd: 0.24 },   // 1: cross
      { dmg: 26, range: 2.4, cd: 0.26 },   // 2: hook
      { dmg: 40, range: 2.5, cd: 0.42 },   // 3: uppercut finisher
    ];
    const idx = m.attackSeqP % punchTable.length;
    const P = punchTable[idx];
    this._melee({ id: 'fist', damage: P.dmg, range: P.range, punchVariant: idx }, cmd.yaw);
    m.punchLT = P.cd;
    m.lastPunchVariant = idx;
    m.attackSeqP = idx + 1;
  }

  if ((cmd.punchL || cmd.gunMelee) && !fists && !w.melee && m.gunMeleeT <= 0 && !m.blocking && this.phase === 'play') {
    this._melee({ id: 'gunbutt', damage: 15, range: 2.0 }, cmd.yaw);
    m.gunMeleeT = 0.75;
  }

  // ── AK47 crouch-turn glitch ───────────────────────────────
  // While crouching with the AK47, if the player is rotating the
  // right stick (yaw changing by more than a threshold), the gun
  // fires automatically in the direction they are turning.
  // The glitch stops firing the moment turning stops.
  // Normal fire input is ignored while the glitch is active —
  // you have to stop turning before you can aim and shoot normally.
  let glitchFiredThisFrame = false;
  if (AK47_CROUCH_TURN_GLITCH && w.id === 'ak47' && m.crouch && m.onGround && !m.blocking && !m.dead && cmd.fire && this.phase === 'play') {
    // Compute shortest-path yaw delta this frame (radians).
    const rawDelta = ((m.yaw - m._prevYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // Threshold: ~4°/frame at 60fps — any deliberate right-stick input.
    const TURN_THRESHOLD = 0.018;
    const isTurning = Math.abs(rawDelta) > TURN_THRESHOLD;

    if (isTurning) {
      m._glitchFiring = true;
    } else {
      m._glitchFiring = false;
    }

    if (m._glitchFiring && m.fireCd <= 0 && m.reloadT <= 0 && m.ammo[m.wpnIdx] > 0) {
      // Fire in the current turning direction — build a camRay-like object
      // aimed sideways (perpendicular to forward, toward the turn direction).
      const turnSign = rawDelta >= 0 ? 1 : -1;
      // Shoot in the direction the player is currently facing (yaw), not
      // the camera yaw, so it sprays around as they spin.
      const glitchYaw = m.yaw + turnSign * Math.PI * 0.18; // slightly ahead of spin
      const glitchRay = {
        ox: camRay.ox, oy: camRay.oy, oz: camRay.oz,
        dx: -Math.sin(glitchYaw),
        dy: camRay.dy,
        dz: -Math.cos(glitchYaw),
      };
      this._shoot(w, glitchRay, 'ak47_auto');
      m.ammo[m.wpnIdx]--;
      m.fireCd = AK_AUTO_CD;   // glitch sprays at full-auto rate
      m.firing = true;
      glitchFiredThisFrame = true;

      if (m.ammo[m.wpnIdx] === 0 && w.mag != null) {
        // Out of ammo mid-glitch — auto-reload IF reserve has rounds.
        if ((m.reserve[m.wpnIdx] | 0) > 0) {
          m.reloadT = w.reload;
          this._playReload(w);
        }
        m._glitchFiring = false;
      }
    }
  } else {
    // Not in glitch conditions — make sure flag is cleared.
    m._glitchFiring = false;
  }

  // Store yaw for next frame's delta calculation.
  m._prevYaw = m.yaw;

  // ── A-tap lob glitch detection ────────────────────────────
  // Edge-detect: only trigger on the frame A goes from up → down.
  m._prevReload = !!cmd.reload;

  if (A_TAP_LOB_GLITCH && cmd.fire && reloadEdge && !m.dead && this.phase === 'play') {
    // Play reload click so it feels like you tried to reload mid-fire.
    this._playReload(w);
    m._aTapLob = true;   // consumed by _shoot on this same frame's fire path
  }
  // _aTapLob is cleared inside _shoot after the lob fires (not here),
  // so it survives until the fire block actually consumes it this frame.

  // ── AK47 hold-time tracking ──────────────────────────────────
  // Accumulate how long the trigger has been held this press so we
  // can switch fire modes.  Reset whenever the trigger is released.
  const isAK = w.id === 'ak47';
  const triggerDown = !!(cmd.fire && !cmd.wheel && !m.blocking && !m.eating && m.swapT <= 0 && m.hitStunT <= 0 && !glitchFiredThisFrame && !m._glitchFiring);

  if (isAK && triggerDown) {
    m._akHoldT += dt;
  } else if (!triggerDown) {
    // Trigger released — reset burst state so next tap is a clean single.
    m._akHoldT = 0;
    m._akBurstCount = 0;
  }

  // ── fire (SR1 more restrictive + committed reload/wheel feel) ─
  // Suppressed while the glitch is actively firing so the two systems
  // don't stack or fight each other.
  // For the AK47 we derive auto/burst from hold time instead of w.auto.
  const wantFire =
    triggerDown &&
    (isAK
      ? true                      // AK manages its own repeat logic below
      : (w.auto || !this._fireHeld));

  this._fireHeld = false;

  if (wantFire && m.fireCd <= 0 && (m.reloadT <= 0 || m._aTapLob) && this.phase === 'play') {
    if (w.melee) {
      // PIMP-SLAP 360° SPIN — capture the player's current lateral
      // input (A/D keys OR left-stick X on gamepad) as the spin
      // direction. Strafing LEFT (A / stick-left, strafe < 0)
      // swings the body a full 360° COUNTER-CLOCKWISE — a backhand
      // pivot with the RIGHT arm arcing across body. Strafing RIGHT
      // (D / stick-right, strafe > 0) does the mirror CW pivot with
      // the right arm swinging OUT. If the player has no lateral
      // input at the moment of the slap, we default to CW so a
      // static-standing slap still looks satisfying.
      //
      // (Bug fix: previously read `cmd.mvx` which is a BOT-only
      // command field and is always 0 for the local player, so the
      // spin was always CW no matter what the user pressed.)
      if (w.slap || w.id === 'pimpslap') {
        const lat = (cmd.strafe || 0);
        m.slapSpinDir = lat > 0.05 ? 1 : (lat < -0.05 ? -1 : 1);
        m.slapSpinT = 0.55;                            // full-swing duration
      }
      this._melee(w, cmd.yaw);
      m.fireCd = w.cooldown;
      m.meleeT = 0.22;
      m.firing = true;
    } else if (m.ammo[m.wpnIdx] > 0) {

      if (isAK) {
        // ── AK47 three-mode fire ──────────────────────────────
        // Decide mode from how long the trigger has been held.
        const isAuto  = m._akHoldT >= AK_AUTO_THRESHOLD;
        const isBurst = !isAuto && m._akHoldT > 0;

        if (isAuto) {
          // Full-auto: roaring sustained fire.
          this._shoot(w, camRay, 'ak47_auto');
          m.fireCd = AK_AUTO_CD;
          m._akBurstCount++;
        } else if (isBurst) {
          // Burst: up to 3 rounds, each with the rattle sfx.
          // After 3 shots the trigger must be re-tapped for another burst.
          if (m._akBurstCount < 3) {
            this._shoot(w, camRay, 'ak47_burst');
            m.fireCd = AK_BURST_CD;
            m._akBurstCount++;
          } else {
            // Burst exhausted — stall until trigger is released.
            m.fireCd = AK_BURST_CD;
          }
        } else {
          // Tap: single crack, slower follow-up to reward careful shooting.
          this._shoot(w, camRay, 'ak47_single');
          m.fireCd = AK_SINGLE_CD;
          m._akBurstCount = 1;
          // Lock repeat so next shot requires releasing and re-pressing
          // (same as any semi-auto weapon).
          this._fireHeld = true;
        }
      } else {
        // ── all other weapons — unchanged ─────────────────────
        this._shoot(w, camRay);
        m.fireCd = w.cooldown;
      }

      m.ammo[m.wpnIdx]--;
      m.firing = true;

      if (m.ammo[m.wpnIdx] === 0 && w.mag != null) {
        // Auto-reload only if the reserve still has rounds to feed in.
        if ((m.reserve[m.wpnIdx] | 0) > 0) {
          m.reloadT = w.reload;
          this._playReload(w);
        }
        m._akHoldT = 0;
        m._akBurstCount = 0;
      }
    } else {
      playEmpty();
      m.fireCd = 0.35;
      m._akHoldT = 0;
      m._akBurstCount = 0;
    }
  }
}

  _melee(w, yaw) {
    // The `bat` uses its own SR1 stream; everything else that hits
    // this path (fists, gun-butt, unarmed punch) plays the `fist`
    // sample. Pimp-slap gets its own SYNTHESIZED wet-slap SFX (no
    // SR1 stream is remotely close to a real slap) and skips the
    // generic fist play so the two don't overlap.
    if (w.slap || w.id === 'pimpslap') {
      // Local-play immediately so the user hears their own slap
      // with zero latency; remotes get it via the tracer/evt bus.
      this._playWeaponAt('pimpslap', this.me.x, this.me.y + 1.35, this.me.z);
    } else {
      playWeapon(w.id === 'bat' ? 'bat' : 'fist', 60);
    }
    const m = this.me;
    const fy = yaw != null ? yaw : m.yaw;
    const fx = -Math.sin(fy), fz = -Math.cos(fy);
    // PIMP SLAP — 360° instakill. No facing cone, no break-after-1.
    // Every actor within w.range dies and gets a ragdoll impulse
    // outward from the slapper. (User spec: instant kill + ragdoll
    // across the map.) Dead bodies inside the radius ALSO get slapped
    // — a big lateral impulse is queued onto their existing ragdoll so
    // stacked corpses go flying like bowling pins.
    if (w.slap || w.id === 'pimpslap') {
      for (const a of this._allActors()) {
        if (a.id === (m.id || 'me')) continue;
        const dx = a.x - m.x, dz = a.z - m.z;
        const d = Math.hypot(dx, dz);
        if (d > w.range) continue;
        const nx = d > 0.001 ? dx / d : 1;
        const nz = d > 0.001 ? dz / d : 0;
        if (a.dead) {
          // Corpse-slap — re-launch the ragdoll rather than dealing dmg.
          const imp = { dx: nx, dy: 0, dz: nz, up: 8, strength: 22, spin: 6 };
          a.pendingRagdollImpulses = a.pendingRagdollImpulses || [];
          a.pendingRagdollImpulses.push(imp);
          if (this.coop) this.coop.sendEvt({ k: 'ci', tid: a.id, imp });
          continue;
        }
        // Live target: apply the same radial + upward impulse the
        // engine used to use for movement, then instakill. The
        // makeDeathImpulse call inside _damageBot picks up the same
        // dx/dz via the impact.
        a.vx = (a.vx || 0) + nx * 28;
        a.vz = (a.vz || 0) + nz * 28;
        a.vy = (a.vy || 0) + 12;
        if (this.isAuthority && this.bots && a.bot) {
          const b = this.bots.get(a.id);
          if (b) { b.vx = nx * 28; b.vz = nz * 28; b.vy = 12; }
        }
        this._dealDamage(a, 9999, 'pimpslap', {
          dx: nx, dy: 0, dz: nz,
          srcX: m.x, srcY: m.y, srcZ: m.z,
        });
      }
      return;
    }
    // Friendly fire is ON — only skip self and the dead for the
    // damage cone. Corpses in the cone still get a directed kick so
    // punting a body works as expected.
    // KUNG-FU COMBO — combo count times out after 1.4s of no hit.
    const COMBO_WINDOW_S = 1.4;
    if (this.t - m.comboLastT > COMBO_WINDOW_S) m.comboCount = 0;
    // Damage multiplier ramps up +15% per prior hit in the chain, up
    // to a cap of x1.9 (a 6-hit combo dishes ~90% bonus). Keeps
    // combos rewarding without one-shotting on turn 3.
    const comboMul = 1 + Math.min(0.9, 0.15 * m.comboCount);
    const dmgFinal = Math.round((w.damage || 0) * comboMul);
    // Knockback strength scales similarly so a fresh jab is a light
    // stagger but a 5-hit combo ends the chain with a launcher.
    const knockMul = 1 + Math.min(1.2, 0.25 * m.comboCount);
    for (const a of this._allActors()) {
      if (a.id === (m.id || 'me')) continue;
      const dx = a.x - m.x, dz = a.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range) continue;
      if ((dx * fx + dz * fz) / Math.max(0.001, d) < 0.45) continue;   // ~60° cone
      const nx = d > 0.001 ? dx / d : 1;
      const nz = d > 0.001 ? dz / d : 0;
      if (a.dead) {
        // Corpse kick/punch — punt in facing direction, harder if the
        // player has been building a combo (crowd-control body-flick).
        const baseStrength = w.id === 'fist' && w.damage >= 30 ? 12 : 7;   // kick > punch
        const strength = baseStrength * knockMul;
        const imp = { dx: nx, dy: 0, dz: nz, up: 5, strength, spin: 4 };
        a.pendingRagdollImpulses = a.pendingRagdollImpulses || [];
        a.pendingRagdollImpulses.push(imp);
        if (this.coop) this.coop.sendEvt({ k: 'ci', tid: a.id, imp });
        continue;
      }
      this._dealDamage(a, dmgFinal, w.id, {
        dx: nx * knockMul, dy: 0, dz: nz * knockMul,
        srcX: m.x, srcY: m.y, srcZ: m.z,
      });
      // ── HIT LANDED — combo + VFX bookkeeping ─────────────────
      m.comboCount = Math.min(9, m.comboCount + 1);
      m.comboLastT = this.t;
      // Uppercut on the 3rd or later hit sends the target airborne.
      if (m.comboCount >= 3 && !a.dead) {
        a.vy = (a.vy || 0) + 6.5;
      }
      // Impact VFX — position roughly at the target's chest.
      this.meleeImpacts.push({
        x: a.x, y: (a.y || 0) + 1.35, z: a.z, t: this.t,
        kind: w.id || 'fist',
        big: m.comboCount >= 3,
      });
      if (this.meleeImpacts.length > 24) this.meleeImpacts.shift();
      // Hit-stop + camera shake escalate with the combo — a fresh
      // jab is barely a flinch; a 5-hit chain slam is the whole
      // arena rattling.
      this.hitStopT = 0.05 + Math.min(0.05, 0.008 * m.comboCount);
      this.camShake = Math.max(this.camShake, 0.35 + 0.10 * m.comboCount);
      break;
    }
  }

  _shoot(w, camRay, sfxOverride = null) {
    const m = this.me;
    // Local shot — listener is at me, so play at me-position for clean
    // centered sound. Remote players will hear it via the WS state
    // broadcast + their own _playWeaponAt with src at this player's pos.
    this._playWeaponAt(sfxOverride || w.sfx || w.id, m.x, m.y + 1.35, m.z);
    const pellets = w.pellets || 1;
    const dmgMult = m.crouch ? 1.25 : 1;

    // ── A-tap lob glitch ─────────────────────────────────────────
    // When active, skip the normal hitscan entirely.  Instead compute
    // a random landing point in a forward cone and deal damage there,
    // drawing an arc tracer (up then down) so it looks like the bullet
    // went into the air and dropped.
    if (A_TAP_LOB_GLITCH && m._aTapLob && !w.projectile && !w.melee) {
      const fwd = -Math.cos(m.yaw);  // forward Z component
      const rgt =  Math.sin(m.yaw);  // right X component (flipped for LH coords)
      // Random landing point in a cone in front of the player.
      const dist = LOB_MIN_DIST + Math.random() * (LOB_MAX_DIST - LOB_MIN_DIST);
      const drift = (Math.random() - 0.5) * 2 * LOB_SIDE_SPREAD;
      const lx = m.x + (-Math.sin(m.yaw)) * dist + rgt * drift;
      const lz = m.z + fwd * dist + (-Math.sin(m.yaw)) * drift * 0.2;
      const ly = 0; // bullets land on the ground
      // Arc tracer — rises to a peak midway then drops to the landing spot.
      const peakH = 4.5 + Math.random() * 3;
      const midX = (camRay.ox + lx) * 0.5;
      const midZ = (camRay.oz + lz) * 0.5;
      // Two-segment tracer: muzzle → peak, peak → landing.
      this.tracers.push({ ax: camRay.ox, ay: camRay.oy, az: camRay.oz, bx: midX, by: camRay.oy + peakH, bz: midZ, t: 0.18 });
      this.tracers.push({ ax: midX, ay: camRay.oy + peakH, az: midZ, bx: lx, by: ly + 0.1, bz: lz, t: 0.22 });
      if (this.coop) {
        this.coop.sendEvt({ k: 'tr', ax: camRay.ox, ay: camRay.oy, az: camRay.oz, bx: midX, by: camRay.oy + peakH, bz: midZ });
        this.coop.sendEvt({ k: 'tr', ax: midX, ay: camRay.oy + peakH, az: midZ, bx: lx, by: ly + 0.1, bz: lz });
      }
      // Small impact puff at landing.
      this.impacts.push({ x: lx, y: ly + 0.05, z: lz, t: 0.3, big: false });
      // Damage any actor within a small splash radius at the landing point.
      // (The bullet fell from the sky so it's not a direct aimed shot —
      //  reduced damage and no headshot multiplier to keep it fair-ish.)
      const LOB_SPLASH_R = 1.2;
      const lobDmg = Math.round(w.damage * 0.6);
      for (const a of this._allActors()) {
        if (a.id === (m.id || 'me') || a.dead) continue;
        if (Math.hypot(a.x - lx, a.z - lz) < LOB_SPLASH_R) {
          this._dealDamage(a, lobDmg, w.id);
        }
      }
      // Cancel the fake reload that was started to trigger the animation —
      // the bullet already lobbed, so the reload must not complete.
      m.reloadT = 0;
      m._aTapLob = false;
      return; // skip normal hitscan entirely
    }
    // ── end lob glitch ───────────────────────────────────────────

    // Crouched against low cover?  Pop the muzzle just over the lip so
    // you can shoot over crates / car hoods while staying covered.
    let oy = camRay.oy;
    if (m.crouch) {
      for (const c of this.colliders) {
        // Phantom stair slopes don't push the muzzle up.
        if (c.no_bullet) continue;
        if (c.h > 1.9 || c.h <= oy) continue;
        const dx = Math.max(c.x0 - m.x, 0, m.x - c.x1);
        const dz = Math.max(c.z0 - m.z, 0, m.z - c.z1);
        if (Math.hypot(dx, dz) < 1.1) oy = Math.max(oy, c.h + 0.2);
      }
    }
    if (w.projectile) {
      const d = this._spreadDir(camRay, w.spread);
      // Pipe bomb — underhand toss: bias direction UP so the arc is
      // dramatic rather than flat. RPG stays laser-straight.
      let vx = d.x * w.speed, vy = d.y * w.speed, vz = d.z * w.speed;
      if (w.id === 'pipebomb') {
        vy += 5.2;                        // upward heave
        // Slight forward damping so a straight-up look still throws
        // the bomb a couple meters ahead instead of flopping backward.
        vx *= 0.85; vz *= 0.85;
      }
      this.rockets.push({
        x: camRay.ox, y: oy, z: camRay.oz,
        vx, vy, vz,
        owner: m.id || 'me', team: m.team, t: w.fuse || 6, mine: true,
        gravity: !!w.gravity, fuse: w.fuse || 0,
        wpnId: w.id,
        // Spawn a small spark burst on release — view3d renders this
        // as a "match strike" flash before the fuse trail kicks in.
        _sparkPop: 1.0,
      });
      if (this.coop) this.coop.sendEvt({ k: 'rkt', x: camRay.ox, y: oy, z: camRay.oz, dx: vx / w.speed, dy: vy / w.speed, dz: vz / w.speed, sp: w.speed, w: w.id, g: !!w.gravity, f: w.fuse || 0 });
      return;
    }
    for (let i = 0; i < pellets; i++) {
      // Crouching tightens spread hard (0.4x); running blooms it (1.6x).
      let d = this._spreadDir(camRay, w.spread * (m.moving > 0.3 ? 1.6 : 1) * (m.crouch ? 0.4 : 1));
      const o = { x: camRay.ox, y: oy, z: camRay.oz };
      d = this._magnetize(o, d, w.range);
      const wallHit = {};
      const wallT = rayWalls(this.colliders, o, d, w.range, wallHit);
      let bestT = wallT, hitA = null;
      // Friendly fire is ON — teammates are valid targets.
      for (const a of this._allActors()) {
        if (a.id === (m.id || 'me') || a.dead) continue;
        const t = rayActor(o, d, a);
        if (t < bestT) { bestT = t; hitA = a; }
      }
      // Vehicle hit-test — bullets damage the car body, AND continue
      // through to anyone inside. Use a separate "car hit T" so the
      // bullet visual still lands on the closest geometry.
      let carHit = null, carT = Infinity;
      for (const v of this.vehicles) {
        if (v.dead) continue;
        const t = rayVehicleAABB(o, d, v, w.range);
        if (t < carT) { carT = t; carHit = v; }
      }
      if (carHit && carT < bestT) bestT = carT;
      // Destructible props — bullets can hit crates, glass, barrels
      // before punching through to a person. If the closest hit is a
      // prop, it eats the damage and no actor takes any.
      let destHit = null, destT = Infinity;
      if (this.destructibles) {
        const dh = this.destructibles.hitscan({ x: o.x, y: o.y, z: o.z }, d, w.range);
        if (dh) { destHit = dh.rec; destT = dh.t; }
      }
      const hitDestructibleFirst = destHit && destT < bestT;
      if (hitDestructibleFirst) bestT = destT;
      const hx = o.x + d.x * bestT, hy = o.y + d.y * bestT, hz = o.z + d.z * bestT;
      // What the round actually hit — drives the per-surface impact VFX/SFX
      // (concrete dust · metal sparks · wood splinters · glass shards).
      let surfHit = null;
      if (hitDestructibleFirst) {
        const a = destHit.aabb;
        surfHit = { surf: SURFACE_OF_PROP[destHit.type] || 'metal', ...aabbFaceNormal(hx, hy, hz, destHit.x - a.x, destHit.x + a.x, destHit.y, destHit.y + a.y * 2, destHit.z - a.z, destHit.z + a.z) };
      } else if (carHit && carT <= bestT && carT < w.range) {
        surfHit = { surf: 'metal', ...normalFromDir(d.x, d.y, d.z) };
      } else if (!hitA && bestT < w.range) {
        surfHit = { surf: surfaceOfCollider(wallHit.c), ...(wallHit.nx != null ? { nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz } : normalFromDir(d.x, d.y, d.z)) };
      }
      this.tracers.push({ ax: o.x + d.x * 1.2, ay: o.y - 0.15, az: o.z + d.z * 1.2, bx: hx, by: hy, bz: hz, t: 0.09, wpn: w.id });
      if (this.coop) this.coop.sendEvt({ k: 'tr', ax: o.x, ay: o.y - 0.15, az: o.z, bx: hx, by: hy, bz: hz, w: w.sfx || w.id, ...(surfHit ? { s: SURFACE_CODE[surfHit.surf], nx: surfHit.nx, ny: surfHit.ny, nz: surfHit.nz } : {}) });
      if (hitDestructibleFirst) {
        // Prop absorbs the shot — no actor damage. Barrels do explode
        // on death which will hit actors via the AOE drain below.
        this.destructibles.damage(destHit.id, Math.round(w.damage * dmgMult));
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.25, big: false, kind: 'wall', wpn: w.id, ...surfHit, dx: d.x, dy: d.y, dz: d.z });
      } else if (hitA) {
        const impact = {
          dx: d.x, dy: d.y, dz: d.z,
          hitY: hy,
          headshot: hy > (hitA.y || 0) + 1.55,
          srcX: o.x, srcY: o.y, srcZ: o.z,
        };
        this._dealDamage(hitA, Math.round(w.damage * dmgMult), w.id, impact);
        // Flesh hit → BLOOD SPRAY (view3d renders red particles + a
        // dark splatter decal that lingers a couple seconds).
        // Shotgun / AK-headshot / RPG mark as `big` for a bigger spray.
        const bigHit = (w.id === 'shotgun' && !!w.pellets) || impact.headshot || w.id === 'rpg';
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.2, big: bigHit, kind: 'flesh', wpn: w.id, dx: d.x, dy: d.y, dz: d.z });
      }
      if (carHit && carT < w.range) {
        const carDmg = Math.round(w.damage * dmgMult * 0.6);   // cars are tankier than people
        if (damageVehicle(carHit, carDmg)) {
          this._feed(`${this.me.name || 'YOU'} blew up a ride`, '#ff7a3a');
          this._explode({ x: carHit.x, y: 1.2, z: carHit.z, wpnId: 'rpg', mine: true });
        }
      }
      if (!hitA && bestT < w.range && surfHit && !hitDestructibleFirst) {
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.25, big: false, kind: 'wall', wpn: w.id, ...surfHit, dx: d.x, dy: d.y, dz: d.z });
      }
    }
  }

  // ── Bullet magnetism (aim assist) ─────────────────────────────────
  // Console-era aim assist: shots within a small cone of an ENEMY's
  // chest bend partway toward center mass. Never pulls toward teammates
  // (no assisted teamkills). Gated by line-of-sight — no bending
  // through walls. Preserves the current sticky-locked target across
  // rapid fire so a stream of shots keeps tracking one enemy instead
  // of "flickering" between two overlapping ones.
  //
  //   Cone       : half-angle 0.09 rad (~5.15°). Wider than legacy for
  //                a more forgiving mid-fight feel.
  //   Falloff    : smoothstep(1 − ang/MAX). Max pull dead-center, zero
  //                at the cone edge. Feels natural, not sticky-glide.
  //   Max pull   : 0.65 (was 0.5). Direction is a weighted blend of
  //                the raw aim vector and the target vector.
  //   Range taper: full pull ≤ 15m, taper to 0.25 by 55m. Long-range
  //                shots still need skill.
  //   Priority   : lowest-angle wins first; ties break on distance and
  //                a +40 bonus for the current aimStickyId.
  _magnetize(o, d, range) {
    const MAX_ANG = 0.09;
    const dl = Math.hypot(d.x, d.y, d.z) || 1;
    const ndx = d.x / dl, ndy = d.y / dl, ndz = d.z / dl;

    let bestScore = -Infinity;
    let bestPick = null;

    for (const a of this._allActors()) {
      if (a.id === (this.me.id || 'me') || a.dead || a.team === this.me.team) continue;
      // Chest sample (y + 1.1) — center of mass.
      const tx = a.x - o.x, ty = (a.y + 1.1) - o.y, tz = a.z - o.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist < 2 || dist > range) continue;
      const inv = 1 / dist;
      const dirX = tx * inv, dirY = ty * inv, dirZ = tz * inv;
      const dot = ndx * dirX + ndy * dirY + ndz * dirZ;
      if (dot <= 0) continue;                 // behind us
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang > MAX_ANG) continue;
      // Line-of-sight gate — skip if a wall sits between us and the
      // target. `wallT < dist − 0.5` = a wall closer than the enemy,
      // with a small tolerance so grazing edges don't over-reject.
      const wallT = rayWalls(this.colliders, o, { x: dirX, y: dirY, z: dirZ }, dist);
      if (wallT < dist - 0.5) continue;
      // Score: angle dominates, then closer wins, then sticky bonus.
      let score = (MAX_ANG - ang) * 200 + Math.max(0, 20 - dist) * 2;
      if (a.id === this.aimStickyId) score += 40;
      if (score > bestScore) {
        bestScore = score;
        bestPick = { dirX, dirY, dirZ, ang, dist };
      }
    }

    if (!bestPick) return d;

    // Smoothstep pull curve — max at cone center, zero at edge.
    const t = 1 - (bestPick.ang / MAX_ANG);
    const angleBoost = t * t * (3 - 2 * t);
    // Range attenuation — full pull inside 15m, taper to 0.25 by 55m.
    const rangeK = bestPick.dist <= 15
      ? 1
      : Math.max(0.25, 1 - (bestPick.dist - 15) / 40);
    const k = 0.65 * angleBoost * rangeK;

    return {
      x: ndx * (1 - k) + bestPick.dirX * k,
      y: ndy * (1 - k) + bestPick.dirY * k,
      z: ndz * (1 - k) + bestPick.dirZ * k,
    };
  }

  _spreadDir(camRay, spread = 0) {
    const s = spread || 0;
    return {
      x: camRay.dx + (Math.random() - 0.5) * 2 * s,
      y: camRay.dy + (Math.random() - 0.5) * 2 * s,
      z: camRay.dz + (Math.random() - 0.5) * 2 * s,
    };
  }

  // ── Death-impulse computation ──────────────────────────────────
  // Given a killing blow's weapon + hit info, return the ragdoll
  // impulse config that should drive the death animation. This is
  // what makes shotgun kills thrust the body backward, pimp slaps
  // fling saints across the room, and a dome AK-47 headshot balloon
  // the poor bastard into the sky.
  //
  //   impact = { dx, dy, dz, hitY, headshot, srcX, srcY, srcZ }
  //     dx/dy/dz = normalized attack direction (from attacker → victim).
  //     hitY     = world-y of the actual hit point (for headshot check).
  //     headshot = optional pre-computed flag.
  //     srcX/Y/Z = attacker's world position (used as impulse origin
  //                for close-range weapons that lack a bullet dir).
  // Cover-hug scan: find the nearest jersey barrier within HUG_RADIUS
  // whose face the player is stationary against. Sets:
  //   m.hugCoverDir → outward normal angle (radians) pointing from the
  //                   barrier face toward the player (this is also the
  //                   direction the player peeks in)
  //   m.hugCoverId  → the collider's id (so pose/HUD code can react)
  // No-op if no barrier is close enough.
  _scanCoverHug(m) {
    const HUG_RADIUS = 1.6;    // must be within 1.6m of barrier center
    const HUG_FACE   = 1.15;   // and within 1.15m of one of its faces
    let best = null;
    let bestD = HUG_RADIUS;
    for (const c of this.colliders) {
      if (!c.barrier) continue;
      const cx = (c.x0 + c.x1) * 0.5;
      const cz = (c.z0 + c.z1) * 0.5;
      const dx = m.x - cx;
      const dz = m.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < bestD) {
        bestD = dist;
        best = { c, dx, dz };
      }
    }
    if (!best) { m.hugCoverDir = null; m.hugCoverId = null; return; }
    // Only latch if the player is on ONE of the barrier's long faces —
    // not the short ends (which are just 0.6m wide, unrealistic peek
    // surfaces). We express this in the barrier's LOCAL frame: rotate
    // (dx, dz) by -yaw so the long axis is X and short axis is Z.
    const yaw = best.c.yaw || 0;
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
    const lx = best.dx * cos - best.dz * sin;    // along long axis
    const lz = best.dx * sin + best.dz * cos;    // along short axis (normal)
    const halfLong  = (best.c.x1 - best.c.x0) * 0.5;
    const halfShort = (best.c.z1 - best.c.z0) * 0.5;
    // Must be within the barrier's LONG span AND close to a face.
    if (Math.abs(lx) > halfLong + 0.4) { m.hugCoverDir = null; m.hugCoverId = null; return; }
    if (Math.abs(lz) > HUG_FACE)       { m.hugCoverDir = null; m.hugCoverId = null; return; }
    // Outward normal in WORLD space — pick the +Z or -Z local normal
    // depending on which side of the barrier the player is on.
    const sign = lz >= 0 ? 1 : -1;
    // Local +Z normal, rotated back into world by yaw.
    const nx = -Math.sin(yaw) * sign;
    const nz =  Math.cos(yaw) * sign;
    m.hugCoverDir = Math.atan2(nx, nz);
    m.hugCoverId = best.c.id;
  }


  _makeDeathImpulse(wpnId, victim, impact) {
    const imp = impact || {};
    const vx = victim.x, vy = victim.y, vz = victim.z;
    // Recover a horizontal direction from whatever the caller gave us.
    let dx = imp.dx || 0, dy = imp.dy || 0, dz = imp.dz || 0;
    if (Math.abs(dx) + Math.abs(dz) < 0.01) {
      const sx = imp.srcX, sz = imp.srcZ;
      if (sx != null && sz != null) {
        dx = vx - sx; dz = vz - sz;
      } else {
        dx = -Math.sin(victim.yaw || 0);
        dz = -Math.cos(victim.yaw || 0);
      }
    }
    const dlen = Math.hypot(dx, dz) || 1;
    dx /= dlen; dz /= dlen;
    // Headshot check — hitY above the victim's shoulder-line (~1.55 wu
    // above ground) counts as a dome shot.
    const headshot = imp.headshot != null
      ? !!imp.headshot
      : (imp.hitY != null && imp.hitY > (vy + 1.55));

    // Weapon-flavoured impulses. Defaults fall through to a mild
    // fall-backwards knockback so weapons we don't special-case still
    // read as a directional hit rather than a static keel-over.
    // Fall direction follows the hit: shot in the back → face-plant
    // forward (prone), from the front → supine, side hits → roll.
    const fx = -Math.sin(victim.yaw || 0), fz = -Math.cos(victim.yaw || 0);
    const along = dx * fx + dz * fz;                 // +1: bullet travelling the way the victim faces (hit from behind)
    const side = dx * fz - dz * fx;
    const rest = along > 0.45 ? 'prone' : along < -0.45 ? 'supine' : (side > 0 ? 'sideR' : 'sideL');
    const srcDist = (imp.srcX != null) ? Math.hypot(vx - imp.srcX, vz - imp.srcZ) : 8;
    switch (wpnId) {
      case 'pimpslap':
        // Pimp slap flings the target across the map. Radial from
        // attacker → victim, big lateral push, moderate up.
        return { dx, dy: 0, dz, up: 9, strength: 22, spin: 6, balloon: false, w: wpnId, mode: 'launch', rest };
      case 'shotgun': {
        // Blowback — flung back along the pellet direction, brutal up
        // close (point-blank ~20 m/s) tapering to a hard shove at range.
        const k = Math.max(0, Math.min(1, 1 - (srcDist - 2) / 14));
        return { dx, dy: dy * 0.3, dz, up: 3 + 4 * k, strength: 9 + 11 * k, spin: 4 + 3 * k, balloon: false, w: wpnId, mode: 'blast', rest };
      }
      case 'ak47':
        if (headshot) {
          // 🎈 Easter egg — dome shot with the AK balloons the poor
          // bastard straight up. Reduced gravity + huge upward push.
          return { dx: dx * 0.3, dy: 0, dz: dz * 0.3, up: 34, strength: 3, spin: 2, balloon: true, gravityMul: 0.06, w: wpnId };
        }
        // Stagger-spin: the burst twists them round as they drop.
        return { dx, dy: dy * 0.2, dz, up: 3, strength: 6.5, spin: 4, twist: side >= 0 ? 5 : -5, balloon: false, w: wpnId, mode: 'stagger', rest };
      case 'rpg':
      case 'pipebomb':
        // Explosive — huge radial + upward.
        return { dx, dy: 0, dz, up: 12, strength: 16, spin: 8, balloon: false, w: wpnId, mode: 'launch', rest };
      case 'bat':
      case 'gunbutt':
      case 'fist':
        // Melee — clubbed sideways: lateral shove + fast yaw spin.
        return { dx, dy: 0, dz, up: 3.5, strength: 6, spin: 3, twist: 9, lateral: 3, balloon: false, w: wpnId, mode: 'spin', rest: side > 0 ? 'sideR' : 'sideL' };
      default:
        if (headshot) {
          // Head snap — whipped back, body follows a beat later.
          return { dx, dy: 0.15, dz, up: 2.5, strength: 6, spin: 7, balloon: false, w: wpnId, mode: 'headsnap', rest: along > 0.45 ? 'prone' : 'supine' };
        }
        // Pistol / TEC-9 body shots: knees buckle, barely displaced.
        return { dx, dy: dy * 0.2, dz, up: 1.5, strength: 2.5, spin: 2.5, balloon: false, w: wpnId, mode: 'crumple', rest: along > 0.45 ? 'prone' : 'crumpled' };
    }
  }

  // Damage from ME to a target actor.
  _dealDamage(a, dmg, wpnId, impact) {
    // Spawn shield — brand-new spawns are immune for 3s so campers on
    // the respawn zone can't farm players. Shield ticks down every
    // frame inside the main update; we just gate the damage here.
    if (a && (a.spawnShield || 0) > 0) return;
    this.hitMarkerT = 0.18;
    // COD/Halo-style hit-confirm ping — pairs with the red-X hitmarker
    // pulse on the HUD so every successful shot has an audio-visual
    // "kill confirmed" beat.
    playHitConfirmSfx();
    // Client-side predicted HP — drop the enemy healthbar the instant
    // your shot connects, without waiting for the authority round-trip.
    // For bots (authority-owned) we decrement the real record; for
    // remotes we decrement `rp.latest.hp` (what view3d actually reads).
    // The next authoritative state packet will overwrite these values.
    if (a && !a.dead) {
      if (a.remote && this.coop) {
        const rp = this.coop.remotes.get(a.id);
        if (rp && rp.latest && rp.latest.hp != null) {
          rp.latest.hp = Math.max(0, rp.latest.hp - dmg);
        }
      } else if (a.bot) {
        // Authority bots — decrement live; non-authority mirrors decrement
        // the local shadow so both host and clients see instant feedback.
        const b = this.isAuthority ? this.bots.get(a.id) : this.remoteBots.get(a.id);
        if (b && b.hp != null) b.hp = Math.max(0, b.hp - dmg);
      }
    }
    const myId = this.me.id || 'me';
    if (a.bot) {
      if (this.isAuthority) {
        this._damageBot(this.bots.get(a.id), dmg, myId, this.me.name, this.me.team, wpnId, impact);
      } else if (this.coop) {
        this.coop.sendEvt({ k: 'bhit', bid: a.id, dmg, name: this.me.name, w: wpnId, imp: impact || null });
      }
    } else if (a.remote && this.coop) {
      this.coop.sendHit(a.id, dmg, wpnId, impact);
    }
  }

  // Scoreboard credit for whoever landed the kill: me, or one of the
  // bots this client simulates (remote humans count their own kills
  // and ship them in the state packet).
  _creditKill(killerId) {
    if (!killerId) return;
    if (killerId === (this.me.id || 'me')) { this.me.kills++; return; }
    const b = this.bots.get(killerId);
    if (b) b.kills = (b.kills || 0) + 1;
  }

  _damageBot(b, dmg, killerId, killerName, killerTeam, weaponId, impact) {
    if (!b || b.dead) return;
    // Spawn shield — brand-new bots (and by extension all newly-spawned
    // actors) can't take damage for their first 3 seconds.
    if ((b.spawnShield || 0) > 0) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.dead = true; b.deadT = 0; b.respawnT = RESPAWN_T; b.deaths++;
      // Register the death spot so future smart-spawns steer away from
      // this hotspot for the next ~10s (see `_pickSmartSpawn`).
      this._registerHotspot(b.x, b.z);
      // Stamp the death impulse (weapon-flavoured knockback) so the
      // client-side ragdoll picks it up on the next frame.
      const di = this._makeDeathImpulse(weaponId || 'pistol', b, impact);
      b.deathImpulse = di;
      const tk = killerTeam === b.team;
      if (!tk && (killerTeam === 'A' || killerTeam === 'B')) this.scores[killerTeam]++;
      if (!tk) this._creditKill(killerId);
      this._killFeedKill({
        killerName, killerTeam, killerId,
        victimName: b.name, victimTeam: b.team, victimId: b.id,
        weaponId: weaponId || 'pistol',
        teamkill: tk,
      });
      // Drop the victim's weapon at the death spot so survivors can grab
      // it. Bots carry a single weapon (no per-slot ammo), so we drop a
      // full magazine. RPG/melee are auto-filtered inside _dropWeapon.
      const bw = WEAPONS3D[WEAPON_INDEX[b.wpn]];
      if (bw && bw.mag != null) this._dropWeapon(b.wpn, bw.mag, b.x, b.z);
      // Pimp-slap victim drops the brass-knuckles pickup (hat falls off).
      if (b.hasPimpSlap) {
        this._dropPimpSlap(b.x, b.z);
        b.hasPimpSlap = false;
        if (b.wpn === 'pimpslap') b.wpn = 'pistol';
      }
      if (this.coop) this.coop.sendEvt({ k: 'bdeath', bid: b.id, bt: b.team, kn: killerName, kt: killerTeam, kid: killerId, w: weaponId || 'pistol', dw: b.wpn, di });
    }
  }

  // Damage TO me (from remote 'hit' msgs or authority bots).
  applyDamageToMe(dmg, fromName, fromId, fromTeam, weaponId, impact) {
    const m = this.me;
    if (m.dead || this.phase !== 'play') return;
    if (m.blocking) dmg = Math.max(1, Math.round(dmg * 0.3));   // guard up soaks 70%

    // Resolve the attacker's actor state (bot / remote) first so we
    // can consult their direction for the cover-hug soak below.
    let attacker = null;
    if (fromId) {
      const b = this.bots?.get?.(fromId) || this.remoteBots?.get?.(fromId);
      if (b) attacker = b;
      else if (this.coop) {
        const rp = this.coop.frame ? this.coop.frame(performance.now()).find(p => p.id === fromId) : null;
        if (rp) attacker = rp;
      }
    }

    // Jersey-barrier cover soak — when the player is hugging a
    // barrier and the shot came from the OPPOSITE side (behind the
    // barrier from the player's POV), soak 85% of the damage. The
    // cone is ±70° around the "into-barrier" direction so an
    // enemy at the barrier's flank still lands full hits.
    if (m.hugCoverDir != null && attacker) {
      const dx = attacker.x - m.x, dz = attacker.z - m.z;
      const angleToAttacker = Math.atan2(dx, dz);
      // "Into barrier" = -hugCoverDir (barrier is opposite the peek
      // direction from the player's perspective).
      const intoBarrier = m.hugCoverDir + Math.PI;
      // Shortest signed angular difference between the two.
      let diff = ((angleToAttacker - intoBarrier + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(diff) < Math.PI * 70 / 180) {
        dmg = Math.max(1, Math.round(dmg * 0.15));   // 85% soaked
        m.coverSoakFlashT = 0.35;                     // brief HUD tell
      }
    }

    m.tauntT = 0; m.taunt = null;        // getting shot kills the vibe
    m.hp -= dmg;
    m.lastHitBy = { id: fromId, name: fromName, team: fromTeam };
    m.lastHitByT = this.t;
    // Cache the angle-from-me for the HUD hit-direction indicator.
    // If we know the attacker's actor state (bot / remote) we can
    // compute the ATAN2 relative to my yaw so the HUD arrow snaps to
    // where the shot came from. Falls back to "unknown" (null) for
    // non-positional damage (fall, fire, etc).
    if (attacker) {
      const dx = attacker.x - m.x, dz = attacker.z - m.z;
      // World angle to attacker minus my facing yaw → local-space angle
      // (0 = directly in front, ±π = behind, +π/2 = right).
      m.lastHitByDir = Math.atan2(dx, dz) - m.yaw;
    } else {
      m.lastHitByDir = null;
    }
    this.damageFlashT = 0.4;
    // Gamepad rumble on damage taken — scales with hit strength so a
    // shotgun blast thumps harder than a stray SMG round. No-ops when
    // the player has vibration disabled in the pause-menu Controller
    // tab (Input3D.rumble handles the toggle internally).
    if (this._rumble) {
      const s = Math.max(0.35, Math.min(1, dmg / 50));
      const ms = Math.max(80, Math.min(280, 60 + dmg * 4));
      this._rumble(s, ms);
    }
    if (m.hp <= 0) {
      m.hp = 0; m.dead = true; m.deadT = 0; m.respawnT = RESPAWN_T; m.deaths++;
      // Own death hotspot — future smart-spawns route around it.
      this._registerHotspot(m.x, m.z);
      const di = this._makeDeathImpulse(weaponId || 'pistol', m, impact);
      m.deathImpulse = di;
      const kt = fromTeam || (m.team === 'A' ? 'B' : 'A');
      this.scores[kt]++;
      if (kt !== m.team) this._creditKill(fromId);   // a bot that dropped me gets the kill on the board
      this._killFeedKill({
        killerName: fromName || '??',
        killerTeam: kt,
        killerId: fromId,
        victimName: m.name,
        victimTeam: m.team,
        victimId: m.id || 'me',
        weaponId: weaponId || 'pistol',
        teamkill: kt === m.team,
      });
      // Drop MY current weapon with remaining ammo at my position.
      const myWpn = WEAPONS3D[m.wpnIdx];
      if (myWpn && myWpn.mag != null) this._dropWeapon(myWpn.id, m.ammo[m.wpnIdx] | 0, m.x, m.z);
      // Brass-knuckles carrier — drop the pickup, hat falls off.
      if (m.hasPimpSlap) {
        this._dropPimpSlap(m.x, m.z);
        m.hasPimpSlap = false;
        if (myWpn && myWpn.id === 'pimpslap') m.wpnIdx = WEAPON_INDEX.pistol;
      }
      if (this.coop) this.coop.sendEvt({ k: 'death', kn: fromName || '??', kid: fromId, kt, vt: m.team, vn: m.name, w: weaponId || 'pistol', dw: myWpn ? myWpn.id : null, da: m.ammo[m.wpnIdx] | 0, di });
    }
  }

  // ── Rockets / thrown grenades ────────────────────────────────────
  // Handles two projectile kinds:
  //   • rocket   (RPG) — straight-line, one-hit-kill on any solid,
  //                       explode on impact.
  //   • pipe bomb — parabolic arc, BOUNCES off walls and ground, ROLLS
  //                 with friction until fuse expires. Direct actor
  //                 hits deal impact damage + KNOCKDOWN. Blast damage
  //                 falls off by distance; INSTANT-KILL inside
  //                 `blastKillR`. Live pipe bombs chain-detonate
  //                 inside a blast radius (see `_explode`).
  _updateRockets(dt) {
    for (const r of this.rockets) {
      // Fuse ticks continuously — even while the pipe bomb is at rest,
      // the timer counts down so a settled bomb still explodes.
      r.t -= dt;
      const isPipeBomb = r.wpnId === 'pipebomb';
      const w = r.wpnId ? WEAPONS3D[WEAPON_INDEX[r.wpnId]] : null;
      const steps = isPipeBomb ? 4 : 2;   // pipe bombs need finer substeps for bounce accuracy
      for (let s = 0; s < steps && r.t > 0 && !r.exploded; s++) {
        const sdt = dt / steps;
        if (r.gravity) r.vy -= 18 * sdt;
        // Provisional new position — used for collision resolution.
        let nx = r.x + r.vx * sdt;
        let ny = r.y + r.vy * sdt;
        let nz = r.z + r.vz * sdt;

        // ── PIPE BOMB path: bounce + roll ─────────────────────────
        if (isPipeBomb) {
          const rest = w?.restitution ?? 0.42;
          const friction = w?.groundFriction ?? 0.78;
          const restThresh = w?.rollThreshold ?? 0.35;

          // Actor DIRECT HIT — knockdown + impact damage + deflect off.
          // Only the owner's local bomb can inflict knockdown to keep
          // authority clean (remote bombs are visual only).
          if (r.mine) {
            for (const a of this._allActors()) {
              if (a.dead || a.id === r.owner) continue;
              if ((r._noHitT || 0) > 0) break;   // brief immunity after last knockdown
              const dx0 = a.x - nx, dz0 = a.z - nz;
              const flatD = Math.hypot(dx0, dz0);
              // Treat the actor as a 0.55m radius capsule 0..1.9m tall.
              if (flatD < 0.75 && ny > (a.y - 0.1) && ny < (a.y + 1.9)) {
                const impact = { dx: dx0 / (flatD || 1e-4), dy: 0.35, dz: dz0 / (flatD || 1e-4), srcX: nx, srcY: ny, srcZ: nz };
                const dmg = w?.impactDamage ?? 25;
                if (a.id === (this.me.id || 'me')) {
                  this.applyDamageToMe(dmg, this.me.name, r.owner, 'X', 'pipebomb', impact);
                } else {
                  this._dealDamage(a, dmg, 'pipebomb', impact);
                }
                // Knockdown flag — a proper prone stagger. Pipe bomb
                // impact drops the target on their back for ~1.6s.
                // Both hitStunT (flinch tinting / hp bar shake) and
                // knockDownT (input lock + prone visual) are set.
                if (a.id === (this.me.id || 'me')) {
                  this.me.hitStunT = Math.max(this.me.hitStunT || 0, 1.6);
                  this.me.knockDownT = Math.max(this.me.knockDownT || 0, 1.6);
                } else if (a.bot) {
                  const b = this.isAuthority ? this.bots.get(a.id) : this.remoteBots.get(a.id);
                  if (b) {
                    b.hitStunT = Math.max(b.hitStunT || 0, 1.6);
                    b.knockDownT = Math.max(b.knockDownT || 0, 1.6);
                  }
                }
                // Deflect off the actor — reverse horizontal velocity,
                // pop up slightly. Small no-hit window prevents rapid
                // multi-tick re-knockdown on the same target.
                const speed = Math.hypot(r.vx, r.vz) * 0.4;
                r.vx = -(dx0 / (flatD || 1e-4)) * speed;
                r.vz = -(dz0 / (flatD || 1e-4)) * speed;
                r.vy = Math.max(2.5, r.vy * 0.5);
                r._noHitT = 0.25;
                break;
              }
            }
          }
          r._noHitT = Math.max(0, (r._noHitT || 0) - sdt);

          // Bounce off arena walls (X/Z bounds → out-of-arena).
          const halfX = this.half + 9.5, halfZ = this.half + 9.5;
          if (nx < -halfX || nx > halfX) { r.vx = -r.vx * rest; nx = Math.max(-halfX, Math.min(halfX, nx)); }
          if (nz < -halfZ || nz > halfZ) { r.vz = -r.vz * rest; nz = Math.max(-halfZ, Math.min(halfZ, nz)); }

          // Collider bounce — reflect velocity along the exit face by
          // choosing the axis of least penetration. `topAt` handles
          // the ground-top separately; here we bounce off the SIDES.
          // Phantom stair slopes (`no_bullet`) let the bomb pass
          // through — the visible step boxes handle real bounces.
          for (const c of this.colliders) {
            if (c.no_bullet) continue;
            // SR chunk grid — land on the real street / roof surface
            // under the bomb, bounce back off building walls.
            if (c.grid) {
              const gTop = c.grid.topAt(nx, nz, r.y + 0.3);
              if (gTop > -Infinity && ny <= gTop + 0.05 && r.y >= gTop - 0.3) {
                ny = gTop + 0.05;
                if (Math.abs(r.vy) > restThresh) { r.vy = -r.vy * rest; r._sparkPop = 0.9; }
                else { r.vy = 0; r.vx *= friction; r.vz *= friction; if (Math.hypot(r.vx, r.vz) < 0.15) { r.vx = 0; r.vz = 0; } }
              } else if (c.grid.wallAt(nx, ny, nz)) {
                nx = r.x; nz = r.z;
                r.vx = -r.vx * rest; r.vz = -r.vz * rest;
                r._sparkPop = 1.0;
              }
              continue;
            }
            // iter163 yBase gate — same rationale as the rocket path
            // below: pipe bombs thrown INDOORS must not bounce off
            // the underside of a 2nd-floor slab. Proper AABB test.
            const yLo = c.yBase != null ? c.yBase : 0;
            if (nx > c.x0 && nx < c.x1 && nz > c.z0 && nz < c.z1 && ny < c.h && ny > yLo) {
              // Penetration depths along each axis (positive = inside).
              const pxL = nx - c.x0, pxR = c.x1 - nx;
              const pzL = nz - c.z0, pzR = c.z1 - nz;
              const pyT = c.h - ny;
              const pyB = ny - yLo;
              const minP = Math.min(pxL, pxR, pzL, pzR, pyT, pyB);
              if (minP === pyT) {
                // Landed on top face — snap up, invert vy with rest.
                ny = c.h + 0.05;
                r.vy = -r.vy * rest;
                // Ground friction pass for rolling on top of the collider.
                r.vx *= friction; r.vz *= friction;
              } else if (minP === pyB) {
                // Hit underside — snap DOWN, invert vy with rest.
                ny = yLo - 0.05;
                r.vy = -Math.abs(r.vy) * rest;
              } else if (minP === pxL) { nx = c.x0 - 0.02; r.vx = -Math.abs(r.vx) * rest; }
              else if (minP === pxR) { nx = c.x1 + 0.02; r.vx =  Math.abs(r.vx) * rest; }
              else if (minP === pzL) { nz = c.z0 - 0.02; r.vz = -Math.abs(r.vz) * rest; }
              else                    { nz = c.z1 + 0.02; r.vz =  Math.abs(r.vz) * rest; }
              // Sparks on hard impact (see view3d spark trail).
              r._sparkPop = 1.0;
            }
          }

          // Ground plane bounce + roll.
          if (ny <= 0.05) {
            ny = 0.05;
            if (Math.abs(r.vy) > restThresh) {
              r.vy = -r.vy * rest;
              r._sparkPop = 0.9;
            } else {
              // Below rest threshold — the bomb settles + rolls.
              r.vy = 0;
              r.vx *= friction;
              r.vz *= friction;
              // Micro-friction — once XZ speed is very low, halt.
              if (Math.hypot(r.vx, r.vz) < 0.15) { r.vx = 0; r.vz = 0; }
            }
          }

          r.x = nx; r.y = ny; r.z = nz;
          // Continuous spark decay — view3d reads `_sparkPop` for
          // pop-in sparks per bounce, and `sparks` for the trail.
          if (r._sparkPop) r._sparkPop = Math.max(0, r._sparkPop - sdt * 2.0);
          continue;   // pipe bomb NEVER explodes on wall/ground contact
        }

        // ── Straight rocket path (RPG) — original behaviour ───────
        const rpx = r.x, rpy = r.y, rpz = r.z;
        r.x = nx; r.y = ny; r.z = nz;
        let boom = r.y <= 0.05 || Math.abs(r.x) > this.half + 10 || Math.abs(r.z) > this.half + 10;
        if (!boom) {
          for (const c of this.colliders) {
            // Iter162 no_bullet — phantom stair slopes (and any
            // other invisible movement-guidance collider) don't
            // stop projectiles. The visible step boxes emitted
            // alongside them handle actual bullet blocking.
            if (c.no_bullet) continue;
            if (c.grid) {
              if (c.grid.segmentHit(rpx, rpy, rpz, r.x, r.y, r.z) !== Infinity) { boom = true; break; }
              continue;
            }
            // iter163: also gate on `yBase` — a rocket fired
            // INDOORS (below a 2nd-floor slab) previously read
            // as "inside the ceiling collider" and detonated in
            // the player's face. Proper AABB test: rocket must be
            // between the collider's floor AND ceiling to hit.
            const yLo = c.yBase != null ? c.yBase : 0;
            if (r.x > c.x0 && r.x < c.x1 && r.z > c.z0 && r.z < c.z1 && r.y < c.h && r.y > yLo) { boom = true; break; }
          }
        }
        if (!boom) {
          for (const a of this._allActors()) {
            if (a.dead || a.id === r.owner) continue;
            if (Math.hypot(a.x - r.x, a.z - r.z) < 0.7 && r.y < (a.y + 1.9)) { boom = true; break; }
          }
        }
        if (boom) {
          this._explode(r);
          r.t = 0;
          r.exploded = true;
          break;
        }
      }
      // Pipe-bomb fuse expiry (or rocket explicit boom fallback).
      if (!r.exploded && r.t <= 0 && (r.fuse || isPipeBomb)) {
        this._explode(r);
        r.exploded = true;
      }
    }
    this.rockets = this.rockets.filter(r => !r.exploded && r.t > 0);
  }

  _explode(r) {
    if (r.exploded) return;               // safety — chain reactions may re-enter
    r.exploded = true;
    const wpnId = r.wpnId || 'rpg';
    const w = WEAPONS3D[WEAPON_INDEX[wpnId]] || WEAPONS3D[WEAPON_INDEX.rpg];
    this.impacts.push({ x: r.x, y: Math.max(0.3, r.y), z: r.z, t: 0.6, big: true, kind: 'explosion', wpn: wpnId });
    // Spatial explosion — volume + pan derived from listener position.
    // Preserve explicit sfx:null opt-outs (pipe bombs currently silent
    // per user request while we source the right blast sample).
    const explosionSfx = w.sfx === null ? null : (w.sfx || 'rpg');
    if (explosionSfx) this._playWeaponAt(explosionSfx, r.x, Math.max(0.3, r.y), r.z);
    // Synth sub-boom + debris rumble layer (also the only blast sound
    // for sample-less weapons like the pipe bomb). Audible to ~160 m.
    playExplosionAt(r.x, Math.max(0.3, r.y), r.z, Math.min(1.5, (w.blast || 4) / 4));
    // Splash into destructibles — chains barrels together and breaks
    // crates/glass caught in the blast radius.
    if (this.destructibles) {
      this.destructibles.splashDamage(r.x, r.y, r.z, w.blast, Math.round(w.damage * 0.7));
    }
    // ── CHAIN REACTION ────────────────────────────────────────────
    // Any OTHER live pipe bomb within the blast radius detonates on
    // the same frame. Use a small delay + a "chained" flag so the
    // explosion visuals stagger by ~30ms per bomb (feels like sequential
    // rather than one big soup).
    for (const other of this.rockets) {
      if (other === r || other.exploded) continue;
      if (other.wpnId !== 'pipebomb') continue;
      const dChain = Math.hypot(other.x - r.x, other.y - r.y, other.z - r.z);
      if (dChain <= w.blast + 0.5) {
        // Recurse — `_explode` guards against double-blast via
        // `exploded` flag so infinite loops are impossible.
        this._explode(other);
      }
    }
    if (!r.mine) return;                 // visual only for remote rockets
    // ── DAMAGE DISTRIBUTION ───────────────────────────────────────
    // Falloff curve:
    //   d ≤ blastKillR (~1.2m):  INSTANT KILL (dmg = 999)
    //   d ≤ blast (~4m):          w.damage * (1 - (d - blastKillR)/(blast - blastKillR))
    //   d >  blast:                no damage
    // RPG uses the classic linear falloff (blastKillR undefined).
    const killR = w.blastKillR;
    for (const a of this._allActors()) {
      if (a.dead) continue;
      const dx = a.x - r.x, dz = a.z - r.z;
      const dy = (a.y + 0.9) - r.y;
      const d = Math.hypot(dx, dy, dz);
      if (d > w.blast) continue;
      let dmg;
      if (killR != null && d <= killR) {
        dmg = 9999;                       // near-hit: instant kill
      } else if (killR != null) {
        const t = (d - killR) / (w.blast - killR);
        dmg = Math.round(w.damage * (1 - t));
      } else {
        dmg = Math.round(w.damage * (1 - d / w.blast));
      }
      if (dmg <= 0) continue;
      // Radial impulse from the blast center — bodies fly outward and
      // upward, standard explosion physics.
      const rd = Math.max(0.001, Math.hypot(dx, dz));
      const impact = {
        dx: dx / rd,
        dy: 0,
        dz: dz / rd,
        srcX: r.x, srcY: r.y, srcZ: r.z,
      };
      if (a.id === (this.me.id || 'me')) {
        const ob = r.owner !== (this.me.id || 'me') ? this.bots.get(r.owner) : null;
        this.applyDamageToMe(dmg, ob ? ob.name : this.me.name, r.owner, ob ? ob.team : (this.me.team === 'A' ? 'B' : 'A'), wpnId, impact);
        playHitTakenSfx(dmg, false);
      } else if (r.owner !== (this.me.id || 'me') && a.bot && this.bots.get(r.owner)) {
        const ob = this.bots.get(r.owner);
        this._damageBot(this.bots.get(a.id), dmg, ob.id, ob.name, ob.team, wpnId, impact);
      } else {
        // Explosions hurt everyone — friendly-fire chaos by design.
        this._dealDamage(a, dmg, wpnId, impact);
      }
    }
  }

  // ── Footsteps ────────────────────────────────────────────────────
  // Stride accumulator per actor: every ~0.7 m walking / ~1.05 m
  // sprinting on the ground plays a spatialised step (left/right pan,
  // ~22 m range) flavoured by the surface tag under the foot. Own steps
  // are quiet, centred.
  _updateFootsteps(dt) {
    if (!this._steps) this._steps = new Map();
    const meId = this.me.id || 'me';
    for (const a of this._allActors()) {
      if (!a || a.dead || a.x == null) { if (a) this._steps.delete(a.id); continue; }
      let s = this._steps.get(a.id);
      if (!s) { this._steps.set(a.id, { x: a.x, z: a.z, acc: 0.35, eatT: 0, bites: 0 }); continue; }
      // Remote burger bites — the snapshot carries `eat`, so we time the
      // chomps locally at the same cadence the eater's engine uses.
      if (a.remote) {
        if (a.eat) {
          s.eatT += dt;
          const bites = s.eatT < 0.45 ? 0 : Math.floor((s.eatT - 0.45) / 1.25) + 1;
          if (bites > s.bites) { s.bites = bites; playEatAt(a.x, (a.y || 0) + 1.3, a.z, false); }
        } else { s.eatT = 0; s.bites = 0; }
      }
      const dist = Math.hypot(a.x - s.x, a.z - s.z);
      s.x = a.x; s.z = a.z;
      if (dist > 3 || dt <= 0) continue;                         // teleport / respawn
      const speed = dist / dt;
      if (speed < 0.8 || a.onGround === false || (a.knockDownT || 0) > 0) continue;
      s.acc += dist;
      const stride = speed > 9 ? 1.05 : (speed > 5 ? 0.85 : 0.7);
      if (s.acc < stride) continue;
      s.acc = 0;
      const self = a.id === meId;
      if (!self && Math.hypot(a.x - this.me.x, a.z - this.me.z) > 24) continue;
      playFootstepAt(a.x, a.y || 0, a.z, { surface: this._surfaceUnder(a.x, a.z, a.y || 0), sprint: speed > 8.5, self });
    }
  }
  _surfaceUnder(x, z, y) {
    let mat = 'concrete', bestH = -Infinity;
    for (const c of this.colliders) {
      if (!c || c.grid || c.no_bullet || !c.mat) continue;
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
      if (c.h <= y + 0.3 && c.h > bestH) { bestH = c.h; mat = c.mat; }
    }
    return mat;
  }

  // ── Bots (authority) ─────────────────────────────────────────────
  _updateBots(dt) {
    // Match-end freeze — bots (like the player) hold their pose.
    // Dead bots keep their ragdoll timer ticking so the death anim
    // still plays out, but ALIVE bots stop moving/shooting.
    const frozen = this.phase !== 'play';
    const actors = this._allActors();
    // In KOTH, direct bots toward the hill when they have no visible
    // enemy — otherwise they'd roam aimlessly and never contest the
    // objective. Set once per bot per _updateBots pass, before
    // botThink runs, so a nearby enemy still overrides.
    const koth = this.gameMode === 'koth' && this.hill;
    for (const b of this.bots.values()) {
      if (b.spawnShield) b.spawnShield = Math.max(0, b.spawnShield - dt);
      if (b.dead) {
        b.deadT += dt; b.respawnT -= dt;
        if (b.respawnT <= 0 && this.phase === 'play') this._spawnActor(b);
        continue;
      }
      if (frozen) continue;              // pin alive bots in place
      // Suggest the hill as a roam target when no enemies visible.
      if (koth && (!b.wp || Math.hypot(b.wp.x - b.x, b.wp.z - b.z) < 3)) {
        b.wp = { x: this.hill.x, z: this.hill.z };
      }
      const want = botThink(b, actors, this.colliders, dt, this.half);
      if (!want) continue;
      const spd = MOVE.jog * MOVE.botSpeed;
      const wantX = b.x + want.mvx * spd * dt;
      const wantZ = b.z + want.mvz * spd * dt;

      // ── Bot auto-mantle: if the bot is walking INTO a climbable
      // collider whose top is within jump reach, hop them up onto
      // it before the horizontal collision resolves. This lets bots
      // ascend the KOTH hill (and any climbable box) without needing
      // a full mantle-button/anim state machine.
      //
      // GUARDS (iter-dirtbike):
      //   • Bot must be on/near the ground (b.y < 0.55). Otherwise
      //     they would chain-mantle up multi-step stairs / rooftop
      //     stacks in one pass — the classic "bots teleport onto
      //     every building" regression the templates introduced.
      //   • Step-up delta capped at 1.4m so bots don't visibly
      //     "jump out of nowhere" up onto tall stair-steps. Anything
      //     taller than a single crate needs the mantle-button
      //     animation the player uses (or pathing around).
      const nearGround = b.y < 0.55;
      const reachY = b.y + 2.2;
      const maxStep = b.y + 1.4;
      let hopTop = -1;
      if (nearGround) for (const c of this.colliders) {
        // Phantom stair slopes (`no_bullet`) aren't hop-onto ledges —
        // bots walk them naturally via `sampleSupportY`.
        if (c.no_bullet) continue;
        if (!c.climbable) continue;
        const top = c.h != null ? c.h : 0;
        if (top <= b.y + 0.05) continue;      // already high enough
        if (top > reachY) continue;           // out of reach
        if (top > maxStep) continue;          // too big of a single step
        // Distance from bot's PROPOSED position to the collider AABB.
        const nx2 = Math.max(c.x0, Math.min(wantX, c.x1));
        const nz2 = Math.max(c.z0, Math.min(wantZ, c.z1));
        const d2 = (nx2 - wantX) * (nx2 - wantX) + (nz2 - wantZ) * (nz2 - wantZ);
        if (d2 > (PLAYER_R + 0.35) * (PLAYER_R + 0.35)) continue;
        // Prefer the tallest reachable top so bots climb multi-step
        // stacks (short → tall) in one pass.
        if (top > hopTop) hopTop = top;
      }
      if (hopTop > 0) {
        b.y = hopTop + 0.02;
      }

      const [nx, nz] = collideXZ(this.colliders, wantX, wantZ, PLAYER_R, this.half, b.y, 1.6);
      // Remember the pre-move XZ so we can revert if the vertical
      // settle wants to snap the bot up onto a rooftop.
      const preX = b.x, preZ = b.z;
      b.x = nx; b.z = nz;

      // ── Bot vertical settle: keep bots resting on whatever they're
      // actually standing on (arena floor, hill top, crates). When
      // they walk OFF a raised platform edge, fall back down.
      //
      // Foot-extent sampling (iter158) — bots share the same PLAYER_R
      // footprint as the local player, so they benefit from the same
      // trailing-foot ledge support the player gets. Prevents bot
      // feet from clipping through sidewalks/curbs while pathing.
      const supportY = sampleSupportY(this.colliders, b.x, b.z, b.y, PLAYER_R);
      if (b.y > supportY + 0.02) {
        b.y = Math.max(supportY, b.y - 6 * dt);  // 6 m/s soft fall
      } else if (b.y < supportY) {
        // ── Stair-walk guard (iter-dirtbike-fix) ────────────────
        // Fine-grained stair-step tops (step_height=0.16) let bots
        // walk straight up any staircase to the rooftops because
        // each individual step is within STEP_UP. To prevent bots
        // from ending up on top of buildings when their targets are
        // on the ground floor, REVERT the XZ move if:
        //   • The proposed foot support is significantly above the
        //     arena floor (> 1.5m absolute), AND
        //   • The bot's aim target (or fallback: the local player)
        //     is on the ground floor (targetY < 1.5m).
        // The result is that bots bump into an invisible wall at
        // the base of the stairs. If their target ever climbs to
        // a rooftop, this guard reopens and bots can follow.
        const targetY = (want.target && want.target.y != null)
          ? want.target.y
          : (this.me && this.me.y != null ? this.me.y : 0);
        const targetLow = targetY < 1.5;
        if (supportY > 1.5 && targetLow) {
          // Revert horizontal step — bot is stuck at the stair base.
          b.x = preX; b.z = preZ;
          // Their y is already low; leave it. sampleSupportY on the
          // OLD position (their current spot) is what they were
          // legitimately resting on, so no need to re-run.
        } else {
          b.y = supportY;
        }
      }
      if (want.fire && want.target && this.phase === 'play') this._botShoot(b, want.target);
    }
  }

  // ── Bot marksmanship ─────────────────────────────────────────────
  // Bots shoot through the SAME pipeline as players: a real ray with a
  // skill-scaled aim error (rookie → veteran roster), weapon spread,
  // walls/props/cars block, shotguns fire real pellets (range falloff
  // for free), headshots only when the ray truly lands on the head,
  // RPG / pipe bomb are real projectiles you can see and dodge. Aim
  // converges onto a freshly acquired target over ~0.4 s (tracking).
  _botShoot(b, target) {
    const w = WEAPONS3D[WEAPON_INDEX[b.wpn]];
    if (!w) return;
    if (b.skill == null) b.skill = 0.3 + Math.random() * 0.55;        // 0.3 rookie … 0.85 veteran
    if (b._aimTarget !== target.id) { b._aimTarget = target.id; b._aimT = 0; }
    b._aimT = (b._aimT || 0) + w.cooldown;
    const tracking = Math.min(1, (b._aimT || 0) / 0.45);
    const ox = b.x, oy = b.y + 1.35, oz = b.z;
    const d = Math.hypot(target.x - ox, target.z - oz);
    // aim at the chest; error (radians) shrinks with skill + tracking,
    // grows with target motion and the bot's own strafing
    const tgtMoving = (target.moving || 0) > 0.3 ? 1 : 0;
    const errRad = (0.012 + (1 - b.skill) * 0.075) * (1.6 - 0.6 * tracking) * (1 + 0.5 * tgtMoving) * (1 + 0.35 * (b.moving || 0));
    const ang = Math.random() * Math.PI * 2, mag = Math.random() * errRad;
    const ty = (target.y || 0) + (Math.random() < 0.12 + 0.18 * b.skill ? 1.6 : 1.2);   // veterans go for the head more
    const tx = target.x, tz = target.z;
    const dx0 = tx - ox, dy0 = ty - oy, dz0 = tz - oz;
    const len = Math.hypot(dx0, dy0, dz0) || 1;
    const fwd = { x: dx0 / len, y: dy0 / len, z: dz0 / len };
    const rx = -fwd.z, rz = fwd.x;                                      // horizontal right vector
    const camRay = {
      ox, oy, oz,
      dx: fwd.x + rx * Math.cos(ang) * mag, dy: fwd.y + Math.sin(ang) * mag, dz: fwd.z + rz * Math.cos(ang) * mag,
    };
    this._playWeaponAt(b.wpn, ox, oy, oz);
    if (w.projectile) {
      const dir = this._spreadDir(camRay, w.spread);
      let vx = dir.x * w.speed, vy = dir.y * w.speed, vz = dir.z * w.speed;
      if (w.id === 'pipebomb') { vy += 5.2 + d * 0.12; vx *= 0.85; vz *= 0.85; }
      this.rockets.push({ x: ox, y: oy, z: oz, vx, vy, vz, owner: b.id, ownerName: b.name, team: b.team, t: w.fuse || 6, mine: true, gravity: !!w.gravity, fuse: w.fuse || 0, wpnId: w.id, _sparkPop: 1.0 });
      if (this.coop) this.coop.sendEvt({ k: 'rkt', x: ox, y: oy, z: oz, dx: vx / w.speed, dy: vy / w.speed, dz: vz / w.speed, sp: w.speed, w: w.id, g: !!w.gravity, f: w.fuse || 0 });
      return;
    }
    const pellets = w.pellets || 1;
    const dmgScale = 0.85;                                               // bots hit a touch softer than a human
    for (let i = 0; i < pellets; i++) {
      const dir = this._spreadDir(camRay, w.spread * (b.moving ? 1.3 : 1));
      const o = { x: ox, y: oy, z: oz };
      const wallHit = {};
      let bestT = rayWalls(this.colliders, o, dir, w.range, wallHit), hitA = null;
      const cands = this._allActors();
      if (target && !cands.some((a) => a.id === target.id)) cands.push(target);   // remote roster entry passed by botThink
      for (const a of cands) {
        if (a.id === b.id || a.dead) continue;
        const t = rayActor(o, dir, a);
        if (t < bestT) { bestT = t; hitA = a; }
      }
      let destHit = null, destT = Infinity;
      if (this.destructibles) { const dh = this.destructibles.hitscan(o, dir, w.range); if (dh) { destHit = dh.rec; destT = dh.t; } }
      const hitDestructibleFirst = destHit && destT < bestT;
      if (hitDestructibleFirst) bestT = destT;
      const hx = o.x + dir.x * bestT, hy = o.y + dir.y * bestT, hz = o.z + dir.z * bestT;
      let surfHit = null;
      if (hitDestructibleFirst) {
        const a = destHit.aabb;
        surfHit = { surf: SURFACE_OF_PROP[destHit.type] || 'metal', ...aabbFaceNormal(hx, hy, hz, destHit.x - a.x, destHit.x + a.x, destHit.y, destHit.y + a.y * 2, destHit.z - a.z, destHit.z + a.z) };
      } else if (!hitA && bestT < w.range) {
        surfHit = { surf: surfaceOfCollider(wallHit.c), ...(wallHit.nx != null ? { nx: wallHit.nx, ny: wallHit.ny, nz: wallHit.nz } : normalFromDir(dir.x, dir.y, dir.z)) };
      }
      this.tracers.push({ ax: o.x + dir.x * 1.2, ay: o.y - 0.15, az: o.z + dir.z * 1.2, bx: hx, by: hy, bz: hz, t: 0.09, wpn: w.id });
      if (this.coop) this.coop.sendEvt({ k: 'tr', ax: o.x, ay: o.y - 0.15, az: o.z, bx: hx, by: hy, bz: hz, w: w.sfx || w.id, ...(surfHit ? { s: SURFACE_CODE[surfHit.surf], nx: surfHit.nx, ny: surfHit.ny, nz: surfHit.nz } : {}) });
      // Near miss on ME → bullet crack/whiz so incoming fire is audible.
      const meId = this.me.id || 'me';
      if (hitA?.id !== meId && this.me && !this.me.dead) {
        const px = this.me.x - o.x, py = (this.me.y + 1.5) - o.y, pz = this.me.z - o.z;
        const along = px * dir.x + py * dir.y + pz * dir.z;
        if (along > 0 && along < bestT) {
          const miss = Math.hypot(px - dir.x * along, py - dir.y * along, pz - dir.z * along);
          if (miss < 1.6) playBulletWhizAt(o.x + dir.x * along, o.y + dir.y * along, o.z + dir.z * along, 1 - miss / 1.6);
        }
      }
      if (hitDestructibleFirst) {
        this.destructibles.damage(destHit.id, Math.round(w.damage * dmgScale));
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.25, big: false, kind: 'wall', wpn: w.id, ...surfHit, dx: dir.x, dy: dir.y, dz: dir.z });
      } else if (hitA) {
        const impact = { dx: dir.x, dy: dir.y, dz: dir.z, hitY: hy, headshot: hy > (hitA.y || 0) + 1.55, srcX: o.x, srcY: o.y, srcZ: o.z };
        const dmg = Math.max(1, Math.round(w.damage * dmgScale * (impact.headshot ? 1.5 : 1)));
        if (hitA.id === meId) {
          this.applyDamageToMe(dmg, b.name, b.id, b.team, b.wpn, impact);
          playHitTakenSfx(dmg, impact.headshot);
        } else if (hitA.bot) {
          this._damageBot(this.bots.get(hitA.id), dmg, b.id, b.name, b.team, b.wpn, impact);
        } else if (this.coop) {
          this.coop.sendHit(hitA.id, dmg, b.wpn, impact, { id: b.id, name: b.name, team: b.team });
        }
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.2, big: !!w.pellets || impact.headshot, kind: 'flesh', wpn: w.id, dx: dir.x, dy: dir.y, dz: dir.z });
      } else if (bestT < w.range && surfHit) {
        this.impacts.push({ x: hx, y: hy, z: hz, t: 0.25, big: false, kind: 'wall', wpn: w.id, ...surfHit, dx: dir.x, dy: dir.y, dz: dir.z });
      }
    }
  }

  _endMatch() {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.winner = this.scores.A === this.scores.B ? 'DRAW' : (this.scores.A > this.scores.B ? 'A' : 'B');
    // Cinematic slow-mo — trigger ONLY when the match ended by a
    // score reaching the target (i.e. the last kill decided it).
    // Time-expiry endings skip the slow-mo since nothing dramatic
    // just happened.
    const killEnded = this.timeLeft > 0.05;
    if (killEnded) {
      this.slowMoT = 1.8;
    }
    // Also freeze the end-match timer so the scoreboard sequence
    // reads cleanly (see `_updateBots` phase check + input gate).
    this.endedByKill = killEnded;
    this.endT = 0;                       // real seconds since match ended
    if (this.coop) this.coop.sendEvt({ k: 'match_end', winner: this.winner, scores: this.scores });
  }

  // ── Vehicles: entry/exit + driving + per-frame update ───────────
  _handleVehicleInteract(cmd) {
    const m = this.me;
    if (!cmd.interact) return;
    if (m.inCar) {
      // Exit — pop player out next to the door they used, and
      // RESTORE the weapon they were holding before entry (so an AK
      // user who jumped in a car as the driver gets their AK back
      // on exit instead of staying on pistol/tec9).
      const v = this.vehicles.find(x => x.id === m.inCar.id);
      if (v) {
        if (m.inCar.role === 'driver') v.driver = null;
        else v.passenger = null;
        if (!v.driver && !v.passenger) v.team = null;
        // Place player next to the vehicle. Cars pop to ~2.0m from
        // the door; bikes are narrower so 1.2m keeps you close but
        // clear. Perpendicular to the vehicle's yaw so we don't
        // spawn in front of the wheels.
        const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
        const isBike = v.kind === 'dirtbike';
        const side = m.inCar.role === 'driver' ? -1 : 1;
        const off  = isBike ? 1.2 : 2.0;
        // Perpendicular in world-space: (c, -s) is the rightward
        // vector; (-c, s) is the leftward vector.
        m.x = v.x + side * off * c;
        m.z = v.z - side * off * s;
        m.y = 0;
      }
      // Restore pre-entry weapon if it's still owned/has ammo.
      const prev = m.inCar.prevWpnIdx;
      if (prev != null && prev >= 0 && prev < WEAPONS3D.length) {
        const w = WEAPONS3D[prev];
        const a = (m.ammo[prev] | 0) || 0;
        const r = (m.reserve[prev] | 0) || 0;
        if (w && (w.mag == null || a > 0 || r > 0)) {
          m.wpnIdx = prev;
        }
      }
      m.inCar = null;
      return;
    }
    // Find closest vehicle the player is "near" AND has access to.
    // ENTRY POINT rule: must be at driver door, passenger door, or
    // on top of the car. Behind / in front is rejected.
    // BIKES use a single simpler proximity test — no doors.
    const myTeam = m.team;
    let best = null, bestD2 = Infinity;
    let bestAccess = null;     // 'driver_door' | 'passenger_door' | 'on_top' | 'bike'
    for (const v of this.vehicles) {
      if (v.dead) continue;
      // Team-lock: if a teammate is already inside, OK; if an enemy is inside, locked out.
      if (v.team && v.team !== myTeam) continue;
      let access = null;
      if (v.kind === 'dirtbike') {
        if (nearBike(v, m.x, m.z)) access = 'bike';
      } else {
        const ndd = nearDriverDoor(v, m.x, m.z);
        const npd = nearPassengerDoor(v, m.x, m.z);
        const ont = onTopOfCar(v, m.x, m.y, m.z);
        if (ndd) access = 'driver_door';
        else if (npd) access = 'passenger_door';
        else if (ont) access = 'on_top';
      }
      if (!access) continue;
      const dx = v.x - m.x, dz = v.z - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        best = v; bestD2 = d2;
        bestAccess = access;
      }
    }
    if (!best) return;
    const burger = !!cmd.dpadDownHeld && m.hp < 100;
    // Save pre-entry weapon BEFORE _enforceVehicleWeapon may switch it.
    const prevWpnIdx = m.wpnIdx;
    // Seat assignment:
    //   • No driver yet → ALWAYS become driver (regardless of which
    //     entry point — including passenger door per user request).
    //   • Driver is teammate AND we entered at the passenger door
    //     (car) OR simply near a bike → take the passenger seat.
    if (!best.driver) {
      best.driver = 'me';
      best.team = myTeam;
      m.inCar = { id: best.id, role: 'driver', burgerHeal: burger, prevWpnIdx };
      this._enforceVehicleWeapon('driver', best);
    } else if (!best.passenger && (bestAccess === 'passenger_door' || bestAccess === 'bike')) {
      best.passenger = 'me';
      m.inCar = { id: best.id, role: 'passenger', burgerHeal: burger, prevWpnIdx };
      this._enforceVehicleWeapon('passenger', best);
    }
  }

  // Auto-switch the player's weapon when entering a vehicle to satisfy
  // the driver/passenger rules.
  //   Car driver:     pistol OR tec9 only
  //   Car passenger:  anything except fist / baseball bat
  //   Bike driver:    anything except fist / bat / RPG / M32 (bulky
  //                   two-handed launchers need both hands; the
  //                   character rig auto-switches to a 1-hand pose
  //                   for pistol/tec9/uzi and a hip-fire pose for
  //                   longer guns).
  //   Bike passenger: anything except fist / bat
  _enforceVehicleWeapon(role, v) {
    const m = this.me;
    const cur = this.weapon();
    const isFist = cur.id === 'fist';
    const isBat  = cur.id === 'bat';
    const isBike = v && v.kind === 'dirtbike';
    const bikeBulky = new Set(['fist', 'bat', 'rpg', 'm32']);
    const pickFirstOwned = (ids) => {
      for (const id of ids) {
        const idx = WEAPONS3D.findIndex(w => w.id === id);
        if (idx < 0) continue;
        const a = (m.ammo[idx] | 0) || 0;
        const r = (m.reserve[idx] | 0) || 0;
        const w = WEAPONS3D[idx];
        if (w.mag == null || a > 0 || r > 0) return idx;
      }
      return -1;
    };
    if (role === 'driver' && !isBike) {
      // Car driver — pistol/tec9 only.
      if (cur.id === 'pistol' || cur.id === 'tec9') return;
      const idx = pickFirstOwned(['pistol', 'tec9']);
      if (idx >= 0) m.wpnIdx = idx;
      return;
    }
    if (role === 'driver' && isBike) {
      // Bike driver — allow everything except bulky launchers +
      // fists/bat. If current weapon is disallowed, pick the best
      // 1-handed alternative.
      if (!bikeBulky.has(cur.id)) return;
      const idx = pickFirstOwned(['pistol', 'tec9', 'ak47', 'shotgun', 'sniper']);
      if (idx >= 0) m.wpnIdx = idx;
      return;
    }
    // Passenger (car OR bike) — swap fist/bat off, everything else fine.
    if (!isFist && !isBat) return;
    for (let i = 0; i < WEAPONS3D.length; i++) {
      const w = WEAPONS3D[i];
      if (w.id === 'fist' || w.id === 'bat') continue;
      const a = (m.ammo[i] | 0) || 0;
      const r = (m.reserve[i] | 0) || 0;
      if (w.mag == null || a > 0 || r > 0) { m.wpnIdx = i; return; }
    }
  }

  // Drive the car the player is currently in. Arcade physics —
  // forward thrust, A/D steering, optional sharp turn, exterior wall
  // collisions same as on-foot movement.
  _updateMyVehicle(dt, cmd) {
    const m = this.me;
    const v = this.vehicles.find(x => x.id === m.inCar.id);
    if (!v || v.dead) {
      // Car blew up under us — bail out.
      m.inCar = null;
      return;
    }
    const isBike = v.kind === 'dirtbike';
    if (m.inCar.role === 'driver') {
      if (isBike) {
        this._driveDirtBike(v, dt, cmd);
      } else {
        this._driveCar(v, dt, cmd);
      }
    }
    // Glue player to the vehicle. Cars: player centered inside body,
    // camera at car height. Bikes: driver on seat, passenger on the
    // back seat behind them.
    if (isBike) {
      const seat = bikeSeatWorld(v, m.inCar.role);
      m.x = seat.x; m.z = seat.z;
      // Riding height is the seat + a small crouch to keep the
      // camera clear of the tank. Add the hop lift so the rider
      // rises with the bike during a hop.
      m.y = 0.85 + (v.y || 0);
    } else {
      // iter193 — cars now use a proper seat offset so the visible
      // driver sits at the WHEEL, not at the car's centroid. The
      // seat is left+behind for the driver (right+behind for the
      // passenger) so the head pokes up through the seatback.
      const seat = carSeatWorld(v, m.inCar.role);
      m.x = seat.x; m.z = seat.z; m.y = seat.y;
    }
    m.yaw = cmd.yaw;       // independent look — driver/passenger can fire any direction
  }

  // ── Car driving physics (original SR1-style arcade) ─────────────
  _driveCar(v, dt, cmd) {
    const m = this.me;
      // Quota (police trike) is the "special variant" — decent extra
      // punch on top-speed + acceleration since it's a specialty
      // cruiser. Venom (Corvette Stingray) is a sports car — quickest
      // accel, highest top speed, sharpest turning. Otherwise use the
      // standard-car tuning.
      const isQuota = !!v.isQuota;
      const isVenom = !!v.isVenom;
      let accelF, accelR, maxV, sharp;
      if (isVenom) {
        accelF = 32; accelR = 16; maxV = 34;
        // Venom turns tighter: sharpMult 3.4 held vs 1.9 baseline
        // (car baseline is 2.6 vs 1.4 — noticeably twitchier).
        sharp = cmd.sharpTurnHeld ? 3.4 : 1.9;
      } else if (isQuota) {
        accelF = 22; accelR = 14; maxV = 28;
        sharp = cmd.sharpTurnHeld ? 2.6 : 1.4;
      } else {
        accelF = 18; accelR = 12; maxV = 24;
        sharp = cmd.sharpTurnHeld ? 2.6 : 1.4;
      }
      const friction = 3.5;
      // Sports-car steering ramps in faster (0.5 baseline vs 0.3 for
      // standard) so the Venom bites earlier at low speeds.
      const steerBase = isVenom ? 0.5 : 0.3;
      const steerAuthority = Math.min(1, Math.abs(v.speed) / 6 + steerBase);
      // R3 (or KeyL) — edge → toggle red/blue emergency lights on the
      // Quota. Only meaningful for the police variant; harmless for
      // civilian cars (nothing to light up).
      if (cmd.lightsToggle && isQuota) {
        v.emergencyOn = !v.emergencyOn;
        this._feed(`${this.me.name || 'YOU'} ${v.emergencyOn ? 'lit up' : 'killed'} the lights`, v.emergencyOn ? '#3399ff' : '#888');
      }
      // Steering — dedicated cmd.driveSteer (keyboard A/D or gamepad
      // D-pad). Left-stick X is intentionally NOT a steer input.
      v.yaw -= (cmd.driveSteer || 0) * sharp * steerAuthority * dt;
      // Throttle/brake — DEDICATED BUTTONS only. cmd.driveAccel is
      // keyboard-W or gamepad-A; cmd.driveReverse is keyboard-S or
      // gamepad-X. Left-stick Y is intentionally ignored.
      const accel = cmd.driveAccel ? 1 : 0;
      const rev   = cmd.driveReverse ? 1 : 0;
      if (accel) v.speed += accelF * dt;
      else if (rev) v.speed -= accelR * dt;
      else v.speed -= Math.sign(v.speed) * friction * dt;
      v.speed = Math.max(-12, Math.min(maxV, v.speed));
      if (Math.abs(v.speed) < 0.05) v.speed = 0;

      // Move + wall collision — sweep X then Z and revert that axis if
      // it hits a static wall (same approach the on-foot player uses).
      const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      const dx = sn * v.speed * dt;
      const dz = cs * v.speed * dt;
      const tryX = v.x + dx;
      if (!this._carBlocked(tryX, v.z)) v.x = tryX;
      else v.speed *= 0.2;
      const tryZ = v.z + dz;
      if (!this._carBlocked(v.x, tryZ)) v.z = tryZ;
      else v.speed *= 0.2;
      // Arena bounds.
      const H = this.half;
      v.x = Math.max(-H + 3, Math.min(H - 3, v.x));
      v.z = Math.max(-H + 3, Math.min(H - 3, v.z));

      // Vehicular manslaughter — if we ploughed into a pedestrian
      // (any actor, friendly or not) at >= 8 m/s, kill them outright.
      // Speed test prevents idle rollovers from instant-killing.
      if (Math.abs(v.speed) >= 8) {
        for (const a of this._allActors()) {
          if (!a || a.dead) continue;
          if (a.id === (m.id || 'me')) continue;        // can't run yourself over
          const adx = a.x - v.x, adz = a.z - v.z;
          // Rotate into car-local for an oriented test.
          const c2 = Math.cos(-v.yaw), s2 = Math.sin(-v.yaw);
          const lx = adx * c2 - adz * s2;
          const lz = adx * s2 + adz * c2;
          if (Math.abs(lx) <= 1.4 && Math.abs(lz) <= 3.0) {
            this._dealDamage(a, 1000, 'car_runover');
            this._feed(`${this.me.name || 'YOU'} ran over ${a.name || 'a fool'}`, '#ff6a3a');
          }
        }
      }
  }

  // ── Dirt bike driving physics ──────────────────────────────────
  // A dirt bike behaves DIFFERENTLY from a car:
  //   • Snappier acceleration and higher top speed.
  //   • Steering is speed-scaled — at a crawl you turn on a dime,
  //     at speed you carve wide arcs (matches counter-steering IRL).
  //   • WHEELIE:  hold `cmd.sharpTurnHeld` (Shift / LT) while going
  //     forward. Increases `v.wheelieT` towards 1.0 over ~0.5s.
  //     Steering authority drops with wheelieT (front wheel is up →
  //     nothing to steer with) and a wheelie'd bike CAN'T reverse.
  //   • HOP:      tap `cmd.jump` (Space / X). Snaps `v.hopVY` to a
  //     positive value; gravity brings it back down. While airborne
  //     the wheelie decays quickly (arms straighten in mid-air).
  //   • LEAN:     steering * (speed / topSpeed) rolls the body up to
  //     ~30° in the direction of the turn. Fed to vehicles3d's visual
  //     update via `v.leanAngle`.
  _driveDirtBike(v, dt, cmd) {
    const m = this.me;
    const accelF = 30;        // punchier than a car
    const accelR = 12;
    const friction = 4.0;
    const maxV = 26;
    // Steering — snappy at low speed, wide at high speed. Wheelies
    // reduce authority to 30% (front wheel airborne).
    const speedNorm = Math.min(1, Math.abs(v.speed) / maxV);
    const baseSteer = 3.6 * (1.0 - 0.55 * speedNorm);
    const wheelieCut = 1.0 - 0.7 * (v.wheelieT || 0);
    const steer = baseSteer * wheelieCut;
    const steerCmd = (cmd.driveSteer || 0);
    v.yaw -= steerCmd * steer * dt;

    // Throttle/brake.
    const accel = cmd.driveAccel ? 1 : 0;
    const rev   = cmd.driveReverse ? 1 : 0;
    const onGround = (v.y || 0) <= 0.001;
    // Wheelie stops the bike from reversing until released.
    if (accel) v.speed += accelF * dt;
    else if (rev && (v.wheelieT || 0) < 0.15) v.speed -= accelR * dt;
    else v.speed -= Math.sign(v.speed) * friction * dt;
    v.speed = Math.max(-8, Math.min(maxV, v.speed));
    if (Math.abs(v.speed) < 0.05) v.speed = 0;

    // ── Wheelie ─────────────────────────────────────────────────
    // Rules: only while going FORWARD (v.speed > 4), on the ground,
    // AND holding sharpTurn (Shift / LT). Otherwise decays back to 0.
    const canWheelie = onGround && v.speed > 4 && !!cmd.sharpTurnHeld;
    if (canWheelie) {
      v.wheelieT = Math.min(1.0, (v.wheelieT || 0) + dt * 2.2);
    } else {
      // Off-ground decays a bit slower (front wheel drops when landing).
      const decayRate = onGround ? 3.0 : 1.4;
      v.wheelieT = Math.max(0, (v.wheelieT || 0) - dt * decayRate);
    }

    // ── Hop ─────────────────────────────────────────────────────
    // `cmd.jump` is a per-frame edge (Space / X). Snap to +vy on
    // the ground; ignored mid-air so double-taps don't stack.
    if (cmd.jump && onGround) {
      v.hopVY = 7.5;
    }
    // Vertical integration — gravity applied any time we're above
    // the ground plane OR have residual upward velocity.
    if (onGround && (v.hopVY || 0) <= 0 && (v.y || 0) <= 0) {
      v.y = 0;
      v.hopVY = 0;
    } else {
      v.y = (v.y || 0) + (v.hopVY || 0) * dt;
      v.hopVY = (v.hopVY || 0) - 22 * dt;   // gravity: heavier than the player
      if (v.y < 0) { v.y = 0; v.hopVY = 0; }
    }

    // ── Lean ─────────────────────────────────────────────────────
    // Steering * speed normal — bike tilts into turns. Wheelie
    // dampens lean because the rider is standing tall.
    const wantLean = -steerCmd * 0.55 * speedNorm * (1 - (v.wheelieT || 0) * 0.6);
    // Smooth toward the target (~4x per second) so tiny stick jitters
    // don't shake the visual.
    v.leanAngle = (v.leanAngle || 0) + (wantLean - (v.leanAngle || 0)) * Math.min(1, dt * 6);

    // ── Wheel spin ───────────────────────────────────────────────
    // Simple accumulator — ~half a rotation per meter of forward
    // travel. Consumed by vehicles3d for the wheel roll animation.
    v.wheelSpin = (v.wheelSpin || 0) - v.speed * dt * 3.0;

    // ── Move + collision ─────────────────────────────────────────
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    const dx = sn * v.speed * dt;
    const dz = cs * v.speed * dt;
    const tryX = v.x + dx;
    if (!this._bikeBlocked(tryX, v.z)) v.x = tryX;
    else v.speed *= 0.2;
    const tryZ = v.z + dz;
    if (!this._bikeBlocked(v.x, tryZ)) v.z = tryZ;
    else v.speed *= 0.2;
    // Arena bounds — bikes need a touch less padding than cars.
    const H = this.half;
    v.x = Math.max(-H + 2, Math.min(H - 2, v.x));
    v.z = Math.max(-H + 2, Math.min(H - 2, v.z));

    // Ram — bikes at >= 10 m/s can knock people flying (but do NOT
    // instantly kill like cars — they're smaller / lighter). Deals
    // 55 damage on hit which is enough to stagger even a heavy build.
    if (Math.abs(v.speed) >= 10) {
      for (const a of this._allActors()) {
        if (!a || a.dead) continue;
        if (a.id === (m.id || 'me')) continue;
        const adx = a.x - v.x, adz = a.z - v.z;
        const c2 = Math.cos(-v.yaw), s2 = Math.sin(-v.yaw);
        const lx = adx * c2 - adz * s2;
        const lz = adx * s2 + adz * c2;
        if (Math.abs(lx) <= 0.85 && Math.abs(lz) <= 1.4) {
          this._dealDamage(a, 55, 'bike_ram');
          this._feed(`${this.me.name || 'YOU'} ramped ${a.name || 'a fool'}`, '#ff9a3a');
        }
      }
    }
  }

  // Cheap collision test for the bike centre. Uses tighter half-
  // extents than a car and same "must be a TALL collider" gate.
  _bikeBlocked(x, z) {
    const hx = VEHICLE_CONSTS.BIKE_HALF_WIDE || 0.55;
    const hz = VEHICLE_CONSTS.BIKE_HALF_LEN  || 1.20;
    for (const c of this.colliders) {
      if (c.no_bullet) continue;
      if ((c.h || 0) < 1.5) continue;
      if (x + hx < c.x0 || x - hx > c.x1) continue;
      if (z + hz < c.z0 || z - hz > c.z1) continue;
      return true;
    }
    return false;
  }

  // Cheap collision test for the car centre against the arena's
  // static colliders. Uses TIGHT half-extents (matches the actual
  // car body) and only blocks against TALL colliders (walls/
  // buildings — h ≥ 1.5). Cones, low crates and short pickups are
  // intentionally driven through.
  _carBlocked(x, z) {
    const hx = 1.2, hz = 2.6;
    for (const c of this.colliders) {
      // Phantom stair slopes don't obstruct vehicles.
      if (c.no_bullet) continue;
      if ((c.h || 0) < 1.5) continue;                  // skip cones, low crates, etc.
      if (x + hx < c.x0 || x - hx > c.x1) continue;
      if (z + hz < c.z0 || z - hz > c.z1) continue;
      return true;
    }
    return false;
  }

  // Per-frame visual update + 10s respawn ticking.
  _updateVehicles(dt) {
    for (const v of this.vehicles) updateVehicleVisuals(v, dt);
  }

  // Restricted combat loop while in a car.  Driver can fire pistol/
  // tec9 only; passenger can fire anything except fists/bat. Weapon
  // slot switching is filtered to the same rules. Reload still works.
  // Movement, jumping, melee, crouching, taunts, etc. are all NO-OPs.
  // ON A BIKE the driver may use any 1-handed friendly weapon (all
  // except fist/bat/rpg/m32 — see _enforceVehicleWeapon).
  _updateInCarCombat(dt, cmd, camRay) {
    const m = this.me;
    const role = m.inCar.role;
    const v = this.vehicles.find(x => x.id === m.inCar.id);
    const isBike = v && v.kind === 'dirtbike';
    const bikeBulky = new Set(['fist', 'bat', 'rpg', 'm32']);
    const allowed = (wid) => {
      if (role === 'driver') {
        if (isBike) return !bikeBulky.has(wid);
        return wid === 'pistol' || wid === 'tec9';
      }
      return wid !== 'fist' && wid !== 'bat';
    };

    // Weapon-slot switch — filter to allowed weapons only.
    if (
      cmd.slotRequest >= 0 &&
      cmd.slotRequest < WEAPONS3D.length &&
      cmd.slotRequest !== m.wpnIdx &&
      m.swapT <= 0
    ) {
      const want = WEAPONS3D[cmd.slotRequest];
      if (want && allowed(want.id)) {
        const owns = want.mag == null
          || (m.ammo[cmd.slotRequest] | 0) > 0
          || (m.reserve && (m.reserve[cmd.slotRequest] | 0) > 0);
        if (owns) { m.wpnIdx = cmd.slotRequest; m.swapT = 0.15; }
      }
    }

    // Reload tick — same shape as on-foot.
    const w = this.weapon();
    if (m.reloadT > 0) {
      m.reloadT -= dt;
      if (m.reloadT <= 0 && w.mag != null) {
        const need = w.mag - m.ammo[m.wpnIdx];
        const have = m.reserve[m.wpnIdx] | 0;
        const take = Math.min(need, have);
        m.ammo[m.wpnIdx] += take;
        m.reserve[m.wpnIdx] -= take;
      }
    } else if (cmd.reload && w.mag != null && m.ammo[m.wpnIdx] < w.mag && (m.reserve[m.wpnIdx] | 0) > 0) {
      m.reloadT = w.reload || 1.6;
      this._playReload(w);
    }

    // Fire — only if current weapon is allowed for our seat role.
    m.firing = false;
    if (cmd.fire && allowed(w.id) && m.reloadT <= 0 && this.phase === 'play') {
      m.firing = true;
      if (w.mag != null && m.ammo[m.wpnIdx] <= 0) {
        if (!m._lastEmpty) { playEmpty(); m._lastEmpty = true; }
      } else {
        m._lastEmpty = false;
        m._lastShotT ??= 0;
        if (this.t - m._lastShotT >= (w.cd || 0.18)) {
          m._lastShotT = this.t;
          if (w.mag != null) m.ammo[m.wpnIdx] = Math.max(0, m.ammo[m.wpnIdx] - 1);
          this._shoot(w, camRay);    // same damage path as on-foot
        }
      }
    }
  }

  // ── King of the Hill update ──────────────────────────────────────
  // Every frame:
  //   1) Count alive players (me + remotes + bots) inside the hill
  //      circle, by team.
  //   2) Resolve controller:
  //        both teams inside  → contested (no points awarded)
  //        only A inside      → controller='A', tick scores.A
  //        only B inside      → controller='B', tick scores.B
  //        neither inside     → controller=null (no points)
  //   3) Only the authority actually mutates scores; non-authority
  //      mirrors via the standard state snapshot (s.scores).
  _updateHill(dt) {
    const h = this.hill;
    if (!h) return;
    const r2 = h.radius * h.radius;
    // Require players to be standing ON TOP of the hill mesh (not
    // just inside its ground XZ radius). `h.topY` is stamped by
    // Brawl3DGame.jsx once the KOTH GLB loads + its climbable
    // collider is installed. Threshold is topY − 0.35 so a small
    // hop / animation dip on top still counts.
    const yThresh = (h.topY != null) ? (h.topY - 0.35) : 0.4;
    let aCount = 0, bCount = 0;

    const tally = (a) => {
      if (!a || a.dead) return;
      const team = a.team;
      if (team !== 'A' && team !== 'B') return;
      const fx = a.x - h.x, fz = a.z - h.z;
      if (fx * fx + fz * fz > r2) return;
      if ((a.y || 0) < yThresh) return;   // must be elevated onto the mesh
      if (team === 'A') aCount++; else bCount++;
    };

    tally(this.me);
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) {
        const s = rp.latest;
        if (!s) continue;
        tally({ x: s.x, y: s.y, z: s.z, dead: s.dead, team: rp.team || s.team });
      }
    }
    const botSrc = this.isAuthority ? this.bots.values() : this.remoteBots.values();
    for (const b of botSrc) tally(b);

    if (aCount > 0 && bCount > 0) {
      h.contested = true;
      h.controller = null;
    } else if (aCount > 0) {
      h.contested = false;
      h.controller = 'A';
      if (this.isAuthority) this.scores.A += this.HILL_SCORE_RATE * dt;
    } else if (bCount > 0) {
      h.contested = false;
      h.controller = 'B';
      if (this.isAuthority) this.scores.B += this.HILL_SCORE_RATE * dt;
    } else {
      h.contested = false;
      h.controller = null;
    }
  }

  // ── Coop event drain ─────────────────────────────────────────────
  _drainCoop() {
    const evs = this.coop.drainEvents();
    for (const ev of evs) {
      switch (ev.type) {
        case 'roster':
          // Adopt my online identity once the welcome lands.
          if (this.coop.id && this.me.id !== this.coop.id) {
            this.me.id = this.coop.id;
            this.me.name = this.coop.display || this.me.name;
            this.me.gangTag = this.coop.gangTag;
          }
          this._rebuildTeams();
          this._feed(ev.text || 'roster changed', '#a3a3a3');
          break;
        case 'lobby_meta': {
          // Ranked Gang-vs-Gang lobbies stamp the actual gang names
          // onto the HUD scorebar via teamNames.
          const meta = ev.lobby && ev.lobby.ranked_meta;
          if (meta && meta.gangs) {
            this.teamNames = {
              A: (meta.gangs.A && (meta.gangs.A.gang_name || meta.gangs.A.gang_tag)) || 'SAINTS',
              B: (meta.gangs.B && (meta.gangs.B.gang_name || meta.gangs.B.gang_tag)) || 'ROLLERZ',
            };
          }
          break;
        }
        case 'hit':
          this.applyDamageToMe(ev.damage, ev.fromName, ev.fromId, ev.fromTeam, ev.weaponId, ev.impact);
          break;
        case 'evt': {
          const d = ev.d || {};
          if (d.k === 'rdy') {
            // A player finished loading. If the match already started
            // (late joiner) the host re-broadcasts the start so they
            // drop straight into the countdown instead of waiting.
            if (this.isAuthority && this.phase !== 'waiting' && this.coop) this.coop.sendEvt({ k: 'go', s: 5 });
          } else if (d.k === 'go') {
            if (this.phase === 'waiting' && !this.holdStart) {
              if (this.localReady) this.startCountdown(d.s || 5);
              else { this._pendingGo = true; this._pendingGoSecs = d.s || 5; }
            }
          } else if (d.k === 'tr') {
            this.tracers.push({ ax: d.ax, ay: d.ay, az: d.az, bx: d.bx, by: d.by, bz: d.bz, t: 0.09 });
            // Terminal impact so the client-side spark burst kicks off
            // for other players' shots too — otherwise remotes see
            // muzzle flash but no impact spark. `s` carries the surface
            // the shooter resolved (+ face normal) for matching VFX.
            const dl = Math.hypot(d.bx - d.ax, d.by - d.ay, d.bz - d.az) || 1;
            this.impacts.push(d.s != null
              ? { x: d.bx, y: d.by, z: d.bz, t: 0.2, big: false, kind: 'wall', surf: surfaceFromCode(d.s), nx: d.nx || 0, ny: d.ny || 0, nz: d.nz || 0, dx: (d.bx - d.ax) / dl, dy: (d.by - d.ay) / dl, dz: (d.bz - d.az) / dl }
              : { x: d.bx, y: d.by, z: d.bz, t: 0.2, big: false });
            // Spatial weapon SFX at the SHOOTER's position so distant
            // gunfire fades naturally and stereo-pans to the source.
            this._playWeaponAt(d.w || 'pistol', d.ax, d.ay, d.az);
          } else if (d.k === 'rkt') {
            this.rockets.push({ x: d.x, y: d.y, z: d.z, vx: d.dx * d.sp, vy: d.dy * d.sp, vz: d.dz * d.sp, owner: ev.from, team: 'X', t: d.f || 6, mine: false, gravity: !!d.g, fuse: d.f || 0, wpnId: d.w || 'rpg' });
            // Launch sfx at the shooter's position for the remote
            // listener (explosions still play at impact via _explode).
            this._playWeaponAt(d.w || 'rpg', d.x, d.y, d.z);
          } else if (d.k === 'rld') {
            const rp = this.coop.remotes.get(ev.from);
            const s = rp && rp.latest;
            if (s) playReloadAt(d.w || 'pistol', s.x || 0, (s.y || 0) + 1.2, s.z || 0);
          } else if (d.k === 'bhit') {
            if (this.isAuthority) {
              const rp = this.coop.remotes.get(ev.from);
              this._damageBot(this.bots.get(d.bid), d.dmg, ev.from, d.name || (rp ? rp.display : '??'), rp ? rp.team : 'B', d.w, d.imp);
            }
          } else if (d.k === 'ci') {
            // Corpse impulse — a remote slapped/kicked a dead body.
            // Queue the impulse on whichever local actor matches so
            // the ragdoll picks it up on the next drive() tick.
            const tid = d.tid;
            const imp = d.imp;
            if (tid && imp) {
              const b = this.bots.get(tid) || this.remoteBots.get(tid);
              if (b && b.dead) {
                b.pendingRagdollImpulses = b.pendingRagdollImpulses || [];
                b.pendingRagdollImpulses.push(imp);
              }
              // For remote human players, the view3d ragdoll driver
              // reads `pendingRagdollImpulses` off `rp` (see view3d.js).
              // Coop3d attaches these via the state feed's `ri` field.
              // Here we just tag it locally in case the player is us —
              // slapping ourselves during death would be esoteric but
              // valid.
              if (this.me.dead && tid === (this.me.id || 'me')) {
                this.me.pendingRagdollImpulses = this.me.pendingRagdollImpulses || [];
                this.me.pendingRagdollImpulses.push(imp);
              }
              // Also stash on remotes so view3d picks it up.
              const rp = this.coop && this.coop.remotes.get(tid);
              if (rp) {
                rp.pendingRagdollImpulses = rp.pendingRagdollImpulses || [];
                rp.pendingRagdollImpulses.push(imp);
              }
            }
          } else if (d.k === 'bdeath') {
            if (!this.isAuthority) {
              const b = this.remoteBots.get(d.bid);
              if (b && d.di) {
                // Non-authority mirror: apply the incoming deathImpulse
                // so the client-side ragdoll animates the exact same
                // flight the authority saw.
                b.deathImpulse = d.di;
              }
              // Log the death spot as a hotspot even on non-authority
              // clients — smart spawn scoring uses the local player's
              // hotspot list for their own respawn.
              if (b) this._registerHotspot(b.x, b.z);
              const tk = d.kt === (d.bt || (b && b.team));
              if (!tk && (d.kt === 'A' || d.kt === 'B')) this.scores[d.kt]++;
              if (!tk) this._creditKill(d.kid);
              this._killFeedKill({
                killerName: d.kn, killerTeam: d.kt, killerId: d.kid,
                victimName: b ? b.name : d.bid, victimTeam: d.bt || (b && b.team) || 'B',
                victimId: d.bid,
                weaponId: d.w || 'pistol',
                teamkill: tk,
              });
            }
          } else if (d.k === 'death') {
            // someone died — credit + scoreboard (their own state shows dead)
            // Also fold their deathImpulse onto the remote roster so
            // this client's ragdoll spawns with the authored knockback.
            if (this.coop && d.di) {
              const rp = this.coop.remotes.get(d.vid || ev.from);
              if (rp) rp.deathImpulse = d.di;
            }
            // Remote-player death hotspot for smart spawn logic.
            if (this.coop) {
              const rp = this.coop.remotes.get(d.vid || ev.from);
              const s = rp && rp.latest;
              if (s) this._registerHotspot(s.x, s.z);
            }
            const tk = d.kt === d.vt;
            if (!tk && (d.kt === 'A' || d.kt === 'B')) this.scores[d.kt]++;
            if (!tk) this._creditKill(d.kid);
            this._killFeedKill({
              killerName: d.kn, killerTeam: d.kt, killerId: d.kid,
              victimName: d.vn, victimTeam: d.vt,
              victimId: d.vid || ev.from,
              weaponId: d.w || 'pistol',
              teamkill: tk,
            });
          } else if (d.k === 'pup') {
            // Remote player grabbed a world pickup → mark it
            // unavailable on this client. Ephemeral drops are removed
            // entirely (no respawn).
            const p = this.pickups.find(x => x.id === d.id);
            if (p && p.available) {
              if (d.eph || p.ephemeral) {
                this.pickups = this.pickups.filter(x => x.id !== d.id);
              } else {
                p.available = false;
                p.respawnT = this.PICKUP_RESPAWN;
              }
            }
          } else if (d.k === 'drop') {
            // Remote actor died and dropped their weapon.
            if (!this.pickups.find(x => x.id === d.id)) {
              this.pickups.push({
                id: d.id, wpn: d.w, x: d.x, y: 0.6, z: d.z,
                ammo: d.a || 1, available: true, ephemeral: true,
                expireT: this.DROP_LIFE,
              });
            }
          } else if (d.k === 'match_end') {
            this.phase = 'end';
            this.winner = d.winner;
            if (d.scores) this.scores = d.scores;
          }
          break;
        }
        default:
          break;
      }
    }
    // Mirror host-authored bots + scores for non-authority clients.
    if (!this.isAuthority && this.coop.hostId) {
      const host = this.coop.remotes.get(this.coop.hostId);
      const s = host && host.latest;
      if (s && Array.isArray(s.bots)) {
        const seen = new Set();
        for (const bs of s.bots) {
          seen.add(bs.id);
          const prev = this.remoteBots.get(bs.id) || {};
          // Regenerate the deterministic build for non-authority bots
          // from the id (host doesn't send the full build dict to
          // save bandwidth). Falls back to a default-shaped clone.
          if (!prev.build) {
            const i = parseInt(String(bs.id).split('_')[1], 10) || 0;
            try { prev.build = makeBot(i, bs.team).build; } catch { prev.build = null; }
          }
          this.remoteBots.set(bs.id, { ...prev, ...bs, bot: true, build: prev.build });
        }
        for (const id of [...this.remoteBots.keys()]) if (!seen.has(id)) this.remoteBots.delete(id);
        if (s.scores) this.scores = s.scores;
        if (s.tl != null) this.timeLeft = s.tl;
        if (s.hill && this.hill) {
          this.hill.controller = s.hill.c || null;
          this.hill.contested = !!s.hill.ct;
        }
      }
    }
  }

  // Scoreboard rows for the HUD.
  scoreboard() {
    const kt = this.killTracker;
    const row = (base) => {
      const st = kt.stats(base.id);
      const score = (base.kills | 0) * 100 + st.best * 10;
      return { ...base, streak: st.cur, best: st.best, score, kd: base.deaths > 0 ? base.kills / base.deaths : base.kills };
    };
    const rows = [row({
      id: this.me.id || 'me', name: this.me.name, team: this.me.team, gangTag: this.me.gangTag || null,
      kills: this.me.kills, deaths: this.me.deaths, me: true, bot: false, dead: !!this.me.dead, ready: !!this.localReady,
    })];
    if (this.coop) {
      for (const rp of this.coop.remotes.values()) {
        const s = rp.latest || {};
        rows.push(row({ id: rp.id, name: rp.display, team: rp.team || s.team || 'B', gangTag: rp.gangTag || null, kills: s.kills || 0, deaths: s.deaths || 0, bot: false, dead: !!s.dead, ready: !!rp.ready }));
      }
    }
    const botSrc = this.isAuthority ? this.bots.values() : this.remoteBots.values();
    for (const b of botSrc) {
      rows.push(row({ id: b.id, name: `[BOT] ${b.name}`, team: b.team, kills: b.kills || 0, deaths: b.deaths || 0, bot: true, dead: !!b.dead, ready: true }));
    }
    rows.sort((a, b2) => (b2.score - a.score) || (b2.kills - a.kills) || (a.deaths - b2.deaths));
    let mvp = null;
    for (const r of rows) if (r.score > 0 && (!mvp || r.score > mvp.score)) mvp = r;
    if (mvp) mvp.mvp = true;
    return rows;
  }
}