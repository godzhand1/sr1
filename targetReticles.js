// Team Gangsta Brawl — AAA target reticles.
//
// ⚠️  DISABLED per user request. The module ships intact so the
// feature can be flipped back on with a single-line change in
// Brawl3DGame.jsx (uncomment the `drawTargetReticles(...)` call in
// the frame loop AND uncomment its import). See iter 189 in PRD.md
// for the design details.
//
// Draws a small bracketed reticle over the player currently under
// the crosshair. Colour codes:
//   RED   — enemy (opposite team)
//   BLUE  — teammate (same team, random matched)
//   GREEN — squad member (same source lobby → partied up)
//
// UX rules the user asked for:
//   • Appears when the aim is on a player.
//   • Fades out when idle (no target under crosshair).
//   • Smooth fade in/out — no jarring pop.
//
// The reticle is drawn on the shared 2D HUD canvas that already
// carries the mini-map + health dial (see Brawl3DGame's loop).

import * as THREE from 'three';

// Colours (AAA convention).
const COLOR_ENEMY    = { r: 239, g:  68, b:  68 };   // rose-500
const COLOR_TEAM     = { r:  59, g: 130, b: 246 };   // blue-500
const COLOR_SQUAD    = { r:  34, g: 197, b:  94 };   // green-500

// Fraction of the smaller viewport dimension — reticles fade as
// targets drift beyond this radius from screen centre.
const CONE_RADIUS_FRAC = 0.18;

// Per-actor smoothed alpha lives on the engine so we can persist
// across frames (fade-out survives the target leaving the cone).
function _fadeMap(engine) {
  if (!engine._reticleFade) engine._reticleFade = new Map();
  return engine._reticleFade;
}

const _tmpVec = new THREE.Vector3();

// Build the render list once per frame from all live remote / bot
// actors. Local player is never a target on their own HUD.
function _collectActors(engine) {
  const list = [];
  if (engine.coop) {
    for (const rp of engine.coop.remotes.values()) {
      const s = rp.latest;
      if (!s || s.dead) continue;
      list.push({
        id: rp.id,
        x: s.x, y: s.y, z: s.z,
        team: rp.team || s.team,
        sourceLobbyId: rp.sourceLobbyId || null,
      });
    }
  }
  const botSrc = engine.isAuthority ? engine.bots.values() : engine.remoteBots.values();
  for (const b of botSrc) {
    if (b.dead) continue;
    list.push({
      id: b.id,
      x: b.x, y: b.y, z: b.z,
      team: b.team,
      sourceLobbyId: null,
    });
  }
  return list;
}

