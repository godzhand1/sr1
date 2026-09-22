// Per-part overrides for imported Saints Row chunks — shared by the 3D
// map editor (MapEditor3D) and the game runtime (mapCustom3d).
//
// The instanced template GLB carries one node per placed SR mesh named
// `inst_<placement>_<mesh>` under a `bbchunk_map` root. The map object
// stores author edits as `srParts[nodeName]`:
//   { p:[x,y,z], q:[x,y,z,w], s:[sx,sy,sz],   // TRS in chunk space
//     removed?: bool, collision?: bool (default true), climbable?: bool }
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SR_PART_PREFIX = 'inst_';

export function isSrPartNode(n) {
  return !!n && typeof n.name === 'string' && n.name.startsWith(SR_PART_PREFIX);
}

const r3 = (v) => +v.toFixed(3);
const r6 = (v) => +v.toFixed(6);

// Snapshot a part node's current TRS into an override record.
export function partOverrideFromNode(node, prev) {
  return {
    ...(prev || {}),
    p: node.position.toArray().map(r3),
    q: node.quaternion.toArray().map(r6),
    s: node.scale.toArray().map(r3),
  };
}

// Apply overrides to a loaded chunk subtree. Removed parts are hidden
// (editor) or detached (game). Returns the number of parts touched.
export function applySrPartOverrides(root, parts, { detachRemoved = false } = {}) {
  if (!parts || !root) return 0;
  let n = 0;
  const removed = [];
  root.traverse((node) => {
    if (!isSrPartNode(node)) return;
    const ov = parts[node.name];
    if (!ov) return;
    n++;
    if (ov.p && ov.q && ov.s) {
      node.position.fromArray(ov.p);
      node.quaternion.fromArray(ov.q);
      node.scale.fromArray(ov.s);
    }
    if (ov.removed) { node.visible = false; if (detachRemoved) removed.push(node); }
  });
  for (const node of removed) node.removeFromParent();
  return n;
}

export function countSrPartOverrides(parts) {
  let edited = 0, removed = 0, noCollision = 0, climbable = 0;
  for (const ov of Object.values(parts || {})) {
    if (ov.removed) removed++;
    else if (ov.p) edited++;
    if (ov.collision === false) noCollision++;
    if (ov.climbable) climbable++;
  }
  return { edited, removed, noCollision, climbable, total: Object.keys(parts || {}).length };
}

// Drop override keys that don't name a part in the loaded GLB (stale
// hand-edits / template re-imports). Returns the pruned map, or null
// when nothing had to change.
export function pruneSrPartOverrides(root, parts) {
  if (!parts || !Object.keys(parts).length) return null;
  const names = new Set();
  root.traverse((n) => { if (isSrPartNode(n)) names.add(n.name); });
  const keep = Object.keys(parts).filter((k) => names.has(k));
  if (keep.length === Object.keys(parts).length) return null;
  return Object.fromEntries(keep.map((k) => [k, parts[k]]));
}

// Chunk-space AABBs of climbable parts (from the collision bake) → world
// AABB colliders the mantle system understands. `o` is the map object
// carrying the chunk anchor transform (x/y/z, yaw, sx/sy/sz).
export function climbBoxesWorld(colClimb, o) {
  const out = [];
  const yaw = o.yaw || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sx = o.sx || 1, sy = o.sy || 1, sz = o.sz || 1;
  for (const box of colClimb || []) {
    if (!box || !box.min || !box.max) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const px of [box.min[0], box.max[0]]) {
      for (const pz of [box.min[2], box.max[2]]) {
        const lx = px * sx, lz = pz * sz;
        // three.js Y rotation: world = R(yaw) · local
        const wx = lx * c + lz * s + (o.x || 0);
        const wz = -lx * s + lz * c + (o.z || 0);
        x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
        z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
      }
    }
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
    out.push({
      x0, x1, z0, z1,
      h: (o.y || 0) + box.max[1] * sy,
      yBase: (o.y || 0) + box.min[1] * sy,
      climbable: true,
      sr_part: box.id,
    });
  }
  return out;
}

// Game-side draw-call sanity: bake every visible part into one merged
// mesh per material (the editor keeps parts separate so they stay
// clickable). Returns a new Group in the subtree root's local space.
export function mergeSrChunkByMaterial(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const m = new THREE.Matrix4();
  root.traverse((n) => {
    if (!n.isMesh) return;
    for (let p = n; p && p !== root; p = p.parent) if (!p.visible) return;
    const g = n.geometry.clone();
    m.multiplyMatrices(rootInv, n.matrixWorld);
    g.applyMatrix4(m);
    if (m.determinant() < 0 && g.index) {
      const idx = g.index.array;
      for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
    const key = n.material.uuid;
    if (!byMat.has(key)) byMat.set(key, { mat: n.material, geoms: [] });
    byMat.get(key).geoms.push(g);
  });
  const out = new THREE.Group();
  out.name = 'bbchunk_merged';
  for (const { mat, geoms } of byMat.values()) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (geoms.length > 1) geoms.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}
