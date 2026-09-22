// universalRig.js — UNIVERSAL identity-bind articulated rig (iter204).
//
// The contract that makes this safe for the user's sculpted meshes:
//   • The skeleton is BOUND at the mesh's EXACT loaded pose ("identity
//     bind"). At rest (all joint rotations zero) the skinning math is
//     a mathematical identity — the mesh renders pixel-identical to
//     the loaded GLB. No scaling, no re-centering, no proportion
//     shifts, no vertex edits.
//   • Joint positions are computed PROPORTIONALLY from the mesh's
//     actual bounding box — no hardcoded coordinates — so the same
//     code rigs ANY humanoid GLB (0.5 m or 3 m tall, T-pose or A-pose).
//   • Every joint the user asked for can move: shoulders, upper arms,
//     elbows, wrists/hands, all 5 fingers per hand, hips/upper legs,
//     knees/lower legs, ankles/feet, spine, neck, head.
//   • Weights use a sharp d⁴ falloff + left/right side gating so limb
//     bones never grab vertices across the body midline.
//
// Public API:
//   computeAutoLayout(bbox, mode)         → layout ({joints, mode, …})
//   bakeUniversalWeights(geometry, layout)→ writes skinIndex/skinWeight
//   prepareRigTemplate(sourceRoot, opts)  → cached template (parts+layout)
//   instantiateRig(template)              → { container, bones, byName, … }
//   buildTuneRig(inst, body, meta)        → applyTuneToRig-compatible rig
//   saveLayout / loadSavedLayout / clearSavedLayout (per-mesh calibration)

import * as THREE from 'three';

export const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

// ── Layout — proportional joint placement from the bbox ──────────
// mode: 'auto' | 't' (arms out sideways) | 'a' (arms hanging down).
export function computeAutoLayout(bbox, mode = 'auto') {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const H = size.y || 1;
  const hw = (size.x || 0.4) / 2;
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cz = (bbox.min.z + bbox.max.z) / 2;
  const y0 = bbox.min.y;
  const Y = (f) => y0 + f * H;
  const resolved = mode === 'auto' ? (size.x / H > 0.62 ? 't' : 'a') : mode;

  const joints = [];
  const add = (name, parent, x, y, z) => joints.push({ name, parent, pos: [cx + x, y, cz + z] });

  add('Hips', null, 0, Y(0.52), 0);
  add('Spine', 'Hips', 0, Y(0.62), 0);
  add('Chest', 'Spine', 0, Y(0.72), 0);
  add('Neck', 'Chest', 0, Y(0.84), 0);
  add('Head', 'Neck', 0, Y(0.885), 0);

  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    add(`${side}Shoulder`, 'Chest', s * 0.055 * H, Y(0.80), 0);
    if (resolved === 't') {
      // Arms outstretched along ±X (wingspan ≈ bbox width).
      add(`${side}Arm`, `${side}Shoulder`, s * 0.115 * H, Y(0.80), 0);
      add(`${side}ForeArm`, `${side}Arm`, s * 0.55 * hw, Y(0.795), 0);
      add(`${side}Hand`, `${side}ForeArm`, s * 0.78 * hw, Y(0.79), 0);
      const fx = s * 0.88 * hw;
      add(`${side}HandThumb`, `${side}Hand`, fx - s * 0.02 * H, Y(0.78), 0.028 * H);
      add(`${side}HandIndex`, `${side}Hand`, fx, Y(0.79), 0.014 * H);
      add(`${side}HandMiddle`, `${side}Hand`, fx, Y(0.79), 0);
      add(`${side}HandRing`, `${side}Hand`, fx, Y(0.79), -0.014 * H);
      add(`${side}HandPinky`, `${side}Hand`, fx - s * 0.01 * H, Y(0.785), -0.028 * H);
    } else {
      // Arms hanging at the sides (A-pose / relaxed exports).
      add(`${side}Arm`, `${side}Shoulder`, s * 0.72 * hw, Y(0.775), 0);
      add(`${side}ForeArm`, `${side}Arm`, s * 0.85 * hw, Y(0.61), 0);
      add(`${side}Hand`, `${side}ForeArm`, s * 0.88 * hw, Y(0.455), 0);
      const fx2 = s * 0.88 * hw;
      add(`${side}HandThumb`, `${side}Hand`, fx2 - s * 0.015 * H, Y(0.425), 0.026 * H);
      add(`${side}HandIndex`, `${side}Hand`, fx2, Y(0.415), 0.013 * H);
      add(`${side}HandMiddle`, `${side}Hand`, fx2, Y(0.41), 0);
      add(`${side}HandRing`, `${side}Hand`, fx2, Y(0.415), -0.013 * H);
      add(`${side}HandPinky`, `${side}Hand`, fx2, Y(0.42), -0.026 * H);
    }
    add(`${side}UpLeg`, 'Hips', s * 0.055 * H, Y(0.50), 0);
    add(`${side}Leg`, `${side}UpLeg`, s * 0.06 * H, Y(0.27), 0);
    add(`${side}Foot`, `${side}Leg`, s * 0.065 * H, Y(0.055), 0.015 * H);
  }

  return { joints, mode: resolved, height: H, halfWidth: hw, centerX: cx, centerZ: cz, minY: y0 };
}

