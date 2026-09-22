// MovementLabPanel — live locomotion tuner (speeds, acceleration, stamina,
// rhythm-sprint timing, jump). Every slider writes straight into the live
// MOVE object so the change is felt on the very next frame. Anyone can
// tune locally (localStorage preview); admins/sysops can publish the
// values server-wide so every match on the server plays by them.
import React, { useEffect, useMemo, useState } from 'react';
import {
  MOVEMENT_DEFAULTS, MOVEMENT_FIELDS, getMovementSnapshot, getServerMovement,
  loadMovementConfig, setLocalMovement, clearLocalMovement, saveGlobalMovement, resetGlobalMovement,
  readLocalOverride, onMovementChange,
} from './movementConfig.js';

const GROUPS = ['SPEED', 'ACCELERATION', 'STAMINA', 'RHYTHM SPRINT', 'JUMP'];

const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(step < 0.01 ? 3 : 2));

function Row({ f, value, serverValue, onChange }) {
  const dirty = Math.abs(value - serverValue) > 1e-6;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_170px_64px] items-center gap-3 py-1.5 border-t border-white/5" data-testid={`movelab-row-${f.key}`}>
      <span className="min-w-0">
        <span className={`block text-[11px] tracking-wide ${dirty ? 'text-yellow-200' : 'text-white/80'}`}>{f.label}</span>
        <span className="block text-[9px] font-mono text-white/35">default {fmt(MOVEMENT_DEFAULTS[f.key], f.step)}{f.unit ? ` ${f.unit}` : ''} · server {fmt(serverValue, f.step)}</span>
      </span>
      <input
        type="range" min={f.min} max={f.max} step={f.step} value={value}
        onChange={(e) => onChange(f.key, +e.target.value)}
        className="accent-yellow-400 w-full"
        data-testid={`movelab-slider-${f.key}`}
      />
      <input
        type="number" min={f.min} max={f.max} step={f.step} value={fmt(value, f.step)}
        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange(f.key, v); }}
        className="w-full bg-black/50 border border-white/15 rounded px-1.5 py-0.5 text-[11px] font-mono text-right text-white"
        data-testid={`movelab-input-${f.key}`}
      />
    </label>
  );
}

