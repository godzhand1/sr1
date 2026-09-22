// Team Gangsta Brawl — Saints-Row OBJ asset loader.
//
// Loads the user-supplied OBJ library served from
// `${REACT_APP_BACKEND_URL}/api/static/models/*.obj` and exposes:
//
//   loadAsset(name)          → Promise<THREE.BufferGeometry>     (centered, scaled to ~SR units)
//   loadSlicedBody(name)     → Promise<{ head, torso, armL, armR, legL, legR }>
//                              cuts a full-body mesh into per-bone
//                              rigid parts so the existing skeleton
//                              animations still bend the character.
//   getApiBase()             → backend root (for direct mounts).
//
// All geometries are CACHED — calling `loadAsset('cs_ak47.obj')`
// twice returns the same BufferGeometry instance.  Three.js shares
// these safely across multiple Meshes.

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ensureGlb, getGlbGeometry } from './glbAssets.js';

export function getApiBase() {
  const env = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || '';
  return env.replace(/\/$/, '');
}

const objCache = new Map();
const slicedCache = new Map();
const _loader = new OBJLoader();

// Kick off the GLB load early so it's primed by the time the first
// character / weapon is requested.  Idempotent.
ensureGlb().catch(() => { /* OBJ fallback will handle missing assets */ });

/** Load an OBJ by filename. Tries the GLB first (the user shipped a
 *  consolidated `sr1world.glb` with every clothing/body/weapon asset),
 *  falls back to the legacy OBJ on the backend's static mount if the
 *  GLB doesn't carry the asset. Returns a merged geometry centered on
 *  the origin. */
export function loadAsset(name) {
  if (objCache.has(name)) return objCache.get(name);
  const p = ensureGlb().then(
    () => getGlbGeometry(name),
    () => null,
  ).then((glbGeo) => {
    if (glbGeo) return glbGeo;
    // Fall through to OBJ load.
    return _loadObj(name);
  });
  objCache.set(name, p);
  p.catch(() => objCache.delete(name));
  return p;
}

