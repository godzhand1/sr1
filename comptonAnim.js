// comptonAnim.js — locomotion + arm-IK helpers for the Compton universal rig.
//
// Distance-driven gait (feet never slide), gait weights blended from
// the actual ground speed, and an analytic two-bone IK used to plant
// the right hand on the pistol grip / the left hand on the foregrip of
// two-handed weapons. Everything is written as ABSOLUTE bone
// transforms each frame so the pose-override undo/apply pass stays
// drift-free.
import * as THREE from 'three';

// ── Weapon grip classes ──────────────────────────────────────────
// grip      → gunProp-space point that sits in the right palm
// foregrip  → gunProp-space point the left hand wraps (two-handed)
// idlePitch → barrel droop (rad, +down) while carrying, not aiming
export const WEAPON_GRIP = {
  fist:     { cls: 'unarmed' },
  pimpslap: { cls: 'unarmed' },
  bat:      { cls: 'melee',  grip: [0, 0, -0.27] },
  pipebomb: { cls: 'throw',  grip: [0, 0, -0.02] },
  pistol:   { cls: 'one',    grip: [0, -0.02, -0.10],  idlePitch: 0.55 },
  tec9:     { cls: 'one',    grip: [0, -0.02, -0.02],  idlePitch: 0.45 },
  ak47:     { cls: 'two',    grip: [0, 0.0, -0.08],    foregrip: [0, 0.05, 0.17],   idlePitch: 0.35 },
  shotgun:  { cls: 'two',    grip: [0, -0.03, -0.14],  foregrip: [0, -0.005, 0.08], idlePitch: 0.35 },
  rpg:      { cls: 'two',    grip: [0, -0.06, -0.32],  foregrip: [0, -0.05, -0.20], idlePitch: 0.10, shoulder: true },
};
export function gripFor(id) { return WEAPON_GRIP[id] || WEAPON_GRIP.fist; }

// Hand-placement tuning (metres, relative to the RIGHT shoulder in the
// body frame: f = forward, u = up, r = right). Exposed on window for
// live tuning from the dev console (window.__srArmTune).
export const ARM_TUNE = {
  one:  { aim: { f: 0.56, u: -0.03, r: -0.03 }, carry: { f: 0.22, u: -0.42, r: 0.05 }, twist: 0.14 },
  two:  { aim: { f: 0.34, u: -0.12, r: 0.03 }, carry: { f: 0.12, u: -0.44, r: 0.06 }, twist: 0.65, yawL: 0.26, curlL: 2.2 },
  rpg:  { aim: { f: 0.14, u: -0.10, r: 0.0 },  twist: 0.30, curlL: 2.0 },
  foreBack: 0.06,   // wrist sits this far behind the palm along the fingers
  foreDown: 0.0,    // extra palm drop below the foregrip point
};
if (typeof window !== 'undefined') window.__srArmTune = ARM_TUNE;
export function isGunClass(cls) { return cls === 'one' || cls === 'two'; }

// ── Gait ─────────────────────────────────────────────────────────
const WALK_SPD = 3.2, JOG_SPD = 7.4, SPRINT_SPD = 10.7, CROUCH_SPD = 3.4;
const smooth01 = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;
const expK = (rate, dt) => 1 - Math.exp(-rate * dt);

export function createAnimState() {
  return {
    lastT: null, phase: 0, spd: 0, fwdN: 1, sideN: 0, moveW: 0,
    walkW: 0, jogW: 0, sprintW: 0, crouchW: 0, aimW: 0,
    eatT: 0, tauntT: 0, tauntId: null, tauntBlend: 0,
    fireKick: 0, lastFiring: false,
  };
}

