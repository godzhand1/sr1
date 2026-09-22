// React shell for the Streetfight game.  Hosts the canvas, runs the RAF
// loop, wires keyboard + on-screen mobile controls, and lets the user
// pick a character before kicking off Mission 1.
import { useEffect, useRef, useState } from 'react';
import { CHARACTERS, buildCharacterRecord, buildCustomCharacterRecord } from './characters.js';
import { MISSIONS, missionById, cloneMission } from './missions/index.js';
import { makeInitialState, tick, render, WORLD } from './engine.js';
import CharacterCreator from './CharacterCreator.jsx';
import MissionSelect from './MissionSelect.jsx';
import WeaponWheel from './WeaponWheel.jsx';
import SoundTester from './SoundTester.jsx';
import { loadBuild, maleSpriteFor, femaleSpriteFor } from './characterBuilder.js';
import { preloadAllWeaponSounds, resumeAudio } from './sounds.js';
import { CoopClient } from './coop.js';
import { listInvitees, createLobby, inviteToLobby } from './lobbyApi.js';

const KEY_MAP = {
  a: 'left',  ArrowLeft: 'left',
  d: 'right', ArrowRight: 'right',
  w: 'up',    ArrowUp: 'up',
  s: 'down',  ArrowDown: 'down',
  j: 'fire',  z: 'fire',
  k: 'melee', x: 'melee',
  r: 'reload',
  h: 'eat',
  ' ': 'jump',
  e: 'interact',
  // B / Tab opens the weapon wheel.  Releasing it cycles to the next
  // weapon if no slot is highlighted.
  b: 'wheel', Tab: 'wheel',
  c: 'crouch', Shift: 'crouch',
};

