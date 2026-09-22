// Streetfight co-op client — 12-player drop-in/drop-out sync over the
// `/api/streetfight/ws` relay.  Remote Saints are rendered from a small
// interpolation buffer ~160ms behind realtime; combined with the
// server's artificial 80-200ms relay jitter this reproduces the
// slightly drifty SR1 multiplayer feel on purpose.
import { buildCharacterRecord, buildCustomCharacterRecord } from './characters.js';
import { recoverCommunityAuth } from '../userIdentity';

const RENDER_DELAY = 160;      // ms behind realtime for remote interpolation
const SEND_INTERVAL = 100;     // ms between local state packets (~10Hz)

export class CoopClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.display = '';
    this.connected = false;
    this.remotes = new Map();   // uid -> remote record
    this._events = [];          // queued gameplay events for engine.tick
    this._lastSent = 0;
    this._meta = null;
    this._shouldReconnect = false;
    this._reconnectT = null;
    this._frameCache = { t: -1, list: [] };
  }

  connect(characterMeta, lobbyId) {
    const base = process.env.REACT_APP_BACKEND_URL;
    if (!base || !lobbyId) return false;
    this._meta = characterMeta;
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
    } catch {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', character: this._meta }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._handle(msg);
    };
    ws.onclose = (ev) => {
      this.connected = false;
      this.remotes.clear();
      if (!this._shouldReconnect) return;
      if (ev && ev.code === 4401) {
        // Stale rotated token — recover the same user via device
        // fingerprint, then retry with the fresh token.
        recoverCommunityAuth(base).then((fresh) => {
          if (fresh && this._shouldReconnect) this._open(base);
        });
        return;
      }
      // Other 44xx = lobby gone / not allowed / full — don't hammer.
      if (ev && ev.code >= 4400 && ev.code < 4500) return;
      this._reconnectT = setTimeout(() => this._open(base), 3000);
    };
    ws.onerror = () => {};
  }

  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectT);
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.connected = false;
    this.remotes.clear();
  }

  _handle(msg) {
    switch (msg.type) {
      case 'welcome': {
        this.id = msg.id;
        this.display = msg.display || '';
        this.lobby = msg.lobby || null;
        this.connected = true;
        for (const p of msg.players || []) this._addRemote(p);
        break;
      }
      case 'join': {
        if (msg.player && msg.player.id !== this.id) {
          this._addRemote(msg.player);
          this._events.push({ type: 'join', display: msg.player.display });
        }
        break;
      }
      case 'state': {
        const r = this.remotes.get(msg.id);
        if (r && msg.s) {
          const sample = { at: performance.now(), ...msg.s };
          r.samples.push(sample);
          // Trim anything older than 2 s — interpolation never reaches back that far.
          const cutoff = sample.at - 2000;
          while (r.samples.length > 2 && r.samples[0].at < cutoff) r.samples.shift();
          r.latest = sample;
        }
        break;
      }
      case 'shot': {
        if (msg.id !== this.id) {
          this._events.push({ type: 'shot', x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, sprite: msg.sprite, radius: msg.radius });
        }
        break;
      }
      case 'hit': {
        this._events.push({ type: 'hit', damage: msg.damage, from: msg.from });
        break;
      }
      case 'leave': {
        const r = this.remotes.get(msg.id);
        if (r) {
          this.remotes.delete(msg.id);
          this._events.push({ type: 'leave', display: msg.display || r.display });
        }
        break;
      }
      case 'host': {
        if (this.lobby) {
          this.lobby.host_id = msg.id;
          this.lobby.host = msg.display;
        }
        this._events.push({ type: 'host', display: msg.display });
        break;
      }
      case 'room_full': {
        this._shouldReconnect = false;
        this._events.push({ type: 'room_full' });
        break;
      }
      default:
        break;
    }
  }

  _addRemote(p) {
    let record = null;
    try {
      const ch = p.character;
      if (ch && ch.kind === 'custom' && ch.build) {
        record = buildCustomCharacterRecord(ch.build);
      } else if (ch && ch.kind === 'preset' && ch.id) {
        record = buildCharacterRecord(ch.id);
      }
    } catch {
      record = null;
    }
    const r = {
      id: p.id,
      display: p.display || p.username || 'SAINT',
      gangTag: p.gang_tag || null,
      record,
      samples: [],
      latest: null,
    };
    if (p.s) {
      r.latest = { at: performance.now(), ...p.s };
      r.samples.push(r.latest);
    }
    this.remotes.set(p.id, r);
  }

  // ── Outbound ───────────────────────────────────────────────────────
  _send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); } catch {}
    }
  }

  sendStateThrottled(player, nowMs) {
    if (!this.connected) return;
    if (nowMs - this._lastSent < SEND_INTERVAL) return;
    this._lastSent = nowMs;
    const wpn = player.weapons && player.weapons[player.weaponIdx || 0];
    this._send({
      type: 'state',
      s: {
        x: Math.round(player.x), y: Math.round(player.y), z: Math.round(player.z || 0),
        facing: player.facing || 1,
        hp: Math.round(player.hp), maxHp: player.maxHp,
        weaponId: wpn ? wpn.id : null,
        eating: !!player.eating,
        hiding: player.hideT != null,
        crouching: !!player.crouching,
        dead: !!player.dead,
        firing: !!(player.inputs && player.inputs.fire),
      },
    });
  }

  sendShot(b) {
    if (!this.connected) return;
    this._send({ type: 'shot', x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), sprite: b.sprite, radius: b.radius });
  }

  sendHit(targetId, damage) {
    if (!this.connected) return;
    this._send({ type: 'hit', target_id: targetId, damage: Math.round(damage) });
  }

  drainEvents() {
    if (!this._events.length) return [];
    const evs = this._events;
    this._events = [];
    return evs;
  }

  playerCount() {
    return this.remotes.size + 1;
  }

  // ── Remote interpolation ───────────────────────────────────────────
  // Renders each remote Saint RENDER_DELAY ms in the past, lerping
  // between buffered samples.  The deliberate delay + server jitter is
  // the "SR1 lag" the brief asked for.
  getRemotes(nowMs) {
    if (this._frameCache.t === nowMs) return this._frameCache.list;
    const list = [];
    for (const r of this.remotes.values()) {
      const s = this._interp(r, nowMs);
      if (!s) continue;
      list.push({
        id: r.id,
        display: r.display,
        record: r.record,
        x: s.x, y: s.y, z: s.z || 0,
        facing: s.facing || 1,
        hp: s.hp != null ? s.hp : 100,
        maxHp: s.maxHp || 100,
        weaponId: s.weaponId,
        eating: !!s.eating,
        hiding: !!s.hiding,
        crouching: !!s.crouching,
        dead: !!s.dead,
        firing: !!s.firing,
        sprite: spriteForRemote(r, s),
      });
    }
    this._frameCache = { t: nowMs, list };
    return list;
  }

  _interp(r, nowMs) {
    const ss = r.samples;
    if (!ss.length) return r.latest;
    const t = nowMs - RENDER_DELAY;
    if (t <= ss[0].at) return ss[0];
    for (let i = ss.length - 1; i >= 0; i--) {
      if (ss[i].at <= t) {
        const a = ss[i];
        const b = ss[i + 1];
        if (!b) return a;
        const f = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at));
        return {
          ...b,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * f,
        };
      }
    }
    return ss[0];
  }
}

// Resolve the sprite URL a remote Saint should render with, mirroring
// the local player's pose priority: hiding > eating > weapon hold/fire
// > base.
function spriteForRemote(r, s) {
  if (s.hiding) return '/streetfight/weapons/hide_trash.png';
  if (s.eating) return '/streetfight/weapons/eat_burger.png';
  const rec = r.record;
  if (rec && s.weaponId) {
    const arsenal = rec.startArsenal || [];
    const w = arsenal.find(wp => wp.id === s.weaponId);
    if (w) {
      if (s.firing && w.sprite_fire) return w.sprite_fire;
      if (w.sprite_hold) return w.sprite_hold;
    }
  }
  return (rec && rec.spriteBase) || '/pieces/3rd/pawn.png';
}