// Corner-bracket reticle — 4 L-shaped ticks around a square, with a
// centre dot for the primary (aim-locked) target. Emits with an
// additive shadow so the colour reads on any background.
function _drawBracket(ctx, x, y, size, color, alpha, primary) {
  const a = Math.max(0, Math.min(1, alpha));
  if (a < 0.02) return;
  const rgba = (mult = 1) => `rgba(${color.r},${color.g},${color.b},${(a * mult).toFixed(3)})`;
  const s = size;
  const g = s * 0.55;     // half-width of the bounding box
  const arm = s * 0.32;   // length of each L-arm

  ctx.save();
  ctx.strokeStyle = rgba(1);
  ctx.fillStyle   = rgba(1);
  ctx.lineWidth   = primary ? 2.4 : 1.6;
  ctx.lineCap     = 'round';
  ctx.shadowBlur  = primary ? 14 : 7;
  ctx.shadowColor = rgba(0.85);

  ctx.beginPath();
  // Top-left
  ctx.moveTo(x - g, y - g + arm); ctx.lineTo(x - g, y - g); ctx.lineTo(x - g + arm, y - g);
  // Top-right
  ctx.moveTo(x + g - arm, y - g); ctx.lineTo(x + g, y - g); ctx.lineTo(x + g, y - g + arm);
  // Bottom-right
  ctx.moveTo(x + g, y + g - arm); ctx.lineTo(x + g, y + g); ctx.lineTo(x + g - arm, y + g);
  // Bottom-left
  ctx.moveTo(x - g + arm, y + g); ctx.lineTo(x - g, y + g); ctx.lineTo(x - g, y + g - arm);
  ctx.stroke();

  // Centre pip for the primary target — draws attention to the
  // currently-locked victim (aimStickyId).
  if (primary) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw AAA target reticles on the HUD canvas.
 *
 *   ctx     — the 2D context of the HUD canvas.
 *   engine  — Brawl3DEngine instance (reads me/coop/bots/aimStickyId).
 *   camera  — THREE.Camera used to project world → clip → screen.
 *   w, h    — HUD canvas pixel dimensions.
 *   dt      — seconds since last call (drives the fade envelope).
 */
export function drawTargetReticles(ctx, engine, camera, w, h, dt) {
  if (!engine || !engine.me || engine.me.dead) return;
  const actors = _collectActors(engine);
  if (!actors.length) return;

  const fadeMap  = _fadeMap(engine);
  const mySource = engine.coop ? engine.coop.sourceLobbyId : null;
  const stickyId = engine.aimStickyId;
  const cx = w * 0.5, cy = h * 0.5;
  const coneR = Math.min(w, h) * CONE_RADIUS_FRAC;
  const coneR2 = coneR * coneR;

  // Fade-in is snappier than fade-out — feels reactive without popping.
  const FADE_IN  = 8;
  const FADE_OUT = 3.2;

  // Track which actor ids we've touched this frame so stale entries
  // in the fade map can be culled (respawns, disconnects, etc.).
  const touched = new Set();

  for (const a of actors) {
    _tmpVec.set(a.x, a.y + 1.15, a.z);   // chest sample
    _tmpVec.project(camera);
    // Cull anything behind the camera or well outside the frustum.
    if (_tmpVec.z < -1 || _tmpVec.z > 1) continue;
    const sx = (_tmpVec.x * 0.5 + 0.5) * w;
    const sy = (1 - (_tmpVec.y * 0.5 + 0.5)) * h;
    if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;

    // Screen-space distance from centre determines the aim proximity.
    const dxs = sx - cx, dys = sy - cy;
    const dist2 = dxs * dxs + dys * dys;
    const inCone = dist2 <= coneR2;

    // Target alpha:
    //   • Primary sticky target → always full brightness while acquired.
    //   • Others → falls off with distance from screen centre (squared).
    let target = 0;
    if (inCone) {
      const t = 1 - Math.sqrt(dist2) / coneR;
      target = t * t;
      if (a.id === stickyId) target = Math.max(target, 0.95);
    }

    // Smoothed envelope — persistent across frames for a natural
    // fade-out when the target leaves the cone / dies.
    let cur = fadeMap.get(a.id) || 0;
    const rate = target > cur ? FADE_IN : FADE_OUT;
    cur += (target - cur) * Math.min(1, rate * dt);
    fadeMap.set(a.id, cur);
    touched.add(a.id);
    if (cur < 0.02) continue;

    // Relationship → colour.
    const foe = a.team !== engine.me.team;
    const squad = !foe && mySource && a.sourceLobbyId && a.sourceLobbyId === mySource;
    const color = foe ? COLOR_ENEMY : (squad ? COLOR_SQUAD : COLOR_TEAM);

    // Size grows slightly for the primary lock so it "pops" among
    // any other actors that happen to sit inside the cone.
    const primary = a.id === stickyId;
    const size = primary ? 30 : 22;
    _drawBracket(ctx, sx, sy, size, color, cur, primary);
  }

  // Cull faded/removed entries so the map doesn't leak over a long match.
  for (const id of Array.from(fadeMap.keys())) {
    if (touched.has(id)) continue;
    const cur = fadeMap.get(id);
    const decayed = cur * Math.max(0, 1 - FADE_OUT * dt);
    if (decayed < 0.02) fadeMap.delete(id);
    else fadeMap.set(id, decayed);
  }
}
