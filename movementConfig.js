// movementConfig.js — ONE live tuning object for player locomotion.
//
// The engine reads `MOVE.*` every frame, so edits from the Movement Lab
// change the feel instantly. Resolution order: server global (admin-set)
// → local preview override (localStorage) → live edits. Keep the field
// table in sync with backend/brawl_settings_routes.py.
const LS_KEY = 'sr_brawl_movement_override';

export const MOVEMENT_DEFAULTS = Object.freeze({
  walk: 3.2, jog: 7.4, sprint: 12.4, crouch: 3.4,
  accel: 16, sprintAccel: 24, sprintStartSpeed: 8.8,
  staminaDrain: 26, staminaTapDrain: 12, staminaRegen: 9, staminaLock: 2.5, sprintMinStart: 20,
  tapWindow: 0.75, tapPerfectWindow: 0.22, tapCost: 5, tapPerfectCost: 1.5, tapCooldown: 0.18,
  burstMul: 1.22, burstDur: 0.42, chainCap: 3, chainBonus: 0.03,
  jumpV: 8.4, gravity: -22, botSpeed: 0.92,
});

// UI metadata for the Movement Lab sliders.
export const MOVEMENT_FIELDS = [
  { key: 'walk', group: 'SPEED', label: 'Walk speed', min: 1, max: 8, step: 0.1, unit: 'm/s' },
  { key: 'jog', group: 'SPEED', label: 'Jog speed (default)', min: 3, max: 14, step: 0.1, unit: 'm/s' },
  { key: 'sprint', group: 'SPEED', label: 'Sprint top speed', min: 6, max: 22, step: 0.1, unit: 'm/s' },
  { key: 'crouch', group: 'SPEED', label: 'Crouch speed', min: 1, max: 8, step: 0.1, unit: 'm/s' },
  { key: 'botSpeed', group: 'SPEED', label: 'Bot speed (× jog)', min: 0.3, max: 1.6, step: 0.01, unit: '×' },
  { key: 'accel', group: 'ACCELERATION', label: 'Ground acceleration', min: 4, max: 40, step: 0.5, unit: '/s' },
  { key: 'sprintAccel', group: 'ACCELERATION', label: 'Sprint acceleration', min: 4, max: 60, step: 0.5, unit: '/s' },
  { key: 'sprintStartSpeed', group: 'ACCELERATION', label: 'Sprint launch speed (min speed the moment sprint starts)', min: 0, max: 16, step: 0.1, unit: 'm/s' },
  { key: 'staminaDrain', group: 'STAMINA', label: 'Hold-sprint drain', min: 0, max: 80, step: 0.5, unit: '/s' },
  { key: 'staminaTapDrain', group: 'STAMINA', label: 'Tap-sprint drain', min: 0, max: 60, step: 0.5, unit: '/s' },
  { key: 'staminaRegen', group: 'STAMINA', label: 'Regen', min: 0, max: 40, step: 0.5, unit: '/s' },
  { key: 'staminaLock', group: 'STAMINA', label: 'Exhausted lockout', min: 0, max: 8, step: 0.1, unit: 's' },
  { key: 'sprintMinStart', group: 'STAMINA', label: 'Stamina needed to sprint again after running dry', min: 0, max: 60, step: 1, unit: '' },
  { key: 'tapWindow', group: 'RHYTHM SPRINT', label: 'Tap keeps you sprinting for', min: 0.2, max: 2, step: 0.01, unit: 's' },
  { key: 'tapPerfectWindow', group: 'RHYTHM SPRINT', label: 'PERFECT window (last … s of the tap)', min: 0.05, max: 0.6, step: 0.01, unit: 's' },
  { key: 'tapCost', group: 'RHYTHM SPRINT', label: 'Stamina per tap', min: 0, max: 30, step: 0.5, unit: '' },
  { key: 'tapPerfectCost', group: 'RHYTHM SPRINT', label: 'Stamina per PERFECT tap', min: 0, max: 30, step: 0.5, unit: '' },
  { key: 'tapCooldown', group: 'RHYTHM SPRINT', label: 'Tap cooldown (anti-spam)', min: 0, max: 1, step: 0.01, unit: 's' },
  { key: 'burstMul', group: 'RHYTHM SPRINT', label: 'PERFECT burst speed', min: 1, max: 1.8, step: 0.01, unit: '×' },
  { key: 'burstDur', group: 'RHYTHM SPRINT', label: 'Burst duration', min: 0.05, max: 1.5, step: 0.01, unit: 's' },
  { key: 'chainCap', group: 'RHYTHM SPRINT', label: 'Max chain', min: 0, max: 10, step: 1, unit: '' },
  { key: 'chainBonus', group: 'RHYTHM SPRINT', label: 'Top-speed bonus per chain link', min: 0, max: 0.15, step: 0.005, unit: '×' },
  { key: 'jumpV', group: 'JUMP', label: 'Jump velocity', min: 3, max: 16, step: 0.1, unit: 'm/s' },
  { key: 'gravity', group: 'JUMP', label: 'Gravity', min: -60, max: -5, step: 0.5, unit: 'm/s²' },
];

