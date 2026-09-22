// Map → .glb exporter for Blender round-trip.
//
// Snapshots the live three.js scene as a downloadable binary .glb.
// Hard-won rules (each learned from a failure mode that produced an
// invalid .glb, an infinite hang, or Blender refusing to import):
//
//   • DO NOT clone the scene. SkinnedMesh.clone() shares skeleton
//     refs — cloned rigs point at bones we then detach and the
//     exporter produces dangling joint pointers → invalid .glb.
//     Hide-and-restore instead.
//
//   • Skip meshes using ShaderMaterial (sky dome). glTF has no
//     equivalent concept and the exporter emits an incomplete
//     material.
//
//   • Skip meshes with non-finite vertex positions. glTF accessor
//     min/max validation rejects NaN.
//
//   • DO NOT let the exporter see most real materials, and keep
//     embedImages scoped to only what actually needs it. This scene
//     has ~60 meshes, ~1.2M verts, and several materials with
//     procedural CANVAS textures. Embedding those calls
//     canvas.toDataURL/toBlob per texture, which stalls on the
//     WebGL2 command queue while the game keeps rendering, then
//     serializes them as huge base64 blobs. Result: 45+s hang. We
//     swap every material for a plain, textureless MeshBasicMaterial
//     of a matching color for the duration of the export and restore
//     afterward. Blender viewport still shows distinguishable
//     colored objects; textures are re-linked manually if the user
//     wants them.
//
//     EXCEPTION: the garage model (marked via
//     userData.__garageModel — see mapGarage3d.js) keeps its real
//     material and textures. It's a loaded .glb with ordinary,
//     already-decoded image textures, not procedural canvas ones —
//     embedding a handful of those is fast. embedImages is now on
//     globally, but since every other mesh has been stripped to a
//     textureless placeholder by the time export runs, there's
//     nothing else for it to embed — the garage's textures are the
//     only ones that actually go through that path.
//
//   • Skip storm-cloud instances (12 copies, ~950k verts, majority
//     of scene geometry). Procedurally-lit sky filler with no
//     authoring value in Blender.
//
//   • Cap the export with a timeout so a stuck run surfaces as a
//     UI error instead of a permanently spinning button.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

function isLiveObject(obj) {
  const n = (obj.name || '').toLowerCase();
  if (n.includes('player') || n.includes('character') || n.includes('saint')) return true;
  if (n.includes('tag') || n.includes('hpbar') || n.includes('hp_bar') || n.includes('nametag')) return true;
  if (n.includes('tracer') || n.includes('bullet') || n.includes('muzzle') || n.includes('projectile')) return true;
  if (n.includes('pickup') || n.includes('weapon_') || n.includes('ammo')) return true;
  if (obj.isSprite) return true;
  if (obj.isSkinnedMesh) return true;
  if (obj.type === 'Bone') return true;
  return false;
}

// Climb parent chain looking for the cloud-holder marker
// (userData.baseX + high Y — see mapGarage3d.spawnClouds).
function isCloudInstance(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData && cur.userData.baseX != null && cur.position.y > 30) return true;
    cur = cur.parent;
  }
  return false;
}

// Climb parent chain looking for the garage marker (userData.
// __garageModel — see mapGarage3d.buildGarageMap). An explicit
// marker rather than a name/position heuristic like isCloudInstance
// — more robust, and it's cheap to add at the source since we
// control that file too.
function isGarageInstance(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData && cur.userData.__garageModel) return true;
    cur = cur.parent;
  }
  return false;
}

function usesShaderMaterial(mesh) {
  if (!mesh.isMesh || !mesh.material) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) if (m && (m.isShaderMaterial || m.isRawShaderMaterial)) return true;
  return false;
}

function hasBadGeometry(mesh) {
  if (!mesh.isMesh || !mesh.geometry) return false;
  const pos = mesh.geometry.attributes?.position;
  if (!pos || !pos.array) return true;
  const arr = pos.array;
  const step = arr.length > 500000 ? 1000 : 1;
  for (let i = 0; i < arr.length; i += step) {
    if (!Number.isFinite(arr[i])) return true;
  }
  return false;
}

function hideNonExportables(scene) {
  const changed = [];
  scene.traverse((obj) => {
    if (obj === scene) return;
    if (isLiveObject(obj) || usesShaderMaterial(obj) || isCloudInstance(obj) || hasBadGeometry(obj)) {
      changed.push({ obj, prev: obj.visible });
      obj.visible = false;
    }
  });
  return () => { for (const { obj, prev } of changed) obj.visible = prev; };
}

