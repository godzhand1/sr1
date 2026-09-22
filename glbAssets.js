// Team Gangsta Brawl — Saints Row GLB asset library loader.
//
// All character / weapon / clothing assets the user shipped are baked
// into a single 13 MB GLB file (`sr1world.glb`) served from
// `${REACT_APP_BACKEND_URL}/api/static/models/sr1world.glb`. This module
// loads the file ONCE and exposes a synchronous name → THREE.BufferGeometry
// lookup once the load promise resolves.
//
//   ensureGlb()       → Promise<void>    (idempotent, cached forever)
//   getGlbMesh(name)  → Mesh template or null if unknown
//   getGlbGeometry(name) → BufferGeometry clone in WORLD-aligned coords
//                          (node rotation/scale baked into vertices —
//                          drop-in replacement for an OBJ geometry).
//
// The GLB names in the file are the mesh's `name` field — no `.obj`
// suffix.  Callers should strip `.obj` before look-up. Special case:
// the body mesh is named `pc_body` in the GLB but legacy code asks
// for `man.obj` — handle that alias here so existing call sites
// (character creator, brawl spawn, lobby spawn) keep working.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const GLB_URL_PATH = '/api/static/models/sr1world.glb';

function apiBase() {
  const env = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || '';
  return env.replace(/\/$/, '');
}

// Aliases legacy code may pass — strip `.obj`, then map.  Keep the
// table tight; missing assets just return null and the caller falls
// back to the procedural mesh.
const NAME_ALIAS = {
  man: 'pc_body',
};

let _glbPromise = null;
const _meshTemplates = new Map();  // name -> Mesh (cached, never returned directly)
const _geomCache = new Map();      // name -> BufferGeometry (world-aligned, indexed)

/** Kick off the GLB download (idempotent). Returns a promise that
 *  resolves once `_meshTemplates` is populated. */
export function ensureGlb() {
  if (_glbPromise) return _glbPromise;
  const url = `${apiBase()}${GLB_URL_PATH}`;
  const loader = new GLTFLoader();
  _glbPromise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          // The same name may appear multiple times (e.g. `pc_body`
          // and `pc_body.001`). Prefer the FIRST one we see — the
          // suffix-less version is the canonical asset.
          const name = o.name;
          if (!name) return;
          if (_meshTemplates.has(name)) return;
          _meshTemplates.set(name, o);
        });
        if (typeof console !== 'undefined') {
          console.info(`[brawl3d] sr1world.glb loaded — ${_meshTemplates.size} assets indexed`);
        }
        resolve();
      },
      undefined,
      (err) => {
        if (typeof console !== 'undefined') console.warn('[brawl3d] GLB load failed:', err);
        // Don't keep the failed promise — let the next caller retry
        // (transient ingress 429s during preview rebuilds).
        _glbPromise = null;
        reject(err);
      },
    );
  });
  return _glbPromise;
}

/** Resolve an OBJ-style filename (`cs_bat.obj`) or bare GLB name
 *  (`pc_body`) to the cached template Mesh, or null. */
function resolveTemplate(name) {
  if (!name) return null;
  let key = name.replace(/\.obj$/i, '').replace(/\.glb$/i, '');
  if (NAME_ALIAS[key]) key = NAME_ALIAS[key];
  return _meshTemplates.get(key) || null;
}

/** Returns true after `ensureGlb()` finishes successfully. */
export function isGlbReady() {
  return _meshTemplates.size > 0;
}

/** Resolve a name → cloned BufferGeometry. For BODY / CLOTHING assets
 *  the node's world-matrix is baked into the vertices (so the geometry
 *  is in THREE Y-up space matching the legacy OBJ exports). For WEAPON
 *  assets the raw local geometry is returned UNBAKED — the user's GLB
 *  exports authored the weapons in OBJ-compatible orientation already,
 *  so applying the node's 90° X rotation would re-orient them and
 *  break the existing weapon-mount math in characterModel3d.js. */
const WEAPON_NAMES = new Set([
  'cs_bat', 'cs_ak47', 'cs_pumpshotgun', 'cs_tech9',
  'p_glock21c', 'p_tec9b', 'p_rpg', 'hand_grenade',
  'cs_slidepistol', 'p_mac_10', 'p_mac_10mag', 'p_dblb_shotgun',
  'p_sniper', 'p_m32', 'p_m32mag', 'p_brassknuckles',
  'p_tire_iron', 'cs_switchblade', 'olcane', 'pimpcane',
]);

export function getGlbGeometry(name) {
  const tpl = resolveTemplate(name);
  if (!tpl) return null;
  const key = tpl.name;
  if (_geomCache.has(key)) return _geomCache.get(key).clone();
  const g = tpl.geometry.clone();
  // Weapons: bypass the world-matrix bake (their raw local space is
  // OBJ-compatible; the node rotation in the GLB only re-orients the
  // model for Blender preview). Bodies / clothing DO need the bake to
  // convert Blender Z-up into THREE Y-up.
  const isWeapon = WEAPON_NAMES.has(key);
  if (!isWeapon) {
    tpl.updateMatrixWorld(true);
    g.applyMatrix4(tpl.matrixWorld);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  _geomCache.set(key, g);
  return g.clone();
}

/** Return the asset's bounding box (without mutating any cache). */
export function getGlbBounds(name) {
  const g = getGlbGeometry(name);
  if (!g) return null;
  g.computeBoundingBox();
  return g.boundingBox;
}

/** Full list of indexed GLB asset names — useful for the character
 *  builder's clothing pickers so they only offer assets that actually
 *  exist in the shipped GLB. */
export function listGlbAssets() {
  return Array.from(_meshTemplates.keys()).sort();
}
