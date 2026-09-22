// Auto-rig — turn any humanoid GLB (rigged or not) into a SkinnedMesh
// bound to our own skeleton, in memory, so it drops straight into
// the game's animation pipeline.
//
// Convention notes:
//   • The original shipped `meshy_warrior.glb` uses an Armature root
//     scaled to 0.01× with bones authored in "100× space" (Hips
//     y~100). Downstream animation code + gun-mount scale expect
//     this convention.
//   • Rather than mimic that weirdness here, our auto-rig ships a
//     natural 1× skeleton. `characterMeshy.js` reads `armature.scale`
//     at attach time to auto-compensate any hardcoded 100× numbers,
//     so both conventions render identically.
//
// Pre-skinned sources (e.g. Meshy AI character exports): most
// character exporters bake in a skin + skeleton even when the DCC
// preview shows a specific sculpted pose — the file's bind pose is
// almost always T-pose, which is what renders if nothing ever poses
// the embedded bones. Rather than rely on that bundled skeleton, we
// throw it away and re-rig from scratch with our own, so every
// character (pre-skinned or not) ends up driven by the same rig +
// animation pipeline.

import * as THREE from 'three';
import { buildHumanoidSkeleton, computeBoneSegments, applyPosePreset } from './humanoidSkeleton.js';
import { bakeEnvelopeSkinning } from './envelopeSkinning.js';

const TARGET_HEIGHT = 1.7;

