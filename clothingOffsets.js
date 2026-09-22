// clothingOffsets.js — global per-SR-asset transform + inflate
// calibration. Every clothing item on every character reads this map
// at bake time so a single tuning session in Clothing Lab dials in the
// fit for all players simultaneously.
//
// Data shape:
//   {
//     [assetId]: {
//       position: [x, y, z],   // additive translation (metres, SR bind space)
//       rotation: [x, y, z],   // Euler radians, applied before position
//       scale:    [x, y, z],   // multiplier per axis (1 = no change)
//       inflate:  0.02,        // extra radial puff (metres) for skinned body slots
//     }
//   }
//
// Persistence: `localStorage['sr:clothingOffsets']` for immediate
// iteration. Clothing Lab's "Export JSON" button prints a snapshot
// the developer can paste into `DEFAULT_CLOTHING_OFFSETS` below for
// permanent commit — that's the fallback all users see when they've
// never touched the editor.

const STORE_KEY = 'sr:clothingOffsets';

// Baked-in tuning that ships with the app. Keep this map small — every
// entry represents a global override baked from Clothing Lab's Export
// JSON output. Missing assets fall back to the neutral identity
// transform (zeros for pos/rot, 1s for scale, 0 for inflate).
const DEFAULT_CLOTHING_OFFSETS = {
  // Placeholder — populate via Clothing Lab → Export JSON.
};

// Global calibration fetched from the backend. Admin "Save for Everyone"
// posts to `/api/clothing/offsets`, every character loader fetches on
// boot. Layers OVER the shipped defaults but UNDER the user's own
// localStorage tweaks so a dev in the middle of iterating locally
// isn't stomped by a server-side publish mid-edit.
let _serverGlobals = {};
let _serverLoaded = false;
let _serverInflight = null;

export const IDENTITY_OFFSET = Object.freeze({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale:    [1, 1, 1],
  inflate:  0,
});

// In-memory cache. Loaded lazily on the first read so SSR / test
// environments without localStorage can still import this module.
let _memCache = null;

function _loadFromStore() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function _saveToStore(map) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

function _ensureCache() {
  if (_memCache) return _memCache;
  // Layering order (bottom → top):
  //   1. shipped `DEFAULT_CLOTHING_OFFSETS` (permanent baseline)
  //   2. server-published globals (fetched once at boot; admin publishes via
  //      "Save for Everyone" in Clothing Lab)
  //   3. this user's localStorage (their in-progress tweaks — never
  //      stomped by a server publish mid-edit)
  const merged = {};
  for (const k of Object.keys(DEFAULT_CLOTHING_OFFSETS)) merged[k] = { ...DEFAULT_CLOTHING_OFFSETS[k] };
  for (const k of Object.keys(_serverGlobals)) {
    const cur = merged[k] || {};
    merged[k] = { ...IDENTITY_OFFSET, ...cur, ..._serverGlobals[k] };
  }
  const store = _loadFromStore();
  for (const k of Object.keys(store)) {
    const cur = merged[k] || {};
    merged[k] = { ...IDENTITY_OFFSET, ...cur, ...store[k] };
  }
  _memCache = merged;
  return _memCache;
}

// Public API ─────────────────────────────────────────────────────────

// Get the calibrated offset for an SR asset ID. Returns a shallow
// clone so callers can safely destructure without mutating the cache.
// Missing IDs return IDENTITY_OFFSET.
export function getClothingOffset(assetId) {
  if (!assetId || assetId === 'none') return IDENTITY_OFFSET;
  const cache = _ensureCache();
  const entry = cache[assetId];
  if (!entry) return IDENTITY_OFFSET;
  return {
    position: entry.position || IDENTITY_OFFSET.position,
    rotation: entry.rotation || IDENTITY_OFFSET.rotation,
    scale:    entry.scale    || IDENTITY_OFFSET.scale,
    inflate:  (typeof entry.inflate === 'number') ? entry.inflate : IDENTITY_OFFSET.inflate,
  };
}

// Set / merge an offset for a given asset. Persists to localStorage
// and dispatches `sr:clothing-offset-changed` so any live-preview
// scene can rebuild the character mesh.
export function setClothingOffset(assetId, patch) {
  if (!assetId || assetId === 'none') return;
  const cache = _ensureCache();
  const cur = cache[assetId] || { ...IDENTITY_OFFSET };
  const next = {
    position: patch.position || cur.position,
    rotation: patch.rotation || cur.rotation,
    scale:    patch.scale    || cur.scale,
    inflate:  (typeof patch.inflate === 'number') ? patch.inflate : cur.inflate,
  };
  cache[assetId] = next;
  _saveToStore(_diffFromDefaults(cache));
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sr:clothing-offset-changed', { detail: { assetId } }));
    }
  } catch { /* CustomEvent unavailable in tests */ }
}

