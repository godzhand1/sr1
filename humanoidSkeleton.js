// AAA humanoid skeleton template — 20 bones matching Mixamo /
// Meshy standard naming so anything rigged here plays cleanly with
// the game's existing Meshy walk clip and characterMeshy.js animation
// pipeline (which reads bones by name).
//
// Hierarchy (parent-relative local positions in metres, at rest T-pose
// for a 1.7 m-tall character with feet at Y=0):
//
//   Hips (root, world pos y=0.90)
//   ├── Spine     (0, 0.15, 0)
//   │   └── Chest (0, 0.20, 0)
//   │       ├── Neck (0, 0.20, 0)
//   │       │   └── Head (0, 0.10, 0)
//   │       ├── LeftShoulder  ( 0.05, 0.15, 0)
//   │       │   └── LeftArm      (0.15, 0, 0)   arm hangs out sideways
//   │       │       └── LeftForeArm (0.28, 0, 0)  T-pose extended
//   │       │           └── LeftHand   (0.25, 0, 0)
//   │       └── RightShoulder (-0.05, 0.15, 0)   mirror
//   │           └── RightArm      (-0.15, 0, 0)
//   │               └── RightForeArm (-0.28, 0, 0)
//   │                   └── RightHand   (-0.25, 0, 0)
//   ├── LeftUpLeg  ( 0.09, -0.05, 0)
//   │   └── LeftLeg   (0, -0.42, 0)
//   │       └── LeftFoot (0, -0.42, 0.05)
//   └── RightUpLeg (-0.09, -0.05, 0)
//       └── RightLeg   (0, -0.42, 0)
//           └── RightFoot (0, -0.42, 0.05)
//
// Total: 20 bones. Names use Mixamo/glTF convention so
// characterMeshy.js's boneMap lookup finds them by string ID.

import * as THREE from 'three';

export const BONE_TEMPLATE = [
  // { name, parent, localPos: [x, y, z] }
  { name: 'Hips',          parent: null,             localPos: [0, 0.90, 0] },
  { name: 'Spine',         parent: 'Hips',           localPos: [0, 0.15, 0] },
  { name: 'Chest',         parent: 'Spine',          localPos: [0, 0.20, 0] },
  { name: 'Neck',          parent: 'Chest',          localPos: [0, 0.20, 0] },
  { name: 'Head',          parent: 'Neck',           localPos: [0, 0.10, 0] },
  { name: 'LeftShoulder',  parent: 'Chest',          localPos: [ 0.05, 0.15, 0] },
  { name: 'LeftArm',       parent: 'LeftShoulder',   localPos: [ 0.15, 0,    0] },
  { name: 'LeftForeArm',   parent: 'LeftArm',        localPos: [ 0.28, 0,    0] },
  { name: 'LeftHand',      parent: 'LeftForeArm',    localPos: [ 0.25, 0,    0] },
  // Left fingers — one bone per digit (thumb / index / middle /
  // ring / pinky). Real hands have 3 joints per finger; the MVP
  // uses 1 joint per finger and lets the user split them further
  // in Blender if needed. Offsets place fingertips ~10cm forward
  // of the wrist with a small side spread so they're visible in
  // the skeleton helper.
  { name: 'LeftHandThumb',  parent: 'LeftHand',      localPos: [ 0.04, -0.03,  0.05] },
  { name: 'LeftHandIndex',  parent: 'LeftHand',      localPos: [ 0.09,  0.00,  0.03] },
  { name: 'LeftHandMiddle', parent: 'LeftHand',      localPos: [ 0.09,  0.00,  0.00] },
  { name: 'LeftHandRing',   parent: 'LeftHand',      localPos: [ 0.09,  0.00, -0.03] },
  { name: 'LeftHandPinky',  parent: 'LeftHand',      localPos: [ 0.08,  0.00, -0.06] },
  { name: 'RightShoulder', parent: 'Chest',          localPos: [-0.05, 0.15, 0] },
  { name: 'RightArm',      parent: 'RightShoulder',  localPos: [-0.15, 0,    0] },
  { name: 'RightForeArm',  parent: 'RightArm',       localPos: [-0.28, 0,    0] },
  { name: 'RightHand',     parent: 'RightForeArm',   localPos: [-0.25, 0,    0] },
  { name: 'RightHandThumb', parent: 'RightHand',     localPos: [-0.04, -0.03,  0.05] },
  { name: 'RightHandIndex', parent: 'RightHand',     localPos: [-0.09,  0.00,  0.03] },
  { name: 'RightHandMiddle',parent: 'RightHand',     localPos: [-0.09,  0.00,  0.00] },
  { name: 'RightHandRing',  parent: 'RightHand',     localPos: [-0.09,  0.00, -0.03] },
  { name: 'RightHandPinky', parent: 'RightHand',     localPos: [-0.08,  0.00, -0.06] },
  { name: 'LeftUpLeg',     parent: 'Hips',           localPos: [ 0.09, -0.05, 0] },
  { name: 'LeftLeg',       parent: 'LeftUpLeg',      localPos: [ 0, -0.42, 0] },
  { name: 'LeftFoot',      parent: 'LeftLeg',        localPos: [ 0, -0.42, 0.05] },
  { name: 'RightUpLeg',    parent: 'Hips',           localPos: [-0.09, -0.05, 0] },
  { name: 'RightLeg',      parent: 'RightUpLeg',     localPos: [ 0, -0.42, 0] },
  { name: 'RightFoot',     parent: 'RightLeg',       localPos: [ 0, -0.42, 0.05] },
  // 29 bones — core (5) + arms (4×2) + fingers (5×2) + legs (3×2)
];

