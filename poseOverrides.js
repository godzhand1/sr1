// Pose-lab overrides — client cache + REST helpers.
//
// The /pose-lab dev tool writes { pose, weapon, tune } records to the
// backend. In-game characters (view3d.js) call `applyPoseOverride()`
// AFTER every animate() frame to apply the matching delta so what
// the user tuned in the lab is what they see mid-match.
//
// Rule: the RIG mutations mirror the pose-lab overlay exactly — same
// knob set, same axes. Keeping them here (rather than duplicating in
// each caller) is the single source of truth for what a "pose" means.

const API = process.env.REACT_APP_BACKEND_URL;

// Shared in-memory cache — Map<`${pose}:${weapon}`, tuneObject>.
const CACHE = new Map();
let _loadedOnce = false;
let _loadPromise = null;

// The pose ID the caller passes must match one of the strings the
// PoseLab uses (idle, moving, shooting, running, running_shooting,
// eating, crouch, crouch_shoot_forward, crouch_shoot_still,
// crouch_shoot_back, bat_swing, jumping, taunt_dance, taunt_flick,
// taunt_chop). Same for weapon (fist/bat/pimpslap/pistol/tec9/…).
function key(pose, weapon) {
  return `${pose}:${weapon}`;
}

export async function fetchAllOverrides() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const r = await fetch(`${API}/api/pose-lab/all`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      CACHE.clear();
      for (const rec of (j.overrides || [])) {
        if (rec.pose && rec.weapon && rec.tune) {
          CACHE.set(key(rec.pose, rec.weapon), rec.tune);
        }
      }
      _loadedOnce = true;
      return CACHE;
    } catch (e) {
      // Non-fatal — game plays fine without overrides.
      if (typeof console !== 'undefined') console.warn('[poseOverrides] fetch failed:', e?.message || e);
      _loadedOnce = true;
      return CACHE;
    } finally {
      _loadPromise = null;
    }
  })();
  return _loadPromise;
}

export function getOverride(pose, weapon) {
  return CACHE.get(key(pose, weapon)) || null;
}

// Returns a flat array of every saved override — useful for bulk
// export ("copy all my tuning to my teammate") or diffing.
export function getAllOverrides() {
  const out = [];
  for (const [k, tune] of CACHE.entries()) {
    const [pose, weapon] = k.split(':');
    out.push({ pose, weapon, tune });
  }
  return out;
}

export function isLoaded() { return _loadedOnce; }

