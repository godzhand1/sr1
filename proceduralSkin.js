// Procedural skinning v2 — proper Three.js SkinnedMesh setup.
//
// Iter 96 lessons learnt:
//   • SkinnedMesh.bind(skeleton, bindMatrix) requires that the
//     `bindMatrix` and the skeleton's `boneInverses` were both
//     captured against the SAME world-space frame.
//   • Capturing `boneInverses` at construction time (body.matrixWorld
//     = identity, bones at rest local positions) and then later
//     binding with `body.matrixWorld` (which now includes the player's
//     scene transform) produces a double-transform → verts shoot
//     off to infinity ("strings stretching up in the air").
//
// Fix: capture boneInverses at construction with body.matrixWorld =
// identity, and ALWAYS bind subsequent meshes with `IDENTITY` as the
// bindMatrix — matching the frame the inverses were captured in. The
// runtime mesh.matrixWorld (== body.matrixWorld == player transform)
// is applied *after* the skinning shader produces the mesh-local
// position, so the player still moves around the world correctly.
//
// Bone indices (must match the array order in `buildSkeleton`):
//   0 root          (body)
//   1 spine         (torsoG)
//   2 head          (headG)
//   3 shoulder-A    (armR.sh — character's anatomical left after the
//                    OBJ's 180° Y flip, but we keep the scene-graph
//                    name)
//   4 elbow-A       (armR.el)
//   5 shoulder-B    (armL.sh)
//   6 elbow-B       (armL.el)
//   7 hip-A         (body.__legR.hip)
//   8 knee-A        (body.__legR.knee)
//   9 hip-B         (body.__legL.hip)
//  10 knee-B        (body.__legL.knee)
//  11 finger-A      (fingerR — hand-curl bone at the R wrist, child of elbow-A)
//  12 finger-B      (fingerL — hand-curl bone at the L wrist, child of elbow-B)

import * as THREE from 'three';

export const BONE_COUNT = 13;
export const BONE_IDX = Object.freeze({
  root: 0, spine: 1, head: 2,
  shA: 3, elA: 4, shB: 5, elB: 6,
  hipA: 7, knA: 8, hipB: 9, knB: 10,
  fingerA: 11, fingerB: 12,
});

const HEAD_Y_HARD = 1.60;
const HEAD_Y_BLEND_LOW = 1.45;
const ARM_X_HARD = 0.30;
const ARM_X_BLEND_LOW = 0.18;
const ELBOW_Y_HARD = 1.05;
const ELBOW_Y_BLEND_HIGH = 1.25;
const HIP_Y_TOP = 0.95;
const HIP_Y_BOTTOM = 0.55;
const KNEE_Y_HARD = 0.45;
// Below the hip line, the SR1 OBJ A-pose hands hang DOWN with the
// hand pivot at |x|≈0.55 (extreme outer edge of the model). Pants /
// shoes / hoody hems all stay inside |x|≈0.42. A 0.44 threshold cleanly
// catches the forearm + hand without touching any clothing layer.
// Anything ABOVE the hip uses the ORIGINAL classifier untouched —
// the original was fine for the shoulder deltoid + upper arm; only
// the BELOW-hip case needed the stricter rule.
const ARM_X_BELOW_HIP = 0.44;
const FOREARM_Y_MIN = 0.45;            // y-gate keeps feet/shoes out
// Wrist boundary inside the below-hip arm strip. Above WRIST_Y is
// forearm (bind to elbow); below WRIST_Y is hand+fingers (bind to
// finger bone). The pc_body OBJ authors A-pose hands at world-y
// ≈ 0.78–0.85 (mid-thigh height), so the boundary sits at 0.86
// (just above the wrist) with a 0.06 m blend up to 0.92 to avoid a
// hard seam where the forearm meets the wrist.
const WRIST_Y_HARD  = 0.86;
const WRIST_Y_BLEND = 0.92;

function smooth(v) { return v * v * (3 - 2 * v); }