// Build a THREE.Bone tree from the template. Returns:
//   { bones: THREE.Bone[]        — flat list in the SAME order as the template,
//                                   suitable for indexing into skinIndex buffers
//     root:  THREE.Bone          — the Hips bone (top of the hierarchy)
//     byName: { [boneName]: Bone } }
export function buildHumanoidSkeleton() {
  const bones = [];
  const byName = {};
  for (const spec of BONE_TEMPLATE) {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.set(spec.localPos[0], spec.localPos[1], spec.localPos[2]);
    bones.push(bone);
    byName[spec.name] = bone;
  }
  // Wire parents on a second pass so children reference already-created bones.
  for (let i = 0; i < BONE_TEMPLATE.length; i++) {
    const spec = BONE_TEMPLATE[i];
    if (spec.parent) byName[spec.parent].add(bones[i]);
  }
  return { bones, root: byName.Hips, byName };
}

// Bone HEAD/TAIL segments — used by the envelope skinner to compute
// per-vertex distance-to-bone. Each bone's segment goes from its
// world position (head) to the world position of its first child
// (tail). Terminal bones (Head, Hand, Foot) use a short forward
// offset since they have no children.
export function computeBoneSegments(bones, root) {
  root.updateMatrixWorld(true);
  const _head = new THREE.Vector3();
  const _tail = new THREE.Vector3();
  const segs = [];
  for (const b of bones) {
    b.getWorldPosition(_head);
    if (b.children.length > 0) {
      // First child bone (skip weapon mounts / non-Bone children).
      let childBone = null;
      for (const c of b.children) {
        if (c.isBone) { childBone = c; break; }
      }
      if (childBone) childBone.getWorldPosition(_tail);
      else _tail.copy(_head).add(new THREE.Vector3(0, 0.1, 0));
    } else {
      // Terminal bone — pick a short forward extension along the
      // parent-child axis so distance calcs behave near the tip.
      _tail.copy(_head).add(new THREE.Vector3(0, 0.08, 0));
    }
    segs.push({
      head: _head.clone(),
      tail: _tail.clone(),
      bone: b,
    });
  }
  return segs;
}

// ── Pose presets ─────────────────────────────────────────────────
//
// The BONE_TEMPLATE above is authored in T-pose (arms perfectly
// horizontal, palms down). Many modern character meshes ship in
// A-pose (arms hanging at ~45° down) or other rest poses — auto-
// fitting a T-pose skeleton onto an A-pose mesh produces bad
// envelope skinning because the arm bones sit outside the actual
// arm geometry.
//
// Presets apply post-build ROTATIONS to specific bones so the
// underlying rest-pose translations stay unchanged. Users pick a
// preset in the RigLab UI before skinning.

// A-pose: shoulder joints rotate ~45° so arms hang down + slightly
// forward. Values chosen empirically to roughly match Meshy /
// CharacterCreator default A-pose exports (~48° down, ~5° forward).
// Fingers also curl in slightly so open palms don't fan out weirdly
// when the arm rotates.
const A_POSE_SHOULDER_Z = Math.PI / 4;   // 45° — arm goes down
const A_POSE_SHOULDER_X = 0.08;          // small forward tilt
const A_POSE_FINGER_Z   = 0.35;          // slight closed-hand curl

export function applyPosePreset(skeletonByName, preset) {
  // Reset every bone's rotation to identity first so switching
  // presets after fine-tuning doesn't compound rotations.
  for (const name in skeletonByName) {
    skeletonByName[name].rotation.set(0, 0, 0);
  }
  if (preset === 'a-pose') {
    // Arms swing down + slightly forward. Left shoulder rotates
    // NEG-Z so its +X-facing arm goes down; right shoulder rotates
    // POS-Z (mirrored) so its -X-facing arm also goes down.
    if (skeletonByName.LeftShoulder) {
      skeletonByName.LeftShoulder.rotation.z = -A_POSE_SHOULDER_Z;
      skeletonByName.LeftShoulder.rotation.x =  A_POSE_SHOULDER_X;
    }
    if (skeletonByName.RightShoulder) {
      skeletonByName.RightShoulder.rotation.z =  A_POSE_SHOULDER_Z;
      skeletonByName.RightShoulder.rotation.x =  A_POSE_SHOULDER_X;
    }
    // Slight finger curl so the open palm doesn't fan out with the
    // rotated arm. Same left/right sign convention as shoulders.
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    for (const f of fingers) {
      const l = skeletonByName[`LeftHand${f}`];
      const r = skeletonByName[`RightHand${f}`];
      if (l) l.rotation.z = -A_POSE_FINGER_Z;
      if (r) r.rotation.z =  A_POSE_FINGER_Z;
    }
  }
  // 't-pose' (default) needs no rotation — bones stay in identity.
}

