// Team Gangsta Brawl — multiplayer client over the same
// /api/streetfight/ws relay the 2D game uses.  3D state packets ride
// the generic `state` message; gameplay events (tracers, deaths, bot
// damage) ride the new generic `evt` relay.
import { recoverCommunityAuth } from '../userIdentity';
import { VoiceChat } from './voice.js';

const SEND_INTERVAL = 100;     // ~10Hz state
const RENDER_DELAY = 140;      // interpolation delay for remotes (ms)

export class Coop3D {
  constructor() {
    this.ws = null;
    this.id = null;
    this.display = '';
    this.gangTag = null;
    this.hostId = null;
    this.connected = false;
    this.remotes = new Map();      // uid -> {id, display, gangTag, team, build, samples, latest}
    this._events = [];
    this._lastSent = 0;
    this._shouldReconnect = false;
    this._reconnectT = null;
    // Lobby metadata captured from the welcome packet — drives the
    // ranked HUD ("THE WESTSIDE vs VICE KINGS") and the
    // back-to-lobby flow after a ranked match.
    this.lobbyMeta = null;
    this.sourceLobbyId = null;   // your gang's home lobby (ranked only)
    // Ranked solo pool state — updated via pool_status broadcasts. The
    // waiting-room UI reads `poolStatus.{count,min,max}` and flips off
    // when `poolStarted` becomes true.
    this.poolStatus = null;
    this.poolStarted = false;
    // Ready-up handshake (pre-match): `ready` = this client has every
    // asset resident; `matchGo` = the host fired the shared start.
    this.ready = false;
    this.matchGo = false;
    this._chat = [];
    // Voice chat — created lazily on first lobby join; the engine
    // calls coop.voice.enable(...) when the player approves the mic.
    this.voice = new VoiceChat();
  }

  connect(build, lobbyId) {
    const base = process.env.REACT_APP_BACKEND_URL;
    if (!base || !lobbyId) return false;
    this._build = build;
    this._lobbyId = lobbyId;
    this._shouldReconnect = true;
    this._open(base);
    return true;
  }