function vertexWeights(x, y) {
  if (y >= HEAD_Y_HARD) return [[BONE_IDX.head, 1]];
  if (y >= HEAD_Y_BLEND_LOW && Math.abs(x) < 0.20) {
    const t = smooth((y - HEAD_Y_BLEND_LOW) / (HEAD_Y_HARD - HEAD_Y_BLEND_LOW));
    return [[BONE_IDX.head, t], [BONE_IDX.spine, 1 - t]];
  }
  const ax = Math.abs(x);
  // ── Above hip: ORIGINAL classifier (preserved verbatim) ──
  // Catches shoulder deltoid, upper arm, elbow, and the chunk of the
  // forearm above hip level. This was working correctly before any of
  // the recent fixes — DO NOT change this branch without re-verifying
  // the shoulder/shirt rotation.
  if (ax >= ARM_X_HARD && y >= HIP_Y_TOP) {
    const sideShoulder = x > 0 ? BONE_IDX.shA : BONE_IDX.shB;
    const sideElbow    = x > 0 ? BONE_IDX.elA : BONE_IDX.elB;
    if (y >= ELBOW_Y_BLEND_HIGH) return [[sideShoulder, 1]];
    if (y <= ELBOW_Y_HARD)       return [[sideElbow, 1]];
    const t = smooth((y - ELBOW_Y_HARD) / (ELBOW_Y_BLEND_HIGH - ELBOW_Y_HARD));
    return [[sideShoulder, t], [sideElbow, 1 - t]];
  }
  if (ax >= ARM_X_BLEND_LOW && y >= HIP_Y_TOP) {
    const sideShoulder = x > 0 ? BONE_IDX.shA : BONE_IDX.shB;
    const t = smooth((ax - ARM_X_BLEND_LOW) / (ARM_X_HARD - ARM_X_BLEND_LOW));
    return [[sideShoulder, t], [BONE_IDX.spine, 1 - t]];
  }
  // ── Below hip: stricter |x| threshold ONLY catches A-pose hands ──
  // 0.44 sits between the widest baggy clothing hem (~0.42) and the
  // hand pivot (0.55). Above WRIST_Y: forearm (elbow bone). Below
  // WRIST_Y: hand + fingers (new finger bone) — so a curl knob on the
  // finger bone actually closes the fingertips around the palm without
  // disturbing the forearm.
  if (ax >= ARM_X_BELOW_HIP && y >= FOREARM_Y_MIN && y < HIP_Y_TOP) {
    const sideElbow  = x > 0 ? BONE_IDX.elA     : BONE_IDX.elB;
    const sideFinger = x > 0 ? BONE_IDX.fingerA : BONE_IDX.fingerB;
    if (y >= WRIST_Y_BLEND) return [[sideElbow, 1]];
    if (y <= WRIST_Y_HARD)  return [[sideFinger, 1]];
    const t = smooth((y - WRIST_Y_HARD) / (WRIST_Y_BLEND - WRIST_Y_HARD));
    return [[sideElbow, t], [sideFinger, 1 - t]];
  }
  if (y >= HIP_Y_TOP) return [[BONE_IDX.spine, 1]];
  if (y >= HIP_Y_BOTTOM) {
    const t = smooth((y - HIP_Y_BOTTOM) / (HIP_Y_TOP - HIP_Y_BOTTOM));
    const hip = x >= 0 ? BONE_IDX.hipA : BONE_IDX.hipB;
    return [[BONE_IDX.spine, t], [hip, 1 - t]];
  }
  if (y >= KNEE_Y_HARD) {
    const hip  = x >= 0 ? BONE_IDX.hipA : BONE_IDX.hipB;
    const knee = x >= 0 ? BONE_IDX.knA  : BONE_IDX.knB;
    const t = smooth((y - KNEE_Y_HARD) / (HIP_Y_BOTTOM - KNEE_Y_HARD));
    return [[hip, t], [knee, 1 - t]];
  }
  return [[x >= 0 ? BONE_IDX.knA : BONE_IDX.knB, 1]];
}

/** Add skinIndex + skinWeight attributes to a BufferGeometry whose
 *  vertices have already been Y-flipped by `rotateAndAttach`. */
export function attachSkinning(geometry) {
  const pos = geometry.attributes.position;
  const N = pos.count;
  const skinIndex  = new Uint16Array(N * 4);
  const skinWeight = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const w = vertexWeights(pos.getX(i), pos.getY(i));
    let total = 0;
    for (let j = 0; j < 4; j++) {
      if (j < w.length) {
        skinIndex[i * 4 + j]  = w[j][0];
        skinWeight[i * 4 + j] = w[j][1];
        total += w[j][1];
      }
    }
    if (total > 0 && Math.abs(total - 1) > 1e-4) {
      for (let j = 0; j < 4; j++) skinWeight[i * 4 + j] /= total;
    }
  }
  geometry.setAttribute('skinIndex',  new THREE.BufferAttribute(skinIndex,  4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  return geometry;
}

/** Build a Skeleton from the existing bone Groups passed in. MUST be
 *  called WHEN the bones are at their authored rest local positions
 *  AND `body.matrixWorld === identity` (i.e. before the model has
 *  been added to the scene + player transforms applied) so the
 *  captured `boneInverses` live in identity-world space. */
export function buildSkeleton(parts) {
  const bones = new Array(BONE_COUNT);
  bones[BONE_IDX.root]  = parts.root;
  bones[BONE_IDX.spine] = parts.spine;
  bones[BONE_IDX.head]  = parts.head;
  bones[BONE_IDX.shA]   = parts.shA;
  bones[BONE_IDX.elA]   = parts.elA;
  bones[BONE_IDX.shB]   = parts.shB;
  bones[BONE_IDX.elB]   = parts.elB;
  bones[BONE_IDX.hipA]  = parts.hipA;
  bones[BONE_IDX.knA]   = parts.knA;
  bones[BONE_IDX.hipB]  = parts.hipB;
  bones[BONE_IDX.knB]   = parts.knB;
  bones[BONE_IDX.fingerA] = parts.fingerA;
  bones[BONE_IDX.fingerB] = parts.fingerB;
  return new THREE.Skeleton(bones);
}

// Reusable identity matrix for bind() calls — passing the same
// identity instance every time keeps bindMatrix consistent with the
// identity-world frame in which `boneInverses` were captured.
export const IDENTITY_BIND = new THREE.Matrix4();
