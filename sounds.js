// streetfight/sounds.js — the game-facing SFX API.
//
// Every function here is a thin recipe on top of the brawl3d 3D audio
// engine (brawl3d/audio/audioEngine.js): sampled SR1 streams for
// gunfire / reloads, synthesized layers for foley, impacts, footsteps
// and body hits. The engine owns positioning (HRTF panner, category
// ranges), polyphony caps, re-trigger guards, distance culling and the
// Sound Manager overrides — so callers just say WHAT happened WHERE.

import * as AE from '../brawl3d/audio/audioEngine.js';
import { SOUND_DEFS, fireKey, reloadKey } from '../brawl3d/audio/soundRegistry.js';

export { STREAM_MAP } from './streamMap.js';

// ── plumbing ────────────────────────────────────────────────────────
export function resumeAudio() { AE.resume(); }
export function setMuted(m) { AE.setMuted(m); }
export function isMuted() { return AE.isMuted(); }
export function setListener(l) { AE.setListener(l); }
export function setOccluder(fn) { AE.setOccluder(fn); }
export function setReverb(preset) { AE.setReverb(preset); }
export function warmAudio() { AE.resume(); }
// Resolves once every sampled weapon/reload/foley buffer is decoded (the
// pre-match gate awaits it so the first trigger pull is never a fetch).
export function preloadAllWeaponSounds() {
  const jobs = [];
  for (const k of Object.keys(SOUND_DEFS)) if (SOUND_DEFS[k].url && SOUND_DEFS[k].cat !== 'announcer') jobs.push(AE.loadBuffer(AE.resolveUrl(k, SOUND_DEFS[k].url)));
  return Promise.all(jobs);
}

function _opts(key, pos, extra = {}) {
  const d = SOUND_DEFS[key] || {};
  return { url: d.url, pos, volume: d.volume ?? 1, bus: d.bus || 'sfx', range: AE.RANGES[d.range] || AE.RANGES.body, maxVoices: d.maxVoices || 4, guardMs: d.guardMs ?? 25, ...extra };
}
const _self = () => { const l = AE.listener(); return { x: l.x, y: l.y, z: l.z }; };

// ── sampled: weapons / reloads ──────────────────────────────────────
export function playWeapon(weaponId, delayMs = 0) {
  const key = fireKey(weaponId); if (!key) return null;
  return AE.play(key, _opts(key, null, { delayMs, guardMs: 12 }));          // own gun: no panner, always upfront
}
export function playWeaponAt(weaponId, x, y, z, delayMs = 0) {
  const key = fireKey(weaponId); if (!key) return null;
  return AE.play(key, _opts(key, { x, y, z }, { delayMs }));
}
export function playReload(weaponId) { const key = reloadKey(weaponId); return key ? AE.play(key, _opts(key, null, { guardMs: 80 })) : null; }
export function playReloadAt(weaponId, x, y, z) { const key = reloadKey(weaponId); return key ? AE.play(key, _opts(key, { x, y, z }, { guardMs: 80 })) : null; }
export function playEmpty() { return AE.play('weapon.empty', _opts('weapon.empty', null, { guardMs: 60 })); }

// ── synth helpers (scheduled into the voice's destination) ──────────
function _noise(c, dest, when, seconds, { type = 'bandpass', freq = 2000, freqEnd = null, Q = 1, gain = 0.5, attack = 0.004, decay = 0.08, at = 0 } = {}) {
  const t0 = when + at;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = Q;
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + seconds);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
  src.connect(f).connect(g).connect(dest);
  try { src.start(t0); src.stop(t0 + seconds + 0.02); } catch { /* ignore */ }
  return f;
}
function _tone(c, dest, when, freq, { freqEnd = null, type = 'sine', gain = 0.4, attack = 0.003, decay = 0.12, at = 0 } = {}) {
  const t0 = when + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + decay);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
  o.connect(g).connect(dest);
  try { o.start(t0); o.stop(t0 + attack + decay + 0.02); } catch { /* ignore */ }
}
// A sampled override (from the Sound Manager) replaces the synth recipe.
function _synthOrSample(key, pos, volume, seconds, build, extra = {}) {
  const o = AE.overrideFor(key);
  if (o && o.url) return AE.play(key, _opts(key, pos, { url: o.url, volume, ...extra }));
  return AE.playSynth(key, { ..._opts(key, pos, extra), volume, seconds }, build);
}

