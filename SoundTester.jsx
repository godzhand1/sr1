// In-game debug panel for auditioning Saints Row 1 weapon sounds.
// Opens when the player taps Shift+S during gameplay.  Lets you scrub
// through all 111 extracted XMA streams, hear each one, and read which
// weapon is currently bound to it.  Saves new bindings to localStorage
// so the next play uses your picks (persisted via `STREAM_MAP`).
//
// The mapping persistence layer (localStorage key
// `sr_streetfight_sound_map`) is read by `sounds.js` on import so any
// user picks override the defaults the moment they apply them.
import { useEffect, useState } from 'react';
import { STREAM_MAP } from './sounds.js';

const WEAPONS = ['fist','bat','pistol','smg','rifle','tec9','ak47','shotgun','rpg','pipebomb','empty','bat_finisher'];

export default function SoundTester({ onClose }) {
  const [streamNo, setStreamNo] = useState(1);
  const [analysis, setAnalysis] = useState({});
  const [catFilter, setCatFilter] = useState('ALL');
  const [bindMode, setBindMode] = useState('stream'); // 'stream' | 'reload'
  const [mapping, setMapping]   = useState(() => {
    try {
      const raw = localStorage.getItem('sr_streetfight_sound_map');
      if (raw) return { ...STREAM_MAP, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...STREAM_MAP };
  });

  // Load the analysis manifest so we can show per-stream duration +
  // category hints next to each stream number.
  useEffect(() => {
    fetch('/streetfight/sounds/analysis.json')
      .then(r => r.ok ? r.json() : {})
      .then(setAnalysis)
      .catch(() => {});
  }, []);

  const meta = analysis[streamNo] || {};
  const cats = Array.from(new Set(['ALL', ...Object.values(analysis).map(v => v?.cat).filter(Boolean)])).sort();
  // Filter streams by category to help the user find weapon-like sounds.
  const filteredStreams = catFilter === 'ALL'
    ? Array.from({length:111},(_,i)=>i+1)
    : Object.entries(analysis).filter(([_,v])=>v.cat===catFilter).map(([k])=>parseInt(k)).sort((a,b)=>a-b);

  const play = (n) => {
    const url = `/streetfight/sounds/stream_${String(n).padStart(3,'0')}.ogg`;
    const a = new Audio(url);
    a.volume = 0.7;
    a.play().catch(() => {});
  };

  const assign = (weapon) => {
    const cur = mapping[weapon] || { stream: 1, volume: 0.6 };
    const next = { ...mapping, [weapon]: { ...cur, [bindMode]: streamNo } };
    setMapping(next);
    try { localStorage.setItem('sr_streetfight_sound_map', JSON.stringify(next)); } catch { /* ignore */ }
    STREAM_MAP[weapon] = next[weapon];
  };

  const jumpNext = () => {
    const i = filteredStreams.indexOf(streamNo);
    const n = filteredStreams[(i + 1) % filteredStreams.length] || streamNo;
    setStreamNo(n);
    play(n);
  };
  const jumpPrev = () => {
    const i = filteredStreams.indexOf(streamNo);
    const n = filteredStreams[(i - 1 + filteredStreams.length) % filteredStreams.length] || streamNo;
    setStreamNo(n);
    play(n);
  };

  // Allow arrow keys to scrub through streams while the panel is open.
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); jumpNext(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); jumpPrev(); }
      if (e.key === 'Escape')     { e.preventDefault(); onClose?.(); }
      if (e.key === ' ')          { e.preventDefault(); play(streamNo); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamNo, filteredStreams, onClose]);

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[220] bg-black/95 border border-yellow-400/40 rounded-lg shadow-2xl p-4 w-[500px]"
      data-testid="sound-tester"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-yellow-300 font-black tracking-widest text-sm">WEAPONS.XWB AUDITION</div>
        <button onClick={onClose} className="text-white/60 hover:text-white text-xs" data-testid="sound-tester-close">✕ ESC</button>
      </div>
      <div className="text-white/70 text-[10px] tracking-widest mb-2">
        ← / → scrub (within filter)  ·  SPACE replay  ·  click weapon to bind
      </div>

      {/* Category filter pill row */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {cats.map(c => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${catFilter===c?'bg-yellow-400 text-black':'bg-zinc-800 text-white/60'}`}
            data-testid={`sound-tester-cat-${c}`}
          >{c}</button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <button onClick={jumpPrev} className="px-2 py-1 bg-zinc-800 text-white/70 text-xs rounded" data-testid="sound-tester-prev">◀</button>
        <input
          type="number" min="1" max="111" value={streamNo}
          onChange={(e) => setStreamNo(Math.max(1, Math.min(111, parseInt(e.target.value)||1)))}
          className="w-16 px-2 py-1 bg-zinc-900 text-yellow-300 border border-zinc-700 rounded text-center font-mono"
          data-testid="sound-tester-input"
        />
        <span className="text-white/40 text-xs">/ 111</span>
        <button onClick={jumpNext} className="px-2 py-1 bg-zinc-800 text-white/70 text-xs rounded" data-testid="sound-tester-next">▶</button>
        <button onClick={() => play(streamNo)} className="ml-auto px-3 py-1 bg-yellow-400 text-black text-xs font-black rounded" data-testid="sound-tester-play">▶ PLAY</button>
      </div>

      {/* Per-stream meta */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded px-3 py-2 mb-3 flex justify-between items-center">
        <div className="text-white/80 text-[10px]">
          <span className="text-yellow-300 font-bold tracking-widest">{meta.cat || '?'}</span>
          <span className="text-white/40 mx-2">·</span>
          {meta.dur != null ? `${meta.dur.toFixed(2)}s` : '—'}
          <span className="text-white/40 mx-2">·</span>
          {meta.peaks != null ? `${meta.peaks} peaks` : '—'}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setBindMode('stream')}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${bindMode==='stream'?'bg-yellow-400 text-black':'bg-zinc-800 text-white/60'}`}
            data-testid="sound-tester-mode-stream"
          >FIRE</button>
          <button
            onClick={() => setBindMode('reload')}
            className={`px-2 py-0.5 text-[9px] font-bold rounded ${bindMode==='reload'?'bg-yellow-400 text-black':'bg-zinc-800 text-white/60'}`}
            data-testid="sound-tester-mode-reload"
          >RELOAD</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {WEAPONS.map(w => {
          const fireCur = mapping[w]?.stream;
          const reloadCur = mapping[w]?.reload;
          const cur = bindMode === 'reload' ? reloadCur : fireCur;
          const bound = cur === streamNo;
          return (
            <button
              key={w}
              onClick={() => assign(w)}
              className={`px-2 py-1.5 text-[10px] font-bold rounded border ${bound ? 'border-yellow-400 bg-yellow-400/20 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/70 hover:border-yellow-400/40'}`}
              data-testid={`sound-tester-bind-${w}`}
            >
              {w.replace('_',' ').toUpperCase()}
              <div className="text-[8px] font-mono text-white/40 mt-0.5">
                FIRE→{fireCur ?? '–'}  RL→{reloadCur ?? '–'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-white/40 text-[9px] mt-3 italic">
        Sources: Weapons.xwb (Saints Row 1 / Xbox 360) via vgmstream + libvorbis. Picks persist to localStorage.
      </div>
    </div>
  );
}
