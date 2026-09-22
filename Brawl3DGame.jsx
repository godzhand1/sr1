// TEAM GANGSTA BRAWL — 3D third-person multiplayer shooter built on the
// same lobby/relay backend as the 2D streetfight.  PS2-era visuals:
// low-res render target, low-poly painted Saints, dusk-lit city block.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildArena } from './arena3d.js';
import { buildProjectsArena } from './mapProjects3d.js';
import { buildLobbyMap, lobbyPickupSpawns } from './mapLobby3d.js';
import { buildKothHouseMap } from './mapKothHouse3d.js';
import { buildBoardroomMap } from './mapBoardroom3d.js';
import { buildGraffitiMap } from './mapGraffiti3d.js';
import { buildCustomMap } from './mapCustom3d.js';
import { fetchCustomMapList, fetchCustomMap, preloadCustomMap, getPreloadedRoundMap } from './customMapsCache.js';
import { buildGarageMap, garagePickupSpawns } from './mapGarage3d.js';
import { createPostFX } from './render/postFx.js';
import { configureShadowedDirLight } from './render/lod.js';
import { PerfHud } from './render/perfHud.jsx';
import { LightPool, LIGHT_BUDGET } from './render/lightPool.js';
import { VfxSystem } from './render/vfx.js';
import { warmUpScene } from './render/warmup.js';
import { readVideoSettings } from './render/VideoSettingsModal.jsx';
import { resolveCamera } from './render/cameraConfig.js';
import { VideoSettingsModal } from './render/VideoSettingsModal.jsx';
import { MovementLabPanel } from './MovementLabPanel.jsx';
import { loadMovementConfig } from './movementConfig.js';
import { bakeSceneReflectionProbe } from './render/reflectionProbe.js';
import { tunePbr } from './pbrTuner.js';
import { BrawlEngine, rayWalls } from './engine3d.js';
import { buildVehicleSet } from './vehicles3d.js';
import { preloadHill, cloneHillMesh, applyHillTint } from './hillModel.js';
import { DestructibleSystem, scatterDefaultProps } from './destructibles.js';
import { Coop3D } from './coop3d.js';
import { View3D } from './view3d.js';
import { Input3D } from './input3d.js';
import { Hud3D } from './Hud3d.jsx';
import { WEAPONS3D, WEAPON_INDEX  } from './weapons3d.js';
import { loadBrawl3DBuild } from '../streetfight/characterBuilder.js';
import { resumeAudio, preloadAllWeaponSounds } from '../streetfight/sounds.js';
import { preloadAnnouncer } from './announcer.js';
import { loadSoundConfig, musicUrlFor, acousticsFor } from './audio/soundConfig.js';
import { playMusic, stopMusic, stopAll as stopAllAudio, setReverb } from './audio/audioEngine.js';
import { SoundManagerPanel } from './SoundManagerPanel.jsx';
import { getStoredAuth } from '../userIdentity';
import Brawl3DCharacterCreator from './Brawl3DCharacterCreator.jsx';
import LobbyPauseMenu from './LobbyPauseMenu.jsx';
import WeaponWheel from '../streetfight/WeaponWheel.jsx';
import { drawHealthDial } from '../streetfight/render.js';
import { drawMinimap } from './minimap3d.js';
// eslint-disable-next-line no-unused-vars
import { drawTargetReticles } from './targetReticles.js';   // disabled — see call site
import { createRenderer } from './createRenderer.js';
import { installEnvironmentMap } from './envMap.js';
import { createPhysicalSky, ATMOS_PRESETS } from './physicalSky.js';
import { createLoadGate } from './loadGate.js';
import { preloadCharacter } from './characterMeshy.js';
import { preloadCompton } from './comptonCharacter.js';
import { preloadPipeBomb } from './pipeBombModel.js';
import { preloadQuota } from './quotaModel.js';
import { whenPbrTexturesReady } from './pbrLibrary.js';
import { whenTexturesReady } from './aiTextures.js';
import { RollcallPanel } from './RollcallPanel.jsx';


// 2D-game HUD dial adapter — drawHealthDial expects the 2D weapon shape.
import Brawl3DPreMatch from './Brawl3DPreMatch.jsx';

const DIAL_WEAPONS = WEAPONS3D.map(w => ({ id: w.id, name: w.name, magSize: w.mag, reloadTime: w.reload }));

// Human-readable arena names. Used by both the prematch loading
// screen and the in-game HUD so the label always matches what the
// engine actually spawned.
const MAP_LABELS = {
  block:      'CITY BLOCK',
  projects:   'THE PROJECTS',
  lobby:      'WAREHOUSE',
  garage:     'GARAGE',
  koth_house: 'KOTH HOUSE',
  boardroom:  'BOARDROOM',
  graffiti:   'GRAFFITI ALLEY',
};

// Custom maps carry their display name in the map document (fetched
// lazily by the client). Cache the last-resolved map->name lookup so
// the prematch card doesn't render `custom_a1b2c3d4` as raw ids.
const _CUSTOM_LABEL_CACHE = new Map();
function _resolveMapLabel(id) {
  if (!id) return '';
  const first = MAP_LABELS[id];
  if (first) return first;
  if (typeof id === 'string' && id.startsWith('custom_')) {
    // Prefer the preloaded round doc; otherwise the list-cache label.
    try {
      const doc = getPreloadedRoundMap();
      if (doc && doc.id === id && doc.name) {
        _CUSTOM_LABEL_CACHE.set(id, doc.name);
        return doc.name.toUpperCase();
      }
    } catch { /* */ }
    if (_CUSTOM_LABEL_CACHE.has(id)) return _CUSTOM_LABEL_CACHE.get(id).toUpperCase();
    // Fire-and-forget resolve so the next render sees the friendly name.
    try {
      fetchCustomMap(id).then((doc) => {
        if (doc && doc.name) _CUSTOM_LABEL_CACHE.set(id, doc.name);
      }).catch(() => {});
    } catch { /* */ }
    return 'CUSTOM MAP';
  }
  return id;
}

// Public matchmaking arena rotation. When a client joins a public
// brawl lobby (no `lobby_*` mission), the arena is chosen by hashing
// the lobbyId across this array so every connected client lands on
// the SAME map deterministically. Kept in sync between the outer
// component (prematch label) and PlayCanvas (actual scene builder).
const PUBLIC_ARENA_ROTATION = ['block', 'projects', 'koth_house', 'graffiti'];

