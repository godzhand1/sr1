// characterMeshy.js — AAA skinned-mesh character loader.
//
// Loads the Meshy AI Dynamic Warrior GLB (24-joint humanoid skeleton)
// once, caches the parsed asset, and hands out per-character clones
// that share the same base geometry. Each clone owns its own skeleton
// / SkinnedMesh so animations don't stomp between actors.
//
// Public API — matches `createSaintModel(...)` in characterModel3d.js:
//   const api = await createSaintModelMeshy(palette, team, label);
//   api.group          — THREE.Group to add to the scene
//   api.animate(t, f)  — advance the pose for this frame
//   api.setTagVisible(v)
//   api.setHpBar(v, frac)
//   api.dispose()
//
// Because GLTFLoader is async but the caller (view3d) creates models
// synchronously in a loop, we return a proxy immediately: the .group
// is present right away and the SkinnedMesh is spliced in when the
// GLB resolves. Animations run against whatever skeleton is currently
// attached — nothing crashes if the model isn't ready yet.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { gunProp, catOf } from './characterModel3d.js';
import { getCustomCharacterBlobURL } from './customCharacterStore.js';
import { getCharSource } from './characterSource.js';
import { autoRigScene } from './autoRig.js';
import { loadAsset } from './objAssets.js';
import { SLOT_META } from './srClothing.js';
import { bakeEnvelopeSkinning } from './envelopeSkinning.js';
import { getClothingOffset, fetchServerOffsets } from './clothingOffsets.js';
import {
  SKINNED_BODY_SLOTS, SLOT_BONE_WHITELIST, SLOT_INFLATE, BODY_SHRINK_BONES,
  HEAD_SLOTS,
  bindClothingToSkeleton, inflateGeoRadialFromBones, applyBodyShrink,
} from './characterMeshyClothing.js';
import { getWeaponOffset, hasWeaponOffset, fetchServerWeaponOffsets } from './weaponOffsets.js';
import { stepCharacterAnim } from './characterMeshyAnim.js';
import { createComptonRigidModel } from './comptonCharacter.js';

// Kick off the server-globals fetch on module load. Character factories
// that fire before the fetch settles get identity offsets; a
// `sr:clothing-offset-changed` event dispatches when the server data
// lands, giving live scenes a chance to rebuild.
if (typeof window !== 'undefined') {
  fetchServerOffsets();
  fetchServerWeaponOffsets();
}

// Default customizable body — iter195 SWAP: user uploaded a Meshy
// "Compton Shadow Stance" GLB and asked us to disable the previous
// custom player + clothing overlays and use this mesh as the canonical
// character. It's unrigged (static Meshy AI export), so autoRigScene
// runs on it once at load time — the rest of the animation pipeline
// (walk cycle, aim pose, sit-in-car, etc.) drives the resulting rig
// exactly like the shipped customizable_body did.
const DEFAULT_BODY_URL = '/models/compton_shadow.glb';
// Original customizable body kept for potential fallback / opt-out.
const _LEGACY_CUSTOMIZABLE_BODY_URL = '/models/customizable_body.glb';
const LEGACY_WARRIOR_URL = '/models/meshy_warrior.glb';
void _LEGACY_CUSTOMIZABLE_BODY_URL;
// Back-compat: some older imports/logs reference MESHY_URL by name.
// Keep the identifier pointing at the current default so nothing
// downstream breaks.
const MESHY_URL = DEFAULT_BODY_URL;

// Shared cache — first request kicks off the fetch, all subsequent
// requests await the same Promise.
let _loadPromise = null;
let _template = null;                                // { scene, skinnedMesh, boneMap }
let _templateHash = 0;

// Invalidate the shared cache so the next character spawn re-loads
// from source (IndexedDB custom character OR the shipped GLB).
// Called by Rig Lab's "Use in Game" button so a freshly-rigged
// character takes effect on the next respawn without a page reload.
export function resetMeshyTemplateCache() {
  _template = null;
  _loadPromise = null;
  _templateHash = (_templateHash + 1) | 0;
}

// Kick off the character GLB fetch + parse and return a promise that
// resolves when the SkinnedMesh template is ready. Used by the
// pre-match loading screen so the character is fully baked into
// memory BEFORE the play scene mounts — no more "player is invisible
// for the first 1-2s of the match". Idempotent — safe to call from
// multiple UI layers.
export function preloadCharacter() {
  return _loadTemplate().then(() => true).catch((err) => {
    console.warn('[characterMeshy] preload failed', err);
    return false;
  });
}

export function isCharacterReady() {
  return !!_template;
}

function _loadTemplate() {
  if (_template) return Promise.resolve(_template);
  if (_loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise(async (resolve, reject) => {
    const source = getCharSource();
    let sourceURL = DEFAULT_BODY_URL;
    let customURL = null;
    if (source === 'custom') {
      try {
        customURL = await getCustomCharacterBlobURL();
        if (customURL) sourceURL = customURL;
      } catch (_) {
        /* keep DEFAULT_BODY_URL fallback */
      }
    }
    loader.load(
      sourceURL,
      (gltf) => {
        // Free the blob URL now that the parse is complete — the
        // geometry / textures live in GPU buffers so the underlying
        // blob reference is safe to revoke.
        if (customURL) URL.revokeObjectURL(customURL);
        const scene = gltf.scene || gltf.scenes[0];

        // Always run our own rig system — autoRigScene now handles
        // BOTH unrigged sources AND pre-skinned sources (e.g. Meshy
        // AI exports that ship their own baked skeleton). We used to
        // check for an existing SkinnedMesh first and only auto-rig
        // if none was found — but that meant pre-skinned sources
        // rendered at whatever bind pose the FILE shipped with
        // (almost always T-pose), since nothing ever posed those
        // embedded bones. autoRigScene now strips any incoming skin
        // and re-rigs from scratch with our own skeleton + envelope
        // skinning, so every source — rigged or not — ends up driven
        // by the same animation pipeline.
        //
        // iter196 — for the Compton Shadow Stance body we pass
        // `keepNaturalScale: true` so the sculpted 1.9 m mesh stays
        // at its authored size (and its bulky proportions with it)
        // instead of getting scaled to 1.7 m by autoRig. The skeleton
        // scales up to match so envelope skinning still lines up.
        let skinned = null;
        try {
          const isComptonBody = sourceURL.includes('compton_shadow');
          const rigged = autoRigScene(scene, isComptonBody ? { keepNaturalScale: true } : {});
          if (rigged) skinned = rigged.skinnedMesh;
        } catch (err) {
          reject(err);
          return;
        }
        if (!skinned) {
          reject(new Error('character GLB has no SkinnedMesh (auto-rig failed)'));
          return;
        }
        skinned.castShadow = true;
        skinned.receiveShadow = true;
        skinned.frustumCulled = false;                // arms often reach past root AABB
        // Extract a name→bone map for the joints so the animation
        // driver can address them cleanly.
        const boneMap = {};
        for (const b of skinned.skeleton.bones) boneMap[b.name] = b;
        // Grab the walking clip that ships with the GLB — 72 channels
        // covering hips/legs/arms/spine. This becomes the base
        // locomotion track that we cross-fade with the procedural
        // layer at runtime. Auto-rigged sources have no clip; the
        // procedural walk layer fills in the gap.
        const walkClip = gltf.animations && gltf.animations[0] ? gltf.animations[0] : null;
        _template = { scene, skinnedMesh: skinned, boneMap, walkClip };
        resolve(_template);
      },
      undefined,
      (err) => {
        if (customURL) URL.revokeObjectURL(customURL);
        reject(err);
      },
    );
  });
  return _loadPromise;
}
// ── Bone helpers ─────────────────────────────────────────────────
// Note: `br`, `pointBoneAt`, and their scratch temps used to live
// here. They moved to characterMeshyAnim.js during the iter157
// Phase-2 refactor (~800 lines of animate() split into its own
// module). The remaining `armWorld` helper below is legacy dead
// code retained for reference — see the deprecation note.
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);
// Scratch quaternions for world→local conversion in armWorld.
const _armParentQ = new THREE.Quaternion();
const _armWorldRot = new THREE.Quaternion();
const _armTmpQ1 = new THREE.Quaternion();
const _armTmpQ2 = new THREE.Quaternion();
const _armTmpQ3 = new THREE.Quaternion();