export default function StreetfightGame({ onClose, lobbyId }) {
  const [characterId, setCharacterId] = useState(null);
  const [customBuild, setCustomBuild] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [missionId, setMissionId] = useState(null);
  const [running, setRunning] = useState(false);
  const stateRef = useRef(null);
  const metaRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  // Boot a fresh game when the player has picked a character AND a
  // mission. Both are needed — the mission select screen only shows
  // after character select (or auto-picks Mission 1 for lobby joins
  // that pre-set a character via preset selection).
  useEffect(() => {
    if (!characterId || !missionId) return undefined;
    const character = characterId === 'custom'
      ? buildCustomCharacterRecord(customBuild)
      : buildCharacterRecord(characterId);
    // Clone the picked mission so each playthrough starts with fresh
    // `_fired` flags (see cloneMission in missions/index.js).
    const mission = cloneMission(missionById(missionId));
    stateRef.current = makeInitialState(mission, character);
    // Lobby co-op — only connects when the player came in through the
    // lobby browser (lobbyId prop).  No lobby = solo play (the pause
    // menu can still spin up an invite-only lobby on demand).
    metaRef.current = characterId === 'custom'
      ? { kind: 'custom', build: customBuild || loadBuild() }
      : { kind: 'preset', id: characterId };
    const coop = new CoopClient();
    if (lobbyId) {
      coop.connect(metaRef.current, lobbyId);
    }
    stateRef.current.coop = coop;
    window.__sfState = stateRef.current;   // debug/testing handle
    preloadAllWeaponSounds();
    setRunning(true);
    return () => {
      coop.disconnect();
      setRunning(false);
      cancelAnimationFrame(rafRef.current);
    };
  }, [characterId, customBuild, lobbyId, missionId]);

  // RAF loop.
  useEffect(() => {
    if (!running) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    canvas.width = WORLD.viewW;
    canvas.height = WORLD.viewH;
    // Crisp pixel-art rendering — without this, bilinear scaling of
    // 341×512 source sprites down to 96×96 entity slots smears edge
    // alpha across adjacent transparent pixels, producing a faint
    // rectangular "halo" around the character (most visible on
    // ak47_fire where the original muzzle-flash bounding box was
    // larger than the character).
    ctx.imageSmoothingEnabled = false;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (s) {
        tick(s, dt);
        render(ctx, s, null);
        // ~10Hz co-op state sync (throttled inside the client).
        if (s.coop) s.coop.sendStateThrottled(s.player, now);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  // Keyboard.  Writes into a ref so the gamepad poll can merge it each
  // frame (OR-ing into player.inputs directly leaves keys "stuck on"
  // when the player releases the stick).
  const kbRef = useRef({ left:false, right:false, up:false, down:false, fire:false, melee:false, jump:false, interact:false, switchWeapon:false, crouch:false, wheel:false, reload:false, eat:false });
  const [wheelOpen, setWheelOpen] = useState(false);
  const [soundTester, setSoundTester] = useState(false);
  useEffect(() => {
    if (!running) return undefined;
    const onKey = (e, isDown) => {
      // Esc toggles the pause menu (with the in-game invite panel).
      if (isDown && e.key === 'Escape') {
        e.preventDefault();
        const s = stateRef.current;
        if (s && !s.over) s.paused = !s.paused;
        return;
      }
      // Shift+S during gameplay opens the sound auditioner.  Works as
      // a hold/release toggle on key-down only.
      if (isDown && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        setSoundTester(v => !v);
        return;
      }
      const mapped = KEY_MAP[e.key];
      if (!mapped) return;
      e.preventDefault();
      // Number keys 1..N pick a weapon slot directly when the wheel is up.
      kbRef.current[mapped] = isDown;
      if (mapped === 'wheel') setWheelOpen(isDown);
    };
    // Number-row 1..9 for direct weapon slot pick.
    const onNumKey = (e) => {
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 1 || n > 9) return;
      const s = stateRef.current;
      if (s && s.player && s.player.weapons.length >= n) {
        s.player.weaponIdx = n - 1;
      }
    };
    const dn = (e) => { onKey(e, true); onNumKey(e); resumeAudio(); };
    const up = (e) => onKey(e, false);
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, [running]);

  // Gamepad — poll once per frame and translate to the same player.inputs
  // shape the keyboard handler writes to.  Works with any Standard
  // Gamepad mapping (Xbox / PlayStation / generic) via the browser
  // Gamepad API.  Mapping:
  //   Left stick / D-pad → move
  //   A   (button 0) → jump
  //   B   (button 1) → punch (melee)
  //   X   (button 2) → fire
  //   Y   (button 3) → recruit
  //   RT  (button 7) → fire (alt — feels right with trigger pulls)
  //   Start (button 9) → pause
  useEffect(() => {
    if (!running) return undefined;
    let raf = 0;
    let pauseLatch = false;
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const s = stateRef.current;
      if (s && s.player.inputs) {
        const i = s.player.inputs;
        const kb = kbRef.current;
        let gpLeft = false, gpRight = false, gpUp = false, gpDown = false;
        let gpFire = false, gpMelee = false, gpJump = false, gpInteract = false;
        let gpSwitch = false, gpCrouch = false;
        let gpPause = false;
        for (const p of pads) {
          if (!p) continue;
          const ax = p.axes[0] || 0;
          const ay = p.axes[1] || 0;
          const DZ = 0.25;
          if (ax < -DZ) gpLeft = true;
          if (ax >  DZ) gpRight = true;
          if (ay < -DZ) gpUp = true;
          if (ay >  DZ) gpDown = true;
          if (p.buttons[14]?.pressed) gpLeft = true;
          if (p.buttons[15]?.pressed) gpRight = true;
          if (p.buttons[12]?.pressed) gpUp = true;
          // NOTE: D-pad DOWN (button 13) is reserved for the
          // "Eat Cheeseburger" healing action.  We deliberately do NOT
          // map it to gpDown movement — if both were set, the player
          // would walk forward and the eat-cancel-on-move logic would
          // interrupt the heal instantly.  Left-stick down (axis 1
          // below) still moves the player as expected.
          // A=jump, B=weapon switch (user request), X=fire, Y=recruit.
          // Y also doubles as melee/punch (LB) for fallback combat.
          if (p.buttons[0]?.pressed) gpJump = true;
          if (p.buttons[1]?.pressed) gpSwitch = true;
          if (p.buttons[2]?.pressed) gpFire = true;
          if (p.buttons[3]?.pressed) gpInteract = true;
          // LB = melee.  RB = secondary weapon switch alias.
          if (p.buttons[4]?.pressed) gpMelee = true;
          if (p.buttons[5]?.pressed) gpSwitch = true;
          // Triggers — RT/LT for fire/melee respectively.
          if (p.buttons[7]?.pressed || (p.buttons[7]?.value || 0) > 0.4) gpFire = true;
          if (p.buttons[6]?.pressed || (p.buttons[6]?.value || 0) > 0.4) gpMelee = true;
          // L3 (stick click) = crouch.
          if (p.buttons[10]?.pressed) gpCrouch = true;
          if (p.buttons[9]?.pressed) gpPause = true;
        }
        // Merge keyboard + gamepad each frame.  This guarantees releasing
        // either device properly resets the input.
        i.left     = kb.left     || gpLeft;
        i.right    = kb.right    || gpRight;
        i.up       = kb.up       || gpUp;
        i.down     = kb.down     || gpDown;
        i.fire     = kb.fire     || gpFire;
        i.melee    = kb.melee    || gpMelee;
        i.jump     = kb.jump     || gpJump;
        i.interact = kb.interact || gpInteract;
        i.switchWeapon = kb.switchWeapon || gpSwitch;
        i.crouch   = kb.crouch   || gpCrouch;
        i.reload   = kb.reload || (pads.some(pad => pad && pad.buttons[2]?.pressed && pad.buttons[3]?.pressed));
        // Eat — hold DOWN on D-pad (button 13) to nibble a cheeseburger.
        // Keyboard alias: hold H key.
        const gpEat = pads.some(pad => pad && pad.buttons[13]?.pressed);
        i.eat      = kb.eat || gpEat;
        // Wheel open mirrors the B button hold — opens UI overlay; the
        // simple Tab-cycle inside tickPlayer still works because the
        // engine sees the same `switchWeapon` edge-trigger.
        const wheelHeld = kb.wheel || gpSwitch;
        setWheelOpen(prev => (prev !== wheelHeld ? wheelHeld : prev));
        if (gpPause && !pauseLatch) {
          s.paused = !s.paused;
          pauseLatch = true;
        } else if (!gpPause) {
          pauseLatch = false;
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Restart at last checkpoint when busted.
  const onRestart = () => {
    const s = stateRef.current;
    if (!s) return;
    const cp = s.checkpoint;
    const character = s.player.character;
    // Rebuild the mission from the currently-selected id so a restart
    // stays in the same chapter the player picked.
    const mission = cloneMission(missionById(missionId || MISSIONS[0].id));
    const fresh = makeInitialState(mission, character);
    fresh.segIdx = Math.min(cp.segIdx, mission.segments.length - 1);
    fresh.player.x = cp.x;
    fresh.cameraX = Math.max(0, cp.x - 280);
    stateRef.current = fresh;
  };

  // Character select screen.
  if (!characterId) {
    if (showCreator) {
      return (
        <CharacterCreator
          onClose={() => setShowCreator(false)}
          onSave={(build) => {
            setCustomBuild(build);
            setShowCreator(false);
            setCharacterId('custom');
          }}
        />
      );
    }
    const savedBuild = loadBuild();
    const customPreview = savedBuild.gender === 'female'
      ? femaleSpriteFor(savedBuild, 'idle')
      : maleSpriteFor(savedBuild, 'idle');
    return (
      <div
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/85 backdrop-blur overflow-y-auto py-8"
        style={{ touchAction: 'manipulation' }}
        data-testid="streetfight-character-select"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/70 hover:text-white text-xs"
          data-testid="streetfight-close"
        >✕ CLOSE</button>
        <h1 className="text-white text-3xl font-black tracking-widest mb-2">PICK YOUR SAINT</h1>
        <p className="text-white/60 text-xs mb-8">Stilwater is waiting</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 px-4 max-w-5xl w-full">
          {Object.values(CHARACTERS).map(c => (
            <button
              key={c.id}
              onClick={() => setCharacterId(c.id)}
              className="group bg-zinc-900 border border-zinc-700 hover:border-yellow-500 rounded-lg p-4 text-left transition"
              data-testid={`streetfight-pick-${c.id}`}
            >
              <img src={c.portrait} alt={c.name} className="w-full h-32 object-contain" draggable={false} />
              <div className="mt-3 text-white font-black text-lg">{c.name}</div>
              <div className="text-white/60 text-xs">{c.blurb}</div>
              <div className="mt-2 text-yellow-400 text-xs font-bold uppercase">Starts with: {c.id === 'switch' ? 'SMG' : c.id === 'boomer' ? 'Shotgun' : 'Pistol'}</div>
            </button>
          ))}
          {/* Custom saint tile */}
          <button
            onClick={() => setShowCreator(true)}
            className="group bg-gradient-to-br from-purple-950 to-zinc-900 border-2 border-dashed border-purple-500/60 hover:border-yellow-500 rounded-lg p-4 text-left transition"
            data-testid="streetfight-pick-custom"
          >
            <img src={customPreview} alt="custom" className="w-full h-32 object-contain bg-black/30 rounded" style={{ imageRendering: 'pixelated' }} draggable={false} />
            <div className="mt-3 text-yellow-300 font-black text-lg">CREATE A SAINT</div>
            <div className="text-white/60 text-xs">Customize race, hair, fit. Buy clothes with cash you earn.</div>
            <div className="mt-2 text-yellow-400 text-xs font-bold uppercase">Starts with: Pistol</div>
          </button>
        </div>
        {customBuild && (
          <button
            onClick={() => setCharacterId('custom')}
            className="mt-5 px-5 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
            data-testid="streetfight-play-custom"
          >▶ PLAY AS YOUR SAINT</button>
        )}
        <div className="text-white/40 text-[10px] mt-6 max-w-xl text-center px-4 space-y-1">
          <div>Keyboard: WASD = move • J = fire • B/Tab = weapon switch • Space = jump • Shift/C = crouch • E = recruit • K = melee</div>
          <div>Gamepad: stick / D-pad = move • A = jump • B = weapon switch • X = fire • Y = recruit • L3 = crouch • LB = punch • RT = fire</div>
        </div>
      </div>
    );
  }

  // Mission select — character is chosen, now pick a chapter. All 3
  // missions unlock from the start (per design). Falls straight to
  // Mission 1 if the player came in through a lobby invite (lobbyId
  // present) so co-op matches don't get stuck on the picker.
  if (!missionId) {
    if (lobbyId) {
      setMissionId(MISSIONS[0].id);
      return null;
    }
    return (
      <MissionSelect
        onPick={(id) => setMissionId(id)}
        onBack={() => setCharacterId(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black"
      data-testid="streetfight-game"
    >
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full bg-black"
          style={{
            imageRendering: 'pixelated',
            aspectRatio: `${WORLD.viewW} / ${WORLD.viewH}`,
            width: 'min(100vw, calc(100vh * ' + (WORLD.viewW/WORLD.viewH) + '))',
          }}
          data-testid="streetfight-canvas"
        />
        {/* Overlay UI for game-over / pause */}
        <GameOverlay onClose={onClose} onRestart={onRestart} onChangeChar={() => { setCharacterId(null); setMissionId(null); }} stateRef={stateRef} />
        <PauseMenu stateRef={stateRef} metaRef={metaRef} onClose={onClose} />
        <MobileControls stateRef={stateRef} />
        <WeaponWheel
          stateRef={stateRef}
          open={wheelOpen}
          onPick={(idx) => {
            const st = stateRef.current;
            if (st && st.player && st.player.weapons[idx]) {
              st.player.weaponIdx = idx;
            }
            setWheelOpen(false);
            kbRef.current.wheel = false;
          }}
        />
        {soundTester && <SoundTester onClose={() => setSoundTester(false)} />}
      </div>
    </div>
  );
}

// Polls state.paused to surface the pause menu with the in-game invite
// panel: invite friends + gang-mates straight into your lobby.  If you
// were playing SOLO, the first invite spins up an invite-only lobby on
// the fly and connects you to it.
function PauseMenu({ stateRef, metaRef, onClose }) {
  const [paused, setPaused] = useState(false);
  const [invitees, setInvitees] = useState(null);
  const [sent, setSent] = useState({});
  const [err, setErr] = useState('');

  useEffect(() => {
    const id = setInterval(() => {
      setPaused(!!stateRef.current?.paused && !stateRef.current?.over);
    }, 200);
    return () => clearInterval(id);
  }, [stateRef]);

  useEffect(() => {
    if (paused && invitees === null) {
      listInvitees().then(setInvitees).catch(() => setInvitees([]));
    }
  }, [paused, invitees]);

  const ensureLobby = async () => {
    const s = stateRef.current;
    if (s.coop && s.coop.connected && s.coop.lobby) return s.coop.lobby.id;
    const uname = localStorage.getItem('sr_community_username') || 'SAINT';
    const lob = await createLobby(`${uname}'s Streets`, 'invite');
    if (s.coop) s.coop.connect(metaRef.current, lob.id);
    return lob.id;
  };

  const invite = async (uid) => {
    setErr('');
    try {
      const lid = await ensureLobby();
      await inviteToLobby(lid, uid);
      setSent(m => ({ ...m, [uid]: true }));
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Invite failed');
    }
  };

  const resume = () => { const s = stateRef.current; if (s) s.paused = false; };

  if (!paused) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm" data-testid="streetfight-pause-menu">
      <div className="w-[420px] max-w-[92vw] max-h-[85vh] overflow-y-auto bg-zinc-950 border border-yellow-500/40 rounded-lg p-5">
        <div className="text-3xl font-black tracking-widest text-yellow-400 mb-4 text-center">PAUSED</div>
        <button
          onClick={resume}
          className="w-full py-3 bg-yellow-400 text-black font-black tracking-widest rounded mb-4"
          data-testid="pause-resume-btn"
        >RESUME</button>

        <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
          INVITE TO YOUR GAME — friends &amp; gang
        </div>
        {invitees === null && <div className="text-white/40 text-xs italic">Loading crew…</div>}
        {invitees && invitees.length === 0 && (
          <div className="text-white/40 text-xs italic mb-3">
            Nobody to invite yet — add friends or join a gang first.
          </div>
        )}
        <div className="space-y-1 mb-4 max-h-52 overflow-y-auto" data-testid="pause-invite-list">
          {(invitees || []).map(p => (
            <div key={p.user_id} className="flex items-center justify-between bg-black/40 rounded px-2.5 py-1.5">
              <span className="text-white/85 text-xs truncate">
                {p.gang_tag ? `[${p.gang_tag}] ` : ''}{p.username}
                <span className="ml-1.5 text-[8px] text-white/35 uppercase">{p.source === 'both' ? 'friend · gang' : p.source}</span>
              </span>
              <button
                onClick={() => invite(p.user_id)}
                disabled={!!sent[p.user_id]}
                className="px-2.5 py-1 bg-amber-500 disabled:bg-zinc-800 disabled:text-white/40 text-black text-[10px] font-black rounded"
                data-testid={`pause-invite-${p.user_id}`}
              >{sent[p.user_id] ? 'SENT ✓' : 'INVITE'}</button>
            </div>
          ))}
        </div>
        {err && <div className="text-red-400 text-xs mb-2">{err}</div>}
        <button
          onClick={onClose}
          className="w-full py-2 bg-zinc-900 text-white/60 text-xs tracking-widest rounded border border-zinc-800"
          data-testid="pause-exit-btn"
        >EXIT GAME</button>
      </div>
    </div>
  );
}


// Polls state.over every 250ms to surface a restart / mission-clear UI.
function GameOverlay({ onClose, onRestart, onChangeChar, stateRef }) {
  const [over, setOver] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      setOver(stateRef.current?.over || null);
    }, 250);
    return () => clearInterval(id);
  }, [stateRef]);
  if (!over) {
    return (
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 text-white/70 hover:text-white text-xs bg-black/40 border border-white/15 px-2 py-1 rounded"
        data-testid="streetfight-exit"
      >✕</button>
    );
  }
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className={`text-4xl sm:text-6xl font-black tracking-widest mb-6 ${over === 'win' ? 'text-green-400' : 'text-red-500'}`}>
        {over === 'win' ? 'MISSION CLEAR' : 'BUSTED'}
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        {over === 'dead' && (
          <button
            onClick={onRestart}
            className="px-5 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
            data-testid="streetfight-restart"
          >LAST CHECKPOINT</button>
        )}
        <button onClick={onChangeChar} className="px-5 py-3 bg-zinc-800 text-white font-bold tracking-widest rounded border border-zinc-700">
          PICK NEW SAINT
        </button>
        <button onClick={onClose} className="px-5 py-3 bg-zinc-900 text-white/70 tracking-widest rounded border border-zinc-800">
          EXIT
        </button>
      </div>
    </div>
  );
}

// On-screen joystick + buttons for touch devices.  Hidden on mouse-only.
function MobileControls({ stateRef }) {
  const setInput = (key, v) => {
    const s = stateRef.current;
    if (s && s.player) s.player.inputs[key] = v;
  };
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between pointer-events-none px-4 pb-3 sm:hidden"
    >
      <div className="pointer-events-auto grid grid-cols-3 gap-1.5">
        <span />
        <Btn label="↑" onChange={v => setInput('up', v)} />
        <span />
        <Btn label="←" onChange={v => setInput('left', v)} />
        <Btn label="↓" onChange={v => setInput('down', v)} />
        <Btn label="→" onChange={v => setInput('right', v)} />
      </div>
      <div className="pointer-events-auto grid grid-cols-2 gap-2 mb-1">
        <Btn label="E"     onChange={v => setInput('interact', v)} />
        <Btn label="JUMP"  onChange={v => setInput('jump', v)} />
        <Btn label="PUNCH" onChange={v => setInput('melee', v)} />
        <Btn label="FIRE"  big onChange={v => setInput('fire', v)} />
      </div>
    </div>
  );
}
function Btn({ label, big, onChange }) {
  return (
    <button
      type="button"
      onTouchStart={(e) => { e.preventDefault(); onChange(true); }}
      onTouchEnd={(e)   => { e.preventDefault(); onChange(false); }}
      onMouseDown={() => onChange(true)}
      onMouseUp={()   => onChange(false)}
      onMouseLeave={() => onChange(false)}
      className={`select-none rounded-full bg-black/45 border border-white/20 text-white font-black ${big ? 'w-20 h-20 text-base' : 'w-14 h-14 text-xs'}`}
      data-testid={`streetfight-btn-${label.toLowerCase()}`}
    >{label}</button>
  );
}
