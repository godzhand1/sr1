// Circular weapon wheel — opens while the player holds B (keyboard) or
// the gamepad B button.  Each carried weapon occupies one half-transparent
// circle arranged around a 240×240 ring.  The player picks a weapon by
// (a) clicking the slot, (b) pressing 1-N on the keyboard, or (c) tilting
// the left stick — the wheel listens to `stateRef.current.player.inputs`
// for the gamepad stick direction and highlights the nearest slot.
//
// Tab-cycle is unchanged (the simpler "next-slot" path still lives in
// `tickPlayer`).  The wheel is the slower, deliberate choice.
//
// PIMP SLAP note: pimpslap never gets its own wheel circle. While
// owned (player.hasPimpSlap), it visually REPLACES the fist slot
// (name/stats swap) but keeps fist's underlying engine index so
// ammo/reserve/equipped lookups and onPick() still resolve correctly.
// The engine's own slotRequest handler already redirects "fist slot"
// presses to the pimpslap weapon index when owned, so onPick(fistIdx)
// continues to work unchanged.

import { useEffect, useRef, useState } from 'react';

// Weapon-ID → PNG icon path. Icons live in /public/icons — same set the
// chess/streetfight UI already uses. Any weapon missing an icon falls
// back to the name text render below.
const WEAPON_ICON_PATH = {
  bat:      '/icons/bat.png',
  pimpslap: '/icons/pimp_slap.png',
  pistol:   '/icons/pistol.png',
  tec9:     '/icons/tec9.png',
  shotgun:  '/icons/shotgun.png',
  ak47:     '/icons/ak47.png',
  rpg:      '/icons/rpg.png',
  pipebomb: '/icons/pipe_bomb.png',
};

