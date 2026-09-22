// weaponOffsets.js — global per-weapon calibration for grip, trigger,
// barrel-end, rotation, scale, and two-handed flag. Every gun-mount
// on every character reads this map at bake time so a single tuning
// session in Weapon Lab dials in the hold for all players
// simultaneously.
//
// Data shape:
//   {
//     [weaponId]: {
//       grip:      [x, y, z],   // grip point (metres, gunMount-local)
//       trigger:   [x, y, z],   // trigger point (metres, gunMount-local)
//       barrelEnd: [x, y, z],   // muzzle (metres, gunMount-local)
//       rotation:  [x, y, z],   // Euler radians (weapon mesh)
//       scale:     [x, y, z],   // per-axis multiplier (1 = no change)
//       twoHanded: false,       // front-hand IK / L-hand grip
//     }
//   }
//
// Persistence layering:
//   1. `DEFAULT_WEAPON_OFFSETS` (shipped baseline, this file)
//   2. `_serverGlobals` (fetched from /api/weapon/offsets on boot)
//   3. `localStorage['sr:weaponOffsets']` (this user's in-progress
//      tweaks — layered ON TOP so a live edit isn't stomped by a
//      server publish mid-session)
//
// Mirrors `clothingOffsets.js` architecture exactly for consistency.

const STORE_KEY = 'sr:weaponOffsets';

// Baked-in tuning that ships with the app. Populate via Weapon Lab
// → Export JSON. Missing weapons fall back to IDENTITY_OFFSET.
const DEFAULT_WEAPON_OFFSETS = {
  // Placeholder — populate via Weapon Lab → Export JSON.
};

export const IDENTITY_OFFSET = Object.freeze({
  grip:      [0, 0, 0],
  trigger:   [0, 0, 0],
  barrelEnd: [0, 0, 0.3],       // most weapons put the muzzle ~30 cm along +Z from mount origin
  rotation:  [0, 0, 0],
  scale:     [1, 1, 1],
  twoHanded: false,
});

let _serverGlobals = {};
let _serverLoaded = false;
let _serverInflight = null;

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
  const merged = {};
  for (const k of Object.keys(DEFAULT_WEAPON_OFFSETS)) merged[k] = { ...DEFAULT_WEAPON_OFFSETS[k] };
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

// Return true if the weapon has ANY saved calibration (default OR
// server OR local). Used to decide whether to trust the `twoHanded`
// flag on the offset, or fall back to the weapon-category default.
export function hasWeaponOffset(weaponId) {
  if (!weaponId) return false;
  const cache = _ensureCache();
  return !!cache[weaponId];
}

// Get the calibrated offset for a weapon id. Returns a shallow clone
// so callers can safely destructure without mutating the cache.
export function getWeaponOffset(weaponId) {
  if (!weaponId) return { ...IDENTITY_OFFSET };
  const cache = _ensureCache();
  const entry = cache[weaponId];
  if (!entry) return { ...IDENTITY_OFFSET };
  return {
    grip:      entry.grip      || IDENTITY_OFFSET.grip,
    trigger:   entry.trigger   || IDENTITY_OFFSET.trigger,
    barrelEnd: entry.barrelEnd || IDENTITY_OFFSET.barrelEnd,
    rotation:  entry.rotation  || IDENTITY_OFFSET.rotation,
    scale:     entry.scale     || IDENTITY_OFFSET.scale,
    twoHanded: (typeof entry.twoHanded === 'boolean') ? entry.twoHanded : IDENTITY_OFFSET.twoHanded,
  };
}

// Set / merge an offset for a given weapon. Persists to localStorage
// and dispatches `sr:weapon-offset-changed` so any live-preview scene
// can rebuild the weapon mount.
export function setWeaponOffset(weaponId, patch) {
  if (!weaponId) return;
  const cache = _ensureCache();
  const cur = cache[weaponId] || { ...IDENTITY_OFFSET };
  const next = {
    grip:      patch.grip      || cur.grip,
    trigger:   patch.trigger   || cur.trigger,
    barrelEnd: patch.barrelEnd || cur.barrelEnd,
    rotation:  patch.rotation  || cur.rotation,
    scale:     patch.scale     || cur.scale,
    twoHanded: (typeof patch.twoHanded === 'boolean') ? patch.twoHanded : cur.twoHanded,
  };
  cache[weaponId] = next;
  _saveToStore(_diffFromDefaults(cache));
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sr:weapon-offset-changed', { detail: { weaponId } }));
    }
  } catch { /* */ }
}

