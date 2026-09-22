// Streetfight — mission selector.
//
// Shown right after the player picks/creates their character. All 3
// missions unlock from the start (per user brief) so this is more of
// a "chapter picker" than a progression gate.

import React from 'react';
import { MISSIONS, MISSION_META } from './missions/index.js';

export default function MissionSelect({ onPick, onBack }) {
  return (
    <div
      className="fixed inset-0 z-[210] flex flex-col items-center justify-start bg-black/90 backdrop-blur overflow-y-auto py-10"
      data-testid="streetfight-mission-select"
    >
      <div className="w-full max-w-6xl px-8">
        <button
          onClick={onBack}
          data-testid="streetfight-mission-back"
          className="mb-6 px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm font-bold tracking-widest"
        >
          ← BACK
        </button>
        <div className="mb-2 text-xs uppercase tracking-[0.4em] text-neutral-500">Chapter Select</div>
        <div className="mb-8 text-4xl font-black text-white">Pick your job.</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MISSIONS.map((m) => {
            const meta = MISSION_META[m.id] || { gang: '???', accent: '#a3f7bf', tag: '' };
            return (
              <button
                key={m.id}
                data-testid={`streetfight-mission-tile-${m.id}`}
                onClick={() => onPick(m.id)}
                className="text-left rounded-md overflow-hidden border border-neutral-800 bg-neutral-950 hover:border-neutral-600 transition-colors group"
                style={{ boxShadow: `0 0 0 1px transparent, 0 8px 24px rgba(0,0,0,0.35)` }}
              >
                {/* Poster band — gang colour swash + gradient reading */}
                <div
                  className="h-40 relative overflow-hidden"
                  style={{
                    background:
                      `linear-gradient(135deg, ${meta.accent}22 0%, ${meta.accent}55 45%, #000000 100%)`,
                  }}
                >
                  <div className="absolute inset-0 flex items-end p-4">
                    <div className="text-xs uppercase tracking-widest font-bold" style={{ color: meta.accent }}>
                      {meta.gang}
                    </div>
                  </div>
                  <div
                    className="absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-40 group-hover:opacity-70 transition-opacity"
                    style={{ background: `radial-gradient(closest-side, ${meta.accent}, transparent 70%)` }}
                  />
                </div>
                {/* Copy */}
                <div className="p-5">
                  <div className="text-lg font-black text-white leading-tight">{m.title}</div>
                  <div className="mt-1 text-xs uppercase tracking-widest text-neutral-500">{meta.tag}</div>
                  <div className="mt-3 text-sm text-neutral-300 leading-snug">{m.intro}</div>
                  <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.accent }} />
                    <span>{m.segments.length} SEGMENTS</span>
                    <span className="text-neutral-700">·</span>
                    <span>{timeLabel(m.timeOfDayStart)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Same as the HUD's timeLabel — a compact "05:23" style hint so the
// player knows roughly what part of the day the level opens in.
function timeLabel(t) {
  const hours24 = t * 24;
  const h = Math.floor(hours24);
  const m = Math.floor((hours24 - h) * 60);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}`;
}
