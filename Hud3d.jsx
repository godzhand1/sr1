// Team Gangsta Brawl — HUD overlay (pure React, sits over the canvas).
import { TEAM_NAMES as DEFAULT_TEAM_NAMES } from './characterModel3d.js';

const TEAM_HEX = { A: '#a78bfa', B: '#38bdf8' };

// Pull team names from the live snapshot so gang-vs-gang matches show
// the actual gang names instead of SAINTS/ROLLERZ. Falls back to the
// static defaults if the snapshot hasn't populated yet.
function tn(snap, t) {
  return (snap && snap.teamNames && snap.teamNames[t]) || DEFAULT_TEAM_NAMES[t];
}

// Weapon-ID → icon path. Points at /public/icons for the built-in art.
// Fists don't have a dedicated PNG so we keep a text fallback.
const WEAPON_ICON = {
  bat:      '/icons/bat.png',
  pimpslap: '/icons/pimp_slap.png',
  pistol:   '/icons/pistol.png',
  tec9:     '/icons/tec9.png',
  shotgun:  '/icons/shotgun.png',
  ak47:     '/icons/ak47.png',
  rpg:      '/icons/rpg.png',
  pipebomb: '/icons/pipe_bomb.png',
};

// Short text glyphs for the kill feed weapon column — used only as
// fallback when we don't have an icon (currently only fist).
const WEAPON_GLYPH = {
  fist:     'FIST',
  _default: '×',
};

// Reticle sits dead-centre of the screen (50% / 50%).
// The camera lookAt in Brawl3DGame now projects the aim ray exactly to
// screen centre with no Y bias, so this is where bullets actually land —
// matching SR1's centred crosshair behaviour.
const RETICLE_TOP_PCT = 50;