// Returns the per-frame gait descriptor. Speed comes from the local
// velocity when the driver provides it (mvFwd/mvSide in m/s, in the
// character's facing frame); otherwise from `moving` × the speed tier.
export function updateGait(st, f, t) {
  const dt = st.lastT == null ? 1 / 60 : Math.min(0.05, Math.max(0, t - st.lastT));
  st.lastT = t;
  const moving = Math.min(1, Math.max(0, f.moving || 0));
  let vF, vS;
  if (typeof f.mvFwd === 'number') { vF = f.mvFwd; vS = f.mvSide || 0; }
  else {
    const tier = f.crouch ? CROUCH_SPD : f.sprint ? SPRINT_SPD : f.walking ? WALK_SPD
      : (f.speedTier === 2 ? SPRINT_SPD : f.speedTier === 0 ? WALK_SPD : JOG_SPD);
    vF = moving * tier; vS = 0;
  }
  const speed = Math.hypot(vF, vS);
  st.spd = lerp(st.spd, speed, expK(14, dt));
  if (speed > 0.35) {
    st.fwdN = lerp(st.fwdN, vF / speed, expK(10, dt));
    st.sideN = lerp(st.sideN, vS / speed, expK(10, dt));
  }
  const spd = st.spd;
  st.moveW = smooth01(spd, 0.25, 1.1);
  const jogRamp = smooth01(spd, WALK_SPD + 0.4, JOG_SPD - 1.0);
  st.sprintW = smooth01(spd, JOG_SPD + 0.6, SPRINT_SPD - 0.4);
  st.walkW = st.moveW * (1 - jogRamp);
  st.jogW = jogRamp * (1 - st.sprintW);
  st.crouchW = lerp(st.crouchW, f.crouch ? 1 : 0, expK(9, dt));
  // Stride: one full cycle = two steps. Walk 0.72 m/step → sprint 1.45.
  const stepLen = f.crouch ? 0.55 : lerp(lerp(0.72, 1.12, jogRamp), 1.45, st.sprintW);
  st.phase += (spd * dt / (stepLen * 2)) * Math.PI * 2;
  if (st.moveW < 0.02) {
    // Settle to feet-together so the idle blend is clean.
    const rem = st.phase % Math.PI;
    st.phase -= rem * expK(6, dt);
  }
  // Fire kick envelope (impulse on the rising edge, fast decay).
  if (f.firing && !st.lastFiring) st.fireKick = 1;
  st.lastFiring = !!f.firing;
  st.fireKick *= Math.exp(-dt * 14);
  st.eatT = f.eating ? st.eatT + dt : 0;
  if (f.taunt) {
    if (st.tauntId !== f.taunt) { st.tauntId = f.taunt; st.tauntT = 0; }
    st.tauntT += dt;
    st.tauntBlend = lerp(st.tauntBlend, 1, expK(12, dt));
  } else {
    st.tauntBlend = lerp(st.tauntBlend, 0, expK(10, dt));
    if (st.tauntBlend < 0.01) st.tauntId = null;
  }
  return { dt, spd, moving, phase: st.phase, fwdN: st.fwdN, sideN: st.sideN, stepLen,
    moveW: st.moveW, walkW: st.walkW, jogW: st.jogW, sprintW: st.sprintW, crouchW: st.crouchW };
}

// ── Two-bone analytic IK ─────────────────────────────────────────
// upper / fore / hand are the animated bones; each sits inside a fixed
// orient node (universalRig), so the REST offsets are read straight
// from those nodes — the solve is exact for any rest pose (T or A):
//   e0 = elbow offset in the upper bone's frame
//   h0 = hand offset in the forearm bone's frame
// The forearm flexes about its local +X; θ is solved so the hand lands
// at `dist`, then the upper bone is rotated to aim the shoulder→hand
// vector at the target with the elbow displaced toward `poleWorldDir`.
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _e0 = new THREE.Vector3(), _h0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _k = new THREE.Vector3();
const _bt = new THREE.Vector3(), _ph = new THREE.Vector3(), _ep = new THREE.Vector3(), _c = new THREE.Vector3();
const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _tmpQ = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);

export function boneLengths(bn) {
  const len = (a, b) => (a && b) ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())) : 0;
  return {
    upR: len(bn.RightArm, bn.RightForeArm), foreR: len(bn.RightForeArm, bn.RightHand),
    upL: len(bn.LeftArm, bn.LeftForeArm),   foreL: len(bn.LeftForeArm, bn.LeftHand),
    thighR: len(bn.RightUpLeg, bn.RightLeg), shinR: len(bn.RightLeg, bn.RightFoot),
    thighL: len(bn.LeftUpLeg, bn.LeftLeg),   shinL: len(bn.LeftLeg, bn.LeftFoot),
  };
}

// Arms: each bone sits inside a fixed orient node, so the rest offsets and
// the flex axis come from those nodes.
export function solveTwoBoneIK(upper, fore, hand, targetWorld, poleWorldDir, blend = 1) {
  const parent = upper.parent;
  const foreOrient = fore.parent, handOrient = hand.parent;
  if (!parent || !foreOrient || !handOrient) return false;
  _e0.copy(foreOrient.position);
  _h0.copy(handOrient.position);
  _b0.copy(_h0).applyQuaternion(foreOrient.quaternion);
  _k.copy(_X).applyQuaternion(foreOrient.quaternion);
  return _solveChain(parent, upper, fore, targetWorld, poleWorldDir, blend);
}