// ── pimp slap: crack + thud + short room tail ───────────────────────
export function playSlapAt(x, y, z, delayMs = 0) {
  return _synthOrSample('body.slap', { x, y, z }, 0.95, 0.4, (c, dest, when) => {
    const bp = _noise(c, dest, when, 0.09, { freq: 3200, Q: 1.1, gain: 1.0, attack: 0.003, decay: 0.067 });
    _tone(c, dest, when, 220, { freqEnd: 70, gain: 0.55, attack: 0.005, decay: 0.105 });
    const tap = c.createDelay(0.30); tap.delayTime.value = 0.055;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const tapGain = c.createGain(); tapGain.gain.setValueAtTime(0.35, when); tapGain.gain.exponentialRampToValueAtTime(0.001, when + 0.28);
    bp.connect(tap); tap.connect(fb); fb.connect(tap); tap.connect(tapGain).connect(dest);
  }, { delayMs });
}

// ── pipe-bomb toss whoosh ───────────────────────────────────────────
export function playThrowAt(x, y, z, delayMs = 0) {
  return _synthOrSample('body.throw', { x, y, z }, 0.55, 0.25, (c, dest, when) => {
    _noise(c, dest, when, 0.22, { freq: 520, freqEnd: 2200, Q: 1.5, gain: 0.8, attack: 0.01, decay: 0.19 });
  }, { delayMs });
}

// ── HUD hit marker (ui bus, never spatial) ──────────────────────────
export function playHitConfirmSfx() {
  return _synthOrSample('ui.hitconfirm', null, 0.55, 0.2, (c, dest, when) => {
    _tone(c, dest, when, 2600, { freqEnd: 2200, gain: 0.6, attack: 0.004, decay: 0.136 });
    _tone(c, dest, when, 3900, { freqEnd: 3400, gain: 0.28, attack: 0.003, decay: 0.087 });
    _noise(c, dest, when, 0.02, { freq: 4200, Q: 3.2, gain: 0.32, attack: 0.001, decay: 0.028 });
  });
}

// ── bullet impacts per surface ──────────────────────────────────────
export function playSurfaceHitAt(surface, x, y, z) {
  const key = SOUND_DEFS[`hit.${surface}`] ? `hit.${surface}` : 'hit.concrete';
  return _synthOrSample(key, { x, y, z }, 0.42, 0.3, (c, dest, when) => {
    switch (surface) {
      case 'metal':
        _tone(c, dest, when, 3100 + Math.random() * 500, { freqEnd: 2700, gain: 0.5, decay: 0.2 });
        _tone(c, dest, when, 4600 + Math.random() * 600, { freqEnd: 4100, gain: 0.22, decay: 0.11 });
        _noise(c, dest, when, 0.03, { freq: 5200, Q: 3, gain: 0.3, decay: 0.025 });
        break;
      case 'wood':
        _tone(c, dest, when, 380 + Math.random() * 80, { freqEnd: 190, gain: 0.55, decay: 0.07 });
        _noise(c, dest, when, 0.05, { freq: 900, Q: 1.2, gain: 0.35, decay: 0.045 });
        break;
      case 'glass':
        _tone(c, dest, when, 4100 + Math.random() * 400, { gain: 0.35, decay: 0.12 });
        _tone(c, dest, when, 6300 + Math.random() * 500, { gain: 0.2, decay: 0.09 });
        _noise(c, dest, when, 0.04, { type: 'highpass', freq: 3000, gain: 0.3, decay: 0.035 });
        break;
      case 'dirt':
        _noise(c, dest, when, 0.09, { freq: 520, freqEnd: 260, Q: 0.9, gain: 0.5, decay: 0.08 });
        _tone(c, dest, when, 150, { freqEnd: 70, gain: 0.35, decay: 0.07 });
        break;
      default:
        _noise(c, dest, when, 0.05, { freq: 1900, freqEnd: 900, Q: 1.1, gain: 0.55, decay: 0.045 });
        _tone(c, dest, when, 190, { freqEnd: 90, gain: 0.3, decay: 0.06 });
    }
  });
}

