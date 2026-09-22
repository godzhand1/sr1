// SoundManagerPanel — every sound the brawl makes, by category: audition it,
// set its volume, swap the sample for a .wav/.mp3 (stored server-side so
// every player hears it) or reset to the built-in. Also assigns the match
// music each built-in map loops, and exposes the bus mix.
import React, { useEffect, useRef, useState } from 'react';
import * as AE from './audio/audioEngine.js';
import { SOUND_CATEGORIES, SOUND_DEFS, MUSIC_MAPS, soundKeysByCategory } from './audio/soundRegistry.js';
import { getSoundConfig, loadSoundConfig, onSoundConfig, uploadSound, saveOverride, resetOverride, setMapMusic } from './audio/soundConfig.js';
import { previewSound } from '../streetfight/sounds.js';

const BUSES = [['master', 'Master'], ['sfx', 'Effects'], ['music', 'Music'], ['voice', 'Announcer'], ['ui', 'HUD']];
const fileName = (u) => (u ? u.split('/').pop() : '');

function UploadButton({ kind, label, disabled, onDone, onError, testid }) {
  const ref = useRef(null);
  const [pct, setPct] = useState(null);
  const pick = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    setPct(0);
    try { onDone(await uploadSound(f, kind, setPct), f); } catch (err) { onError?.(err.message || String(err)); }
    finally { setPct(null); }
  };
  return (
    <>
      <input ref={ref} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" className="hidden" onChange={pick} data-testid={`${testid}-file`} />
      <button onClick={() => ref.current?.click()} disabled={disabled || pct != null} className="px-2 py-1 rounded border border-sky-400/40 text-sky-200 hover:bg-sky-500/10 disabled:opacity-40 text-[10px] font-bold tracking-widest" data-testid={testid}>
        {pct != null ? `${Math.round(pct * 100)}%` : label}
      </button>
    </>
  );
}

function SoundRow({ k, cfg, onMsg }) {
  const d = SOUND_DEFS[k];
  const o = cfg.overrides[k] || {};
  const [vol, setVol] = useState(o.volume ?? d.volume ?? 1);
  useEffect(() => { setVol(o.volume ?? d.volume ?? 1); }, [o.volume, d.volume]);
  const isAdmin = cfg.can_edit;
  const changeVol = (v) => { setVol(v); AE.setOverride(k, { ...AE.overrideFor(k), volume: v }); };
  const commitVol = async () => { if (isAdmin) { try { await saveOverride(k, { volume: vol }); } catch (e) { onMsg(false, e.message); } } };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_150px_auto] items-center gap-3 py-1.5 border-t border-white/5" data-testid={`sndmgr-row-${k}`}>
      <div className="min-w-0">
        <div className={`text-[11px] tracking-wide ${o.url ? 'text-yellow-200' : 'text-white/85'}`}>{d.label}</div>
        <div className="text-[9px] font-mono text-white/35 truncate">{k} · {o.url ? `custom: ${o.name || fileName(o.url)}` : (d.url ? fileName(d.url) : 'synthesized')}</div>
      </div>
      <label className="flex items-center gap-2 text-[9px] font-mono text-white/50">
        <input type="range" min={0} max={2} step={0.05} value={vol} onChange={(e) => changeVol(+e.target.value)} onMouseUp={commitVol} onTouchEnd={commitVol} onKeyUp={commitVol} className="accent-yellow-400 w-full" data-testid={`sndmgr-vol-${k}`} />
        <span className="w-8 text-right">{vol.toFixed(2)}</span>
      </label>
      <div className="flex items-center gap-1">
        <button onClick={() => { AE.resume(); previewSound(k); }} className="px-2 py-1 rounded border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/10 text-[10px] font-bold tracking-widest" data-testid={`sndmgr-preview-${k}`}><i className="fa-solid fa-play mr-1" />PLAY</button>
        <UploadButton kind="sfx" label="REPLACE" disabled={!isAdmin} testid={`sndmgr-replace-${k}`} onError={(m) => onMsg(false, m)}
          onDone={async (rec, f) => { try { await saveOverride(k, { url: rec.url, name: f.name }); onMsg(true, `${d.label} now plays ${f.name}`); } catch (e) { onMsg(false, e.message); } }} />
        <button onClick={async () => { try { await resetOverride(k); onMsg(true, `${d.label} reset to default`); } catch (e) { onMsg(false, e.message); } }} disabled={!isAdmin || (!o.url && o.volume == null)} className="px-2 py-1 rounded border border-white/20 text-white/70 hover:text-white disabled:opacity-30 text-[10px] font-bold tracking-widest" data-testid={`sndmgr-reset-${k}`}>RESET</button>
      </div>
    </div>
  );
}