// ── Bone segments (head→tail) for the weight baker ───────────────
const CORE_TAILS = { Hips: 'Spine', Spine: 'Chest', Chest: 'Neck', Neck: 'Head' };

export function segmentsFromLayout(layout) {
  const H = layout.height;
  const byName = {};
  for (const j of layout.joints) byName[j.name] = j;
  const posOf = (n) => new THREE.Vector3().fromArray(byName[n].pos);
  const segs = [];
  for (const j of layout.joints) {
    const head = posOf(j.name);
    let tail = null;
    const n = j.name;
    const side = n.startsWith('Left') ? 1 : n.startsWith('Right') ? -1 : 0;
    const sName = side === 1 ? 'Left' : 'Right';
    if (CORE_TAILS[n]) tail = posOf(CORE_TAILS[n]);
    else if (n === 'Head') tail = head.clone().add(new THREE.Vector3(0, 0.06 * H, 0));
    else if (/Shoulder$/.test(n)) tail = posOf(`${sName}Arm`);
    else if (/ForeArm$/.test(n)) tail = posOf(`${sName}Hand`);
    else if (/Arm$/.test(n)) tail = posOf(`${sName}ForeArm`);
    else if (/Hand(Thumb|Index|Middle|Ring|Pinky)$/.test(n)) {
      const handPos = posOf(`${sName}Hand`);
      const dir = head.clone().sub(handPos);
      if (dir.lengthSq() < 1e-8) dir.set(side, 0, 0);
      dir.normalize().multiplyScalar(0.05 * H);
      tail = head.clone().add(dir);
    } else if (/Hand$/.test(n)) tail = posOf(`${sName}HandMiddle`);
    else if (/UpLeg$/.test(n)) tail = posOf(`${sName}Leg`);
    else if (/Leg$/.test(n)) tail = posOf(`${sName}Foot`);
    else if (/Foot$/.test(n)) tail = head.clone().add(new THREE.Vector3(0, -0.015 * H, 0.06 * H));
    else tail = head.clone().add(new THREE.Vector3(0, 0.05 * H, 0));
    segs.push({ name: n, head, tail, side });
  }
  return segs;
}

function _pointToSegDist2(px, py, pz, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lenSq > 1e-9) {
    t = ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const ex = px - (a.x + t * dx), ey = py - (a.y + t * dy), ez = pz - (a.z + t * dz);
  return ex * ex + ey * ey + ez * ez;
}

