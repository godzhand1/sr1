// pbrLibrary.js — Principled-BSDF style material sets for the arena.
//
// The backend (`/api/mapedit/pbr/materials`) holds the library: albedo /
// normal / ORM (occlusion-roughness-metallic) / height maps + tiling and
// parallax params. This module loads the catalogue once, caches the GPU
// textures by URL, and turns a doc reference
//   o.pbr = { materialId, tile?, triplanar?: 'auto'|'on'|'off',
//             parallax?: { enabled, scale, steps }, normalScale? }
// into a MeshStandardMaterial — world-space triplanar + parallax on big
// surfaces, plain UV tiling on small props. Materials are also tagged
// (`userData.srPbr`) so the GLB export carries the same settings into
// Blender as glTF extras.
import * as THREE from 'three';
import { patchTriplanar, updateTriplanar } from './triplanarPbr.js';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const TRIPLANAR_AUTO_MIN = 6;          // metres — bigger than this → triplanar

let _catalog = null;                    // Map<id, def>
let _loading = null;
const _subs = new Set();
const _texCache = new Map();
const _loader = new THREE.TextureLoader();
_loader.setCrossOrigin('anonymous');

export function absUrl(u) {
  if (!u) return u;
  return /^https?:\/\//.test(u) ? u : `${BACKEND}${u}`;
}