// Single source of truth for "what arena will actually render". Both
// the prematch loading screen (label) and PlayCanvas (scene build)
// call this so a matchmaking join that hashes to GRAFFITI ALLEY no
// longer flashes "CITY BLOCK" on the loading card.
function resolveEffectiveMap({ mapId, lobbyId, lobbyMission, customMatchActive }) {
  if (customMatchActive) return mapId;
  if (!lobbyId) return mapId;
  if (lobbyMission === 'lobby_warehouse') return 'lobby';
  if (lobbyMission === 'lobby_garage')    return 'garage';
  // Custom maps override the deterministic public rotation — a lobby
  // whose mission is 'brawl_custom' targets a specific admin-authored
  // arena (mapId carries the custom_XXX id).
  if (lobbyMission === 'brawl_custom' && typeof mapId === 'string' && mapId.startsWith('custom_')) {
    return mapId;
  }
  const sum = [...String(lobbyId)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return PUBLIC_ARENA_ROTATION[sum % PUBLIC_ARENA_ROTATION.length];
}

// Some arenas are KOTH-only (their layout only makes sense as KOTH);
// others honour the caller's gameMode. Keep the ternary here so the
// prematch card, HUD and engine all agree on which mode is spawning.
function resolveEffectiveMode({ effMap, gameMode }) {
  if (effMap === 'koth_house') return 'koth';
  return gameMode || 'tdm';
}

export default function Brawl3DGame({ onClose, lobbyId, lobbyMission, initialMap, initialSolo, initialLobbyMode, initialGameMode }) {
  const [screen, setScreen] = useState('menu');     // menu | prematch | play
  const [matchSize, setMatchSize] = useState(3);
  const [mapId, setMapId] = useState(initialMap || 'block');      // block | projects | lobby | koth_house | boardroom | custom_XXX
  const [gameMode, setGameMode] = useState(initialGameMode || 'tdm');  // tdm | koth
  const [showCreator, setShowCreator] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [showMovementLab, setShowMovementLab] = useState(false);
  const [showSoundManager, setShowSoundManager] = useState(false);
  const [matchKey, setMatchKey] = useState(0);
  // Custom-match override — when true, PlayCanvas uses the caller's
  // explicit `mapId` prop AS-IS instead of deriving the arena from
  // `lobbyMission` (which would force 'lobby' / 'garage' regardless
  // of what the host actually picked). Bug repro before this flag:
  // host was in a warehouse lobby, opened pause → CUSTOM → chose
  // 'block', clicked START — the round remounted with mapId='block'
  // but PlayCanvas's `effMap` ternary was seeing lobbyMission still
  // === 'lobby_warehouse' and coerced back to 'lobby', so the host
  // ended up right back in the same warehouse the pause menu opened
  // from.
  const [customMatchActive, setCustomMatchActive] = useState(!!initialMap);

  // Effective map + mode — what the loading screen and the engine
  // will ACTUALLY spawn. Recomputed on every render (cheap — 3
  // property reads + a short string hash). The prematch card uses
  // these so a matchmaking join that hashes to a rotation slot other
  // than "block" no longer shows the wrong map name.
  const effMapId = resolveEffectiveMap({ mapId, lobbyId, lobbyMission, customMatchActive });
  const effGameMode = resolveEffectiveMode({ effMap: effMapId, gameMode });

  // When the App fires `sr:open-brawl3d` with a NEW lobbyId (e.g. the
  // ranked matchmaker found a match, or B→A is returning the player
  // to their gang lobby), auto-route into play screen so the user
  // doesn't have to click through the menu again.
  const lastLobbyRef = useRef(lobbyId);
  useEffect(() => {
    if (lobbyId && lobbyId !== lastLobbyRef.current) {
      lastLobbyRef.current = lobbyId;
      setScreen('prematch');
      setMatchKey(k => k + 1);
    }
  }, [lobbyId]);

  // MapEditor3D preview auto-launch — when Brawl3DGame mounts with
  // `initialMap` + `initialSolo`, skip the menu entirely and jump
  // straight into a prematch on the given map. The map id is
  // `custom_preview` and its doc has already been stashed via
  // `setPreviewMap(doc)` in the customMapsCache, so the effMap
  // resolver + buildCustomMap pipeline just picks it up.
  useEffect(() => {
    if (initialMap && initialSolo) {
      setCustomMatchActive(true);
      setMapId(initialMap);
      if (initialGameMode) setGameMode(initialGameMode);
      setScreen('prematch');
      setMatchKey(k => k + 1);
    }
    // We intentionally ignore later changes — the parent won't
    // re-fire this while the game is open.
  }, []);

  // Auto-match: when the user starts a brawl WITHOUT an inbound
  // lobbyId (i.e. from the menu, not a specific invite / matchmaker),
  // try to join an existing open brawl3d lobby that matches the
  // selected game mode. If none exists — create one and become the
  // host. Falls back to solo (no lobby) if the API is offline so the
  // player can always play something.
  const [matchmaking, setMatchmaking] = useState(false);
  const autoMatchAndStart = useCallback(async (opts) => {
    resumeAudio();
    // Explicit "solo" mode — bypass matchmaking, jump straight to the
    // bot-fillable engine with NO WebSocket / voice overhead.
    if (opts && opts.solo) { setScreen('prematch'); return; }
    if (lobbyId) { setScreen('prematch'); return; }
    setMatchmaking(true);
    // `searchOnly` (from QUICK MATCH button) SEARCHES for an existing
    // open lobby and joins if found — but does NOT auto-create a new
    // lobby when nothing's open. Falls back to solo play so the user
    // still gets action instead of getting deposited into an empty
    // lobby they didn't want.
    const searchOnly = !!(opts && opts.searchOnly);
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem('sr_community_token');
    if (!API || !token) { setMatchmaking(false); setScreen('prematch'); return; }
    try {
      // 1) Look for an existing joinable brawl3d lobby.
      const listRes = await fetch(`${API}/api/streetfight/lobbies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let joinId = null;
      let joinMission = null;
      if (listRes.ok) {
        const j = await listRes.json();
        const wantMission = gameMode === 'koth' ? 'brawl' : 'brawl';   // brawl covers both modes today
        const openLobbies = (j.lobbies || []).filter(l =>
          l.game === 'brawl3d' &&
          l.mission === wantMission &&
          l.can_join &&
          l.privacy === 'open' &&
          l.count > 0 && l.count < l.max
        );
        // Prefer the fullest joinable lobby — filling players faster.
        openLobbies.sort((a, b) => b.count - a.count);
        if (openLobbies[0]) {
          joinId = openLobbies[0].id;
          joinMission = openLobbies[0].mission;
        }
      }
      // 2) None open — behavior depends on caller.
      //    • Default (FIND / HOST): create a new lobby so we're
      //      discoverable and later players fill in around us.
      //    • QUICK MATCH (searchOnly): skip creation, bail to solo.
      //      Prevents the "I clicked play and got put alone in an
      //      empty lobby" surprise the user reported.
      if (!joinId && !searchOnly) {
        const createRes = await fetch(`${API}/api/streetfight/lobbies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: gameMode === 'koth' ? 'KOTH · Public' : 'Brawl · Public',
            mission: 'brawl',
            game: 'brawl3d',
            privacy: 'open',
          }),
        });
        if (createRes.ok) {
          const c = await createRes.json();
          joinId = c.id;
          joinMission = c.mission;
        }
      }
      if (joinId) {
        window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
          detail: { lobbyId: joinId, mission: joinMission },
        }));
      } else if (searchOnly) {
        // User did QUICK MATCH but no lobby was found — surface a
        // friendly toast + fall back to solo. Better UX than routing
        // them into an empty lobby they'd immediately want to leave.
        try {
          const { toast } = await import('sonner');
          toast.info('No open matches right now — jumping into solo. Try CREATE LOBBY or QUICK MATCH again in a minute.');
        } catch { /* toast optional */ }
        setScreen('prematch');
      } else {
        // API off — bail to solo play so the user still gets a match.
        setScreen('prematch');
      }
    } catch (_e) {
      setScreen('prematch');
    } finally {
      setMatchmaking(false);
    }
  }, [gameMode, lobbyId]);
  // Handy wrapper: QUICK MATCH always uses searchOnly=true.
  const quickMatch = useCallback(() => autoMatchAndStart({ searchOnly: true }), [autoMatchAndStart]);

  // Direct "CREATE LOBBY" — no menu, no form. Fires the create call
  // with sensible defaults and drops the player straight into a
  // WAREHOUSE lobby (chill social space — no scoreboard, no combat
  // countdown) by themselves. From inside the warehouse they can
  // pause and pick CUSTOM MATCH / RANKED / QUICK MATCH to jump into
  // real play, or wait for friends/pubs to filter in. Fires the same
  // `sr:open-brawl3d` event the browser/join flow uses so the whole
  // remount plumbing (WS handshake, coop state) reuses the join path.
  // If the API is offline we bail to solo play so the click never
  // dead-ends.
  const [creatingLobby, setCreatingLobby] = useState(false);
  const createLobbyDirect = useCallback(async () => {
    if (creatingLobby) return;
    resumeAudio();
    setCreatingLobby(true);
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem('sr_community_token');
    if (!API || !token) { setCreatingLobby(false); setScreen('prematch'); return; }
    try {
      const uname = (getStoredAuth().username || 'SAINT').slice(0, 20);
      const res = await fetch(`${API}/api/streetfight/lobbies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: `${uname}'s Garage`,
          mission: 'lobby_garage',   // NEW garage lobby — replaces warehouse as default
          privacy: 'open',
          game: 'brawl3d',
        }),
      });
      if (!res.ok) {
        try {
          const { toast } = await import('sonner');
          toast.error(`Create lobby failed (${res.status})`);
        } catch { /* */ }
        return;
      }
      const j = await res.json();
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: j.id, mission: j.mission || 'lobby_garage' },
      }));
    } catch {
      try {
        const { toast } = await import('sonner');
        toast.error('Offline — try again in a sec.');
      } catch { /* */ }
    } finally {
      setCreatingLobby(false);
    }
  }, [creatingLobby]);

  // Solo-ranked queue → shared 6/12 waiting-pool lobby. Backend
  // creates or finds an open pool, adds us to the invited list, and
  // returns the lobby_id. We dispatch through the same
  // `sr:open-brawl3d` path App.js listens on, with mission='ranked_pool'
  // so PlayCanvas shows the SEARCHING overlay until the backend fires
  // pool_start.
  const [rankedQueuing, setRankedQueuing] = useState(false);
  const [rankedErr, setRankedErr] = useState('');
  const queueRankedSolo = useCallback(async () => {
    resumeAudio();
    setRankedQueuing(true); setRankedErr('');
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem('sr_community_token');
    if (!API || !token) { setRankedQueuing(false); setRankedErr('sign in first'); return; }
    try {
      const res = await fetch(`${API}/api/streetfight/ranked/solo-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setRankedErr(`queue failed (${res.status})`); return; }
      const j = await res.json();
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: j.lobby_id, mission: 'ranked_pool' },
      }));
    } catch (_e) {
      setRankedErr('queue offline');
    } finally {
      setRankedQueuing(false);
    }
  }, []);

  // Custom-match relay — a host fires `evt {k:'cm_start', map, mode}`
  // over the coop socket; every OTHER client parses that in coop3d and
  // dispatches `sr:brawl3d-custom-start` locally. We listen at this
  // outer level so we can update the shared mapId/gameMode state and
  // bump matchKey to remount PlayCanvas with the new arena. Both the
  // host and the remotes end up on the same code path.
  useEffect(() => {
    const onCustom = (e) => {
      const d = e?.detail || {};
      if (d.map) setMapId(d.map);
      if (d.mode) setGameMode(d.mode);
      // Flag this round as a CUSTOM match so PlayCanvas ignores the
      // lobby-room map lookup and uses the picked `mapId` directly.
      // Cleared when the user returns to lobby (mission starts with
      // 'lobby_') via the lobbyId-effect below.
      setCustomMatchActive(true);
      setScreen('prematch');
      setMatchKey(k => k + 1);
      // User feedback — surface a toast so the map/mode change is
      // visible even if the visual match-key remount takes a beat.
      try {
        import('sonner').then(({ toast }) => {
          const parts = [];
          if (d.map)  parts.push(`map: ${d.map}`);
          if (d.mode) parts.push(`mode: ${d.mode}`);
          if (parts.length) toast.success(`Starting custom match — ${parts.join(' · ')}`);
        }).catch(() => { /* optional */ });
      } catch { /* noop */ }
    };
    window.addEventListener('sr:brawl3d-custom-start', onCustom);
    // SEARCH ANOTHER MATCH — user is in a lobby but wants to find a
    // different one. Previously this dispatched a `sr:leave-brawl3d`
    // event that NO listener handled (silent no-op) followed by a
    // quick-match that early-returned because the lobbyId prop was
    // still set. Fix: bounce through the App-level `sr:open-brawl3d`
    // handler with `lobbyId: null` — that resets the props on our
    // side so the subsequent quick-match sees lobbyId===null and
    // actually searches. Also drop back to `screen: menu` so
    // PlayCanvas unmounts cleanly and its coop WS disconnects.
    const onSearchOther = () => {
      setCustomMatchActive(false);
      setScreen('menu');
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: null, mission: null },
      }));
      // Give the props/WS cleanup a beat before we fire the search.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('sr:brawl3d-quick-match'));
      }, 600);
    };
    window.addEventListener('sr:brawl3d-search-other-match', onSearchOther);
    return () => {
      window.removeEventListener('sr:brawl3d-custom-start', onCustom);
      window.removeEventListener('sr:brawl3d-search-other-match', onSearchOther);
    };
  }, []);
  // Any time we land in a lobby-room mission (warehouse / garage),
  // drop the custom-match override so subsequent matches respect the
  // room-mapping again. Two triggers because React state effects only
  // fire on VALUE CHANGES:
  //   1. lobbyMission/lobbyId change (fresh join / hop from another lobby)
  //   2. an explicit `sr:open-brawl3d` re-dispatch with the SAME lobby
  //      id (e.g. BACK TO LOBBY after a custom match — nothing changed
  //      in the props so the effect below would never re-run without
  //      the event listener). The listener also bumps matchKey so
  //      PlayCanvas remounts and re-runs its full init with the newly
  //      resolved effMap → the warehouse actually reloads.
  useEffect(() => {
    if (typeof lobbyMission === 'string' && lobbyMission.startsWith('lobby_')) {
      setCustomMatchActive(false);
    }
  }, [lobbyMission, lobbyId]);
  useEffect(() => {
    const onOpen = (e) => {
      const d = e?.detail || {};
      const mission = typeof d.mission === 'string' ? d.mission : '';
      if (mission.startsWith('lobby_')) {
        // Even if lobbyId/mission are the same as before, force a
        // clean remount + reset the custom-match flag so the room
        // arena repopulates.
        setCustomMatchActive(false);
        setMatchKey(k => k + 1);
      }
    };
    window.addEventListener('sr:open-brawl3d', onOpen);
    return () => window.removeEventListener('sr:open-brawl3d', onOpen);
  }, []);
  // Also listen for the quick-match event so the SEARCH ANOTHER flow
  // can trigger our matchmaker without needing a prop passed down.
  useEffect(() => {
    const onQuick = () => quickMatch();
    window.addEventListener('sr:brawl3d-quick-match', onQuick);
    return () => window.removeEventListener('sr:brawl3d-quick-match', onQuick);
  }, [quickMatch]);

  return (
    <div className="fixed inset-0 z-[210] bg-black" data-testid="brawl3d-root">
      {screen === 'menu' && (
        <Menu
          lobbyId={lobbyId}
          matchSize={matchSize}
          setMatchSize={setMatchSize}
          mapId={mapId}
          setMapId={setMapId}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={autoMatchAndStart}
          onQuickMatch={quickMatch}
          matchmaking={matchmaking}
          onQueueRankedSolo={queueRankedSolo}
          rankedQueuing={rankedQueuing}
          rankedErr={rankedErr}
          onEditSaint={() => setShowCreator(true)}
          onOpenVideoSettings={() => setShowVideoSettings(true)}
          onOpenMovementLab={() => setShowMovementLab(true)}
          onOpenSoundManager={() => setShowSoundManager(true)}
          onOpenCreateLobby={createLobbyDirect}
          creatingLobby={creatingLobby}
          onClose={onClose}
        />
      )}
      {(screen === 'prematch' || screen === 'play') && (
        <PlayCanvas
          key={`${lobbyId || 'solo'}-${matchKey}`}
          lobbyId={lobbyId}
          lobbyMission={lobbyMission}
          matchSize={matchSize}
          mapId={mapId}
          gameMode={gameMode}
          customMatchActive={customMatchActive}
          previewLobbyMode={!!initialLobbyMode}
          displayName={getStoredAuth().username}
          mapLabel={_resolveMapLabel(effMapId)}
          onEntered={() => setScreen('play')}
          onCancelPrematch={() => setScreen('menu')}
          onRematch={() => setMatchKey(k => k + 1)}
          onExit={onClose}
        />
      )}
      {showCreator && (
        <Brawl3DCharacterCreator
          onClose={() => setShowCreator(false)}
          onSave={() => setShowCreator(false)}
        />
      )}
      <VideoSettingsModal
        open={showVideoSettings}
        onClose={() => setShowVideoSettings(false)}
      />
      <MovementLabPanel open={showMovementLab} onClose={() => setShowMovementLab(false)} />
      <SoundManagerPanel open={showSoundManager} onClose={() => setShowSoundManager(false)} />
    </div>
  );
}

function Menu({ lobbyId, matchSize, setMatchSize, mapId, setMapId, gameMode, setGameMode, onStart, onQuickMatch, matchmaking, onQueueRankedSolo, rankedQueuing, rankedErr, onEditSaint, onOpenVideoSettings, onOpenMovementLab, onOpenSoundManager, onOpenCreateLobby, creatingLobby, onClose }) {
  // KOTH auto-forces the map when the current map has no KOTH support.
  // koth_house is KOTH-only; boardroom supports BOTH modes so it stays
  // on the currently selected mode.
  // Maps whose layout supports the KING OF THE HILL mode (they export
  // `hillCandidates` from their map factory). Adding a new map to
  // this set requires the map to produce at least one hill zone.
  const KOTH_MAPS = new Set(['koth_house', 'boardroom', 'graffiti']);
  // Custom maps published via the MapEditor. Load once and preload
  // the currently-picked one so PlayCanvas can build it synchronously
  // on match start. Refetched on `sr:custom-maps-changed` so a fresh
  // publish appears in the picker without a page reload.
  const [customMaps, setCustomMaps] = useState([]);
  useEffect(() => {
    const load = () => fetchCustomMapList().then((r) => setCustomMaps((r?.maps || []).filter(m => m.published)));
    load();
    window.addEventListener('sr:custom-maps-changed', load);
    return () => window.removeEventListener('sr:custom-maps-changed', load);
  }, []);
  useEffect(() => {
    if (typeof mapId === 'string' && mapId.startsWith('custom_')) {
      preloadCustomMap(mapId).catch(() => {});
    }
  }, [mapId]);
  const setMode = (m) => {
    setGameMode(m);
    if (m === 'koth' && !KOTH_MAPS.has(mapId)) setMapId('koth_house');
  };
  const setMap = (id) => {
    setMapId(id);
    if (id === 'koth_house') setGameMode('koth');
    else if (gameMode === 'koth' && !KOTH_MAPS.has(id)) setGameMode('tdm');
  };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #3a2150 0%, #120a18 70%)' }}
      data-testid="brawl3d-menu"
    >
      <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white text-xs" data-testid="brawl3d-close">✕ CLOSE</button>
      <div className="text-purple-300 text-[11px] font-bold tracking-[0.4em] mb-1">STILWATER 3D</div>
      <h1 className="text-white text-4xl sm:text-5xl font-black tracking-widest text-center px-4"
        style={{ textShadow: '0 0 24px #7c3aed88' }}>TEAM GANGSTA BRAWL</h1>
      <p className="text-white/50 text-xs mt-2 mb-6 text-center px-6 max-w-md">
        Third-person team deathmatch. Gang members ride together — everyone else gets balanced. Bots fill empty slots.
      </p>

      {lobbyId && (
        <div className="mb-4 px-3 py-1.5 bg-green-700/25 border border-green-500/40 rounded text-green-300 text-[11px] font-bold tracking-widest" data-testid="brawl3d-lobby-note">
          ONLINE LOBBY MATCH — dropping in
        </div>
      )}

      <div className="text-yellow-400 text-[10px] font-bold tracking-widest mb-2">MODE</div>
      <div className="flex gap-1.5 mb-5 flex-wrap justify-center px-4">
        {[['tdm', 'TEAM DEATHMATCH'], ['koth', 'KING OF THE HILL']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            disabled={!!lobbyId}
            className={`px-4 py-2 text-xs font-black rounded border ${gameMode === id ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 bg-zinc-900/70 text-white/60'} ${lobbyId ? 'opacity-50' : ''}`}
            data-testid={`brawl3d-mode-${id}`}
          >{label}</button>
        ))}
      </div>

      <div className="text-yellow-400 text-[10px] font-bold tracking-widest mb-2">MAP</div>
      <div className="flex gap-1.5 mb-5 flex-wrap justify-center px-4">
        {[['lobby', 'THE LOBBY'], ['block', 'CITY BLOCK'], ['projects', 'THE PROJECTS'], ['graffiti', 'GRAFFITI ALLEY'], ['koth_house', 'KOTH HOUSE'], ['boardroom', 'BOARDROOM']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMap(id)}
            disabled={!!lobbyId}
            className={`px-4 py-2 text-xs font-black rounded border ${mapId === id ? 'border-purple-400 bg-purple-500/15 text-purple-200' : 'border-zinc-700 bg-zinc-900/70 text-white/60'} ${lobbyId ? 'opacity-50' : ''}`}
            data-testid={`brawl3d-map-${id}`}
          >{label}</button>
        ))}
        {/* Community-authored maps (published via MapEditor) — appended
            with a purple ring so they visually distinguish from
            first-party maps. Only appear once at least one is published. */}
        {customMaps.map((m) => (
          <button
            key={m.id}
            onClick={() => setMap(m.id)}
            disabled={!!lobbyId}
            className={`px-4 py-2 text-xs font-black rounded border ${mapId === m.id ? 'border-purple-400 bg-purple-500/15 text-purple-200' : 'border-purple-800 bg-purple-950/50 text-purple-300/80'} ${lobbyId ? 'opacity-50' : ''}`}
            data-testid={`brawl3d-map-${m.id}`}
            title={`Custom map by ${m.created_by_name || 'admin'} · ${m.mode.toUpperCase()}`}
          >
            <i className="fa-solid fa-user-pen text-[9px] mr-1 opacity-70" />
            {m.name}
          </button>
        ))}
      </div>
      {lobbyId && <div className="text-white/40 text-[10px] -mt-3 mb-4">online match — the lobby decides the map so everyone loads the same streets</div>}

      <div className="text-yellow-400 text-[10px] font-bold tracking-widest mb-2">MATCH SIZE</div>
      <div className="flex gap-1.5 mb-6 flex-wrap justify-center px-4">
        {[1, 2, 3, 4, 5, 6].map(n => (
          <button
            key={n}
            onClick={() => setMatchSize(n)}
            className={`px-4 py-2 text-sm font-black rounded border ${matchSize === n ? 'border-yellow-400 bg-yellow-500/15 text-yellow-200' : 'border-zinc-700 bg-zinc-900/70 text-white/60'}`}
            data-testid={`brawl3d-size-${n}`}
          >{n}v{n}</button>
        ))}
      </div>

      <div className="flex flex-col gap-2 w-64">
        <button
          onClick={onStart}
          disabled={matchmaking}
          className={`py-3.5 ${matchmaking ? 'bg-yellow-500/40 cursor-wait' : 'bg-yellow-400 hover:bg-yellow-300'} text-black font-black tracking-widest rounded text-lg`}
          data-testid="brawl3d-start"
        >{matchmaking ? '⌛ FINDING MATCH…' : (lobbyId ? '▶ ENTER THE BRAWL' : '▶ FIND / HOST A BRAWL')}</button>
        {!lobbyId && (
          <button
            onClick={onQuickMatch}
            disabled={matchmaking}
            className="py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-black tracking-widest rounded text-xs border border-cyan-300/40 flex items-center justify-center gap-2"
            data-testid="brawl3d-quick-match"
            title="Search for open public matches ONLY — no lobby is created if nothing's found. Falls back to solo."
          >
            <i className="fa-solid fa-magnifying-glass text-[10px]" />
            QUICK MATCH (SEARCH ONLY)
          </button>
        )}
        {!lobbyId && (
          <button
            onClick={onQueueRankedSolo}
            disabled={rankedQueuing || matchmaking}
            className={`py-3 ${rankedQueuing ? 'bg-purple-600/50 cursor-wait' : 'bg-purple-600 hover:bg-purple-500'} text-white font-black tracking-widest rounded text-sm border border-purple-300/40 flex items-center justify-center gap-2`}
            data-testid="brawl3d-queue-ranked-solo"
          >
            <i className="fa-solid fa-trophy text-[11px]" />
            {rankedQueuing ? 'QUEUING…' : '▶ RANKED · SOLO (6–12)'}
          </button>
        )}
        {rankedErr && (
          <div className="text-red-400 text-[10px] text-center -mt-1" data-testid="brawl3d-ranked-err">{rankedErr}</div>
        )}
        {!lobbyId && (
          <button
            onClick={() => onStart({ solo: true })}
            disabled={matchmaking}
            className="py-2.5 bg-zinc-900 border border-zinc-700 hover:border-yellow-500/60 text-white/80 font-black tracking-widest rounded text-xs"
            data-testid="brawl3d-start-solo"
          >▶ SOLO vs BOTS (OFFLINE)</button>
        )}
        {!lobbyId && (
          <button
            onClick={onOpenCreateLobby}
            disabled={creatingLobby}
            className={`py-2.5 border font-black tracking-widest rounded text-xs flex items-center justify-center gap-2 ${creatingLobby ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200/50 cursor-wait' : 'bg-zinc-900 border-emerald-700/70 hover:border-emerald-400 text-emerald-200'}`}
            data-testid="brawl3d-open-create-lobby"
          >
            <i className={`fa-solid ${creatingLobby ? 'fa-spinner fa-spin' : 'fa-plus'} text-[10px]`} />
            {creatingLobby ? 'CREATING…' : 'CREATE LOBBY'}
          </button>
        )}
        <button
          onClick={onEditSaint}
          className="py-2.5 bg-zinc-800/90 border border-zinc-600 text-white/80 font-bold tracking-widest rounded text-xs"
          data-testid="brawl3d-edit-saint"
        >EDIT YOUR SAINT</button>
        <button
          onClick={onOpenVideoSettings}
          className="py-2.5 bg-zinc-900/70 border border-zinc-700 hover:border-yellow-500/60 text-white/70 hover:text-yellow-200 font-bold tracking-widest rounded text-xs flex items-center justify-center gap-2"
          data-testid="brawl3d-video-settings-btn"
        >
          <i className="fa-solid fa-sliders text-[10px]" />
          VIDEO SETTINGS
        </button>
        <button
          onClick={onOpenMovementLab}
          className="py-2.5 bg-zinc-900/70 border border-zinc-700 hover:border-emerald-400/60 text-white/70 hover:text-emerald-200 font-bold tracking-widest rounded text-xs flex items-center justify-center gap-2"
          data-testid="brawl3d-movement-lab-btn"
        >
          <i className="fa-solid fa-person-running text-[10px]" />
          MOVEMENT LAB
        </button>
        <button
          onClick={onOpenSoundManager}
          className="py-2.5 bg-zinc-900/70 border border-zinc-700 hover:border-sky-400/60 text-white/70 hover:text-sky-200 font-bold tracking-widest rounded text-xs flex items-center justify-center gap-2"
          data-testid="brawl3d-sound-manager-btn"
        >
          <i className="fa-solid fa-volume-high text-[10px]" />
          SOUND MANAGER
        </button>
      </div>

      <div className="text-white/35 text-[10px] mt-8 max-w-lg text-center px-4 space-y-1">
        <div>WASD/arrows move · mouse or J/Z fire · K kick · F = melee with your gun (pistol whip) or hold = block (fists) · Space jump · X climb/vault fence · C crouch · Shift/Q sprint · Alt walk slow · H hold = eat cheeseburger to heal · R reload · hold B/Tab = weapon wheel · 1-7 slots · V scoreboard · taunts: T dance / G flick &apos;em off / Y suck-it</div>
        <div>Gamepad: sticks move/aim (partial tilt = walk slow) · L3 hold = crouch · R3 = toggle vehicle emergency lights · RT fire / right punch · LT left punch (fists) or gun-melee (armed) · LB kick · RB sprint · A reload · X climb/vault/jump · hold B = weapon wheel · dpad-down hold = eat · dpad left/right/up = taunts · LT+RT = block, sway guard with left stick</div>
        <div className="text-yellow-300/60">Burger tricks: eat + X = BURGER JUMP (higher) · eat + A = reload while chewing</div>
      </div>
    </div>
  );
}