// Swap every mesh's material for a plain colored MeshBasicMaterial.
// Restore on cleanup. This is the single biggest speedup — with
// original materials + textures the exporter takes 45s+ and hangs
// on canvas textures. With placeholders it completes in <2s.
//
// SKIP collision-marker meshes (name starts with COL_) — their
// bright red translucent material is intentional so the user can
// see them in Blender, and we don't want it swapped for an opaque
// placeholder that would hide the geometry underneath.
//
// SKIP the garage model too — see isGarageInstance and the file-
// header comment. It keeps its real material/textures.
function stripMaterials(scene) {
  const swaps = [];
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material || !obj.visible) return;
    if (obj.name && obj.name.startsWith('COL_')) return;
    if (isGarageInstance(obj)) return;
    const orig = obj.material;
    const mats = Array.isArray(orig) ? orig : [orig];
    const makePlaceholder = (m) => {
      let color = 0x808080;
      if (m?.color?.isColor) color = m.color.getHex();
      else if (m?.uniforms?.uColor?.value?.isColor) color = m.uniforms.uColor.value.getHex();
      const p = new THREE.MeshBasicMaterial({ color });
      p.name = m?.name || m?.type || 'material';
      return p;
    };
    swaps.push({ mesh: obj, orig });
    obj.material = Array.isArray(orig) ? mats.map(makePlaceholder) : makePlaceholder(orig);
  });
  return () => {
    for (const { mesh, orig } of swaps) {
      const cur = mesh.material;
      if (Array.isArray(cur)) for (const c of cur) c?.dispose?.();
      else cur?.dispose?.();
      mesh.material = orig;
    }
  };
}

// Add one BoxGeometry mesh per collider to the scene as a
// COL_<index> marker so the exported GLB carries the current
// Categorize a collider so its Blender name reads meaningfully in
// the outliner. The name pattern is `COL_<kind>_<idx>` — the
// COL_ prefix is what sceneImport.extractColliderMarkers recognizes
// on re-import (regardless of the <kind> tag), so users can rename
// freely as long as they preserve the prefix.
//
// Heuristics (matches the metadata each map builder attaches):
//   • c.barrier === true                       → 'barrier'
//     (jersey barriers from jerseyBarrier.js — cover metadata)
//   • c.climbable === true                     → 'crate'
//     (small stackable that the player can top-mount)
//   • c.yBase > 0                              → 'platform'
//     (upper-floor slab / overhang — only collides when player
//     climbs to its level)
//   • c.h != null && c.h <= 2.2                → 'fence'
//     (perimeter fence around garage / arenas)
//   • width and depth both < 1.2 m             → 'pillar'
//     (small posts, sign pylons, single-column props)
//   • otherwise                                → 'wall'
//     (garage exterior, arena buildings, generic walls)
function categorizeCollider(c) {
  if (c.barrier) return 'barrier';
  if (c.climbable) return 'crate';
  if (c.yBase != null && c.yBase > 0.1) return 'platform';
  if (c.h != null && c.h <= 2.2) return 'fence';
  const w = c.x1 - c.x0;
  const d = c.z1 - c.z0;
  if (w < 1.2 && d < 1.2) return 'pillar';
  return 'wall';
}

// Add one BoxGeometry mesh per collider to the scene as a
// COL_<kind>_<index> marker so the exported GLB carries the current
// collision layout. Blender users can delete / duplicate / resize
// these translucent boxes to author their own colliders — on
// re-import, if any COL_* meshes are present we use them verbatim
// as colliders (see sceneImport.extractColliderMarkers) instead of
// running the voxel auto-derive.
//
// Marker material intentionally uses translucent color so the user
// can see the wall geometry through them; stripMaterials() above
// keeps this material intact through the export. Color varies by
// collider kind so wall/barrier/fence/etc. are distinguishable at
// a glance in Blender's viewport:
//   wall     — red        (structural)
//   barrier  — orange     (cover)
//   fence    — yellow     (perimeter)
//   platform — cyan       (floating slab / overhang)
//   crate    — green      (climbable)
//   pillar   — magenta    (thin post)
//
// userData carries the collider's extra properties (climbable,
// yBase, barrier flag, yaw) so a perfect round-trip preserves
// jersey-barrier cover metadata even without user intervention.
const MARKER_COLORS = {
  wall:     0xff2244,
  barrier:  0xff8a1a,
  fence:    0xffd21a,
  platform: 0x22d0ff,
  crate:    0x44dd66,
  pillar:   0xff44dd,
};

