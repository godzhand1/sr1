// customMapsCache.js — small in-memory cache of published custom
// maps + the currently-loading map document. Every part of the
// engine that needs a custom map (effMap resolver, map picker, MapEditor)
// reads from here instead of hitting the API on every remount.
//
// The published-list cache is populated on first read and refreshed
// on `sr:custom-maps-changed` events (fired by the editor after
// save/publish/delete). Individual map docs are fetched on demand
// and cached for the session.

const listUrl = () => {
  const base = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || '';
  return `${base}/api/mapedit/maps`;
};
const mapUrl = (id) => `${listUrl()}/${id}`;

let _listCache = null;      // { maps, count, can_edit } or null
let _listInflight = null;
const _docCache = new Map(); // id -> full doc

export function invalidateCache() {
  _listCache = null;
  _docCache.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sr:custom-maps-changed'));
  }
}

function _authHeaders() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const t = window.localStorage.getItem('sr_community_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

export async function fetchCustomMapList() {
  if (_listCache) return _listCache;
  if (_listInflight) return _listInflight;
  _listInflight = fetch(listUrl(), { headers: _authHeaders() })
    .then((r) => r.ok ? r.json() : { maps: [], count: 0, can_edit: false })
    .then((data) => {
      _listCache = data || { maps: [], count: 0, can_edit: false };
      _listInflight = null;
      return _listCache;
    })
    .catch(() => {
      _listCache = { maps: [], count: 0, can_edit: false };
      _listInflight = null;
      return _listCache;
    });
  return _listInflight;
}

export function getCachedCustomMapList() {
  return _listCache;
}

export async function fetchCustomMap(id) {
  if (_docCache.has(id)) return _docCache.get(id);
  return fetchCustomMapFresh(id);
}

// Bypass the doc cache (used while polling a background collision bake).
export async function fetchCustomMapFresh(id) {
  const res = await fetch(mapUrl(id), { headers: _authHeaders() });
  if (!res.ok) throw new Error(`Custom map ${id} not found (${res.status})`);
  const doc = await res.json();
  _docCache.set(id, doc);
  return doc;
}

// Preloaded doc for the CURRENT match — set by the effMap resolver
// as soon as we know which custom map the round will spawn on, so
// the engine can call buildCustomMap(scene, doc) synchronously
// without awaiting inside the init effect.
let _preloadedForRound = null;
export function preloadCustomMap(id) {
  if (!id) { _preloadedForRound = null; return Promise.resolve(null); }
  return fetchCustomMap(id).then((d) => { _preloadedForRound = d; return d; });
}
export function getPreloadedRoundMap() { return _preloadedForRound; }

// In-memory preview override (iter160) — used by MapEditor3D to
// launch a solo bot match on the CURRENT unsaved doc without
// hitting the API. The game reads this from `getPreloadedRoundMap()`
// when the effective map id is `custom_preview`. The doc is a
// live-reference — the editor updates in-memory don't propagate
// after the preview starts (each preview launch stashes a fresh
// snapshot), which is the desired behaviour: preview freezes the
// current state, editing further doesn't affect the running match.
//
// We also seed `_docCache` under the id 'custom_preview' so any
// `fetchCustomMap('custom_preview')` call (label resolver, prematch
// card, preloadCustomMap chain) short-circuits to the in-memory doc
// instead of a 404-generating HTTP round trip.
export function setPreviewMap(doc) {
  _preloadedForRound = doc;
  _docCache.set('custom_preview', doc);
}
// QA hook: lets automation stash a preview doc without the editor UI.
if (typeof window !== 'undefined') window.__srSetPreviewMap = setPreviewMap;
export function clearPreviewMap() {
  _preloadedForRound = null;
  _docCache.delete('custom_preview');
}

// Save + Publish + Delete ─────────────────────────────────────────
export async function createCustomMap(payload) {
  const res = await fetch(listUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create failed (${res.status}): ${await res.text().catch(() => '')}`);
  const j = await res.json();
  invalidateCache();
  return j;
}

export async function saveCustomMap(id, payload) {
  const res = await fetch(mapUrl(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text().catch(() => '')}`);
  const j = await res.json();
  // Fresh copy — invalidate so the next fetch pulls the updated doc.
  _docCache.delete(id);
  invalidateCache();
  return j;
}

export async function publishCustomMap(id) {
  const res = await fetch(`${mapUrl(id)}/publish`, {
    method: 'POST',
    headers: _authHeaders(),
  });
  if (!res.ok) throw new Error(`Publish failed (${res.status}): ${await res.text().catch(() => '')}`);
  invalidateCache();
  return res.json();
}

export async function unpublishCustomMap(id) {
  const res = await fetch(`${mapUrl(id)}/unpublish`, {
    method: 'POST',
    headers: _authHeaders(),
  });
  if (!res.ok) throw new Error(`Unpublish failed (${res.status}): ${await res.text().catch(() => '')}`);
  invalidateCache();
  return res.json();
}

export async function deleteCustomMap(id) {
  const res = await fetch(mapUrl(id), { method: 'DELETE', headers: _authHeaders() });
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text().catch(() => '')}`);
  _docCache.delete(id);
  invalidateCache();
  return res.json();
}
