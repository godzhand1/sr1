// comptonCharacter.js — UNIVERSAL articulated character loader (iter204).
//
// Built on the identity-bind universal rig (universalRig.js):
//   • The skeleton binds at the mesh's EXACT loaded pose, so at rest
//     the render is pixel-identical to the authored GLB — zero shape
//     change, zero proportion shifts, no vertex edits.
//   • Joint positions come from the actual bounding box, so any GLB
//     the user drops in gets the same treatment.
//   • The ONLY scale applied is a single uniform setScalar (proportion
//     preserving) and a bbox-derived feet-to-ground lift on the
//     wrapper — same guarantees as the iter203 rigid loader.
//   • animate(t, f) drives BOTH layers every frame with absolute
//     writes (safe for the pose-override undo/apply dance):
//       1. whole-body wrapper (bob / sway / lean / dip / recoil / death)
//       2. per-limb bones — hips, knees, ankles, shoulders, elbows,
//          wrists, all 10 fingers, spine, head.
//   • getRig() exposes the applyTuneToRig-compatible rig so PoseLab
//     overrides + view3d auto foot-plant work in-game.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  prepareRigTemplate, instantiateRig, buildTuneRig, loadSavedLayout,
} from './universalRig.js';
import { gunProp } from './characterModel3d.js';
import { loadWeapon } from './objAssets.js';
import { getWeaponOffset } from './weaponOffsets.js';
import {
  gripFor, isGunClass, createAnimState, updateGait, boneLengths, solveTwoBoneIK, solveLegIK, orientBoneWorld, ARM_TUNE,
} from './comptonAnim.js';
import { planLegs } from './legGait.js';

export const COMPTON_GLB_URL = '/models/compton_shadow.glb';
export const COMPTON_MESH_KEY = 'compton_shadow.glb';

// Target on-screen height (metres). Uniform scale only — proportions
// preserved. The Compton GLB is authored at ~1.90 m so the factor is
// ≈0.97 — no visible proportion change.
const TARGET_HEIGHT_M = 1.85;

// Small canvas-backed sprite floating above the head.
function _makeTagSprite(label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 56px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = color || '#c084fc';
  ctx.strokeText(label || '', 256, 48);
  ctx.fillText(label || '', 256, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.3, 0.24, 1);
  s.position.set(0, 2.15, 0);
  return s;
}

function _makeHpBar() {
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0x1a0508, transparent: true, opacity: 0.8, depthTest: false,
  }));
  bg.scale.set(1.3, 0.10, 1);
  bg.position.set(0, 1.98, 0);
  const fill = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xe23030, transparent: true, opacity: 0.95, depthTest: false,
  }));
  fill.scale.set(1.28, 0.08, 1);
  fill.position.set(0, 1.98, 0.001);
  fill.center.set(0.5, 0.5);
  return { bg, fill };
}

// One-shot cache: parsed GLB scene + prepared rig template (weights
// baked ONCE, geometry shared across every character instance).
let _gltfScene = null;
let _template = null;
let _pending = null;

function _buildTemplate() {
  const saved = loadSavedLayout(COMPTON_MESH_KEY);
  return prepareRigTemplate(_gltfScene, saved ? { layout: saved } : {});
}

export function preloadComptonRigid() {
  if (_template) return Promise.resolve(_template);
  if (_pending) return _pending;
  _pending = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      COMPTON_GLB_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) o.material.side = THREE.DoubleSide;
          }
        });
        _gltfScene = scene;
        _template = _buildTemplate();
        resolve(_template);
      },
      undefined,
      (err) => { _pending = null; reject(err); },
    );
  });
  return _pending;
}

// RigLab calls this after saving a new joint layout so the next spawn
// rebuilds the template (re-bakes weights) with the user calibration.
export function resetComptonTemplate() {
  if (_gltfScene) _template = _buildTemplate();
}

// Kick off the load at module import so the first spawn doesn't wait.
preloadComptonRigid().catch(() => { /* engine retries lazily */ });