function MusicTab({ cfg, onMsg }) {
  const tracks = (cfg.library || []).filter((f) => f.kind === 'music');
  const isAdmin = cfg.can_edit;
  const [auditioning, setAuditioning] = useState(null);
  const audition = (url) => { AE.resume(); if (auditioning === url) { AE.stopMusic(0.3); setAuditioning(null); } else { AE.playMusic(url, { volume: 1, fadeIn: 0.3 }); setAuditioning(url); } };
  useEffect(() => () => { if (auditioning) AE.stopMusic(0.3); }, [auditioning]);
  return (
    <div data-testid="sndmgr-music">
      <div className="text-[11px] text-white/60 mb-2 leading-relaxed">Each built-in map loops its track for the whole match (ducks under the announcer, fades out at the final horn). Custom maps pick their track in the Map Editor → WORLD → MATCH MUSIC. {isAdmin ? 'Upload .mp3/.wav up to 15 MB.' : 'Only admins can change assignments.'}</div>
      <div className="flex items-center gap-2 mb-2">
        <UploadButton kind="music" label="UPLOAD TRACK" disabled={!isAdmin} testid="sndmgr-music-upload" onError={(m) => onMsg(false, m)} onDone={(rec) => onMsg(true, `Uploaded ${rec.name}`)} />
        <span className="text-[10px] text-white/40 font-mono">{tracks.length} track{tracks.length === 1 ? '' : 's'} in library</span>
      </div>
      {MUSIC_MAPS.map(([key, label]) => {
        const cur = cfg.music[key];
        return (
          <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] items-center gap-3 py-1.5 border-t border-white/5" data-testid={`sndmgr-music-row-${key}`}>
            <div className="min-w-0"><div className="text-[11px] text-white/85">{label}</div><div className="text-[9px] font-mono text-white/35 truncate">{cur ? cur.name : (key === 'default' ? 'silence' : 'uses default')}</div></div>
            <select value={cur ? cur.url : ''} disabled={!isAdmin} onChange={async (e) => { const t = tracks.find((x) => x.url === e.target.value); try { await setMapMusic(key, t ? { url: t.url, name: t.name } : null); onMsg(true, `${label}: ${t ? t.name : 'no track'}`); } catch (err) { onMsg(false, err.message); } }} className="bg-black/50 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white disabled:opacity-50" data-testid={`sndmgr-music-select-${key}`}>
              <option value="">— none —</option>
              {tracks.map((t) => <option key={t.id} value={t.url}>{t.name}</option>)}
            </select>
            <button onClick={() => cur && audition(cur.url)} disabled={!cur} className="px-2 py-1 rounded border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-30 text-[10px] font-bold tracking-widest" data-testid={`sndmgr-music-play-${key}`}><i className={`fa-solid ${auditioning && cur && auditioning === cur.url ? 'fa-stop' : 'fa-play'} mr-1`} />{auditioning && cur && auditioning === cur.url ? 'STOP' : 'PLAY'}</button>
          </div>
        );
      })}
    </div>
  );
}