export function playGlassShatterAt(x, y, z, big = false) {
  return _synthOrSample('glass.shatter', { x, y, z }, big ? 0.75 : 0.6, 0.7, (c, dest, when) => {
    _noise(c, dest, when, 0.32, { type: 'highpass', freq: 2400, gain: 0.7, attack: 0.003, decay: 0.28 });
    _noise(c, dest, when, 0.12, { freq: 3200, Q: 1.5, gain: 0.5, decay: 0.1 });
    for (let i = 0; i < (big ? 9 : 6); i++) _tone(c, dest, when, 4500 + Math.random() * 4500, { gain: 0.16 + Math.random() * 0.1, decay: 0.06 + Math.random() * 0.08, at: 0.02 + Math.random() * 0.3 });
  });
}

export function playDebrisBreakAt(surface, x, y, z) {
  const key = SOUND_DEFS[`debris.${surface}`] ? `debris.${surface}` : 'debris.concrete';
  return _synthOrSample(key, { x, y, z }, 0.55, 0.45, (c, dest, when) => {
    switch (surface) {
      case 'metal':
        _tone(c, dest, when, 1800, { freqEnd: 900, gain: 0.5, decay: 0.3 });
        _noise(c, dest, when, 0.12, { freq: 2600, Q: 1.2, gain: 0.5, decay: 0.1 });
        break;
      case 'wood':
        _noise(c, dest, when, 0.16, { freq: 1100, freqEnd: 500, Q: 1.0, gain: 0.6, decay: 0.14 });
        _tone(c, dest, when, 320, { freqEnd: 140, gain: 0.5, decay: 0.09 });
        _tone(c, dest, when, 260, { freqEnd: 120, gain: 0.35, decay: 0.08, at: 0.07 });
        break;
      default:
        _noise(c, dest, when, 0.3, { type: 'lowpass', freq: 900, freqEnd: 300, gain: 0.7, decay: 0.26 });
        _tone(c, dest, when, 120, { freqEnd: 55, gain: 0.4, decay: 0.12 });
    }
  });
}

// ── casings ─────────────────────────────────────────────────────────
export function playShellClatterAt(x, y, z, strength = 1, kind = 'brass') {
  const key = kind === 'hull' ? 'foley.hull' : 'foley.casing';
  const vol = 0.16 + 0.2 * Math.max(0, Math.min(1, strength));
  return _synthOrSample(key, { x, y, z }, vol, 0.15, (c, dest, when) => {
    if (kind === 'hull') {
      _tone(c, dest, when, 900 + Math.random() * 300, { freqEnd: 600, gain: 0.5, decay: 0.05 });
      _noise(c, dest, when, 0.03, { freq: 1800, Q: 1.5, gain: 0.35, decay: 0.025 });
    } else {
      const f = 5200 + Math.random() * 2600;
      _tone(c, dest, when, f, { gain: 0.45, decay: 0.05 + Math.random() * 0.05 });
      _tone(c, dest, when, f * 1.47, { gain: 0.25, decay: 0.04 + Math.random() * 0.04 });
      _noise(c, dest, when, 0.02, { type: 'highpass', freq: 4000, gain: 0.25, decay: 0.015 });
    }
  });
}

// ── incoming fire ───────────────────────────────────────────────────
export function playBulletWhizAt(x, y, z, closeness = 0.5) {
  return _synthOrSample('bullet.whiz', { x, y, z }, 0.35 + 0.4 * closeness, 0.2, (c, dest, when) => {
    _noise(c, dest, when, 0.015, { type: 'highpass', freq: 3500, gain: 0.8, attack: 0.001, decay: 0.012 });
    _noise(c, dest, when, 0.16, { freq: 2600, freqEnd: 700, Q: 2.5, gain: 0.55, attack: 0.005, decay: 0.14 });
  });
}
export function playHitTakenSfx(dmg = 10, headshot = false) {
  return _synthOrSample('body.hurt', null, 0.5 + Math.min(0.4, dmg / 80), 0.3, (c, dest, when) => {
    _noise(c, dest, when, 0.08, { type: 'lowpass', freq: 900, freqEnd: 300, gain: 0.8, attack: 0.002, decay: 0.07 });
    _tone(c, dest, when, 110, { freqEnd: 55, gain: 0.55, decay: 0.12 });
    if (headshot) _tone(c, dest, when, 2400, { freqEnd: 1800, gain: 0.25, decay: 0.25 });
  });
}

