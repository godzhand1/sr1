// Team Gangsta Brawl — in-game pause menu.
//
// Opens with ESC / Start gamepad button (caller wires the toggle).
// Three tabs:
//   • ROSTER — players in the room with per-player MUTE toggle (acts
//              on coop.voice). Shows gang tags next to names.
//   • CUSTOM — host-only match builder (mode + map + starting weapons).
//   • RANKED — queue button (live Gang-vs-Gang matchmaking backend).
// Also: local mic on/off toggle in the header.

import { useEffect, useState } from 'react';
import { queueRanked, cancelRankedQueue } from '../streetfight/lobbyApi.js';
import { loadControllerSettings, saveControllerSettings } from './input3d.js';
import { exportMapToGLB } from './sceneExport.js';
import { pickAndImportMapGLB } from './sceneImport.js';
import { spawnFloodAboveGround, removeFloodAboveGround } from './flood.js';

const MAP_OPTIONS = [
  { id: 'lobby',      label: 'THE LOBBY' },
  { id: 'block',      label: 'CITY BLOCK' },
  { id: 'projects',   label: 'THE PROJECTS' },
  { id: 'graffiti',   label: 'GRAFFITI ALLEY' },
  { id: 'koth_house', label: 'KOTH HOUSE' },
  { id: 'boardroom',  label: 'BOARDROOM' },
];

const STARTING_WEAPON_OPTIONS = [
  { id: 'pistol',   label: 'Pistol',    locked: true  },
  { id: 'bat',      label: 'Bat',       locked: true  },
  { id: 'fist',     label: 'Fists',     locked: true  },
  { id: 'tec9',     label: 'TEC-9',     locked: false },
  { id: 'shotgun',  label: 'Shotgun',   locked: false },
  { id: 'ak47',     label: 'AK-47',     locked: false },
  { id: 'pipebomb', label: 'Pipe Bomb', locked: false },
];