// Sharp d⁴ falloff + side gating. Geometry positions must be in the
// SAME space as the layout (the mesh's loaded world space).
export function bakeUniversalWeights(geometry, layout) {
  const pos = geometry.attributes.position;
  if (!pos) throw new Error('bakeUniversalWeights: geometry missing position attribute');
  const segs = segmentsFromLayout(layout);
  const numVerts = pos.count;
  const numBones = segs.length;
  const margin = 0.02 * layout.height;
  const cx = layout.centerX;

  const skinIndexArr = new Uint16Array(numVerts * 4);
  const skinWeightArr = new Float32Array(numVerts * 4);
  const topIdx = [0, 0, 0, 0];
  const topWgt = [0, 0, 0, 0];

  for (let v = 0; v < numVerts; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    topIdx[0] = topIdx[1] = topIdx[2] = topIdx[3] = 0;
    topWgt[0] = topWgt[1] = topWgt[2] = topWgt[3] = 0;
    for (let b = 0; b < numBones; b++) {
      const s = segs[b];
      const d2 = _pointToSegDist2(px, py, pz, s.head, s.tail);
      let w = 1 / ((d2 + 1e-9) * (d2 + 1e-9));   // d⁴ falloff
      // Side gate — Left* bones never grab right-side vertices & vice versa.
      if (s.side !== 0 && (px - cx) * s.side < -margin) w *= 1e-9;
      let insertAt = -1;
      for (let k = 0; k < 4; k++) { if (w > topWgt[k]) { insertAt = k; break; } }
      if (insertAt >= 0) {
        for (let k = 3; k > insertAt; k--) { topWgt[k] = topWgt[k - 1]; topIdx[k] = topIdx[k - 1]; }
        topWgt[insertAt] = w;
        topIdx[insertAt] = b;
      }
    }
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += topWgt[k];
    if (sum < 1e-12) { skinIndexArr[v * 4] = 0; skinWeightArr[v * 4] = 1; continue; }
    const inv = 1 / sum;
    for (let k = 0; k < 4; k++) {
      skinIndexArr[v * 4 + k] = topIdx[k];
      skinWeightArr[v * 4 + k] = topWgt[k] * inv;
    }
  }

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndexArr, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeightArr, 4));
  return { computedVerts: numVerts, computedBones: numBones };
}

// ── Template — flatten meshes into rig space + bake weights once ──
// The world transform is BAKED into a cloned geometry. This does not
// change the visible shape at all — it just re-expresses the same
// world-space vertices in the rig container's frame so the skeleton
// and mesh live in one coordinate system.
export function prepareRigTemplate(sourceRoot, opts = {}) {
  sourceRoot.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(sourceRoot);
  const parts = [];
  sourceRoot.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const geometry = o.geometry.clone();
      geometry.applyMatrix4(o.matrixWorld);
      parts.push({ geometry, material: o.material, name: o.name });
    }
  });
  const layout = _normalizeLayout(opts.layout) || computeAutoLayout(bbox, opts.mode || 'auto');
  for (const p of parts) bakeUniversalWeights(p.geometry, layout);
  const footJoint = layout.joints.find((j) => j.name === 'LeftFoot');
  const meta = {
    minY: bbox.min.y,
    height: layout.height,
    soleDropLocal: footJoint ? (footJoint.pos[1] - bbox.min.y) : 0.055 * layout.height,
  };
  return { parts, layout, bbox, meta };
}

function _normalizeLayout(layout) {
  if (!layout || !Array.isArray(layout.joints) || !layout.joints.length) return null;
  return layout;
}

