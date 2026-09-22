// Team Gangsta Brawl — AI-generated 4K texture pack loader.
//
// The backend (`/api/brawl3d/textures/...`) generates a curated set of
// seamless tileable PNGs via Gemini Nano Banana. This module loads them
// once at module-init and exposes synchronous `getTexture(slug)` lookups
// that the arena builders consume. Until the textures finish loading
// (or if the backend hasn't generated them yet), `getTexture` returns
// `null` so callers can fall back to their old canvas-procedural
// textures — no blocking, no late-rendered map.
//
// Public API:
//   • preloadTextures()        → kicks off the fetch + load. Idempotent.
//   • getTexture(slug)         → THREE.Texture or null.
//   • getTextureSet()          → { slug → THREE.Texture | null }.
//   • subscribe(cb)            → cb(set) called every time a texture
//                                finishes loading; returns unsubscribe.

import * as THREE from 'three';

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const STATUS_URL = `${BACKEND}/api/brawl3d/textures/list`;

const SLUGS = [
  'asphalt_road',
  'concrete_sidewalk',
  'rusty_metal_panel',
  'graffiti_decal_sheet',
  // Per-building facade variants — every building in the city pulls a
  // different texture from this set.
  'facade_brick_apartments',
  'facade_office_glass',
  'facade_warehouse_metal',
  'facade_stucco_shop',
  'facade_painted_brick',
  'facade_dark_brownstone',
  // Sky + lobby-only textures.
  'sunset_sky',
  'warehouse_concrete_floor',
];

// Public list used by the MapEditor3D texture picker.
export const TEXTURE_SLUGS = [...SLUGS];

export const FACADE_SLUGS = [
  'facade_brick_apartments',
  'facade_office_glass',
  'facade_warehouse_metal',
  'facade_stucco_shop',
  'facade_painted_brick',
  'facade_dark_brownstone',
];

const _textures = new Map();      // slug → THREE.Texture (loaded)
const _subscribers = new Set();
let _started = false;

const _loader = new THREE.TextureLoader();
_loader.setCrossOrigin('anonymous');

function _notify() {
  for (const cb of _subscribers) {
    try { cb(getTextureSet()); } catch { /* ignore */ }
  }
}

async function _checkAndLoad() {
  try {
    const r = await fetch(STATUS_URL);
    if (!r.ok) return;
    const status = await r.json();
    // Auto-trigger generation if the backend hasn't kicked one off yet.
    const allReady = SLUGS.every(s => status[s] && status[s].ready);
    if (!allReady) {
      try { await fetch(`${BACKEND}/api/brawl3d/textures/generate`, { method: 'POST' }); } catch { /* ignore */ }
    }
    for (const slug of SLUGS) {
      if (_textures.has(slug)) continue;
      const entry = status[slug];
      if (!entry || !entry.ready || !entry.url) continue;
      _loader.load(
        `${BACKEND}${entry.url}`,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          _textures.set(slug, t);
          _notify();
        },
        undefined,
        (err) => { console.warn(`[aiTextures] failed to load ${slug}:`, err); }
      );
    }
  } catch {
    /* network blip — caller will retry later via subscribe loop */
  }
}

export function preloadTextures() {
  if (_started) return;
  _started = true;
  _checkAndLoad();
  // Poll for late-generated textures (max ~2 min) every 5s. Stops
  // polling once everything is loaded.
  let attempts = 0;
  const iv = setInterval(() => {
    attempts += 1;
    if (_textures.size >= SLUGS.length || attempts > 24) {
      clearInterval(iv);
      return;
    }
    _checkAndLoad();
  }, 5000);
}

export function getTexture(slug) {
  return _textures.get(slug) || null;
}

// Resolves once every AI texture is resident, or after `timeoutMs`
// (generation can legitimately be missing on a fresh backend — the
// pre-match gate must not hang on it forever).
export function whenTexturesReady(timeoutMs = 20000) {
  preloadTextures();
  if (_textures.size >= SLUGS.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; off(); clearTimeout(tm); resolve(ok); };
    const off = subscribe(() => { if (_textures.size >= SLUGS.length) finish(true); });
    const tm = setTimeout(() => finish(false), timeoutMs);
  });
}

export function getTextureSet() {
  const out = {};
  for (const s of SLUGS) out[s] = _textures.get(s) || null;
  return out;
}

export function subscribe(cb) {
  _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

// Convenience helpers — return a CLONED texture so callers can set
// independent `.repeat` values without thrashing the shared texture.
export function cloneTexture(slug) {
  const t = _textures.get(slug);
  if (!t) return null;
  const c = t.clone();
  c.needsUpdate = true;
  return c;
}