export function loadPbrLibrary(force = false) {
  if (_catalog && !force) return Promise.resolve(_catalog);
  if (_loading && !force) return _loading;
  _loading = fetch(`${BACKEND}/api/mapedit/pbr/materials`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pbr library ${r.status}`))))
    .then((j) => {
      _catalog = new Map((j.materials || []).map((m) => [m.id, m]));
      _subs.forEach((cb) => { try { cb(_catalog); } catch (_) { /* ignore */ } });
      return _catalog;
    })
    .catch((err) => {
      if (typeof console !== 'undefined') console.warn('[pbr] library load failed', err);
      _catalog = _catalog || new Map();
      return _catalog;
    })
    .finally(() => { _loading = null; });
  return _loading;
}

export function getPbrDef(id) { return (_catalog && id) ? _catalog.get(id) || null : null; }
export function getPbrCatalog() { return _catalog ? Array.from(_catalog.values()) : []; }
export function subscribePbr(cb) { _subs.add(cb); return () => _subs.delete(cb); }
export function _setCatalogForTests(list) { _catalog = new Map(list.map((m) => [m.id, m])); }

const _pending = new Set();
// Resolves once every library texture requested so far has loaded (or
// failed) — the GLB exporter needs real pixels to embed.
export function whenPbrTexturesReady(timeoutMs = 20000) {
  if (!_pending.size) return Promise.resolve();
  return Promise.race([
    Promise.all([..._pending]),
    new Promise((res) => setTimeout(res, timeoutMs)),
  ]);
}

function tex(url, { srgb = false } = {}) {
  if (!url) return null;
  const key = `${url}|${srgb ? 's' : 'l'}`;
  if (_texCache.has(key)) return _texCache.get(key);
  let done;
  const p = new Promise((res) => { done = res; });
  _pending.add(p);
  const settle = () => { _pending.delete(p); done(); };
  const t = _loader.load(absUrl(url), settle, undefined, settle);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.channel = 0;
  _texCache.set(key, t);
  return t;
}

// Resolve the effective settings for an object reference against the
// library def. `size` = { w, h, d } of the surface (metres).
export function resolvePbrSettings(ref, def, size = {}) {
  const p = def?.params || {};
  const tile = Math.max(0.1, ref?.tile ?? p.tile ?? 2);
  const biggest = Math.max(size.w || 0, size.h || 0, size.d || 0);
  const mode = ref?.triplanar || 'auto';
  const triplanar = mode === 'on' || (mode === 'auto' && biggest >= TRIPLANAR_AUTO_MIN);
  const parDef = p.parallax || { scale: 0.03, steps: 12 };
  const parRef = ref?.parallax || {};
  const parallaxEnabled = parRef.enabled != null ? !!parRef.enabled : triplanar && biggest >= TRIPLANAR_AUTO_MIN * 2;
  return {
    tile,
    triplanar,
    sharpness: p.triplanar?.sharpness ?? 4,
    normalScale: ref?.normalScale ?? p.normalScale ?? 1,
    aoIntensity: p.aoIntensity ?? 1,
    roughness: p.roughness ?? 1,
    metalness: p.metalness ?? 0,
    parallax: { enabled: parallaxEnabled && triplanar, scale: parRef.scale ?? parDef.scale ?? 0.03, steps: parRef.steps ?? parDef.steps ?? 12 },
  };
}

// Apply a library def onto an existing MeshStandardMaterial (idempotent —
// used both at build time and when the catalogue arrives late).
export function applyPbrDef(mat, def, ref = {}, size = {}) {
  if (!def) return mat;
  const s = resolvePbrSettings(ref, def, size);
  mat.name = `SR_${(def.name || def.id).replace(/[^a-z0-9]+/gi, '_')}`;
  const maps = def.maps || {};
  mat.map = tex(maps.albedo, { srgb: true });
  mat.normalMap = tex(maps.normal);
  const orm = tex(maps.orm);
  mat.roughnessMap = orm;
  mat.metalnessMap = orm;
  mat.aoMap = orm;
  mat.roughness = s.roughness;
  mat.metalness = s.metalness;
  mat.aoMapIntensity = s.aoIntensity;
  mat.normalScale = new THREE.Vector2(s.normalScale, s.normalScale);
  mat.envMapIntensity = def.preset === 'metal' ? 1.0 : 0.6;
  if (s.triplanar) {
    patchTriplanar(mat, {
      tile: s.tile, sharpness: s.sharpness, normalScale: s.normalScale,
      parallax: s.parallax.enabled ? s.parallax : null,
      heightMap: s.parallax.enabled ? tex(maps.height) : null,
    });
  } else {
    // UV path — repeat by the two dominant face dimensions.
    const dims = [size.w || 1, size.h || 1, size.d || 1].sort((a, b) => b - a);
    const rx = Math.max(1, Math.round(dims[0] / s.tile)), ry = Math.max(1, Math.round(dims[1] / s.tile));
    for (const t of [mat.map, mat.normalMap, orm]) if (t) t.repeat.set(rx, ry);
  }
  mat.userData.sr_pbr = {
    materialId: def.id, name: def.name, preset: def.preset, tile: s.tile,
    triplanar: { enabled: s.triplanar, sharpness: s.sharpness },
    parallax: { enabled: s.parallax.enabled, scale: s.parallax.scale, steps: s.parallax.steps },
    normalScale: s.normalScale, aoIntensity: s.aoIntensity,
    height: absUrl(maps.height), maps: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, absUrl(v)])),
  };
  mat.needsUpdate = true;
  return mat;
}

// Build a material for a doc object. Returns the material immediately;
// if the catalogue hasn't arrived yet the maps are attached when it does.
export function createPbrMaterial(ref, size = {}, base = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(base.color || '#ffffff'),
    transparent: !!base.transparent,
    opacity: base.opacity ?? 1,
    roughness: 0.85,
    metalness: 0,
  });
  const def = getPbrDef(ref?.materialId);
  if (def) return applyPbrDef(mat, def, ref, size);
  const off = subscribePbr((cat) => {
    const d = cat.get(ref?.materialId);
    if (d) { applyPbrDef(mat, d, ref, size); off(); }
  });
  loadPbrLibrary();
  return mat;
}

export function tweakPbrMaterial(mat, opts) { return updateTriplanar(mat, opts); }

// Is a material worth exporting as PBR (has an sr tag)?
export function pbrExtrasOf(mat) { return mat?.userData?.sr_pbr || null; }
