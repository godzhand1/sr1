// Jersey Barrier — permanent hard-cover prop.
//
// Loads the AAA GLB (`/models/jersey_barrier.glb`) once, caches the
// template, and clones per-placement so every barrier shares the same
// geometry + materials. Each placement returns a Three group + a
// collider record in the engine's `{ x0, z0, x1, z1, h }` format so
// bullets, players, and vehicles all treat it as a solid block.
//
// Barriers are:
//   • hand-placed on the 4 existing arenas (block, projects,
//     koth_house, boardroom) — see the per-map JB_LAYOUTS below.
//   • sprinkled outside the new garage lobby.
//   • not climbable, not destructible — permanent hard cover.
//
// The cover-mechanic layer (crouch-hug pose + damage soak from the
// barrier side) lives in engine3d.js and characterMeshy.js; this
// module ONLY owns the mesh + collider.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BARRIER_URL = '/models/jersey_barrier.glb';

// Real jersey barriers are ~3 m long × ~0.6 m wide × ~0.8 m tall.
// The GLB may load at any world scale — we normalise to these values
// so barriers are consistent across all placements.
export const BARRIER_LEN  = 3.0;   // long axis (X after yaw=0)
export const BARRIER_WID  = 0.6;   // short axis (Z after yaw=0)
export const BARRIER_TALL = 0.85;  // top of collider

// Shared template cache — fetched once, cloned per placement.
let _tplPromise = null;
let _tpl = null;               // { scene, sx, sy, sz, offY }

function _loadTemplate() {
  if (_tpl) return Promise.resolve(_tpl);
  if (_tplPromise) return _tplPromise;
  const loader = new GLTFLoader();
  _tplPromise = new Promise((resolve, reject) => {
    loader.load(BARRIER_URL, (gltf) => {
      const scene = gltf.scene || gltf.scenes[0];
      // Force shadows on every mesh inside the barrier + drop
      // geometry-broken meshes entirely (Meshy exports occasionally
      // ship an empty NaN mesh alongside the real ones, which
      // otherwise spams `computeBoundingBox NaN` warnings every
      // frame the reflection probe re-samples the scene).
      const toRemove = [];
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.geometry) {
            const pos = o.geometry.attributes.position;
            if (pos && pos.array && pos.array.length > 0) {
              // Sample a handful of vertices (cheap for large meshes)
              // — any NaN in the first few samples marks the whole
              // mesh as degenerate.
              const N = pos.array.length;
              const step = Math.max(1, Math.floor(N / 32));
              let hasNaN = false;
              for (let i = 0; i < N; i += step) {
                if (!Number.isFinite(pos.array[i])) { hasNaN = true; break; }
              }
              if (hasNaN) toRemove.push(o);
            } else {
              toRemove.push(o);   // empty geometry — also useless
            }
          }
        }
      });
      for (const m of toRemove) {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose?.();
      }
      if (toRemove.length) console.warn('[jerseyBarrier] dropped', toRemove.length, 'degenerate meshes');
      // Compute native bbox so we can normalise scale to BARRIER_LEN /
      // BARRIER_WID / BARRIER_TALL regardless of what the artist used
      // as source units (Meshy exports are often ~1 unit total).
      const bbox = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      // Guard: if the bbox is degenerate (empty scene / NaN mesh),
      // fall back to identity scale so we at least don't crash.
      const safeSize = (v) => (Number.isFinite(v) && v > 0.001 ? v : 1.0);
      const sxRaw = safeSize(size.x);
      const syRaw = safeSize(size.y);
      const szRaw = safeSize(size.z);
      // Pick which of (x, z) is the LONG axis (in case the GLB was
      // authored end-on to Z instead of X) — we always want the long
      // side along X in local space so yaw=0 places barriers running
      // east-west.
      const longIsX = sxRaw >= szRaw;
      const targLong  = longIsX ? sxRaw : szRaw;
      const targShort = longIsX ? szRaw : sxRaw;
      const sx = BARRIER_LEN / targLong;
      const sz = BARRIER_WID / targShort;
      const sy = BARRIER_TALL / syRaw;
      const offY = Number.isFinite(bbox.min.y) ? -bbox.min.y * sy : 0;
      console.log('[jerseyBarrier] loaded — bbox size:', size.toArray(), '→ scale', [sx, sy, sz]);
      _tpl = {
        scene,
        sx, sy, sz,
        preYaw: longIsX ? 0 : Math.PI / 2,
        offY,
      };
      resolve(_tpl);
    }, undefined, (err) => reject(err));
  });
  return _tplPromise;
}

// Pre-fetch at module import so the first buildArena call doesn't
// pay the load cost while streaming.
_loadTemplate().catch(() => {});

