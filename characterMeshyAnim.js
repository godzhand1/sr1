// characterMeshyAnim.js — Character animation state machine.
//
// Extracted from characterMeshy.js (iter156→157 Phase-2 refactor).
// Owns the ~800-line per-frame `animate()` pipeline that drives:
//   • Ragdoll flail on death
//   • Procedural SR-1 walk / jog / sprint locomotion
//   • Liu-Kang kick + punch variants (front / roundhouse / axe / jab
//     / cross / hook / uppercut) with world-direction arm targeting
//   • Vault, knockdown, flying-kick, pimp-slap arm sweeps
//   • Aim / recoil / breathing / gun-mount barrel alignment
//   • Idle break gestures + counter-torso twist
//   • Hand curl (fist / grip / relaxed)
//
// Design: pure state-machine — reads all closure state from a mutable
// `S` context object populated once in the factory. animate becomes a
// two-line wrapper that populates the "assigned outside animate" fields
// each frame (skinnedMesh, boneMap, mixer, walkAction, curWeapon,
// curCat, _deltaScale, _legForwardSign) and calls `stepCharacterAnim`.
// Every value written by animate itself (ragdollMode, _runFactor,
// _walkPhase, _kick*/punch*/jump* timers, _idle*) lives ON S so state
// persists across frames.
//
// All bone-math helpers (`br`, `pointBoneAt`) and per-frame scratch
// vectors moved with animate — none of them are used elsewhere in the
// codebase.

import * as THREE from 'three';
import { getWeaponOffset, hasWeaponOffset } from './weaponOffsets.js';

// ── Small-delta smoother helper ─────────────────────────────────
// br(bone, dx, dy, dz, k) applies smoothed local-space Euler deltas
// on TOP of whatever the current bone.quaternion holds (typically the
// rest pose after each frame's reset-to-rest pass, plus any mixer
// contribution). Multiplication order X * Y * Z applied on the right
// = pitch-then-yaw-then-roll in the bone's own local frame.
//
// dx / dy / dz = target deltas around bone-local X / Y / Z
// k            = smoothing rate (0=no smoothing on delta cache, 1=snap)
const _tmpQx = new THREE.Quaternion();
const _tmpQy = new THREE.Quaternion();
const _tmpQz = new THREE.Quaternion();
const _tmpAxX = new THREE.Vector3(1, 0, 0);
const _tmpAxY = new THREE.Vector3(0, 1, 0);
const _tmpAxZ = new THREE.Vector3(0, 0, 1);
function br(bone, dx, dy, dz, k) {
  if (!bone) return;
  let d = bone.userData._delta;
  if (!d) { d = { x: 0, y: 0, z: 0 }; bone.userData._delta = d; }
  d.x += ((dx || 0) - d.x) * k;
  d.y += ((dy || 0) - d.y) * k;
  d.z += ((dz || 0) - d.z) * k;
  _tmpQx.setFromAxisAngle(_tmpAxX, d.x);
  _tmpQy.setFromAxisAngle(_tmpAxY, d.y);
  _tmpQz.setFromAxisAngle(_tmpAxZ, d.z);
  bone.quaternion.multiply(_tmpQx).multiply(_tmpQy).multiply(_tmpQz);
}

// ── Point bone at a world direction (mirror-symmetric arm poser) ─
// The Meshy warrior armature has each arm/leg bone authored with its
// bone-along axis running along LOCAL +Y. Auto-rigged custom bodies
// use LOCAL +X for arms and LOCAL −Y for legs. pointBoneAt auto-
// detects the local along-axis from the first bone-child's rest
// offset (cached in userData._pbAxis) and rotates the bone so that
// axis aligns with `worldDir`.
//
// Smoothing is applied to the DIRECTION vector (cached in
// userData._pbDir) rather than the bone quaternion — the bone is
// reset to rest each frame BEFORE this call, so a bone-quaternion
// slerp would never converge.
const _pbTargetLocal = new THREE.Vector3();
const _pbTargetQ     = new THREE.Quaternion();
const _pbParentQ     = new THREE.Quaternion();
function _pbAxisFor(bone) {
  if (bone.userData._pbAxis) return bone.userData._pbAxis;
  let child = null;
  for (const c of bone.children) {
    if (c.isBone) { child = c; break; }
  }
  const ax = new THREE.Vector3(0, 1, 0);
  if (child && child.position.lengthSq() > 1e-8) {
    ax.copy(child.position).normalize();
  }
  bone.userData._pbAxis = ax;
  return ax;
}
function pointBoneAt(bone, worldDir, k) {
  if (!bone || !bone.parent || !worldDir) return;
  let s = bone.userData._pbDir;
  if (!s) {
    s = new THREE.Vector3().copy(worldDir);
    bone.userData._pbDir = s;
  } else {
    s.lerp(worldDir, k);
  }
  if (s.lengthSq() < 1e-8) return;
  s.normalize();
  bone.parent.getWorldQuaternion(_pbParentQ);
  _pbTargetLocal.copy(s).applyQuaternion(_pbParentQ.invert());
  if (_pbTargetLocal.lengthSq() < 1e-8) return;
  _pbTargetLocal.normalize();
  const fromLocal = _pbAxisFor(bone);
  _pbTargetQ.setFromUnitVectors(fromLocal, _pbTargetLocal);
  bone.quaternion.copy(_pbTargetQ);
}

// World up used by cross product for character right-vector.
const WORLD_Y = new THREE.Vector3(0, 1, 0);

// Scratch vectors used by the arm-pose driver — allocated once at
// module scope so each stepCharacterAnim call doesn't churn the GC.
const _armCharFwd   = new THREE.Vector3();
const _armCharRight = new THREE.Vector3();
const _armRDir      = new THREE.Vector3();
const _armLDir      = new THREE.Vector3();
const _armGroupQ    = new THREE.Quaternion();

// Scratch vectors / matrices for gun-mount barrel alignment.
const _gunArmQ = new THREE.Quaternion();
const _gunHandQ = new THREE.Quaternion();
const _gunTargetWorldQ = new THREE.Quaternion();
const _gunArmFwd = new THREE.Vector3();
const _gunArmFwdNeg = new THREE.Vector3();
const _gunOrigin = new THREE.Vector3(0, 0, 0);
const _gunWorldUp = new THREE.Vector3(0, 1, 0);
const _gunLookMat = new THREE.Matrix4();