// Live object the engine reads. Mutated in place so held references stay valid.
export const MOVE = { ...MOVEMENT_DEFAULTS };

let serverConfig = { ...MOVEMENT_DEFAULTS };
let serverMeta = { can_edit: false, updated_at: null, updated_by: null };
const listeners = new Set();

const clean = (partial) => {
  const out = {};
  for (const f of MOVEMENT_FIELDS) {
    const v = partial && partial[f.key];
    if (v == null || !Number.isFinite(+v)) continue;
    out[f.key] = Math.max(f.min, Math.min(f.max, +v));
  }
  return out;
};

export function readLocalOverride() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? clean(JSON.parse(raw)) : null; } catch { return null; }
}

function recompute() {
  const local = readLocalOverride();
  Object.assign(MOVE, MOVEMENT_DEFAULTS, serverConfig, local || {});
  for (const fn of listeners) fn({ ...MOVE });
}

export function onMovementChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getMovementSnapshot() { return { ...MOVE }; }
export function getServerMovement() { return { config: { ...serverConfig }, ...serverMeta }; }

// Live edit — applied immediately AND persisted as the local preview override.
export function setLocalMovement(partial, { persist = true } = {}) {
  const next = { ...(readLocalOverride() || {}), ...clean(partial) };
  if (persist) { try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* private mode */ } }
  recompute();
  return { ...MOVE };
}

export function clearLocalMovement() {
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  recompute();
}

function authHeaders() {
  const tok = (typeof localStorage !== 'undefined') && localStorage.getItem('sr_community_token');
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

// Pull the admin-set global config. Safe to call often; failures keep defaults.
export async function loadMovementConfig() {
  const base = process.env.REACT_APP_BACKEND_URL;
  try {
    const r = await fetch(`${base}/api/brawl/movement`, { headers: authHeaders() });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    serverConfig = clean(j.config || {});
    serverMeta = { can_edit: !!j.can_edit, updated_at: j.updated_at || null, updated_by: j.updated_by || null };
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[movement] using defaults —', err.message);
  }
  recompute();
  return getServerMovement();
}

// Admin: publish the CURRENT live values as the server-wide config.
export async function saveGlobalMovement(config = MOVE) {
  const base = process.env.REACT_APP_BACKEND_URL;
  const r = await fetch(`${base}/api/brawl/movement`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ config: clean(config) }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || `HTTP ${r.status}`); }
  const j = await r.json();
  serverConfig = clean(j.config || {});
  serverMeta = { ...serverMeta, updated_at: j.updated_at || null, updated_by: j.updated_by || null };
  clearLocalMovement();
  return getServerMovement();
}

export async function resetGlobalMovement() {
  const base = process.env.REACT_APP_BACKEND_URL;
  const r = await fetch(`${base}/api/brawl/movement`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || `HTTP ${r.status}`); }
  serverConfig = { ...MOVEMENT_DEFAULTS };
  clearLocalMovement();
  return getServerMovement();
}

// ── Rhythm-sprint rule (pure, unit-tested) ─────────────────────────
// Called on a sprint TAP edge. `m` is the player record; mutates stamina,
// tap window, chain, burst and the HUD flash. Returns the tap verdict.
export function applySprintTap(m, MC = MOVE) {
  if ((m.sprintTapCd || 0) > 0) return 'cooldown';
  const remaining = m.sprintTapT || 0;
  const perfect = remaining > 0 && remaining <= MC.tapPerfectWindow;
  const verdict = perfect ? 'perfect' : (remaining > 0 ? 'early' : 'fresh');
  const cost = perfect ? MC.tapPerfectCost : MC.tapCost;
  if ((m.stamina || 0) <= 0) return 'exhausted';
  m.stamina = Math.max(0, m.stamina - cost);
  m.sprintTapT = MC.tapWindow;
  m.sprintTapCd = MC.tapCooldown;
  if (perfect) {
    m.sprintChain = Math.min(MC.chainCap | 0, (m.sprintChain || 0) + 1);
    m.sprintBurstT = MC.burstDur;
    m.sprintPerfectT = 0.7;
  } else {
    m.sprintChain = 0;          // spam (early) or a cold start breaks the chain
  }
  return verdict;
}

// Effective sprint top speed for this frame.
export function sprintSpeedFor(m, MC = MOVE) {
  const chain = Math.min(MC.chainCap | 0, m.sprintChain || 0);
  const burst = (m.sprintBurstT || 0) > 0 ? MC.burstMul : 1;
  return MC.sprint * (1 + chain * MC.chainBonus) * burst;
}
