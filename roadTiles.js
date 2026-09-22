// roadTiles.js — shared cache + INSTANCED renderer for the modular
// road-tile system used by both the map editor and the runtime map
// loader (mapCustom3d.js).
//
// Two Meshy AI-authored tiles ship out of the box:
//   • 'straight' — suburban straight road (2 lanes + curbs)
//   • 'curve'    — 90° city road corner tile
// Both are ~1.9m × 1.9m × 0.16m in the source, then FIT-SCALED to
// exactly 4m per tile so the snap-grid tessellates without gaps.
//
// The AAA performance win here is **THREE.InstancedMesh** — every
// tile of the same variant shares ONE draw call regardless of how
// many you place. A 40-tile suburban block ships as 2 draw calls
// instead of 40. Same trick we'll extend to buildings + props next.
//
// Public API:
//   preloadRoadTiles()        → Promise<void> (idempotent)
//   getRoadTileVariants()     → ['straight', 'curve']
//   getRoadTileBounds(kind)   → {w, d, h} post-scale (for snap grid)
//   buildRoadTileInstancer(scene, kind) → { setMatrixAt, count, mesh, dispose }
//   cloneRoadTile(kind)       → THREE.Group (single, non-instanced —
//                               used by the editor's ghost preview).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TILE_URLS = {
  straight: '/road_tiles/road_straight.glb',
  curve:    '/road_tiles/road_curve.glb',
};

// Every road tile fits exactly TILE_SIZE × TILE_SIZE in world units,
// snap-grid pitch. 8m gives 4 lanes' worth of tarmac — realistic
// SR1-scale city block road that a car can drive down comfortably.
// Authors can scale a placed tile further via the transform gizmo.
export const TILE_SIZE = 8.0;

const _templates = new Map();      // kind → { scene, fitScale, yLift, extractedGeom, mat }
const _loadPromises = new Map();   // kind → Promise
let _loadAllPromise = null;

function _computeFitScale(scene, target = TILE_SIZE) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  // Non-uniform fit: X and Z (footprint) fit to TILE_SIZE so tiles
  // tessellate edge-to-edge on the grid. Y (thickness) fits to a
  // FIXED 0.18m regardless of source thickness — this keeps the
  // walkable surface at a consistent height so the player's feet
  // sit flat on the road. Otherwise uniform-scaling a 0.16m-thick
  // source tile to 8m footprint would make it 0.67m tall — the
  // player would visibly sink into the mesh because the walkable
  // collider top is at 0.18m.
  const footLongest = Math.max(size.x, size.z) || 1;
  const thickY = size.y || 0.16;
  const targetThickness = 0.18;
  return { x: target / footLongest, y: targetThickness / thickY, z: target / footLongest };
}

// Preload one tile variant. Idempotent — subsequent calls return
// the same promise.
function _preloadOne(kind) {
  if (_templates.has(kind)) return Promise.resolve(_templates.get(kind));
  if (_loadPromises.has(kind)) return _loadPromises.get(kind);
  const url = TILE_URLS[kind];
  if (!url) return Promise.reject(new Error(`Unknown road tile kind: ${kind}`));
  const loader = new GLTFLoader();
  const p = new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
            if (o.material && o.material.roughness != null) {
              o.material.roughness = Math.max(o.material.roughness, 0.7); // road asphalt shouldn't glint
            }
          }
        });
        const fitScale = _computeFitScale(scene);
        // Bake the fitScale + yGrounding into the extracted geometry
        // so InstancedMesh only needs to apply per-instance placement
        // matrices — no shared object hierarchy. Compose a matrix
        // with non-uniform scale (X/Z=footprint, Y=thickness) so the
        // road tile is exactly 8×0.18×8 regardless of source dims.
        // Also LIFTS the geometry so its LOWEST point sits on y=0.
        const preBoxFit = new THREE.Box3().setFromObject(scene);
        const yLift = -preBoxFit.min.y * fitScale.y;
        // Extract the first mesh's geometry + material for the
        // InstancedMesh builder (Meshy assets ship as a single
        // primitive so this is a safe assumption; we defensively
        // pick the biggest mesh if there are multiple).
        let bestMesh = null;
        let bestTris = -1;
        scene.traverse((o) => {
          if (o.isMesh && o.geometry) {
            const idx = o.geometry.getIndex();
            const tris = idx ? idx.count / 3 : (o.geometry.attributes.position.count / 3);
            if (tris > bestTris) { bestTris = tris; bestMesh = o; }
          }
        });
        let extractedGeom = null;
        let extractedMat = null;
        if (bestMesh) {
          extractedGeom = bestMesh.geometry.clone();
          bestMesh.updateMatrixWorld(true);
          const m = new THREE.Matrix4();
          m.compose(
            new THREE.Vector3(0, yLift, 0),
            new THREE.Quaternion(),
            new THREE.Vector3(fitScale.x, fitScale.y, fitScale.z),
          );
          extractedGeom.applyMatrix4(m);
          extractedGeom.computeBoundingBox();
          extractedGeom.computeBoundingSphere();
          extractedMat = bestMesh.material;
        }
        const tpl = { scene, fitScale, yLift, extractedGeom, extractedMat };
        _templates.set(kind, tpl);
        resolve(tpl);
      },
      undefined,
      (err) => {
        console.warn(`[roadTiles] ${kind} load failed`, err);
        _templates.set(kind, null);
        resolve(null);
      },
    );
  });
  _loadPromises.set(kind, p);
  return p;
}

