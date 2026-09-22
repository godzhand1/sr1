// characterMeshyClothing.js — clothing-skinning helpers extracted from
// characterMeshy.js (iter156 AAA refactor Phase 1).
//
// This module owns the "make garment X sit correctly on the character
// mesh" logic: per-vertex envelope skinning, radial inflate for cloth
// clearance, and the smart body-shrink pass that keeps clothing firm
// against the naked silhouette without pokethrough.
//
// The rest of characterMeshy.js still owns the GLB load pipeline, the
// per-frame animate() loop, the pose state machine, the ragdoll layer,
// and the rig/scene-graph wiring. Splitting THIS piece first is safe
// because everything below is a pure function that mutates a passed-
// in geometry — no closure state, no scene graph knowledge.
//
// Public API:
//   • SKINNED_BODY_SLOTS  — Set<string> of slot names that need a
//     SkinnedMesh bake (shirt / pants / jacket / socks / boxers).
//   • SLOT_BONE_WHITELIST — per-slot bone name allowlist so a
//     shirt doesn't skin to leg bones etc.
//   • SLOT_INFLATE        — baseline outward radial puff per slot.
//   • BODY_SHRINK_BONES   — per-bone inward pull, keyed to which
//     slot(s) trigger it. Keeps the "firm cloth" trick localised to
//     LARGE-DIAMETER regions (torso + thighs + shoulders + upper
//     arms). Head, hands, feet stay full size.
//   • HEAD_SLOTS          — slot names that parent under the Head
//     bone rather than the character root.
//   • bindClothingToSkeleton(...)      — bake an OBJ geometry into a
//     SkinnedMesh bound to the character's skeleton.
//   • inflateGeoRadialFromBones(...)   — outward radial puff.
//   • applyBodyShrink(...)             — smart inward compression.
//
// Everything below matches what lived at lines 425-826 of characterMeshy.js
// before the split. No behaviour change; the extraction is a pure
// refactor step for readability + future testability.

import * as THREE from 'three';
import { bakeEnvelopeSkinning } from './envelopeSkinning.js';

// Clothing slots we skin to the character's skeleton so pants track
// leg bends, shirts follow the torso twist, jackets swing with the
// arms. Head slots + shoes stay handled separately (rigid overlay for
// head; direct foot-bone parenting for shoes).
export const SKINNED_BODY_SLOTS = new Set(['shirt', 'pants', 'jacket', 'socks', 'boxers']);