export function MovementLabPanel({ open, onClose }) {
  const [vals, setVals] = useState(getMovementSnapshot);
  const [server, setServer] = useState(getServerMovement);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState('SPEED');

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    loadMovementConfig().then((s) => { if (alive) { setServer(s); setVals(getMovementSnapshot()); } });
    const off = onMovementChange((m) => { if (alive) setVals(m); });
    return () => { alive = false; off(); };
  }, [open]);

  const hasLocal = useMemo(() => !!readLocalOverride() && Object.keys(readLocalOverride() || {}).length > 0, [vals]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const change = (key, v) => { setLocalMovement({ [key]: v }); };
  const run = async (label, fn) => {
    setBusy(true); setMsg(null);
    try { const s = await fn(); if (s) setServer(s); setVals(getMovementSnapshot()); setMsg({ ok: true, text: label }); }
    catch (e) { setMsg({ ok: false, text: e.message || String(e) }); }
    finally { setBusy(false); }
  };
  const rows = MOVEMENT_FIELDS.filter((f) => f.group === tab);
  const sprintPerSec = vals.sprint, jogPerSec = vals.jog;
  const perfectTapCostPerS = (vals.staminaTapDrain + vals.tapPerfectCost / Math.max(0.05, vals.tapWindow)).toFixed(1);
  const holdCostPerS = vals.staminaDrain.toFixed(1);

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }} data-testid="movelab-backdrop">
      <div className="w-[880px] max-w-[96vw] max-h-[92vh] flex flex-col rounded-xl border border-white/10 bg-neutral-950/95 shadow-[0_30px_80px_rgba(0,0,0,0.7)] overflow-hidden" data-testid="movelab-panel">
        <div className="px-6 pt-5 pb-3 border-b border-white/10 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">Team Gangsta Brawl</div>
            <div className="text-2xl font-black tracking-widest text-white mt-1">MOVEMENT LAB</div>
            <div className="text-[11px] text-white/50 mt-1 max-w-xl">
              Sliders apply instantly to your game (saved on this device as a preview).
              {server.can_edit ? ' You are an admin — SAVE GLOBAL publishes these numbers to every match on the server.' : ' Only admins can publish server-wide balance.'}
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/40" data-testid="movelab-close" title="Close"><i className="fa-solid fa-xmark" /></button>
        </div>

        <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b border-white/10 text-[10px] font-mono text-white/60" data-testid="movelab-summary">
          <span className="px-2 py-0.5 rounded bg-sky-400/10 border border-sky-400/30 text-sky-200">JOG {jogPerSec.toFixed(1)} m/s</span>
          <span className="px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/30 text-amber-200">SPRINT {sprintPerSec.toFixed(1)} m/s · {(sprintPerSec / jogPerSec).toFixed(2)}× jog</span>
          <span className="px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/30 text-emerald-200">PERFECT burst {(vals.sprint * vals.burstMul * (1 + vals.chainCap * vals.chainBonus)).toFixed(1)} m/s max</span>
          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/15">stamina/s — hold {holdCostPerS} · perfect-tap chain ≈ {perfectTapCostPerS}</span>
          {hasLocal && <span className="px-2 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/40 text-yellow-200" data-testid="movelab-local-badge">LOCAL PREVIEW ACTIVE</span>}
          {server.updated_by && <span className="text-white/35">server set by {server.updated_by}</span>}
        </div>

        <div className="px-6 pt-3 flex gap-1 flex-wrap">
          {GROUPS.map((g) => (
            <button key={g} onClick={() => setTab(g)} className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest border ${tab === g ? 'bg-yellow-400 text-black border-yellow-400' : 'border-white/15 text-white/60 hover:text-white'}`} data-testid={`movelab-tab-${g.toLowerCase().replace(/\s+/g, '-')}`}>{g}</button>
          ))}
        </div>

        <div className="px-6 py-3 overflow-y-auto flex-1">
          {tab === 'RHYTHM SPRINT' && (
            <div className="text-[11px] text-white/60 mb-2 leading-relaxed" data-testid="movelab-rhythm-help">
              <b className="text-emerald-300">How it plays:</b> hold RB/Shift for a steady sprint (full drain). <b>Tap</b> RB/Q instead and you sprint for the tap window;
              tap again inside its <b className="text-emerald-300">last {vals.tapPerfectWindow.toFixed(2)} s</b> for a <b className="text-emerald-300">PERFECT</b> — a {((vals.burstMul - 1) * 100).toFixed(0)}% speed burst,
              a cheaper tap and +1 chain (each link +{(vals.chainBonus * 100).toFixed(0)}% top speed, max ×{vals.chainCap}). Tapping too early breaks the chain and costs full price; the cooldown blocks macro spam.
            </div>
          )}
          {rows.map((f) => <Row key={f.key} f={f} value={vals[f.key]} serverValue={server.config[f.key] ?? MOVEMENT_DEFAULTS[f.key]} onChange={change} />)}
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex flex-wrap items-center gap-2">
          <button onClick={() => run('Local preview cleared — using server values', async () => { clearLocalMovement(); return getServerMovement(); })} disabled={busy} className="px-3 py-2 rounded border border-white/20 text-white/80 hover:text-white text-[11px] font-bold tracking-widest" data-testid="movelab-reset-server">USE SERVER VALUES</button>
          <button onClick={() => run('Reset to factory defaults (local)', async () => { setLocalMovement({ ...MOVEMENT_DEFAULTS }); return null; })} disabled={busy} className="px-3 py-2 rounded border border-white/20 text-white/80 hover:text-white text-[11px] font-bold tracking-widest" data-testid="movelab-reset-defaults">FACTORY DEFAULTS</button>
          <div className="flex-1" />
          {server.can_edit && (
            <>
              <button onClick={() => run('Server config reset to defaults', resetGlobalMovement)} disabled={busy} className="px-3 py-2 rounded border border-red-400/40 text-red-200 hover:bg-red-500/10 text-[11px] font-bold tracking-widest" data-testid="movelab-reset-global">RESET GLOBAL</button>
              <button onClick={() => run('Published to every match on the server', () => saveGlobalMovement(getMovementSnapshot()))} disabled={busy} className="px-4 py-2 rounded bg-yellow-400 text-black hover:bg-yellow-300 text-[11px] font-black tracking-widest" data-testid="movelab-save-global">{busy ? 'SAVING…' : 'SAVE GLOBAL'}</button>
            </>
          )}
          {msg && <span className={`w-full text-[11px] font-mono ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`} data-testid="movelab-msg">{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}

export default MovementLabPanel;