// Spawn one barrier at (x, z) with the given yaw (radians, 0 = long
// axis east-west). Returns { group, collider }. The `group` is added
// to `parent` (typically a StreamingManager entry) immediately;
// mesh will populate as the GLB finishes loading if it wasn't ready.
//
//   spawnBarrier(scene, colliders, { x: 10, z: 4, yaw: Math.PI/2 })
export function spawnBarrier(parent, colliders, { x, z, yaw = 0, id = null } = {}) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);

  _loadTemplate().then((tpl) => {
    // SkinnedMesh-safe clone (no skinning here, but we clone deep
    // so materials aren't shared and lighting stays isolated).
    const clone = tpl.scene.clone(true);
    clone.scale.set(tpl.sx, tpl.sy, tpl.sz);
    clone.position.y = tpl.offY;
    clone.rotation.y = tpl.preYaw;
    group.add(clone);
  }).catch((err) => {
    // Fallback: a plain box so the world isn't visually broken.
    console.warn('[jerseyBarrier] load failed, using fallback box', err);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(BARRIER_LEN, BARRIER_TALL, BARRIER_WID),
      pbr.stone({ color: 0x777771 }),
    );
    box.position.y = BARRIER_TALL / 2;
    group.add(box);
  });

  // Axis-aligned collider — rotated barriers become a wider AABB.
  // The exact shape doesn't matter for engine collision (which is
  // AABB-based) but we compute the SWEPT footprint of the OBB so
  // the collider stays snug regardless of yaw.
  const cos = Math.abs(Math.cos(yaw));
  const sin = Math.abs(Math.sin(yaw));
  const halfL = BARRIER_LEN / 2;
  const halfW = BARRIER_WID / 2;
  const halfX = halfL * cos + halfW * sin;
  const halfZ = halfL * sin + halfW * cos;
  const collider = {
    x0: x - halfX, z0: z - halfZ,
    x1: x + halfX, z1: z + halfZ,
    h: BARRIER_TALL,
    climbable: false,
    // Cover metadata — engine's cover-hug detection uses `barrier` to
    // filter for jersey barriers (vs generic crates / walls).
    barrier: true,
    // The barrier's local FORWARD axis (perpendicular to the long
    // side, pointing "outward" from one of the two faces). Along
    // with `yaw` this lets the cover system pick the right side to
    // hug: either +normal or -normal.
    yaw,
    id: id || `barrier_${Math.round(x)}_${Math.round(z)}_${Math.round(yaw * 100)}`,
  };
  colliders.push(collider);
  return { group, collider };
}

// Convenience — spawn a straight line of N barriers along a bearing.
// Handy for hand-laid chokepoint walls: line({x:0,z:0}, N/2, ...).
export function spawnBarrierLine(parent, colliders, { x, z, yaw = 0, count = 3, gap = 0.4 }) {
  const step = BARRIER_LEN + gap;
  const dx = Math.cos(yaw) * step;
  const dz = -Math.sin(yaw) * step;
  const start = -(count - 1) / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const px = x + (start + i) * dx;
    const pz = z + (start + i) * dz;
    out.push(spawnBarrier(parent, colliders, { x: px, z: pz, yaw }));
  }
  return out;
}

// Per-map hand-placed layouts — 6-8 barriers each at natural
// chokepoints and spawn-edge cover. Positions are picked to give
// crouching players "peek" lines toward the map's center.
//
// Format: array of { x, z, yaw }.
export const JB_LAYOUTS = {
  block: [
    // Central plaza chokepoint (two rows funneling toward center)
    { x:  -6, z:  -3, yaw: 0 },
    { x:   6, z:  -3, yaw: 0 },
    { x:  -6, z:   3, yaw: 0 },
    { x:   6, z:   3, yaw: 0 },
    // West alley spawn edge
    { x: -18, z:  -8, yaw: Math.PI / 2 },
    // East alley spawn edge
    { x:  18, z:   8, yaw: Math.PI / 2 },
    // North gap cover
    { x:   0, z: -15, yaw: 0 },
    // South gap cover
    { x:   0, z:  15, yaw: 0 },
  ],
  projects: [
    { x:  -8, z:   0, yaw: 0 },
    { x:   8, z:   0, yaw: 0 },
    { x:  -4, z:  -8, yaw: Math.PI / 2 },
    { x:   4, z:   8, yaw: Math.PI / 2 },
    { x: -14, z:  -4, yaw: 0 },
    { x:  14, z:   4, yaw: 0 },
    { x:   0, z: -12, yaw: 0 },
  ],
  koth_house: [
    // Entry hallway cover (both sides of the hill room)
    { x:  -3, z:  -6, yaw: Math.PI / 2 },
    { x:   3, z:  -6, yaw: Math.PI / 2 },
    { x:  -3, z:   6, yaw: Math.PI / 2 },
    { x:   3, z:   6, yaw: Math.PI / 2 },
    { x: -10, z:   0, yaw: 0 },
    { x:  10, z:   0, yaw: 0 },
  ],
  boardroom: [
    // Boardroom is smaller — 4 corner peek barriers around table.
    { x:  -5, z:  -3, yaw: Math.PI / 4 },
    { x:   5, z:  -3, yaw: -Math.PI / 4 },
    { x:  -5, z:   3, yaw: -Math.PI / 4 },
    { x:   5, z:   3, yaw: Math.PI / 4 },
    { x:   0, z:  -7, yaw: 0 },
    { x:   0, z:   7, yaw: 0 },
  ],
  graffiti: [
    // Graffiti alley: barriers pinch the north / south approaches to
    // the plaza and give side-alley cover between the buildings.
    { x:  -8, z:  -3, yaw: Math.PI / 2 },
    { x:   8, z:  -3, yaw: Math.PI / 2 },
    { x:  -8, z:   3, yaw: Math.PI / 2 },
    { x:   8, z:   3, yaw: Math.PI / 2 },
    { x:   0, z: -13, yaw: 0 },
    { x:   0, z:  13, yaw: 0 },
    { x: -13, z:   0, yaw: Math.PI / 2 },
    { x:  13, z:   0, yaw: Math.PI / 2 },
  ],
};

// One-call helper — used by each arena builder. Passes each barrier
// through `stream.addEssential` so shadow-casters + collider live in
// the streaming manager along with the rest of the map furniture.
export function scatterBarriersForMap(mapId, stream, colliders) {
  const layout = JB_LAYOUTS[mapId];
  if (!layout || !layout.length) return [];
  const spawned = [];
  for (const spec of layout) {
    const holder = new THREE.Group();
    stream.addEssential(holder);
    spawned.push(spawnBarrier(holder, colliders, spec));
  }
  return spawned;
}
