// Brawl3DPreMatch — pre-game loading / ready-up screen.
//
// Rendered by PlayCanvas ON TOP of the live scene while it loads, so
// the bar tracks the real thing: map GLBs, PEG/PBR textures, weapon
// and character rigs, the sky IBL bake — nothing pops in after the
// player is in. Once every asset is resident the player is READY
// automatically. Solo: click to lock in and the 3-2-1 starts. Coop:
// the roster shows who is still loading; the host fires the shared
// start the moment everyone is ready (or forces it after 45 s).
//
// Also hosts the lobby chat (through the coop evt bus, `k: 'chat'`)
// and a tip carousel so the wait isn't dead time.
import React, { useEffect, useState, useRef } from 'react';

const TIPS = [
  'Hold SHIFT to sprint. Sprinting doubles bloom on your reticle.',
  'Press X (controller) or SPACE to vault fences and mantle onto ledges.',
  'Pipe bombs stick to walls, chain-detonate, and knock enemies prone.',
  'Every weapon has its own reticle — pick one that fits your play style.',
  'KOTH: You must stand ON TOP of the hill mesh to capture it, not just touch it.',
  'Shots close to centre-of-mass get a soft magnet — long-range still needs skill.',
  'Landed a shot? The reticle pulses red and rings a metallic "tink" (kill-confirm).',
  'The Quota trike has emergency lights — toggle them with R3 / mouse-3.',
  'Hold V for the scoreboard — kills, deaths, best streak and match MVP.',
];

export const FORCE_START_AFTER_S = 45;

function prettyAsset(url) {
  if (!url) return '';
  return decodeURIComponent(url).replace(/\.(glb|gltf|png|jpg|jpeg|webp|ktx2|json)$/i, '').replace(/[_-]+/g, ' ').slice(0, 42);
}

