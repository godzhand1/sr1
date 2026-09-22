// render/instanceBatch.js — collapse repeated geometry into InstancedMesh.
//
// Map builders assemble props the readable way (a Group of a few Meshes
// per hydrant / bench / ladder). `flattenToInstances` walks those roots,
// bakes every mesh's world transform, and merges meshes that share the
// same geometry *shape* (type + parameters, not object identity) and an
// equivalent material into ONE InstancedMesh. 230 prop draw calls → ~15.
import * as THREE from 'three';

const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3();

export function geometryKey(g) {
  if (!g) return 'nogeo';
  if (g.userData && g.userData.batchKey) return g.userData.batchKey;
  if (g.parameters) return `${g.type}:${JSON.stringify(g.parameters)}`;
  return g.uuid;
}

const hex = (c) => (c && c.isColor ? c.getHex().toString(16) : '-');
// Clones of one texture (cloneAiTex per object) share `source`; key on
// that + the UV transform so equal-looking maps merge into one batch.
const tex = (t) => (t ? `${(t.source && t.source.uuid) || (t.image && t.image.uuid) || t.uuid}@${t.repeat ? `${t.repeat.x},${t.repeat.y}` : ''}/${t.offset ? `${t.offset.x},${t.offset.y}` : ''}/${t.rotation || 0}/${t.wrapS},${t.wrapT}` : '-');

// Materials with custom shader hooks / per-object uniforms are never
// merged (their uuid is the key); plain Standard/Basic/Phong/Physical
// materials merge on their visible parameters.
export function materialKey(m) {
  if (!m) return 'nomat';
  if (Array.isArray(m)) return m.map(materialKey).join('+');
  if (m.userData && (m.userData.noBatch || m.userData.pbr)) return m.uuid;
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return m.uuid;
  return [
    m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness,
    m.transparent ? 1 : 0, m.opacity, m.side, m.depthWrite ? 1 : 0, m.shininess, hex(m.specular),
    tex(m.map), tex(m.normalMap), tex(m.roughnessMap), tex(m.metalnessMap), tex(m.aoMap), tex(m.emissiveMap),
    m.transmission, m.clearcoat, m.envMapIntensity, m.alphaTest, m.vertexColors ? 1 : 0,
  ].join('|');
}

// Collect plain meshes (not already instanced / skinned / flagged) under
// the roots with their world matrices baked.
function collect(roots) {
  const out = [];
  for (const r of roots) {
    if (!r) continue;
    r.updateMatrixWorld(true);
    r.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.noBatch) return;
      if (!o.geometry || !o.material) return;
      out.push(o);
    });
  }
  return out;
}

/**
 * Flatten `roots` into instanced batches.
 * Returns { instanced: InstancedMesh[], singles: Mesh[] } — every object is
 * in WORLD space and detached from its original parent; add them to the
 * scene / stream as essentials. `minCount` (default 2) is the group size
 * below which a mesh is kept as a plain single.
 */
export function flattenToInstances(roots, { minCount = 2, castShadow = null, receiveShadow = null } = {}) {
  const meshes = collect(Array.isArray(roots) ? roots : [roots]);
  const groups = new Map();
  for (const m of meshes) {
    const key = `${geometryKey(m.geometry)}||${materialKey(m.material)}`;
    let g = groups.get(key);
    if (!g) { g = { geometry: m.geometry, material: m.material, items: [] }; groups.set(key, g); }
    g.items.push(m);
  }
  const instanced = [], singles = [];
  for (const g of groups.values()) {
    if (g.items.length < minCount) {
      for (const m of g.items) {
        m.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        if (m.parent) m.parent.remove(m);
        if (castShadow != null) m.castShadow = castShadow;
        if (receiveShadow != null) m.receiveShadow = receiveShadow;
        singles.push(m);
      }
      continue;
    }
    const inst = new THREE.InstancedMesh(g.geometry, g.material, g.items.length);
    let anyColor = false;
    for (let i = 0; i < g.items.length; i++) {
      const m = g.items[i];
      inst.setMatrixAt(i, m.matrixWorld);
      if (m.userData.instanceColor) {
        if (!anyColor) { anyColor = true; }
        inst.setColorAt(i, m.userData.instanceColor);
      }
      if (m.parent) m.parent.remove(m);
      // Geometry objects that duplicated the shared shape can go.
      if (m.geometry !== g.geometry) m.geometry.dispose?.();
      if (m.material !== g.material && !Array.isArray(m.material)) m.material.dispose?.();
    }
    if (anyColor) {
      // Instances without an explicit tint render white (identity).
      for (let i = 0; i < g.items.length; i++) if (!g.items[i].userData.instanceColor) inst.setColorAt(i, _white);
      inst.instanceColor.needsUpdate = true;
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = castShadow != null ? castShadow : g.items.some((m) => m.castShadow);
    inst.receiveShadow = receiveShadow != null ? receiveShadow : g.items.some((m) => m.receiveShadow);
    inst.userData.batched = g.items.length;
    instanced.push(inst);
  }
  return { instanced, singles };
}
const _white = new THREE.Color(0xffffff);

// Compose a TRS matrix — handy for hand-built instancers.
export function trs(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, out = new THREE.Matrix4()) {
  _pos.set(x, y, z); _quat.setFromAxisAngle(_Y, ry); _scl.set(sx, sy, sz);
  return out.compose(_pos, _quat, _scl);
}
const _Y = new THREE.Vector3(0, 1, 0);

// Shared unit primitives — scale them per instance instead of allocating
// a geometry per size so different sizes still land in one batch.
let _unitBox = null;
export function unitBox() { if (!_unitBox) { _unitBox = new THREE.BoxGeometry(1, 1, 1); _unitBox.userData.batchKey = 'unitBox'; } return _unitBox; }
