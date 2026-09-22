// mapedit/MatchMusicSection.jsx — WORLD panel: pick (or upload) the track
// this custom map loops for the whole match. Stored on the map doc as
// world.music_url / world.music_name; Brawl3DGame reads it at match start.
import React, { useEffect, useRef, useState } from 'react';
import { getSoundConfig, loadSoundConfig, onSoundConfig, uploadSound } from '../brawl3d/audio/soundConfig.js';
import * as AE from '../brawl3d/audio/audioEngine.js';

const ACOUSTICS = [['street', 'Street — open air (dry)'], ['room', 'Room — house / office'], ['garage', 'Garage — concrete box'], ['hall', 'Hall — warehouse'], ['none', 'None']];

export function RoomAcousticsSelect({ world, onChange }) {
  const cur = world.reverb || 'street';
  return (
    <div className="space-y-1" data-testid="mapedit-room-acoustics">
      <div className="text-[9px] text-white/40 leading-tight">Reverb tail every effect gets on this map. Streets stay dry; interiors echo.</div>
      <select value={cur} onChange={(e) => { onChange({ reverb: e.target.value }); AE.setReverb(e.target.value); }} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]" data-testid="mapedit-acoustics-select">
        {ACOUSTICS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </div>
  );
}

export function MatchMusicSection({ world, onChange }) {
  const [cfg, setCfg] = useState(getSoundConfig);
  const [pct, setPct] = useState(null);
  const [err, setErr] = useState(null);
  const [auditioning, setAuditioning] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    let alive = true;
    loadSoundConfig().then((c) => { if (alive) setCfg({ ...c }); });
    const off = onSoundConfig((c) => { if (alive) setCfg({ ...c }); });
    return () => { alive = false; off(); AE.stopMusic(0.2); };
  }, []);
  const tracks = (cfg.library || []).filter((f) => f.kind === 'music');
  const cur = world.music_url || '';
  const pick = (url) => { const t = tracks.find((x) => x.url === url); onChange(t ? { music_url: t.url, music_name: t.name } : { music_url: null, music_name: null }); };
  const upload = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    setErr(null); setPct(0);
    try { const rec = await uploadSound(f, 'music', setPct); onChange({ music_url: rec.url, music_name: rec.name }); }
    catch (ex) { setErr(ex.message || String(ex)); }
    finally { setPct(null); }
  };
  const toggleAudition = () => {
    AE.resume();
    if (auditioning) { AE.stopMusic(0.3); setAuditioning(false); }
    else if (cur) { AE.playMusic(cur, { volume: 1, fadeIn: 0.3 }); setAuditioning(true); }
  };
  return (
    <div className="space-y-1.5" data-testid="mapedit-match-music">
      <div className="text-[9px] text-white/40 leading-tight">Loops for the whole match on this map (ducks under the announcer, fades at the horn). Leave on “server default” to use the Sound Manager’s default track.</div>
      <select value={cur} onChange={(e) => pick(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px]" data-testid="mapedit-music-select">
        <option value="">— server default —</option>
        {tracks.map((t) => <option key={t.id} value={t.url}>{t.name}</option>)}
        {cur && !tracks.some((t) => t.url === cur) && <option value={cur}>{world.music_name || cur.split('/').pop()}</option>}
      </select>
      <div className="flex items-center gap-1.5">
        <input ref={fileRef} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" className="hidden" onChange={upload} data-testid="mapedit-music-file" />
        <button onClick={() => fileRef.current?.click()} disabled={!cfg.can_edit || pct != null} className="px-2 py-1 text-[10px] rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40" data-testid="mapedit-music-upload" title={cfg.can_edit ? 'Upload .mp3/.wav (max 15 MB)' : 'Admins only'}>
          {pct != null ? `UPLOADING ${Math.round(pct * 100)}%` : 'UPLOAD TRACK'}
        </button>
        <button onClick={toggleAudition} disabled={!cur} className="px-2 py-1 text-[10px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40" data-testid="mapedit-music-play">{auditioning ? 'STOP' : 'PLAY'}</button>
        {cur && <button onClick={() => pick('')} className="px-2 py-1 text-[10px] rounded bg-slate-800 hover:bg-slate-700" data-testid="mapedit-music-clear">CLEAR</button>}
      </div>
      {err && <div className="text-[10px] text-red-300" data-testid="mapedit-music-error">{err}</div>}
    </div>
  );
}

export default MatchMusicSection;