export default function Brawl3DPreMatch({
  coop, displayName, gameMode, mapLabel,
  load = { progress: 0, done: 0, total: 0, ready: false, lastUrl: '', elapsed: 0 },
  roster = [], wait = { isHost: false, waitingT: 0, coop: false, allReady: false },
  locked = false, onLockIn, onForceStart, onGamepad, cancel,
}) {
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  // ── Tip carousel — rotates every 6s so the wait feels alive ──
  useEffect(() => {
    const t = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(t);
  }, []);

  // ── Chat pump (multiplayer only) ────────────────────────────
  useEffect(() => {
    if (!coop || !coop.drainChat) return undefined;
    const drain = () => {
      const lines = coop.drainChat();
      if (lines.length) setMessages((m) => [...m, ...lines].slice(-60));
    };
    const i = setInterval(drain, 250);
    return () => clearInterval(i);
  }, [coop]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const sendChat = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    const msg = { from: displayName || 'SAINT', text: t.slice(0, 200), t: Date.now(), self: true };
    setMessages((m) => [...m, msg].slice(-60));
    if (coop && coop.sendEvt) {
      try { coop.sendEvt({ k: 'chat', n: displayName || 'SAINT', t: msg.text }); } catch (_) { /* ignore */ }
    }
  };

  const pct = Math.round((load.progress || 0) * 100);
  const ready = !!load.ready;
  const isCoop = !!wait.coop;
  const notReady = roster.filter((r) => !r.ready);
  const canForce = isCoop && wait.isHost && ready && !wait.allReady && (wait.waitingT || 0) >= FORCE_START_AFTER_S;
  const forceIn = Math.max(0, Math.ceil(FORCE_START_AFTER_S - (wait.waitingT || 0)));

  let status;
  if (!ready) status = load.lastUrl ? `Streaming ${prettyAsset(load.lastUrl)}…` : 'Streaming world, rigs, weapons and textures…';
  else if (load.timedOut) status = 'Some assets are still streaming — they will pop in during the match. Click to lock in.';
  else if (!isCoop) status = 'All systems armed. Click to lock in — the countdown starts on your click.';
  else if (wait.allReady) status = 'Everyone is loaded — starting…';
  else status = `Waiting for ${notReady.length} player${notReady.length === 1 ? '' : 's'} to finish loading.`;

  return (
    <div
      data-testid="brawl3d-prematch"
      className="absolute inset-0 z-[230] bg-neutral-950/95 text-neutral-100 flex flex-col"
      style={{ backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(163,247,191,0.06) 0%, transparent 70%)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.35em] text-neutral-400">{ready ? (isCoop ? 'Ready — waiting for the crew' : 'Ready') : 'Preparing Brawl'}</div>
          <div className="text-4xl font-black mt-1" data-testid="brawl3d-prematch-maplabel">
            {mapLabel || 'ARENA'} · <span className="text-emerald-300">{(gameMode || 'TDM').toUpperCase()}</span>
          </div>
        </div>
        <div className="text-right text-xs text-neutral-500 font-mono" data-testid="brawl3d-prematch-state">
          {ready ? 'LOADED' : 'LOADING'}{locked ? ' · LOCKED IN' : ''}
        </div>
      </div>

      {/* Main grid: left=tips+progress+roster, right=chat */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-6 px-8 pb-6 overflow-hidden">
        {/* LEFT */}
        <div className="flex flex-col gap-4 min-h-0">
          <div className="rounded-md bg-neutral-900/70 border border-neutral-800 p-6 flex-1 flex flex-col justify-center min-h-[96px]">
            <div className="text-xs uppercase tracking-widest text-neutral-500 mb-3">Tip of the Match</div>
            <div key={tipIdx} className="text-lg leading-snug" style={{ animation: 'brawl3dTipFade 400ms ease-out' }}>
              {TIPS[tipIdx]}
            </div>
            <style>{`
              @keyframes brawl3dTipFade {
                from { opacity: 0; transform: translateY(6px) }
                to   { opacity: 1; transform: translateY(0) }
              }
            `}</style>
          </div>

          {/* Roster (coop) */}
          {isCoop && (
            <div className="rounded-md bg-neutral-900/70 border border-neutral-800 px-6 py-4" data-testid="brawl3d-prematch-roster">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs uppercase tracking-widest text-neutral-500">Squad</div>
                <div className="text-xs font-mono text-neutral-400" data-testid="brawl3d-prematch-ready-count">
                  {roster.filter((r) => r.ready).length}/{roster.length} ready
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm font-mono">
                {roster.map((r) => (
                  <div key={r.id} className="flex items-center gap-2" data-testid={`brawl3d-prematch-roster-${r.id}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${r.ready ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'}`} />
                    <span className={r.me ? 'text-emerald-300' : 'text-neutral-200'}>{r.name}{r.me ? ' (you)' : ''}</span>
                    <span className="ml-auto text-xs text-neutral-500">{r.ready ? 'READY' : 'LOADING…'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="rounded-md bg-neutral-900/70 border border-neutral-800 px-6 py-4">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs uppercase tracking-widest text-neutral-500">Assets</div>
              <div className="text-sm font-mono text-emerald-300" data-testid="brawl3d-prematch-progress">
                {load.done}/{load.total} · {pct}%
              </div>
            </div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${ready ? 'bg-emerald-400' : 'bg-emerald-500/80'}`}
                style={{ width: `${ready ? 100 : Math.max(2, pct)}%` }}
                data-testid="brawl3d-prematch-progress-bar"
              />
            </div>
            <div className="mt-3 text-xs text-neutral-500" data-testid="brawl3d-prematch-status">{status}</div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!ready || locked}
              onClick={onLockIn}
              data-testid="brawl3d-prematch-ready"
              className={`flex-1 px-6 py-4 rounded-md text-lg font-black tracking-widest transition-colors ${
                ready && !locked
                  ? 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400 cursor-pointer'
                  : locked ? 'bg-emerald-900/60 text-emerald-200 cursor-default' : 'bg-neutral-800 text-neutral-500 cursor-wait'
              }`}
            >
              {!ready ? 'LOADING…' : locked ? (isCoop ? 'LOCKED IN — WAITING FOR SQUAD' : 'LOCKED IN') : (isCoop ? 'CLICK TO LOCK IN' : 'CLICK TO ENTER')}
            </button>
            {ready && !locked && onGamepad && (
              <button
                type="button"
                onClick={onGamepad}
                data-testid="brawl3d-prematch-gamepad"
                className="px-5 py-4 rounded-md text-sm font-black tracking-widest bg-zinc-800 border border-zinc-600 text-white/80 hover:bg-zinc-700"
                title="Playing with a gamepad — no mouse lock"
              >
                🎮 GAMEPAD
              </button>
            )}
            {canForce && (
              <button
                type="button"
                onClick={onForceStart}
                data-testid="brawl3d-prematch-force-start"
                className="px-6 py-4 rounded-md text-lg font-black tracking-widest bg-yellow-500 text-neutral-950 hover:bg-yellow-400"
              >
                START ANYWAY
              </button>
            )}
            {isCoop && wait.isHost && ready && !wait.allReady && !canForce && (
              <div className="px-4 py-4 text-xs text-neutral-500 font-mono self-center" data-testid="brawl3d-prematch-force-timer">
                host start in {forceIn}s
              </div>
            )}
            <button
              type="button"
              onClick={cancel}
              data-testid="brawl3d-prematch-cancel"
              className="px-6 py-4 rounded-md text-lg font-black tracking-widest bg-neutral-900 border border-neutral-700 hover:bg-neutral-800"
            >
              CANCEL
            </button>
          </div>
        </div>

        {/* RIGHT — chat panel */}
        <div className="flex flex-col rounded-md bg-neutral-900/70 border border-neutral-800 overflow-hidden">
          <div className="px-4 py-2 border-b border-neutral-800 flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-neutral-500">Lobby Chat</div>
            <div className="text-xs text-neutral-600">{coop ? 'live' : 'solo — chat disabled'}</div>
          </div>
          <div
            ref={listRef}
            data-testid="brawl3d-prematch-chatlist"
            className="flex-1 overflow-y-auto p-3 space-y-1.5 text-sm font-mono"
          >
            {messages.length === 0 && (
              <div className="text-neutral-600 italic">
                {coop ? 'Say hi to your squad while assets load…' : 'Chat is disabled in solo mode. Boot a lobby to talk with your crew.'}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <span className={m.self ? 'text-emerald-300' : 'text-sky-300'}>{m.from}</span>
                <span className="text-neutral-500"> › </span>
                <span className="text-neutral-100">{m.text}</span>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-neutral-800 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
              placeholder={coop ? 'Type a message…' : 'Solo mode — no chat'}
              disabled={!coop}
              maxLength={200}
              data-testid="brawl3d-prematch-chatinput"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-40"
            />
            <button
              type="button"
              onClick={sendChat}
              disabled={!coop || !input.trim()}
              data-testid="brawl3d-prematch-chatsend"
              className="px-3 py-2 rounded bg-emerald-500 text-neutral-950 font-bold disabled:bg-neutral-800 disabled:text-neutral-600"
            >
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