// ── stepCharacterAnim(S, t, f) ───────────────────────────────────
// Advance the character's pose one frame.
//   S : state context populated by the factory. Fields used:
//       skinnedMesh, boneMap, group, gunMount, mixer, walkAction,
//       _rest, curWeapon, curCat, _deltaScale, _legForwardSign,
//       ragdollMode (rw), _runFactor (rw), _idleT (rw),
//       _kickT/_kickPrev/_kickVar (rw), _punchT/_punchPrev/_punchVar (rw),
//       _jumpT/_jumpPrev (rw), _walkPhase (rw),
//       _idleBreakT/_idleBreakActive (rw)
//   t : elapsed time (seconds)
//   f : per-frame flags object
//       (moving, firing, crouch, deadT, pitch, sprint, jump, kick,
//        punchL, hasPimpSlap, slapSpinT, slapSpinDir, reloadT, taunt,
//        flyKickT, vaulting, knocked, eating, walking, kickVariant,
//        punchVariant, rag, _dt)
export function stepCharacterAnim(S, t, f) {
  const { skinnedMesh, boneMap, group, gunMount, _rest } = S;
  if (!skinnedMesh || !boneMap) return;
  const mixer = S.mixer;
  const walkAction = S.walkAction;
  const curWeapon = S.curWeapon;
  const curCat = S.curCat;
  const _deltaScale = S._deltaScale;
  const _legForwardSign = S._legForwardSign;

  const dt = f._dt != null ? f._dt : (1 / 60);
  const k = 1 - Math.exp(-dt * 12);                // 12 Hz smoothing
  const moving = Math.max(0, Math.min(1, f.moving || 0));
  const crouch = !!f.crouch;
  const firing = !!f.firing;

  // Death — a per-bone flail layer on top of the view3d ragdoll's
  // group-level rigid tumble. Reads live ragdoll state from `f.rag`:
  //   • limbFlail   — 0..1 intensity of arm/leg looseness
  //   • impactShock — 0..1 pulse on each floor contact (bones jerk)
  //   • headLag     — the head bone's rotational lag behind the body
  //   • dirX / dirZ — unit vector of the initial impulse (arms trail)
  // When `f.rag` is null (very early frame before drive() ran) we
  // fall back to the old group-tilt behaviour so the corpse doesn't
  // stand upright.
  if (f.deadT > 0) {
    S.ragdollMode = true;
    const rag = f.rag;
    if (!rag) {
      // Cold-start fallback — first frame of death, before view3d
      // has instantiated the Ragdoll instance.
      const dk = Math.min(1, f.deadT / 0.45);
      group.rotation.x = dk * (Math.PI / 2);
      group.position.y = Math.max(0, 0.15 - dk * 0.05);
      return;
    }
    // The ragdoll instance ALREADY set group.rotation/position on
    // this frame (see view3d drive()). Add per-bone flails on top.
    const flail = Math.max(0, Math.min(1, rag.limbFlail || 0));
    const shock = Math.max(0, Math.min(1, rag.impactShock || 0));
    // Deterministic per-bone phase so flails don't all sync.
    const phX = (rag.seed & 7) * 0.7;
    const phZ = ((rag.seed >> 3) & 7) * 0.9;
    // Arms: outstretched at impact, drift back to torso as flail decays.
    // Direction of travel biases the trail-arm to sweep behind.
    const armSpread = 0.9 * flail;
    const armDrift  = 0.6 * (shock + flail * 0.3);
    const armWobbleL = Math.sin(t * 3.4 + phX) * flail * 0.35;
    const armWobbleR = Math.cos(t * 3.1 + phZ) * flail * 0.35;
    br(boneMap.LeftArm  || boneMap.LeftShoulder,   0.15 * armDrift + armWobbleL,  0,  armSpread, 1);
    br(boneMap.RightArm || boneMap.RightShoulder,  0.15 * armDrift + armWobbleR,  0, -armSpread, 1);
    // Elbows: partially bent during flail, straighten as body settles.
    const elbowBendL = -0.55 * flail + Math.sin(t * 2.7 + phZ) * 0.2 * flail;
    const elbowBendR = -0.55 * flail + Math.cos(t * 2.2 + phX) * 0.2 * flail;
    br(boneMap.LeftForeArm,  0, elbowBendL, 0, 1);
    br(boneMap.RightForeArm, 0, elbowBendR, 0, 1);
    // Legs: kick out on impact then settle. Legs go OPPOSITE to
    // arms so the body reads as spinning around the hips.
    const legKick = 0.7 * flail * (0.6 + shock * 0.4);
    const legWobbleL = Math.cos(t * 3.9 + phX) * flail * 0.25;
    const legWobbleR = Math.sin(t * 3.6 + phZ) * flail * 0.25;
    br(boneMap.LeftUpLeg,  -legKick + legWobbleL, 0,  0.2 * flail, 1);
    br(boneMap.RightUpLeg, -legKick + legWobbleR, 0, -0.2 * flail, 1);
    // Knees: bent during ragdoll (natural), less bent as body flattens.
    br(boneMap.LeftLeg,  0.85 * flail, 0, 0, 1);
    br(boneMap.RightLeg, 0.85 * flail, 0, 0, 1);
    // Head: lag behind body rotation for the "lolling head" read.
    // `rag.headLag` is already computed in ragdoll.step().
    br(boneMap.Head, rag.headLag || 0, 0, 0, 1);
    br(boneMap.Neck, (rag.headLag || 0) * 0.3, 0, 0, 1);
    // Spine responds to angular velocity — the belly cinches on
    // impact and relaxes as the body settles.
    br(boneMap.Spine02, -shock * 0.25, 0, 0, 1);
    br(boneMap.Spine01, -shock * 0.20, 0, 0, 1);
    // Fingers: relaxed / curled (dead grip). Ships-Meshy has finger
    // bones only when the rig supports them — brSet no-ops otherwise.
    const curl = 0.55;
    br(boneMap.LeftHandThumb1,  0, 0, curl, 1);
    br(boneMap.RightHandThumb1, 0, 0, -curl, 1);
    return;
  }
  if (S.ragdollMode) {
    group.rotation.x = 0;
    group.position.y = 0;
    S.ragdollMode = false;
  }

  // Smooth run factor 0→1 based on sprint intent + actual motion.
  const targetRun = (f.sprint && moving > 0.3) ? 1 : 0;
  S._runFactor += (targetRun - S._runFactor) * Math.min(1, dt * 4.2);
  const run = S._runFactor;

  // Walk-tier scaling — when the player is in the slow WALK tier
  // (LB / Ctrl held, or partial-tilt stick), the shipped walk
  // clip slows down (0.5×) and its amplitude fades so the gait
  // reads as a deliberate quiet-walk instead of a full stride.
  const walkTier = !!f.walking;

  // ── AnimationMixer walk clip ─────────────────────────────
  // Weight = movement * (1 − crouch). timeScale ramps with sprint
  // so the same clip covers walk (0.85×) → sprint (1.7×). Mixer
  // updates BEFORE the procedural layer so combat additives
  // stack on top of the authored gait.
  //
  // When the mixer's effective weight is low (idle / crouch / eat),
  // its previous frame's clip pose can linger on the bones — we
  // manually reset every bone to its REST rotation first, then
  // let the mixer blend in its (small) contribution, then let the
  // procedural layer apply on top.
  //
  // WOBBLE FIX (Feb 2026): the exponential-decay of `newWeight`
  // toward 0 never quite hits zero, so at weight ≈ 0.001 the walk
  // clip STILL contributes a time-varying nudge to leg bones (the
  // mixer's internal cursor keeps advancing). Result: legs visibly
  // shimmer/wobble during crouch and eating. Fix: snap weight to
  // exactly 0 below a threshold AND skip `mixer.update(dt)` in
  // that case so the clip cursor freezes (no phase drift when the
  // weight later ramps back up).
  if (mixer && walkAction) {
    // WALK tier fades the clip to 55% weight + 0.5× timeScale so
    // the gait reads as slower + more measured. SPRINT keeps 100%
    // weight and 1.7× timeScale (the existing behavior). JOG is the
    // default. Crouch always zeroes out the mixer contribution
    // (see standWeight branch below).
    const gaitAmp = walkTier ? 0.55 : 1.0;
    const targetWeight = crouch ? 0 : Math.min(1, moving * 1.4) * gaitAmp;
    const currentWeight = walkAction.getEffectiveWeight();
    let newWeight = currentWeight + (targetWeight - currentWeight) * Math.min(1, dt * 6);
    if (newWeight < 0.02 && targetWeight === 0) newWeight = 0;
    walkAction.setEffectiveWeight(newWeight);
    const gaitScale = walkTier ? 0.50 : (0.85 + run * 0.85);
    walkAction.timeScale = gaitScale;
  }
  // Reset every bone to its REST quaternion EVERY FRAME (regardless
  // of whether we have a mixer). The procedural `br(...)` layer
  // below composes deltas via `bone.quaternion.multiply(...)`, so
  // without this reset the deltas ACCUMULATE across frames — after
  // a few seconds the legs spin, the hips drift down, and the
  // character ragdolls in and out of the floor. Auto-rigged
  // characters (no walk clip → no mixer) especially need this
  // because the mixer's own `.update()` was previously the only
  // path that reached this reset loop.
  if (skinnedMesh && skinnedMesh.skeleton) {
    for (const b of skinnedMesh.skeleton.bones) {
      const rq = b.userData._restQ;
      if (rq) b.quaternion.copy(rq);
    }
  }
  // Only update the mixer if it exists AND is actually contributing
  // — skips both the tiny leg-jitter contribution AND the cursor
  // drift that would otherwise cause a phase-jump when weight later
  // ramps back up.
  if (mixer && walkAction && walkAction.getEffectiveWeight() > 0) {
    mixer.update(dt);
  }

  // Idle timer for gestures / look-around.
  const active = moving > 0.15 || firing || crouch || f.kick || f.punchL || f.taunt;
  S._idleT = active ? 0 : S._idleT + dt;

  // ── Timers for one-shot poses ─────────────────────────────
  // Each rising-edge latches the CURRENT variant so the whole
  // strike animation plays one consistent curve, even if the
  // input flag flickers or the variant advances mid-swing.
  if (f.kick && !S._kickPrev) {
    S._kickT = 0.001;
    S._kickVar = f.kickVariant | 0;
  }
  if (S._kickT > 0) { S._kickT += dt / 0.42; if (S._kickT >= 1) S._kickT = 0; }
  S._kickPrev = !!f.kick;
  if (f.punchL && !S._punchPrev) {
    S._punchT = 0.001;
    S._punchVar = f.punchVariant | 0;
  }
  if (S._punchT > 0) { S._punchT += dt / 0.30; if (S._punchT >= 1) S._punchT = 0; }
  S._punchPrev = !!f.punchL;
  if (f.jump && !S._jumpPrev) S._jumpT = 0.001;
  if (S._jumpT > 0) { S._jumpT += dt / 0.58; if (S._jumpT >= 1) S._jumpT = 0; }
  S._jumpPrev = !!f.jump;

  // ── LEGS ──────────────────────────────────────────────────
  // Saints-Row-1 gangster locomotion — full procedural walk / jog /
  // sprint cycles authored directly on the humanoid rig. The old
  // convention (mixer walk clip → legs, procedural → arms) no longer
  // applies to the auto-rigged customizable body which ships without
  // any baked animation clips. Everything below drives the legs
  // FROM SCRATCH using `_walkPhase` — a phase counter advanced by
  // move speed × stride rate.
  //
  // `standWeight` = 1 when stationary, 0 when running — kept for
  // legacy code paths that still fade to the (now dormant) mixer.
  const standWeight = crouch ? 1 : (1 - Math.min(1, moving * 1.4));

  // Advance the walk phase. Stride rate: walk tier 5.5 rad/s, jog
  // ~7.5 rad/s, sprint up to 11 rad/s. `moving` gates the advance
  // so a stationary character freezes its phase at whatever step
  // it was in (rather than the legs continuing to cycle in place).
  const strideRate = walkTier ? 5.5 : (7.5 + run * 3.5);
  S._walkPhase += moving * strideRate * dt;
  // Keep numerically small — no visual effect, just avoids float drift.
  if (S._walkPhase > Math.PI * 2000) S._walkPhase -= Math.PI * 2000;
  const _walkPhase = S._walkPhase;

  let lUpX = 0, lLegX = 0, rUpX = 0, rLegX = 0;
  let rUpY = 0, lUpY = 0;      // Y-axis hip swing (roundhouse / sweep leg)
  let lUpZ = 0, rUpZ = 0;                          // Trendelenburg sway
  let hipsY = 0;                                   // vertical bob

  if (crouch) {
    // REALISTIC SAINTS-ROW-1 CROUCH — athletic squat with knees
    // clearly bulging FORWARD over the toes.
    //
    // SIGN CONVENTION (verified via MeshyLab RIGHT camera Feb 2026):
    // With `cloneRoot.rotation.y = π` the character's FACE points
    // world −Z. The upper-leg bone's local X axis is aligned such
    // that NEGATIVE lUpX / rUpX rotates the knee toward the face
    // (character-forward). Earlier positive values were bending the
    // knees BEHIND the character — the mirror of what we wanted.
    //
    // Values: thigh forward ~50° (knee well ahead of hip), knee
    // bend ~85° so the shin rotates back to keep the foot roughly
    // under the body's centre of mass. Hip drop matched to the
    // vertical shortening from bending.
    const breath = Math.sin(t * 2.6) * 0.008;
    // Sign applied via `_legForwardSign` so the crouch reads
    // correctly on both Meshy (-1 = forward) and auto-rig (+1 =
    // forward) conventions — see the detection block in the
    // rig-attach code above.
    lUpX = rUpX = _legForwardSign * 0.85;            // thigh forward ~49°
    lLegX = rLegX = 1.45;                            // knee bend ~83° (opposite sign, folds shin back)
    lUpZ =  0.18;                                    // wider fighting stance
    rUpZ = -0.18;
    hipsY = -0.55 + breath;                          // deeper drop, feet planted
  } else if (moving >= 0.15) {
    // ── SAINTS-ROW-1 WALK / JOG / SPRINT CYCLE ─────────────────
    // Phase 0 = right leg mid-swing FORWARD, left leg planted BACK.
    // Phase π = left leg forward, right leg back. Cycles alternately.
    //
    // Signs: NEGATIVE lUpX / rUpX rotates the knee TOWARD character-
    // forward (same sign convention as the crouch pose above,
    // verified via MeshyLab RIGHT-camera). So a leg swinging forward
    // in the cycle uses negative upleg-X.
    const cWalk = Math.cos(_walkPhase);              // +1 → right leg peak-forward
    const sWalk = Math.sin(_walkPhase);              // used for hip roll / arm swing
    // Stride amplitude — larger for sprint, smaller for walk tier.
    // Values chosen for readable silhouette from the third-person
    // camera without going full-Naruto-run.
    const stride  = walkTier ? 0.45 : (0.55 + run * 0.55);   // 0.45 walk, 0.55 jog, 1.10 sprint
    const kneeAmp = walkTier ? 0.55 : (0.80 + run * 0.75);   // more knee lift at sprint
    // Thigh pitch — right leg forward when cWalk=+1, left when cWalk=-1.
    // `_legForwardSign` selects the rig's convention: -1 for the
    // shipped Meshy warrior (negative rotation = forward), +1 for
    // auto-rigged custom characters (positive rotation = forward).
    // Detected once at rig-attach time via a dry-rotation test.
    rUpX = _legForwardSign * cWalk * stride * moving;
    lUpX = _legForwardSign * -cWalk * stride * moving;
    // Knee bend — kicks in during the SWING PHASE of each leg (when
    // the leg is off the ground moving forward). Right leg swings
    // through phase near 0 (cWalk near +1), left near π (cWalk near -1).
    rLegX = Math.max(0,  cWalk) * kneeAmp * moving;
    lLegX = Math.max(0, -cWalk) * kneeAmp * moving;
    // SR1 GANGSTER HIP ROLL — pronounced side-to-side sway on the
    // walk cycle. Fades OUT at sprint speed (real sprinters don't
    // pimp-walk). Both legs shift together so the whole pelvis
    // rocks left/right — that classic Playa Boss shoulder-lean look.
    const gangsterRoll = sWalk * 0.20 * moving * (1 - run * 0.55);
    lUpZ = gangsterRoll;
    rUpZ = gangsterRoll;
    // Vertical hip bob — TWICE the step frequency (character dips
    // during each single-support phase). Amplitude authored in
    // Meshy's 100× space; `_deltaScale` neutralises it on the
    // auto-rig at hip-application below.
    hipsY = -(0.5 - 0.5 * Math.cos(_walkPhase * 2)) * (0.30 + run * 0.40) * moving;
  } else if (standWeight > 0.05 && moving < 0.15) {
    // ── SAINTS-ROW-1 GANGSTER IDLE ──────────────────────────────
    // Standing weight-shift with the swagger of a Stilwater Playa —
    // slight side-to-side hip lean at ~0.9 Hz, subtle micro-breath
    // at 2.4 Hz, plus occasional cocky idle-break (shoulder shrug /
    // neck tilt) rolled every 4-8s and layered on for ~1.2s.
    //
    // The hip lean uses ONE-SIDED weight (only rUpZ or lUpZ at a
    // time), producing the alternating hip-drop that reads as
    // "I'm relaxed, but I'll fuck you up" rather than a stiff mannequin.
    const swayPhase = Math.sin(t * 0.9);
    const hipLean = swayPhase * 0.12 * standWeight;
    // POSITIVE lean → weight on RIGHT foot → LEFT hip drops (Trendelenburg).
    // The upleg Z rotation tilts the thigh sideways, dropping that
    // side of the pelvis — matches how humans actually stand.
    lUpZ = -hipLean;
    rUpZ = -hipLean;
    // Micro breath on vertical hips (authored in Meshy 100× space).
    hipsY = Math.sin(t * 2.4) * 0.008 * standWeight;
    // Countdown to next cocky idle break. Roll a random variant
    // (0=shoulder shrug, 1=neck side-tilt, 2=stretch nod) on trigger.
    S._idleBreakT -= dt;
    if (S._idleBreakT <= 0 && S._idleBreakActive <= 0) {
      S._idleBreakActive = 1.0;                         // 1.2s window (drains at 0.83/s)
      S._idleBreakT = 4 + Math.random() * 4;            // next break in 4-8s
    }
    if (S._idleBreakActive > 0) S._idleBreakActive = Math.max(0, S._idleBreakActive - dt * 0.83);
  }
  // Jump — tuck feet under body.
  if (S._jumpT > 0) {
    const p = S._jumpT;
    const arc = Math.sin(p * Math.PI);
    hipsY += arc * 0.85;
    lUpX += 0.9 * arc;
    rUpX += 0.9 * arc;
    lLegX += -1.4 * arc;
    rLegX += -1.4 * arc;
  }
  // ── LIU KANG KICK VARIANTS ────────────────────────────────
  // Rising-edge captures the variant. Curves vary per variant:
  //   0 FRONT KICK  — right leg thrusts straight forward at
  //                   waist-to-chest height, shin fully extended.
  //   1 ROUNDHOUSE  — right leg swings around from the side, hip
  //                   rotates OUT (Y-axis) so the foot arcs
  //                   horizontally across the target's face.
  //   2 AXE KICK    — right leg raises HIGH overhead then chops
  //                   straight down (asymmetric curve so the peak
  //                   isn't at p=0.5).
  // Standing leg (LEFT) always plants + rolls slightly so the
  // character doesn't look like they're kicking from thin air.
  if (S._kickT > 0) {
    const p = S._kickT;
    const arc = Math.sin(p * Math.PI);         // symmetric sine, peaks at p=0.5
    if (S._kickVar === 1) {
      // ROUNDHOUSE — thigh lifts moderately AND swings out to the
      // right (hip Y rotation), so the shin sweeps a horizontal arc.
      // A dash of spineTilt (below, in the arms) leans the torso
      // opposite for balance.
      rUpX += -1.10 * arc;                     // thigh forward
      rUpY += -1.20 * arc;                     // swing around body (character's L→R)
      rLegX += -0.20 * arc;                    // shin trails slightly forward
      lUpZ += 0.15 * arc;                      // planted foot pivots
      hipsY += 0.05 * arc;                     // brief hip lift on the swing
    } else if (S._kickVar === 2) {
      // AXE KICK — asymmetric: leg RISES fast in the first third
      // (raise phase), then FALLS quickly in the last two-thirds
      // (chop phase). Use a piecewise curve for the sharp descent.
      const rise = p < 0.35 ? (p / 0.35) : 1.0;
      const fall = p > 0.35 ? 1 - ((p - 0.35) / 0.65) : 1.0;
      const height = rise * fall;              // 0 → 1 → 0 with sharp middle
      rUpX += -2.55 * height;                  // very high raise
      rLegX += -0.05 * arc;                    // near-straight leg
      lUpZ += 0.18 * arc;                      // planted foot leans back
    } else {
      // FRONT KICK (default) — straight forward thrust at gut/chest
      // height. Uses the same arc but larger raise + slight shin
      // extension for a piston-like feel.
      rUpX += -1.85 * arc;
      rLegX += -0.10 * arc;                    // shin extends slightly past thigh
      lUpZ += 0.12 * arc;
    }
  }
  // ── LIU-KANG FLYING KICK OVERRIDE ─────────────────────────
  // While the special is active, the leg pose is DOMINANT — right
  // leg fully extended forward at hip height, left leg swept back,
  // torso leaned slightly forward into the flight direction. The
  // ARM handling below (see arm section) will layer a matching
  // back-swept guard.
  const flyKickT = f.flyKickT || 0;
  if (flyKickT > 0) {
    const p = 1 - Math.min(1, flyKickT / 0.60);            // 0 → 1 across the flight
    const hold = Math.min(1, p * 3);                        // reach extension fast in first third
    const retract = Math.max(0, 1 - Math.max(0, (p - 0.75) * 4));  // pull back at end
    const ext = hold * retract;                             // 0 → 1 → 0 with a hold in the middle
    // Right leg extends STRAIGHT out along character-forward.
    rUpX = -1.55 * ext;                                     // thigh horizontal forward
    rLegX = -0.05 * ext;                                    // shin nearly straight
    rUpZ = 0;
    // Left leg tucks back / behind so silhouette reads as a leap.
    lUpX = 0.55 * ext;                                      // thigh angles back
    lLegX = 1.10 * ext;                                     // shin folds up (heel to butt)
    lUpZ = 0;
    // Body pitches slightly forward for balance.
    br(boneMap.Spine02, -0.15 * ext, 0, 0, k);
    br(boneMap.Spine01, -0.12 * ext, 0, 0, k);
  }
  // ── VAULT OVER OBSTACLE ─────────────────────────────────
  // `f.vaulting` ∈ [0..1] tracks the vault animation progress.
  // Sub-phases mirror the engine's trajectory:
  //   MOUNT  (0.00..0.35) — hands reach forward+up, hips rise, knees tuck
  //   PIVOT  (0.35..0.70) — body arcs OVER the obstacle, legs sweep
  //                          around, upper body leans forward
  //   DISMOUNT (0.70..1.00) — legs uncurl to prepare for landing
  // The pose fully overrides the leg + spine deltas so the vault
  // reads clean regardless of walk-clip contribution (mixer is
  // already gated to 0 by the vault's velX/velZ = 0 → moving = 0).
  const vaultU = Math.max(0, Math.min(1, f.vaulting || 0));
  if (vaultU > 0.001) {
    const mount = vaultU < 0.35 ? (vaultU / 0.35) : 1.0;
    const pivot = vaultU >= 0.35 && vaultU < 0.7 ? ((vaultU - 0.35) / 0.35) : (vaultU >= 0.7 ? 1.0 : 0.0);
    const dismount = vaultU >= 0.7 ? ((vaultU - 0.7) / 0.30) : 0.0;
    const knee = 1 - dismount * 0.7;                          // knees tucked most of the vault
    // Legs: tuck under body during the arc, uncurl at the end.
    lUpX = -1.20 * knee;                                       // thigh forward (into tuck)
    rUpX = -1.20 * knee;
    lLegX = 1.80 * knee;                                       // shin folded back
    rLegX = 1.80 * knee;
    lUpZ = 0; rUpZ = 0;
    hipsY = 0.05 * mount + 0.10 * pivot - 0.05 * dismount;     // small hip lift over the top
    // Torso pitch forward during mount+pivot so the character reads
    // "diving over" — return upright as dismount completes.
    const spineLean = -0.55 * mount * (1 - dismount);
    br(boneMap.Spine02, spineLean * 0.5, 0, 0, k);
    br(boneMap.Spine01, spineLean * 0.4, 0, 0, k);
    br(boneMap.Spine,   spineLean * 0.3, 0, 0, k);
    // Arms: reach forward + up to plant hands on the fence top.
    // MOUNT phase forces both shoulders forward; PIVOT holds; DISMOUNT
    // releases so arms sail past the body.
    const armReach = mount * (1 - dismount * 0.6);
    // Shoulder pitch forward + slight abduction. `LeftArm` /
    // `RightArm` are the shoulder rotators in our humanoid template;
    // the shipped Meshy rig uses the same convention.
    br(boneMap.LeftArm  || boneMap.LeftShoulder,  -1.75 * armReach, 0,  0.30 * armReach, k);
    br(boneMap.RightArm || boneMap.RightShoulder, -1.75 * armReach, 0, -0.30 * armReach, k);
    // Elbows lightly bent so hands don't rocket past the fence.
    br(boneMap.LeftForeArm,  0, 0.20 * armReach, 0, k);
    br(boneMap.RightForeArm, 0, -0.20 * armReach, 0, k);
  }
  // ── KNOCKED DOWN (pipe bomb impact) ─────────────────────
  // `f.knocked` counts DOWN from ~1.6s to 0. The character mesh
  // reads as flat-on-back the first ~1.2s, then rolls to their
  // side / props up on an elbow as the timer runs out. Legs
  // pinwheel briefly to sell the impact.
  const knockU = Math.max(0, Math.min(1.6, f.knocked || 0)) / 1.6;
  if (knockU > 0.001) {
    // Progress from 1 (just hit) → 0 (getting up).
    const proneW = knockU;                              // strength of prone override
    // Pin the character SUPINE — torso rotates backward ~85°.
    // We can't rotate the whole rig via bones alone (that's a
    // Group.rotation job), so we lay the spine flat instead by
    // stacking large -X rotations on the spine chain.
    br(boneMap.Spine,   -1.20 * proneW, 0, 0, k);
    br(boneMap.Spine01, -0.40 * proneW, 0, 0, k);
    br(boneMap.Spine02, -0.30 * proneW, 0, 0, k);
    br(boneMap.Neck,     0.30 * proneW, 0, 0, k);       // head tucks
    // Legs splay wide, knees slightly bent.
    lUpX = -0.55 * proneW;
    rUpX = -0.55 * proneW;
    lUpZ = -0.35 * proneW;                              // splay outward
    rUpZ =  0.35 * proneW;
    lLegX = 0.60 * proneW;
    rLegX = 0.60 * proneW;
    hipsY = -0.55 * proneW;                             // hips drop to floor
    // Arms splayed limp beside the body.
    br(boneMap.LeftArm  || boneMap.LeftShoulder,  0.30 * proneW, 0,  0.85 * proneW, k);
    br(boneMap.RightArm || boneMap.RightShoulder, 0.30 * proneW, 0, -0.85 * proneW, k);
    br(boneMap.LeftForeArm,  0, -0.25 * proneW, 0, k);
    br(boneMap.RightForeArm, 0,  0.25 * proneW, 0, k);
  }

  br(boneMap.LeftUpLeg,  lUpX, lUpY, lUpZ, k);
  br(boneMap.RightUpLeg, rUpX, rUpY, rUpZ, k);
  br(boneMap.LeftLeg,    lLegX, 0, 0, k);
  br(boneMap.RightLeg,   rLegX, 0, 0, k);
  if (boneMap.Hips) {
    // hipsY is authored in Meshy's LOCAL bone space (100× units).
    // _deltaScale rescales that authored delta to the current rig's
    // local space so the WORLD hip drop reads the same on both the
    // 0.01× Meshy warrior and the 1× auto-rigged custom body. Without
    // this the auto-rig character's hips would drop 100× too far and
    // sink through the floor (aka the "flip-floppity" glitch).
    const target = _rest.Hips_y + hipsY * _deltaScale;
    boneMap.Hips.position.y = boneMap.Hips.position.y + (target - boneMap.Hips.position.y) * k;
  }
  // NOTE (Feb 2026): A base crouch group drop was briefly added
  // here to fix "character floats while crouching" out of the box,
  // but existing PoseLab overrides had already been hand-tuned
  // with per-weapon `crouchDepth` values (up to −0.8 for AK47 +
  // crouch) — stacking those with a fixed base drop sunk the
  // Saint through the floor. crouchDepth stays PoseLab-driven so
  // users have full per-weapon-per-pose control.

  // ── TORSO / SPINE ─────────────────────────────────────────
  // Saints-Row-1 gangster carriage — light forward lean when
  // running, tall-and-centered when idle. SPINE COUNTER-TWIST
  // during walk/run: the shoulders rotate opposite to the hips
  // (physiologically correct locomotion — arm-swing torso).
  // Sprint = -0.24 lean; walk = -0.08.
  const targetLean = (moving > 0.2 && !crouch) ? (0.08 + run * 0.24) : (crouch ? 0.18 : 0);
  // Idle: subtle 0.7 Hz twist. Walking: counter-rotate to hips
  // (walk phase = 0 → right leg forward → left shoulder should be
  // forward → +Y twist on the chest, − on the pelvis).
  let torsoTwist = 0;
  if (moving >= 0.15 && !crouch) {
    // cos(_walkPhase) tracks right-leg-forward. Positive twist =
    // rotate torso to character's LEFT = left shoulder forward.
    torsoTwist = Math.cos(_walkPhase) * 0.22 * moving * (0.65 + run * 0.4);
  } else {
    torsoTwist = standWeight * Math.sin(t * 0.7) * 0.04;
  }
  br(boneMap.Spine,   targetLean * 0.35, torsoTwist * 0.35, 0, k);
  br(boneMap.Spine01, targetLean * 0.35, torsoTwist * 0.35, 0, k);
  br(boneMap.Spine02, targetLean * 0.30, torsoTwist * 0.30, 0, k);
  // SR1 IDLE BREAK — periodic cocky shoulder-roll / chest-out.
  // Rolls a variant on trigger; adds a brief spine sway on top of
  // the idle sway. `_idleBreakActive` fades naturally over ~1.2s.
  if (S._idleBreakActive > 0 && moving < 0.15 && !crouch) {
    const bw = Math.sin(S._idleBreakActive * Math.PI);      // 0→1→0
    // Chest lifts + shoulder-roll offset — stacks on the sway.
    br(boneMap.Spine02, -0.10 * bw, 0.06 * bw, 0, k);
    br(boneMap.Chest || boneMap.Spine01, -0.08 * bw, 0.05 * bw, 0, k);
  }

  // ── HEAD / NECK ────────────────────────────────────────────
  const aimPitch = (f.pitch || 0) * 0.6;
  const headTilt = crouch ? 0.20 : 0;
  // Idle look-around after ~0.4s of no input — SR1 characters
  // glance around when standing still. Walking: subtle head bob
  // 2× step frequency (nod on each footfall). Counter-yaw slightly
  // opposite to shoulder twist so the head stays visually
  // "focused forward" while the body walks.
  let headY = 0, headX = 0;
  if (moving >= 0.15 && !crouch) {
    headX = Math.abs(Math.sin(_walkPhase)) * 0.05 * moving;   // small nod
    headY = -torsoTwist * 0.4;                                 // opposite to torso
  } else {
    headY = S._idleT > 0.4 ? Math.sin(t * 0.45) * 0.20 : 0;
  }
  br(boneMap.Neck || boneMap.neck, aimPitch * 0.4 + headTilt * 0.5 + headX * 0.6, headY * 0.5, 0, k);
  br(boneMap.Head, aimPitch * 0.6 + headTilt * 0.5 + headX * 0.4, headY * 0.5, 0, k);

  // ── ARMS (Feb 2026 refactor — pointBoneAt world-direction) ───
  // AAA arm posing driven by directly aiming each shoulder bone's
  // along-axis (local +Y) at a WORLD-space direction vector. This
  // sidesteps the Meshy rig's asymmetric arm rest quaternions that
  // made the previous world-Euler `armWorld` approach fold the arms
  // backward into the shoulders when trying to aim forward.
  //
  // `_armCharFwd` is the character's world-forward vector (group's
  // −Z transformed to world — the direction the character faces).
  // `_armCharRight` is world-right (character's own right side,
  // where the shooting hand rests when unarmed).
  group.getWorldQuaternion(_armGroupQ);
  _armCharFwd.set(0, 0, -1).applyQuaternion(_armGroupQ).normalize();
  _armCharRight.crossVectors(_armCharFwd, WORLD_Y).normalize();

  const armed = (curCat === 'sideways' || curCat === 'rifle' || curCat === 'shotgun_carry' || curCat === 'shoulder');
  // Two-handed: category-based default, overridable per-weapon via
  // Weapon Lab (`twoHanded` flag on the offset). When an admin has
  // saved a calibration for this specific weapon, trust its flag;
  // otherwise fall back to category-based auto-detection.
  let twoHanded = (curCat === 'rifle' || curCat === 'shotgun_carry' || curCat === 'shoulder');
  if (armed && hasWeaponOffset(curWeapon)) {
    twoHanded = !!getWeaponOffset(curWeapon).twoHanded;
  }

  // Direction targets — each is a full world vector pointing where
  // the corresponding arm's HAND should be relative to the shoulder.
  let rDir = null, lDir = null;
  let rForeX = 0, lForeX = 0;

  if (armed) {
    // AIM POSE — right arm points along character forward (barrel
    // direction), pitched up/down with the look direction.
    _armRDir.copy(_armCharFwd);
    _armRDir.y += -aimPitch * 0.9;                       // pitch tilts forward vec
    rDir = _armRDir.normalize();
    rForeX = 0.20;                                       // near-straight aiming arm
    if (twoHanded) {
      // Two-handed: left hand reaches OUT along the barrel and slightly
      // across toward the right (fore-grip position).
      _armLDir.copy(_armCharFwd).multiplyScalar(0.85)
        .addScaledVector(_armCharRight, 0.28);
      _armLDir.y += -aimPitch * 0.7 - 0.08;
      lDir = _armLDir.normalize();
      lForeX = 0.85;
    } else {
      // Pistol grip — left hand cradles behind right, bent tight.
      _armLDir.copy(_armCharFwd).multiplyScalar(0.55)
        .addScaledVector(_armCharRight, 0.22);
      _armLDir.y += -aimPitch * 0.5 - 0.15;
      lDir = _armLDir.normalize();
      lForeX = 1.35;
    }
  } else {
    // KUNG-FU IDLE — arms hang naturally down. Right hangs straight,
    // left offers a subtle Wing-Chun guard (tan-sao) tilt forward.
    const breath = Math.sin(t * 2.4) * 0.03 * standWeight;
    _armRDir.set(0, -1, 0.04);
    rDir = _armRDir.normalize();
    rForeX = 0.25;
    _armLDir.set(0, -0.95, 0)
      .addScaledVector(_armCharFwd, 0.18 * standWeight);
    lDir = _armLDir.normalize();
    lForeX = 0.85 * standWeight + breath;
  }

  // Idle breathing for armed idle (subtle up-down bob on aim vector).
  if (armed && moving < 0.2 && !firing && !crouch) {
    const breath = Math.sin(t * 2.4) * 0.02;
    if (rDir) { rDir.y += breath; rDir.normalize(); }
    if (lDir) { lDir.y += breath * 0.8; lDir.normalize(); }
  }
  // Firing recoil — nudge right arm slightly outward.
  if (firing && armed && rDir) {
    rDir.addScaledVector(_armCharRight, 0.06);
    rDir.y += 0.03;
    rDir.normalize();
    rForeX += 0.18;
  }
  // ── LIU KANG PUNCH VARIANTS ────────────────────────────────
  // Each variant plays a distinct animation curve so a combo
  // reads visually as jab → cross → hook → uppercut instead of
  // one repeated arm-swing.
  //   0 JAB       — fast straight arm, minimal shoulder rotation,
  //                 fully retracts by end (used in a 1-2 combo)
  //   1 CROSS     — the back arm rotates through the body's center
  //                 line, whole shoulder pivots for maximum reach
  //   2 HOOK      — arm swings HORIZONTALLY around the body with a
  //                 90° elbow; motion arcs INWARD (like Liu Kang's
  //                 "high punch" in MK3)
  //   3 UPPERCUT  — arm launches from waist to overhead in a
  //                 vertical arc, spine leans into the rise
  if (S._punchT > 0) {
    const p = S._punchT;
    const arc = Math.sin(p * Math.PI);
    if (S._punchVar === 1) {
      // CROSS — right arm punches THROUGH centerline, torso rotates
      // to give the shoulder maximum reach + power (spineTilt handled
      // as a small twist elsewhere; here we shift the arm direction).
      _armRDir.copy(_armCharFwd).multiplyScalar(arc * 1.05)
        .addScaledVector(_armCharRight, -0.15 * arc);   // punches ACROSS midline
      _armRDir.y = -0.05 - (1 - arc) * 0.55;
      rDir = _armRDir.normalize();
      rForeX = 0.05 * arc + 0.9 * (1 - arc);
      _armLDir.copy(_armCharFwd).multiplyScalar(0.20)
        .addScaledVector(_armCharRight, 0.35);
      _armLDir.y = -0.5;
      lDir = _armLDir.normalize();
      lForeX = 1.75;                                    // left arm cocked back tight
    } else if (S._punchVar === 2) {
      // HOOK — right arm swings horizontally around the body. Aim
      // vector arcs from RIGHT (character's right) through FORWARD
      // to LEFT-of-center, like a horizontal windshield-wipe.
      // Elbow stays deeply bent (90°+) throughout — signature hook.
      const swing = Math.sin(p * Math.PI * 0.7);        // starts wide, sweeps in
      _armRDir.copy(_armCharRight).multiplyScalar(0.9 - 1.1 * arc)   // R → mid
        .addScaledVector(_armCharFwd, 0.5 + 0.4 * arc);
      _armRDir.y = 0.05 - swing * 0.10;
      rDir = _armRDir.normalize();
      rForeX = 1.55 - 0.20 * arc;                       // tight-elbow hook
      _armLDir.copy(_armCharFwd).multiplyScalar(0.25)
        .addScaledVector(_armCharRight, 0.30);
      _armLDir.y = -0.55;
      lDir = _armLDir.normalize();
      lForeX = 1.85;                                    // left arm tucked in guard
    } else if (S._punchVar === 3) {
      // UPPERCUT — arm launches from below the waist UP to overhead
      // in a vertical arc. Aim vector rises sharply, spine leans
      // back slightly at peak. Elbow straightens to snap the fist up.
      const rise = arc;
      _armRDir.copy(_armCharFwd).multiplyScalar(0.4 + 0.3 * rise)
        .addScaledVector(_armCharRight, -0.05 * rise);
      _armRDir.y = -0.85 + rise * 1.55;                 // waist → up-above-head
      rDir = _armRDir.normalize();
      rForeX = 1.35 - 1.1 * rise;                       // straighten as it rises
      br(boneMap.Spine02, -0.15 * rise, 0, 0, k);       // torso tilts back at peak
      _armLDir.copy(_armCharFwd).multiplyScalar(0.20)
        .addScaledVector(_armCharRight, 0.25);
      _armLDir.y = -0.60;
      lDir = _armLDir.normalize();
      lForeX = 1.75;
    } else {
      // JAB (default 0) — fast straight arm, minimal body rotation.
      // The right hand snaps out in the character's forward direction
      // then retracts back to guard before the timer expires.
      _armRDir.copy(_armCharFwd).multiplyScalar(arc)
        .add(_armCharRight.clone().multiplyScalar(-0.05));
      _armRDir.y = -0.15 - (1 - arc) * 0.7;             // fold down at rest, level at peak
      rDir = _armRDir.normalize();
      rForeX = 0.10 * arc + 0.9 * (1 - arc);            // straighten at peak
      _armLDir.copy(_armCharFwd).multiplyScalar(0.35)
        .addScaledVector(_armCharRight, 0.15);
      _armLDir.y = -0.55;
      lDir = _armLDir.normalize();
      lForeX = 1.55;
    }
  }
  // ── LIU-KANG FLYING KICK ARM SWEEP ─────────────────────────
  // Arms swept BACK (opposite direction to the kick foot) so the
  // silhouette forms a horizontal line: extended-leg forward, arms
  // back for counter-balance. Elbows near-straight so the arms
  // trail like wings.
  const flyKickTArm = f.flyKickT || 0;
  if (flyKickTArm > 0) {
    const p = 1 - Math.min(1, flyKickTArm / 0.60);
    const hold = Math.min(1, p * 3);
    const retract = Math.max(0, 1 - Math.max(0, (p - 0.75) * 4));
    const ext = hold * retract;
    // Sweep both arms behind — direction = character-backward (−fwd)
    // slightly outward for the classic MK-Liu-Kang silhouette.
    _armRDir.copy(_armCharFwd).multiplyScalar(-0.9 * ext)
      .addScaledVector(_armCharRight, 0.35 * ext);
    _armRDir.y = 0.15 * ext;
    rDir = _armRDir.normalize();
    rForeX = 0.15;                            // near-straight arm
    _armLDir.copy(_armCharFwd).multiplyScalar(-0.9 * ext)
      .addScaledVector(_armCharRight, -0.35 * ext);
    _armLDir.y = 0.15 * ext;
    lDir = _armLDir.normalize();
    lForeX = 0.15;
  }
  // PIMP-SLAP wide horizontal arc + body pirouette.
  // PIMP-SLAP wide horizontal arm arc.
  //
  // NOTE: no forced group Y-rotation here anymore. The user drives
  // the body spin via their aim stick / mouse — the engine boosts
  // the yaw follow-rate while `slapSpinT > 0` so a fast flick of
  // the stick can whip the character through a full 360° (or any
  // partial angle) manually. This preserves the AAA arm/spine
  // animation while giving the player TOTAL control of how far
  // and how hard they swing.
  const slapSpinT = f.slapSpinT || 0;
  if (slapSpinT > 0) {
    const dur = 0.55;
    const p = 1 - Math.min(1, slapSpinT / dur);       // 0 → 1 across the swing
    const dir = f.slapSpinDir || 1;
    // Right arm swings outward horizontally in slap direction.
    _armRDir.copy(_armCharRight).multiplyScalar(dir * (0.6 + 0.4 * p))
      .addScaledVector(_armCharFwd, 0.4);
    _armRDir.y = 0.05;
    rDir = _armRDir.normalize();
    rForeX = 0.15;
    _armLDir.copy(_armCharFwd).multiplyScalar(0.30)
      .addScaledVector(_armCharRight, -0.30);
    _armLDir.y = -0.5;
    lDir = _armLDir.normalize();
    lForeX = 1.55;
  }
  // KICK doesn't affect arms directly.

  // EATING (heal) — right hand rises up-and-across to the face.
  if (f.eating) {
    _armRDir.set(0, 0.8, 0)
      .addScaledVector(_armCharFwd, 0.18)
      .addScaledVector(_armCharRight, -0.20);            // toward mouth (across body)
    rDir = _armRDir.normalize();
    rForeX = 2.35;                                       // deep elbow bend — hand meets face
    _armLDir.set(0, -0.95, 0)
      .addScaledVector(_armCharFwd, 0.05);
    lDir = _armLDir.normalize();
    lForeX = 0.55;
    br(boneMap.Head, 0.24, 0, 0, k);
    br(boneMap.Spine02, 0.10, 0, 0, k);
  }

  // ── SR1 WALK-CYCLE ARM SWING ──────────────────────────────
  // Add a forward/backward swing offset to each arm direction so
  // both arms pump in counter-rotation to the legs when locomoting.
  // Right arm swings BACK when right leg swings FORWARD (physiological
  // opposite-arm gait). Skipped during firing/punching/other overrides
  // that need arm-lock — the swing is superimposed on the pose logic
  // above by nudging the direction vector before pointBoneAt applies it.
  const canSwingArms = moving >= 0.15 && !crouch && !firing
    && S._punchT === 0 && S._kickT === 0 && (f.flyKickT || 0) === 0
    && vaultU < 0.001 && knockU < 0.001 && f.deadT === 0;
  if (canSwingArms && rDir && lDir) {
    const cWalkArm = Math.cos(_walkPhase);
    // Swing amplitude scales with move speed + run factor. Right
    // arm swings LESS when holding a gun (armed) so the barrel
    // stays roughly on-target while the left arm pumps freely.
    const swingAmp = (walkTier ? 0.35 : (0.55 + run * 0.30)) * moving;
    const rSwing = -cWalkArm * swingAmp * (armed ? 0.25 : 1.0);
    const lSwing =  cWalkArm * swingAmp;
    // Add forward-vector nudge: positive amount = arm forward,
    // negative = arm back. Then re-normalise (arm direction should
    // always be a unit vector for pointBoneAt).
    rDir.addScaledVector(_armCharFwd, rSwing).normalize();
    lDir.addScaledVector(_armCharFwd, lSwing).normalize();
  }

  // Apply the world-direction arm poses (smoothed inside pointBoneAt).
  pointBoneAt(boneMap.RightArm, rDir, k);
  pointBoneAt(boneMap.LeftArm,  lDir, k);
  // Elbow bend uses LOCAL X — the forearm's local X axis is the
  // hinge axis for both arms since ForeArm bones are children of
  // Arm bones (which we've now oriented via pointBoneAt), so their
  // local frame follows the arm.
  br(boneMap.RightForeArm, rForeX, 0, 0, k);
  br(boneMap.LeftForeArm,  lForeX, 0, 0, k);
  // Add elbow FLEX during arm swing — the trailing arm bends slightly
  // (real gait: the back-swinging arm has a bent elbow, the forward-
  // swinging one is more extended). Amount is smaller than the main
  // elbow control so it doesn't fight punch/reload animations.
  if (canSwingArms) {
    const cArmFlex = Math.cos(_walkPhase);
    const flexAmp = (0.30 + run * 0.20) * moving;
    // Right elbow flexes when right arm is BACK (cWalk=+1 → rSwing<0 → arm back).
    br(boneMap.RightForeArm, Math.max(0,  cArmFlex) * flexAmp * (armed ? 0.15 : 1.0), 0, 0, k);
    br(boneMap.LeftForeArm,  Math.max(0, -cArmFlex) * flexAmp, 0, 0, k);
  }

  // ── HAND CURL (grip approximation) ────────────────────────
  // The shipped Meshy warrior skeleton contains only 24 joints
  // (Hips → toes, no finger bones), so we can't articulate
  // individual digits. Instead we rotate the ENTIRE HAND BONE
  // around its bend axis to approximate a fist / trigger grip:
  //   • punching → hand curls forward tightly (closed fist)
  //   • armed    → mild curl so the hand reads as "gripping"
  //   • idle     → hand relaxes to rest
  // Full finger rigging would require re-exporting the GLB with
  // finger bones — flagged to the user in the follow-up notes.
  let rHandCurl = 0, lHandCurl = 0;
  if (S._punchT > 0) {
    // Peak curl during the extended-fist portion of the jab.
    const p = S._punchT;
    const arc = Math.sin(p * Math.PI);
    rHandCurl = 0.95 * arc;
    lHandCurl = 0.90;                                // guard hand fully closed
  } else if (armed) {
    rHandCurl = 0.55;                                // trigger grip on right
    lHandCurl = 0.45;                                // foregrip / support on left
  } else if (curCat === 'fist' || curWeapon === 'pimpslap') {
    rHandCurl = 0.75;                                // kung-fu ready fists
    lHandCurl = 0.75;
  } else if (curCat === 'bat') {
    rHandCurl = 0.85;                                // bat two-handed grip
    lHandCurl = 0.85;
  }
  br(boneMap.RightHand, rHandCurl, 0, 0, k);
  br(boneMap.LeftHand,  lHandCurl, 0, 0, k);

  // ── DEV TOOLING (temporary — for iterating on arm poses)
  // window.__meshyDbg = { rArmDir:[x,y,z], lArmDir:[x,y,z],
  //                       rForeX, lForeX, rHandCurl, lHandCurl }
  // Any keys present override the corresponding arm target so we
  // can dial in pose values live from the browser DevTools console.
  // Delete `window.__meshyDbg` to return to the authored poses.
  if (typeof window !== 'undefined' && window.__meshyDbg) {
    const D = window.__meshyDbg;
    if (Array.isArray(D.rArmDir) && D.rArmDir.length >= 3) {
      pointBoneAt(boneMap.RightArm, _armRDir.set(D.rArmDir[0], D.rArmDir[1], D.rArmDir[2]), k);
    }
    if (Array.isArray(D.lArmDir) && D.lArmDir.length >= 3) {
      pointBoneAt(boneMap.LeftArm, _armLDir.set(D.lArmDir[0], D.lArmDir[1], D.lArmDir[2]), k);
    }
    if ('rForeX' in D) br(boneMap.RightForeArm, D.rForeX, 0, 0, k);
    if ('lForeX' in D) br(boneMap.LeftForeArm, D.lForeX, 0, 0, k);
  }

  // Small shoulder shrug on breath (both sides) — only when idle
  // and unarmed. Applied on top of the arm poses.
  if (!crouch && moving < 0.15 && !armed) {
    const breath = Math.sin(t * 1.7) * 0.010;
    br(boneMap.LeftShoulder,  breath, 0, 0, k);
    br(boneMap.RightShoulder, breath, 0, 0, k);
  }

  // ── GUN MOUNT ORIENTATION ──────────────────────────────────
  // Each frame we compute the WORLD direction the arm is currently
  // pointing (ForeArm bone's local +Y = bone-along in world) and
  // orient the gunMount so its LOCAL barrel axis aligns with it.
  //
  // PER-WEAPON BARREL CONVENTION (Feb 2026 audit — verified from
  // MeshyLab FRONT camera in AIM pose):
  //   • pistol / tec9 : barrel along gun-group's local -Z
  //     (verified: pistol visibly points AT the FRONT camera in AIM)
  //   • ak47 / shotgun / rpg : barrel along gun-group's local +Z
  //     (verified: AK/shotgun visibly hide BEHIND the character in
  //      FRONT camera AIM before this per-weapon flip — mesh authoring
  //      is opposite the pistol convention despite the +π/2 vs -π/2
  //      yaw differentiation in gunProp())
  // lookAt(eye, target, up) aligns local -Z with (target-eye), so:
  //   • pistol/tec9 → lookAt(+armFwd)   makes -Z track armFwd ✓
  //   • long guns   → lookAt(-armFwd)   makes -Z track -armFwd,
  //                                     which means +Z tracks +armFwd ✓
  if (boneMap.RightArm && boneMap.RightHand && gunMount.parent === boneMap.RightHand && curCat !== 'melee') {
    const armBone = boneMap.RightForeArm || boneMap.RightArm;
    armBone.getWorldQuaternion(_gunArmQ);
    _gunArmFwd.set(0, 1, 0).applyQuaternion(_gunArmQ).normalize();
    const barrelPlusZ = (curWeapon === 'ak47' || curWeapon === 'shotgun' || curWeapon === 'rpg');
    if (barrelPlusZ) {
      _gunArmFwdNeg.copy(_gunArmFwd).negate();
      _gunLookMat.lookAt(_gunOrigin, _gunArmFwdNeg, _gunWorldUp);
    } else {
      _gunLookMat.lookAt(_gunOrigin, _gunArmFwd, _gunWorldUp);
    }
    _gunTargetWorldQ.setFromRotationMatrix(_gunLookMat);
    boneMap.RightHand.getWorldQuaternion(_gunHandQ);
    gunMount.quaternion.copy(_gunHandQ.invert()).multiply(_gunTargetWorldQ);
  }
}