function spawnColliderMarkers(scene, colliders) {
  // Parent all markers under a single Empty named `COLLISION` so
  // Blender's outliner shows them as one collapsible group. Users
  // click the eye icon next to `COLLISION` to hide every marker at
  // once, or press `H` while it's selected. Because it's the direct
  // parent (not just a name coincidence), toggling visibility on
  // the Empty cascades to every child mesh — no multi-select
  // required.
  const group = new THREE.Group();
  group.name = 'COLLISION';
  group.userData.__collisionCollection = true;
  scene.add(group);
  const created = [];
  // Per-kind counter so names are stable and unique
  // (`COL_wall_0`, `COL_wall_1`, `COL_barrier_0`, …).
  const kindCounts = {};
  colliders.forEach((c) => {
    if (!c || c.x0 == null || c.x1 == null) return;
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    if (w <= 0 || d <= 0) return;
    const rawH = c.h != null && Number.isFinite(c.h) ? c.h : 3.0;
    // Cap visible marker height to 6m so 10m building colliders
    // don't look like skyscrapers in Blender's outliner.
    const visH = Math.min(rawH, 6);
    const kind = categorizeCollider(c);
    const idx = kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    const color = MARKER_COLORS[kind] || 0xff2244;
    const geo = new THREE.BoxGeometry(w, visH, d);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    const yBase = c.yBase != null ? c.yBase : 0;
    m.position.set((c.x0 + c.x1) / 2, yBase + visH / 2, (c.z0 + c.z1) / 2);
    m.name = `COL_${kind}_${idx - 1}`;
    m.userData.__collision = true;
    m.userData.kind = kind;
    if (c.h != null) m.userData.h = c.h;
    if (c.yBase != null) m.userData.yBase = c.yBase;
    if (c.climbable) m.userData.climbable = true;
    if (c.barrier) m.userData.barrier = true;
    if (c.step) m.userData.step = true;
    if (c.yaw != null) m.userData.yaw = c.yaw;
    group.add(m);
    created.push(m);
  });
  return () => {
    scene.remove(group);
    for (const m of created) {
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) for (const x of mat) x?.dispose?.();
      else mat?.dispose?.();
    }
  };
}

function downloadBlob(buffer, filename) {
  const blob = new Blob(
    [buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer)],
    { type: 'model/gltf-binary' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const EXPORT_TIMEOUT_MS = 60000;

export function exportMapToGLB(filename = 'map_snapshot.glb', options = {}) {
  const { includeColliders = true } = options;
  return new Promise((resolve, reject) => {
    const scene = typeof window !== 'undefined' ? window.__brawl3dScene : null;
    const engine = typeof window !== 'undefined' ? window.__brawl3dEngine : null;
    if (!scene) {
      reject(new Error('Scene not ready yet — enter a lobby first.'));
      return;
    }
    // Order matters: hide first (so we don't waste time stripping
    // materials on meshes we're about to skip anyway), THEN inject
    // collision markers (they need to survive stripMaterials — see
    // that fn's COL_* skip guard), THEN strip materials on the rest.
    const restoreVis = hideNonExportables(scene);
    const colliders = engine?.colliders || [];
    // Marker injection is opt-in via the TOOLS-tab checkbox. When
    // disabled, the exported GLB contains pure map geometry — on
    // re-import the game will always run the voxel auto-derive
    // (there are no COL_* boxes to override it with).
    const restoreMarkers = includeColliders
      ? spawnColliderMarkers(scene, colliders)
      : () => {};
    const restoreMats = stripMaterials(scene);
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      restoreMats();
      restoreMarkers();
      restoreVis();
      fn(arg);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`Export timed out after ${EXPORT_TIMEOUT_MS / 1000}s — scene may be too large`));
    }, EXPORT_TIMEOUT_MS);

    let exporter;
    try {
      exporter = new GLTFExporter();
    } catch (e) {
      clearTimeout(timer);
      finish(reject, new Error('Exporter init failed: ' + (e?.message || e)));
      return;
    }
    exporter.parse(
      scene,
      (result) => {
        clearTimeout(timer);
        try {
          if (!(result instanceof ArrayBuffer)) {
            finish(reject, new Error('Exporter returned non-binary'));
            return;
          }
          downloadBlob(result, filename);
          finish(resolve);
        } catch (e) {
          finish(reject, new Error('Download failed: ' + (e?.message || e)));
        }
      },
      (err) => {
        clearTimeout(timer);
        finish(reject, new Error('GLTFExporter failed: ' + (err?.message || err)));
      },
      // embedImages is now on — see file-header comment. Safe
      // because by this point every mesh except the garage has
      // already been stripped to a textureless placeholder, so the
      // garage's handful of real textures are the only thing this
      // path actually touches.
      { binary: true, embedImages: true, onlyVisible: true, truncateDrawRange: false },
    );
  });
}

if (typeof window !== 'undefined') {
  window.__brawl3dExportMap = exportMapToGLB;
}