export function createComptonRigidModel(palette, team, label) {
  const group = new THREE.Group();
  group.userData.compton = true;

  const teamColor = team === 'B' ? '#0ea5e9' : '#c084fc';
  const tag = _makeTagSprite(label || '', teamColor);
  tag.position.y = 2.15;
  group.add(tag);
  const { bg: barBg, fill: barFill } = _makeHpBar();
  barBg.position.y = 1.95;
  barFill.position.y = 1.95;
  group.add(barBg);
  group.add(barFill);

  // Placeholder capsule while the async GLB loads.
  const placeholder = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 1.2, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.35 }),
  );
  placeholder.position.y = 0.9;
  placeholder.userData.isPlaceholder = true;
  group.add(placeholder);

  // `scene` = the animated wrapper; `rig` = applyTuneToRig interface.
  let scene = null;
  let rig = null;
  let inst = null;
  let feetLiftY = 0.95;
  let disposed = false;

  // Weapon / prop mounts — attached to real bones once the rig loads.
  let gunMount = null;      // child of RightHand — holds the gunProp group
  let gunMesh = null;
  let burger = null;        // child of RightHand (burgerMount) — eating prop
  let mouthAnchor = null;   // child of Head — IK target for the burger hand
  let pimpHatGroup = null;  // child of Head — visible while pimpslap owned
  let _curWeapon = 'fist';

  function _applyWeaponOffset() {
    if (!gunMesh) return;
    const off = getWeaponOffset(_curWeapon);
    const gp = gripFor(_curWeapon).grip || [0, 0, 0];
    gunMesh.position.set(-off.grip[0] - gp[0], -off.grip[1] - gp[1], -off.grip[2] - gp[2]);
    gunMesh.rotation.set(off.rotation[0], off.rotation[1], off.rotation[2]);
    gunMesh.scale.set(off.scale[0], off.scale[1], off.scale[2]);
  }

  function _applyWeapon(id) {
    if (!gunMount) return;
    if (gunMesh) {
      gunMount.remove(gunMesh);
      gunMesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      gunMesh = null;
    }
    try {
      gunMesh = gunProp(id);
      gunMount.add(gunMesh);
      _applyWeaponOffset();
      if (rig) rig.gun = gunMesh;
    } catch { /* leave gunMount empty */ }
  }

  // Live re-apply when the admin edits offsets in the Weapon Lab.
  const _onWeaponOffsetChanged = (e) => {
    const wid = e && e.detail ? e.detail.weaponId : null;
    if (!wid || wid === _curWeapon) _applyWeaponOffset();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('sr:weapon-offset-changed', _onWeaponOffsetChanged);
  }

  preloadComptonRigid().then((template) => {
    if (disposed) return;
    group.remove(placeholder);
    if (placeholder.geometry) placeholder.geometry.dispose();
    if (placeholder.material) placeholder.material.dispose();

    inst = instantiateRig(template);
    const bbox = template.bbox;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const height = size.y || 1;

    // Universal auto-scale — UNIFORM only, proportions preserved.
    const targetScale = TARGET_HEIGHT_M / height;
    inst.container.scale.setScalar(targetScale);

    // Feet-to-ground lift from the actual bbox — works for any GLB.
    feetLiftY = -bbox.min.y * targetScale;

    scene = new THREE.Group();
    scene.add(inst.container);
    scene.position.y = feetLiftY;
    scene.rotation.y = Math.PI;   // authored +Z front → back-to-camera at rot 0
    group.add(scene);

    rig = buildTuneRig(inst, scene, template.meta);
    _measureLegs();

    // ── Weapon mount — child of the RightHand bone ──────────────
    // Hand-local frame (identity-bind): +Y runs wrist→knuckles, +Z is
    // the palm normal, +X = Y×Z. The mount maps the gunProp
    // convention (+Z barrel, +Y up) onto (fingers, +X) so the barrel
    // runs along the fingers and the sights point out the back of
    // the thumb side — matching the IK hand orientation (palm inward).
    const bn = inst.byName;
    if (bn.RightHand) {
      gunMount = new THREE.Group();
      gunMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
      gunMount.position.set(0, 0.04, 0.015);
      gunMount.visible = false;
      bn.RightHand.add(gunMount);
      _applyWeapon(_curWeapon);
    }

    // ── Burger (eating prop) — held in the right hand; the IK pass
    // carries the hand to a mouth anchor on the Head bone.
    if (bn.Head) {
      mouthAnchor = new THREE.Group();
      mouthAnchor.position.set(0, 0.045, 0.15);   // in front of the face (+Z front)
      bn.Head.add(mouthAnchor);
      burger = new THREE.Group();
      burger.visible = false;
      burger.position.set(0, 0.05, 0.03);
      if (bn.RightHand) bn.RightHand.add(burger); else mouthAnchor.add(burger);
      loadWeapon('cs_hirezburger.obj').then((geo) => {
        const mat = new THREE.MeshPhongMaterial({ color: 0xd9a45b, shininess: 12, specular: 0x442200 });
        const m = new THREE.Mesh(geo, mat);
        const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
        const len = Math.max(bb.max.x - bb.min.x, 0.001);
        const s = 0.12 / len;
        m.scale.set(s, s, s);
        m.rotation.set(0, Math.PI / 2, 0);
        m.userData.srBurger = true;
        burger.add(m);
      }).catch(() => { /* keep empty anchor */ });

      // ── Pimp hat — shown while the pimpslap pickup is owned ────
      // Group origin sits at the head top; the mesh is lifted by its
      // own bounding box so the hat BASE rests on the cap.
      pimpHatGroup = new THREE.Group();
      pimpHatGroup.visible = false;
      pimpHatGroup.position.set(0, 0.07, 0.01);
      bn.Head.add(pimpHatGroup);
      loadWeapon('pimphat.obj').then((geo) => {
        const mat = new THREE.MeshPhongMaterial({ color: 0x6a2bbf, shininess: 24, specular: 0x4a1e8f, emissive: 0x1a0838, emissiveIntensity: 0.45 });
        const m = new THREE.Mesh(geo, mat);
        const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
        const len = Math.max(bb.max.x - bb.min.x, 0.001);
        const s = 0.42 / len;
        m.scale.set(s, s, s);
        m.position.y = -bb.min.y * s;   // seat the hat base on the group origin
        m.rotation.set(0, Math.PI / 2, 0);
        m.userData.srPimpHat = true;
        pimpHatGroup.add(m);
      }).catch(() => { /* keep empty */ });
    }
  }).catch((err) => {
    if (typeof console !== 'undefined') console.warn('[compton] universal rig load failed:', err);
  });

  // ── Animation state ───────────────────────────────────────────
  const st = createAnimState();
  const _prev = {
    bobY: 0, leanX: 0, leanZ: 0, spinY: 0, dipY: 0,
    recoilKick: 0, jumpLift: 0, reloadLean: 0,
    hurtFlinch: 0, deadPitch: 0, spinZ: 0,
  };
  const BASE_ROT_Y = Math.PI;
  const _L = {};   // lerped limb-channel state
  let _lens = null;
  // Arm-IK request for this frame — solved at the end of animate()
  // and again by view3d's postPose() once pose overrides are applied.
  const _arm = { mode: null };
  const _F = new THREE.Vector3(), _U = new THREE.Vector3(), _R = new THREE.Vector3();
  const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3();
  const _A = new THREE.Vector3(), _Z = new THREE.Vector3(), _W = new THREE.Vector3(), _LF = new THREE.Vector3();
  const _cq = new THREE.Quaternion();

  function _lerp(a, b, k) { return a + (b - a) * k; }
  function _lb(key, target, k) {
    const cur = _L[key] == null ? 0 : _L[key];
    const v = cur + (target - cur) * k;
    _L[key] = v;
    return v;
  }
  const _mix3 = (w, a, b, c) => a * w.walkW + b * w.jogW + c * w.sprintW;

  // ── IK legs — rest geometry in the GROUP frame (feet on y = 0,
  // front −Z, right +X), measured once with the wrapper at neutral.
  let _legRest = null;
  const _legPlan = { L: {}, R: {}, drop: 0 };
  const _gq = new THREE.Quaternion();
  const _LT = new THREE.Vector3(), _LP = new THREE.Vector3(), _LU = new THREE.Vector3(), _LFr = new THREE.Vector3();
  function _measureLegs() {
    const bn = inst && inst.byName;
    if (!bn || !bn.LeftUpLeg || !bn.RightUpLeg || !bn.LeftLeg || !bn.RightLeg || !bn.LeftFoot || !bn.RightFoot) return;
    const sc = inst.container.scale.x;
    // Rest positions in the container frame (identity bind = chain sums),
    // then wrapper: rotate π about Y (x,z → −x,−z), scale, lift to the ground.
    inst.container.updateMatrixWorld(true);
    const toGroup = (bone) => {
      const w = bone.getWorldPosition(new THREE.Vector3());
      inst.container.worldToLocal(w);
      return { x: -w.x * sc, y: w.y * sc + feetLiftY, z: -w.z * sc };
    };
    const local = (bone) => inst.container.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const thigh = local(bn.LeftUpLeg).distanceTo(local(bn.LeftLeg)) * sc;
    const shin = local(bn.LeftLeg).distanceTo(local(bn.LeftFoot)) * sc;
    _legRest = {
      hipL: toGroup(bn.LeftUpLeg), hipR: toGroup(bn.RightUpLeg),
      ankleL: toGroup(bn.LeftFoot), ankleR: toGroup(bn.RightFoot),
      legLen: thigh + shin,
    };
  }

  // Solve hip→knee→ankle for both legs against the planned ground targets
  // and level the feet (heel-strike / toe-off pitch) in WORLD space, so
  // torso lean, pelvis shift and crouch never tilt a planted sole.
  function solveLegs(plan, w) {
    if (!rig || !_legRest || w <= 0.001) return;
    const bn = rig.byName;
    group.updateWorldMatrix(true, false);
    group.getWorldQuaternion(_gq);
    _LFr.set(0, 0, -1).applyQuaternion(_gq);   // front
    _LU.set(0, 1, 0).applyQuaternion(_gq);     // up
    const one = (up, knee, foot, t) => {
      if (!up || !knee || !foot) return;
      _LT.set(t.x, t.y, t.z); group.localToWorld(_LT);
      _LP.copy(_LFr).addScaledVector(_LU, 0.15);          // knee pole: forward, a touch up
      solveLegIK(up, knee, foot, _LT, _LP, w);
      const c = Math.cos(t.pitch || 0), sn = Math.sin(t.pitch || 0);
      _LT.copy(_LU).multiplyScalar(c).addScaledVector(_LFr, -sn);   // foot up
      _LP.copy(_LFr).multiplyScalar(c).addScaledVector(_LU, sn);    // foot front
      orientBoneWorld(foot, _LT, _LP, w);
    };
    one(bn.RightUpLeg, bn.RightLeg, bn.RightFoot, plan.R);
    one(bn.LeftUpLeg, bn.LeftLeg, bn.LeftFoot, plan.L);
  }
  let _legW = 0;           // blend weight of the IK legs this frame

  function animate(t, f) {
    if (!scene || disposed) return;
    f = f || {};
    const g = updateGait(st, f, t || 0);
    const { dt, moving, phase, fwdN, sideN, moveW, walkW, jogW, sprintW, crouchW } = g;
    const K = 1 - Math.exp(-dt * 16);
    // Frame-rate independent version of a "per-60Hz-frame" lerp factor.
    const kf = (k) => 1 - Math.pow(1 - k, dt * 60);
    const firing = !!f.firing;
    const crouch = !!f.crouch;
    const sitting = !!f.sitting;
    const jump  = !!f.jump;
    const kick   = !!f.kick;
    const punchL = !!f.punchL;
    const punchR = !!(f.punchR || f.punchT);
    const blocking = !!f.blocking;
    const eating = !!f.eating;
    const reloading = !!(f.reload || f.reloading || (f.reloadT != null && f.reloadT > 0));
    const wpnId = _curWeapon || f.weapon || 'fist';
    const grip = gripFor(wpnId);
    const cls = grip.cls;
    const dead = !!(f.deadT != null && f.deadT > 0);
    const hurt = !!(f.hurt || (f.hitStunT != null && f.hitStunT > 0));
    const pitch = typeof f.pitch === 'number' ? f.pitch : 0;
    const tb = st.tauntBlend;
    const taunt = tb > 0.01 ? st.tauntId : null;
    const gun = isGunClass(cls) && !dead && !eating && !sitting && !taunt && !blocking;
    const sP = Math.sin(phase), cP = Math.cos(phase);
    const dirS = fwdN >= 0 ? 1 : -1;
    const fwdA = Math.abs(fwdN);

    // ── LAYER 1 — whole-body wrapper ──────────────────────────
    // Upright by design: the torso lean lives in the spine bone and
    // only the sprint adds a hint of whole-body forward pitch. The
    // stride shows up as a small lateral pelvis shift (real gait) with
    // only a whisper of roll — the old ±2° roll read as a wobble.
    // Turning while running banks the body into the turn.
    const sway = sP * (0.003 + 0.005 * jogW + 0.008 * sprintW) * moveW * fwdA;
    const pelvisShift = -sP * (0.008 + 0.010 * jogW + 0.014 * sprintW) * moveW * fwdA;
    const turnLean = -Math.max(-0.12, Math.min(0.12, (f.turnRate || 0) * 0.035 * Math.min(1, g.spd / 6.5)));
    const runLeanX = -(0.015 * jogW + 0.06 * sprintW) * moveW;

    _prev.recoilKick = _lerp(_prev.recoilKick, st.fireKick * (cls === 'two' ? 0.06 : 0.035), kf(0.6));
    const dipTarget = crouch ? -0.36 : 0.0;
    _prev.dipY = _lerp(_prev.dipY, dipTarget, K);
    const sitDipTarget = sitting ? -0.55 : _prev.dipY;
    if (sitting) _prev.dipY = _lerp(_prev.dipY, sitDipTarget, kf(0.35));
    const sitLean = sitting ? 0.18 : 0.0;
    _prev.jumpLift = _lerp(_prev.jumpLift, jump ? 0.22 : 0.0, K);
    const jumpLean = jump ? -0.05 : 0.0;
    const meleeLean = (kick || punchL || punchR) ? -0.12 : 0.0;
    const blockLean = blocking ? -0.08 : 0.0;
    _prev.reloadLean = _lerp(_prev.reloadLean, (reloading && !firing) ? 0.05 : 0.0, K);
    const reloadDip = reloading ? -0.03 : 0.0;
    _prev.hurtFlinch = _lerp(_prev.hurtFlinch, hurt ? 0.14 : 0.0, hurt ? kf(0.5) : K);
    _prev.spinZ = _lerp(_prev.spinZ, hurt ? Math.sin((t || 0) * 20) * 0.08 : 0.0, kf(0.35));
    _prev.deadPitch = _lerp(_prev.deadPitch, dead ? 1.35 : 0.0, dead ? kf(0.10) : kf(0.30));
    const deadDip = dead ? -0.60 : 0.0;
    const idleBreath = (moveW < 0.05 && !crouch && !sitting && !dead) ? Math.sin((t || 0) * 1.6) * 0.010 : 0.0;
    // Dance: bounce + hip sway on the root.
    const danceW = taunt === 'dance' ? tb : 0;
    const dw = st.tauntT * Math.PI * 2 * 1.55;
    const danceBounce = -Math.abs(Math.sin(dw)) * 0.05 * danceW;
    const danceSway = Math.sin(dw * 0.5) * 0.06 * danceW;

    const targetY = feetLiftY + _prev.dipY + _prev.jumpLift + idleBreath + reloadDip + deadDip + danceBounce;
    const targetX = runLeanX + _prev.recoilKick + sitLean + meleeLean + blockLean + _prev.reloadLean + _prev.hurtFlinch + _prev.deadPitch + jumpLean;
    const targetZ = sway + turnLean + _prev.spinZ + danceSway;
    // Idle weight shift lives in the pelvis so the IK legs answer it.
    const idleShift = (moveW < 0.05 && !crouch && !sitting && !dead) ? Math.sin((t || 0) * 0.45) * 0.022 : 0;
    _prev.bobY  = _lerp(_prev.bobY,  targetY, K);
    _prev.leanX = _lerp(_prev.leanX, targetX, K);
    _prev.leanZ = _lerp(_prev.leanZ, targetZ, K);
    _prev.shiftX = _lerp(_prev.shiftX || 0, pelvisShift + idleShift, K);
    _prev.spinY = _lerp(_prev.spinY, 0, K);

    // ── IK LEGS — plan the foot targets, drop the pelvis at double support ─
    const tauntLegs = !!taunt && taunt !== 'flick';
    const legWTarget = (sitting || dead || kick) ? 0 : (tauntLegs ? 1 - tb : 1);
    _legW = _legW + (legWTarget - _legW) * (1 - Math.exp(-dt * 14));
    let legPlan = null;
    if (_legRest && _legW > 0.001) {
      legPlan = planLegs({
        phase, moveW, fwdN, sideN, walkW, jogW, sprintW, crouchW, stepLen: g.stepLen, jump: jump && !sitting,
        restL: _legRest.ankleL, restR: _legRest.ankleR, hipL: _legRest.hipL, hipR: _legRest.hipR,
        hipYOffset: _prev.bobY - feetLiftY, shiftX: _prev.shiftX, legLen: _legRest.legLen,
      }, _legPlan);
    }
    _prev.gaitDrop = _lerp(_prev.gaitDrop || 0, legPlan ? legPlan.drop * _legW : 0, 1 - Math.exp(-dt * 30));
    scene.position.x = _prev.shiftX;
    scene.position.y = _prev.bobY + _prev.gaitDrop;
    scene.rotation.x = _prev.leanX;
    scene.rotation.z = _prev.leanZ;
    scene.rotation.y = BASE_ROT_Y + _prev.spinY;

    // ── LAYER 2 — per-limb articulation ───────────────────────
    if (!rig) return;
    const bn = rig.byName;
    if (!_lens) _lens = boneLengths(bn);

    // Relaxed defaults — arms hang, slight elbow bend, feet a touch
    // apart, soft knees. (x: ±1.05 = arm down; z<0 = arm forward.)
    let shL = { x: -1.05, y: 0, z: -0.04 };
    let shR = { x: 1.05, y: 0, z: -0.04 };
    let elL = { x: 0.22, y: 0, z: 0 };
    let elR = { x: 0.22, y: 0, z: 0 };
    let hipL = { x: 0.02, z: 0.035 };
    let hipR = { x: 0.02, z: -0.035 };
    let kneeL = 0.05, kneeR = 0.05;
    let ankL = { x: -0.02, y: 0 };
    let ankR = { x: -0.02, y: 0 };
    let curlL = 0.15, curlR = 0.15;
    let spineX = 0, spineY = 0, spineZ = 0, headX = 0, headY = 0, headZ = 0;
    let fingerOverrideR = null;   // per-finger curls (taunts)

    // ── IDLE LIFE — weight shifts, look-arounds, arm sway ───────
    const idleCalm = moveW <= 0.05 && !crouch && !sitting && !dead && !eating
      && !jump && !kick && !punchL && !punchR && !blocking && !taunt;
    if (idleCalm) {
      const w1 = Math.sin((t || 0) * 0.45);
      const w2 = Math.sin((t || 0) * 0.8 + 1.7);
      const w3 = Math.sin((t || 0) * 0.35 + 0.6);
      hipL.z += w1 * 0.04; hipR.z += w1 * 0.04;
      spineZ = -w1 * 0.045;
      spineY = w3 * 0.06;
      headY = w3 * (gun ? 0.10 : 0.28);
      headX += Math.sin((t || 0) * 0.9 + 2.2) * 0.04;
      if (!gun) {
        shL.z += w2 * 0.05; shR.z += -w2 * 0.05;
        elL.x += 0.05 + w2 * 0.05; elR.x += 0.05 - w2 * 0.05;
        curlL = 0.15 + Math.sin((t || 0) * 0.9) * 0.05;
        curlR = 0.15 + Math.sin((t || 0) * 0.9 + 0.8) * 0.05;
      }
    }

    // ── LOCOMOTION — distance-driven stride, gait-blended amplitude ─
    if (moveW > 0.01 && !sitting && !dead) {
      const crouchAmp = 1 - 0.45 * crouchW;
      const legAmp  = _mix3(g, 0.36, 0.60, 0.84) * crouchAmp;
      const kneeAmp = _mix3(g, 0.80, 1.20, 1.55) * crouchAmp;
      const strike  = _mix3(g, 0.10, 0.20, 0.28);
      const lift = Math.max(fwdA, Math.abs(sideN) * 0.7);
      const swingR = Math.pow(Math.max(0, cP * dirS), 1.15);
      const swingL = Math.pow(Math.max(0, -cP * dirS), 1.15);
      const strikeR = Math.max(0, sP * dirS) * fwdA;
      const strikeL = Math.max(0, -sP * dirS) * fwdA;
      // Hips swing opposite; knees lift mid-swing and absorb at strike.
      hipR.x = -legAmp * sP * fwdN;
      hipL.x =  legAmp * sP * fwdN;
      kneeR = kneeAmp * lift * swingR + strike * strikeR;
      kneeL = kneeAmp * lift * swingL + strike * strikeL;
      // Side-step: lead leg abducts, trail leg closes (gallop).
      const sideAmp = legAmp * 0.75;
      hipR.z += -sideN * sideAmp * Math.max(0, sP);
      hipL.z += -sideN * sideAmp * Math.max(0, -sP);
      // Ankles: keep the sole level, toe-off behind, heel-up in front.
      const toeR = Math.max(0, -sP * dirS) * fwdA, toeL = Math.max(0, sP * dirS) * fwdA;
      ankR.x = -(hipR.x + kneeR) * 0.5 + 0.32 * toeR * lift - 0.14 * strikeR;
      ankL.x = -(hipL.x + kneeL) * 0.5 + 0.32 * toeL * lift - 0.14 * strikeL;
      // Blend in from idle.
      hipR.x *= moveW; hipL.x *= moveW; kneeR *= moveW; kneeL *= moveW;
      ankR.x *= moveW; ankL.x *= moveW;
      // Torso: pelvis/shoulder counter-rotation, sprint lean, level head.
      spineY += -sP * (0.04 + 0.05 * jogW + 0.07 * sprintW) * moveW * fwdN;
      spineX += (0.02 * walkW + 0.06 * jogW + 0.15 * sprintW) * moveW;
      headX -= spineX * 0.6;
      // Arms — natural counter-swing (guns override the right arm).
      const armSwing = _mix3(g, 0.22, 0.50, 0.78) * moveW * fwdN;
      const pump = _mix3(g, 0.30, 0.95, 1.35) * moveW;
      shR.z = sP * armSwing;  shL.z = -sP * armSwing;
      shR.x = 1.05 - 0.10 * sprintW * moveW; shL.x = -shR.x;
      elR.x = 0.22 + pump * (0.55 + 0.45 * Math.max(0, sP * fwdN));
      elL.x = 0.22 + pump * (0.55 + 0.45 * Math.max(0, -sP * fwdN));
      curlR = curlL = 0.25 + 0.55 * sprintW * moveW;
    }

    // ── CROUCH (blended) ─────────────────────────────────────
    if (crouchW > 0.01 && !sitting) {
      hipL.x += -0.95 * crouchW; hipR.x += -0.95 * crouchW;
      kneeL += 1.30 * crouchW;   kneeR += 1.30 * crouchW;
      ankL.x += -0.30 * crouchW; ankR.x += -0.30 * crouchW;
      hipL.z += 0.10 * crouchW;  hipR.z -= 0.10 * crouchW;
      spineX += 0.22 * crouchW;
      headX -= 0.12 * crouchW;
    }

    if (sitting) {
      hipL = { x: -1.45, z: 0.10 };
      hipR = { x: -1.45, z: -0.10 };
      kneeL = 1.45; kneeR = 1.45;
      ankL = { x: 0.15, y: 0 };
      ankR = { x: 0.15, y: 0 };
      shL = { x: -0.85, y: 0, z: -0.45 };
      shR = { x: 0.85, y: 0, z: -0.45 };
      elL = { x: 0.95, y: 0, z: 0 };
      elR = { x: 0.95, y: 0, z: 0 };
      curlL = curlR = 0.85;
    }

    if (jump && !sitting) {
      // Running-jump silhouette: lead knee up, trail leg trailing.
      hipR.x += -0.62; kneeR += 1.05; ankR.x += 0.15;
      hipL.x += -0.15; kneeL += 0.45;
      if (!gun) { shR.z -= 0.35; shL.z += 0.25; elR.x += 0.4; elL.x += 0.3; }
      spineX += 0.06;
    }

    // ── FIGHT ────────────────────────────────────────────────
    if (punchR) { shR = { x: 0.05, y: 0, z: -1.40 }; elR = { x: 0.08, y: 0, z: 0 }; curlR = 1.30; spineY -= 0.30; }
    if (punchL) { shL = { x: -0.05, y: 0, z: -1.40 }; elL = { x: 0.08, y: 0, z: 0 }; curlL = 1.30; spineY += 0.30; }
    if (kick) { hipR.x = -1.25; kneeR = 0.20; ankR.x = 0.25; hipL.x = 0.15; kneeL = 0.35; spineX -= 0.10; }
    if (blocking) {
      shL = { x: -0.75, y: 0, z: -0.95 };
      shR = { x: 0.75, y: 0, z: -0.95 };
      elL = { x: 1.75, y: 0, z: 0 };
      elR = { x: 1.75, y: 0, z: 0 };
      curlL = curlR = 1.0;
      headX += 0.15;
    }
    if (cls === 'melee' && !dead && !eating && !taunt) {
      // Bat rests on the shoulder; swing comes through `firing`.
      if (firing) { shR = { x: 0.30, y: 0, z: -1.15 }; elR = { x: 0.45, y: 0, z: 0 }; spineY -= 0.40; }
      else { shR = { x: 0.95, y: 0, z: -0.30 }; elR = { x: 1.95, y: 0, z: 0 }; }
      curlR = 1.1;
    }
    if (cls === 'throw' && !dead && !eating && !taunt) {
      shR = { x: 0.95, y: 0, z: -0.25 }; elR = { x: 1.25, y: 0, z: 0 }; curlR = 1.0;
      if (firing) { shR = { x: 0.15, y: 0, z: -1.30 }; elR = { x: 0.15, y: 0, z: 0 }; }
    }

    // ── GUNS — aim/carry request for the IK pass ─────────────
    _arm.mode = null;
    if (gun) {
      const aiming = firing || Math.abs(pitch) > 1e-4 || f.aiming;
      st.aimW = _lerp(st.aimW, aiming ? 1 : 0, 1 - Math.exp(-dt * 10));
      _arm.mode = 'gun'; _arm.cls = cls; _arm.aimW = st.aimW; _arm.pitch = pitch;
      _arm.idlePitch = grip.idlePitch || 0; _arm.shoulder = !!grip.shoulder;
      _arm.moveW = moveW; _arm.phase = phase; _arm.fireKick = st.fireKick; _arm.crouchW = crouchW;
      _arm.foregrip = grip.foregrip || null;
      curlR = 1.55;
      const tune = grip.shoulder ? ARM_TUNE.rpg : ARM_TUNE[cls];
      if (cls === 'two') curlL = tune.curlL || 1.2;
      headX += -pitch * 0.35 * st.aimW;
      // Bladed stance: chest turns right so the left shoulder comes
      // forward and the off hand can reach the foregrip.
      spineY += -(tune.twist || 0) * (cls === 'two' ? Math.max(0.55, st.aimW) : st.aimW);
      if (reloading) { headX += 0.25; spineX += 0.06; }
    } else {
      st.aimW = _lerp(st.aimW, 0, 1 - Math.exp(-dt * 10));
    }

    // ── EATING — burger in the right hand, brought to the mouth ─
    if (eating) {
      const et = st.eatT;
      const cyc = et < 0.45 ? -1 : ((et - 0.45) % 1.25) / 1.25;      // -1 = raising
      const bite = cyc < 0 ? 0 : (cyc < 0.30 ? 1 : 0);
      const raise = Math.min(1, et / 0.45);
      _arm.mode = 'eat'; _arm.raise = raise; _arm.bite = bite; _arm.cyc = cyc; _arm.eatT = et;
      curlR = 0.85;
      headX += bite ? 0.22 : 0.08 + Math.sin(et * Math.PI * 2 * 3.2) * 0.025 * (cyc >= 0 ? 1 : 0);
      headZ += bite ? 0.06 : 0;
      spineX += 0.06;
      shL = { x: -1.0, y: 0, z: -0.10 }; elL = { x: 0.35, y: 0, z: 0 }; curlL = 0.3;
    }

    // ── TAUNTS ───────────────────────────────────────────────
    if (taunt) {
      const tt = st.tauntT;
      const mixIn = (cur, tgt) => cur + (tgt - cur) * tb;
      if (taunt === 'dance') {
        // 90s two-step: arms alternate pump, knees bounce, head bob.
        const w = dw;
        const a = Math.sin(w), b2 = Math.sin(w * 2);
        shR = { x: mixIn(shR.x, 0.55), y: 0, z: mixIn(shR.z, -0.95 + 0.45 * a) };
        shL = { x: mixIn(shL.x, -0.55), y: 0, z: mixIn(shL.z, -0.95 - 0.45 * a) };
        elR = { x: mixIn(elR.x, 1.65 + 0.25 * a), y: 0, z: 0 };
        elL = { x: mixIn(elL.x, 1.65 - 0.25 * a), y: 0, z: 0 };
        hipR.x = mixIn(hipR.x, -0.25 + 0.20 * a); hipL.x = mixIn(hipL.x, -0.25 - 0.20 * a);
        kneeR = mixIn(kneeR, 0.55 + 0.30 * Math.abs(b2)); kneeL = mixIn(kneeL, 0.55 + 0.30 * Math.abs(b2));
        hipR.z = mixIn(hipR.z, -0.12); hipL.z = mixIn(hipL.z, 0.12);
        spineY = mixIn(spineY, a * 0.30); spineZ = mixIn(spineZ, -a * 0.10);
        headY = mixIn(headY, -a * 0.25); headX = mixIn(headX, 0.05 + 0.08 * Math.abs(b2));
        curlR = curlL = mixIn(curlR, 0.95);
      } else if (taunt === 'flick') {
        // Flick 'em off: right arm up and out, middle finger only, pumping.
        const pump = Math.sin(tt * Math.PI * 2 * 2.6) * 0.5 + 0.5;
        shR = { x: mixIn(shR.x, 0.35), y: 0, z: mixIn(shR.z, -1.25) };
        elR = { x: mixIn(elR.x, 1.35 - 0.35 * pump), y: 0, z: 0 };
        headY = mixIn(headY, -0.20); headZ = mixIn(headZ, 0.10);
        spineY = mixIn(spineY, -0.12); spineX = mixIn(spineX, -0.05);
        hipR.z = mixIn(hipR.z, -0.08);
        fingerOverrideR = { Thumb: 1.2, Index: 1.45, Middle: 0.0, Ring: 1.45, Pinky: 1.45 };
        curlL = mixIn(curlL, 0.9);
      } else {
        // Suck it (DX chop): both arms rise, then chop down to the crotch.
        const p = (tt % 1.1) / 1.1;
        const chop = p < 0.35 ? p / 0.35 : Math.max(0, 1 - (p - 0.35) / 0.55);   // 0 raised → 1 chopped
        const upX = 0.20, downX = 1.00, upZ = -1.35, downZ = -0.55;
        shR = { x: mixIn(shR.x, upX + (downX - upX) * chop), y: 0, z: mixIn(shR.z, upZ + (downZ - upZ) * chop) };
        shL = { x: mixIn(shL.x, -(upX + (downX - upX) * chop)), y: 0, z: mixIn(shL.z, upZ + (downZ - upZ) * chop) };
        elR = { x: mixIn(elR.x, 0.35 + 0.75 * chop), y: 0, z: 0 };
        elL = { x: mixIn(elL.x, 0.35 + 0.75 * chop), y: 0, z: 0 };
        spineX = mixIn(spineX, -0.10 + 0.22 * chop);
        headX = mixIn(headX, -0.12 + 0.30 * chop);
        hipR.x = mixIn(hipR.x, 0.10 - 0.20 * chop); hipL.x = mixIn(hipL.x, 0.10 - 0.20 * chop);
        kneeR = mixIn(kneeR, 0.15 + 0.25 * chop); kneeL = mixIn(kneeL, 0.15 + 0.25 * chop);
        hipR.z = mixIn(hipR.z, -0.14); hipL.z = mixIn(hipL.z, 0.14);
        curlR = curlL = mixIn(curlR, 0.35);
      }
    }

    if (dead) {
      shL = { x: -0.40, y: 0, z: 0 };
      shR = { x: 0.40, y: 0, z: 0 };
      elL = { x: 0.10, y: 0, z: 0 };
      elR = { x: 0.10, y: 0, z: 0 };
      hipL = { x: 0, z: 0 }; hipR = { x: 0, z: 0 };
      kneeL = kneeR = 0.15;
      curlL = curlR = 0.2;
    }

    // Brass knuckles — clenched fists.
    if (wpnId === 'pimpslap' && !dead && !eating && !sitting) {
      curlR = Math.max(curlR, 0.95);
      curlL = Math.max(curlL, 0.95);
    }

    // ── Prop visibility — weapon / burger / pimp hat ───────────
    const showGun = (isGunClass(cls) || cls === 'melee' || cls === 'throw' || wpnId === 'pimpslap') && !eating && !dead && !taunt;
    if (gunMount) gunMount.visible = showGun;
    if (burger) burger.visible = eating;
    if (pimpHatGroup) pimpHatGroup.visible = !!f.hasPimpSlap || wpnId === 'pimpslap';

    // Write ABSOLUTE lerped values every frame — the pose-override
    // undo/apply dance stays drift-free because animate() always
    // rebuilds the clean baseline. Gun / eating arms get overwritten
    // by the IK pass below (and again after overrides via postPose()).
    if (bn.LeftArm) bn.LeftArm.rotation.set(_lb('shLx', shL.x, K), _lb('shLy', shL.y, K), _lb('shLz', shL.z, K));
    if (bn.RightArm) bn.RightArm.rotation.set(_lb('shRx', shR.x, K), _lb('shRy', shR.y, K), _lb('shRz', shR.z, K));
    if (bn.LeftForeArm) bn.LeftForeArm.rotation.set(_lb('elLx', elL.x, K), _lb('elLy', elL.y, K), _lb('elLz', elL.z, K));
    if (bn.RightForeArm) bn.RightForeArm.rotation.set(_lb('elRx', elR.x, K), _lb('elRy', elR.y, K), _lb('elRz', elR.z, K));
    if (bn.LeftHand) bn.LeftHand.rotation.set(0, 0, 0);
    if (bn.RightHand) bn.RightHand.rotation.set(0, 0, 0);
    const cL = _lb('curlL', curlL, K);
    const cR = _lb('curlR', curlR, K);
    for (const d of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const mul = d === 'Thumb' ? 0.7 : 1;
      const bl = bn[`LeftHand${d}`];
      const br = bn[`RightHand${d}`];
      if (bl) bl.rotation.set(cL * mul, 0, 0);
      if (br) br.rotation.set(_lb(`fR${d}`, fingerOverrideR ? fingerOverrideR[d] : cR * mul, K), 0, 0);
    }
    if (bn.LeftUpLeg) bn.LeftUpLeg.rotation.set(_lb('hipLx', hipL.x, K), 0, _lb('hipLz', hipL.z, K));
    if (bn.RightUpLeg) bn.RightUpLeg.rotation.set(_lb('hipRx', hipR.x, K), 0, _lb('hipRz', hipR.z, K));
    if (bn.LeftLeg) bn.LeftLeg.rotation.set(_lb('kneeL', kneeL, K), 0, 0);
    if (bn.RightLeg) bn.RightLeg.rotation.set(_lb('kneeR', kneeR, K), 0, 0);
    if (bn.LeftFoot) bn.LeftFoot.rotation.set(_lb('ankLx', ankL.x, K), _lb('ankLy', ankL.y, K), 0);
    if (bn.RightFoot) bn.RightFoot.rotation.set(_lb('ankRx', ankR.x, K), _lb('ankRy', ankR.y, K), 0);
    if (bn.Spine) bn.Spine.rotation.set(_lb('spineX', spineX, K), _lb('spineY', spineY, K), _lb('spineZ', spineZ, K));
    if (bn.Head) bn.Head.rotation.set(_lb('headX', headX, K), _lb('headY', headY, K), _lb('headZ', headZ, K));

    if (legPlan) solveLegs(legPlan, _legW);
    solveArms();
  }

  // ── Arm IK pass — right hand on the grip, left hand on the foregrip,
  // or the burger to the mouth. Runs at the end of animate() and again
  // from view3d after pose overrides so tuned gun offsets are honoured.
  function solveArms() {
    if (!rig || !_arm.mode || !_lens) return;
    const bn = rig.byName;
    if (!bn.RightArm || !bn.RightForeArm || !bn.RightHand || !inst) return;
    inst.container.updateWorldMatrix(true, true);
    inst.container.getWorldQuaternion(_cq);
    _F.set(0, 0, 1).applyQuaternion(_cq);     // authored front
    _U.set(0, 1, 0).applyQuaternion(_cq);
    _R.set(-1, 0, 0).applyQuaternion(_cq);    // character's right
    const Lf = _LF.copy(_R).negate();
    bn.RightArm.getWorldPosition(_S);

    if (_arm.mode === 'eat') {
      // Hand rises from the hip to the mouth, then bite/chew cycles.
      if (mouthAnchor) mouthAnchor.getWorldPosition(_T);
      else _T.copy(_S).addScaledVector(_F, 0.2).addScaledVector(_U, 0.25);
      const r = _arm.raise;
      const chewDrop = _arm.bite ? 0 : 0.10;
      _T.addScaledVector(_U, -0.06 - chewDrop).addScaledVector(_F, 0.05 + chewDrop * 0.6).addScaledVector(_R, 0.03);
      _P.copy(_S).addScaledVector(_F, 0.18).addScaledVector(_U, -0.55).addScaledVector(_R, 0.06);  // hip start
      _T.lerpVectors(_P, _T, r * r * (3 - 2 * r));
      _A.copy(_U).multiplyScalar(-0.7).addScaledVector(_R, 0.45).addScaledVector(_F, 0.25);   // elbow out/down
      solveTwoBoneIK(bn.RightArm, bn.RightForeArm, bn.RightHand, _T, _A);
      // Fingers up toward the face, palm facing the mouth.
      _Z.copy(_F).negate().addScaledVector(_U, 0.3);
      _A.copy(_U).multiplyScalar(0.55).addScaledVector(Lf, 0.65).addScaledVector(_F, -0.25);
      orientBoneWorld(bn.RightHand, _A, _Z);
      return;
    }

    // ── gun ──
    const aimW = _arm.aimW, cls = _arm.cls;
    const p = _arm.pitch * aimW - _arm.idlePitch * (1 - aimW) + _arm.fireKick * 0.05;
    // Barrel direction: front pitched by `p` (positive = up).
    _A.copy(_F).multiplyScalar(Math.cos(p)).addScaledVector(_U, Math.sin(p));
    const bob = Math.sin(_arm.phase) * 0.012 * _arm.moveW;
    const kick = _arm.fireKick * (cls === 'two' ? 0.035 : 0.025);
    const tune = _arm.shoulder ? ARM_TUNE.rpg : ARM_TUNE[cls];
    const at = tune.aim, ct = tune.carry || tune.aim;
    _T.copy(_S).addScaledVector(_F, at.f - kick).addScaledVector(_U, at.u).addScaledVector(_R, at.r);
    _P.copy(_S).addScaledVector(_F, ct.f).addScaledVector(_U, ct.u).addScaledVector(_R, ct.r);
    if (cls === 'one') {
      // Aim: arm extended along the barrel. Carry: low ready at the hip.
      _T.copy(_S).addScaledVector(_A, at.f - kick).addScaledVector(_U, at.u).addScaledVector(_R, at.r);
      _Z.copy(_U).multiplyScalar(-0.85).addScaledVector(_R, 0.45).addScaledVector(_F, -0.15 * (1 - aimW));
    } else if (_arm.shoulder) {
      _Z.copy(_U).multiplyScalar(-0.8).addScaledVector(_R, 0.4).addScaledVector(_F, -0.3);
    } else {
      _Z.copy(_U).multiplyScalar(-0.6).addScaledVector(_F, -0.6).addScaledVector(_R, 0.35);
    }
    _T.lerp(_P, 1 - aimW);
    _T.addScaledVector(_R, bob).addScaledVector(_U, -0.04 * _arm.crouchW);
    // Right hand: fingers along the barrel, palm facing inward → gun up = hand +X.
    if (cls === 'two' && !_arm.shoulder) {
      // Hip-fire crosses the body a touch; carry drifts further left.
      _A.addScaledVector(Lf, (tune.yawL || 0) + 0.25 * (1 - aimW)).normalize();
    }
    const twoHand = cls === 'two' && _arm.foregrip && gunMesh && bn.LeftArm && bn.LeftForeArm && bn.LeftHand;
    const placeRight = () => {
      solveTwoBoneIK(bn.RightArm, bn.RightForeArm, bn.RightHand, _T, _Z);
      _W.copy(Lf);
      orientBoneWorld(bn.RightHand, _A, _W);
      if (twoHand) { bn.RightHand.updateWorldMatrix(true, true); _P.fromArray(_arm.foregrip); gunMesh.localToWorld(_P); }
    };
    placeRight();
    if (twoHand) {
      // If the off hand can't reach the foregrip, slide the whole gun
      // back along the barrel until it can (keeps both hands on it).
      bn.LeftArm.getWorldPosition(_W);
      const reach = (_lens.upL + _lens.foreL) * 0.96 - ARM_TUNE.foreBack;
      const over = _W.distanceTo(_P) - reach;
      if (over > 0) { _T.addScaledVector(_A, -over * 1.2); placeRight(); }
    }

    // Left hand → foregrip (two-handed only).
    if (twoHand) {
      _T.copy(_P);
      // Palm up under the foregrip, fingers wrapping toward the right.
      // The wrist joint sits ~6 cm behind the palm along the fingers.
      _P.copy(_R).addScaledVector(_A, 0.15).normalize();          // fingers
      _Z.copy(_U).addScaledVector(_P, -_U.dot(_P)).normalize();   // palm normal
      _T.addScaledVector(_P, -ARM_TUNE.foreBack).addScaledVector(_Z, -ARM_TUNE.foreDown);
      _W.copy(_U).multiplyScalar(-0.7).addScaledVector(Lf, 0.4).addScaledVector(_F, -0.25);
      solveTwoBoneIK(bn.LeftArm, bn.LeftForeArm, bn.LeftHand, _T, _W);
      orientBoneWorld(bn.LeftHand, _P, _Z);
    }
  }

  // Re-run after pose overrides: hands back on the grip, feet back on the
  // ground (IK legs win over hand-tuned hip/knee deltas — planting matters more).
  function postPose() { if (_legRest && _legW > 0.001) solveLegs(_legPlan, _legW); solveArms(); }

  function setWeapon(id) {
    const w = id || 'fist';
    if (w === _curWeapon) return;
    _curWeapon = w;
    _applyWeapon(w);
  }
  function setTagVisible(v) { tag.visible = !!v; }
  function setHpBar(visible, ratio) {
    barBg.visible = !!visible;
    barFill.visible = !!visible;
    if (visible) {
      const r = Math.max(0, Math.min(1, ratio));
      barFill.scale.x = r;
      barFill.position.x = -0.3 * (1 - r);
    }
  }
  function dispose() {
    disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('sr:weapon-offset-changed', _onWeaponOffsetChanged);
    }
    // Geometries / materials shared with the template cache — don't
    // dispose them. The per-instance skeleton bone texture is ours.
    if (inst && inst.skeleton) { try { inst.skeleton.dispose(); } catch { /* noop */ } }
    if (scene && scene.parent) scene.parent.remove(scene);
  }
  function getRig() { return rig; }
  const isCompton = true;

  return {
    group, animate, postPose, setWeapon, setTagVisible, setHpBar, dispose,
    getRig, isCompton,
  };
}

// Legacy exports for the characterModel3d.js fallback path.
export function preloadCompton() { return preloadComptonRigid(); }
export function cloneComptonMesh() {
  if (!_template) return null;
  const g = new THREE.Group();
  g.add(instantiateRig(_template).container);
  return g;
}