export default function LobbyPauseMenu({ open, onClose, coop, isHost, lobbyId, lobbyMeta, onStartCustom }) {
  const [tab, setTab] = useState('roster');
  const [roster, setRoster] = useState([]);
  const [micMuted, setMicMuted] = useState(false);
  const [queued, setQueued] = useState(!!lobbyMeta?.queued_ranked);
  const [queueErr, setQueueErr] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);

  const [customMap, setCustomMap] = useState('block');
  const [customMode, setCustomMode] = useState('tdm');
  const [customWeapons, setCustomWeapons] = useState(['pistol', 'bat', 'fist']);

  // Live sync of custom-match config across the lobby. When the HOST
  // toggles map/mode/loadout we broadcast `cm_cfg` so every remote
  // sees the leader's current pick in real-time — no more "wait, we
  // jumped to a map I didn't vote for" surprise. Non-hosts read from
  // `coop.lobbyMeta.customMatch` and mirror it into local state so
  // their disabled buttons still show the correct selection.
  const broadcastCfg = (patch) => {
    if (!coop || !isHost) return;
    const cfg = {
      map:     patch.map     ?? customMap,
      mode:    patch.mode    ?? customMode,
      loadout: patch.loadout ?? customWeapons,
    };
    try { coop._send({ type: 'evt', d: { k: 'cm_cfg', ...cfg } }); } catch { /* noop */ }
    // Mirror onto the local lobbyMeta so an early re-open of the
    // pause menu after a reconnect still shows the last known cfg.
    if (coop) coop.lobbyMeta = { ...(coop.lobbyMeta || {}), customMatch: cfg };
  };

  // Non-host: pull the host's live selection out of lobbyMeta on every
  // open + every meta update. Read-only for these clients — their
  // buttons are disabled but reflect the truth of what the leader is
  // about to start.
  useEffect(() => {
    if (!open || isHost) return undefined;
    const applyCfg = () => {
      const cm = (coop?.lobbyMeta?.customMatch) || (lobbyMeta?.customMatch);
      if (!cm) return;
      if (cm.map  && cm.map  !== customMap)  setCustomMap(cm.map);
      if (cm.mode && cm.mode !== customMode) setCustomMode(cm.mode);
      if (Array.isArray(cm.loadout)) {
        // Cheap deep-eq: compare stringified sorted copies before
        // updating so the checkbox toggles don't flicker every tick.
        const a = [...cm.loadout].sort().join(',');
        const b = [...customWeapons].sort().join(',');
        if (a !== b) setCustomWeapons(cm.loadout);
      }
    };
    applyCfg();
    const iv = setInterval(applyCfg, 500);
    return () => clearInterval(iv);
  }, [open, isHost, coop, lobbyMeta, customMap, customMode, customWeapons]);

  // Controller settings — loaded from localStorage on open, persisted
  // + broadcast to the live Input3D via saveControllerSettings() on
  // every change so tweaks take effect mid-match without a reload.
  const [ctrl, setCtrl] = useState(() => loadControllerSettings());
  const updateCtrl = (patch) => {
    const next = { ...ctrl, ...patch };
    setCtrl(next);
    saveControllerSettings(next);
  };

  // TOOLS-tab toggles: whether to embed COL_* collision markers in
  // the exported GLB and whether to honor them on import. Both
  // default to true so the standard round-trip authoring flow
  // works out of the box; users can flip either off for edge cases
  // (e.g. clean geometry-only export for a portfolio shot, or
  // fresh auto-derive on a GLB with stale COL_* boxes).
  const [exportIncludeColliders, setExportIncludeColliders] = useState(true);
  const [importUseMarkers, setImportUseMarkers] = useState(true);

  // Flood-above-ground toggle. When on, spawns the translucent
  // water plane (via /images/flood/*.png + the Blender Principled
  // BSDF port in blenderPBRShader.js) at y=0.15 covering the map.
  // Off by default so it doesn't surprise players in a normal
  // match — it's an authored map effect the user opts into from
  // the TOOLS tab.
  const [floodEnabled, setFloodEnabled] = useState(false);
  const [floodMsg, setFloodMsg] = useState('');
  const toggleFlood = (enabled) => {
    setFloodEnabled(enabled);
    const scene = typeof window !== 'undefined' ? window.__brawl3dScene : null;
    if (!scene) {
      setFloodMsg('Scene not ready — enter a lobby first.');
      setTimeout(() => setFloodMsg(''), 4000);
      return;
    }
    if (enabled) {
      const { dispose } = spawnFloodAboveGround(scene);
      window.__brawl3dFloodDispose = dispose;
      setFloodMsg('Flood spawned — water plane at y=0.15m.');
    } else {
      const removed = removeFloodAboveGround(scene);
      if (typeof window.__brawl3dFloodDispose === 'function') {
        try { window.__brawl3dFloodDispose(); } catch (_) { /* already disposed via remove */ }
        window.__brawl3dFloodDispose = null;
      }
      setFloodMsg(removed ? `Removed ${removed} flood plane${removed > 1 ? 's' : ''}.` : 'No flood present.');
    }
    setTimeout(() => setFloodMsg(''), 4000);
  };

  // Map export (→ Blender). Tracks in-flight state so we can show a
  // disabled/"…exporting" label while GLTFExporter chews through
  // scene traversal. Errors surface into the same status line so a
  // failed export doesn't look like a silent no-op.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const doExportMap = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportMsg('Exporting map… (~15–20s)');
    const mapId = lobbyMeta?.map || coop?.lobbyMeta?.map || 'map';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      await exportMapToGLB(`brawl3d_${mapId}_${ts}.glb`, {
        includeColliders: exportIncludeColliders,
      });
      setExportMsg(
        exportIncludeColliders
          ? 'Downloaded — COL_* markers included. Open in Blender (File → Import → glTF 2.0).'
          : 'Downloaded — geometry only, no collision markers. Open in Blender.'
      );
    } catch (e) {
      setExportMsg('Export failed: ' + (e?.message || 'unknown'));
    } finally {
      setExportBusy(false);
      setTimeout(() => setExportMsg(''), 8000);
    }
  };

  // Import — file picker → GLB → scene + auto-derived collision.
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const doImportMap = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportMsg('Choose a .glb file…');
    try {
      const stats = await pickAndImportMapGLB((p) => {
        if (p?.stage === 'reading') {
          const mb = (p.bytes / (1024 * 1024)).toFixed(1);
          setImportMsg(`Reading ${mb} MB…`);
        } else if (p?.stage === 'sanitizing') {
          setImportMsg('Sanitizing meshes…');
        } else if (p?.stage === 'extracting-markers') {
          setImportMsg(
            importUseMarkers
              ? 'Extracting COL_* collision markers…'
              : 'Stripping COL_* markers (ignoring for collision)…'
          );
        } else if (p?.stage === 'purging-original') {
          setImportMsg('Removing built-in garage geometry…');
        } else if (p?.stage === 'purging-previous') {
          setImportMsg('Removing previous import…');
        } else if (p?.stage === 'using-markers') {
          setImportMsg('Applying Blender-authored collision…');
        } else if (p?.stage === 'deriving-collision') {
          setImportMsg('Auto-deriving collision walls…');
        }
      }, { useMarkers: importUseMarkers });
      const replaced =
        (stats.purgedOriginalEssentials || 0) +
        (stats.purgedOriginalTiles || 0) +
        (stats.purgedPreviousImports || 0);
      const src = stats.collisionSource === 'markers'
        ? `${stats.addedColliders} COL_* markers`
        : `${stats.addedColliders} auto-derived colliders`;
      setImportMsg(
        `Imported ${stats.file} — ${src}`
        + (replaced ? ` (removed ${replaced} old meshes)` : '')
        + (stats.newHalf ? ` · world ±${Math.round(stats.newHalf)}m` : '')
        + '.',
      );
    } catch (e) {
      setImportMsg('Import failed: ' + (e?.message || 'unknown'));
    } finally {
      setImportBusy(false);
      setTimeout(() => setImportMsg(''), 10000);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const iv = setInterval(() => {
      if (!coop) return;
      // `coop.display` and `r.display` are already "[TAG] Nickname"
      // (backend `_resolve_display` builds them). Don't prefix the
      // gang tag again — that produced the double-tag bug in the
      // roster panel.
      const me = coop.id ? { userId: coop.id, display: coop.display || 'YOU', isMe: true, team: 'A', muted: false } : null;
      const remotes = Array.from(coop.remotes.values()).map(r => ({
        userId: r.id,
        display: r.display || 'SAINT',
        team: r.team || 'B',
        muted: coop.voice.isUserMuted(r.id),
      }));
      setRoster(me ? [me, ...remotes] : remotes);
      if (coop.voice.isEnabled()) setMicMuted(coop.voice.getLocalMicMute());
    }, 400);
    return () => clearInterval(iv);
  }, [open, coop]);

  // Sync queued state with WS-relayed ranked_queue / ranked_match_found
  // events emitted by coop3d.
  useEffect(() => {
    if (!open || !coop) return undefined;
    const iv = setInterval(() => {
      // Non-destructive peek at events — coop drains for the engine
      // separately; we re-read from the latest lobbyMeta to stay in sync.
      const meta = coop.lobbyMeta || lobbyMeta;
      if (meta && typeof meta.queued_ranked === 'boolean' && meta.queued_ranked !== queued) {
        setQueued(meta.queued_ranked);
      }
    }, 600);
    return () => clearInterval(iv);
  }, [open, coop, lobbyMeta, queued]);

  if (!open) return null;

  const toggleMic = () => {
    if (!coop || !coop.voice.isEnabled()) return;
    const next = !micMuted;
    coop.voice.setLocalMicMute(next);
    setMicMuted(next);
  };

  const togglePeerMute = (userId) => {
    if (!coop) return;
    coop.voice.toggleUserMute(userId);
    setRoster(prev => prev.map(r => r.userId === userId ? { ...r, muted: !r.muted } : r));
  };

  const toggleWeapon = (id, locked) => {
    if (locked) return;
    // Compute the next value from the CURRENT state (not inside the
    // updater) so broadcastCfg only fires once even under React
    // StrictMode's double-invoke, and so the emitted cm_cfg frame
    // matches exactly what the UI is about to render.
    const next = customWeapons.includes(id)
      ? customWeapons.filter(x => x !== id)
      : [...customWeapons, id];
    setCustomWeapons(next);
    broadcastCfg({ loadout: next });
  };

  const onQueueRanked = async () => {
    if (!lobbyId || !isHost) return;
    setQueueBusy(true); setQueueErr('');
    try {
      if (queued) {
        await cancelRankedQueue(lobbyId);
        setQueued(false);
      } else {
        await queueRanked(lobbyId);
        setQueued(true);
        if (coop) { coop.lobbyMeta = { ...(coop.lobbyMeta || {}), queued_ranked: true }; }
      }
    } catch (e) {
      setQueueErr(e?.response?.data?.detail || 'Queue failed');
    } finally {
      setQueueBusy(false);
    }
  };

  const isGangLobby = (lobbyMeta?.privacy === 'gang') || (coop?.lobbyMeta?.privacy === 'gang');
  const gangName = lobbyMeta?.gang_name || coop?.lobbyMeta?.gang_name || null;
  const isRankedMatch = !!(lobbyMeta?.ranked || coop?.lobbyMeta?.ranked);

  return (
    <div className="absolute inset-0 z-[200] bg-black/85 flex items-center justify-center" data-testid="brawl3d-pause-menu">
      <div className="bg-zinc-950 border border-zinc-800 rounded w-[640px] max-w-[95vw] max-h-[88vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="text-white font-black text-lg tracking-widest">LOBBY MENU</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose?.();
                window.dispatchEvent(new CustomEvent('sr:brawl3d-search-other-match'));
              }}
              className="px-2.5 py-1 text-[10px] font-bold tracking-widest rounded border bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30 flex items-center gap-1"
              data-testid="brawl3d-pause-search-another"
              title="Leave this lobby and search for another open public match"
            >
              <i className="fa-solid fa-magnifying-glass text-[9px]" />
              SEARCH ANOTHER
            </button>
            <button
              onClick={toggleMic}
              className={`px-2.5 py-1 text-[10px] font-bold tracking-widest rounded border ${micMuted ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'}`}
              data-testid="brawl3d-pause-mic-toggle"
            >MIC: {micMuted ? 'OFF' : 'ON'}</button>
            <button onClick={onClose} className="text-white/60 hover:text-white text-sm px-2" data-testid="brawl3d-pause-close">✕</button>
          </div>
        </div>

        <div className="flex border-b border-zinc-800 text-[11px] font-bold tracking-widest">
          {[['roster', 'ROSTER'], ['custom', 'CUSTOM MATCH'], ['ranked', 'RANKED'], ['controller', 'CONTROLLER'], ['tools', 'TOOLS']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-2.5 ${tab === id ? 'bg-yellow-400/20 text-yellow-300 border-b-2 border-yellow-300' : 'text-white/50 hover:text-white/80'}`}
              data-testid={`brawl3d-pause-tab-${id}`}
            >{label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'roster' && (
            <div className="space-y-1.5">
              {roster.length === 0 && (
                <div className="text-white/40 text-xs">No one else in this lobby yet.</div>
              )}
              {roster.map(r => (
                <div key={r.userId} className="flex items-center justify-between bg-zinc-900/60 rounded px-3 py-2 border border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${r.team === 'A' ? 'bg-purple-400' : 'bg-sky-400'}`} />
                    <span className="text-white text-sm font-bold">{r.display}</span>
                    {r.isMe && <span className="text-yellow-400/70 text-[9px] font-bold ml-1">YOU</span>}
                  </div>
                  {!r.isMe && (
                    <button
                      onClick={() => togglePeerMute(r.userId)}
                      className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded border ${r.muted ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'bg-zinc-800 text-white/60 border-zinc-700'}`}
                      data-testid={`brawl3d-pause-mute-${r.userId}`}
                    >{r.muted ? 'MUTED' : 'MUTE'}</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'custom' && (
            <div className="space-y-4">
              {!isHost && (
                <div className="bg-yellow-500/10 border border-yellow-500/40 text-yellow-200 text-[11px] px-3 py-2 rounded">
                  Only the lobby host can start a custom match.
                  {(coop?.lobbyMeta?.customMatch || lobbyMeta?.customMatch) && (
                    <span className="block text-emerald-300 text-[10px] mt-1">
                      Live-syncing host&apos;s selection below.
                    </span>
                  )}
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1.5">Mode</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[['tdm', 'TEAM DM'], ['ffa', 'FREE-FOR-ALL'], ['koth', 'KING OF THE HILL']].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setCustomMode(id);
                        // KOTH mode locks the map to koth_house so
                        // the match doesn't spawn on a map without
                        // a hill. Broadcast BOTH values together to
                        // avoid a two-step flicker on remotes.
                        if (id === 'koth') {
                          setCustomMap('koth_house');
                          broadcastCfg({ mode: id, map: 'koth_house' });
                        } else {
                          broadcastCfg({ mode: id });
                        }
                      }}
                      disabled={!isHost}
                      className={`px-3 py-2 text-xs font-bold rounded border ${customMode === id ? 'border-yellow-400 bg-yellow-500/15 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/60'} ${!isHost ? 'opacity-50' : ''}`}
                      data-testid={`brawl3d-pause-mode-${id}`}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1.5">Map</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {MAP_OPTIONS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setCustomMap(m.id);
                        // koth_house forces mode → koth; leaving
                        // koth_house from a koth match forces mode →
                        // tdm. Broadcast the compound change atomically.
                        if (m.id === 'koth_house') {
                          setCustomMode('koth');
                          broadcastCfg({ map: m.id, mode: 'koth' });
                        } else if (customMode === 'koth') {
                          setCustomMode('tdm');
                          broadcastCfg({ map: m.id, mode: 'tdm' });
                        } else {
                          broadcastCfg({ map: m.id });
                        }
                      }}
                      disabled={!isHost}
                      className={`px-2.5 py-2 text-[11px] font-bold rounded border ${customMap === m.id ? 'border-yellow-400 bg-yellow-500/15 text-yellow-200' : 'border-zinc-700 bg-zinc-900 text-white/60'} ${!isHost ? 'opacity-50' : ''}`}
                      data-testid={`brawl3d-pause-map-${m.id}`}
                    >{m.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1.5">
                  Starting Loadout <span className="text-white/40 normal-case font-normal">(everyone spawns with)</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {STARTING_WEAPON_OPTIONS.map(w => (
                    <button
                      key={w.id}
                      onClick={() => toggleWeapon(w.id, w.locked || !isHost)}
                      disabled={w.locked || !isHost}
                      className={`px-2.5 py-1.5 text-[11px] font-bold rounded border flex items-center justify-between ${customWeapons.includes(w.id) ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 bg-zinc-900 text-white/50'} ${w.locked ? 'opacity-70' : ''} ${!isHost ? 'opacity-50' : ''}`}
                      data-testid={`brawl3d-pause-weapon-${w.id}`}
                    >
                      <span>{w.label}</span>
                      {w.locked && <span className="text-white/30 text-[9px]">ALWAYS</span>}
                    </button>
                  ))}
                </div>
                <div className="text-white/30 text-[9px] mt-1">Weapons not in the loadout still spawn as world pickups.</div>
              </div>
              <button
                disabled={!isHost}
                onClick={() => onStartCustom?.({ map: customMap, mode: customMode, loadout: customWeapons })}
                className={`w-full py-3 font-black tracking-widest rounded ${isHost ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-white/40'}`}
                data-testid="brawl3d-pause-custom-start"
              >START CUSTOM MATCH</button>
            </div>
          )}

          {tab === 'ranked' && (
            <div className="space-y-4 text-center">
              <div className="text-white/70 text-sm">
                {isGangLobby
                  ? <>Queue <span className="text-purple-300 font-bold">[{gangName}]</span> up against another gang searching for ranked Gang-vs-Gang play.</>
                  : isRankedMatch
                    ? 'You are already in a ranked match.'
                    : <span className="text-yellow-300">Ranked Gang-vs-Gang requires a <span className="font-bold">GANG-privacy lobby</span>. This lobby is <span className="font-bold">{coop?.lobbyMeta?.privacy || lobbyMeta?.privacy || 'open'}</span> — pick your gang tag from the SEARCH ANOTHER menu, or head back to the TGB menu and use CREATE LOBBY with the Gang privacy option.</span>}
              </div>
              <div className="text-white/40 text-[11px]">
                NO REMATCH — after each match you return to this lobby and must re-queue.
              </div>
              {queueErr && (
                <div className="text-red-400 text-[11px]" data-testid="brawl3d-pause-rank-err">{queueErr}</div>
              )}
              <button
                disabled={!isHost || !isGangLobby || isRankedMatch || queueBusy}
                onClick={onQueueRanked}
                className={`w-full py-3 font-black tracking-widest rounded ${queued ? 'bg-red-500 text-white' : (isHost && isGangLobby && !isRankedMatch ? 'bg-purple-500 text-white' : 'bg-zinc-800 text-white/40')}`}
                data-testid="brawl3d-pause-rank-queue"
              >{queueBusy ? 'WORKING…' : queued ? 'CANCEL QUEUE' : 'QUEUE FOR RANKED'}</button>
              {/* When a non-gang lobby blocks ranked, offer a shortcut
                  back to the TGB menu's CREATE LOBBY dialog so the
                  host doesn't have to hunt for it. */}
              {!isGangLobby && !isRankedMatch && (
                <button
                  onClick={() => {
                    onClose?.();
                    window.dispatchEvent(new CustomEvent('sr:brawl3d-search-other-match'));
                  }}
                  className="w-full py-2 font-black tracking-widest rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 text-[11px]"
                  data-testid="brawl3d-pause-rank-leave-for-gang"
                >LEAVE LOBBY & CREATE A GANG LOBBY</button>
              )}
              <div className="text-white/30 text-[10px]">
                {isHost ? 'Only the host can queue the lobby.' : 'Ask the host to queue the lobby.'}
              </div>
            </div>
          )}

          {tab === 'controller' && (
            <div className="space-y-5" data-testid="brawl3d-pause-controller">
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400">Look Sensitivity — Horizontal (X)</div>
                  <div className="text-white/60 text-[11px] font-mono" data-testid="brawl3d-ctrl-sensx-value">{ctrl.sensX.toFixed(2)}×</div>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="2.50"
                  step="0.05"
                  value={ctrl.sensX}
                  onChange={(e) => updateCtrl({ sensX: parseFloat(e.target.value) })}
                  className="w-full accent-yellow-400"
                  data-testid="brawl3d-ctrl-sensx"
                />
                <div className="flex justify-between text-white/30 text-[9px] mt-0.5">
                  <span>SLOW</span><span>DEFAULT (1.00)</span><span>FAST</span>
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400">Look Sensitivity — Vertical (Y)</div>
                  <div className="text-white/60 text-[11px] font-mono" data-testid="brawl3d-ctrl-sensy-value">{ctrl.sensY.toFixed(2)}×</div>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="2.50"
                  step="0.05"
                  value={ctrl.sensY}
                  onChange={(e) => updateCtrl({ sensY: parseFloat(e.target.value) })}
                  className="w-full accent-yellow-400"
                  data-testid="brawl3d-ctrl-sensy"
                />
                <div className="flex justify-between text-white/30 text-[9px] mt-0.5">
                  <span>SLOW</span><span>DEFAULT (1.00)</span><span>FAST</span>
                </div>
              </div>

              <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2.5">
                <div>
                  <div className="text-white text-sm font-bold">Vibration</div>
                  <div className="text-white/40 text-[10px]">Rumble when taking damage & landing hits.</div>
                </div>
                <button
                  onClick={() => updateCtrl({ vibration: !ctrl.vibration })}
                  className={`px-3 py-1.5 text-[11px] font-black tracking-widest rounded border ${ctrl.vibration ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-zinc-800 text-white/40 border-zinc-700'}`}
                  data-testid="brawl3d-ctrl-vibration"
                >{ctrl.vibration ? 'ON' : 'OFF'}</button>
              </div>

              <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2.5">
                <div>
                  <div className="text-white text-sm font-bold">Crouch Toggle</div>
                  <div className="text-white/40 text-[10px]">ON: tap to crouch/stand. OFF: hold to crouch (legacy).</div>
                </div>
                <button
                  onClick={() => updateCtrl({ crouchToggle: !ctrl.crouchToggle })}
                  className={`px-3 py-1.5 text-[11px] font-black tracking-widest rounded border ${ctrl.crouchToggle ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-zinc-800 text-white/40 border-zinc-700'}`}
                  data-testid="brawl3d-ctrl-crouch-toggle"
                >{ctrl.crouchToggle ? 'ON' : 'OFF'}</button>
              </div>

              <button
                onClick={() => updateCtrl({ sensX: 1.0, sensY: 1.0, vibration: true, crouchToggle: true })}
                className="w-full py-2 text-[11px] font-bold tracking-widest rounded border border-zinc-700 bg-zinc-900 text-white/60 hover:text-white hover:border-yellow-500/60"
                data-testid="brawl3d-ctrl-reset"
              >RESET TO DEFAULTS</button>
            </div>
          )}

          {tab === 'tools' && (
            <div className="space-y-4">
              <div className="bg-zinc-900/60 border border-zinc-800 rounded p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1">
                  Export map for Blender
                </div>
                <div className="text-white/60 text-[11px] leading-snug mb-3">
                  Downloads a <span className="text-white/80 font-mono">.glb</span> snapshot of
                  the current map plus one translucent colored box per collider, parented
                  under a single <span className="font-mono text-white/80">COLLISION</span>{' '}
                  empty (click its eye-icon in Blender to hide every marker in one shot).
                  Boxes are named <span className="font-mono text-white/80">COL_&lt;kind&gt;_&lt;n&gt;</span>{' '}
                  and colored by role:
                  <span className="text-red-300"> red=wall</span>,
                  <span className="text-orange-300"> orange=barrier</span>,
                  <span className="text-yellow-300"> yellow=fence</span>,
                  <span className="text-cyan-300"> cyan=platform</span>,
                  <span className="text-green-300"> green=climbable crate</span>,
                  <span className="text-pink-300"> magenta=pillar</span>.
                  Move / resize / duplicate / delete them in Blender to author your own
                  collision — on re-import the game reads any COL_ prefixed mesh verbatim.
                </div>
                <div className="text-white/40 text-[10px] leading-snug mb-3">
                  Blender tip: press <span className="text-white/60 font-mono">Alt+Z</span> for
                  X-Ray mode or switch viewport shading to Material Preview to see the boxes
                  as translucent. Materials on the map geometry export as flat colors (Blender
                  stalls on procedural canvas textures) — re-link photos from{' '}
                  <span className="text-white/60 font-mono">public/images/</span> if you want
                  the full look. Export takes ~15–20s for this scene.
                </div>
                <label className="flex items-center gap-2 mb-2 text-[11px] text-white/80 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exportIncludeColliders}
                    onChange={(e) => setExportIncludeColliders(e.target.checked)}
                    className="accent-yellow-400"
                    data-testid="brawl3d-tools-export-include-colliders"
                  />
                  Include <span className="font-mono text-white/60">COL_*</span> collision markers
                </label>
                <button
                  onClick={doExportMap}
                  disabled={exportBusy}
                  className={`w-full py-2 text-[11px] font-black tracking-widest rounded border ${
                    exportBusy
                      ? 'bg-zinc-800 text-white/40 border-zinc-700 cursor-wait'
                      : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50 hover:bg-yellow-500/30'
                  }`}
                  data-testid="brawl3d-tools-export-map"
                >
                  <i className="fa-solid fa-file-export mr-1.5 text-[10px]" />
                  {exportBusy ? 'EXPORTING…' : 'EXPORT MAP (.GLB)'}
                </button>
                {exportMsg && (
                  <div
                    className={`mt-2 text-[11px] ${
                      exportMsg.startsWith('Export failed') ? 'text-red-300' : 'text-emerald-300'
                    }`}
                    data-testid="brawl3d-tools-export-status"
                  >
                    {exportMsg}
                  </div>
                )}
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 rounded p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 mb-1">
                  Import edited map from Blender
                </div>
                <div className="text-white/60 text-[11px] leading-snug mb-3">
                  Load a <span className="text-white/80 font-mono">.glb</span> you edited in
                  Blender back into the running lobby. If the GLB contains{' '}
                  <span className="font-mono text-white/80">COL_&lt;n&gt;</span> boxes, they&apos;re used
                  as collision AS-IS (your Blender authoring wins). If NONE are present,{' '}
                  <span className="text-white/80">collision is auto-derived</span> via a voxel
                  occupancy sampler that works at any rotation — the door opening in your
                  garage stays walkable, props get their own collider automatically.
                </div>
                <div className="text-white/40 text-[10px] leading-snug mb-3">
                  Note: importing REPLACES the built-in garage&apos;s structural geometry
                  (walls, ground, roads, sidewalks, fences, barriers) and clears all
                  collision so the player only bumps into the new mesh. Lights, sky
                  dome, and clouds are preserved so the scene stays lit. Spawn points
                  and pickups still come from the map&apos;s code. Large files (100 MB+)
                  can take a minute to parse.
                </div>
                <label className="flex items-center gap-2 mb-2 text-[11px] text-white/80 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={importUseMarkers}
                    onChange={(e) => setImportUseMarkers(e.target.checked)}
                    className="accent-yellow-400"
                    data-testid="brawl3d-tools-import-use-markers"
                  />
                  Use <span className="font-mono text-white/60">COL_*</span> markers as collision
                  <span className="text-white/40 text-[10px]">(uncheck to auto-derive only)</span>
                </label>
                <button
                  onClick={doImportMap}
                  disabled={importBusy}
                  className={`w-full py-2 text-[11px] font-black tracking-widest rounded border ${
                    importBusy
                      ? 'bg-zinc-800 text-white/40 border-zinc-700 cursor-wait'
                      : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50 hover:bg-yellow-500/30'
                  }`}
                  data-testid="brawl3d-tools-import-map"
                >
                  <i className="fa-solid fa-file-import mr-1.5 text-[10px]" />
                  {importBusy ? 'IMPORTING…' : 'IMPORT MAP (.GLB)'}
                </button>
                {importMsg && (
                  <div
                    className={`mt-2 text-[11px] ${
                      importMsg.startsWith('Import failed') ? 'text-red-300' : 'text-emerald-300'
                    }`}
                    data-testid="brawl3d-tools-import-status"
                  >
                    {importMsg}
                  </div>
                )}
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 rounded p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-1">
                  Flood above ground
                </div>
                <div className="text-white/60 text-[11px] leading-snug mb-3">
                  Spawns a translucent water plane at y = 0.15 m covering the map. Renders with
                  the exact Blender Principled BSDF graph you authored — BASE COLOR (sRGB) +
                  METALLIC ROUGHNESS (Non-Color) + Normal, Mapping node loc/rot/scale intact,
                  Alpha Factor Multiply ×0.45, Metallic Factor Multiply ×-26.9. Toggle off to
                  remove the plane and free its textures.
                </div>
                <label className="flex items-center gap-2 text-[11px] text-white/80 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={floodEnabled}
                    onChange={(e) => toggleFlood(e.target.checked)}
                    className="accent-cyan-400"
                    data-testid="brawl3d-tools-flood-toggle"
                  />
                  Flood the map (adds ankle-deep water surface)
                </label>
                {floodMsg && (
                  <div
                    className="mt-2 text-[11px] text-cyan-300"
                    data-testid="brawl3d-tools-flood-status"
                  >
                    {floodMsg}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