function MixTab() {
  const [mix, setMix] = useState(AE.getMix);
  const [rev, setRev] = useState(() => AE.currentReverb() || 'street');
  return (
    <div data-testid="sndmgr-mix">
      <label className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 py-2 border-t border-white/5 text-[11px] text-white/85" data-testid="sndmgr-reverb-row">
        <span>Reverb preview</span>
        <select value={rev} onChange={(e) => { AE.resume(); AE.setReverb(e.target.value); setRev(e.target.value); }} className="bg-black/50 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white" data-testid="sndmgr-reverb-select">
          {Object.entries(AE.REVERB_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
      </label>
      <div className="text-[10px] text-white/40 mb-1">Maps set their own room: streets dry · KOTH House & Boardroom = room · Lobby = hall · Garage = garage · custom maps pick theirs in the editor (WORLD → MATCH AUDIO). Audition a sound above after switching.</div>
      {BUSES.map(([b, label]) => (
        <label key={b} className="grid grid-cols-[120px_minmax(0,1fr)_48px] items-center gap-3 py-2 border-t border-white/5 text-[11px] text-white/85" data-testid={`sndmgr-mix-row-${b}`}>
          <span>{label}</span>
          <input type="range" min={0} max={1} step={0.01} value={mix[b]} onChange={(e) => { AE.setBusVolume(b, +e.target.value); setMix(AE.getMix()); }} className="accent-yellow-400 w-full" data-testid={`sndmgr-mix-${b}`} />
          <span className="font-mono text-white/50 text-right">{Math.round(mix[b] * 100)}%</span>
        </label>
      ))}
      <div className="text-[10px] text-white/40 mt-2">Saved on this device. The same sliders live in Video Settings.</div>
    </div>
  );
}

export function SoundManagerPanel({ open, onClose }) {
  const [cfg, setCfg] = useState(getSoundConfig);
  const [tab, setTab] = useState('weapons');
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    loadSoundConfig().then((c) => { if (alive) setCfg({ ...c }); });
    const off = onSoundConfig((c) => { if (alive) setCfg({ ...c }); });
    return () => { alive = false; off(); };
  }, [open]);
  if (!open) return null;
  const onMsg = (ok, text) => setMsg({ ok, text });
  const byCat = soundKeysByCategory();
  const tabs = [...SOUND_CATEGORIES, ['music', 'Match music'], ['mix', 'Mix']];
  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }} data-testid="sndmgr-backdrop">
      <div className="w-[920px] max-w-[96vw] max-h-[92vh] flex flex-col rounded-xl border border-white/10 bg-neutral-950/95 shadow-[0_30px_80px_rgba(0,0,0,0.7)] overflow-hidden" data-testid="sndmgr-panel">
        <div className="px-6 pt-5 pb-3 border-b border-white/10 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">Team Gangsta Brawl</div>
            <div className="text-2xl font-black tracking-widest text-white mt-1">SOUND MANAGER</div>
            <div className="text-[11px] text-white/50 mt-1 max-w-xl">{Object.keys(SOUND_DEFS).length} sounds on the 3D engine (HRTF, distance-ranged, polyphony-capped). {cfg.can_edit ? 'You are an admin — replacements and volumes publish to every player.' : 'Preview and local volume only; admins can publish replacements.'}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded border border-white/15 text-white/70 hover:text-white hover:border-white/40" data-testid="sndmgr-close" title="Close"><i className="fa-solid fa-xmark" /></button>
        </div>
        <div className="px-6 pt-3 flex gap-1 flex-wrap">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest border ${tab === id ? 'bg-yellow-400 text-black border-yellow-400' : 'border-white/15 text-white/60 hover:text-white'}`} data-testid={`sndmgr-tab-${id}`}>{label.toUpperCase()}{byCat[id] ? ` · ${byCat[id].length}` : ''}</button>
          ))}
        </div>
        <div className="px-6 py-3 overflow-y-auto flex-1">
          {tab === 'music' ? <MusicTab cfg={cfg} onMsg={onMsg} /> : tab === 'mix' ? <MixTab /> : (byCat[tab] || []).map((k) => <SoundRow key={k} k={k} cfg={cfg} onMsg={onMsg} />)}
        </div>
        <div className="px-6 py-2 border-t border-white/10 min-h-[34px] text-[11px] font-mono">
          {msg && <span className={msg.ok ? 'text-emerald-300' : 'text-red-300'} data-testid="sndmgr-msg">{msg.text}</span>}
          {!msg && cfg.updated_by && <span className="text-white/35">server sounds last set by {cfg.updated_by}</span>}
        </div>
      </div>
    </div>
  );
}

export default SoundManagerPanel;