export function Hud3D({ snap, showBoard }) {
  if (!snap) return null;
  const mins = Math.floor(snap.timeLeft / 60);
  const secs = Math.floor(snap.timeLeft % 60).toString().padStart(2, '0');
  // Low-HP intensity (0..1) — powers the red vignette + pulse. 100 HP
  // = 0, 25 HP = full-intensity, dead = frozen at full.
  const hpFrac = Math.max(0, Math.min(1, (snap.hp || 0) / (snap.hpMax || 100)));
  const lowHpAmt = hpFrac < 0.35 ? Math.max(0, 1 - hpFrac / 0.35) : 0;
  return (
    <div className="absolute inset-0 pointer-events-none select-none" data-testid="brawl3d-hud">
      {/* Low-HP vignette — dark red radial fade at edges + pulse. Only
          shown while alive so the death fade takes over cleanly. */}
      {lowHpAmt > 0.01 && !snap.dead && (
        <div
          className="absolute inset-0"
          data-testid="brawl3d-low-hp-vignette"
          style={{
            background:
              `radial-gradient(ellipse at center, transparent 45%, rgba(180,20,20,${(0.55 * lowHpAmt).toFixed(3)}) 100%)`,
            animation: `brawl3dHpPulse ${(0.9 - lowHpAmt * 0.4).toFixed(2)}s ease-in-out infinite`,
          }}
        />
      )}
      <style>{`
        @keyframes brawl3dHpPulse   { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
        @keyframes brawl3dAnnPop    {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4) }
          15%  { opacity: 1; transform: translate(-50%, -50%) scale(1.15) }
          30%  { transform: translate(-50%, -50%) scale(1.0) }
          80%  { opacity: 1; transform: translate(-50%, -50%) scale(1.0) }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.05) }
        }
        @keyframes brawl3dHitArrow  { 0% { opacity: 1 } 100% { opacity: 0 } }
        @keyframes brawl3dPerfectPop {
          0%   { opacity: 0; transform: scale(0.6) }
          20%  { opacity: 1; transform: scale(1.15) }
          40%  { transform: scale(1) }
          80%  { opacity: 1 }
          100% { opacity: 0; transform: translateY(-6px) }
        }
      `}</style>

      {/* Damage flash */}
      {snap.damageFlash > 0 && (
        <div className="absolute inset-0" style={{ background: `rgba(220,38,38,${Math.min(0.35, snap.damageFlash)})` }} />
      )}

      {/* AAA killstreak / multi-kill banner — centered pop-in that fades
          out after ~2s. Tier drives color: 2=silver, 3=gold, 4=red,
          5+=cyan monster-kill. */}
      {snap.announcement && (
        <div
          key={`ann-${snap.announcement.text}-${snap.announcement.age.toFixed(2)}`}
          className="absolute left-1/2 top-[36%] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          data-testid="brawl3d-killstreak-banner"
          style={{
            animation: 'brawl3dAnnPop 2.2s ease-out forwards',
          }}
        >
          <div
            className="font-black tracking-widest"
            style={{
              fontFamily: 'Chivo, sans-serif',
              fontSize: snap.announcement.tier >= 4 ? 96 : snap.announcement.tier >= 3 ? 76 : 60,
              color:
                snap.announcement.tier >= 5 ? '#22d3ee' :
                snap.announcement.tier >= 4 ? '#f87171' :
                snap.announcement.tier >= 3 ? '#facc15' : '#e5e7eb',
              textShadow: '0 0 24px rgba(0,0,0,0.85), 0 4px 0 rgba(0,0,0,0.6)',
              WebkitTextStroke: '2px rgba(0,0,0,0.75)',
            }}
          >
            {snap.announcement.text}
          </div>
        </div>
      )}

      {/* KUNG-FU COMBO COUNTER — right-side vertical readout that pops
          bigger with each successive hit and fades once the chain
          lapses. Colour graduates hot→gold→red so a 5+ chain reads
          as a legitimate finisher window. */}
      {snap.combo && snap.combo.count >= 2 && (
        <div
          key={`combo-${snap.combo.count}`}
          className="absolute right-8 top-[42%] -translate-y-1/2 pointer-events-none text-right"
          data-testid="brawl3d-combo-counter"
          style={{
            fontFamily: 'Chivo, sans-serif',
            color: snap.combo.count >= 5 ? '#f87171'
                 : snap.combo.count >= 3 ? '#facc15'
                 : '#f59e0b',
            textShadow: '0 0 20px rgba(0,0,0,0.85), 0 4px 0 rgba(0,0,0,0.6)',
            WebkitTextStroke: '2px rgba(0,0,0,0.75)',
            opacity: Math.max(0, 1 - snap.combo.age / 1.4),
            transform: `translate(-50%, ${snap.combo.count >= 5 ? '-4px' : 0}) scale(${1 + Math.min(0.35, 0.06 * snap.combo.count)})`,
            transformOrigin: 'right center',
          }}
        >
          <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 0.9 }}>{snap.combo.count}</div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, marginTop: -4 }}>
            HIT COMBO
          </div>
        </div>
      )}

      {/* Hit-direction indicator — red arrow pinned to the reticle
          circle, rotated to face where the damage came FROM. Fades
          over 1.5s from the last hit. Only rendered when we have a
          positional attacker. */}
      {snap.lastHitBy && snap.lastHitBy.dir != null && (
        <div
          key={`hit-${snap.lastHitBy.age.toFixed(2)}`}
          className="absolute left-1/2 -translate-x-1/2"
          data-testid="brawl3d-hit-direction"
          style={{
            top: `${RETICLE_TOP_PCT}%`,
            width: 220,
            height: 220,
            marginLeft: -110,
            marginTop: -110,
            transform: `rotate(${snap.lastHitBy.dir}rad)`,
            transformOrigin: 'center',
            animation: `brawl3dHitArrow 1.5s ease-out forwards`,
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, left: '50%', marginLeft: -22,
              width: 0, height: 0,
              borderLeft:  '22px solid transparent',
              borderRight: '22px solid transparent',
              borderBottom: '34px solid rgba(220,38,38,0.85)',
              filter: 'drop-shadow(0 0 8px rgba(220,38,38,0.85))',
            }}
          />
        </div>
      )}

      {/* Reticle — dead centre, matches camera aim ray */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ top: `${RETICLE_TOP_PCT}%` }}
        data-testid="brawl3d-crosshair"
      >
        <WeaponReticle
          wpnId={snap.wpnId}
          hit={snap.hitMarker > 0}
          moving={snap.moving || 0}
          speedTier={snap.speedTier | 0}
          firing={!!snap.firing}
          reloading={!!snap.reloading}
        />
      </div>

      {/* Match-start countdown — huge centered "3 / 2 / 1 / GO" while
          the announcer is calling it out. Blocks nothing (pointer-
          events-none inherited from parent) so the camera keeps
          responding to look input. */}
      {snap.phase === 'play' && (snap.goFlashT || 0) > 0 && (
        <div className="absolute inset-0 flex items-center justify-center" data-testid="brawl3d-countdown-go">
          <div className="text-yellow-300 font-black text-[200px] leading-none" style={{ textShadow: '0 0 28px rgba(250,204,21,0.9), 0 6px 0 rgba(0,0,0,0.6)', fontFamily: 'Chivo, sans-serif', animation: 'brawl3dCountdownPop 900ms ease-out' }}>GO!</div>
        </div>
      )}
      {snap.phase === 'countdown' && snap.countdownT > 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          data-testid="brawl3d-countdown"
        >
          <div
            className="text-white font-black text-[200px] leading-none"
            style={{
              textShadow: '0 0 24px rgba(250,204,21,0.85), 0 6px 0 rgba(0,0,0,0.6)',
              fontFamily: 'Chivo, sans-serif',
              transform: 'scale(1)',
              animation: 'brawl3dCountdownPop 900ms ease-out',
            }}
            key={Math.ceil(snap.countdownT)}
          >
            {Math.ceil(snap.countdownT)}
          </div>
          <style>{`
            @keyframes brawl3dCountdownPop {
              0%   { opacity: 0; transform: scale(0.55); }
              25%  { opacity: 1; transform: scale(1.15); }
              100% { opacity: 0.9; transform: scale(1.0); }
            }
          `}</style>
        </div>
      )}

      {/* Spawn-shield indicator — 3-second post-spawn invulnerability */}
      {snap.spawnShield > 0.05 && !snap.dead && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-24 flex items-center gap-2 bg-cyan-500/25 border-2 border-cyan-300 rounded-full px-4 py-1"
          data-testid="brawl3d-spawn-shield"
          style={{ boxShadow: '0 0 24px rgba(103,232,249,0.55)' }}
        >
          <span className="text-cyan-100 font-black text-sm tracking-widest">SHIELD</span>
          <span className="text-cyan-200 font-mono text-xs">{snap.spawnShield.toFixed(1)}s</span>
        </div>
      )}

      {/* Top center: scores + timer — hidden in lobby/warehouse mode
          since there's no scoring, no round timer, and no team fight
          happening (it's a chill social space). */}
      {!snap.lobbyMode && (
        <>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/55 border border-white/10 rounded px-4 py-1.5" data-testid="brawl3d-scorebar">
            <span className="font-black text-lg" style={{ color: TEAM_HEX.A }}>{tn(snap, 'A')} {snap.scores.A}</span>
            <span className="text-white/60 text-xs font-mono">{mins}:{secs}</span>
            <span className="font-black text-lg" style={{ color: TEAM_HEX.B }}>{snap.scores.B} {tn(snap, 'B')}</span>
          </div>
          <div className="absolute top-12 left-1/2 -translate-x-1/2 text-white/40 text-[10px] font-mono">
            {snap.gameMode === 'koth' ? `KOTH · FIRST TO ${snap.targetKills}` : `FIRST TO ${snap.targetKills}`}
          </div>
        </>
      )}
      {snap.lobbyMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/55 border border-emerald-500/40 rounded px-4 py-1.5 flex items-center gap-2" data-testid="brawl3d-lobby-badge">
          <i className="fa-solid fa-users text-emerald-300 text-[11px]" />
          <span className="text-emerald-200 font-black text-[11px] tracking-widest">{snap.lobbyLabel || 'LOBBY'} · YOUR LOBBY</span>
          <span className="text-white/40 text-[10px]">Press ESC / START to open Custom / Ranked / Quick Match</span>
        </div>
      )}

      {/* Cover-hug indicator — flashes when the player is crouched
          against a jersey barrier and reads "IN COVER · 85% SOAK"
          so the mechanic is discoverable in-match. */}
      {snap.hugCoverDir != null && !snap.dead && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-16 flex items-center gap-2 bg-amber-500/20 border-2 border-amber-300 rounded-full px-4 py-1"
          data-testid="brawl3d-cover-hug"
          style={{ boxShadow: '0 0 20px rgba(252,211,77,0.55)' }}
        >
          <i className="fa-solid fa-shield-halved text-amber-200 text-[12px]" />
          <span className="text-amber-100 font-black text-sm tracking-widest">IN COVER</span>
          <span className="text-amber-200/80 text-[10px]">85% SOAK</span>
        </div>
      )}
      {/* SPEED-TIER PILL — small readout under the mini-map showing
          the active movement tier. Only renders when the player is
          actually moving so it doesn't clutter the idle HUD. Colors:
          WALK = slate (stealth), JOG = sky (default), SPRINT = amber
          (committed). */}
      {!snap.dead && !snap.inCar && !snap.vaulting && (snap.moving > 0.05) && (
        <div
          className="absolute bottom-24 right-4 flex items-center gap-1.5 bg-black/55 border border-white/15 rounded-full px-2.5 py-0.5"
          data-testid="brawl3d-speed-tier"
          style={{
            boxShadow: snap.speedTier === 2 ? '0 0 12px rgba(251,191,36,0.35)' : 'none',
          }}
        >
          <i className={`fa-solid ${
            snap.speedTier === 0 ? 'fa-shoe-prints' :
            snap.speedTier === 2 ? 'fa-forward-fast' : 'fa-person-walking'
          } text-[10px] ${
            snap.speedTier === 0 ? 'text-slate-300' :
            snap.speedTier === 2 ? 'text-amber-300' : 'text-sky-300'
          }`} />
          <span
            className={`font-black text-[10px] tracking-widest ${
              snap.speedTier === 0 ? 'text-slate-200' :
              snap.speedTier === 2 ? 'text-amber-200' : 'text-sky-200'
            }`}
            data-testid={
              snap.speedTier === 0 ? 'brawl3d-tier-walk' :
              snap.speedTier === 2 ? 'brawl3d-tier-sprint' : 'brawl3d-tier-jog'
            }
          >
            {snap.speedTier === 0 ? 'WALK' : snap.speedTier === 2 ? 'SPRINT' : 'JOG'}
          </span>
          {snap.speedTier === 2 && (
            <span className="text-amber-300/70 text-[9px] font-mono ml-0.5" data-testid="brawl3d-stamina-readout">
              {Math.round(snap.stamina || 0)}
            </span>
          )}
          {snap.speedTier === 2 && snap.sprintChain > 0 && (
            <span className="text-emerald-300 text-[9px] font-black font-mono ml-1" data-testid="brawl3d-sprint-chain">
              ×{snap.sprintChain}
            </span>
          )}
        </div>
      )}
      {/* RHYTHM SPRINT — "PERFECT" pop when a sprint tap lands inside
          the timing window (speed burst + cheaper stamina). */}
      {snap.sprintPerfect && !snap.dead && (
        <div
          className="absolute bottom-32 right-4 px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/60 text-emerald-200 font-black text-[11px] tracking-[0.3em]"
          style={{ animation: 'brawl3dPerfectPop 0.7s ease-out both', boxShadow: '0 0 16px rgba(52,211,153,0.35)' }}
          data-testid="brawl3d-sprint-perfect"
        >
          PERFECT{snap.sprintChain > 1 ? ` ×${snap.sprintChain}` : ''}
        </div>
      )}
      {snap.staminaLocked && !snap.dead && (
        <div className="absolute bottom-32 right-4 px-2.5 py-0.5 rounded-full bg-red-500/15 border border-red-400/50 text-red-200 font-black text-[10px] tracking-[0.25em]" data-testid="brawl3d-stamina-locked">
          WINDED
        </div>
      )}
      {/* VAULT-IN-PROGRESS badge — replaces the reticle briefly so the
          player has feedback about the state machine running. */}
      {snap.vaulting > 0 && !snap.dead && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-black/70 border-2 border-cyan-400 rounded px-4 py-1.5"
          data-testid="brawl3d-vault-badge"
          style={{ boxShadow: '0 0 24px rgba(34,211,238,0.55)' }}
        >
          <i className="fa-solid fa-person-running text-cyan-200 text-[12px]" />
          <span className="text-cyan-100 font-black text-sm tracking-widest">VAULT</span>
        </div>
      )}
      {/* SLOW-MO cinematic overlay — kicks in on the match-winning kill.
          Layered vignette + faint desaturated haze pulls the eye to
          the center of the screen while the final ragdoll plays out
          at 35% real-time. Auto-fades in the last 400ms of the
          effect so the transition back to normal speed reads smooth
          rather than snapping off. */}
      {snap.slowMo > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          data-testid="brawl3d-slowmo-overlay"
          style={{
            opacity: Math.min(1, snap.slowMo * 2.5),
            background:
              'radial-gradient(ellipse at center, transparent 22%, rgba(0,0,0,0.35) 65%, rgba(0,0,0,0.72) 100%), ' +
              'linear-gradient(rgba(140,155,180,0.05), rgba(140,155,180,0.05))',
            mixBlendMode: 'multiply',
          }}
        >
          <div className="absolute top-24 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <span
              className="text-amber-100 font-black tracking-[0.6em] text-sm"
              style={{ textShadow: '0 0 12px rgba(252,211,77,0.85)' }}
              data-testid="brawl3d-slowmo-label"
            >
              FINAL KILL
            </span>
          </div>
        </div>
      )}
      {/* In-vehicle HUD — car HP bar + role + burger-heal indicator */}
      {snap.inCar && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1" data-testid="brawl3d-vehicle-hud">
          <div className="text-[10px] font-black tracking-widest text-yellow-300">
            {snap.inCar.role === 'driver' ? 'DRIVING' : 'PASSENGER'}
            {snap.inCar.burgerHeal && <span className="ml-2 text-emerald-300">· BURGER HEAL ACTIVE</span>}
            <span className="ml-2 text-white/40 font-normal">E / Y to exit</span>
          </div>
          <div className="w-56 h-2 bg-black/60 border border-white/20 rounded overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${100 * (snap.inCar.hp / snap.inCar.hpMax)}%`,
                background: snap.inCar.hp / snap.inCar.hpMax < 0.2 ? '#ef4444'
                  : snap.inCar.hp / snap.inCar.hpMax < 0.4 ? '#f59e0b'
                  : '#22c55e',
              }}
            />
          </div>
          <div className="text-[10px] font-mono text-white/60">CAR HP {snap.inCar.hp} / {snap.inCar.hpMax}</div>
        </div>
      )}

      {/* KOTH hill status badge */}
      {snap.gameMode === 'koth' && snap.hill && (
        <div
          className="absolute top-[68px] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 border border-white/10 rounded px-3 py-1"
          data-testid="brawl3d-hill-status"
        >
          <span className="text-[10px] font-bold tracking-widest text-white/50">HILL · {snap.hill.label || 'ZONE'}</span>
          {snap.hill.contested ? (
            <span className="text-[11px] font-black tracking-widest text-yellow-300">CONTESTED</span>
          ) : snap.hill.controller ? (
            <span
              className="text-[11px] font-black tracking-widest"
              style={{ color: TEAM_HEX[snap.hill.controller] }}
            >
              {tn(snap, snap.hill.controller)} HOLDING
            </span>
          ) : (
            <span className="text-[11px] font-black tracking-widest text-white/40">UNCONTROLLED</span>
          )}
        </div>
      )}

      {/* Kill feed — bottom-right, newest at bottom, older entries fade.
          Structured kill entries: killer (own team color) + weapon glyph
          + victim (own team color). Larger text per user request. */}
      <div className="absolute bottom-12 right-4 flex flex-col items-end justify-end gap-1.5" data-testid="brawl3d-killfeed">
        {snap.killfeed
          .filter(k => (snap.now || 0) - k.t < 6)
          .map((k, i) => {
            const age = (snap.now || 0) - k.t;
            const opacity = age > 5 ? Math.max(0, 1 - (age - 5)) : 1;
            if (k.kill) {
              return (
                <div
                  key={`${k.t.toFixed(2)}-${i}`}
                  className="text-[14px] font-bold bg-black/55 rounded px-2.5 py-1 leading-none flex items-center gap-2"
                  style={{ opacity, transition: 'opacity 300ms' }}
                >
                  <span style={{ color: TEAM_HEX[k.killerTeam] || '#fff' }}>{k.killerName}</span>
                  {WEAPON_ICON[k.weaponId] ? (
                    <img
                      src={WEAPON_ICON[k.weaponId]}
                      alt={k.weaponId}
                      className="h-5 w-8 object-contain drop-shadow"
                      style={{ filter: 'drop-shadow(0 0 3px rgba(250,204,21,0.9))' }}
                    />
                  ) : (
                    <span className="text-yellow-300 text-[11px] font-black tracking-wider px-1.5 py-[2px] bg-black/40 rounded border border-yellow-300/30">
                      {WEAPON_GLYPH[k.weaponId] || WEAPON_GLYPH._default}
                    </span>
                  )}
                  <span style={{ color: TEAM_HEX[k.victimTeam] || '#fff' }}>{k.victimName}</span>
                  {k.teamkill && <span className="text-red-400 text-[11px] font-black ml-1">TK</span>}
                </div>
              );
            }
            return (
              <div
                key={`${k.t.toFixed(2)}-${i}`}
                className="text-[12px] font-bold bg-black/45 rounded px-2 py-0.5"
                style={{ color: k.color, opacity, transition: 'opacity 300ms' }}
              >
                {k.text}
              </div>
            );
          })}
      </div>

      {/* Bottom left: team tag (health lives in the 2D-style dial) */}
      <div className="absolute bottom-4 left-4" data-testid="brawl3d-teamtag">
        <div className="text-[10px] font-bold tracking-widest" style={{ color: TEAM_HEX[snap.myTeam] }}>
          {tn(snap, snap.myTeam)} · {snap.myName}
        </div>
      </div>

      {/* Dead overlay */}
      {snap.dead && snap.phase === 'play' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/40" data-testid="brawl3d-dead">
          <div className="text-red-300 text-3xl font-black tracking-widest">WASTED</div>
          <div className="text-white/70 text-sm mt-2 font-mono">respawn in {Math.max(0, snap.respawnT).toFixed(1)}s</div>
        </div>
      )}

      {/* Scoreboard — Tab hold OR (match ended AND slow-mo done).
          During the 1.8s slow-mo the arena stays visible so the
          winning ragdoll reads cleanly; scoreboard slides in only
          after the cinematic completes. */}
      {(showBoard || (snap.phase === 'end' && (snap.slowMo || 0) <= 0.001)) && (
        <Scoreboard snap={snap} rows={snap.board} scores={snap.scores} winner={snap.winner} phase={snap.phase} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// AAA weapon crosshair (per-gun).
//
// Layered SVG built for AAA-shooter feel:
//   • Deep black outline underlayer  — readable on any background.
//   • Bright white/tinted fill layer — the crisp reticle line.
//   • Coloured accent glow (drop-shadow)
//   • Dynamic bloom — reticle arms spread outward while moving and
//     tighten when the player crouches / stands still (encourages
//     stance play).
//   • Hitmarker cross — the classic 4-arm "kill confirm" X that
//     pulses red when a bullet lands.
//   • Reloading state fades opacity + shrinks scale.
//
// Each weapon has its own silhouette:
//   fist  – no reticle (melee, hidden HUD).
//   bat   – round outline w/ inner corner chevrons (melee arc).
//   pistol – precision dot + 4 chevron ticks + subtle outer ring.
//   tec9  – SMG dashed chevrons w/ centre dot (bloomy).
//   shotgun – 4-quadrant spread pattern (cone brackets around a ring).
//   ak47  – rifle diamond crosshair w/ range ticks.
//   rpg   – rocket-lock diamond brackets + centre reticle.
//   pipebomb – parabola arc w/ throw indicator + centre dot.
// ────────────────────────────────────────────────────────────────
// Weapons whose reticle is served as a transparent PNG from
// `/reticles/*.png`. Everything else falls through to the SVG
// silhouettes below (e.g. pipebomb's throw-arc, default cross).
const PNG_RETICLES = new Set(['pistol', 'tec9', 'shotgun', 'ak47', 'rpg', 'bat']);

function WeaponReticle({ wpnId, hit, moving, speedTier, firing, reloading }) {
  if (wpnId === 'fist') return null;

  // Bloom offset — how far the outer arms spread from centre while
  // moving. Base bloom = 0; walk = +1.4px; jog = +3.2px; sprint = +6.4px.
  // Firing adds a small kick so continuous fire "breathes" outward.
  const walkAmt = Math.max(0, Math.min(1, moving || 0));
  const tierBloom = [0, 1.4, 3.2, 6.4][Math.max(0, Math.min(3, speedTier | 0))] || 0;
  const bloom = tierBloom * (0.5 + walkAmt * 0.5) + (firing ? 1.6 : 0);

  const scale = reloading ? 0.85 : (hit ? 1.15 : 1);
  const alpha = reloading ? 0.5 : 1;

  // ── PNG reticles (user-supplied sheet, sliced per weapon) ────
  // Each weapon has a purpose-built silhouette on disk. Dynamic HUD
  // behaviour (hit pop, reload fade, glow) is layered via CSS over
  // the static PNG so the graphic itself stays crisp.
  if (PNG_RETICLES.has(wpnId)) {
    return (
      <div
        style={{
          position: 'relative',
          width: 72,
          height: 72,
          transform: `scale(${scale * (1 + bloom * 0.006)})`,
          opacity: alpha,
          filter: hit
            ? 'drop-shadow(0 0 8px rgba(239,68,68,0.9)) brightness(1.15)'
            : 'drop-shadow(0 0 3px rgba(2,6,23,0.9))',
          transition: 'transform 90ms ease-out, opacity 180ms ease-out, filter 120ms ease-out',
        }}
      >
        <style>{`
          @keyframes brawl3dHitPop {
            0%   { opacity: 0; transform: scale(0.6); transform-origin: 36px 36px }
            25%  { opacity: 1; transform: scale(1.25); transform-origin: 36px 36px }
            100% { opacity: 0.9; transform: scale(1.0); transform-origin: 36px 36px }
          }
        `}</style>
        <img
          src={`/reticles/${wpnId}.png`}
          alt=""
          width={72}
          height={72}
          draggable={false}
          style={{
            display: 'block',
            imageRendering: '-webkit-optimize-contrast',
            userSelect: 'none',
          }}
        />
        {hit && (
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', animation: 'brawl3dHitPop 220ms ease-out forwards' }}
          >
            <path
              d="M 22 22 L 32 32 M 50 22 L 40 32 M 22 50 L 32 40 M 50 50 L 40 40"
              stroke="#020617"
              strokeWidth="4"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M 22 22 L 32 32 M 50 22 L 40 32 M 22 50 L 32 40 M 50 50 L 40 40"
              stroke="#ef4444"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        )}
      </div>
    );
  }

  // Colour system — muzzle-flash yellow on hit, cool white idle.
  const primary = hit ? '#fca5a5' : '#f8fafc';
  const accent  = hit ? '#ef4444' : '#a3f7bf';         // green-tint accent normally
  const shadow  = hit ? '#7f1d1d' : '#020617';
  const glow    = hit ? 'rgba(239,68,68,0.85)' : 'rgba(148,163,184,0.55)';

  // Two-pass stroke — a thicker dark outline layer under the bright
  // primary. Reads on both bright and dark backgrounds.
  const under  = { stroke: shadow,  strokeWidth: 3.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const over   = { stroke: primary, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const overAcc = { stroke: accent, strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

  // Per-weapon geometry (draws for the "over" layer; a matching
  // "under" layer is stamped underneath in the render below).
  let paths = [];   // [{d, weight?}]  weight: 'accent' | 'primary'
  let shapes = []; // extra <circle>/<rect> nodes rendered on top
  const b = bloom;

  switch (wpnId) {
    case 'bat': {
      // Melee: soft ring with 4 corner arcs — signals "swing arc".
      shapes.push(<circle key="r" cx="36" cy="36" r="14" fill="none" stroke={shadow} strokeWidth="3" />);
      shapes.push(<circle key="r2" cx="36" cy="36" r="14" fill="none" stroke={primary} strokeWidth="1.3" strokeOpacity="0.85" />);
      paths.push({ d: `M22 22 L26 22 L26 26 M50 22 L46 22 L46 26 M22 50 L26 50 L26 46 M50 50 L46 50 L46 46` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1.4" fill={primary} />);
      break;
    }
    case 'pistol': {
      // Precision — small dot + 4 chevrons + subtle outer ring.
      shapes.push(<circle key="ring" cx="36" cy="36" r="16" fill="none" stroke={shadow} strokeWidth="2.4" strokeDasharray="2 4" strokeOpacity="0.85" />);
      shapes.push(<circle key="ring2" cx="36" cy="36" r="16" fill="none" stroke={accent} strokeWidth="0.9" strokeDasharray="2 4" strokeOpacity="0.55" />);
      // Cross with a small gap (center pip)
      paths.push({ d: `M36 ${22 - b} V ${30 - b * 0.4} M36 ${42 + b * 0.4} V ${50 + b} M ${22 - b} 36 H ${30 - b * 0.4} M ${42 + b * 0.4} 36 H ${50 + b}` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1.6" fill={primary} />);
      break;
    }
    case 'tec9': {
      // SMG — wider default bloom, dashed accent arcs.
      const B = b + 2.5;
      paths.push({ d: `M36 ${22 - B} V ${30 - B * 0.35} M36 ${42 + B * 0.35} V ${50 + B} M ${22 - B} 36 H ${30 - B * 0.35} M ${42 + B * 0.35} 36 H ${50 + B}` });
      // Diagonal ticks for spray feel
      paths.push({ d: `M ${26 - B * 0.6} ${26 - B * 0.6} L ${29 - B * 0.4} ${29 - B * 0.4} M ${46 + B * 0.4} ${26 - B * 0.6} L ${43 + B * 0.4} ${29 - B * 0.4} M ${26 - B * 0.6} ${46 + B * 0.6} L ${29 - B * 0.4} ${43 + B * 0.4} M ${46 + B * 0.4} ${46 + B * 0.6} L ${43 + B * 0.4} ${43 + B * 0.4}` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1.1" fill={primary} />);
      break;
    }
    case 'shotgun': {
      // Spread cone — 4 quadrant brackets that grow outward with
      // bloom. No centre dot (you're not sniping with a shotgun).
      const B = b + 4;
      const inner = 8 + B * 0.4;
      const outer = 16 + B;
      // Each bracket is an L-shape at the ring's cardinal.
      paths.push({ d: `M 36 ${36 - outer} L 36 ${36 - inner} M ${36 - 4} ${36 - outer} L 36 ${36 - outer} L ${36 + 4} ${36 - outer}` });
      paths.push({ d: `M 36 ${36 + outer} L 36 ${36 + inner} M ${36 - 4} ${36 + outer} L 36 ${36 + outer} L ${36 + 4} ${36 + outer}` });
      paths.push({ d: `M ${36 - outer} 36 L ${36 - inner} 36 M ${36 - outer} ${36 - 4} L ${36 - outer} 36 L ${36 - outer} ${36 + 4}` });
      paths.push({ d: `M ${36 + outer} 36 L ${36 + inner} 36 M ${36 + outer} ${36 - 4} L ${36 + outer} 36 L ${36 + outer} ${36 + 4}` });
      // 4 diagonal pellet indicators
      const dInner = inner * 0.72;
      const dOuter = outer * 0.72;
      paths.push({ d: `M ${36 - dOuter} ${36 - dOuter} L ${36 - dInner} ${36 - dInner} M ${36 + dOuter} ${36 - dOuter} L ${36 + dInner} ${36 - dInner} M ${36 - dOuter} ${36 + dOuter} L ${36 - dInner} ${36 + dInner} M ${36 + dOuter} ${36 + dOuter} L ${36 + dInner} ${36 + dInner}` });
      break;
    }
    case 'ak47': {
      // Rifle — rotated diamond crosshair with range ticks. Signals
      // an assault rifle at a glance.
      const B = b + 0.5;
      // Diamond outline
      paths.push({ d: `M 36 ${22 - B} L ${50 + B} 36 L 36 ${50 + B} L ${22 - B} 36 Z` });
      // Inner tick marks (range indicator on the vertical rail)
      paths.push({ d: `M 36 ${16 - B} V ${20 - B} M 36 ${52 + B} V ${56 + B} M ${16 - B} 36 H ${20 - B} M ${52 + B} 36 H ${56 + B}` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1.5" fill={primary} />);
      break;
    }
    case 'rpg': {
      // Rocket-lock — 4 diamond brackets around the aim point.
      // Reads as "target lock" reticle.
      const B = b + 1;
      const R = 14 + B;
      paths.push({ d: `M ${36 - R} ${36 - R + 5} L ${36 - R} ${36 - R} L ${36 - R + 5} ${36 - R}` });
      paths.push({ d: `M ${36 + R} ${36 - R + 5} L ${36 + R} ${36 - R} L ${36 + R - 5} ${36 - R}` });
      paths.push({ d: `M ${36 - R} ${36 + R - 5} L ${36 - R} ${36 + R} L ${36 - R + 5} ${36 + R}` });
      paths.push({ d: `M ${36 + R} ${36 + R - 5} L ${36 + R} ${36 + R} L ${36 + R - 5} ${36 + R}` });
      // Centre plus + diamond pip
      paths.push({ d: `M 36 30 V 34 M 36 38 V 42 M 30 36 H 34 M 38 36 H 42` });
      shapes.push(<rect key="pip" x="34.5" y="34.5" width="3" height="3" transform="rotate(45 36 36)" fill={primary} />);
      break;
    }
    case 'pipebomb': {
      // Throw arc — parabola from lower-left to upper-right w/
      // dotted trajectory + centre pip for aim.
      paths.push({ d: `M 18 54 Q 36 12 54 54` });
      // 3 trajectory dots along the arc
      shapes.push(<circle key="d1" cx="26" cy="34" r="1.2" fill={primary} />);
      shapes.push(<circle key="d2" cx="36" cy="24" r="1.5" fill={primary} />);
      shapes.push(<circle key="d3" cx="46" cy="34" r="1.2" fill={primary} />);
      // Small crosshair pip at centre
      paths.push({ d: `M 32 36 H 34 M 38 36 H 40 M 36 32 V 34 M 36 38 V 40` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1" fill={primary} />);
      break;
    }
    default: {
      // Sensible default 4-arm crosshair
      paths.push({ d: `M36 ${22 - b} V ${32 - b * 0.4} M36 ${40 + b * 0.4} V ${50 + b} M ${22 - b} 36 H ${32 - b * 0.4} M ${40 + b * 0.4} 36 H ${50 + b}` });
      shapes.push(<circle key="dot" cx="36" cy="36" r="1.2" fill={primary} />);
    }
  }

  // Hit-marker overlay — bold red X that pops on kill.
  const hitOverlay = hit ? (
    <g style={{ animation: 'brawl3dHitPop 220ms ease-out forwards' }}>
      <path d="M 22 22 L 32 32 M 50 22 L 40 32 M 22 50 L 32 40 M 50 50 L 40 40"
            stroke="#020617" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M 22 22 L 32 32 M 50 22 L 40 32 M 22 50 L 32 40 M 50 50 L 40 40"
            stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </g>
  ) : null;

  return (
    <svg
      width="72" height="72" viewBox="0 0 72 72"
      style={{
        filter: `drop-shadow(0 0 4px ${glow}) drop-shadow(0 0 1.5px ${shadow})`,
        transform: `scale(${scale})`,
        opacity: alpha,
        transition: 'transform 90ms ease-out, opacity 180ms ease-out',
      }}
    >
      <style>{`
        @keyframes brawl3dHitPop {
          0%   { opacity: 0; transform: scale(0.6); transform-origin: 36px 36px }
          25%  { opacity: 1; transform: scale(1.25); transform-origin: 36px 36px }
          100% { opacity: 0.9; transform: scale(1.0); transform-origin: 36px 36px }
        }
      `}</style>
      {/* Under (dark outline) layer — every path stamped in shadow colour first */}
      {paths.map((p, i) => <path key={`u${i}`} d={p.d} {...under} />)}
      {/* Over (primary bright) layer */}
      {paths.map((p, i) => <path key={`o${i}`} d={p.d} {...(p.weight === 'accent' ? overAcc : over)} />)}
      {/* Extra shapes (rings, dots, pips) */}
      {shapes}
      {/* Hitmarker (drawn last so it pops above everything) */}
      {hitOverlay}
    </svg>
  );
}

function fmtClock(s) {
  const v = Math.max(0, Math.round(s || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────
// Scoreboard — hold V during the match, and the full results board
// once the match ends. Two team columns (mine left), per-player
// SCORE / K / D / K·D / BEST STREAK, live status dots, MVP crown,
// and on the end screen a VICTORY / DEFEAT / DRAW banner relative to
// MY team plus a team score bar and match summary.
function Scoreboard({ snap, rows, scores, winner, phase }) {
  const ended = phase === 'end';
  const mine = snap.myTeam || 'A';
  const other = mine === 'A' ? 'B' : 'A';
  const teams = [mine, other];
  const result = !ended ? null : winner === 'DRAW' ? 'DRAW' : (winner === mine ? 'VICTORY' : 'DEFEAT');
  const resultColor = result === 'VICTORY' ? '#a3f7bf' : result === 'DEFEAT' ? '#fb7185' : '#ffffff';
  const total = Math.max(1, (scores?.A || 0) + (scores?.B || 0));
  const mvp = rows.find((r) => r.mvp);
  const koth = snap.gameMode === 'koth';
  const cols = 'grid grid-cols-[minmax(0,1fr)_56px_36px_36px_44px_44px] gap-x-2 items-center';
  return (
    <div
      className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[860px] max-w-[94vw] rounded-xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.6)] overflow-hidden ${ended ? 'bg-neutral-950/95' : 'bg-black/80 backdrop-blur-md'}`}
      style={{ animation: 'brawlBoardIn 260ms cubic-bezier(.2,.8,.2,1)' }}
      data-testid="brawl3d-scoreboard"
    >
      <style>{`
        @keyframes brawlBoardIn { from { opacity: 0; transform: translate(-50%, -46%) scale(.98) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
        @keyframes brawlRowIn { from { opacity: 0; transform: translateX(-8px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-end justify-between gap-4 border-b border-white/10">
        <div>
          <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">{ended ? 'Match results' : 'Scoreboard'}</div>
          {ended ? (
            <div className="text-4xl sm:text-5xl font-black tracking-widest leading-none mt-1" style={{ color: resultColor, textShadow: `0 0 24px ${resultColor}55` }} data-testid="brawl3d-winner">
              {result}
            </div>
          ) : (
            <div className="text-2xl font-black tracking-widest leading-none mt-1 text-white">{(snap.gameMode || 'TDM').toUpperCase()}</div>
          )}
        </div>
        <div className="text-right font-mono text-xs text-white/50" data-testid="brawl3d-board-meta">
          <div>{(snap.gameMode || 'tdm').toUpperCase()}{snap.lobbyLabel ? ` · ${snap.lobbyLabel}` : ''}</div>
          <div>{ended ? `played ${fmtClock(300 - (snap.timeLeft || 0))}` : `${fmtClock(snap.timeLeft)} left`}{snap.targetKills ? ` · first to ${snap.targetKills}` : ''}</div>
        </div>
      </div>

      {/* Team score bar */}
      <div className="px-6 py-3 flex items-center gap-3" data-testid="brawl3d-board-scorebar">
        <span className="font-black text-lg tabular-nums" style={{ color: TEAM_HEX[mine] }}>{tn(snap, mine)} {scores?.[mine] ?? 0}</span>
        <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden flex">
          <div className="h-full transition-all duration-500" style={{ width: `${((scores?.[mine] || 0) / total) * 100}%`, background: TEAM_HEX[mine] }} />
          <div className="h-full flex-1 transition-all duration-500" style={{ background: TEAM_HEX[other], opacity: 0.85 }} />
        </div>
        <span className="font-black text-lg tabular-nums" style={{ color: TEAM_HEX[other] }}>{scores?.[other] ?? 0} {tn(snap, other)}</span>
      </div>

      {/* Team columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 pb-4">
        {teams.map((team) => {
          const list = rows.filter((r) => r.team === team);
          const tk = list.reduce((a, r) => a + (r.kills || 0), 0), td = list.reduce((a, r) => a + (r.deaths || 0), 0);
          return (
            <div key={team} className="rounded-lg bg-white/[0.03] border border-white/10 overflow-hidden" data-testid={`brawl3d-board-team-${team}`}>
              <div className="px-3 py-2 flex items-center justify-between border-b border-white/10" style={{ background: `${TEAM_HEX[team]}18` }}>
                <span className="font-black text-sm tracking-wider" style={{ color: TEAM_HEX[team] }}>{tn(snap, team)}{team === mine ? ' · YOUR SQUAD' : ''}</span>
                <span className="font-mono text-[11px] text-white/60">{tk} K · {td} D</span>
              </div>
              <div className={`${cols} px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-white/35`}>
                <span>Player</span><span className="text-right">Score</span><span className="text-right">K</span><span className="text-right">D</span><span className="text-right">K·D</span><span className="text-right">Streak</span>
              </div>
              {list.length === 0 && <div className="px-3 pb-3 text-[11px] text-white/30 italic">no players</div>}
              {list.map((r, i) => (
                <div
                  key={r.id}
                  className={`${cols} px-3 py-1.5 text-[12px] border-t border-white/5 ${r.me ? 'bg-yellow-300/10 text-yellow-200 font-bold' : r.bot ? 'text-white/75' : 'text-white/90'}`}
                  style={{ animation: `brawlRowIn 220ms ${i * 40}ms both` }}
                  data-testid={`brawl3d-board-row-${r.id}`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${r.dead ? 'bg-red-400' : 'bg-emerald-400'}`} title={r.dead ? 'down' : 'alive'} />
                    <span className="truncate">{r.name}</span>
                    {r.mvp && <span className="shrink-0 text-[9px] px-1 rounded bg-yellow-400 text-black font-black tracking-wider" data-testid="brawl3d-board-mvp">MVP</span>}
                    {r.streak >= 3 && !ended && <span className="shrink-0 text-[9px] text-orange-300 font-mono">🔥{r.streak}</span>}
                  </span>
                  <span className="text-right font-mono tabular-nums">{r.score}</span>
                  <span className="text-right font-mono tabular-nums">{r.kills}</span>
                  <span className="text-right font-mono tabular-nums">{r.deaths}</span>
                  <span className="text-right font-mono tabular-nums">{(r.kd ?? (r.deaths ? r.kills / r.deaths : r.kills)).toFixed(2)}</span>
                  <span className="text-right font-mono tabular-nums">{r.best ?? 0}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer: MVP + summary */}
      <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between gap-4 text-xs">
        <div className="font-mono text-white/60" data-testid="brawl3d-board-summary">
          {mvp ? <span><span className="text-yellow-300 font-bold">MVP</span> {mvp.name} — {mvp.kills} kills · {mvp.best} streak · {mvp.score} pts</span> : 'No kills yet — get in there.'}
        </div>
        <div className="text-white/35">{koth ? 'Hill time scores the team; kills score you.' : 'Score = 100 × kills + streak bonus'}</div>
      </div>
    </div>
  );
}