// ── Legacy world-axis rotation applier ───────────────────────────
// Kept for the previous convention where rY, rZ, rX were world Y/Z/X
// deltas layered on top of the bone's rest orientation. Not used by
// the new pointBoneAt-based arm pipeline but retained in case any
// non-arm code still expects it.
//
// Rotation order: R_Y * R_Z * R_X (yaw → fold → pitch) applied AFTER
// the bone's rest world orientation.
function armWorld(bone, tY, tZ, tX, k) {
  if (!bone || !bone.userData._restQ || !bone.parent) return;
  let s = bone.userData._armWorld;
  if (!s) { s = { y: 0, z: 0, x: 0 }; bone.userData._armWorld = s; }
  s.y += ((tY || 0) - s.y) * k;
  s.z += ((tZ || 0) - s.z) * k;
  s.x += ((tX || 0) - s.x) * k;
  // Get parent's current world quaternion (fresh — Three.js updates
  // world matrices as needed).
  bone.parent.getWorldQuaternion(_armParentQ);
  // Build the world-space rotation to apply AFTER rest orientation.
  _armTmpQ1.setFromAxisAngle(WORLD_Y, s.y);
  _armTmpQ2.setFromAxisAngle(WORLD_Z, s.z);
  _armTmpQ3.setFromAxisAngle(WORLD_X, s.x);
  _armWorldRot.copy(_armTmpQ1).multiply(_armTmpQ2).multiply(_armTmpQ3);
  // Target world quaternion = worldRot * restWorldQ
  //                        = worldRot * (parentWorldQ * restLocalQ)
  const targetWorldQ = _armTmpQ1.copy(_armWorldRot)
    .multiply(_armParentQ)
    .multiply(bone.userData._restQ);
  // Convert to bone-local: newLocalQ = parentWorldQInv * targetWorldQ
  bone.quaternion.copy(_armParentQ).invert().multiply(targetWorldQ);
}