export default function WeaponWheel({ stateRef, open, onPick, onClose }) {
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [tick, setTick] = useState(0);     // re-render hook for stick polling
  // 60Hz tick while the wheel is open so we follow the analog stick.
  useEffect(() => {
    if (!open) return undefined;
    // Default the highlight to the currently-equipped slot so just
    // tapping B + releasing keeps the same weapon.
    const s0 = stateRef.current;
    setSelectedIdx(s0?.player?.weaponIdx ?? -1);
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, stateRef]);

  // When the wheel closes (B released), equip whatever the user last
  // highlighted.  This is the single Saints-Row-like flow: hold B, push
  // stick toward a slot, release — and the gun is in your hand on the
  // very next frame.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current && !open && selectedIdx >= 0) {
      onPick(selectedIdx);
    }
    prevOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Read carried weapons from the live game state.
  const s = stateRef.current;
  const rawWeapons = (s && s.player && s.player.weapons) || [];
  const hasPimpSlap = !!s?.player?.hasPimpSlap;

  // Build the wheel's slot list: every weapon EXCEPT pimpslap gets its
  // own circle. The fist slot is swapped to show Pimp Slap's name/stats
  // when owned, but its `idx` still points at fist's actual array index
  // so ammo/reserve/equipped lookups stay correct — clicking it calls
  // onPick(fist's real index), which the engine already redirects to
  // the pimpslap weapon when m.hasPimpSlap is true.
  const pimpSlapRawIdx = rawWeapons.findIndex((w) => w.id === 'pimpslap');
  const weapons = rawWeapons
    .map((w, i) => ({ ...w, idx: i }))
    .filter((w) => w.id !== 'pimpslap')
    .map((w) => {
      if (w.id === 'fist' && hasPimpSlap && pimpSlapRawIdx >= 0) {
        const ps = rawWeapons[pimpSlapRawIdx];
        return { ...ps, idx: w.idx };   // display Pimp Slap, but keep fist's idx
      }
      return w;
    });

  // Stick-based selection: take the left-stick axes from the inputs,
  // convert to an angle, snap to nearest slot.  Falls back to current
  // selected idx when stick is centred.
  useEffect(() => {
    if (!open || !s) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let ax = 0, ay = 0, mag = 0;
    for (const p of pads) {
      if (!p) continue;
      ax = p.axes[0] || 0;
      ay = p.axes[1] || 0;
      mag = Math.hypot(ax, ay);
      if (mag > 0.3) break;
    }
    if (mag > 0.3 && weapons.length) {
      const ang = Math.atan2(ay, ax);
      // 0 rad = right; slot 0 sits at the TOP (-π/2), going clockwise.
      const N = weapons.length;
      let normalized = (ang + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
      const slotPos = Math.round((normalized / (Math.PI * 2)) * N) % N;
      setSelectedIdx(weapons[slotPos].idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, open]);

  if (!open) return null;

  const cx = 120, cy = 120;          // SVG center
  const ringR = 86;                   // radius of slot centers
  const slotR = 30;                   // each slot circle radius
  const N = weapons.length || 1;

  return (
    <div
      className="fixed bottom-6 right-6 z-[210] pointer-events-none select-none"
      style={{ width: 240, height: 260 }}
      data-testid="weapon-wheel"
    >
      <svg width={240} height={240} viewBox="0 0 240 240">
        {/* Outer transparent ring */}
        <circle cx={cx} cy={cy} r={ringR + slotR + 8} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.20)" strokeWidth="2" />
        {/* Inner stick indicator */}
        <circle cx={cx} cy={cy} r={ringR - slotR - 8} fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#fff" fontSize="11" fontFamily="Chivo, sans-serif" fontWeight="800">
          WEAPONS
        </text>

        {weapons.map((w, i) => {
          // Slot 0 at top, going clockwise.
          const ang = -Math.PI / 2 + (i / N) * Math.PI * 2;
          const x = cx + ringR * Math.cos(ang);
          const y = cy + ringR * Math.sin(ang);
          const realIdx = w.idx;
          const active = realIdx === selectedIdx;
          const equipped = realIdx === (s?.player?.weaponIdx ?? 0);
          // Weapons the player OWNS (mag or reserve > 0) but has run
          // dry never stop showing in the wheel — you can still see
          // WHICH slot the weapon belongs to and swap back once you
          // find ammo. Only totally unowned slots (never picked up)
          // render dim. Melee slots are always shown.
          const ammoArr = s?.player?.ammo;
          const reserveArr = s?.player?.reserve;
          const disabledIds = s?.player?.disabledIds;
          const isRanged = w.mag != null;
          const mag = Array.isArray(ammoArr) ? (ammoArr[realIdx] | 0) : 0;
          const reserve = Array.isArray(reserveArr) ? (reserveArr[realIdx] | 0) : 0;
          // Pimp-slap counts as owned once you've picked it up even
          // though it has no mag; the hasPimpSlap flag proxies for
          // ownership on that specific slot.
          const owned = !isRanged
            || mag > 0 || reserve > 0
            || (w.id === 'pimpslap' && !!s?.player?.hasPimpSlap);
          // "Empty" now only means UNOWNED — the visual style used for
          // slots you never picked up. Weapons you own with 0 ammo
          // still render with their name so the wheel doesn't collapse
          // on you mid-fight.
          const empty = isRanged && !owned;
          const dry = isRanged && owned && mag === 0 && reserve === 0;
          // Disabled = seat-rule lockout (e.g. driver can't pick the
          // AK/shotgun while in the seat). Visually greyed, click is
          // swallowed.
          const disabled = !!(disabledIds && disabledIds.has(w.id));
          return (
            <g
              key={w.id || i}
              onClick={() => { if (!disabled) onPick(realIdx); }}
              style={{ pointerEvents: 'auto', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1 }}
              data-testid={`weapon-wheel-slot-${realIdx}`}
            >
              <circle
                cx={x}
                cy={y}
                r={slotR}
                fill={disabled ? 'rgba(60,60,60,0.5)' : empty ? 'rgba(0,0,0,0.35)' : dry ? 'rgba(80,20,20,0.6)' : active ? 'rgba(250,204,21,0.65)' : equipped ? 'rgba(250,204,21,0.30)' : 'rgba(0,0,0,0.55)'}
                stroke={disabled ? 'rgba(160,160,160,0.4)' : empty ? (active ? '#fde047aa' : 'rgba(255,255,255,0.18)') : dry ? '#f87171cc' : active ? '#fde047' : equipped ? '#fde047' : 'rgba(255,255,255,0.40)'}
                strokeWidth={empty ? (active ? 2 : 1) : active ? 3 : 1.5}
                strokeDasharray={empty ? '3 3' : undefined}
              />
              {!empty && (
                <>
                  {WEAPON_ICON_PATH[w.id] ? (
                    <image
                      href={WEAPON_ICON_PATH[w.id]}
                      x={x - slotR * 0.6}
                      y={y - slotR * 0.6}
                      width={slotR * 1.2}
                      height={slotR * 1.2}
                      style={{
                        opacity: disabled ? 0.35 : 1,
                        filter: dry ? 'grayscale(0.7) brightness(0.6)' : 'drop-shadow(0 0 3px rgba(0,0,0,0.7))',
                      }}
                    />
                  ) : (
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      fill={disabled ? '#888' : dry ? '#fca5a5' : '#fff'}
                      fontSize="10"
                      fontFamily="Chivo, sans-serif"
                      fontWeight="800"
                    >
                      {w.name.toUpperCase().slice(0, 6)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="text-center text-[10px] text-white/60 font-bold tracking-widest mt-1">
        TILT STICK / 1-{N} TO PICK
      </div>
    </div>
  );
}