// Reset a weapon back to the shipped default (or identity).
export function resetWeaponOffset(weaponId) {
  if (!weaponId) return;
  const cache = _ensureCache();
  if (DEFAULT_WEAPON_OFFSETS[weaponId]) {
    cache[weaponId] = { ...IDENTITY_OFFSET, ...DEFAULT_WEAPON_OFFSETS[weaponId] };
  } else {
    delete cache[weaponId];
  }
  _saveToStore(_diffFromDefaults(cache));
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sr:weapon-offset-changed', { detail: { weaponId } }));
    }
  } catch { /* */ }
}

// Return current cache as diff-from-identity snapshot. Used by Weapon
// Lab's Export JSON + Save-for-Everyone buttons.
export function snapshotWeaponOffsets() {
  const cache = _ensureCache();
  return _diffFromDefaults(cache);
}

function _diffFromDefaults(cache) {
  const out = {};
  for (const k of Object.keys(cache)) {
    const v = cache[k];
    const isIdentity =
      _eqArr(v.grip      || IDENTITY_OFFSET.grip,      IDENTITY_OFFSET.grip)      &&
      _eqArr(v.trigger   || IDENTITY_OFFSET.trigger,   IDENTITY_OFFSET.trigger)   &&
      _eqArr(v.barrelEnd || IDENTITY_OFFSET.barrelEnd, IDENTITY_OFFSET.barrelEnd) &&
      _eqArr(v.rotation  || IDENTITY_OFFSET.rotation,  IDENTITY_OFFSET.rotation)  &&
      _eqArr(v.scale     || IDENTITY_OFFSET.scale,     IDENTITY_OFFSET.scale)     &&
      (!!v.twoHanded === !!IDENTITY_OFFSET.twoHanded);
    if (isIdentity) continue;
    out[k] = {
      grip:      [...(v.grip      || IDENTITY_OFFSET.grip)],
      trigger:   [...(v.trigger   || IDENTITY_OFFSET.trigger)],
      barrelEnd: [...(v.barrelEnd || IDENTITY_OFFSET.barrelEnd)],
      rotation:  [...(v.rotation  || IDENTITY_OFFSET.rotation)],
      scale:     [...(v.scale     || IDENTITY_OFFSET.scale)],
      twoHanded: !!v.twoHanded,
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
// Every gun-mount loader calls `fetchServerWeaponOffsets()` once at
// boot. Idempotent; single-flight semantics.
export function fetchServerWeaponOffsets() {
  if (_serverLoaded) return Promise.resolve(_serverGlobals);
  if (_serverInflight) return _serverInflight;
  const url = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL)
    ? `${process.env.REACT_APP_BACKEND_URL}/api/weapon/offsets`
    : '/api/weapon/offsets';
  _serverInflight = fetch(url, { credentials: 'omit' })
    .then((r) => r.ok ? r.json() : { offsets: {} })
    .then((data) => {
      _serverGlobals = (data && data.offsets) ? data.offsets : {};
      _serverLoaded = true;
      _memCache = null;
      _serverInflight = null;
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sr:weapon-offset-changed', {
            detail: { weaponId: null, source: 'server' },
          }));
        }
      } catch { /* */ }
      return _serverGlobals;
    })
    .catch((err) => {
      if (typeof console !== 'undefined') console.warn('[weaponOffsets] server fetch failed:', err);
      _serverLoaded = true;
      _serverInflight = null;
      return {};
    });
  return _serverInflight;
}

// Admin publish. Requires `Authorization: Bearer <admin-token>` — same
// token used by clothing publish (community_users.session_token where
// is_admin=true).
export async function saveAllWeaponOffsetsToServer(adminToken) {
  if (!adminToken) throw new Error('Missing admin token');
  const url = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL)
    ? `${process.env.REACT_APP_BACKEND_URL}/api/weapon/offsets`
    : '/api/weapon/offsets';
  const snap = snapshotWeaponOffsets();
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
  _serverGlobals = { ...snap };
  _memCache = null;
  return result;
}