// Reset an asset back to the shipped default (or identity if there's
// no shipped default).
export function resetClothingOffset(assetId) {
  if (!assetId || assetId === 'none') return;
  const cache = _ensureCache();
  if (DEFAULT_CLOTHING_OFFSETS[assetId]) {
    cache[assetId] = { ...IDENTITY_OFFSET, ...DEFAULT_CLOTHING_OFFSETS[assetId] };
  } else {
    delete cache[assetId];
  }
  _saveToStore(_diffFromDefaults(cache));
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sr:clothing-offset-changed', { detail: { assetId } }));
    }
  } catch { /* */ }
}

// Return the current cache as an { assetId: entry } snapshot. Used by
// Clothing Lab's Export JSON button.
export function snapshotClothingOffsets() {
  const cache = _ensureCache();
  return _diffFromDefaults(cache);
}

// Only export entries that DIFFER from IDENTITY — keeps the export
// small and readable, and prevents identity-only entries from
// polluting the committed defaults file.
function _diffFromDefaults(cache) {
  const out = {};
  for (const k of Object.keys(cache)) {
    const v = cache[k];
    const isIdentity =
      _eqArr(v.position || IDENTITY_OFFSET.position, IDENTITY_OFFSET.position) &&
      _eqArr(v.rotation || IDENTITY_OFFSET.rotation, IDENTITY_OFFSET.rotation) &&
      _eqArr(v.scale    || IDENTITY_OFFSET.scale,    IDENTITY_OFFSET.scale)    &&
      (v.inflate === IDENTITY_OFFSET.inflate);
    if (isIdentity) continue;
    out[k] = {
      position: [...(v.position || IDENTITY_OFFSET.position)],
      rotation: [...(v.rotation || IDENTITY_OFFSET.rotation)],
      scale:    [...(v.scale    || IDENTITY_OFFSET.scale)],
      inflate:  v.inflate ?? IDENTITY_OFFSET.inflate,
    };
  }
  return out;
}

function _eqArr(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

// ── Server-published globals ─────────────────────────────────────────
// Every character loader calls `fetchServerOffsets()` once at boot.
// Result is cached in module memory. Idempotent — a second call
// returns the same promise while one is in flight, and resolves
// synchronously once the fetch has completed.
export function fetchServerOffsets() {
  if (_serverLoaded) return Promise.resolve(_serverGlobals);
  if (_serverInflight) return _serverInflight;
  const url = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL)
    ? `${process.env.REACT_APP_BACKEND_URL}/api/clothing/offsets`
    : '/api/clothing/offsets';
  _serverInflight = fetch(url, { credentials: 'omit' })
    .then((r) => r.ok ? r.json() : { offsets: {} })
    .then((data) => {
      _serverGlobals = (data && data.offsets) ? data.offsets : {};
      _serverLoaded = true;
      _memCache = null;                             // force re-merge with server globals on next read
      _serverInflight = null;
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sr:clothing-offset-changed', {
            detail: { assetId: null, source: 'server' },
          }));
        }
      } catch { /* */ }
      return _serverGlobals;
    })
    .catch((err) => {
      if (typeof console !== 'undefined') console.warn('[clothingOffsets] server fetch failed:', err);
      _serverLoaded = true;                         // don't retry on every rebuild — degrade to identity
      _serverInflight = null;
      return {};
    });
  return _serverInflight;
}

// Admin action — publish the current diff-from-identity snapshot to
// the backend so every user boots into the same calibration next
// time. Requires an admin `Authorization: Bearer <token>` header;
// pass the token stored in `localStorage.sr_community_token`.
export async function saveAllOffsetsToServer(adminToken) {
  if (!adminToken) throw new Error('Missing admin token');
  const url = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL)
    ? `${process.env.REACT_APP_BACKEND_URL}/api/clothing/offsets`
    : '/api/clothing/offsets';
  const snap = snapshotClothingOffsets();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ offsets: snap }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Save failed (${res.status}): ${text || res.statusText}`);
  }
  const result = await res.json();
  // Refresh server-globals cache so the local scene starts reading
  // from the just-published snapshot too (in case the dev clears their
  // localStorage next).
  _serverGlobals = { ...snap };
  _memCache = null;
  return result;
}