// ── footsteps ───────────────────────────────────────────────────────
export function playFootstepAt(x, y, z, { surface = 'concrete', sprint = false, self = false } = {}) {
  const surf = surface === 'grass' ? 'dirt' : surface;
  const key = SOUND_DEFS[`step.${surf}`] ? `step.${surf}` : 'step.concrete';
  const vol = (self ? 0.16 : 0.42) * (sprint ? 1.35 : 1);
  const pos = self ? null : { x, y, z };
  return _synthOrSample(key, pos, vol, 0.15, (c, dest, when) => {
    const p = 0.92 + Math.random() * 0.16;
    switch (surf) {
      case 'metal':
        _tone(c, dest, when, 1900 * p, { freqEnd: 1500 * p, gain: 0.35, decay: 0.09 });
        _noise(c, dest, when, 0.04, { freq: 3200, Q: 2, gain: 0.3, decay: 0.03 });
        break;
      case 'wood':
        _tone(c, dest, when, 260 * p, { freqEnd: 140, gain: 0.5, decay: 0.07 });
        _noise(c, dest, when, 0.05, { freq: 800, Q: 1, gain: 0.3, decay: 0.04 });
        break;
      case 'dirt':
        _noise(c, dest, when, 0.09, { type: 'lowpass', freq: 700 * p, freqEnd: 250, gain: 0.55, attack: 0.004, decay: 0.08 });
        break;
      default:
        _tone(c, dest, when, 150 * p, { freqEnd: 70, gain: 0.35, decay: 0.05 });
        _noise(c, dest, when, 0.06, { freq: 1400 * p, freqEnd: 600, Q: 1.2, gain: 0.5, attack: 0.003, decay: 0.05 });
    }
  }, { guardMs: self ? 60 : 28 });
}

// ── burger chomp (healing) ──────────────────────────────────────────
export function playEatAt(x, y, z, self = false) {
  return _synthOrSample('foley.burger', self ? null : { x, y, z }, self ? 0.35 : 0.5, 0.3, (c, dest, when) => {
    for (let i = 0; i < 2; i++) {
      _noise(c, dest, when, 0.07, { type: 'lowpass', freq: 1100, freqEnd: 400, gain: 0.6, attack: 0.006, decay: 0.06, at: i * 0.11 });
      _tone(c, dest, when, 180, { freqEnd: 90, gain: 0.25, decay: 0.06, at: i * 0.11 });
    }
  });
}

// ── explosions: synth sub-boom + debris rumble under the RPG sample ─
export function playExplosionAt(x, y, z, scale = 1) {
  return _synthOrSample('explosion.blast', { x, y, z }, Math.min(1.4, 0.9 * scale), 1.6, (c, dest, when) => {
    _noise(c, dest, when, 0.5, { type: 'lowpass', freq: 400, freqEnd: 120, gain: 1.0, attack: 0.004, decay: 0.42 });
    _noise(c, dest, when, 1.4, { type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.45, attack: 0.03, decay: 1.2 });
    _tone(c, dest, when, 70, { freqEnd: 28, gain: 0.9, attack: 0.004, decay: 0.55 });
    _noise(c, dest, when, 0.06, { type: 'highpass', freq: 2500, gain: 0.6, attack: 0.001, decay: 0.05 });
  });
}

// ── Sound Manager preview: audition any key 2 m in front of the listener ─
export function previewSound(key) {
  const l = AE.listener();
  const x = l.x + l.fx * 2.5, y = l.y, z = l.z + l.fz * 2.5;
  const [cat, id] = key.split('.');
  switch (cat) {
    case 'weapon': return id === 'empty' ? playEmpty() : playWeaponAt(id, x, y, z);
    case 'reload': return playReloadAt(id, x, y, z);
    case 'explosion': return playExplosionAt(x, y, z, 1);
    case 'step': return playFootstepAt(x, y, z, { surface: id });
    case 'hit': return playSurfaceHitAt(id, x, y, z);
    case 'glass': return playGlassShatterAt(x, y, z, true);
    case 'debris': return playDebrisBreakAt(id, x, y, z);
    case 'bullet': return playBulletWhizAt(x, y, z, 0.8);
    case 'body': return id === 'hurt' ? playHitTakenSfx(20, false) : id === 'slap' ? playSlapAt(x, y, z) : playThrowAt(x, y, z);
    case 'foley': return id === 'burger' ? playEatAt(x, y, z, false) : playShellClatterAt(x, y, z, 1, id === 'hull' ? 'hull' : 'brass');
    case 'ui': return playHitConfirmSfx();
    default: {
      const d = SOUND_DEFS[key];
      return d ? AE.play(key, _opts(key, null, { guardMs: 0 })) : null;
    }
  }
}

// Test hook
export const _engine = AE;