// Per-slot bone whitelist for envelope skinning. Restricts each
// clothing item to bones that make anatomical sense — otherwise a
// shirt's neckline binds to the Neck/Head bones and tilts forward
// when the character looks down, exposing the character's back;
// pants' waistband binds to the Spine and drags upward when the
// character bends forward.
export const SLOT_BONE_WHITELIST = {
  shirt:   new Set(['Hips', 'Spine', 'Chest', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']),
  jacket:  new Set(['Hips', 'Spine', 'Chest', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']),
  pants:   new Set(['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']),
  socks:   new Set(['LeftLeg', 'LeftFoot', 'RightLeg', 'RightFoot']),
  boxers:  new Set(['Hips', 'LeftUpLeg', 'RightUpLeg']),
};

// Per-slot radial inflation baseline (metres). iter156 bump: was 0
// (relied on Clothing Lab per-asset puff which was rarely tuned),
// now reasonable defaults so clothing sits FIRM without pokethrough.
// Measured against real-world garment thicknesses:
//   • cotton t-shirt drape:   ~1.5 cm  → shirt 2.0 cm total clearance
//   • denim pants drape:      ~1.2 cm  → pants 2.0 cm total clearance
//   • bomber jacket drape:    ~2.5 cm  → jacket 3.3 cm total clearance
// Clothing Lab's per-asset "Extra Puff" slider still stacks on top.
export const SLOT_INFLATE = {
  shirt:   0.030,
  jacket:  0.040,
  pants:   0.025,
  socks:   0.012,
  boxers:  0.010,
};

// Body-shrink calibration — iter156 "clothing should feel firm" fix.
// Magnitudes bumped in the retest cycle after testing-agent identified
// the unit-space bug (see `applyBodyShrink` below) + confirmed 1cm
// alone was not enough to eliminate low-poly baggy-shirt pokethrough.
// All values are authored in WORLD METRES; `applyBodyShrink` divides
// by the mesh's world scale so Meshy characters (0.01 world scale)
// get the correct compression regardless of animScale.
export const BODY_SHRINK_BONES = {
  Spine:         { m: 0.018, ifSlots: ['shirt', 'jacket'] },
  Chest:         { m: 0.018, ifSlots: ['shirt', 'jacket'] },
  Hips:          { m: 0.014, ifSlots: ['shirt', 'jacket', 'pants', 'boxers'] },
  LeftUpLeg:     { m: 0.014, ifSlots: ['pants', 'boxers'] },
  RightUpLeg:    { m: 0.014, ifSlots: ['pants', 'boxers'] },
  LeftLeg:       { m: 0.010, ifSlots: ['pants'] },
  RightLeg:      { m: 0.010, ifSlots: ['pants'] },
  LeftShoulder:  { m: 0.012, ifSlots: ['shirt', 'jacket'] },
  RightShoulder: { m: 0.012, ifSlots: ['shirt', 'jacket'] },
  LeftArm:       { m: 0.012, ifSlots: ['shirt', 'jacket'] },
  RightArm:      { m: 0.012, ifSlots: ['shirt', 'jacket'] },
  LeftForeArm:   { m: 0.008, ifSlots: ['jacket'] },
  RightForeArm:  { m: 0.008, ifSlots: ['jacket'] },
  // Head, Neck, Hand, Foot bones intentionally OMITTED — those
  // regions must never shrink or the face crushes and hands look
  // gnawed.
};

// Slot names that mount under the Head bone (glasses, hair, hat,
// facial hair, mask) rather than the character root. Everything else
// sits under the cosmetics root.
export const HEAD_SLOTS = new Set(['hair', 'hat', 'glasses', 'facialHair', 'mask']);

// ── Envelope skin + bind a clothing geometry to the character's
// skeleton. Public API — called once per equipped body-clothing slot.
//
// The input geometry is CLONED before mutation, so the caller can
// safely reuse the raw asset geometry for other characters.
//
// `boneWhitelist` restricts which bones influence the skin — e.g. a
// shirt only weights against Torso/Arm bones, never Legs. See
// `SLOT_BONE_WHITELIST` above.
//
// `inflateAmount` is the radial outward puff applied before skinning
// so the cloth doesn't pokethrough the naked body under animation.
// Combines the SLOT_INFLATE baseline + any per-asset "Extra Puff"
// from Clothing Lab.
export function bindClothingToSkeleton(
  clothingGeo, characterSkinned, cosmeticsScale, material, tag,
  cachedSegs, boneWhitelist, inflateAmount,
) {
  if (!clothingGeo?.attributes?.position || !characterSkinned?.skeleton) return null;
  const skel = characterSkinned.skeleton;
  const geo = clothingGeo.clone();
  // Bake the clothing OBJ into character-space by applying the same
  // uniform scale the rest of the cosmetics use.
  geo.scale(cosmeticsScale, cosmeticsScale, cosmeticsScale);
  // Bone segments in world-space — cached across all clothing slots
  // for the same character so we don't re-traverse the skeleton every
  // time.
  const allSegs = cachedSegs;
  const segs = boneWhitelist
    ? allSegs.filter((s) => boneWhitelist.has(s.bone.name))
    : allSegs;
  if (segs.length === 0) return null;
  // Push clothing verts radially outward from the nearest bone segment
  // so the body doesn't poke through. Radial-from-bone gives a clean
  // uniform inflate unlike per-vertex normals which are noisy on
  // triangle-soup OBJs and can spike wildly at neck openings / sleeve
  // hems.
  inflateGeoRadialFromBones(geo, segs, inflateAmount || 0.015);
  bakeEnvelopeSkinning(geo, segs, 4);
  // bakeEnvelopeSkinning writes skin indices as 0..segs.length-1 —
  // remap those back to the FULL skeleton's bone-array indices so the
  // shader looks up the right bone matrix.
  if (boneWhitelist) {
    const remap = new Uint16Array(segs.length);
    for (let i = 0; i < segs.length; i++) {
      remap[i] = skel.bones.indexOf(segs[i].bone);
    }
    const si = geo.attributes.skinIndex;
    const N = si.count;
    for (let v = 0; v < N; v++) {
      for (let k = 0; k < 4; k++) {
        const original = si.getComponent(v, k);
        si.setComponent(v, k, remap[original]);
      }
    }
    si.needsUpdate = true;
  }
  const skinned = new THREE.SkinnedMesh(geo, material);
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.frustumCulled = false;                        // sleeves poke past AABB
  skinned.userData.srCosmetic = tag;
  // IDENTITY bindMatrix: matches autoRig's convention — boneInverses
  // were captured at identity-world so an identity bindMatrix keeps
  // the shader math consistent.
  skinned.bind(skel, new THREE.Matrix4());
  return skinned;
}

// Inflate clothing along the axis pointing AWAY from the nearest bone
// segment — the "outward radial" direction from the skeleton. Gives a
// clean uniform puff so the body's back / shoulders / knees can't
// poke through the shirt. Robust against triangle-soup OBJs where
// per-vertex normals swing wildly at seam edges.
export function inflateGeoRadialFromBones(geo, segments, offset) {
  const pos = geo.attributes.position;
  const N = pos.count;
  const numB = segments.length;
  const _tmp = new THREE.Vector3();
  const _closest = new THREE.Vector3();
  const _out = new THREE.Vector3();
  for (let v = 0; v < N; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    let bestDist2 = Infinity;
    let bestCx = 0, bestCy = 0, bestCz = 0;
    for (let b = 0; b < numB; b++) {
      const s = segments[b];
      const ax = s.head.x, ay = s.head.y, az = s.head.z;
      const bx = s.tail.x, by = s.tail.y, bz = s.tail.z;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz;
      let cx = ax, cy = ay, cz = az;
      if (lenSq > 1e-8) {
        const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq;
        const tc = Math.max(0, Math.min(1, t));
        cx = ax + tc * dx; cy = ay + tc * dy; cz = az + tc * dz;
      }
      const ex = px - cx, ey = py - cy, ez = pz - cz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestCx = cx; bestCy = cy; bestCz = cz;
      }
    }
    _closest.set(bestCx, bestCy, bestCz);
    _out.set(px - bestCx, py - bestCy, pz - bestCz);
    if (_out.lengthSq() < 1e-8) continue;
    _out.normalize().multiplyScalar(offset);
    _tmp.set(px, py, pz).add(_out);
    pos.setXYZ(v, _tmp.x, _tmp.y, _tmp.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Smart body-shrink — pull character verts INWARD toward the nearest
// bone segment by a per-bone amount, but only where clothing will
// actually cover them. Prevents the naked-body silhouette pokethrough
// that plagued iter155 shirt/pants/jacket bakes, while leaving
// face, hands, and feet at full size so they don't crush or gnaw.
//
// Runs ONCE at cosmetic-attach time, mutates skinnedMesh.geometry
// in-place, and is skipped entirely when no skinned-body slots are
// populated (naked characters render identical to before).
//
// Algorithm per vertex:
//   1. Find the closest bone segment (same math as inflate).
//   2. Look up that bone's shrink amount in `BODY_SHRINK_BONES`.
//   3. If the bone entry says "only shrink when a listed slot is on"
//      and none of those slots is active, skip this vertex.
//   4. Otherwise pull vertex inward along the -radial by `shrinkM`.
//   5. Head / Neck / Hand / Foot bones are absent from the map, so
//      every vertex closest to them stays at full size.
export function applyBodyShrink(skinnedMesh, activeSlots) {
  const geo = skinnedMesh?.geometry;
  if (!geo?.attributes?.position) return;
  const skel = skinnedMesh.skeleton;
  if (!skel) return;
  // Build per-bone shrink table.
  const shrinkByBone = new Map();
  for (const bone of skel.bones) {
    const cfg = BODY_SHRINK_BONES[bone.name];
    if (!cfg) { shrinkByBone.set(bone, 0); continue; }
    const applies = cfg.ifSlots.some(s => activeSlots.has(s));
    shrinkByBone.set(bone, applies ? cfg.m : 0);
  }
  let anyShrink = false;
  for (const m of shrinkByBone.values()) if (m > 0) { anyShrink = true; break; }
  if (!anyShrink) return;
  skinnedMesh.updateMatrixWorld(true);
  // ── Unit-space fix (iter156 bug diagnosed by testing agent). ──
  // The bone segments below are transformed into GEOMETRY-LOCAL space
  // via invM. The BODY_SHRINK_BONES magnitudes are authored in WORLD
  // METRES so authors don't need to think about rig scale. Convert
  // by dividing by the mesh's world scale (assume uniform — all rigs
  // scale the character by a single factor). Without this correction,
  // Meshy characters at animScale=0.01 got a 100× too-small shrink
  // and clothing pokethrough persisted (iter156 pre-fix repro).
  const _wsVec = new THREE.Vector3();
  skinnedMesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), _wsVec);
  const worldScale = (Math.abs(_wsVec.x) + Math.abs(_wsVec.y) + Math.abs(_wsVec.z)) / 3;
  const shrinkToLocal = worldScale > 1e-6 ? (1 / worldScale) : 1;
  const invM = new THREE.Matrix4().copy(skinnedMesh.matrixWorld).invert();
  const segs = [];
  for (const bone of skel.bones) {
    const shrinkM_world = shrinkByBone.get(bone) || 0;
    if (shrinkM_world <= 0) continue;
    bone.updateMatrixWorld(true);
    const head = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(invM);
    const tail = new THREE.Vector3();
    if (bone.children.length > 0) {
      bone.children[0].updateMatrixWorld(true);
      tail.setFromMatrixPosition(bone.children[0].matrixWorld).applyMatrix4(invM);
    } else {
      tail.copy(head).addScaledVector(new THREE.Vector3(0, 0.05, 0), 1);
    }
    // Store the LOCAL-space shrink magnitude on each segment.
    segs.push({ head, tail, shrinkM: shrinkM_world * shrinkToLocal });
  }
  const pos = geo.attributes.position;
  const N = pos.count;
  const _tmp = new THREE.Vector3();
  const _out = new THREE.Vector3();
  for (let v = 0; v < N; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    let bestDist2 = Infinity;
    let bestCx = 0, bestCy = 0, bestCz = 0;
    let bestShrink = 0;
    for (const s of segs) {
      const ax = s.head.x, ay = s.head.y, az = s.head.z;
      const bx = s.tail.x, by = s.tail.y, bz = s.tail.z;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz;
      let cx = ax, cy = ay, cz = az;
      if (lenSq > 1e-8) {
        const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq;
        const tc = Math.max(0, Math.min(1, t));
        cx = ax + tc * dx; cy = ay + tc * dy; cz = az + tc * dz;
      }
      const ex = px - cx, ey = py - cy, ez = pz - cz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestCx = cx; bestCy = cy; bestCz = cz;
        bestShrink = s.shrinkM;
      }
    }
    if (bestShrink <= 0) continue;
    _out.set(px - bestCx, py - bestCy, pz - bestCz);
    if (_out.lengthSq() < 1e-8) continue;
    const radial = _out.length();
    const pull = Math.min(bestShrink, radial * 0.6);
    _out.normalize().multiplyScalar(-pull);
    _tmp.set(px, py, pz).add(_out);
    pos.setXYZ(v, _tmp.x, _tmp.y, _tmp.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