export function autoRigScene(scene, opts = {}) {
  // iter196 — allow callers to opt out of the 1.7 m normalize.
  // Meshy AI exports authored at their natural height need to keep
  // that height so the sculpted bulk / proportions land at the size
  // the artist intended. Pass `keepNaturalScale: true` OR override
  // `targetHeight` to preserve the sculpted silhouette.
  const targetHeight = opts.keepNaturalScale ? null : (opts.targetHeight || TARGET_HEIGHT);

  // Locate the largest mesh in the scene. `o.isMesh` is true for
  // BOTH THREE.Mesh and THREE.SkinnedMesh (SkinnedMesh extends
  // Mesh), so this already finds a pre-skinned Meshy AI export just
  // as readily as a plain static mesh — no separate lookup needed.
  let bestMesh = null;
  let bestVerts = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const n = o.geometry.attributes.position.count;
      if (n > bestVerts) { bestVerts = n; bestMesh = o; }
    }
  });
  if (!bestMesh) throw new Error('autoRig: no mesh geometry found');

  // ── Reclaim an already-skinned mesh ────────────────────────────
  // `bestMesh.geometry.attributes.position` on a SkinnedMesh holds
  // the RAW BIND-POSE vertex positions — skin deformation happens on
  // the GPU at render time and is never baked into the attribute. So
  // treating this geometry exactly like a plain static mesh's
  // geometry below is correct: it's already the artist's rest-pose
  // shape, we just need to detach the OLD skin/skeleton so nothing
  // downstream mistakes this for an already-rigged character.
  if (bestMesh.isSkinnedMesh) {
    const oldSkeleton = bestMesh.skeleton;
    // Unbind — clears the SkinnedMesh's own skeleton reference. The
    // skinIndex/skinWeight attributes get stripped a few lines down
    // when we clone the geometry for our own SkinnedMesh.
    bestMesh.skeleton = null;
    bestMesh.bindMode = undefined;

    // Best-effort cleanup: remove the old bone hierarchy (usually an
    // "Armature" node somewhere in the scene, not necessarily a
    // child of bestMesh itself) so it doesn't linger unused in the
    // graph. Wrapped defensively — if the scene layout is unusual
    // this just no-ops rather than throwing.
    try {
      if (oldSkeleton && oldSkeleton.bones && oldSkeleton.bones[0]) {
        let node = oldSkeleton.bones[0];
        while (node.parent && node.parent.isBone) node = node.parent;
        // `node` is now the topmost bone. If it sits under a plain
        // container (typically an empty "Armature" Object3D), remove
        // that container; otherwise remove the bone directly.
        const container = node.parent || node;
        if (container.parent) container.parent.remove(container);
      }
    } catch (_) {
      /* non-fatal — old skeleton just stays orphaned in memory */
    }
  }

  // Normalise mesh to 1.7 m tall, feet on y=0, centred on X/Z.
  // Scale is baked into vertices so the parent transform stays
  // identity (no downstream weapon-anchor scale bleed).
  // iter196 — if `keepNaturalScale` was passed, skip the height
  // normalize so the mesh's authored bulk/proportions survive.
  bestMesh.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(bestMesh);
  const rawHeight = Math.max(0.01, rawBox.max.y - rawBox.min.y);
  const meshScale = targetHeight ? (targetHeight / rawHeight) : 1;
  if (meshScale !== 1) bestMesh.geometry.scale(meshScale, meshScale, meshScale);
  bestMesh.geometry.computeBoundingBox();
  const box = bestMesh.geometry.boundingBox;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  bestMesh.geometry.translate(-cx, -box.min.y, -cz);
  bestMesh.position.set(0, 0, 0);
  bestMesh.scale.set(1, 1, 1);
  bestMesh.updateMatrixWorld(true);

  // Build standard 1.7 m humanoid skeleton in A-POSE (arms hanging
  // ~45° down + slightly forward). The default customizable_body.glb
  // ships with the arms in an A-pose — matching the skeleton's rest
  // pose to the mesh's rest pose is critical for envelope skinning,
  // otherwise vertices in the arms get misassigned to leg bones
  // (arms hanging down are geometrically closer to the legs than the
  // T-pose arm bones sticking out horizontally). See humanoidSkeleton
  // .applyPosePreset for the concrete shoulder rotations applied.
  const skel = buildHumanoidSkeleton();
  applyPosePreset(skel.byName, 'a-pose');

  // iter196 — if `keepNaturalScale` was used the mesh stayed at its
  // authored height (e.g. 1.9 m for the Compton Shadow Stance). The
  // 1.7 m skeleton would sit BELOW the mesh's shoulders — envelope
  // skinning would then misassign arm/head vertices to torso bones.
  // Scale the whole skeleton uniformly to the mesh's natural height
  // so bone segments track the sculpted silhouette.
  if (opts.keepNaturalScale) {
    const skelScale = rawHeight / 1.7;
    skel.root.scale.setScalar(skelScale);
  }
  skel.root.updateMatrixWorld(true);

  // Bone segments to mesh-local space (matrix is identity but kept
  // for safety in case the mesh ever ships with a non-identity xform).
  const invMesh = new THREE.Matrix4().copy(bestMesh.matrixWorld).invert();
  const segsWorld = computeBoneSegments(skel.bones, skel.root);
  const segsLocal = segsWorld.map((s) => ({
    head: s.head.clone().applyMatrix4(invMesh),
    tail: s.tail.clone().applyMatrix4(invMesh),
    bone: s.bone,
  }));

  const geo = bestMesh.geometry.clone();
  // Strip any incoming skin attributes — whether from a pre-skinned
  // source (reclaimed above) or otherwise. Our own bakeEnvelopeSkinning
  // call below writes fresh skinIndex/skinWeight against segsLocal.
  if (geo.attributes.skinIndex)  geo.deleteAttribute('skinIndex');
  if (geo.attributes.skinWeight) geo.deleteAttribute('skinWeight');
  bakeEnvelopeSkinning(geo, segsLocal, 4);

  const skinned = new THREE.SkinnedMesh(geo, bestMesh.material);
  skinned.name = bestMesh.name || 'AutoRiggedCharacter';
  skinned.position.set(0, 0, 0);
  skinned.rotation.set(0, 0, 0);
  skinned.scale.set(1, 1, 1);
  const threeSkeleton = new THREE.Skeleton(skel.bones);
  skinned.add(skel.root);
  skinned.bind(threeSkeleton, skinned.matrixWorld);

  const parent = bestMesh.parent || scene;
  parent.remove(bestMesh);
  parent.add(skinned);

  // Tag the skinned mesh so `characterMeshy` can identify auto-rigged
  // characters and apply the 100× ↔ 1× compensation deltas.
  skinned.userData.autoRigged = true;

  return { skinnedMesh: skinned, boneMap: skel.byName };
}