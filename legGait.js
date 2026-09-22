// legGait.js — procedural foot-target planner for the IK legs.
//
// The legs are no longer driven by hip/knee angle curves. Each frame the
// planner emits, per foot, a ground-space TARGET (ankle position), a foot
// PITCH (toe-up +, toe-down −) and a stance flag; comptonCharacter solves
// hip→knee→ankle with analytic two-bone IK to reach it. That is what makes
// knees bend like real knees: nearly straight at heel strike, soft at
// mid-stance, deeply flexed mid-swing, and the pelvis dips at double
// support because a stretched leg can't reach the ground otherwise.
//
// Frame: the character group (feet on the ground at y = 0), front = −Z,
// right = +X, up = +Y. Distances in metres, angles in radians.
//
// Gait cycle: `phase` (from comptonAnim.updateGait) advances 2π per full
// stride (two steps); the right foot is at cycle fraction u, the left at
// u + 0.5. Stance occupies the first `sf` of the cycle (0.60 walking →
// 0.31 sprinting — running has a flight phase), swing the rest. During
// stance the foot slides BACKWARD relative to the pelvis at exactly the
// body speed, so planted feet don't skate. Stance is asymmetric like a
// real step: the foot lands a little AHEAD of the hip (42 % of the stance
// travel walking, 30 % sprinting — runners don't overstride) and leaves
// well BEHIND it, up on the toes.

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;

export const FOOT_LEN = 0.24;         // ankle → toe pivot: heel rise at toe-off = FOOT_LEN·sin(pitch)
export const HEEL_LEN = 0.07;         // ankle → heel: keeps the heel out of the ground at strike
export const HEEL_STRIKE_PITCH = 0.22;
export const KNEE_SOFT = 0.998;       // fraction of full leg length allowed in stance (never locks)
export const MAX_DROP = 0.09;         // pelvis never dips more than this — beyond it the trailing foot may float

const runW = (g) => Math.min(1, (g.jogW || 0) + (g.sprintW || 0));

export function stanceFraction(g) {
  return 0.60 - 0.20 * runW(g) - 0.09 * (g.sprintW || 0) + 0.05 * (g.crouchW || 0);
}
// Where in the stance travel the foot lands (fraction ahead of the hip).
export function strikeFraction(g) { return 0.42 - 0.09 * runW(g) - 0.03 * (g.sprintW || 0); }
// How far the foot rolls onto the toes leaving the ground.
export function toeOffPitch(g) { return 0.50 + 0.30 * runW(g) + 0.10 * (g.sprintW || 0); }
export function footClearance(g) {
  return (0.05 + 0.07 * runW(g) + 0.06 * (g.sprintW || 0)) * (1 - 0.5 * (g.crouchW || 0));
}

// One foot's cycle sample. u ∈ [0,1): 0 = heel strike.
// k: { strike, toePitch } (see strikeFraction / toeOffPitch).
export function footCycle(u, sf, out, k) {
  out = out || {};
  const strike = (k && k.strike) ?? 0.42, toePitch = (k && k.toePitch) ?? 0.5;
  if (u < sf) {
    const s = u / sf;
    const heelUp = Math.max(0, 1 - s / 0.22);                    // toe up right after strike
    const toeOff = sstep(s, 0.58, 1.0);                          // heel peels off, pivot on the toe
    out.stance = true;
    out.along = strike - s;                                      // +strike ahead → −(1−strike) behind (× stride)
    out.pitch = HEEL_STRIKE_PITCH * heelUp - toePitch * toeOff;
    out.lift = HEEL_LEN * Math.sin(HEEL_STRIKE_PITCH * heelUp) + FOOT_LEN * Math.sin(toePitch * toeOff);
    out.clear = 0;
  } else {
    const w = (u - sf) / (1 - sf);
    const e = w * w * (3 - 2 * w);                               // ease: fast mid-swing, soft landing
    out.stance = false;
    out.along = (strike - 1) + e;
    out.pitch = lerp(-toePitch, HEEL_STRIKE_PITCH, sstep(w, 0.1, 0.9));
    out.lift = FOOT_LEN * Math.sin(toePitch) * (1 - sstep(w, 0, 0.45))       // heel still up leaving the ground
      + HEEL_LEN * Math.sin(HEEL_STRIKE_PITCH) * sstep(w, 0.7, 1);
    out.clear = Math.sin(Math.PI * w);                           // 0..1 toe clearance arc
  }
  return out;
}

const _cL = {}, _cR = {}, _k = {};

// p: { phase, moveW, fwdN, sideN, walkW, jogW, sprintW, crouchW, stepLen,
//      jump, restL, restR, hipL, hipR, hipYOffset, shiftX, legLen }
// out: { L:{x,y,z,pitch,stance}, R:{…}, drop }   (drop ≤ 0, metres)
export function planLegs(p, out) {
  out = out || { L: {}, R: {}, drop: 0 };
  const moveW = clamp01(p.moveW || 0);
  const sf = stanceFraction(p);
  _k.strike = strikeFraction(p); _k.toePitch = toeOffPitch(p);
  const stride = 2 * (p.stepLen || 0.72) * sf * moveW;          // relative travel during stance
  const clearance = footClearance(p) * moveW;
  const fwdN = p.fwdN || 0, sideN = p.sideN || 0;
  const mx = sideN, mz = -fwdN;                                  // movement direction (front = −Z)
  const uR = frac((p.phase || 0) / TAU), uL = frac(uR + 0.5);
  const crouchW = p.crouchW || 0, sprintW = (p.sprintW || 0) * moveW;
  const widen = 1 + 0.5 * crouchW - 0.25 * sprintW;

  const leg = (rest, u, cyc, o, side) => {
    footCycle(u, sf, cyc, _k);
    const along = cyc.along * stride;
    o.x = rest.x * widen + mx * along;
    o.z = rest.z + mz * along + side * 0.08 * crouchW;           // staggered crouch stance
    o.y = rest.y + cyc.lift * moveW + clearance * cyc.clear;
    o.pitch = cyc.pitch * fwdN * moveW;                          // backpedal → toe-first, strafe → flat
    o.stance = cyc.stance || moveW < 0.02;
    return o;
  };
  leg(p.restR, uR, _cR, out.R, 1);
  leg(p.restL, uL, _cL, out.L, -1);

  if (p.jump) {
    // Running-jump silhouette: lead knee up and forward, trail leg back.
    out.R.z = p.restR.z - 0.30; out.R.y = p.restR.y + 0.45; out.R.pitch = -0.35; out.R.stance = false;
    out.L.z = p.restL.z + 0.10; out.L.y = p.restL.y + 0.18; out.L.pitch = -0.30; out.L.stance = false;
    out.drop = 0;
    return out;
  }

  // Pelvis drop: a stance foot must stay reachable with a soft knee.
  const reach = (p.legLen || 0.85) * KNEE_SOFT;
  let need = 0;
  const check = (hip, t) => {
    if (!t.stance) return;
    const dx = (hip.x + (p.shiftX || 0)) - t.x, dz = hip.z - t.z;
    const horiz2 = dx * dx + dz * dz;
    const vert = Math.sqrt(Math.max(0, reach * reach - horiz2));
    const hipY = hip.y + (p.hipYOffset || 0);
    need = Math.max(need, hipY - (t.y + vert));
  };
  check(p.hipR, out.R); check(p.hipL, out.L);
  out.drop = -Math.min(MAX_DROP, need + 0.003 * moveW);         // knees never lock; tiny extra flex on the move
  return out;
}