function PlayCanvas({ lobbyId, lobbyMission, matchSize, mapId, gameMode, customMatchActive, previewLobbyMode, displayName, mapLabel, onEntered, onCancelPrematch, onRematch, onExit }) {
  const mountRef = useRef(null);
  const hudCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const rendererRef = useRef(null);
 const wheelStateRef = useRef({ player: { weapons: WEAPONS3D, weaponIdx: 2, ammo: [], hasPimpSlap: false, disabledIds: new Set() } });
  const [snap, setSnap] = useState(null);
  const [locked, setLocked] = useState(false);
  // Pre-match load gate: progress of EVERY asset (map GLBs, PEG/PBR
  // textures, rigs, weapons, sky bake) + the ready roster. The overlay
  // stays up until the engine leaves 'waiting'.
  const [loadState, setLoadState] = useState({ progress: 0, done: 0, total: 0, ready: false, lastUrl: '', elapsed: 0 });
  const [roster, setRoster] = useState([]);
  const [waitInfo, setWaitInfo] = useState({ isHost: false, waitingT: 0, coop: false });
  const enteredRef = useRef(false);
  const [gpMode, setGpMode] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  // In-lobby pause menu (ROSTER / CUSTOM / RANKED).
  const [pauseOpen, setPauseOpen] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [showMovementLab, setShowMovementLab] = useState(false);
  const [showSoundManager, setShowSoundManager] = useState(false);
  const [showPerf, setShowPerf] = useState(() => !!(readVideoSettings().showPerf || (typeof window !== 'undefined' && window.__brawl3dPerf)));
  useEffect(() => {
    const onVideo = (e) => setShowPerf(!!(e.detail?.showPerf || window.__brawl3dPerf));
    window.addEventListener('brawl3d:video-settings', onVideo);
    return () => window.removeEventListener('brawl3d:video-settings', onVideo);
  }, []);
  // Global movement balance (admin-set) — fetched once per match mount.
  useEffect(() => { loadMovementConfig(); }, []);
  const [coopRef, setCoopRef] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [lobbyMeta, setLobbyMeta] = useState(null);
  // Ranked-solo pool state — driven by pool_status broadcasts from the
  // backend. When `poolWaiting` is true we overlay a full-screen
  // SEARCHING panel; `pool_start` (or reaching the max) flips it off
  // and the game canvas becomes playable.
  const isRankedPool = lobbyMission === 'ranked_pool';
  const [poolWaiting, setPoolWaiting] = useState(isRankedPool);
  const [poolStatus, setPoolStatus] = useState({ count: 1, min: 6, max: 12 });
  // B → A "Return to Lobby" prompt state at match end.
  const [returnArmed, setReturnArmed] = useState(false);
  const lobbyOnly = lobbyMission === 'lobby_warehouse' || lobbyMission === 'lobby_garage';

  // Party actions state — end-of-match host tools that keep the crew
  // together for the next match ("RETURN GROUP TO LOBBY" or
  // "SEARCH AGAIN TOGETHER"). Both routes hit
  // /api/streetfight/party/regroup then broadcast `rtl` so every
  // remote hops via the standard `sr:open-brawl3d` path.
  const [partyBusy, setPartyBusy] = useState(false);
  const [partyErr, setPartyErr] = useState('');

  const _regroupParty = useCallback(async (opts) => {
    // opts.target_lobby_id → return-home flow (already-existing lobby)
    // opts.mission         → search-together flow (create fresh lobby)
    const API = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem('sr_community_token');
    if (!API || !token) throw new Error('Sign in required');
    if (!lobbyId) throw new Error('No source lobby');
    const res = await fetch(`${API}/api/streetfight/party/regroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        source_lobby_id: lobbyId,
        target_lobby_id: opts.target_lobby_id || undefined,
        mission:         opts.mission         || undefined,
        privacy:         opts.privacy         || 'open',
        name:            opts.name            || undefined,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`regroup failed (${res.status})${t ? `: ${t.slice(0, 120)}` : ''}`);
    }
    return res.json();
  }, [lobbyId]);

  const returnGroupToLobby = useCallback(async () => {
    if (partyBusy) return;
    // Guard: if there's no distinct home lobby to send everyone back
    // to (sourceLobbyId is missing AND we're already in a match
    // lobby, not a warehouse/garage), the "return group" flow is a
    // no-op self-hop. Refuse cleanly.
    const target = coopRef?.sourceLobbyId || (lobbyOnly ? lobbyId : null);
    if (!target || target === lobbyId && !lobbyOnly) {
      setPartyErr('No home lobby to return to — try SEARCH AGAIN TOGETHER instead.');
      return;
    }
    setPartyBusy(true); setPartyErr('');
    try {
      const backMission = lobbyMission === 'lobby_garage' ? 'lobby_garage' : 'lobby_warehouse';
      const j = await _regroupParty({ target_lobby_id: target });
      // Broadcast to every remote so they auto-hop to the target
      // lobby. coop3d handles `rtl` by dispatching `sr:open-brawl3d`.
      // Sender is excluded server-side; we hop locally right after.
      if (coopRef) {
        try { coopRef._send({ type: 'evt', d: { k: 'rtl', lid: j.lobby_id, mission: j.mission || backMission } }); } catch { /* noop */ }
      }
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: j.lobby_id, mission: j.mission || backMission },
      }));
    } catch (e) {
      setPartyErr(e?.message || 'Regroup failed');
    } finally {
      setPartyBusy(false);
    }
  }, [partyBusy, coopRef, lobbyId, lobbyMission, lobbyOnly, _regroupParty]);

  const searchAgainTogether = useCallback(async () => {
    if (partyBusy) return;
    setPartyBusy(true); setPartyErr('');
    try {
      const j = await _regroupParty({ mission: 'brawl', privacy: 'open' });
      // Broadcast the NEW public lobby id to every remote so the
      // whole crew lands in the same match together.
      if (coopRef) {
        try { coopRef._send({ type: 'evt', d: { k: 'rtl', lid: j.lobby_id, mission: j.mission || 'brawl' } }); } catch { /* noop */ }
      }
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: j.lobby_id, mission: j.mission || 'brawl' },
      }));
    } catch (e) {
      setPartyErr(e?.message || 'Regroup failed');
    } finally {
      setPartyBusy(false);
    }
  }, [partyBusy, coopRef, _regroupParty]);

  const requestLock = useCallback(() => {
    const c = mountRef.current?.querySelector('canvas');
    if (c) { try { c.requestPointerLock(); } catch {} }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer = null;
    let raf = 0;
    let hudTimer = 0;
    let disposed = false;
    let arena = null;
    let coop = null;
    let view = null;
    let input = null;
    let onLockChange = null;
    let onResize = null;
    let destructibles = null;
    let lightPool = null;
    let vfx = null;
    let gate = null;
    let gateTimer = 0;

    (async () => {
      // Every THREE loader from here on is counted by the gate, so the
      // pre-match bar covers the renderer warm-up, map build, GLBs,
      // PEG/PBR textures, rigs and weapons — nothing streams in late.
      gate = createLoadGate({ onChange: (s) => { if (!disposed) setLoadState(s); } });
      renderer = await createRenderer({ antialias: false, powerPreference: 'high-performance' });
      await renderer.__ready;
      if (disposed) { renderer.dispose?.(); return; }
      if (typeof window !== 'undefined') window.__brawl3dBackend = renderer.__backend;
      if (typeof window !== 'undefined') window.__brawl3dRenderer = renderer;
      // Manual info reset (once per frame, below) so draw-call / triangle
      // counts cover the WHOLE composer frame, not just the final pass.
      renderer.info.autoReset = false;
      renderer.setPixelRatio(Math.min(1, window.devicePixelRatio) * 0.8);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.domElement.style.imageRendering = 'pixelated';
      // Enable shadow maps — needed for the sun/directional light in
      // each map's lighting rig. PCF-soft is Xbox-360 gen typical.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      window.__brawl3dCamera = resolveCamera(readVideoSettings());
      const camera = new THREE.PerspectiveCamera(window.__brawl3dCamera.fov, mount.clientWidth / mount.clientHeight, 0.1, 500);
      if (typeof window !== 'undefined') { window.__brawl3dScene = scene; window.__brawl3dCam = camera; window.THREE = THREE; }

      // AAA image-based lighting — install a shared PMREM environment
      // map so every PBR material (Venom paint, weapon barrels, glass
      // panes) picks up real ambient reflections. Default variant is
      // the SUNSET sky-preset IBL — matches the warm arena lighting
      // both built-in maps use. The reflection probe below will
      // overwrite this with the real arena scene once it's built,
      // but this fill covers the split-second between scene mount
      // and probe bake so materials never render un-lit.
      try {
        installEnvironmentMap(scene, renderer, { timeOfDay: 'SUNSET' });
      } catch (envErr) {
        console.warn('[brawl3d] envmap install failed', envErr);
      }

      // Post-processing pipeline — ACES tone-map, bloom, SSAO, colour
      // grade. Quality mode is 'quality' by default; drops to
      // 'performance' automatically if the frame budget explodes.
      const videoPrefs = readVideoSettings();
      const initialQuality = videoPrefs.quality || 'balanced';
      if (typeof window !== 'undefined') window.__brawl3dQuality = initialQuality;
      let postFx = createPostFX({
        renderer,
        scene,
        camera,
        w: mount.clientWidth,
        h: mount.clientHeight,
        mode: initialQuality,
      });
      if (typeof window !== 'undefined') window.__brawl3dPostFx = postFx;
      // Apply persisted user video settings (localStorage) so
      // Bloom / Grade / Exposure preferences survive reloads and
      // aren't overwritten by the postFx defaults.
      try {
        const raw = localStorage.getItem('brawl3d_video_settings');
        if (raw) {
          const v = JSON.parse(raw);
          if (v.quality) postFx.setQuality?.(v.quality);
          if (v.bloom != null) postFx.setBloom?.({ strength: v.bloom });
          postFx.setGrade?.({
            contrast: v.contrast, saturation: v.saturation, vignette: v.vignette,
          });
          if (v.exposure != null) postFx.setExposureBias(v.exposure / 1.85);
        }
      } catch { /* noop */ }
      rendererRef.current = renderer;
      if (typeof window !== 'undefined') {
        // Quick tuning knobs — set from devtools without a rebuild:
        //   window.__brawl3dExposure = 1.5;          // sun intensity
        //   window.__brawl3dPostFx.setGrade({ contrast: 1.2 });
        //   window.__brawl3dPostFx.setQuality('performance');
        Object.defineProperty(window, '__brawl3dExposure', {
          configurable: true,
          get: () => renderer.toneMappingExposure,
          set: (v) => { postFx.setExposureBias(v / 1.85); },   // slider is a bias; 1.85 == neutral
        });
      }

      // Arena selection — SAME function the outer prematch screen
      // calls so the loading-card label and the actual spawn always
      // agree.
      const effMap = resolveEffectiveMap({ mapId, lobbyId, lobbyMission, customMatchActive });
      const effMode = resolveEffectiveMode({ effMap, gameMode });
      arena = effMap === 'lobby'
        ? buildLobbyMap(scene)
        : effMap === 'garage' ? buildGarageMap(scene)
        : effMap === 'projects' ? buildProjectsArena(scene)
        : effMap === 'koth_house' ? buildKothHouseMap(scene)
        : effMap === 'boardroom' ? buildBoardroomMap(scene)
        : effMap === 'graffiti' ? buildGraffitiMap(scene)
        : (typeof effMap === 'string' && effMap.startsWith('custom_'))
            ? buildCustomMap(scene, getPreloadedRoundMap() || { half: 30 })
        : buildArena(scene);

      // Outdoor lighting rig. Custom / SR-import maps build their own
      // physical sky in buildCustomMap; the hand-built maps with a visible
      // sky get one here (their legacy ambient/hemi/sun lights and painted
      // sky domes are removed so the physical sky is the single light
      // source). The warehouse lobby is a closed interior and keeps its rig.
      const OUTDOOR_PRESET = {
        block: 'GOLDEN', arena: 'GOLDEN', projects: 'SUNSET', graffiti: 'NIGHT',
        koth_house: 'SUNSET', boardroom: 'NIGHT', garage: 'MORNING',
      };
      let skyRig = scene.userData.physicalSky || null;
      if (!skyRig && OUTDOOR_PRESET[effMap]) {
        const stale = [];
        scene.traverse((o) => { if (o.isAmbientLight || o.isHemisphereLight || o.isDirectionalLight || o.userData?.legacySky) stale.push(o); });
        for (const l of stale) l.parent?.remove(l);
        if (scene.__skyDome) scene.__skyDome = null;
        skyRig = createPhysicalSky(ATMOS_PRESETS[OUTDOOR_PRESET[effMap]]).attach(scene);
        const sh = Math.max(40, Math.min(140, (arena.half || 60) * 1.2));
        skyRig.sun.shadow.camera.left = -sh; skyRig.sun.shadow.camera.right = sh;
        skyRig.sun.shadow.camera.top = sh; skyRig.sun.shadow.camera.bottom = -sh;
        skyRig.sun.shadow.camera.far = sh * 4;
        skyRig.sun.shadow.radius = 3;
        scene.userData.physicalSky = skyRig;
      }
      if (skyRig) {
        // Fog is mixed in HDR inside the composer (tone-mapped afterwards)
        // but after tone mapping when rendering straight to the canvas.
        skyRig.apply({ hdrFog: !!postFx.__composer });
        // IBL straight from the sky model — real environmental
        // illumination, not a painted background.
        skyRig.bakeEnvironment(renderer);
        postFx.setExposure(skyRig.exposure);
      } else {
        postFx.setExposure(0.7);   // legacy interiors, tuned for the old un-tone-mapped output
      }

      // Reflection / IBL probe — bakes an env map from the middle of
      // the arena so PBR materials get a plausible ambient response
      // (sunlit facades + ground bounce on top of the sky). The sun disc
      // and its glow are hidden during the capture: the DirectionalLight
      // already delivers them, and a 4e5-radiance disc overflows the
      // half-float cube into Inf → NaN → black surfaces.
      // The probe waits one frame internally so streamable lights
      // land before it captures — no manual timing needed here.
      try {
        bakeSceneReflectionProbe({
          renderer, scene,
          position: new THREE.Vector3(0, 4, 0),
          resolution: 256,
          intensity: skyRig ? (skyRig.params.skyIntensity ?? 1) : 0.75,
          beforeCapture: () => skyRig?.setBakeMode(true),
          afterCapture: () => skyRig?.setBakeMode(false),
        });
      } catch (err) {
        console.warn('[Brawl3D] reflection probe skipped', err);
      }
      // AAA roughness/metalness tuning pass — walks the scene and
      // assigns per-material presets (pavement wet, rooftops rough,
      // rails metallic, glass sharp, paint glossy). Materials that
      // authors already tuned deliberately are LEFT ALONE — only
      // bulk-swapped defaults (r=1, m=0) get replaced.
      try {
        tunePbr(scene);
      } catch (err) {
        console.warn('[Brawl3D] PBR tuning pass failed', err);
      }
      const build = loadBrawl3DBuild();
      coop = lobbyId ? new Coop3D() : null;
      if (coop) coop.connect(build, lobbyId);

      // KOTH hill candidate index — deterministic per lobby (so all
      // clients land on the same room) or random for solo runs.
      const hillSeed = lobbyId
        ? [...String(lobbyId)].reduce((a, c) => a + c.charCodeAt(0), 0)
        : Math.floor(Math.random() * 1e6);

      // Lobby-family maps (warehouse OR garage) share the same
      // Lobby-family maps (warehouse OR garage) share the same
      // "chill social space" treatment: no bots, no scoreboard, no
      // combat gate, no destructibles scatter. Both are entered via
      // CREATE LOBBY as personal hangout spaces.
      //
      // Preview override (iter160) — the MapEditor3D preview can
      // force lobby-mode (walk-around) on the current custom map so
      // designers can inspect their geometry without bots getting
      // in the way.
      const isLobbyMap = effMap === 'lobby' || effMap === 'garage' || !!previewLobbyMode;

      const engine = new BrawlEngine({
        build,
        displayName: getStoredAuth().username || 'SAINT',
        gangTag: null,
        matchSize: isLobbyMap ? 0 : matchSize,
        coop,
        arena,
        lobbyMode: isLobbyMap,
        gameMode: effMode,
        hillSeed,
        noBots: isRankedPool,
        holdStart: isRankedPool,   // the ranked pool broadcast flips the phase itself
      });

      // ── Drivable vehicles ──
      // Arena builders expose `vehicleSpawns: [{x,z,yaw}]`.  We
      // instantiate the THREE.Group set here (the engine itself is
      // Three-free) and hand the array to the engine for state.
      const vehicleSpawns = (arena.vehicleSpawns || []);
      const vehicles = vehicleSpawns.length ? buildVehicleSet(scene, vehicleSpawns) : [];
      engine.setVehicles(vehicles);
      // iter193 — players now ALWAYS spawn on foot (per user spec).
      // The old "spawn as Venom driver" auto-seat has been removed;
      // players walk to the car and press E to enter it like any
      // other vehicle. This keeps the third-person opener consistent
      // across every map + game mode.
      // DEV HOOK — expose the engine + vehicle set on window so QA
      // tests / dev consoles can peek at bike state (kind, wheelieT,
      // hopVY, leanAngle) without opening React DevTools. No-op in
      // production builds (window is undefined in SSR / build tests).
      try {
        if (typeof window !== 'undefined') { window.__brawlEngine = engine; window.__brawlScene = scene; }
      } catch (_e) { /* ignore */ }

      // ── Destructible props ──
      // Every combat map gets a scatter of crates / barrels / lights /
      // signs so the environment reacts to gunfire. Lobby-family
      // maps (warehouse / garage) are non-combat social spaces so we
      // skip the scatter.
      if (!isLobbyMap) {
        destructibles = new DestructibleSystem(scene);
        scatterDefaultProps(destructibles, arena.half || engine.half || 40);
        // Editor glass panes (surface: glass) shatter like storefronts:
        // hide the pane, shard shower, and drop its collider so players
        // and bullets pass through the hole.
        for (const g of arena.glassPanes || []) destructibles.adoptPane(g);
        destructibles.onBreak = (p) => {
          if (!p.collider) return;
          const i = engine.colliders.indexOf(p.collider);
          if (i >= 0) engine.colliders.splice(i, 1);
        };
        engine.setDestructibles(destructibles);
      }

      // Blender-textured weapon/explosion VFX. Built BEFORE the light
      // pool + warm-up so its two fx lights are part of the constant
      // light rig and its shaders/textures compile behind the pre-match
      // screen. Textures load through the DefaultLoadingManager → the
      // load gate waits for them.
      vfx = new VfxSystem(scene);
      vfx.prewarm();
      if (destructibles) destructibles.setVfx(vfx);
      // Hero fill light — a soft warm point light that rides between the
      // camera and the player so the (dark-clothed) character always
      // reads against imported SR streets / dim interiors. Shadow-free
      // and short-range so it never re-lights the map at large. Created
      // HERE, before the warm-up: the point-light COUNT is baked into
      // every shader's cache key, so it must be final when we compile.
      const heroLight = new THREE.PointLight(0xfff0dc, 2.8, 9, 1.6);
      heroLight.castShadow = false;
      heroLight.name = 'heroFillLight';
      heroLight.userData.dynamic = true;   // intentional extra light: follows the player, never pooled
      scene.add(heroLight);
      // The view owns every pooled effect (tracers, shells, rockets, decals,
      // the hidden arsenal of every weapon model) — built before the
      // warm-up so all of it compiles behind the pre-match screen.
      view = new View3D(scene, { vfx });
      if (typeof window !== 'undefined') { window.__brawl3dView = view; window.__brawl3dVfx = vfx; }

      // ── Light pool ─────────────────────────────────────────────
      // Every static PointLight the map placed (lamp grids, neon, the
      // destructible streetlights) is adopted into a FIXED pool of real
      // lights that follows the player. Constant light count → every
      // shader compiles exactly once; constant per-pixel light cost.
      lightPool = new LightPool(scene, { max: LIGHT_BUDGET[initialQuality] || LIGHT_BUDGET.balanced });
      let adopted = 0;
      for (const v of vehicles) adopted += lightPool.adopt(v.group, { tracked: true });   // sirens ride with the car
      adopted += lightPool.adopt(scene) + (arena.stream ? lightPool.adopt(arena.stream.parkedObjects()) : 0);
      if (typeof window !== 'undefined') window.__brawl3dLightPool = lightPool;
      // Shader + texture warm-up behind the pre-match screen: compile
      // every material for the final light rig and upload every texture
      // now, so a streaming tile never triggers a compile mid-match.
      const warm = () => {
        const opts = { offscreen: !!postFx.__composer };
        try { return arena.stream ? arena.stream.warmUp(renderer, camera, opts) : warmUpScene(renderer, scene, camera, opts).textures; } catch (err) { console.warn('[brawl3d] warm-up skipped', err); return 0; }
      };
      const warmedTextures = warm();
      if (typeof window !== 'undefined') { window.__brawl3dWarm = warm; window.__brawl3dLoadGate = gate; }
      console.info(`[brawl3d] perf: ${adopted} static lights pooled → ${lightPool.max} real · ${warmedTextures} textures pre-uploaded`);
      // Shadow budget follows the preset: 'performance' halves the sun
      // shadow map (2048² → 1024²) — a quarter of the fill cost.
      if (initialQuality === 'performance') {
        scene.traverse((o) => {
          if (o.isDirectionalLight && o.castShadow && o.shadow.mapSize.x > 1024) {
            o.shadow.mapSize.set(1024, 1024);
            if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
          }
        });
      }
      // ── KOTH hill marker — RIM-ONLY (Gears of War style) ──
      // Per user request, the interior of the zone is NOT filled
      // with a translucent disc — only the rim glows. We use:
      //   • a thin TORUS lying flat on the floor for the bright
      //     ground-level ring outline
      //   • a tall open-ended CYLINDER (no caps, no top/bottom
      //     surface) for the vertical "wall of light" rim
      // Both are emissive-style basic materials so they always
      // glow regardless of ambient lighting. No floor disc.
      let hillMesh = null;
      if (effMode === 'koth' && engine.hill) {
        const R = engine.hill.radius;
        // Kick off the user-provided KOTH hill GLB fetch on first
        // mount so the mesh is ready to swap in within a couple of
        // seconds. Until it lands, the procedural ring+wall placeholder
        // below stays visible so the zone is always legible.
        preloadHill();
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(R, R, 0.55, 64, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.70, side: THREE.DoubleSide, depthWrite: false }),
        );
        wall.position.set(engine.hill.x, 0.32, engine.hill.z);
        scene.add(wall);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(R, 0.10, 8, 96),
          new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.95, depthWrite: false }),
        );
        ring.rotation.x = Math.PI / 2;                  // lay flat on floor
        ring.position.set(engine.hill.x, 0.06, engine.hill.z);
        scene.add(ring);
        // Anchor group for the shipped GLB — added at the hill's
        // world position. `glb` is null until `cloneHillMesh` returns
        // a mesh; the render-loop tint updater swaps it in on the
        // first frame it becomes available.
        const glbAnchor = new THREE.Group();
        glbAnchor.position.set(engine.hill.x, 0, engine.hill.z);
        scene.add(glbAnchor);
        hillMesh = { ring, wall, glbAnchor, glb: null, targetD: R * 2 };
        engine._hillVisual = hillMesh;
      }
      // Lobby-family maps (Warehouse / Garage) — start with only
      // pistol + bat + fists; all other ranged weapons must be
      // picked up off the floor. Uses the map's own pickup layout.
      if (effMap === 'lobby') {
        engine.applyLobbyMode(lobbyPickupSpawns());
        engine._lobbyLabel = 'WAREHOUSE';
      } else if (effMap === 'garage') {
        engine.applyLobbyMode(garagePickupSpawns());
        engine._lobbyLabel = 'GARAGE';
      }
      engineRef.current = engine;
      setCoopRef(coop);
      // ESC + gamepad START open the in-game pause menu. Available
      // in ALL modes (lobby, solo bots, warehouse) so the player can
      // always reach Controller settings + Search Another Match +
      // Video settings from within the game.
      const pauseAvailable = () => true;
      const onKey = (e) => {
        if (e.key === 'Escape' && pauseAvailable()) {
          e.preventDefault();
          setPauseOpen(v => !v);
        }
      };
      window.addEventListener('keydown', onKey);
      engine._pauseKeyHandler = onKey;
      // Gamepad START polling for pause toggle.
      let prevStart = false;
      const pauseGpIv = setInterval(() => {
        if (!pauseAvailable()) return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads) {
          if (!p || !p.connected) continue;
          // Try both common Start button locations: index 9 (standard
          // XInput / Xbox 360 mapping) and index 8 (alternative
          // PlayStation Options layout) so any gamepad triggers it.
          const start = !!p.buttons[9]?.pressed || !!p.buttons[8]?.pressed;
          if (start && !prevStart) setPauseOpen(v => !v);
          prevStart = start;
        }
      }, 80);
      engine._pauseGpInterval = pauseGpIv;
      // Host detection (sync with coop welcome). The lobby host gets to
      // start custom matches / queue ranked. Solo warehouse runs have
      // no coop instance, so the player IS the lobby leader (only one
      // there) — treat that as host=true so the pause menu UI works.
      if (!coop) {
        setIsHost(true);
      } else {
        const checkHost = () => {
          setIsHost(coop.id && coop.hostId === coop.id);
          if (coop.lobbyMeta) setLobbyMeta(coop.lobbyMeta);
        };
        const iv = setInterval(checkHost, 800);
        engine._hostCheckInterval = iv;
        // Ranked match-found dispatcher — auto-routes players from
        // their gang lobby into the ephemeral match lobby.
        const rankedIv = setInterval(() => {
          const p = coop.pendingRankedMatch;
          if (!p) return;
          coop.pendingRankedMatch = null;
          window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
            detail: { lobbyId: p.match_lobby_id, mission: 'brawl' },
          }));
        }, 250);
        engine._rankedCheckInterval = rankedIv;
        // Ranked-solo pool watcher — mirrors coop.poolStatus / poolStarted
        // into React state so the SEARCHING overlay updates smoothly.
        const poolIv = setInterval(() => {
          if (coop.poolStatus) {
            setPoolStatus({
              count: coop.poolStatus.count | 0,
              min: coop.poolStatus.min | 0,
              max: coop.poolStatus.max | 0,
            });
          }
          if (coop.poolStarted && poolWaiting) setPoolWaiting(false);
        }, 300);
        engine._poolCheckInterval = poolIv;
      }
      if (typeof window !== 'undefined') window.__brawl3dEngine = engine;
      input = new Input3D();
      input.attach();
      if (typeof window !== 'undefined') window.__brawl3dInput = input;
      // Bind rumble hook so engine can pulse the gamepad on damage,
      // hits, etc. Input3D internally respects the vibration toggle.
      engine._rumble = (s, ms) => input.rumble(s, ms);

      // ── Pre-match load gate ───────────────────────────────────────
      // Explicit steps the LoadingManager can't see. Everything else
      // (map GLBs, PEG/PBR textures, weapon + character rigs streamed
      // by view.drive on the first frames) is counted automatically.
      gate.track('character', preloadCharacter());
      gate.track('compton', preloadCompton());
      gate.track('pipebomb', preloadPipeBomb());
      gate.track('quota', preloadQuota());
      if (effMode === 'koth') gate.track('hill', preloadHill());
      // Sound Manager overrides + per-map music, then decode every
      // weapon/announcer sample so the first shot is never a fetch.
      gate.track('sounds', loadSoundConfig().then(() => Promise.all([preloadAllWeaponSounds(), preloadAnnouncer()])));
      // Room acoustics: interiors get a room/hall tail, streets stay dry.
      setReverb(acousticsFor(effMap, getPreloadedRoundMap()));
      gate.track('pbr', whenPbrTexturesReady(20000));
      gate.track('ai-textures', whenTexturesReady(20000));
      if (arena.ready && typeof arena.ready.then === 'function') gate.track('map', arena.ready);
      gateTimer = setInterval(() => {
        if (disposed) return;
        const s = gate.snapshot();
        setLoadState(s);
        setRoster(engine.readyRoster());
        setWaitInfo({ isHost: engine.isAuthority, waitingT: engine.waitingT, coop: !!coop, allReady: engine.allReady() });
        if (s.ready && !engine.localReady) { engine.setLocalReady(); warm(); }
        if (s.ready && engine.phase !== 'waiting') {
          // Last pass behind the 3-2-1: whatever streamed in while the
          // roster readied up (weapon OBJs, rigs, decals) compiles now.
          warm();
          if (!enteredRef.current) { enteredRef.current = true; onEntered?.(); }
          clearInterval(gateTimer); gateTimer = 0;
        }
      }, 200);

      onLockChange = () => {
        const isLocked = document.pointerLockElement != null;
        setLocked(isLocked);
        // Solo: the 3-2-1 starts the moment the player locks in (assets
        // resident). Coop waits for the host's shared `go`.
        if (isLocked && !coop && engine.phase === 'waiting' && engine.localReady) engine.startCountdown(3);
      };
      document.addEventListener('pointerlockchange', onLockChange);

      // Perf state shared with the Perf HUD (window.__brawl3dPerfStats).
      const basePixelRatio = Math.min(1, window.devicePixelRatio) * 0.8;
      const perf = {
        ema: 0, worst: 0, frameMs: 0, fps: 0, lights: 0, lastNow: performance.now(),
        scale: 1, lastScaleAt: 0, dynamicRes: videoPrefs.dynamicRes !== false,
        get pixelRatio() { return basePixelRatio * this.scale; },
      };
      if (typeof window !== 'undefined') window.__brawl3dPerfStats = perf;
      const applyRenderScale = () => {
        const pr = basePixelRatio * perf.scale;
        renderer.setPixelRatio(pr);
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        postFx.setPixelRatio(pr, mount.clientWidth, mount.clientHeight);
      };
      perf.setDynamicRes = (on) => { perf.dynamicRes = !!on; if (!on && perf.scale !== 1) { perf.scale = 1; applyRenderScale(); } };

      onResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        postFx.setSize(mount.clientWidth, mount.clientHeight);
        if (hudCanvasRef.current) {
          hudCanvasRef.current.width = mount.clientWidth;
          hudCanvasRef.current.height = mount.clientHeight;
        }
      };
      window.addEventListener('resize', onResize);
      if (hudCanvasRef.current) {
        hudCanvasRef.current.width = mount.clientWidth;
        hudCanvasRef.current.height = mount.clientHeight;
      }

      // ── Frame loop ──
      let last = performance.now();
      let prevWheel = false, prevBoard = false;

      // SR1 camera state — smoothed each frame
      let shoulder = window.__brawl3dCamera.shoulder;  // lateral offset: character sits LEFT of crosshair
      let camDist  = window.__brawl3dCamera.dist;      // distance behind pivot point (GEARS close / SR1 classic preset)
      const camFollow = { x: 0, y: 0, z: 0, ok: false };
      // (heroFillLight is created next to the VFX system above — before
      // the warm-up — so the light count is final when shaders compile.)

      const camRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 };

      const loop = (now) => {
        raf = requestAnimationFrame(loop);
        // rAF timestamps mark the frame's vsync start, which can precede
        // the `performance.now()` we captured while building the scene —
        // clamp so the first frame never runs the sim backwards.
        const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
        last = now;

        input.assist = engine.aimStickyId ? 0.55 : 1;
        const cmd = input.poll(dt);

        wheelStateRef.current.player.weaponIdx = engine.me.wpnIdx;
        wheelStateRef.current.player.ammo = engine.me.ammo;
        wheelStateRef.current.player.reserve = engine.me.reserve;
        wheelStateRef.current.player.hasPimpSlap = !!engine.me.hasPimpSlap;
        // Full 8-slot wheel ALWAYS — slots the player doesn't own
        // simply render as empty bubbles (handled inside WeaponWheel
        // by inspecting ammo + reserve). Selecting an empty bubble
        // is a no-op (the engine blocks the equip below).
        wheelStateRef.current.player.weapons = WEAPONS3D;
        // Disabled weapons for the current seat — driver may only
        // use pistol/tec9; passenger may not use fists/bat. BIKE driver
        // is allowed everything except fist/bat/rpg/m32. Wheel greys
        // these out and the engine refuses the slot request.
        if (engine.me.inCar) {
          const v = engine.vehicles.find(x => x.id === engine.me.inCar.id);
          const isBike = v && v.kind === 'dirtbike';
          if (engine.me.inCar.role === 'driver') {
            wheelStateRef.current.player.disabledIds = isBike
              ? new Set(['fist', 'bat', 'rpg', 'm32'])
              : new Set(WEAPONS3D.filter(w => w.id !== 'pistol' && w.id !== 'tec9').map(w => w.id));
          } else {
            wheelStateRef.current.player.disabledIds = new Set(['fist', 'bat']);
          }
        } else {
          wheelStateRef.current.player.disabledIds = null;
        }
        if (cmd.wheel !== prevWheel) { prevWheel = cmd.wheel; setWheelOpen(cmd.wheel); }
        if (cmd.scoreboard !== prevBoard) { prevBoard = cmd.scoreboard; setShowBoard(cmd.scoreboard); }

        const m = engine.me;

        // ── Aim direction from mouse/stick yaw + pitch ──
        // In-vehicle quick-camera overrides: LB snaps yaw 90° left,
        // RB snaps 90° right, both held looks straight behind the car.
        // Otherwise the player's free look (mouse / right-stick) wins
        // — this matches the user's "fire any direction" requirement.
        if (engine.me.inCar) {
          const v = engine.vehicles.find(x => x.id === engine.me.inCar.id);
          if (v) {
            const L = !!cmd.camLeftHeld, R = !!cmd.camRightHeld;
            let snap = null;
            if (L && R) snap = v.yaw + Math.PI;
            else if (L) snap = v.yaw - Math.PI / 2;
            else if (R) snap = v.yaw + Math.PI / 2;
            if (snap != null) { input.yaw = snap; cmd.yaw = snap; }
          }
        }

        const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
        const fx = -Math.sin(input.yaw) * cp;
        const fy = sp;
        const fz = -Math.cos(input.yaw) * cp;

        // Head height (crouch lowers it slightly)
        const headY = m.y + (m.crouch ? 1.15 : 1.55);

        // camRay used by engine for hit-scan origin + direction
        camRay.ox = m.x; camRay.oy = headY; camRay.oz = m.z;
        camRay.dx = fx;  camRay.dy = fy;    camRay.dz = fz;

        engine.update(dt, cmd, camRay);
        view.sync(engine, now / 1000);
        vfx.update(dt);

        // KOTH hill visual recolour — purple/sky/yellow(contested)/gray
        if (engine._hillVisual && engine.hill) {
          const h = engine.hill;
          const color = h.contested
            ? 0xfacc15
            : h.controller === 'A' ? 0xa78bfa
            : h.controller === 'B' ? 0x38bdf8
            : 0x888888;
          engine._hillVisual.ring.material.color.setHex(color);
          engine._hillVisual.wall.material.color.setHex(color);
          // Pulse brighter when contested.
          const pulse = h.contested ? 0.80 + Math.sin(now / 130) * 0.20 : (h.controller ? 0.85 : 0.65);
          engine._hillVisual.ring.material.opacity = pulse;
          engine._hillVisual.wall.material.opacity = pulse * 0.55;
          // Lazy-swap in the shipped GLB once its loader is done. Once
          // the mesh is attached to the anchor group we HIDE the ring
          // + wall (they were placeholders) so the GLB reads clean.
          if (!engine._hillVisual.glb) {
            const glb = cloneHillMesh(engine._hillVisual.targetD);
            if (glb) {
              engine._hillVisual.glbAnchor.add(glb);
              engine._hillVisual.glb = glb;
              engine._hillVisual.ring.visible = false;
              engine._hillVisual.wall.visible = false;
              // Install a solid, climbable AABB collider matching the
              // GLB's post-scale footprint. This forces players to
              // MANTLE up onto the hill (KOTH capture only counts
              // while standing ON TOP — enforced in engine3d's
              // _updateHill via engine.hill.topY). Slight footprint
              // shrink (×0.42) prevents players from getting stuck on
              // invisible edges when brushing the base.
              const bbox = new THREE.Box3().setFromObject(engine._hillVisual.glbAnchor);
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const cx = engine.hill.x, cz = engine.hill.z;
              const halfX = Math.max(0.5, size.x * 0.42);
              const halfZ = Math.max(0.5, size.z * 0.42);
              const topY = Math.max(0.6, size.y);
              engine.colliders.push({
                x0: cx - halfX, x1: cx + halfX,
                z0: cz - halfZ, z1: cz + halfZ,
                h: topY,
                climbable: true,
                yBase: 0,
              });
              engine.hill.topY = topY;
            }
          }
          // Tint the GLB — emissive glow reflects who's currently
          // standing on it. Neutral (no controller, no contest) fades
          // the emissive to zero so the base texture reads normally.
          if (engine._hillVisual.glb) {
            const neutral = !h.controller && !h.contested;
            const intensity = neutral ? 0 : (h.contested ? 1.35 + Math.sin(now / 130) * 0.35 : 1.15);
            applyHillTint(engine._hillVisual.glb, neutral ? 0x000000 : color, intensity);
          }
        }

        if (arena.stream) arena.stream.update(m.x, m.z, now / 1000);
        if (lightPool) lightPool.update(m.x, m.y + 1.2, m.z, dt);
        // Cloud drift on the sky-dome (if the map has one). Keeps the
        // horizon feeling alive without any per-frame draw cost since
        // it's just an offset uniform update.
        if (scene.__skyDome && scene.__skyDome.material && scene.__skyDome.material.map) {
          const tex = scene.__skyDome.material.map;
          tex.offset.x = (tex.offset.x + dt * 0.005) % 1;
        }

        // ── SR1-accurate third-person camera ──────────────────────────────
        //
        // SR1 behaviour (confirmed from game footage + mod docs):
        //   • Reticle is DEAD CENTRE of the screen at all times.
        //   • Character body sits slightly LEFT of centre so the right half
        //     of the screen is the clear firing lane.
        //   • When aiming/firing, the camera nudges right and pulls in a
        //     little — not a dramatic shoulder-snap like SR2/SR3.
        //   • Bullets fire FROM the character's gun TO the screen-centre
        //     world point — the engine's camRay already handles this; we
        //     just need the camera frustum to agree with it.
        //
        // Implementation:
        //   pivot  = character head + (shoulder offset) to the RIGHT
        //   camera = pivot pulled BACK along -aimDir by camDist
        //   lookAt = pivot projected FAR FORWARD along +aimDir
        //            → this puts screen centre exactly on the aim ray
        //              with NO vertical bias term (that was shooting the floor)

        const aiming = m.aimHoldT > 0;
        const cc = window.__brawl3dCamera || resolveCamera({});

        // Smooth shoulder offset / distance / FOV toward the preset's idle or
        // aiming values (GEARS: 2.6 m → 1.9 m and 50° → 43° when aiming).
        shoulder += ((aiming ? cc.shoulderAim : cc.shoulder) - shoulder) * (1 - Math.exp(-dt * 8));
        camDist  += ((aiming ? cc.distAim : cc.dist) - camDist) * (1 - Math.exp(-dt * 6));
        const wantFov = aiming ? cc.fovAim : cc.fov;
        if (Math.abs(camera.fov - wantFov) > 0.02) { camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 8)); camera.updateProjectionMatrix(); }

        // Right-of-aim unit vector (Y-up, right-handed): for aim (fx, fz) the
        // camera-right direction is (-fz, 0, fx). The old (fz, -fx) was the
        // LEFT vector — it parked the body on the right of the reticle.
        const rightX = -fz;
        const rightZ = fx;

        // Camera follow point — critically damped toward the player so
        // collision nudges, curb step-ups and stair risers never pop the
        // view. Horizontal 30/s (≈40 ms lag), vertical 10/s (stairs /
        // crouch glide instead of snapping); teleports (respawn, vault
        // landing) re-seat it instantly.
        if (!camFollow.ok || Math.hypot(m.x - camFollow.x, m.y - camFollow.y, m.z - camFollow.z) > 6) {
          camFollow.x = m.x; camFollow.y = m.y; camFollow.z = m.z; camFollow.ok = true;
        } else {
          const kh = 1 - Math.exp(-dt * 30), kv = 1 - Math.exp(-dt * 10);
          camFollow.x += (m.x - camFollow.x) * kh;
          camFollow.z += (m.z - camFollow.z) * kh;
          camFollow.y += (m.y - camFollow.y) * kv;
        }
        const followHeadY = camFollow.y + (m.crouch ? 1.15 : 1.55);

        // Pivot: head position shifted right by shoulder offset
        const pivX = camFollow.x + rightX * shoulder;
        // Look-through point: `pivotUp` metres above the head (HIGH: +0.55 so
        // the crosshair floats above the player). Aiming UP lifts it further
        // so the camera never sinks behind the body.
        const pivY = followHeadY + cc.pivotUp + Math.max(0, fy) * camDist * 0.5;
        const pivZ = camFollow.z + rightZ * shoulder;

        // Camera position: pull back from pivot along negative aim direction
        let dist = camDist;
        const tWall = rayWalls(
          arena.colliders,
          { x: pivX, y: pivY, z: pivZ },
          { x: -fx,  y: -fy,  z: -fz },
          dist + 0.4
        );
        if (tWall < dist + 0.3) dist = Math.max(0.35, tWall - 0.3);

        camera.position.set(
          pivX - fx * dist,
          Math.max(0.25, pivY - fy * dist),
          pivZ - fz * dist
        );

        // Hero fill light: halfway from the camera to the pivot, lifted
        // ~0.8 m so the face/torso catch it rather than the feet.
        heroLight.position.set(
          camera.position.x + (pivX - camera.position.x) * 0.5,
          camera.position.y + (pivY - camera.position.y) * 0.5 + 0.8,
          camera.position.z + (pivZ - camera.position.z) * 0.5,
        );

        // KUNG-FU CAMERA SHAKE — random offset scaled by engine.camShake
        // (populated by melee impacts, escalating with combo count). Uses
        // performance.now() as the shake seed so successive frames get
        // decorrelated jitter, not a rigid oscillation. Amplitude peaks
        // ~0.12m in view space so the reticle wobble reads as WEIGHT but
        // doesn't wreck aim.
        if (engine.camShake > 0.001) {
          const s = engine.camShake * 0.14;
          const j = performance.now() * 0.037;
          camera.position.x += Math.sin(j * 1.6 + 0.7) * s;
          camera.position.y += Math.sin(j * 2.3 + 1.9) * s * 0.6;
          camera.position.z += Math.sin(j * 1.9 + 3.1) * s;
        }

        // Look target: project pivot FAR along +aimDir.
        // Using the PIVOT (not the character origin) means the frustum
        // centres on the aim ray even when shoulder != 0, so the reticle
        // drawn at canvas (50%, 50%) tracks bullets correctly.
        // NO Y bias — any offset here is what pushed shots into the floor.
        camera.lookAt(
          pivX + fx * 50,
          pivY + fy * 50,
          pivZ + fz * 50
        );

        // Post-processed render — ACES tone-map, bloom, SSAO, grade.
        scene.userData.physicalSky?.tick(dt);
        renderer.info.reset();
        postFx.render(scene, camera);

        // ── Frame budget: real frame time + dynamic resolution ──────
        // rAF-to-rAF time is the honest number (the Perf HUD's own
        // interval can't see stalls). If we sit above the 60 FPS budget
        // for a while, drop the render scale a notch (bounded to 0.6×);
        // when there's headroom, climb back. Resize at most every 1.5 s
        // so the composer isn't reallocating targets every frame.
        const rawMs = now - perf.lastNow; perf.lastNow = now;
        if (rawMs > 0 && rawMs < 500) {
          perf.ema = perf.ema ? perf.ema * 0.9 + rawMs * 0.1 : rawMs;
          perf.worst = Math.max(perf.worst * 0.98, rawMs);
        }
        perf.frameMs = perf.ema; perf.fps = perf.ema ? 1000 / perf.ema : 0;
        perf.lights = lightPool ? lightPool.boundCount() : 0;
        if (perf.dynamicRes && now - perf.lastScaleAt > 1500 && perf.ema) {
          let next = perf.scale;
          if (perf.ema > 17.5 && perf.scale > 0.6) next = Math.max(0.6, perf.scale - 0.1);
          else if (perf.ema < 12.5 && perf.scale < 1) next = Math.min(1, perf.scale + 0.05);
          if (next !== perf.scale) { perf.scale = next; applyRenderScale(); }
          perf.lastScaleAt = now;
        }

        // 2D HUD overlay
        const hc = hudCanvasRef.current;
        if (hc) {
          const hctx = hc.getContext('2d');
          hctx.clearRect(0, 0, hc.width, hc.height);
          drawMinimap(hctx, engine, input.yaw, hc.height);
          // AAA target reticles (DISABLED per user request — keeping
          // the module + call site so it can be flipped back on with
          // a single line change).
          // drawTargetReticles(hctx, engine, camera, hc.width, hc.height, dt);
          if (!engine.me.dead) {
            const ammoObj = {};
            const reserveObj = {};
            for (let i = 0; i < WEAPONS3D.length; i++) {
              ammoObj[WEAPONS3D[i].id] = engine.me.ammo[i];
              reserveObj[WEAPONS3D[i].id] = engine.me.reserve ? engine.me.reserve[i] : 0;
            }
            drawHealthDial(hctx, {
              hp: engine.me.hp, maxHp: 100,
              sprint: engine.me.stamina, sprintMax: 100,
              weapons: DIAL_WEAPONS, weaponIdx: engine.me.wpnIdx,
              ammo: ammoObj, reserve: reserveObj, reloadT: engine.me.reloadT,
            }, hc.width);
          }
        }
        void cp; void sp;
      };
      // Final warm-up with the COMPLETE scene (view pools, vehicles, hero
      // light, VFX batches) — "fire every weapon and effect once" before
      // the first real frame. Runs behind the pre-match screen.
      warm();
      raf = requestAnimationFrame(loop);

      // HUD snapshots @10Hz
      hudTimer = setInterval(() => {
        const e = engineRef.current;
        if (!e) return;
        const w = WEAPONS3D[e.me.wpnIdx];
        const ammo = e.me.ammo[e.me.wpnIdx];
        const reserve = (e.me.reserve && e.me.reserve[e.me.wpnIdx]) || 0;
        setSnap({
          hp: Math.max(0, Math.round(e.me.hp)),
          hpMax: e.me.hpMax || 100,
          hugCoverDir: e.me.hugCoverDir,   // radians; null when not hugging cover
          hugCoverId:  e.me.hugCoverId,
          // AAA movement — three-tier speed indicator and vault
          // progress so the HUD can render a pill (WALK/JOG/SPRINT)
          // and hide the reticle mid-vault. `speedTier` is 0..2;
          // 0=WALK, 1=JOG, 2=SPRINT.
          speedTier: e.me.speedTier | 0,
          moving: +(e.me.moving || 0).toFixed(2),
          vaulting: e.me._vaultT > 0 ? Math.min(1, 1 - e.me._vaultT / (e.me._vaultDur || 1)) : 0,
          stamina: Math.max(0, Math.min(100, Math.round(e.me.stamina || 0))),
          sprintChain: e.me.sprintChain | 0,
          sprintPerfect: (e.me.sprintPerfectT || 0) > 0,
          sprintBurst: (e.me.sprintBurstT || 0) > 0,
          sprintTapLeft: e.me.sprintTapT > 0 ? +e.me.sprintTapT.toFixed(2) : 0,
          staminaLocked: (e.me.staminaLockT || 0) > 0,
          // Cinematic slow-mo — 0..1 progress ratio while active. HUD
          // uses this to render a soft desaturated vignette so the
          // final kill reads as CINEMA.
          slowMo: e.slowMoT > 0 ? Math.min(1, e.slowMoT / 1.8) : 0,
          myTeam: e.me.team,
          myName: e.me.name,
          wpnName: w.name,
          wpnId: w.id,
          ammoText: w.mag == null ? '∞' : `${ammo} / ${reserve}`,
          reloading: e.me.reloadT > 0,
          firing: !!e.me.firing,
          scores: { A: Math.floor(e.scores.A || 0), B: Math.floor(e.scores.B || 0) },
          timeLeft: e.timeLeft,
          targetKills: e.targetKills,
          gameMode: e.gameMode,
          hill: e.hill ? { label: e.hill.label, controller: e.hill.controller, contested: e.hill.contested } : null,
          inCar: e.me.inCar ? (() => {
            const v = e.vehicles.find(x => x.id === e.me.inCar.id);
            return {
              role: e.me.inCar.role,
              hp: v ? Math.max(0, Math.round(v.hp)) : 0,
              hpMax: v ? v.maxHp : 300,
              burgerHeal: !!e.me.inCar.burgerHeal,
            };
          })() : null,
          killfeed: [...e.killfeed],
          now: e.t,
          dead: e.me.dead,
          respawnT: e.me.respawnT,
          spawnShield: e.me.spawnShield || 0,
          hitMarker: e.hitMarkerT,
          damageFlash: e.damageFlashT,
          phase: e.phase,
          lobbyMode: !!e.lobbyMode,
          lobbyLabel: e._lobbyLabel || 'LOBBY',
          countdownT: e.countdownT || 0,
          goFlashT: e.goFlashT || 0,
          winner: e.winner,
          board: e.scoreboard(),
          teamNames: { ...e.teamNames },
          // AAA HUD hooks — killstreak/multi-kill banner captured
          // from the local player's kills, and last-hit angle so the
          // HUD can render an incoming-damage direction indicator.
          announcement: e.myAnnouncement && (e.t - e.myAnnouncement.t < 2.2)
            ? { text: e.myAnnouncement.text, tier: e.myAnnouncement.tier, age: e.t - e.myAnnouncement.t }
            : null,
          lastHitBy: e.me.lastHitBy && e.me.lastHitByT && (e.t - e.me.lastHitByT < 1.5)
            ? { name: e.me.lastHitBy.name, age: e.t - e.me.lastHitByT, dir: e.me.lastHitByDir || null }
            : null,
          // KUNG-FU HUD — surface the local player's current combo
          // count + the age of the most recent hit so the HUD can pop
          // a "3-HIT COMBO" counter that fades once the chain lapses.
          combo: e.me.comboCount > 1
            ? { count: e.me.comboCount, age: e.t - e.me.comboLastT }
            : null,
        });
      }, 100);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(hudTimer);
      if (gateTimer) clearInterval(gateTimer);
      if (gate) gate.dispose();
      if (onResize) window.removeEventListener('resize', onResize);
      if (onLockChange) document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { void e; } }
      if (input) input.detach();
      if (coop) {
        try { coop.voice.disable(); } catch { /* */ }
        coop.disconnect();
      }
      if (arena && arena.stream) arena.stream.dispose();
      if (destructibles) destructibles.dispose();
      if (lightPool) { lightPool.dispose(); lightPool = null; }
      if (view) view.dispose();
      if (vfx) { vfx.dispose(); vfx = null; }
      stopAllAudio();
      setReverb('street');
      if (engineRef.current && engineRef.current._pauseKeyHandler) {
        window.removeEventListener('keydown', engineRef.current._pauseKeyHandler);
      }
      if (engineRef.current && engineRef.current._hostCheckInterval) {
        clearInterval(engineRef.current._hostCheckInterval);
      }
      if (engineRef.current && engineRef.current._rankedCheckInterval) {
        clearInterval(engineRef.current._rankedCheckInterval);
      }
      if (engineRef.current && engineRef.current._poolCheckInterval) {
        clearInterval(engineRef.current._poolCheckInterval);
      }
      if (engineRef.current && engineRef.current._pauseGpInterval) {
        clearInterval(engineRef.current._pauseGpInterval);
      }
      if (renderer) {
        try { window.__brawl3dPostFx?.dispose?.(); } catch { /* noop */ }
        window.__brawl3dPostFx = null;
        renderer.dispose?.();
        if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId, lobbyMission, matchSize, mapId, gameMode, customMatchActive]);

  const playing = snap && snap.phase === 'play';
  const ended = snap && snap.phase === 'end';
  // Match music: starts with the 3-2-1 (or immediately in lobby maps),
  // loops on the music bus, fades out at the final horn.
  const phase = snap && snap.phase;
  useEffect(() => {
    if (phase === 'countdown' || phase === 'play') {
      const effMap = resolveEffectiveMap({ mapId, lobbyId, lobbyMission, customMatchActive });
      playMusic(musicUrlFor(effMap, getPreloadedRoundMap()));
    } else if (phase === 'end') stopMusic(2.5);
  }, [phase, mapId, lobbyId, lobbyMission, customMatchActive]);
  // Delay the end-of-match scoreboard modal until the cinematic
  // slow-mo has fully played out (~1.8s). During that window the
  // upgraded ragdoll of the losing kill is on-screen, unobstructed,
  // with the "FINAL KILL" flourish from Hud3d visible.
  const showEndUi = ended && (snap.slowMo || 0) <= 0.001;

  // Post-match routing intent:
  //  • `hasLobbyHome` — the user has an actual chill lobby to fall
  //    back on (they explicitly created a warehouse OR entered a
  //    ranked match FROM a source gang lobby). Only for these cases
  //    do we prompt "return to lobby". For auto-matched player games
  //    started from the TGB menu the lobby is disposable — the
  //    player never asked to be in it.
  const hasLobbyHome = (lobbyMission === 'lobby_warehouse') || (lobbyMission === 'lobby_garage') || !!coopRef?.sourceLobbyId;

  // ── B → A "Return to lobby" flow ───────────────────────────────────
  // When a match ends and the player joined via a lobby, they hold B
  // (gamepad button[1] OR keyboard KeyB / Esc) to ARM the prompt, then
  // press A (gamepad button[0] OR keyboard Enter / Space) to confirm and
  // route back to their gang lobby (for ranked matches that's the
  // source gang lobby; otherwise it's the same lobby).
  useEffect(() => {
    if (!ended || !hasLobbyHome) return undefined;
    const returnToLobby = () => {
      const target = coopRef?.sourceLobbyId || lobbyId;
      // Hop to the source lobby. App.js listens for sr:open-brawl3d and
      // re-mounts the game with the new lobby. Preserve the current
      // lobby-family mission (garage vs warehouse) so the player
      // returns to the same style of chill space they came from.
      const backMission = lobbyMission === 'lobby_garage' ? 'lobby_garage' : 'lobby_warehouse';
      window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
        detail: { lobbyId: target, mission: backMission },
      }));
    };
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyB' || e.code === 'Escape') {
        setReturnArmed(true);
      } else if ((e.code === 'Enter' || e.code === 'Space') && returnArmed) {
        e.preventDefault();
        returnToLobby();
      }
    };
    window.addEventListener('keydown', onKey);
    // Gamepad polling — B button arms, A button confirms.
    let prevB = false, prevA = false;
    const gpIv = setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const b = !!p.buttons[1]?.pressed;
        const a = !!p.buttons[0]?.pressed;
        if (b && !prevB) setReturnArmed(true);
        if (a && !prevA && returnArmed) returnToLobby();
        prevB = b; prevA = a;
      }
    }, 60);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(gpIv);
    };
  }, [ended, hasLobbyHome, lobbyId, coopRef, returnArmed]);
  // Reset the armed prompt whenever the match end overlay opens fresh.
  useEffect(() => { if (!ended) setReturnArmed(false); }, [ended]);

  // Ranked-pool safety fallback — coop3d also dispatches this event so
  // the overlay drops even if the polling interval is between ticks.
  // Also resets the engine match timer to a full 5 min so the ~30s
  // waiting delay didn't just eat the beginning of the round.
  useEffect(() => {
    if (!isRankedPool) return undefined;
    const onStart = () => {
      setPoolWaiting(false);
      const e = engineRef.current;
      if (e) {
        e.timeLeft = 300;
        e.phase = 'play';
      }
    };
    window.addEventListener('sr:brawl3d-pool-start', onStart);
    return () => window.removeEventListener('sr:brawl3d-pool-start', onStart);
  }, [isRankedPool]);

  return (
    <div className="absolute inset-0" data-testid="brawl3d-play">
      <div ref={mountRef} className="absolute inset-0" onClick={() => { if (!locked && !ended) requestLock(); }} />
      <canvas ref={hudCanvasRef} className="absolute inset-0 pointer-events-none" data-testid="brawl3d-dial-canvas" />
      <Hud3D snap={snap} showBoard={showBoard} />

      {/* Pre-match — stays up until EVERY asset is resident and (coop)
          the host has fired the shared start. Sits under the ranked
          pool overlay, above the CLICK TO PLAY prompt. */}
      {!poolWaiting && !(loadState.ready && snap && snap.phase !== 'waiting') && (
        <Brawl3DPreMatch
          coop={coopRef}
          displayName={displayName}
          gameMode={gameMode}
          mapLabel={mapLabel}
          load={loadState}
          roster={roster}
          wait={waitInfo}
          locked={locked}
          onLockIn={() => { if (!locked) requestLock(); }}
          onGamepad={() => {
            setGpMode(true); resumeAudio();
            const e = engineRef.current;
            if (e && !coopRef && e.phase === 'waiting' && e.localReady) e.startCountdown(3);
          }}
          onForceStart={() => engineRef.current?.hostForceStart()}
          cancel={onCancelPrematch}
        />
      )}

      {/* Ranked SOLO — SEARCHING overlay. Blocks pointer lock so the
          canvas doesn't try to grab it while the player is waiting. */}
      {poolWaiting && (
        <div
          className="absolute inset-0 z-[240] flex flex-col items-center justify-center bg-gradient-to-b from-purple-950/95 via-black/90 to-black/95"
          onClick={(e) => e.stopPropagation()}
          data-testid="brawl3d-pool-waiting"
        >
          <div className="text-purple-300 text-[11px] font-bold tracking-[0.4em] mb-1">RANKED · SOLO POOL</div>
          <h2 className="text-white text-4xl sm:text-5xl font-black tracking-widest text-center" style={{ textShadow: '0 0 30px #a855f788' }}>
            SEARCHING…
          </h2>
          <div className="mt-6 flex items-baseline gap-3 font-mono text-white">
            <span className="text-6xl font-black text-yellow-300" data-testid="brawl3d-pool-count">{poolStatus.count}</span>
            <span className="text-white/50 text-2xl">/ {poolStatus.min}</span>
            <span className="text-white/30 text-xs">(max {poolStatus.max})</span>
          </div>
          <div className="w-64 h-2 bg-black/60 rounded overflow-hidden mt-4 border border-white/10">
            <div
              className="h-full bg-purple-400 transition-all duration-300"
              style={{ width: `${Math.min(100, (poolStatus.count / Math.max(1, poolStatus.min)) * 100)}%` }}
              data-testid="brawl3d-pool-bar"
            />
          </div>
          <div className="mt-6 flex items-center gap-2 text-emerald-300 text-xs font-bold tracking-widest">
            <i className="fa-solid fa-microphone" />
            VOICE CHAT ACTIVE — TALK TO YOUR SQUAD
          </div>
          <div className="mt-8 text-white/50 text-[11px] max-w-md text-center px-6 leading-relaxed">
            Match starts automatically once <span className="text-yellow-300">{poolStatus.min}</span> saints are in the lobby.
            Fills to <span className="text-yellow-300">{poolStatus.max}</span> for max chaos. NO BOTS — this is humans only.
          </div>
          <button
            onClick={onExit}
            className="mt-10 px-4 py-2 bg-red-900/60 border border-red-700 text-red-200 text-xs font-bold rounded"
            data-testid="brawl3d-pool-exit"
          >LEAVE QUEUE</button>
        </div>
      )}

      {/* In-game gear button — opens the runtime video settings.
          Sits top-right, only visible when NOT pointer-locked so it
          doesn't intercept combat clicks. */}
      {!locked && !ended && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowVideoSettings(true); }}
          className="absolute top-3 right-14 z-[220] w-9 h-9 bg-black/60 hover:bg-black/80 border border-white/20 hover:border-yellow-400/60 text-white/70 hover:text-yellow-300 rounded flex items-center justify-center transition-colors"
          title="Video Settings"
          data-testid="brawl3d-video-settings-ingame"
        >
          <i className="fa-solid fa-sliders text-sm" />
        </button>
      )}
      {!locked && !ended && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMovementLab(true); }}
          className="absolute top-3 right-24 z-[220] w-9 h-9 bg-black/60 hover:bg-black/80 border border-white/20 hover:border-emerald-400/60 text-white/70 hover:text-emerald-300 rounded flex items-center justify-center transition-colors"
          title="Movement Lab — tune speeds live"
          data-testid="brawl3d-movement-lab-ingame"
        >
          <i className="fa-solid fa-person-running text-sm" />
        </button>
      )}
      {!locked && !ended && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowSoundManager(true); }}
          className="absolute top-3 right-[136px] z-[220] w-9 h-9 bg-black/60 hover:bg-black/80 border border-white/20 hover:border-sky-400/60 text-white/70 hover:text-sky-300 rounded flex items-center justify-center transition-colors"
          title="Sound Manager"
          data-testid="brawl3d-sound-manager-ingame"
        >
          <i className="fa-solid fa-volume-high text-sm" />
        </button>
      )}

      <VideoSettingsModal
        open={showVideoSettings}
        onClose={() => setShowVideoSettings(false)}
      />
      <MovementLabPanel open={showMovementLab} onClose={() => setShowMovementLab(false)} />
      <SoundManagerPanel open={showSoundManager} onClose={() => setShowSoundManager(false)} />

      {/* Perf HUD — bottom-right badge. Toggle in Video Settings ("FPS
          overlay") or `window.__brawl3dPerf = true` from devtools. */}
      {showPerf && (
        <PerfHud renderer={rendererRef.current} engine={engineRef.current} />
      )}

      <WeaponWheel
        stateRef={wheelStateRef}
        open={wheelOpen && !!playing}
onPick={(idx) => {
  const e = engineRef.current;
  if (!e || !WEAPONS3D[idx]) { setWheelOpen(false); return; }
  // Mirror the engine's fist→pimpslap redirect so picking the
  // (visually swapped) fist slot while owning Pimp Slap equips
  // the actual pimpslap weapon, not bare fists.
  let realIdx = idx;
  if (idx === WEAPON_INDEX.fist && e.me.hasPimpSlap) {
    realIdx = WEAPON_INDEX.pimpslap;
  }
  const w = WEAPONS3D[realIdx];
  const magOk = (e.me.ammo[realIdx] | 0) > 0;
  const reserveOk = (e.me.reserve && (e.me.reserve[realIdx] | 0) > 0);
  const owned = w.mag == null || magOk || reserveOk;
  if (owned) {
    e.me.wpnIdx = realIdx;
    e.me.reloadT = 0;
    e.me.fireCd = Math.min(e.me.fireCd, 0.08);
  }
  setWheelOpen(false);
}}
      />

      {(playing || (snap && snap.phase === 'countdown')) && loadState.ready && !locked && !gpMode && !poolWaiting && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 cursor-pointer"
          onClick={requestLock}
          data-testid="brawl3d-pause"
        >
          <div className="text-white text-2xl font-black tracking-widest mb-2">CLICK TO PLAY</div>
          <div className="text-white/50 text-xs mb-6">mouse aims · Esc pauses · hold B/Tab for the weapon wheel · hold V for scoreboard</div>
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setGpMode(true); resumeAudio(); }}
              className="px-4 py-2 bg-zinc-800 border border-zinc-600 text-white/80 text-xs font-bold rounded"
              data-testid="brawl3d-gamepad-mode"
            >🎮 PLAYING WITH GAMEPAD</button>
            <button
              onClick={(e) => { e.stopPropagation(); onExit(); }}
              className="px-4 py-2 bg-red-900/60 border border-red-700 text-red-200 text-xs font-bold rounded"
              data-testid="brawl3d-exit"
            >EXIT BRAWL</button>
          </div>
        </div>
      )}

      {showEndUi && hasLobbyHome && coopRef && (
        <RollcallPanel
          coop={coopRef}
          myId={coopRef.id}
          myLobbyId={coopRef.sourceLobbyId || lobbyId}
          myTeam={engineRef.current ? engineRef.current.me.team : 'A'}
        />
      )}

      {showEndUi && (
        <div className="absolute left-1/2 bottom-10 -translate-x-1/2 flex flex-col items-center gap-2" data-testid="brawl3d-end-actions">
          {hasLobbyHome ? (
            <>
              <div className="text-white/60 text-[11px] tracking-widest font-bold">
                NO REMATCH — RETURN TO LOBBY TO RE-QUEUE
              </div>
              <div className={`text-[12px] tracking-widest font-bold ${returnArmed ? 'text-yellow-200' : 'text-white/70'}`} data-testid="brawl3d-return-prompt">
                {returnArmed
                  ? 'PRESS A (or ENTER) TO RETURN TO LOBBY'
                  : 'PRESS B (or ESC) THEN A (or ENTER) TO RETURN TO LOBBY'}
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                <button
                  onClick={() => {
                    const target = coopRef?.sourceLobbyId || lobbyId;
                    const backMission = lobbyMission === 'lobby_garage' ? 'lobby_garage' : 'lobby_warehouse';
                    window.dispatchEvent(new CustomEvent('sr:open-brawl3d', { detail: { lobbyId: target, mission: backMission } }));
                  }}
                  className="px-6 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
                  data-testid="brawl3d-end-return-lobby"
                >BACK TO LOBBY</button>
                {isHost && coopRef && (
                  <>
                    {(coopRef.sourceLobbyId && coopRef.sourceLobbyId !== lobbyId) && (
                      <button
                        onClick={() => returnGroupToLobby()}
                        disabled={partyBusy}
                        className={`px-5 py-3 font-black tracking-widest rounded flex items-center gap-2 ${
                          partyBusy ? 'bg-zinc-800 text-white/40 cursor-wait' : 'bg-emerald-500 text-black hover:bg-emerald-400'
                        }`}
                        data-testid="brawl3d-end-return-group"
                        title="Bring everyone in this match back to your home lobby together"
                      >
                        <i className="fa-solid fa-people-arrows text-[11px]" />
                        RETURN GROUP TO LOBBY
                      </button>
                    )}
                    <button
                      onClick={() => searchAgainTogether()}
                      disabled={partyBusy}
                      className={`px-5 py-3 font-black tracking-widest rounded flex items-center gap-2 ${
                        partyBusy ? 'bg-zinc-800 text-white/40 cursor-wait' : 'bg-cyan-400 text-black hover:bg-cyan-300'
                      }`}
                      data-testid="brawl3d-end-search-together"
                      title="Keep the same crew and hop into a new public match together"
                    >
                      <i className="fa-solid fa-magnifying-glass-arrow-right text-[11px]" />
                      SEARCH AGAIN TOGETHER
                    </button>
                  </>
                )}
              </div>
              {partyErr && (
                <div className="text-red-400 text-[10px] mt-1" data-testid="brawl3d-end-party-err">{partyErr}</div>
              )}
              {isHost && !coopRef && (
                <div className="text-white/40 text-[10px] mt-1">
                  Solo match — no crew to regroup. Play with friends to unlock group actions.
                </div>
              )}
            </>
          ) : lobbyId ? (
            // Auto-matched player match from the TGB menu (no lobby
            // home to return to). Give them a rematch (search another
            // public match) and a bail-back-to-menu instead of
            // dead-ending in a lobby they never asked for.
            <>
              <div className="text-white/60 text-[11px] tracking-widest font-bold">
                MATCH OVER
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('sr:brawl3d-search-other-match'))}
                  className="px-5 py-3 bg-cyan-400 text-black font-black tracking-widest rounded flex items-center gap-2"
                  data-testid="brawl3d-end-search-another"
                >
                  <i className="fa-solid fa-magnifying-glass text-[11px]" />
                  SEARCH ANOTHER
                </button>
                {isHost && coopRef && coopRef.remotes && coopRef.remotes.size > 0 && (
                  <button
                    onClick={() => searchAgainTogether()}
                    disabled={partyBusy}
                    className={`px-5 py-3 font-black tracking-widest rounded flex items-center gap-2 ${
                      partyBusy ? 'bg-zinc-800 text-white/40 cursor-wait' : 'bg-emerald-500 text-black hover:bg-emerald-400'
                    }`}
                    data-testid="brawl3d-end-search-together"
                    title="Keep this crew and requeue together into a fresh match"
                  >
                    <i className="fa-solid fa-magnifying-glass-arrow-right text-[11px]" />
                    SEARCH AGAIN TOGETHER
                  </button>
                )}
                <button
                  onClick={onExit}
                  className="px-5 py-3 bg-yellow-400 text-black font-black tracking-widest rounded"
                  data-testid="brawl3d-end-main-menu"
                >MAIN MENU</button>
              </div>
              {partyErr && (
                <div className="text-red-400 text-[10px] mt-1" data-testid="brawl3d-end-party-err">{partyErr}</div>
              )}
            </>
          ) : (
            <>
              <div className="text-white/60 text-[11px] tracking-widest font-bold">
                MATCH OVER
              </div>
              <button onClick={onExit} className="px-6 py-3 bg-yellow-400 text-black font-black tracking-widest rounded" data-testid="brawl3d-end-exit">EXIT</button>
            </>
          )}
        </div>
      )}

      <LobbyPauseMenu
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        coop={coopRef}
        isHost={isHost}
        lobbyId={lobbyId}
        lobbyMeta={lobbyMeta}
        onStartCustom={(cfg) => {
          // Custom Match: host broadcasts a `cm_start` evt over the
          // coop socket. Every OTHER client's coop3d picks it up in the
          // generic evt handler and dispatches `sr:brawl3d-custom-start`
          // locally — Brawl3DGame's outer listener remounts PlayCanvas
          // with the new map/mode. The host fires the same event
          // locally (backend excludes-self for evt) so their client
          // takes the same route without a round-trip.
          setPauseOpen(false);
          if (coopRef) {
            try { coopRef._send({ type: 'evt', d: { k: 'cm_start', map: cfg.map, mode: cfg.mode, loadout: cfg.loadout } }); } catch { /* */ }
          }
          window.dispatchEvent(new CustomEvent('sr:brawl3d-custom-start', {
            detail: { map: cfg.map, mode: cfg.mode, loadout: cfg.loadout || [] },
          }));
        }}
      />
    </div>
  );
}