export async function saveOverride(pose, weapon, tune) {
  const r = await fetch(`${API}/api/pose-lab/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pose, weapon, tune }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  CACHE.set(key(pose, weapon), { ...tune });
  return r.json();
}

export async function deleteOverride(pose, weapon) {
  const r = await fetch(`${API}/api/pose-lab/${encodeURIComponent(pose)}/${encodeURIComponent(weapon)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  CACHE.delete(key(pose, weapon));
  return r.json();
}

// ── The single shared "apply a tune to a rig" implementation ─────
// Called both by the PoseLab overlay (undo/apply) AND by the in-game
// character every frame. Signature is (rig, tune, sign) — sign=+1 to
// apply, -1 to undo the previous frame's application.
export function applyTuneToRig(rig, tune, sign = +1) {
  if (!rig || !tune) return;
  const T = tune, s = sign;
  const g = (k) => (typeof T[k] === 'number' ? T[k] * s : 0);
  if (rig.torsoG) rig.torsoG.rotation.x += g('spineTilt');
  if (rig.headG)  rig.headG.rotation.x  += g('headPitch');
  // Crouch depth — additive to the body root's Y (drops the whole
  // Saint straight down without affecting the leg/knee bend). Only
  // meaningful for tunes attached to crouch-family poses; harmless
  // for all others because their saved crouchDepth defaults to 0.
  if (rig.body) rig.body.position.y += g('crouchDepth');
  if (rig.armR?.sh) {
    rig.armR.sh.rotation.x += g('shPitchR');
    rig.armR.sh.rotation.z += g('shSplayR');
    rig.armR.sh.rotation.y += g('shTwistR');
  }
  if (rig.armR?.el) {
    rig.armR.el.rotation.x += g('elbowBendR');
    rig.armR.el.rotation.y += g('wristYawR');
    rig.armR.el.rotation.z += g('wristRollR');
  }
  if (rig.armL?.sh) {
    rig.armL.sh.rotation.x += g('shPitchL');
    rig.armL.sh.rotation.z += g('shSplayL');
    rig.armL.sh.rotation.y += g('shTwistL');
  }
  if (rig.armL?.el) {
    rig.armL.el.rotation.x += g('elbowBendL');
    rig.armL.el.rotation.y += g('wristYawL');
    rig.armL.el.rotation.z += g('wristRollL');
  }
  if (rig.fingerR) rig.fingerR.rotation.x += g('fingerCurlR');
  if (rig.fingerL) rig.fingerL.rotation.x += g('fingerCurlL');
  // Per-finger curl knobs (Rig-Lab-parity). Each rotates the base
  // knuckle bone around X so the whole finger cascades naturally.
  // Silent no-op when the mesh doesn't expose per-finger bones —
  // `rig.fingersR/L.<name>` is null on those rigs.
  if (rig.fingersR) {
    if (rig.fingersR.thumb)  rig.fingersR.thumb.rotation.x  += g('thumbCurlR');
    if (rig.fingersR.index)  rig.fingersR.index.rotation.x  += g('indexCurlR');
    if (rig.fingersR.middle) rig.fingersR.middle.rotation.x += g('middleCurlR');
    if (rig.fingersR.ring)   rig.fingersR.ring.rotation.x   += g('ringCurlR');
    if (rig.fingersR.pinky)  rig.fingersR.pinky.rotation.x  += g('pinkyCurlR');
  }
  if (rig.fingersL) {
    if (rig.fingersL.thumb)  rig.fingersL.thumb.rotation.x  += g('thumbCurlL');
    if (rig.fingersL.index)  rig.fingersL.index.rotation.x  += g('indexCurlL');
    if (rig.fingersL.middle) rig.fingersL.middle.rotation.x += g('middleCurlL');
    if (rig.fingersL.ring)   rig.fingersL.ring.rotation.x   += g('ringCurlL');
    if (rig.fingersL.pinky)  rig.fingersL.pinky.rotation.x  += g('pinkyCurlL');
  }
  if (rig.legR?.hip)  { rig.legR.hip.rotation.x += g('hipPitchR'); rig.legR.hip.rotation.z += g('hipSplayR'); }
  if (rig.legR?.knee)   rig.legR.knee.rotation.x += g('kneeBendR');
  if (rig.legL?.hip)  { rig.legL.hip.rotation.x += g('hipPitchL'); rig.legL.hip.rotation.z += g('hipSplayL'); }
  if (rig.legL?.knee)   rig.legL.knee.rotation.x += g('kneeBendL');
  // Ankle pitch/yaw — foot bone IS the ankle joint in Mixamo naming
  // so rotating it pitches the sole up/down (X) or twists it in/out
  // (Y). Silent no-op on meshes without foot bones.
  if (rig.footR) {
    rig.footR.rotation.x += g('anklePitchR');
    rig.footR.rotation.y += g('ankleYawR');
  }
  if (rig.footL) {
    rig.footL.rotation.x += g('anklePitchL');
    rig.footL.rotation.y += g('ankleYawL');
  }
  const gun = rig.gun;
  if (gun) {
    gun.position.x += g('gunPX');
    gun.position.y += g('gunPY') + g('gripDepth');
    gun.position.z += g('gunPZ');
    gun.rotation.x += g('gunRX');
    gun.rotation.y += g('gunRY');
    gun.rotation.z += g('gunRZ');
  }
}

// ── Derive the pose id from a live animate() `f` snapshot ─────────
// Matches the strings the PoseLab uses. Anything unrecognised → 'idle'.
export function derivePoseId(f) {
  if (!f) return 'idle';
  if (f.eating)                  return 'eating';
  if (f.jump)                    return 'jumping';
  if (f.taunt === 'dance')       return 'taunt_dance';
  if (f.taunt === 'flick')       return 'taunt_flick';
  if (f.taunt)                   return 'taunt_chop';   // any other taunt → chop
  if (f.crouch && f.hugCoverDir != null) {
    // Snap the outward normal to the nearest cardinal — 4 pose
    // slots the user can author in the PoseLab. Each corresponds
    // to the world-space direction the barrier's OUTWARD normal
    // points (i.e. the direction the player faces when peeking).
    //   N =  0     (peek toward +Z / north)
    //   E = +π/2   (peek toward +X / east)
    //   S = ±π     (peek toward -Z / south)
    //   W = -π/2   (peek toward -X / west)
    const dir = f.hugCoverDir;
    // Normalise to [-π, π] and pick the closest cardinal.
    const norm = ((dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (norm > -Math.PI / 4 && norm <= Math.PI / 4)          return 'cover_hug_n';
    if (norm >  Math.PI / 4 && norm <= Math.PI * 3 / 4)      return 'cover_hug_e';
    if (norm > -Math.PI * 3 / 4 && norm <= -Math.PI / 4)     return 'cover_hug_w';
    return 'cover_hug_s';
  }
  if (f.crouch && f.firing) {
    if ((f.pitch || 0) >  0.15)  return 'crouch_shoot_forward';
    if ((f.pitch || 0) < -0.15)  return 'crouch_shoot_back';
    return 'crouch_shoot_still';
  }
  if (f.crouch)                  return 'crouch';
  if (f.moving && f.firing && f.sprint) return 'running_shooting';
  if (f.moving && f.sprint)      return 'running';
  if (f.firing)                  return 'shooting';
  if (f.moving)                  return 'moving';
  return 'idle';
}