// Legs: UpLeg → Leg → Foot have NO orient nodes (identity rest frames
// aligned with the container), so the knee offset is Leg.position, the
// ankle offset is Foot.position and the knee flexes about local +X
// (positive = shin swings back, the anatomical direction).
export function solveLegIK(upLeg, leg, foot, targetWorld, poleWorldDir, blend = 1) {
  const parent = upLeg.parent;
  if (!parent || !leg || !foot) return false;
  _e0.copy(leg.position);
  _b0.copy(foot.position);
  _k.copy(_X);
  return _solveChain(parent, upLeg, leg, targetWorld, poleWorldDir, blend);
}

function _solveChain(parent, upper, fore, targetWorld, poleWorldDir, blend) {
  parent.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(_pq);
  const invPQ = _tmpQ.copy(_pq).invert();
  const L1 = _e0.length(), L2 = _b0.length();
  if (L1 < 1e-6 || L2 < 1e-6) return false;
  // Target in parent-local, relative to the shoulder.
  _v.copy(targetWorld); parent.worldToLocal(_v);
  _d.subVectors(_v, upper.position);
  let dist = _d.length();
  if (dist < 1e-4) return false;
  _d.multiplyScalar(1 / dist);
  // Solve the elbow angle: |e0 + b(θ)|² = dist²  with b(θ) = Rodrigues(b0, k, θ).
  const ak = _e0.dot(_k), bk = _b0.dot(_k);
  const A1 = _e0.dot(_b0) - ak * bk;
  const B1 = _e0.dot(_c.crossVectors(_k, _b0));
  const C1 = ak * bk;
  const amp = Math.hypot(A1, B1) || 1e-9;
  const c = (dist * dist - L1 * L1 - L2 * L2) / 2;
  const cosArg = Math.min(1, Math.max(-1, (c - C1) / amp));
  const phi = Math.atan2(B1, A1);
  const off = Math.acos(cosArg);
  let theta = phi + off;
  const alt = phi - off;
  const norm = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
  theta = norm(theta); const altN = norm(alt);
  if (theta < -0.05 || (altN >= -0.05 && altN < theta)) theta = altN;   // prefer the forward flex in [0, π]
  if (theta < 0) theta = 0;
  // Forearm vector after the flex, and the hand position (upper-local).
  const ct = Math.cos(theta), stt = Math.sin(theta);
  _bt.copy(_b0).multiplyScalar(ct).addScaledVector(_c, stt).addScaledVector(_k, bk * (1 - ct));
  _ph.addVectors(_e0, _bt);
  const phLen = _ph.length();
  if (phLen < 1e-6) return false;
  _ph.multiplyScalar(1 / phLen);
  // Elbow displacement direction ⟂ the shoulder→hand line.
  _ep.copy(_e0).addScaledVector(_ph, -_e0.dot(_ph));
  if (_ep.lengthSq() < 1e-8) _ep.crossVectors(_k, _ph);
  _ep.normalize();
  // Desired pole direction ⟂ d.
  _n.copy(poleWorldDir).applyQuaternion(invPQ);
  _n.addScaledVector(_d, -_n.dot(_d));
  if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1).addScaledVector(_d, -_d.z);
  _n.normalize();
  // q1 maps (p̂, ê, p̂×ê) → (d̂, n̂, d̂×n̂).
  _c.crossVectors(_ph, _ep); _mA.makeBasis(_ph, _ep, _c);
  _c.crossVectors(_d, _n);   _mB.makeBasis(_d, _n, _c);
  _qA.setFromRotationMatrix(_mA).invert();
  _q.setFromRotationMatrix(_mB).multiply(_qA);
  if (blend >= 1) upper.quaternion.copy(_q); else upper.quaternion.slerp(_q, blend);
  fore.rotation.set(fore.rotation.x + (theta - fore.rotation.x) * blend, 0, 0);
  return true;
}

// Orient a bone so its local +Y points along `dirY` (world) and its
// local +Z along `dirZ` (world, orthogonalised). Used for hands: +Y is
// wrist→knuckles, +Z is the palm normal.
const _y = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3();
export function orientBoneWorld(bone, dirY, dirZ, blend = 1) {
  _y.copy(dirY).normalize();
  _z.copy(dirZ).addScaledVector(_y, -_y.dot(dirZ));
  if (_z.lengthSq() < 1e-6) _z.set(0, 1, 0).addScaledVector(_y, -_y.y);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_pq).invert();
  _q.premultiply(_pq);
  if (blend >= 1) bone.quaternion.copy(_q); else bone.quaternion.slerp(_q, blend);
}
