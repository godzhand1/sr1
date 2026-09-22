// Team Gangsta Brawl — end-of-match rollcall panel.
//
// After the horn blows, everyone can tick a "🚌 ROLL WITH ME" toggle
// indicating they want to hop lobbies with someone else. The intent
// is broadcast over the coop's `evt.k='rc'` relay so every screen
// updates. Any player (typically the lobby leader) can then click
// PICKUP next to another willing player's name to invite them into
// THEIR source lobby. Cross-team allowed — you can bring an enemy
// home.
//
// This is UI-only. The backend evt relay already carries `rc` and
// `pu` messages (see coop3d._handle).

import { useEffect, useState } from 'react';

export function RollcallPanel({ coop, myId, myLobbyId, myTeam }) {
  const [myWilling, setMyWilling] = useState(false);
  const [tick, setTick] = useState(0);

  // Re-render at 3Hz to pick up remote rollcall toggles. Cheap and
  // more than snappy enough for end-of-match UX.
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 350);
    return () => clearInterval(iv);
  }, []);

  if (!coop) return null;

  const toggleMe = () => {
    const next = !myWilling;
    setMyWilling(next);
    try { coop._send({ type: 'evt', d: { k: 'rc', willing: next } }); } catch { /* */ }
  };

  const pickup = (targetId) => {
    if (!myLobbyId) return;
    try {
      coop._send({
        type: 'evt',
        d: { k: 'pu', tid: targetId, lid: myLobbyId, mission: 'lobby_warehouse' },
      });
    } catch { /* */ }
  };

  const remotes = Array.from(coop.remotes.values());
  const _t = tick;   // keep the interval-driven re-render alive
  void _t;

  return (
    <div
      className="absolute right-4 top-24 z-[210] w-72 bg-black/85 border border-emerald-500/40 rounded p-3 backdrop-blur-sm"
      data-testid="brawl3d-rollcall-panel"
    >
      <div className="text-emerald-300 text-[10px] font-black tracking-widest mb-2">🚌 ROLL WITH ME</div>
      <div className="text-white/50 text-[10px] leading-snug mb-3">
        Tick to signal you want to hop lobbies with someone. Any player can then invite you into theirs.
      </div>
      <button
        onClick={toggleMe}
        className={`w-full mb-3 py-2 rounded font-black tracking-widest text-xs border ${
          myWilling
            ? 'bg-emerald-500/25 border-emerald-400 text-emerald-100'
            : 'bg-zinc-900 border-zinc-700 text-white/70 hover:border-emerald-500/60'
        }`}
        data-testid="brawl3d-rollcall-toggle-me"
      >
        {myWilling ? '☑ WILLING TO ROLL' : '☐ TICK TO ROLL'}
      </button>

      <div className="text-white/50 text-[10px] font-bold tracking-widest mb-1">PLAYERS</div>
      <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
        {remotes.length === 0 && (
          <div className="text-white/40 text-[11px] italic">Just you — nobody else in this match.</div>
        )}
        {remotes.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 bg-zinc-900/70 border border-zinc-800 rounded px-2 py-1.5"
            data-testid={`brawl3d-rollcall-row-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className={`text-[11px] font-bold truncate ${r.team === myTeam ? 'text-white' : 'text-red-300'}`}>
                {r.display || 'SAINT'}
              </div>
              <div className="text-[9px] text-white/40 tracking-wider">
                {r.rollcall ? '✔ wants to roll' : 'no signal'}
              </div>
            </div>
            {r.rollcall && (
              <button
                onClick={() => pickup(r.id)}
                className="px-2 py-1 bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black tracking-widest rounded"
                data-testid={`brawl3d-rollcall-pickup-${r.id}`}
              >PICKUP</button>
            )}
          </div>
        ))}
      </div>
      <div className="text-white/30 text-[9px] mt-2">
        Pickups land the target back in <span className="text-white/60">your lobby</span> (not theirs).
      </div>
      {/* Silence: myId is passed for future name-highlighting logic. */}
      <span style={{ display: 'none' }}>{myId || ''}</span>
    </div>
  );
}