  _open(base) {
    const token = localStorage.getItem('sr_community_token');
    if (!token) return;
    const wsBase = base.replace(/^http/, 'ws');
    let ws;
    try {
      ws = new WebSocket(`${wsBase}/api/streetfight/ws?token=${encodeURIComponent(token)}&lobby_id=${encodeURIComponent(this._lobbyId)}`);
    } catch { return; }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', character: { kind: 'custom', game: 'brawl3d', build: this._build } }));
      // Client-side keepalive — send a light frame every 15 s so the
      // ingress proxy sees bidirectional traffic even during pre-match
      // lobby phases where no state packets are flowing yet. Backend
      // ignores unknown types silently, so this is safe.
      this._kaTimer = setInterval(() => {
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
        } catch { /* noop */ }
      }, 15000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._handle(msg);
    };
    ws.onclose = (ev) => {
      this.connected = false;
      this.remotes.clear();
      if (this._kaTimer) { clearInterval(this._kaTimer); this._kaTimer = null; }
      if (!this._shouldReconnect) return;
      if (ev && ev.code === 4401) {
        recoverCommunityAuth(base).then((fresh) => {
          if (fresh && this._shouldReconnect) this._open(base);
        });
        return;
      }
      // Any server-initiated close in the 4xxx range is intentional
      // (replaced-by-new-session=4000 was previously auto-reconnected,
      // producing tab-kicks-tab reconnect loops when two clients from
      // the same user were open). Only pure network/transport failures
      // (code 1006, no code, or 1000-normal closes) get a retry.
      if (ev && ev.code >= 4000 && ev.code < 4500) return;
      this._reconnectT = setTimeout(() => this._open(base), 3000);
    };
    ws.onerror = () => {};
  }

  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectT);
    if (this._kaTimer) { clearInterval(this._kaTimer); this._kaTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
    this.connected = false;
    this.remotes.clear();
  }

  _handle(msg) {
    switch (msg.type) {
      case 'welcome': {
        this.id = msg.id;
        this.display = msg.display;
        this.gangTag = msg.gang_tag || null;
        this.hostId = msg.lobby?.host_id || null;
        this.lobbyMeta = msg.lobby || null;
        this.sourceLobbyId = msg.lobby?.your_source_lobby || null;
        // Ranked pool state seeded from the welcome packet — the
        // client-side waiting screen reads these before any pool_status
        // broadcast has landed.
        if (msg.lobby?.pool_min && msg.lobby?.pool_max) {
          this.poolStatus = {
            count: (msg.players || []).length,
            min: msg.lobby.pool_min | 0,
            max: msg.lobby.pool_max | 0,
          };
        }
        this.poolStarted = !!msg.lobby?.pool_started;
        this.connected = true;
        this._events.push({ type: 'lobby_meta', lobby: msg.lobby });
        for (const p of msg.players || []) this._addRemote(p);
        this._events.push({ type: 'roster', text: 'connected' });
        // Voice — for ranked solo pool we force-enable the mic
        // immediately (the whole point of the pool is to talk while
        // searching). For every other lobby, keep the lazy-enable
        // behaviour: mic prompt only triggers when a remote peer
        // actually joins, so single-player rooms don't stall on the
        // browser permission prompt.
        const isPool = msg.lobby?.mission === 'ranked_pool';
        const hasPeers = (msg.players || []).some((p) => p.id !== this.id);
        if (isPool || hasPeers) {
          this.voice.enable({
            send: (m) => this._send(m),
            myUserId: this.id,
          }).then((ok) => {
            if (!ok) return;
            for (const p of msg.players || []) {
              if (p.id !== this.id) this.voice.onPeerJoin(p.id);
            }
          });
        }
        break;
      }
      case 'join': {
        if (msg.player && msg.player.id !== this.id) {
          this._addRemote(msg.player);
          this._events.push({ type: 'roster', text: `${msg.player.display} dropped in` });
          // Ready-up handshake: a newcomer has no idea we're already
          // loaded — tell them (the host's `go` re-broadcast rides on it).
          if (this.ready) this.sendEvt({ k: 'rdy', v: 1 });
          if (this.voice.isEnabled()) {
            this.voice.onPeerJoin(msg.player.id);
          } else {
            // Lazy voice-enable — the first remote peer arriving turns
            // on the mic; solo lobbies stay silent (no mic prompt).
            this.voice.enable({
              send: (m) => this._send(m),
              myUserId: this.id,
            }).then((ok) => {
              if (ok) this.voice.onPeerJoin(msg.player.id);
            });
          }
        }
        break;
      }
      case 'leave': {
        this.remotes.delete(msg.id);
        this._events.push({ type: 'roster', text: `${msg.display || 'a saint'} left` });
        if (this.voice.isEnabled()) this.voice.onPeerLeave(msg.id);
        break;
      }
      case 'host': {
        this.hostId = msg.id;
        this._events.push({ type: 'roster', text: `${msg.display} is now host` });
        break;
      }
      case 'state': {
        const r = this.remotes.get(msg.id);
        if (r && msg.s) {
          const sample = { at: performance.now(), ...msg.s };
          r.latest = sample;
          r.samples.push(sample);
          if (r.samples.length > 14) r.samples.shift();
          if (msg.s.rd) r.ready = true;   // belt-and-braces for a missed `rdy` evt
        }
        break;
      }
      case 'evt': {
        this._events.push({ type: 'evt', from: msg.id, d: msg.d });
        // Ready-up: mirror onto the remote record so the pre-match
        // roster shows who is still loading.
        if (msg.d && msg.d.k === 'rdy') {
          const r = this.remotes.get(msg.id);
          if (r) r.ready = !!msg.d.v;
        }
        if (msg.d && msg.d.k === 'go') this.matchGo = true;
        if (msg.d && msg.d.k === 'chat') {
          this._chat.push({ from: String(msg.d.n || 'PLAYER').slice(0, 24), text: String(msg.d.t || '').slice(0, 200), t: Date.now() });
          if (this._chat.length > 60) this._chat.shift();
        }
        // Cross-cutting lobby-control events piggy-back on the generic
        // `evt` relay. Handle them side-effect-style here so any React
        // component can listen without waiting for the engine loop to
        // drain events.
        if (msg.d && msg.d.k === 'cm_start' && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sr:brawl3d-custom-start', {
            detail: { map: msg.d.map, mode: msg.d.mode, loadout: msg.d.loadout || [] },
          }));
        }
        // Rollcall / pickup — end-of-match lobby-hop coordination.
        //   rc: {willing:bool} — a player toggled their "come with me"
        //       intent. Mirror onto the remote record so the UI can
        //       show a checkmark next to their name.
        //   pu: {tid, lid, from} — someone accepted a player's rollcall
        //       and wants to bring them into their lobby. Only the
        //       target (`tid === this.id`) dispatches the reroute.
        if (msg.d && msg.d.k === 'rc') {
          const r = this.remotes.get(msg.id);
          if (r) r.rollcall = !!msg.d.willing;
        }
        if (msg.d && msg.d.k === 'pu' && typeof window !== 'undefined') {
          if (msg.d.tid === this.id && msg.d.lid) {
            window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
              detail: { lobbyId: msg.d.lid, mission: msg.d.mission || 'lobby_warehouse' },
            }));
          }
        }
        // Return-to-lobby broadcast (party matchmaking upgrade). The
        // lobby LEADER at the end of a match fires this to bring the
        // whole crew somewhere in one click — either home to the
        // source lobby ("RETURN GROUP TO LOBBY") or forward into a
        // fresh brawl3d lobby they just created ("SEARCH AGAIN
        // TOGETHER"). Every remote hops via the same
        // `sr:open-brawl3d` path the invite / matchmaker uses.
        //   rtl: {lid, mission}  — required target lobby id + mission
        //                          the caller wants members to land on.
        // The `mission` defaults to 'brawl' when omitted so a bare
        // rtl still routes cleanly.
        if (msg.d && msg.d.k === 'rtl' && typeof window !== 'undefined') {
          if (msg.d.lid) {
            window.dispatchEvent(new CustomEvent('sr:open-brawl3d', {
              detail: { lobbyId: msg.d.lid, mission: msg.d.mission || 'brawl' },
            }));
          }
        }
        // Live custom-match config sync — as the host clicks around
        // in the pause menu's Custom Match tab we broadcast the
        // current selection so every remote sees WHAT the leader is
        // about to start (no more "wait, why did we jump to a map I
        // didn't pick?" surprise). Stored on `lobbyMeta.customMatch`
        // so the LobbyPauseMenu reads it at render time.
        //   cm_cfg: {map, mode, loadout}
        if (msg.d && msg.d.k === 'cm_cfg') {
          const cfg = {
            map:     msg.d.map     || undefined,
            mode:    msg.d.mode    || undefined,
            loadout: Array.isArray(msg.d.loadout) ? msg.d.loadout : undefined,
          };
          this.lobbyMeta = { ...(this.lobbyMeta || {}), customMatch: cfg };
        }
        break;
      }
      case 'hit': {
        const r = this.remotes.get(msg.from_id);
        // A host-simulated bot shot us: the relay stamps the HOST as
        // sender, but `shooter` carries the bot's real identity.
        const sh = msg.shooter && typeof msg.shooter === 'object' ? msg.shooter : null;
        this._events.push({
          type: 'hit',
          damage: msg.damage,
          fromId: sh && sh.id ? sh.id : msg.from_id,
          fromName: sh && sh.name ? sh.name : msg.from,
          fromTeam: sh && sh.team ? sh.team : (r ? r.team : null),
          weaponId: msg.weaponId || msg.weapon_id || null,
          impact: msg.impact || null,
        });
        break;
      }
      case 'room_full': {
        this._shouldReconnect = false;
        this._events.push({ type: 'roster', text: 'lobby full' });
        break;
      }
      case 'ping': {
        // Backend sends {type:'ping'} every 25s. Reply with 'pong'
        // (or ANY frame) so the ingress proxy sees bidirectional
        // traffic and doesn't idle-close the WS during lobby /
        // pre-match phases where no state packets flow yet.
        try { this.ws && this.ws.send(JSON.stringify({ type: 'pong' })); } catch { /* noop */ }
        break;
      }
      case 'voice_offer':
      case 'voice_answer':
      case 'voice_ice': {
        if (this.voice.isEnabled()) this.voice.onSignal(msg);
        break;
      }
      case 'ranked_queue': {
        this._events.push({ type: 'ranked_queue', queued: !!msg.queued, gang_name: msg.gang_name || null });
        break;
      }
      case 'ranked_match_found': {
        this.pendingRankedMatch = {
          match_lobby_id: msg.match_lobby_id,
          your_team: msg.your_team,
          your_gang_name: msg.your_gang_name,
          opponent_gang_name: msg.opponent_gang_name,
          your_source_lobby: msg.your_source_lobby,
        };
        this._events.push({
          type: 'ranked_match_found',
          ...this.pendingRankedMatch,
        });
        break;
      }
      case 'pool_status': {
        // Ranked solo pool — waiting-room UI polls this off `poolStatus`.
        this.poolStatus = {
          count: msg.count | 0,
          min: msg.min_players | 0,
          max: msg.max_players | 0,
        };
        this._events.push({ type: 'pool_status', ...this.poolStatus });
        break;
      }
      case 'pool_start': {
        // Grace timer expired (or MAX hit) — the pool has flipped to a
        // live match. The engine already renders normally; the UI just
        // needs to drop its "SEARCHING" overlay. Fire a window event so
        // Brawl3DGame can flip its `poolStarted` state without waiting
        // for a drain-events tick.
        this.poolStarted = true;
        this._events.push({ type: 'pool_start', players: msg.players | 0 });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sr:brawl3d-pool-start', {
            detail: { players: msg.players | 0 },
          }));
        }
        break;
      }
      default:
        break;
    }
  }

  _addRemote(p) {
    this.remotes.set(p.id, {
      id: p.id,
      display: p.display || p.username || 'SAINT',
      gangTag: p.gang_tag || null,
      team: null,                 // assigned by engine team computation
      build: p.character && p.character.build,
      samples: [],
      latest: p.s ? { at: performance.now(), ...p.s } : null,
      // Where this player entered from before matchmaking. The
      // client uses it to color the teammate arrow — green for
      // "came from my lobby", team color for a random matched ally.
      sourceLobbyId: p.source_lobby_id || null,
    });
  }

  drainEvents() {
    const evs = this._events;
    this._events = [];
    return evs;
  }

  // Pre-match / lobby chat lines (separate queue so the engine's event
  // drain and the chat panel never steal each other's messages).
  drainChat() {
    const c = this._chat;
    this._chat = [];
    return c;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* noop */ }
    }
  }

  sendState(s) {
    const now = performance.now();
    if (now - this._lastSent < SEND_INTERVAL) return;
    this._lastSent = now;
    this._send({ type: 'state', s });
  }

  sendEvt(d) { this._send({ type: 'evt', d }); }

  // Compat: legacy 5-arg signature (targetId, dmg, fromName, fromTeam, weaponId)
  // still works — we sniff whether arg3 is a string (fromName) or an
  // object (impact). Callers should prefer the 4-arg form when they
  // have an impact vector for the ragdoll.
  // (targetId, damage, weaponId, impact, shooter?) — `shooter` = {id, name,
  // team} identifies a HOST-simulated BOT so the victim credits the bot
  // (kill, killfeed, team score) instead of the host's account.
  sendHit(targetId, damage, weaponId = null, impact = null, shooter = null) {
    this._send({ type: 'hit', target_id: targetId, damage, weaponId, impact, shooter });
  }

  // Interpolated remote list for rendering.
  frame(nowMs) {
    const list = [];
    for (const r of this.remotes.values()) {
      const s = this._interp(r, nowMs);
      if (!s) continue;
      list.push({ id: r.id, display: r.display, gangTag: r.gangTag, team: r.team || s.team || 'B', build: r.build, s });
    }
    return list;
  }

  _interp(r, nowMs) {
    const ss = r.samples;
    if (!ss.length) return r.latest;
    const t = nowMs - RENDER_DELAY;
    if (t <= ss[0].at) return ss[0];
    for (let i = ss.length - 1; i >= 0; i--) {
      if (ss[i].at <= t) {
        const a = ss[i], b = ss[i + 1];
        if (!b) return a;
        const f = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at));
        return {
          ...b,
          x: a.x + (b.x - a.x) * f,
          y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: a.yaw + (b.yaw - a.yaw) * f,
        };
      }
    }
    return ss[0];
  }
}