// ── Nametag / HP bar (unchanged from OBJ character) ──────────────
// Small canvas-backed sprite floating above the head. Kept minimal
// so the whole rig stays lightweight per-actor.
export function makeTagSprite(label, color) {
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

// HP-bar background + fill quads (billboard via sprite).
// Fill is RED (0xe23030) to match the shooter genre convention where
// enemy/teammate health reads as red — matches characterModel3d.js.
export function makeHpBar() {
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

// ── SR cosmetics attachment ───────────────────────────────────────
// Loads the palette's clothing / hair / facial-hair / hat / glasses
// OBJs and adds them as rigid overlays under the character root. The
// SR OBJ library was authored around the legacy `man.obj` body (feet
// at Y=0, head bone at Y≈1.81, ~1.85m total height). We measure the
// current SkinnedMesh's height and uniformly scale the cosmetics to
// match — 1.7m auto-rigged bodies get 0.919× scale, 1.85m Meshy
// warrior gets 1.0×. Head items (hat / hair / glasses / facial hair)
// parent to the Head bone so they follow the head's yaw/pitch during
// aim + idle animations; body items (shirt / pants / jacket / shoes /
// socks / boxers) sit under cloneRoot and follow only the character
// transform (rigid overlay — leg animations are subtle enough that
// pants not deforming with the knee is imperceptible during play).
//
// The `srClothing` slot IDs come from `characterBuilder.js`. A slot
// value of `'none'` (or missing) skips the load — that's how Bald
// hair, Clean-shaven facial hair, and No-hat/glasses render.
const SR_AUTHORED_HEIGHT = 1.75;
// Clothing-skin constants + helpers (SKINNED_BODY_SLOTS,
// SLOT_BONE_WHITELIST, SLOT_INFLATE, BODY_SHRINK_BONES, HEAD_SLOTS,
// bindClothingToSkeleton, inflateGeoRadialFromBones, applyBodyShrink)
// are imported at the top of this file from `./characterMeshyClothing.js`.
// Extracted in iter156 as the first step of the AAA refactor: all
// pure geometry helpers with no closure dependencies now live in
// their own module so a future dedicated iter can add tests for them
// without dragging in the full character-load pipeline.
//
// Apply Clothing Lab calibration to a geometry, in place, BEFORE any
// downstream skinning bake or scale-to-body step. Order of ops:
//   1. rotate around the OBJ's authored origin
//   2. per-axis scale
//   3. translate
// This matches the "T * R * S" convention Three.js uses for object
// transforms, so numbers dialled in the editor UI feel intuitive.
// Also returns the additional inflate amount the caller should ADD
// to its per-slot baseline puff.
function _applyClothingOffset(geo, offset) {
  if (!offset) return 0;
  const [rx, ry, rz] = offset.rotation || [0, 0, 0];
  const [sx, sy, sz] = offset.scale    || [1, 1, 1];
  const [tx, ty, tz] = offset.position || [0, 0, 0];
  const needsRot   = rx !== 0 || ry !== 0 || rz !== 0;
  const needsScale = sx !== 1 || sy !== 1 || sz !== 1;
  const needsTrans = tx !== 0 || ty !== 0 || tz !== 0;
  if (needsRot || needsScale || needsTrans) {
    const m = new THREE.Matrix4();
    if (needsRot)   m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    if (needsScale) m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
    if (needsTrans) m.premultiply(new THREE.Matrix4().makeTranslation(tx, ty, tz));
    geo.applyMatrix4(m);
    geo.computeBoundingBox();
  }
  return (typeof offset.inflate === 'number') ? offset.inflate : 0;
}

// SR shoes are authored around X = ±0.24 (each shoe centred at ~24 cm
// off midline). Splitting the OBJ into halves by X-sign lets us mount
// each shoe on its matching foot bone, so shoes follow leg animation
// AND land under the actual leg-end regardless of body proportions.
function _splitShoeGeoByX(geo) {
  // Build vertex → half assignment (+1 = left half in OBJ space,
  // −1 = right half). Vertices near X=0 (unlikely for shoes) default
  // to the left half.
  const pos = geo.attributes.position;
  const N = pos.count;
  // Compute per-half bounds so we can centre each half on X=0 before
  // attaching it to its foot bone. The half's X centre becomes the
  // new local origin so cosmeticsScale + foot-bone attachment don't
  // stack an unwanted X-shift on top.
  let lMinX = Infinity, lMaxX = -Infinity;
  let rMinX = Infinity, rMaxX = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = pos.getX(i);
    if (x >= 0) { if (x < lMinX) lMinX = x; if (x > lMaxX) lMaxX = x; }
    else       { if (x < rMinX) rMinX = x; if (x > rMaxX) rMaxX = x; }
  }
  const lCx = (lMinX + lMaxX) * 0.5;
  const rCx = (rMinX + rMaxX) * 0.5;

  const halves = { left: [], right: [] };
  // Collect triangle indices per half. If the geometry is un-indexed,
  // treat every 3 consecutive vertices as a triangle.
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : N / 3;
  const getIdx = idx ? (i) => idx.getX(i) : (i) => i;

  for (let t = 0; t < triCount; t++) {
    const a = getIdx(t * 3);
    const b = getIdx(t * 3 + 1);
    const c = getIdx(t * 3 + 2);
    // Assign a whole triangle to whichever half its centroid falls in
    // (avoids splitting a triangle across halves and creating cracks).
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    (cx >= 0 ? halves.left : halves.right).push(a, b, c);
  }

  const _buildHalf = (triList, offsetX) => {
    if (triList.length === 0) return null;
    // Compact the vertex set — only keep vertices actually referenced
    // by this half's triangles, and translate them so the half's X
    // centre sits at the local origin (mount point). This means the
    // half's OBJ-local origin becomes the foot-bone attachment point.
    const seen = new Map();
    const outPos = [];
    const outIdx = [];
    for (let i = 0; i < triList.length; i++) {
      const vi = triList[i];
      let ni = seen.get(vi);
      if (ni === undefined) {
        ni = outPos.length / 3;
        seen.set(vi, ni);
        outPos.push(pos.getX(vi) - offsetX, pos.getY(vi), pos.getZ(vi));
      }
      outIdx.push(ni);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
    g.setIndex(outIdx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  };
  return {
    left:  _buildHalf(halves.left,  lCx),
    right: _buildHalf(halves.right, rCx),
    leftCx: lCx,
    rightCx: rCx,
  };
}

function attachShoesToFootBones(geo, mat, boneMap, cosmeticsScale, cloneSkinned) {
  const split = _splitShoeGeoByX(geo);
  if (!split.left || !split.right) return;

  // Measure the mesh's actual leg-bottom X extent so shoes land under
  // the visible legs (which may be wider than the foot-bone spacing —
  // auto-rig places feet at X=±0.09 but MakeHuman-style meshes have
  // ~15-cm legs). We sample bind-pose positions of vertices in the
  // lowest 15 cm of the mesh and pick the far-left / far-right
  // clusters. Falls back to the foot bone's world X if the mesh has
  // no useful bottom-slice geometry.
  cloneSkinned.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(cloneSkinned);
  const yFloor = bbox.min.y;
  const yBand = yFloor + 0.15;
  const posAttr = cloneSkinned.geometry.attributes.position;
  const NV = posAttr.count;
  const _pv = new THREE.Vector3();
  let leftX = -Infinity, rightX = Infinity;
  // Convert bind-pose local X into cloneRoot-local X. cloneRoot has
  // Y=180° rot → world +X is cloneRoot local -X. Both LeftUpLeg (X>0
  // in bind) and RightUpLeg (X<0 in bind) live in the SAME
  // cloneRoot-local frame the shoe halves live in.
  const cloneInv = new THREE.Matrix4().copy(cloneSkinned.matrixWorld).invert();
  for (let i = 0; i < NV; i++) {
    _pv.fromBufferAttribute(posAttr, i).applyMatrix4(cloneSkinned.matrixWorld).applyMatrix4(cloneInv);
    if (_pv.y > yBand) continue;
    if (_pv.x > leftX)  leftX  = _pv.x;   // most-positive-X = character-left in bind
    if (_pv.x < rightX) rightX = _pv.x;   // most-negative-X = character-right
  }
  const boneLW = new THREE.Vector3();
  const boneRW = new THREE.Vector3();
  boneMap.LeftFoot.getWorldPosition(boneLW);
  boneMap.RightFoot.getWorldPosition(boneRW);
  boneLW.applyMatrix4(cloneInv);
  boneRW.applyMatrix4(cloneInv);
  // Desired X per shoe (cloneRoot-local): midway between the leg-bone
  // X and the mesh-outer-edge X — puts shoes under the visible leg
  // silhouette without pushing them off the leg entirely.
  const leftShoeX  = isFinite(leftX)  ? (boneLW.x + leftX)  * 0.5 : boneLW.x;
  const rightShoeX = isFinite(rightX) ? (boneRW.x + rightX) * 0.5 : boneRW.x;
  // Offsets, expressed in each bone's local frame. Bones inherit
  // cloneRoot's Y=180° so cloneRoot-local X flips sign — but LeftFoot's
  // own translation is +X in cloneRoot local (= -X in world), and its
  // own local frame is un-rotated relative to cloneRoot, so an offset
  // in bone-local X directly overlays cloneRoot-local X.
  const leftOffsetX  = leftShoeX  - boneLW.x;
  const rightOffsetX = rightShoeX - boneRW.x;

  const _mount = (bone, halfGeo, offsetX) => {
    const shoe = new THREE.Mesh(halfGeo, mat);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    shoe.userData.srCosmetic = 'shoes:half';
    const ws = new THREE.Vector3();
    bone.getWorldScale(ws);
    const invBone = ws.x > 1e-6 ? 1 / ws.x : 1;
    shoe.scale.setScalar(cosmeticsScale * invBone);
    // Bone's local +X aligns with cloneRoot-local +X (bones don't
    // rotate around Y themselves). We push the shoe outward by the
    // (offset / cosmeticsScale) so the final world X matches the
    // measured leg-edge target — the scale would otherwise squash the
    // offset.
    const scaleFactor = cosmeticsScale * invBone;
    shoe.position.set(offsetX / (scaleFactor || 1), 0, 0);
    bone.add(shoe);
  };
  _mount(boneMap.LeftFoot,  split.left,  leftOffsetX);
  _mount(boneMap.RightFoot, split.right, rightOffsetX);
}

// ── Body-clothing → SkinnedMesh binding ───────────────────────────
// Turn a rigid SR OBJ (shirt / pants / jacket / socks / boxers) into
// a THREE.SkinnedMesh bound to the character's existing skeleton.
// Clothing verts follow the same envelope-skinning path autoRig uses
// on the body itself, so pants bend at the knee, shirts twist with
// the spine, and jackets swing with the arms.
//
// Coordinate space: SR OBJs are authored around a body facing +Z with
// feet at Y=0. The character mesh's bind pose is +Z-facing identity-
// space, feet at Y=0 — same frame after we scale the clothing verts
// by `cosmeticsScale` (matches the character's 1.7 m height to the
// SR-authored 1.75 m body). No Y=180 vertex flip needed: skinning
// applies the CURRENT bone.worldMatrix (which includes cloneRoot's
// Y=180°) to bind-space verts, so the clothing ends up in the same
// world orientation as the body.
//
// Bone-segment cache: computed ONCE per character factory call from
// the skeleton's boneInverses (bind-pose bone world matrices), reused
// across every clothing slot on that character.
function _boneSegmentsFromBindPose(skeleton) {
  // bindMat[i] = inverse of boneInverses[i] = bone.worldMatrix at
  // bind time. Vectors decoded from these are in the same identity-
  // world frame the character mesh's own vertices live in.
  const bindMats = skeleton.boneInverses.map((inv) =>
    new THREE.Matrix4().copy(inv).invert(),
  );
  const heads = bindMats.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
  const segs = [];
  for (let i = 0; i < skeleton.bones.length; i++) {
    const bone = skeleton.bones[i];
    const head = heads[i];
    let tail = null;
    for (const c of bone.children) {
      if (!c.isBone) continue;
      const ci = skeleton.bones.indexOf(c);
      if (ci >= 0) { tail = heads[ci].clone(); break; }
    }
    if (!tail) {
      // Terminal bone (Head / Hand / Foot) — short forward extension
      // along the +Y axis in bind space so envelope distance calcs
      // near the tip don't blow up.
      tail = head.clone().add(new THREE.Vector3(0, 0.08, 0));
    }
    segs.push({ head, tail, bone });
  }
  return segs;
}

// bindClothingToSkeleton, inflateGeoRadialFromBones, and applyBodyShrink
// now live in ./characterMeshyClothing.js (imported at file top).


function attachCosmetics(cloneRoot, cloneSkinned, boneMap, palette) {
  const srClothing = (palette && palette.srClothing) || {};
  // Set of populated skinned-body slots — used to decide which
  // regions of the body get the smart shrink pass (iter156).
  const _skinnedSlotsOn = new Set();
  for (const s of SKINNED_BODY_SLOTS) if (srClothing[s]) _skinnedSlotsOn.add(s);
  // Apply the smart body-shrink once, BEFORE any clothing is bound.
  // Shrinks only the LARGE-DIAMETER regions (torso + thighs + shoulders
  // + arms) where puffy fabric would otherwise reveal pokethrough.
  // Head, hands, feet stay at full size. This is a NO-OP if no
  // skinned-body slots are equipped, so naked characters aren't
  // affected.
  if (_skinnedSlotsOn.size > 0 && cloneSkinned?.geometry && cloneSkinned.skeleton) {
    applyBodyShrink(cloneSkinned, _skinnedSlotsOn);
  }

  // Measure the mesh's current world-space silhouette so cosmetics
  // scale to match. The SR OBJ library was captured from Saints Row
  // Xbox 360 assets — verified via `head` inspection of the shipped
  // .obj files: head cosmetics sit at Y≈1.4-1.75, chin at Y≈1.37,
  // hair top at Y≈1.75. This tracks a body of roughly ~1.75 m tall,
  // essentially the same proportions as our 1.7 m auto-rigged mesh.
  // Scale by (currentHeight / 1.75) so cosmetics land where they
  // were authored — head items around our Head bone, pants around
  // our hips, shoes at our feet.
  cloneSkinned.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(cloneSkinned);
  const meshHeight = Math.max(0.5, bbox.max.y - bbox.min.y);
  const cosmeticsScale = meshHeight / SR_AUTHORED_HEIGHT;

  // Parent everything (body + head cosmetics) under cloneRoot. Head
  // cosmetics won't follow per-frame Head-bone rotation with this
  // simple attach — the hat/hair rotate with the character's yaw
  // (via the group transform) but stay stable during head-bob idles.
  // That's an acceptable trade-off for a rigid overlay pass; a
  // future revision can parent to boneMap.Head with the appropriate
  // bone-scale compensation once we've validated the base positioning
  // via screenshot testing.
  void boneMap; // reserved for future per-bone parenting
  const cosRoot = new THREE.Group();
  cosRoot.name = 'SRCosmetics';
  cosRoot.scale.setScalar(cosmeticsScale);
  cosRoot.position.set(0, bbox.min.y, 0);
  cloneRoot.add(cosRoot);

  // ── Head cosmetics pivot group (follows Head bone rotation) ────
  // Hair / hat / glasses / facial-hair / eyes need to rotate with
  // the head bone so they don't punch through the skull when the
  // character looks down, crouches, or rag-dolls. We can't just make
  // them children of the Head bone at (0,0,0) because SR OBJs are
  // authored in absolute-world coords around the SR body (feet at
  // Y=0, head at Y≈1.6), not around a per-bone origin.
  //
  // Trick: a single group with position=(0, -headBoneWorldY, 0) and
  // scale=cosmeticsScale, parented to the Head bone. When composed
  // through the bone's transform, this yields
  //   worldV = HeadBoneWorldMatrix × ((0,-headBoneY,0) + cosmScale·V)
  // At the bind pose, that reduces to `cosmScale × V` — matching the
  // rigid cosRoot placement exactly — so hats sit in the SAME spot
  // as before. When the head rotates, the whole subtree rotates
  // around the bone's world position, dragging the hat with it.
  let headCosGroup = null;
  const headBoneForCos = boneMap.Head || boneMap.HeadTop_end;
  if (headBoneForCos) {
    headBoneForCos.updateMatrixWorld(true);
    const _hp = new THREE.Vector3().setFromMatrixPosition(headBoneForCos.matrixWorld);
    // Convert head bone world position into cloneRoot-local Y. cloneRoot
    // Y=180° doesn't touch Y so a straight subtract works here — we're
    // already in cloneRoot's coordinate frame for the shift.
    const headLocalY = _hp.y - bbox.min.y;
    headCosGroup = new THREE.Group();
    headCosGroup.name = 'SRHeadCos';
    // Undo any parent-inherited scale so the OBJ verts render at their
    // authored (SR) size after we apply cosmeticsScale ourselves.
    const _hws = new THREE.Vector3();
    headBoneForCos.getWorldScale(_hws);
    const invHead = _hws.x > 1e-6 ? 1 / _hws.x : 1;
    headCosGroup.scale.setScalar(cosmeticsScale * invHead);
    // In HEAD BONE local frame, the head bone's world position projects
    // to (0,0,0). To keep OBJ verts at the same world position they had
    // under cosRoot, offset in this local frame by −headLocalY / (bone
    // scale) so the offset survives the bone's own transform intact.
    headCosGroup.position.set(0, -headLocalY * invHead, 0);
    headBoneForCos.add(headCosGroup);
  }

  // Colour palette by role — matches the legacy
  // `characterModel3d.js` mapping so bots and player wear the same
  // per-role colours after switching to the new body.
  const P = palette || {};
  const asColor = (c, fallback) => {
    if (c && c.isColor) return c;
    try { return new THREE.Color(c || fallback); } catch { return new THREE.Color(fallback); }
  };
  const colours = {
    legs:   asColor(P.legs,   '#2746a7'),
    torso:  asColor(P.torso,  '#e8e8e8'),
    shoes:  asColor(P.shoes,  '#111111'),
    socks:  asColor('#e8e8e8'),
    boxers: asColor(P.hips || P.legs, '#ea580c'),
    hair:   asColor(P.hair,   '#1b1b1b'),
    wrap:   asColor(P.wrap,   '#7c3aed'),
    frame:  asColor('#1a1a22'),
  };

  // Bind-pose bone segments — computed once and reused across every
  // SkinnedMesh clothing item on this character so we don't repeat
  // the boneInverse decode work for each slot.
  let _cachedSegs = null;
  const _getSegs = () => {
    if (_cachedSegs) return _cachedSegs;
    if (cloneSkinned.skeleton && cloneSkinned.skeleton.bones.length > 0) {
      _cachedSegs = _boneSegmentsFromBindPose(cloneSkinned.skeleton);
    }
    return _cachedSegs;
  };

  const _attachSlot = (slotName, assetId) => {
    if (!assetId || assetId === 'none') return;
    const meta = SLOT_META[slotName];
    if (!meta) return;
    const colour = colours[meta.colourRole] || asColor('#808080');
    const mat = new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide });
    // Global per-asset calibration from Clothing Lab. Applied to a
    // cloned geometry BEFORE any of the three attach paths so the
    // downstream skinning / bone-parenting logic sees the corrected
    // vertex positions.
    const _offset = getClothingOffset(assetId);
    loadAsset(`${assetId}.obj`)
      .then((rawGeo) => {
        if (!rawGeo) return;
        const geo = rawGeo.clone();
        const extraInflate = _applyClothingOffset(geo, _offset);
        // SHOES special-case — the SR shoe OBJ ships as a SINGLE mesh
        // containing BOTH left + right shoes (X≈±0.24 in authored
        // space). The auto-rigged custom body has NO feet in the mesh
        // (legs terminate at ~ankle height) and its foot bones sit at
        // X≈±0.09 — the SR shoe positions are ~15 cm too far out,
        // leaving the shoes visibly detached and offset from the legs.
        //
        // Fix: split the OBJ into left + right halves by X-sign,
        // attach each half to its corresponding Foot bone. Each shoe
        // then follows the leg's foot bone during walk / crouch / kick
        // animations AND lines up under the character's leg ends
        // regardless of the auto-rig body's actual proportions.
        if (slotName === 'shoes' && boneMap.LeftFoot && boneMap.RightFoot) {
          attachShoesToFootBones(geo, mat, boneMap, cosmeticsScale, cloneSkinned);
          return;
        }
        // BODY CLOTHING — bind as a SkinnedMesh to the character's
        // skeleton so it deforms with bones (shirts twist with the
        // spine, pants bend at the knee, jackets swing with the arms).
        // Envelope skinning bakes per-vertex weights against every bone
        // segment in the bind pose; the result is a proper SkinnedMesh
        // sharing the character's skeleton — one draw call per slot
        // but the vertex shader handles all the deformation.
        if (SKINNED_BODY_SLOTS.has(slotName)) {
          const segs = _getSegs();
          if (segs) {
            const baseInflate = SLOT_INFLATE[slotName] || 0.015;
            const skinnedClothing = bindClothingToSkeleton(
              geo, cloneSkinned, cosmeticsScale, mat,
              `${slotName}:${assetId}`, segs,
              SLOT_BONE_WHITELIST[slotName] || null,
              baseInflate + extraInflate,
            );
            if (skinnedClothing) {
              // Sibling of cloneSkinned so both meshes render inside
              // cloneRoot's Y=180° group. Skinning ignores our own
              // matrixWorld (bindMode='attached' composes bone
              // transforms with the mesh's world matrix inversely), so
              // the parent choice only affects render order / culling.
              cloneRoot.add(skinnedClothing);
              return;
            }
          }
          // Fall through to rigid attach if binding failed (skeleton
          // missing — shouldn't happen for auto-rigged bodies).
        }
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.srCosmetic = `${slotName}:${assetId}`;
        // Head slots (hair/hat/glasses/facialHair) go into the Head-
        // bone-parented group so they follow the head's yaw/pitch
        // during idle bobs, aim, crouch, and rag-doll poses. Body
        // slots that fell through here (non-skinned fallback) go under
        // cosRoot which follows the character root only.
        const parent = (HEAD_SLOTS.has(slotName) && headCosGroup) ? headCosGroup : cosRoot;
        parent.add(m);
      })
      .catch((err) => {
        if (typeof console !== 'undefined') console.warn(`[characterMeshy] cosmetic OBJ load failed (${assetId}):`, err);
      });
  };

  // iter195 — Compton character override: SKIP clothing overlays.
  // The Meshy AI "Compton Shadow Stance" mesh ships fully authored
  // (jacket, pants, shoes, accessories, face — all one welded piece
  // with baked textures). Overlaying our slot-based clothing on top
  // would double-layer the geometry and cover the sculpted textures.
  // User asked us to disable both the custom player AND the clothing
  // system, so we short-circuit the SLOT_META loop entirely.
  const USE_COMPTON_BODY = false;
  if (!USE_COMPTON_BODY) {
    for (const slot of Object.keys(SLOT_META)) {
      _attachSlot(slot, srClothing[slot]);
    }
  }

  // ── Eye colour (iris orbs) ──────────────────────────────────────
  // The custom body ships with baked-in eye sockets on the mesh but
  // no separate eye material we can retint. We overlay two tiny iris
  // spheres on top of the sockets, coloured from `palette.eyes`, so
  // Character Creator's eye-colour picker actually shows through.
  // Positions are authored in the SR OBJ coord frame (Y≈1.60 head
  // centre, Z=+0.09 front of face, X=±0.03 eye separation) and get
  // uniformly scaled + Y=180 rotated with the rest of cosRoot so
  // they land right on the character's face.
  if (P.eyes) {
    const eyeColor = asColor(P.eyes, '#3a2417');
    const eyeMat = new THREE.MeshLambertMaterial({ color: eyeColor });
    const eyeGeo = new THREE.SphereGeometry(0.018, 10, 8);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    // Slightly proud of the socket surface so they render on top even
    // when the base body mesh has an opaque skin tone in the same
    // spot.
    eyeR.position.set(-0.032, 1.605, 0.088);
    eyeL.position.set( 0.032, 1.605, 0.088);
    eyeR.userData.srCosmetic = 'eyes:right';
    eyeL.userData.srCosmetic = 'eyes:left';
    // Eyes ride with the Head bone so they pitch/roll with head look
    // (otherwise a downward-glancing character would have eyes floating
    // in mid-air where the face used to be).
    const eyeParent = headCosGroup || cosRoot;
    eyeParent.add(eyeR);
    eyeParent.add(eyeL);
  }
}

// ── Public factory ────────────────────────────────────────────────
export function createSaintModelMeshy(palette, team, label) {
  // iter201 — REVERTED per user: "this rig system in its current
  // state messes up the loaded mesh. what we had right before this
  // was perfect with the mesh. so you'll need to make a new rig
  // system so that the mesh does not alter". The Meshy autoRig +
  // envelope skinning DOES visibly deform the sculpted Compton
  // proportions when it rebinds vertices onto our slim humanoid
  // bones. So we DELEGATE back to the rigid Compton loader — the
  // mesh renders exactly as Meshy AI authored it, and per-state
  // poses (walk / run / crouch / fire / eat / crouch-shoot / etc.)
  // are driven by the WHOLE-BODY animate() in comptonCharacter.js.
  // No vertex data is ever touched.
  const USE_COMPTON_BODY = true;
  if (USE_COMPTON_BODY) return createComptonRigidModel(palette, team, label);

  const group = new THREE.Group();
  // ROOT origin sits at the character's feet. The Meshy mesh is
  // authored with its origin at Y=0 (foot plane) so no offset needed.

  const teamColor = team === 'B' ? '#0ea5e9' : '#c084fc';
  const tag = makeTagSprite(label || '', teamColor);
  group.add(tag);
  const { bg: barBg, fill: barFill } = makeHpBar();
  group.add(barBg); group.add(barFill);

  // Weapon mount — an empty Object3D that will be re-parented to the
  // RightHand bone once the skeleton loads. Weapons attach here.
  const gunMount = new THREE.Group();
  gunMount.position.set(0, 1.2, 0);                  // fallback if bone not ready
  group.add(gunMount);

  // Placeholder box until the async GLB resolves — a slim capsule
  // so the scene isn't jarring. Auto-removed after the swap.
  const placeholder = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 1.2, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.35 }),
  );
  placeholder.position.y = 0.9;
  group.add(placeholder);

  // Filled in when the GLB resolves.
  let skinnedMesh = null;
  let boneMap = null;
  const _rest = { Hips_y: 0 };                       // cache Hips base Y
  // Distance from the lowest foot BONE to the lowest visible mesh
  // vertex (sole/toe geometry) at rest pose. The foot bone is
  // authored inside the shoe, ~8cm above the sole. Without this
  // offset, view3d.js's auto-plant snapped the ANKLE JOINT to ground
  // level, which put the visible sole BELOW the ground on every
  // map. Computed once after the GLB loads (see _computeSoleOffset
  // in the .then() below) and read every frame by getLowestFootY.
  let _soleBoneOffset = 0;

  // AnimationMixer for the GLB's shipped walk clip — played as the
  // BASE locomotion layer, weighted by movement speed. Procedural
  // crouch / aim / slap / punch deltas are applied AFTER the mixer
  // updates (last-write-wins), so idle → walk → sprint reads as an
  // authored gait with combat states as additive corrections.
  let mixer = null;
  let walkAction = null;

  // ── Current weapon (drives arm-hold poses + weapon mesh) ────
  // We track the STRING id (pistol/ak47/rifle/pimpslap/…) plus the
  // resolved CATEGORY (fist/pistol/rifle/shotgun_carry/etc) so the
  // animation branch knows which arm pose to blend to.
  let curWeapon = 'fist';
  let curCat = 'fist';
  let gunMesh = null;

  function setWeapon(id) {
    if (id === curWeapon) return;
    curWeapon = id;
    curCat = catOf(id);
    // Swap the weapon mesh attached to the RightHand bone.
    if (gunMesh) {
      gunMount.remove(gunMesh);
      gunMesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      gunMesh = null;
    }
    try {
      gunMesh = gunProp(id);
      if (gunMesh) {
        gunMount.add(gunMesh);
        _applyWeaponOffsetToGunMesh();
      }
    } catch { /* leave gunMount empty */ }
  }

  // ── Weapon Lab live offset ────────────────────────────────────
  // The gunMesh is authored with its own barrel-forward orientation.
  // Weapon Lab lets an admin dial in an ADDITIONAL rotation/position/
  // scale on top of that so the weapon sits correctly in the hand.
  // Grip is treated as a "shift the mesh so the grip point lands at
  // the hand attach point" — mesh.position = -grip.
  function _applyWeaponOffsetToGunMesh() {
    if (!gunMesh) return;
    const off = getWeaponOffset(curWeapon);
    // Grip translates the mesh so its authored grip point ends up at
    // gunMount origin (the hand attach). Positive grip.x = move the
    // grip point to the right → we subtract to bring it back to origin.
    gunMesh.position.set(-off.grip[0], -off.grip[1], -off.grip[2]);
    gunMesh.rotation.set(off.rotation[0], off.rotation[1], off.rotation[2]);
    gunMesh.scale.set(off.scale[0], off.scale[1], off.scale[2]);
  }

  // Live re-apply when the admin publishes / edits weapon offsets.
  const _onWeaponOffsetChanged = (e) => {
    // Rebuild if the change touched THIS weapon or the whole set.
    const wid = e && e.detail ? e.detail.weaponId : null;
    if (!wid || wid === curWeapon) _applyWeaponOffsetToGunMesh();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('sr:weapon-offset-changed', _onWeaponOffsetChanged);
  }

  // Local closure state (mirrors characterModel3d.js style).
  // Armature-convention compensation, resolved on GLB load.
  // See the .then() below for the derivation from RightHand.worldScale.
  //   • Meshy warrior (bones in 100× space, armature scale 0.01) → 1.0
  //   • Auto-rigged natural 1× skeleton                          → 0.01
  // Multiplied into every bone-LOCAL position delta (hipsY) so world
  // motion feels identical regardless of armature convention.
  let _deltaScale = 1;
  // Sign multiplier for the leg-forward rotation. +1 means positive
  // rotation around the UpLeg's local X sweeps the knee TOWARD the
  // character's face (forward); -1 means the opposite.
  //
  // The shipped Meshy warrior was authored with a NEGATIVE-forward
  // convention (its comment says: "NEGATIVE lUpX rotates the knee
  // toward the face"). Auto-rigged characters built via
  // buildHumanoidSkeleton have naïve identity-rotation bones, which
  // are POSITIVE-forward — so on the auto-rig the walk cycle looked
  // reversed (a moonwalk / goofy leg swing). We detect the actual
  // convention at rig-attach time by dry-running a rotation and
  // comparing the child knee's world position drift to the group's
  // forward vector, then multiply every leg-forward rotation by
  // this sign so `animate()` stays convention-agnostic.
  let _legForwardSign = -1;   // Meshy default; overridden after attach
  // Similarly for hip Z axis (Trendelenburg / gangster hip roll).
  // Same reasoning — the auto-rig may want opposite Z sign for the
  // sideways sway to read correctly.
  let _hipRollSign = 1;

  // ── Animation state context (iter157 refactor) ──────────────────
  // Every closure variable that `animate()` writes-back frame-to-frame
  // lives here so the big state machine can be extracted into its own
  // module (`characterMeshyAnim.js`). Read-only inputs (`skinnedMesh`,
  // `boneMap`, `mixer`, `walkAction`, `curWeapon`, `curCat`,
  // `_deltaScale`, `_legForwardSign`) are synced onto this object at
  // the top of each `animate()` call — they're written elsewhere in
  // this factory (`setWeapon`, the async `.then()` block).
  const _animState = {
    group,
    gunMount,
    _rest,
    skinnedMesh: null,
    boneMap: null,
    mixer: null,
    walkAction: null,
    curWeapon: 'fist',
    curCat: 'fist',
    _deltaScale: 1,
    _legForwardSign: -1,
    // Write-back closure state — persists across frames, only
    // mutated by stepCharacterAnim(). Zero-initialised the same as
    // the previous `let ...` declarations.
    ragdollMode: false,
    _runFactor: 0,
    _idleT: 0,
    _kickT: 0, _kickPrev: false, _kickVar: 0,
    _punchT: 0, _punchPrev: false, _punchVar: 0,
    _jumpT: 0, _jumpPrev: false,
    _walkPhase: 0,
    _idleBreakT: 4 + Math.random() * 4,   // first cocky break in 4-8s
    _idleBreakActive: 0,                  // 0..1 during a break
  };

  _loadTemplate().then(({ scene, walkClip }) => {
    // Clone via SkeletonUtils.clone so each character owns its own
    // skeleton (a plain THREE.Object3D.clone would share bones and
    // stomp animation state between actors).
    const cloneRoot = skeletonClone(scene);
    let cloneSkinned = null;
    cloneRoot.traverse((o) => {
      if (o.isSkinnedMesh && !cloneSkinned) cloneSkinned = o;
    });
    if (!cloneSkinned) return;

    // Rebuild the clone's boneMap — SkeletonUtils.clone preserves
    // bone names but returns fresh Object3D instances. Cache each
    // bone's REST rotation as a quaternion (so animation offsets
    // apply ON TOP of the base pose the Meshy artist authored via
    // proper local-frame quaternion multiplication instead of
    // Euler summation, which mangles the axis frame).
    const cloneBoneMap = {};
    for (const b of cloneSkinned.skeleton.bones) {
      cloneBoneMap[b.name] = b;
      b.userData._restQ = b.quaternion.clone();
      b.userData._delta = { x: 0, y: 0, z: 0 };
    }

    // Attach the entire clone hierarchy (scene root with bones + mesh)
    // to our group. Position/scale come from the GLB unchanged — the
    // Meshy mesh is authored 1:1 world units.
    //
    // FACING FIX: The Meshy character's "nose" (headfront bone) is at
    // +Z in bone-local space, but Three.js's default forward is −Z
    // (the direction the default PerspectiveCamera looks toward).
    // We rotate the mesh 180° around Y so the character faces the
    // same direction the engine's `yaw` treats as "forward" — running
    // WASD-forward now runs the correct direction relative to the
    // camera behind the player.
    cloneRoot.rotation.y = Math.PI;
    group.add(cloneRoot);
    // Remove the placeholder capsule.
    group.remove(placeholder);
    placeholder.geometry.dispose();

    // ── Detect armature convention (Meshy 0.01× vs auto-rig 1×) ──
    // Downstream animation deltas (Hips crouch, gun-mount scale, foot
    // slide dampers) were authored against the Meshy warrior which
    // uses a 0.01× armature with bones in "100× space". Auto-rigged
    // characters ship at natural 1× scale. Rather than duplicating
    // hundreds of lines of animation code with per-convention values,
    // we detect the RightHand bone's WORLD scale once and derive a
    // single compensation factor that neutralises the difference:
    //   • Meshy (world scale ≈ 0.01) → animScale = 0.01, gunScale = 100
    //   • Auto-rig (world scale ≈ 1)  → animScale = 1,    gunScale = 1
    // `animScale` is later multiplied into every LOCAL bone delta.
    let animScale = 1;
    let gunScale = 1;
    if (cloneSkinned.skeleton && cloneSkinned.skeleton.bones.length) {
      const handBone = cloneSkinned.skeleton.bones.find(b => b.name === 'RightHand')
        || cloneSkinned.skeleton.bones.find(b => /hand/i.test(b.name))
        || cloneSkinned.skeleton.bones[0];
      handBone.updateWorldMatrix(true, false);
      const ws = new THREE.Vector3();
      handBone.getWorldScale(ws);
      // Bone-space unit → world-space unit. Meshy hand ≈ 0.01, auto-rig ≈ 1.
      animScale = ws.x > 1e-6 ? ws.x : 1;
      gunScale  = animScale > 1e-6 ? 1 / animScale : 1;
      // _deltaScale multiplies every bone-LOCAL position delta so the
      // resulting WORLD motion matches the Meshy authored feel
      // regardless of armature scale. Uses 0.01 (Meshy world scale)
      // as the reference denominator — animScale of 0.01 gives
      // _deltaScale=1 (no change), animScale of 1 gives 0.01 (100×
      // smaller local delta, same world result). Stored in the outer
      // closure `let _deltaScale` so animate() can read it.
      _deltaScale = 0.01 / animScale;
    }
    // ── Detect the leg-forward rotation sign for this rig ─────
    // See the closure declaration of `_legForwardSign` above for the
    // full explanation. Dry-run: rotate RightUpLeg by +δ around its
    // local X, measure how far the RightLeg (knee) moved in the
    // character's FORWARD direction (world -Z since cloneRoot.rotation.y=π).
    // If the knee moved forward, the convention is POSITIVE = forward
    // and we set `_legForwardSign = +1` (the walk cycle's built-in
    // negation gets flipped). If the knee moved backward, keep the
    // Meshy default of -1.
    if (cloneSkinned.skeleton) {
      const upR = cloneSkinned.skeleton.bones.find(b => b.name === 'RightUpLeg');
      const kneeR = cloneSkinned.skeleton.bones.find(b => b.name === 'RightLeg');
      if (upR && kneeR) {
        const _origQ = upR.quaternion.clone();
        const _restKnee = new THREE.Vector3();
        kneeR.getWorldPosition(_restKnee);
        // +0.5 rad around local X — pure test rotation, restored below.
        upR.rotateX(0.5);
        upR.updateMatrixWorld(true);
        kneeR.parent.updateMatrixWorld(true);
        const _rotKnee = new THREE.Vector3();
        kneeR.getWorldPosition(_rotKnee);
        // Character's forward direction in world: cloneRoot.rotation.y=π
        // means face points world -Z regardless of rig convention.
        const forwardZ = -1;   // world -Z
        const kneeDeltaZ = _rotKnee.z - _restKnee.z;
        // Alignment > 0 → +δ rotation moved the knee TOWARD forward.
        // Alignment < 0 → +δ rotation moved it BACKWARD (Meshy legacy).
        const alignment = kneeDeltaZ * forwardZ;
        _legForwardSign = alignment > 0 ? +1 : -1;
        // Restore rest rotation.
        upR.quaternion.copy(_origQ);
        upR.updateMatrixWorld(true);
      }
    }
    placeholder.material.dispose();

    skinnedMesh = cloneSkinned;
    boneMap = cloneBoneMap;

    // ── AnimationMixer — plays the GLB's shipped walking clip on
    // its own track. `walkAction.weight` is driven by `moving` each
    // frame in animate(), so an idle character gets 0 mixer contribution
    // (procedural idle stance shows through) and a running character
    // gets the full-authored gait.
    //
    // ARM-MASK: the shipped walk clip animates every bone (72 channels
    // = 24 bones × translation/rotation/scale). We STRIP the arm/shoulder
    // /hand tracks so the mixer only drives legs, hips, spine, neck,
    // head — leaving the arms 100% procedural. This lets the aiming /
    // kung-fu / eating poses show through cleanly even while the legs
    // are cycling through the authored walk. Without this, the walking
    // clip yanks the arms into a full-swing gait every step, fighting
    // whatever combat pose we're trying to hold.
    if (walkClip) {
      const armPattern = /(Arm|Hand|Shoulder|ForeArm)/i;
      const filteredTracks = walkClip.tracks.filter(tr => !armPattern.test(tr.name));
      const legClip = new THREE.AnimationClip('walk_legs_only', walkClip.duration, filteredTracks);
      mixer = new THREE.AnimationMixer(cloneSkinned);
      walkAction = mixer.clipAction(legClip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.setEffectiveWeight(0);              // starts fully off
      walkAction.enabled = true;
      walkAction.play();
    }

    // Cache the Hips rest-Y so crouch/jump additive Y offsets don't
    // permanently drift the character underground.
    if (boneMap.Hips) _rest.Hips_y = boneMap.Hips.position.y;

    // Measure the delta between the lowest foot BONE and the lowest
    // visible mesh vertex at rest pose — the "ankle-to-sole" offset.
    // Called AFTER the skeleton is attached so bone world positions
    // reflect the actual rig hierarchy, and matrices are up to date.
    group.updateMatrixWorld(true);
    cloneSkinned.geometry.computeBoundingBox();
    // Box3.setFromObject on a SkinnedMesh honors bone skinning in
    // world space, so the returned bbox reflects the ACTUAL visible
    // silhouette (soles included), not the pre-skinned rest geometry.
    const _meshBBox = new THREE.Box3().setFromObject(cloneSkinned);
    const _tmp = new THREE.Vector3();
    let lowFootBone = Infinity;
    const _br = boneMap.RightFoot || boneMap.RightToeBase || boneMap.RightLeg;
    const _bl = boneMap.LeftFoot  || boneMap.LeftToeBase  || boneMap.LeftLeg;
    if (_br) { _br.getWorldPosition(_tmp); if (_tmp.y < lowFootBone) lowFootBone = _tmp.y; }
    if (_bl) { _bl.getWorldPosition(_tmp); if (_tmp.y < lowFootBone) lowFootBone = _tmp.y; }
    _soleBoneOffset = Number.isFinite(lowFootBone) && Number.isFinite(_meshBBox.min.y)
      ? Math.max(0, lowFootBone - _meshBBox.min.y)
      : 0;

    // Re-parent the weapon mount to the RightHand bone so weapons
    // stick to the palm through every animation. The Meshy Armature
    // is authored at 0.01 world scale, so a child mesh under RightHand
    // would render at 1% size — we compensate with a 100× scale on
    // the gunMount so weapons appear at their proper size. Rotation
    // orients the barrel FORWARD relative to the palm's local axes.
    if (boneMap.RightHand) {
      // Parent the gunMount to the RightHand bone AND scale it up
      // 100× (Meshy armature is authored at 0.01 world scale).
      // Rotation is intentionally identity — we override the gun's
      // orientation every frame in animate() so the barrel always
      // points along the character's aim direction, independent of
      // the hand bone's weirdly-oriented rest frame.
      group.remove(gunMount);
      boneMap.RightHand.add(gunMount);
      gunMount.position.set(0, 0, 0);
      gunMount.rotation.set(0, 0, 0);
      // Compensate for the parent bone's world scale. Meshy warrior:
      // RightHand world-scale ≈ 0.01 → gunScale ≈ 100 → weapon renders
      // at world size 1. Auto-rigged characters: parent world-scale
      // ≈ 1 → gunScale ≈ 1 → same 1× world size.
      gunMount.scale.setScalar(gunScale);
    }

    // ── Apply base body colour (skin / body texture tint) ─────────
    // Clone the material so this character's tint doesn't stomp
    // other instances that share the same base template. The custom
    // body ships as a single un-textured mesh, so tinting the base
    // colour paints the whole silhouette in the player's skin tone.
    // For textured meshes the tint acts as a multiplier over the map.
    if (cloneSkinned.material && palette && palette.skin) {
      const cloned = Array.isArray(cloneSkinned.material)
        ? cloneSkinned.material.map(m => m.clone())
        : cloneSkinned.material.clone();
      const skinCol = palette.skin.isColor ? palette.skin : new THREE.Color(palette.skin);
      if (Array.isArray(cloned)) {
        cloned.forEach((m) => { if (m && m.color) m.color.copy(skinCol); });
      } else if (cloned.color) {
        cloned.color.copy(skinCol);
      }
      cloneSkinned.material = cloned;
    }

    // ── Attach SR clothing / hair / facial-hair / hat / glasses ──
    // SR OBJs were authored in absolute-world coordinates around the
    // legacy `man.obj` body: head at world Y ≈ 1.81, torso pivot at
    // ~1.07, feet at 0. Our auto-rigged custom body normalises to
    // ~1.7 m tall with feet on Y=0 — a natural fit once we scale the
    // cosmetics uniformly by (currentMeshHeight / SR_AUTHORED_HEIGHT).
    // cloneRoot is already rotated 180° around Y so children face
    // the character's forward (−Z) automatically — no vertex flip
    // needed here (unlike the legacy `rotateAndAttach` on the
    // un-rotated body root).
    attachCosmetics(cloneRoot, cloneSkinned, boneMap, palette);
  }).catch(() => { /* leave placeholder in place */ });

  // ── animate(t, f) ────────────────────────────────────────────
  // Thin wrapper around the extracted state-machine in
  // characterMeshyAnim.js (iter157 Phase-2 refactor). Every closure
  // variable animate() writes-back lives on `_animState`; read-only
  // inputs assigned elsewhere (setWeapon / .then rig-attach) are
  // synced here each frame so stepCharacterAnim sees fresh values.
  //
  // Same flag object shape as characterModel3d.animate:
  //   moving, firing, crouch, deadT, pitch, sprint, jump, kick,
  //   punchL, hasPimpSlap, slapSpinT, slapSpinDir, reloadT, taunt
  function animate(t, f) {
    if (!skinnedMesh || !boneMap) return;
    _animState.skinnedMesh = skinnedMesh;
    _animState.boneMap = boneMap;
    _animState.mixer = mixer;
    _animState.walkAction = walkAction;
    _animState.curWeapon = curWeapon;
    _animState.curCat = curCat;
    _animState._deltaScale = _deltaScale;
    _animState._legForwardSign = _legForwardSign;
    stepCharacterAnim(_animState, t, f);
  }

  function setTagVisible(v) { tag.visible = v; }
  function setHpBar(v, frac) {
    barBg.visible = v;
    barFill.visible = v && frac > 0.01;
    if (v) barFill.scale.x = 1.28 * Math.max(0.02, Math.min(1, frac || 0));
  }
  function dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('sr:weapon-offset-changed', _onWeaponOffsetChanged);
    }
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }

  // Expose the underlying bone rig to dev tools (PoseLab overlay).
  // Shape matches the OBJ character's getRig() so applyTuneToRig()
  // works against BOTH characters unchanged. Meshy has NO dedicated
  // finger bones — we map `fingerR/L` to the Hand bones so a curl
  // knob at least rotates the whole hand toward the wrist as a
  // primitive fist approximation.
  //
  // `gun` returns the weapon mesh inside gunMount so the Pose Lab's
  // gunPX / gunPY / gunPZ / gunRX / gunRY / gunRZ knobs can nudge the
  // weapon's offset relative to the hand. This is on TOP of the
  // dynamic gunMount lookAt orientation applied each frame — the
  // overlay adds a small local delta before rendering.
  function getRig() {
    if (!boneMap) return null;
    // Auto-rigged characters use a completely different bone-local
    // orientation convention than the OLD `meshy_warrior.glb`. Every
    // saved pose override in the backend was authored against the
    // old warrior — e.g. `hipPitchL: 2.7` was a legitimate 155°
    // compensation on the old rig's LeftUpLeg-local frame, but on
    // the new clean Mixamo-style skeleton it rotates the leg
    // horizontally into the air (the "flip floppity leg on the
    // ground" glitch the user reported). Same story for `gun*`
    // knobs: `gunRX: 2.6` was a barrel-alignment offset on the old
    // hand bone, but the new rig's gunMount is already correctly
    // oriented every frame via _gunTargetWorldQ. Skip both by
    // returning null legR/legL/footR/footL + omitting gun accessors
    // — `applyTuneToRig`'s `if (rig.legR?.hip)` / `if (gun)` guards
    // silently no-op on missing entries.
    // Formerly-gated by `isAutoRig` — that gating silently killed every
    // PoseLab leg/foot/gun knob on auto-rigged custom characters
    // (iter156 root cause). Removed the flag entirely; all bones are
    // exposed for both shipped Meshy and auto-rig, and the animate()
    // walk-cycle uses `_legForwardSign` (detected at rig-attach time)
    // to handle the different sign convention between the two rigs.
    // Look up an individual finger's base-knuckle bone. Mixamo /
    // Meshy warriors expose 3 joints per finger (Thumb1/2/3, etc.);
    // we grab the "1" joint so a single rotation cascades cleanly
    // to the whole digit. Falls back to the "1" if plain-named,
    // and finally to null so PoseLab's tune knobs silently no-op
    // on meshes without finger bones.
    const finger = (side, name) =>
      boneMap[`${side}Hand${name}1`] || boneMap[`${side}Hand${name}`] || null;
    return {
      body: group,
      torsoG: boneMap.Spine02 || boneMap.Spine01 || boneMap.Spine,
      headG:  boneMap.Head,
      armR: { sh: boneMap.RightArm, el: boneMap.RightForeArm },
      armL: { sh: boneMap.LeftArm,  el: boneMap.LeftForeArm  },
      // Leg / foot bones are exposed for BOTH shipped Meshy and
      // auto-rigged custom characters. The old `isAutoRig ? null`
      // gate was added to hide the auto-rig's "different local axes"
      // but it silently disabled every PoseLab leg + ankle knob for
      // custom characters (iter156 repro: "I can't move the legs").
      // Both rigs use standard Mixamo bone names via humanoidSkeleton.js
      // so a direct reference is safe; the signs are handled by the
      // per-rig sign detection in animate(), not by null-gating.
      legR: { hip: boneMap.RightUpLeg, knee: boneMap.RightLeg },
      legL: { hip: boneMap.LeftUpLeg,  knee: boneMap.LeftLeg  },
      // Foot / ankle bones. `foot` IS the ankle joint in Mixamo
      // naming — rotating it pitches the sole up/down. May be
      // `undefined` on meshes without them; PoseLab's ankle knobs
      // no-op in that case.
      footR: boneMap.RightFoot || boneMap.RightToeBase || null,
      footL: boneMap.LeftFoot  || boneMap.LeftToeBase  || null,
      // Individual finger base-knuckle bones (5 per hand × 2 sides).
      // PoseLab uses these to author per-finger curl on top of the
      // legacy hand-as-a-whole `fingerR/L` control below. On meshes
      // without split finger bones every entry is `null` and the
      // per-finger tune knobs collapse to no-ops.
      fingersR: {
        thumb:  finger('Right', 'Thumb'),
        index:  finger('Right', 'Index'),
        middle: finger('Right', 'Middle'),
        ring:   finger('Right', 'Ring'),
        pinky:  finger('Right', 'Pinky'),
      },
      fingersL: {
        thumb:  finger('Left', 'Thumb'),
        index:  finger('Left', 'Index'),
        middle: finger('Left', 'Middle'),
        ring:   finger('Left', 'Ring'),
        pinky:  finger('Left', 'Pinky'),
      },
      // Reads the ACTUAL lowest world-Y of the skinned mesh AS
      // CURRENTLY POSED — captures the visible foot / heel / toe
      // vertex regardless of how the leg is folded. Superior to the
      // earlier "bone Y − rest offset" approach because that assumed
      // the sole was always directly below the ankle bone in world Y.
      // In DEEP SQUAT / SEIZA / KNEEL, the foot rotates 60-90° so the
      // sole is no longer "below" the ankle — it's to the side, and
      // the rest-time offset over-compensates by ~0.1 m (iter156
      // repro: SNAP planted the character 0.1 m BELOW the ground).
      //
      // Computes a fresh bbox over the currently-posed mesh so the
      // returned Y is exactly the world Y of the lowest visible
      // vertex. One frame's worth of overhead per click of SNAP; not
      // called every frame, so the extra cost is negligible.
      getLowestFootY: () => {
        if (!skinnedMesh) return 0;
        // Force skinning matrices up to date so bbox reflects the
        // pose visible on screen (Three.js batches these normally).
        skinnedMesh.updateMatrixWorld(true);
        skinnedMesh.skeleton?.update();
        const bbox = new THREE.Box3().setFromObject(skinnedMesh);
        return Number.isFinite(bbox.min.y) ? bbox.min.y : 0;
      },
      gunMount,
      // Legacy whole-hand rotator — kept for backwards-compat with
      // saved poses that used the single `fingerCurl` knob. New
      // per-finger knobs live in `fingersR/L` above.
      fingerR: boneMap.RightHand,
      fingerL: boneMap.LeftHand,
      // Weapon transform overrides — expose the gun mesh for
      // BOTH shipped Meshy and auto-rigged characters. Previous
      // gating (isAutoRig ? null) silently killed every PoseLab
      // weapon knob (gunPX/PY/PZ/RX/RY/RZ) on custom characters.
      // The stored offsets are additive on top of the per-frame
      // world-quaternion the gun mount receives from aiming code —
      // so applying them is safe and PoseLab authors can dial
      // grip/tilt on any rig.
      get gun() {
        return gunMount.children[gunMount.children.length - 1] || null;
      },
    };
  }

  return {
    group,
    animate,
    setWeapon,
    setTagVisible,
    setHpBar,
    dispose,
    getRig,
    // Extras for compatibility with the OBJ character API — some
    // callers reach into .body / .gunMount / .headG for direct
    // transforms. Provide safe fallbacks.
    body: group,
    gunMount,
    torsoG: group,
    headG: group,
    armR: { sh: { rotation: { x: 0, y: 0, z: 0 } }, el: { rotation: { x: 0 } } },
    armL: { sh: { rotation: { x: 0, y: 0, z: 0 } }, el: { rotation: { x: 0 } } },
    legR: { hip: { rotation: { x: 0, y: 0, z: 0 } }, knee: { rotation: { x: 0 } } },
    legL: { hip: { rotation: { x: 0, y: 0, z: 0 } }, knee: { rotation: { x: 0 } } },
  };
}

// Ensure the template pre-loads at module import so the first
// character spawned already has the mesh ready.
_loadTemplate().catch(() => {});
