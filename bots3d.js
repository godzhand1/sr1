// Team Gangsta Brawl — bot AI.  Bots are simulated only by the match
// authority (offline player or lobby host) and broadcast to others
// inside the host's state packet.  Simple street-thug brain: roam,
// engage nearest enemy with line of sight, strafe, shoot with spray.
import { WEAPONS3D, WEAPON_INDEX } from './weapons3d.js';

export const BOT_NAMES = [
  'Vato Loco', 'Lil Smoke', 'Trigger', 'Chuco', 'Eightball', 'Casper',
  'Droopy', 'Sleepy', 'Maniac', 'Shadow', 'Flaco', 'mewtwo',
];

const BOT_GUNS = ['pistol', 'tec9', 'shotgun', 'ak47', 'pipebomb'];

// Deterministic per-bot dressing palette so each bot ID always wears
// the same outfit (no flicker between frames if the build object is
// rebuilt). Picks from a small set of plausible street-thug looks.
const BOT_SHIRTS  = ['#2746a7', '#15803d', '#b91c1c', '#eab308', '#7c3aed', '#e8e8e8', '#1f2937'];
const BOT_PANTS   = ['#15151c', '#1e293b', '#3f3f46', '#1f1f2a'];
const BOT_HATS    = ['off', 'straight', 'back', 'side', 'off', 'off'];     // mostly no hat
const BOT_GLASSES = ['none', 'none', 'aviator', 'shades', 'none'];

// Vanilla SR clothing OBJ ids each NPC wears — real 3D meshes layered
// on top of pc_body via the SLOT_META pipeline. Variety arrays keep
// the streets visually diverse: every bot ships a t-shirt + trackpants
// + boxers + socks + shoes by default (per the player's request to
// place real clothing geometry on NPCs, not just vertex-color zones).
const BOT_SR_SHIRTS = [
  'cunds_tshirt_cl', 'covrs_polo_cl', 'cunds_tanktop_cl',
  'covrs_basketbjers_sh', 'covrs_baseballjrb_op',
  'covrs_pullovrrnek_cl', 'covrs_workshirtss_op',
];
const BOT_SR_PANTS  = [
  'cbotm_trackpants_nl', 'cbotm_trackpants_bl', 'cbotm_trackpants_ll',
  'cbotm_sweatpants_nl', 'cbotm_canvaspants_bl', 'cbotm_drsbagypant_ll',
];
const BOT_SR_SHOES  = ['cshoe_addidas', 'cshoe_basketball', 'cshoe_canvas', 'cshoe_timberland'];
const BOT_SR_SOCKS  = ['csock_medium', 'csock_low', 'csock_high'];

function pick(arr, seed, salt) {
  // 16807 = 7^5 happens to be 0 mod 7, which collapses pick variety
  // when arr.length is 7. Use 1664525 (Numerical Recipes) instead.
  let h = (seed * 1664525 + salt * 1013904223) | 0;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35 | 0;
  h = h ^ (h >>> 16);
  return arr[Math.abs(h) % arr.length];
}

// Build a per-bot character config matching the streetfight 3D
// character-builder shape so the existing skinning pipeline dresses
// them up (chain, jacket, shirt, pants, shoes, hat).
function botBuild(i) {
  const seed = i * 31 + 7;
  const female = (seed % 3) === 0;       // ~33% women
  const skin = ['#cb9466', '#a66f44', '#e9c39a', '#7a4827'][Math.abs(seed) % 4];
  // Vanilla SR clothing OBJs — real 3D meshes layered onto pc_body.
  const srWear = {
    srShirt:  pick(BOT_SR_SHIRTS, seed, 11),
    srPants:  pick(BOT_SR_PANTS,  seed, 12),
    srShoes:  pick(BOT_SR_SHOES,  seed, 13),
    srSocks:  pick(BOT_SR_SOCKS,  seed, 14),
    srBoxers: 'boxers',
  };
  const shared = {
    gender: female ? 'female' : 'male',
    skinHex: skin,
    bodyBuild: ['avg', 'thick', 'lean'][Math.abs(seed) % 3],
    facePreset: 'sharp', eyeColor: 'brown',
    hairStyle: 'fade',
    glasses: pick(BOT_GLASSES, seed, 5),
    hatStyle: 'none',
    ...srWear,
  };
  if (female) {
    return {
      ...shared,
      fHairHex: '#1a1a22',
      fBandanaOn: false, fCapMode: pick(BOT_HATS, seed, 1), fCapHex: pick(BOT_SHIRTS, seed, 9),
      fChainOn: true,
      fShirtOn: true, fShirtHex: pick(BOT_SHIRTS, seed, 2),
      fBraOn: true, fBraHex: '#e8e8e8',
      fThongOn: true, fThongHex: pick(BOT_PANTS, seed, 4),
      fPantsOn: true, fPantsHex: pick(BOT_PANTS, seed, 3),
      fSocksOn: true, fShoesOn: true, fShoesHex: '#e8e8e8',
      fBoobs: 'med',
    };
  }
  return {
    ...shared,
    mHairHex: '#1c1c22',
    mBandanaOn: (seed % 5) === 0, mBandanaHex: pick(BOT_SHIRTS, seed, 1),
    mCapMode:   pick(BOT_HATS, seed, 1), mCapHex: pick(BOT_SHIRTS, seed, 8),
    mChainOn:   true,
    mJacketOn:  (seed % 2) === 0, mJacketHex: pick(BOT_SHIRTS, seed, 6),
    mShirtOn:   true,  mShirtHex: pick(BOT_SHIRTS, seed, 2),
    mUnderOn:   true,  mUnderHex: '#e8e8e8',
    mSag:       (seed % 2) === 0 ? 'below' : 'none',
    mBoxersHex: pick(BOT_SHIRTS, seed, 7),
    mPantsHex:  pick(BOT_PANTS, seed, 3),
    mSocksOn:   true, mShoesOn: true, mShoesHex: '#e8e8e8',
  };
}