// ── Orientation frames — give the animated joints sensible local
// axes so `rotation.x` on a finger CURLS instead of twisting, and
// elbow `rotation.x` FLEXES the forearm. Orient nodes are extra
// rest-rotated parents; the animated joints stay at identity so
// writing absolute rotations each frame is safe.
function _basisQuat(x, y, z) {
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
const _V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q_ARM_L   = _basisQuat(_V(0, 0, 1),  _V(1, 0, 0),  _V(0, 1, 0));
const Q_ARM_R   = _basisQuat(_V(0, 0, 1),  _V(-1, 0, 0), _V(0, -1, 0));
const Q_ELBOW_L = _basisQuat(_V(0, -1, 0), _V(1, 0, 0),  _V(0, 0, 1));
const Q_ELBOW_R = _basisQuat(_V(0, 1, 0),  _V(-1, 0, 0), _V(0, 0, 1));
const Q_HAND_L  = _basisQuat(_V(0, 0, -1), _V(1, 0, 0),  _V(0, -1, 0));
const Q_HAND_R  = _basisQuat(_V(0, 0, 1),  _V(-1, 0, 0), _V(0, -1, 0));

export function orientQuatFor(name) {
  const left = name.startsWith('Left');
  const right = name.startsWith('Right');
  if (!left && !right) return null;
  if (/ForeArm$/.test(name)) return left ? Q_ELBOW_L : Q_ELBOW_R;
  if (/Arm$/.test(name)) return left ? Q_ARM_L : Q_ARM_R;
  if (/Hand/.test(name)) return left ? Q_HAND_L : Q_HAND_R;
  return null;
}

// ── Instantiate — bones + SkinnedMeshes with IDENTITY BIND ────────
export function instantiateRig(template) {
  const container = new THREE.Group();
  container.name = 'UniversalRig';
  const byName = {};
  const bones = [];
  const nodeFor = {};
  const _w = new THREE.Vector3();

  for (const j of template.layout.joints) {
    const parentNode = j.parent ? nodeFor[j.parent] : container;
    const q = orientQuatFor(j.name);
    let holder = parentNode;
    if (q) {
      const orient = new THREE.Bone();
      orient.name = `${j.name}_orient`;
      parentNode.add(orient);
      container.updateMatrixWorld(true);
      orient.position.copy(orient.parent.worldToLocal(_w.fromArray(j.pos)));
      // q is the DESIRED WORLD frame — convert to a local quaternion so
      // nested orient frames (arm → elbow → hand) don't compound.
      const pq = new THREE.Quaternion();
      orient.parent.getWorldQuaternion(pq);
      orient.quaternion.copy(pq.invert().multiply(q));
      holder = orient;
    }
    const bone = new THREE.Bone();
    bone.name = j.name;
    holder.add(bone);
    container.updateMatrixWorld(true);
    if (holder === parentNode) {
      bone.position.copy(holder === container
        ? _w.fromArray(j.pos)
        : holder.worldToLocal(_w.fromArray(j.pos)));
    }
    byName[j.name] = bone;
    bones.push(bone);
    nodeFor[j.name] = bone;
  }

  container.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes = [];
  for (const part of template.parts) {
    const sm = new THREE.SkinnedMesh(part.geometry, part.material);
    sm.name = part.name || 'UniversalSkinned';
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.frustumCulled = false;
    container.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton, sm.matrixWorld);   // identity bind — rest pose = loaded mesh 1:1
    meshes.push(sm);
  }
  return { container, bones, byName, meshes, skeleton };
}

// ── applyTuneToRig-compatible interface (poseOverrides.js) ────────
export function buildTuneRig(inst, body, meta) {
  const bn = inst.byName;
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const fingers = (side) => ({
    thumb: bn[`${side}HandThumb`] || null,
    index: bn[`${side}HandIndex`] || null,
    middle: bn[`${side}HandMiddle`] || null,
    ring: bn[`${side}HandRing`] || null,
    pinky: bn[`${side}HandPinky`] || null,
  });
  return {
    body,
    torsoG: bn.Spine || null,
    headG: bn.Head || null,
    armR: { sh: bn.RightArm || null, el: bn.RightForeArm || null },
    armL: { sh: bn.LeftArm || null, el: bn.LeftForeArm || null },
    fingerR: bn.RightHand || null,
    fingerL: bn.LeftHand || null,
    fingersR: fingers('Right'),
    fingersL: fingers('Left'),
    legR: { hip: bn.RightUpLeg || null, knee: bn.RightLeg || null },
    legL: { hip: bn.LeftUpLeg || null, knee: bn.LeftLeg || null },
    footR: bn.RightFoot || null,
    footL: bn.LeftFoot || null,
    gun: null,
    bones: inst.bones,
    byName: bn,
    getLowestFootY() {
      if (!bn.Hips || !bn.LeftFoot || !bn.RightFoot) return NaN;
      bn.Hips.updateWorldMatrix(true, true);
      inst.container.getWorldScale(_s);
      const drop = (meta ? meta.soleDropLocal : 0) * Math.abs(_s.y || 1);
      bn.LeftFoot.getWorldPosition(_p);
      const l = _p.y;
      bn.RightFoot.getWorldPosition(_p);
      return Math.min(l, _p.y) - drop;
    },
    resetPose() {
      for (const b of inst.bones) b.rotation.set(0, 0, 0);
    },
  };
}

// ── Per-mesh saved layout calibration (RigLab → game) ────────────
const LAYOUT_PREFIX = 'uniRigLayout:';

export function saveLayout(meshKey, layout) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(LAYOUT_PREFIX + meshKey, JSON.stringify(layout));
    return true;
  } catch { return false; }
}

export function loadSavedLayout(meshKey) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + meshKey);
    return raw ? _normalizeLayout(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function clearSavedLayout(meshKey) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(LAYOUT_PREFIX + meshKey); } catch { /* noop */ }
}