export function preloadRoadTiles() {
  if (_loadAllPromise) return _loadAllPromise;
  _loadAllPromise = Promise.all(Object.keys(TILE_URLS).map(_preloadOne));
  return _loadAllPromise;
}

export function getRoadTileVariants() {
  return Object.keys(TILE_URLS);
}

export function getRoadTileBounds() {
  // Every tile is fit-scaled to TILE_SIZE × TILE_SIZE — thickness
  // varies slightly by source (~16 cm for straight, ~11 cm for
  // curve) but we report a common thickness for snap/collider math.
  return { w: TILE_SIZE, d: TILE_SIZE, h: 0.18 };
}

// Clone a single tile (used by the editor's ghost preview + when
// author picks "Free Move" mode so tiles can be dragged around
// independently). Returns a THREE.Group with the fit-scale + yLift
// baked in; caller only needs to set .position + .rotation.
export function cloneRoadTile(kind) {
  const tpl = _templates.get(kind);
  if (!tpl) return null;
  const g = tpl.scene.clone(true);
  // Non-uniform scale: X and Z fit to TILE_SIZE (footprint), Y fit
  // to the fixed 0.18m thickness (walkable surface height matches
  // the collider so the player's feet sit flat on the road).
  g.scale.set(tpl.fitScale.x, tpl.fitScale.y, tpl.fitScale.z);
  g.position.y = tpl.yLift;
  g.userData.roadTileKind = kind;
  return g;
}

// Build an InstancedMesh factory for a given tile variant. Returns
// a small controller so the caller can add tiles dynamically.
//
// We pre-allocate the InstancedMesh at MAX_INSTANCES so we never
// hit Three's non-resizable buffer limit — a modest 4 MB VRAM cost
// per variant that unlocks single-draw-call rendering of an entire
// road network.
//
// The instancer OWNS its InstancedMesh; call `.dispose()` when the
// scene is torn down to free geometry + textures.
const MAX_INSTANCES_PER_VARIANT = 1024;
export function buildRoadTileInstancer(scene, kind) {
  const tpl = _templates.get(kind);
  if (!tpl || !tpl.extractedGeom) return null;
  const mesh = new THREE.InstancedMesh(tpl.extractedGeom, tpl.extractedMat, MAX_INSTANCES_PER_VARIANT);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.roadTileKind = kind;
  scene.add(mesh);
  const _tmpMat = new THREE.Matrix4();
  const _tmpPos = new THREE.Vector3();
  const _tmpQuat = new THREE.Quaternion();
  const _tmpScale = new THREE.Vector3(1, 1, 1);
  const _yAxis = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    kind,
    // Add ONE tile at world-space (x, y, z) with yaw around +Y and
    // per-axis SCALE multipliers (default 1). Returns the instance
    // index, or -1 if over capacity. Non-uniform scaling lets an
    // author widen a tile in X only (highway) or stretch it in Z
    // only (long straightaway) via the transform gizmo's SCALE mode.
    add(x, y, z, yaw, scaleX = 1, scaleZ = null) {
      if (mesh.count >= MAX_INSTANCES_PER_VARIANT) {
        console.warn(`[roadTiles] variant '${kind}' capacity ${MAX_INSTANCES_PER_VARIANT} reached — extra tiles dropped`);
        return -1;
      }
      const sZ = scaleZ != null ? scaleZ : scaleX;
      // Y (thickness) scale is the mean of X and Z so uneven-w/d
      // tiles get a proportional height instead of blowing thickness
      // out of scale.
      const sY = (scaleX + sZ) * 0.5;
      _tmpQuat.setFromAxisAngle(_yAxis, yaw || 0);
      _tmpPos.set(x, y || 0, z);
      _tmpScale.set(scaleX, sY, sZ);
      _tmpMat.compose(_tmpPos, _tmpQuat, _tmpScale);
      mesh.setMatrixAt(mesh.count, _tmpMat);
      mesh.count++;
      mesh.instanceMatrix.needsUpdate = true;
      return mesh.count - 1;
    },
    // Reset the instancer to zero — used when the editor rebuilds
    // the whole tile set (e.g. after a doc-doc reload).
    clear() {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      mesh.dispose();
    },
  };
}