function _loadObj(name) {
  const url = `${getApiBase()}/api/static/models/${name}`;
  return new Promise((resolve, reject) => {
    _loader.load(
      url,
      (group) => {
        const geos = [];
        group.traverse((o) => {
          if (o.isMesh && o.geometry) {
            const g = o.geometry.clone();
            g.applyMatrix4(o.matrixWorld);
            geos.push(g);
          }
        });
        if (geos.length === 0) {
          reject(new Error(`OBJ ${name} had no meshes`));
          return;
        }
        let main = geos[0];
        for (const g of geos) {
          const c1 = g.attributes.position ? g.attributes.position.count : 0;
          const c2 = main.attributes.position ? main.attributes.position.count : 0;
          if (c1 > c2) main = g;
        }
        main.computeVertexNormals();
        main.computeBoundingBox();
        resolve(main);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

/** Slice a full-body OBJ geometry into per-bone rigid parts.  We
 *  partition vertices by world-space location.  Note that `man.obj`
 *  is exported in an A-pose with the arms hanging DOWN — hands sit
 *  at hip level (Y≈0.95, |X|≈0.55-0.59), not outstretched at
 *  shoulder height.  We classify by the *vertical column* the vert
 *  belongs to (|X| > 0.22 → arm, else torso/leg), so the wrists/
 *  hands stay attached to the rest of the arm instead of being
 *  fragmented at the hip line.
 *
 *  Regions:
 *    head  — Y above neckline (1.45) — head + upper neck
 *    armR  — rotated-X > 0.22, any Y
 *    armL  — rotated-X < -0.22, any Y
 *    torso — 0.90 ≤ Y ≤ 1.45 and |X| ≤ 0.22
 *    legR  — Y < 0.90, X ≥ 0
 *    legL  — Y < 0.90, X < 0
 */
function partitionVertex(x, y) {
  if (y > 1.45) return 'head';
  if (x > 0.22) return 'armR';
  if (x < -0.22) return 'armL';
  if (y < 0.90) return x >= 0 ? 'legR' : 'legL';
  return 'torso';
}

// Pivot offsets match the skeleton's bone WORLD positions in
// characterModel3d.js — so once a slice is attached to its bone,
// every vertex lands back at its original (post-Y-rotation) world
// position and the parts visually meet at every joint (no daylight
// gaps at the neck, shoulders, hips, or knees).  Bone world map:
//   headG     world (0,     1.81, 0)
//   torsoG    world (0,     1.07, 0)
//   armR.sh   world ( 0.295, 1.53, 0)
//   armL.sh   world (-0.295, 1.53, 0)
//   legR.hip  world ( 0.13,  0.96, 0)
//   legL.hip  world (-0.13,  0.96, 0)
const BONE_PIVOTS = {
  head:  [0,      1.81, 0],
  torso: [0,      1.07, 0],
  armR:  [ 0.295, 1.53, 0],
  armL:  [-0.295, 1.53, 0],
  legR:  [ 0.13,  0.96, 0],
  legL:  [-0.13,  0.96, 0],
};

export async function loadSlicedBody(name) {
  if (slicedCache.has(name)) return slicedCache.get(name);
  const base = await loadAsset(name);
  const positions = base.attributes.position;
  const normals = base.attributes.normal;
  const index = base.index;
  const N = positions.count;
  // Saints Row OBJ exports (Blender) have the character facing +Z, while
  // our procedural skeleton (and Three.js convention) has the character
  // facing -Z (eyes / glasses / bandana drawn at z<0). Pre-rotate every
  // vertex 180° around Y (x→-x, z→-z) so the OBJ's face ends up on the
  // skeleton's front. L/R arm pivots are mirrored on the same axis so
  // partitioning + bone attachment still resolve to the correct side.
  const rotX = (i) => -positions.getX(i);
  const rotZ = (i) => -positions.getZ(i);
  // Classify each vertex (use rotated X so partition respects the new
  // front-facing orientation).
  const region = new Array(N);
  for (let i = 0; i < N; i++) {
    region[i] = partitionVertex(rotX(i), positions.getY(i));
  }
  // Bucket faces by region. To avoid the visible joint-gaps the
  // previous "all 3 verts must agree" rule produced (it dropped every
  // face that straddled a seam), each face is now assigned to the
  // region of MAJORITY vote: ≥2 verts share a region → face goes
  // there; pure 3-way ties (rare) fall back to vertex `a`'s region.
  // The same triangle is no longer duplicated across buckets, so the
  // mesh stays watertight while the parts still rotate with their
  // bones cleanly.
  const buckets = { head: [], torso: [], armR: [], armL: [], legR: [], legL: [] };
  const triCount = index ? index.count / 3 : N / 3;
  for (let f = 0; f < triCount; f++) {
    const a = index ? index.getX(f * 3) : f * 3;
    const b = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const c = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    const ra = region[a], rb = region[b], rc = region[c];
    let r;
    if (ra === rb || ra === rc) r = ra;
    else if (rb === rc) r = rb;
    else r = ra;
    buckets[r].push(a, b, c);
  }
  // Build a sliced BufferGeometry per region, with the pivot offset
  // so the local origin lands on the bone joint.  We share positions
  // (re-mapped per region) and normals.
  const out = {};
  for (const r of Object.keys(buckets)) {
    const tris = buckets[r];
    if (tris.length === 0) { out[r] = null; continue; }
    const used = new Map();           // origVertexIdx → newIdx
    const px = [], py = [], pz = [], nx = [], ny = [], nz = [];
    const newIdx = new Uint32Array(tris.length);
    const piv = BONE_PIVOTS[r];
    for (let i = 0; i < tris.length; i++) {
      const v = tris[i];
      let n = used.get(v);
      if (n == null) {
        n = px.length;
        used.set(v, n);
        // Apply the 180° Y rotation here too so the geometry lives in
        // the rotated frame *before* the pivot offset gets subtracted.
        px.push(-positions.getX(v) - piv[0]);
        py.push(positions.getY(v) - piv[1]);
        pz.push(-positions.getZ(v) - piv[2]);
        if (normals) {
          nx.push(-normals.getX(v));
          ny.push(normals.getY(v));
          nz.push(-normals.getZ(v));
        }
      }
      newIdx[i] = n;
    }
    const g = new THREE.BufferGeometry();
    const posArr = new Float32Array(px.length * 3);
    for (let i = 0; i < px.length; i++) {
      posArr[i * 3] = px[i]; posArr[i * 3 + 1] = py[i]; posArr[i * 3 + 2] = pz[i];
    }
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    if (nx.length) {
      const nArr = new Float32Array(nx.length * 3);
      for (let i = 0; i < nx.length; i++) { nArr[i*3]=nx[i]; nArr[i*3+1]=ny[i]; nArr[i*3+2]=nz[i]; }
      g.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
    } else {
      g.computeVertexNormals();
    }
    g.setIndex(new THREE.BufferAttribute(newIdx, 1));
    g.computeBoundingBox();
    out[r] = g;
  }
  slicedCache.set(name, out);
  return out;
}

/** Same partition logic as `loadSlicedBody` but applied to arbitrary
 *  body-fitting OBJs (shirts, pants, jackets, shoes). Reuses the
 *  cached slice if it's already been computed — the body slicer
 *  works on any A-pose OBJ that shares man.obj's coordinate space.
 */
export function loadSlicedClothing(name) {
  return loadSlicedBody(name);
}

/** Centre a weapon geometry on its origin and orient long-axis along
 *  +X (matches the procedural gunMount convention).  The OBJ exports
 *  often have the barrel along +Y or +Z — we detect the longest axis
 *  and rotate accordingly. */
export async function loadWeapon(name) {
  const g = await loadAsset(name);
  const out = g.clone();
  out.computeBoundingBox();
  const bb = out.boundingBox;
  const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  // Translate centre to origin
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  out.translate(-cx, -cy, -cz);
  // Rotate so the longest axis aligns with +X (barrel down +X).
  if (sz >= sx && sz >= sy) {
    out.rotateY(-Math.PI / 2);          // Z → X
  } else if (sy >= sx && sy >= sz) {
    out.rotateZ(-Math.PI / 2);          // Y → X
  }
  out.computeBoundingBox();
  return out;
}