export function makeBot(i, team) {
  return {
    id: `bot_${i}`,
    bot: true,
    name: `${BOT_NAMES[i % BOT_NAMES.length]}`,
    team,
    build: botBuild(i),
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0,
    hp: 100, dead: false, deadT: 0, respawnT: 0,
    wpn: BOT_GUNS[i % BOT_GUNS.length],
    kills: 0, deaths: 0,
    moving: 0, firing: false, crouch: false,
    // brain
    wp: null,           // roam waypoint {x,z}
    fireT: 0, strafeDir: 1, strafeT: 0, seed: i * 7919 + 13,
  };
}

function rand(bot) {
  bot.seed = (bot.seed * 1103515245 + 12345) & 0x7fffffff;
  return bot.seed / 0x7fffffff;
}

// Does the segment a→b clear all colliders? (XZ check vs boxes that are
// taller than shoulder height.)
function clearLine(colliders, ax, az, bx, bz, ay = 0, by = 0) {
  for (const c of colliders) {
    // Phantom stair slopes (`no_bullet`) are invisible movement
    // guides — they don't block bot sight lines.
    if (c.no_bullet) continue;
    // Imported SR chunk grid — march the shoulder-height segment.
    if (c.grid) {
      if (c.grid.segmentHit(ax, (ay || 0) + 1.4, az, bx, (by || 0) + 1.4, bz) !== Infinity) return false;
      continue;
    }
    if (c.h < 1.2) continue;
    // Liang-Barsky style quick reject per axis.
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (
      clip(-dx, ax - c.x0) && clip(dx, c.x1 - ax) &&
      clip(-dz, az - c.z0) && clip(dz, c.z1 - az)
    ) {
      if (t0 < t1) return false;   // segment passes through the box
    }
  }
  return true;
}

// One brain step.  `actors` = every living thing incl. the local player
// shaped {id, team, x, z, dead}.  Returns a "want" command the engine
// physics applies (move dir, fire, target).
export function botThink(bot, actors, colliders, dt, half = 60) {
  if (bot.dead) return null;
  bot.fireT = Math.max(0, bot.fireT - dt);
  bot.strafeT -= dt;
  if (bot.strafeT <= 0) {
    bot.strafeDir = rand(bot) < 0.5 ? -1 : 1;
    bot.strafeT = 0.8 + rand(bot) * 1.4;
  }

  // Nearest visible enemy.
  let target = null, bestD = Infinity;
  for (const a of actors) {
    if (a.dead || a.team === bot.team || a.id === bot.id) continue;
    const d = Math.hypot(a.x - bot.x, a.z - bot.z);
    if (d < bestD && d < 55 && clearLine(colliders, bot.x, bot.z, a.x, a.z, bot.y, a.y)) {
      bestD = d; target = a;
    }
  }

  const w = WEAPONS3D[WEAPON_INDEX[bot.wpn]];
  const out = { mvx: 0, mvz: 0, fire: false, target: null };

  if (target) {
    bot.wp = null;
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    bot.yaw = Math.atan2(-dx, -dz);   // face target (model -Z forward convention)
    const ideal = bot.wpn === 'shotgun' ? 9 : 16;
    if (d > ideal + 4) { out.mvx = dx / d; out.mvz = dz / d; }
    else if (d < ideal - 4) { out.mvx = -dx / d; out.mvz = -dz / d; }
    else {
      // strafe around the target
      out.mvx = (-dz / d) * bot.strafeDir;
      out.mvz = (dx / d) * bot.strafeDir;
    }
    if (d < w.range && bot.fireT <= 0) {
      out.fire = true;
      out.target = target;
      if (w.auto) {
        // Human-like bursts: 3–6 rounds at weapon cadence, then a
        // re-aim pause. Veterans burst longer and pause shorter.
        const skill = bot.skill == null ? 0.5 : bot.skill;
        if (!bot.burstLeft) bot.burstLeft = 3 + Math.floor(rand(bot) * (2 + skill * 3));
        bot.burstLeft -= 1;
        bot.fireT = bot.burstLeft > 0 ? w.cooldown : w.cooldown + 0.45 + (1 - skill) * 0.7 + rand(bot) * 0.3;
      } else {
        bot.fireT = w.cooldown * (1.25 + rand(bot) * 1.0);   // bots fire a bit slower than humans
      }
    }
    bot.moving = 1;
    bot.firing = out.fire;
  } else {
    bot.firing = false;
    // Roam to a random waypoint.
    if (!bot.wp || Math.hypot(bot.wp.x - bot.x, bot.wp.z - bot.z) < 3) {
      bot.wp = {
        x: (rand(bot) * 2 - 1) * (half - 12),
        z: (rand(bot) * 2 - 1) * (half - 12),
      };
    }
    const dx = bot.wp.x - bot.x, dz = bot.wp.z - bot.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    out.mvx = dx / d; out.mvz = dz / d;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.moving = 0.7;
  }
  return out;
}
