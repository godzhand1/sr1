// Team Gangsta Brawl — peer-to-peer voice chat over the lobby WS.
//
// Custom WebRTC implementation: each client opens an RTCPeerConnection
// to every other client in the same lobby. The existing /api/streetfight/
// ws connection (`Coop3D`) is used as the signaling channel for the
// SDP offer/answer/ICE handshake (new msg types: `voice_offer`,
// `voice_answer`, `voice_ice`).
//
// Audio routing rules (the engine drives these via `setVoiceContext`):
//   • Lobby/warehouse → everyone hears everyone (unless per-user muted)
//   • Brawl, alive    → hear ONLY same-team teammates
//   • Brawl, dead     → hear ONLY other dead players (any team)
//   • Brawl, ended    → hear everyone (until back in lobby)
//
// Audio rendering uses one <audio> element per remote peer with
// `audio.muted` flipped by the rules each frame. No mixing required.

export class VoiceChat {
  constructor() {
    this.peers = new Map();        // userId → { pc, audioEl, stream, muted, team, alive }
    this._localStream = null;
    this._enabled = false;
    this._mySend = null;            // (msg) => void  — sends through WS
    this._myUserId = null;
    // Manual mutes — per-user, settings menu controlled.
    this._userMutes = new Set();
    // Voice context — phase: 'lobby' | 'brawl' | 'ended'
    this._ctx = { phase: 'lobby', myTeam: null, myAlive: true };
    // STUN servers — free public ones from Google.
    this._iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }

  async enable({ send, myUserId }) {
    if (this._enabled) return true;
    this._mySend = send;
    this._myUserId = myUserId;
    try {
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this._enabled = true;
      return true;
    } catch (err) {
      console.warn('[voice] getUserMedia failed — mic disabled:', err);
      this._enabled = false;
      return false;
    }
  }

  disable() {
    if (!this._enabled) return;
    for (const peer of this.peers.values()) {
      try { peer.pc.close(); } catch { /* */ }
      try { peer.audioEl.remove(); } catch { /* */ }
    }
    this.peers.clear();
    if (this._localStream) {
      this._localStream.getTracks().forEach(t => t.stop());
      this._localStream = null;
    }
    this._enabled = false;
  }

  isEnabled() { return this._enabled; }

  // Called by the engine each frame with the current voice context.
  // Updates the muted flag on each peer's <audio>.
  setVoiceContext({ phase, myTeam, myAlive }) {
    this._ctx.phase = phase || 'lobby';
    this._ctx.myTeam = myTeam || null;
    this._ctx.myAlive = !!myAlive;
    this._applyMutes();
  }

  setPeerInfo(userId, { team, alive }) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    if (team !== undefined) peer.team = team;
    if (alive !== undefined) peer.alive = !!alive;
    this._applyMutes();
  }

  toggleUserMute(userId) {
    if (this._userMutes.has(userId)) this._userMutes.delete(userId);
    else this._userMutes.add(userId);
    this._applyMutes();
  }
  isUserMuted(userId) { return this._userMutes.has(userId); }

  setLocalMicMute(muted) {
    if (!this._localStream) return;
    this._localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }
  getLocalMicMute() {
    if (!this._localStream) return false;
    const t = this._localStream.getAudioTracks()[0];
    return t ? !t.enabled : false;
  }

  // Compute whether the local player should HEAR a given peer right now.
  _shouldHear(peer) {
    if (this._userMutes.has(peer.userId)) return false;
    const ctx = this._ctx;
    if (ctx.phase === 'lobby' || ctx.phase === 'ended') return true;
    // Brawl phase
    if (!ctx.myAlive) {
      // Dead players hear only other dead players (any team).
      return !peer.alive;
    }
    // Alive — only same-team.
    return peer.team && ctx.myTeam && peer.team === ctx.myTeam;
  }

  _applyMutes() {
    for (const peer of this.peers.values()) {
      const hear = this._shouldHear(peer);
      try { peer.audioEl.muted = !hear; } catch { /* */ }
    }
  }

  // ── Signaling entry points (called by Coop3D when WS messages arrive)
  async onPeerJoin(userId, { team, alive } = {}) {
    if (!this._enabled || userId === this._myUserId) return;
    if (this.peers.has(userId)) return;
    // The peer with the LOWER userId initiates the offer to avoid both
    // sides creating duplicate offers.
    const initiator = String(this._myUserId) < String(userId);
    const peer = this._createPeer(userId, { team, alive });
    if (initiator) {
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        this._mySend({ type: 'voice_offer', target_id: userId, sdp: offer });
      } catch (err) {
        console.warn('[voice] offer failed for', userId, err);
      }
    }
  }

  onPeerLeave(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* */ }
    try { peer.audioEl.remove(); } catch { /* */ }
    this.peers.delete(userId);
  }

  async onSignal(msg) {
    if (!this._enabled) return;
    const from = msg.from_id;
    if (!from || from === this._myUserId) return;
    let peer = this.peers.get(from);
    if (!peer) peer = this._createPeer(from, {});
    try {
      if (msg.type === 'voice_offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        this._mySend({ type: 'voice_answer', target_id: from, sdp: ans });
      } else if (msg.type === 'voice_answer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      } else if (msg.type === 'voice_ice') {
        if (msg.candidate) {
          try { await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch { /* */ }
        }
      }
    } catch (err) {
      console.warn('[voice] signal handling failed:', err);
    }
  }

  _createPeer(userId, { team, alive }) {
    const pc = new RTCPeerConnection(this._iceConfig);
    if (this._localStream) {
      this._localStream.getTracks().forEach(t => pc.addTrack(t, this._localStream));
    }
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.dataset.voicePeer = String(userId);
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    pc.ontrack = (ev) => {
      audioEl.srcObject = ev.streams[0];
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && this._mySend) {
        this._mySend({ type: 'voice_ice', target_id: userId, candidate: ev.candidate });
      }
    };
    const peer = { userId, pc, audioEl, team: team || null, alive: alive !== false, muted: false };
    this.peers.set(userId, peer);
    this._applyMutes();
    return peer;
  }

  // Public roster info for the in-game pause menu.
  rosterSnapshot() {
    return Array.from(this.peers.values()).map(p => ({
      userId: p.userId,
      team: p.team,
      alive: p.alive,
      muted: this._userMutes.has(p.userId),
    }));
  }
}
