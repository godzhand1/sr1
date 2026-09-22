// Team Gangsta Brawl — announcer voice.
//
// Deep-voiced "Halo-style" callouts for multi-kills, killing sprees,
// and rampages. Uses the browser's SpeechSynthesis API so no assets
// need to be downloaded and every player hears the same tier the
// engine computed. Voice picking prefers a deep male voice; falls
// back gracefully if the browser's list is empty or the API is off.
//
// The engine emits `evt.k='ann'` with a `tier` key when a milestone
// is hit; every client's coop handler calls `speakAnnouncement(tier)`
// so the voice line plays on every screen in the room.
import * as AE from './audio/audioEngine.js';
import { SOUND_DEFS } from './audio/soundRegistry.js';

const MULTI_KILL_WINDOW = 4.0;             // seconds between kills for multi-kill chain

// User spec: every multi-kill tier says the same "1-8-7 baby!" call.
// Kept as an object keyed by tier so the caller code stays identical
// (looks like a table lookup); every entry just points at the same
// audio file / TTS phrase. Also carries a `key` used for MP3 lookup
// under /audio/announcer/{key}.mp3 so you can drop replacement audio
// in without touching the code.
const MULTI_KILL_LINE = { key: '187', text: '1-8-7 baby!' };
const MULTI_KILL_TIERS = {
  2: MULTI_KILL_LINE,
  3: MULTI_KILL_LINE,
  4: MULTI_KILL_LINE,
  5: MULTI_KILL_LINE,
  6: MULTI_KILL_LINE,
  7: MULTI_KILL_LINE,
};

// Killing spree tier → announcer text. User spec: 5 = "Unstoppable!",
// 10 = "Serial Killer". Kept 15 and 20 as Running Riot / RAMPAGE
// (rampage resets the spree to 0 per prior spec).
const SPREE_TIERS = {
  5:  { key: 'unstoppable',   text: 'Unstoppable!' },
  10: { key: 'serial_killer', text: 'Serial Killer' },
  15: { key: 'running_riot',  text: 'Running Riot' },
  20: { key: 'rampage',       text: 'RAMPAGE!' },
};

// Match-start countdown lines. Each is an audio-file key + spoken
// fallback so the announcer says "3, 2, 1, Go" before the timer
// starts.
export const COUNTDOWN_LINES = {
  3:   { key: 'count_3',  text: 'Three' },
  2:   { key: 'count_2',  text: 'Two' },
  1:   { key: 'count_1',  text: 'One' },
  0:   { key: 'count_go', text: 'Go!' },
};

const SPREE_RESET_TIER = 20;

// ── Voice selection ─────────────────────────────────────────────────
// Pick a deep male voice if one is available. Speech APIs load voice
// lists asynchronously on Chrome — we listen for the voiceschanged
// event to re-pick if our first attempt found nothing.
let _voice = null;
let _voiceReady = false;
function _pickVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const all = window.speechSynthesis.getVoices() || [];
  if (!all.length) return null;
  // Local (on-device) voices first: Chrome's "Google …" voices are streamed
  // from the network and start 300–800 ms late — useless for a 3-2-1.
  const local = all.filter((v) => v.localService);
  const list = local.length ? local : all;
  // Preference order — deeper timbres first, English fallback last.
  const preferences = [
    (v) => /Daniel/i.test(v.name),
    (v) => /Alex/i.test(v.name),
    (v) => /Microsoft David/i.test(v.name),
    (v) => /Microsoft Mark/i.test(v.name),
    (v) => /Microsoft Guy/i.test(v.name),
    (v) => /Google UK English Male/i.test(v.name),
    (v) => /male/i.test(v.name),
    (v) => v.lang && v.lang.startsWith('en'),
    () => true,
  ];
  for (const pred of preferences) {
    const hit = list.find(pred);
    if (hit) return hit;
  }
  return list[0] || null;
}

function _ensureVoice() {
  if (_voiceReady) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) { _voiceReady = true; return; }
  _voice = _pickVoice();
  if (!_voice) {
    // Voice list not populated yet — try again when it lands.
    window.speechSynthesis.onvoiceschanged = () => {
      _voice = _pickVoice();
      _voiceReady = true;
    };
    return;
  }
  _voiceReady = true;
}
// Warm the speech engine (voice list + first utterance latency) — call once
// behind the loading screen so the "3" isn't the first thing it ever says.
export function warmAnnouncerTTS() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  _ensureVoice();
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; if (_voice) u.voice = _voice; window.speechSynthesis.speak(u); } catch { /* ignore */ }
}

// Play an announcer line. `entry` is `{key, text}` or a plain string
// (legacy). Announcer clips are instantiated through the 3D audio
// engine on the VOICE bus (Sound Manager overrides win, defaults at
// /audio/announcer/{key}.mp3). One line speaks at a time; the rest queue
// by priority. COUNTDOWN lines (3-2-1-GO) never wait: they cut whatever is
// speaking and play the instant the HUD number changes, so voice and
// timer stay locked. Music ducks while a line plays; if no clip exists
// the line falls back to browser TTS (local voice, `onend`-driven).
const _missingKeys = new Set();
const _queue = [];
let _current = null;          // { voice?, utt?, timer }
const PRIORITY = { count_3: 9, count_2: 9, count_1: 9, count_go: 10, rampage: 6, running_riot: 5, serial_killer: 4, unstoppable: 3, 187: 2 };
const INTERRUPT_PRIORITY = 9;

function _annKey(key) { return `announcer.${key}`; }
function _clipUrl(key) { const d = SOUND_DEFS[_annKey(key)]; return AE.resolveUrl(_annKey(key), d ? d.url : `/audio/announcer/${key}.mp3`); }

// Warm the countdown + spree lines so the first "THREE" isn't a fetch.
export function preloadAnnouncer() {
  warmAnnouncerTTS();
  return Promise.all(Object.keys(PRIORITY).filter((k) => !_missingKeys.has(k)).map((k) => AE.loadBuffer(_clipUrl(k)).then((b) => { if (!b) _missingKeys.add(k); })));
}

function _stopCurrent() {
  const cur = _current; _current = null;
  if (!cur) return;
  clearTimeout(cur.timer);
  if (cur.voice) cur.voice.stop(0.03);
  if (cur.utt) { cur.utt.onend = null; try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
}
function _onLineEnd(cur) {
  if (_current !== cur) return;          // superseded by an interrupt
  clearTimeout(cur.timer); _current = null;
  _pump();
}
function _startLine({ key, text }) {
  _stopCurrent();
  const url = key ? _clipUrl(key) : null;
  const buf = url ? AE.bufferFor(url) : null;
  if (buf) {
    AE.duckMusic(0.3, buf.duration + 0.4);
    const v = AE.play(_annKey(key), { url, volume: SOUND_DEFS[_annKey(key)]?.volume ?? 1, bus: 'voice', range: AE.RANGES.voice, maxVoices: 1, guardMs: 0 });
    if (v) { const cur = { voice: v }; cur.timer = setTimeout(() => _onLineEnd(cur), buf.duration * 1000 + 80); _current = cur; return; }
  } else if (key && url && !_missingKeys.has(key) && !AE.hasBuffer(url)) {
    AE.loadBuffer(url).then((b) => { if (!b) _missingKeys.add(key); });
  }
  const utt = _speakTTS(text);
  const cur = { utt };
  const est = 500 + (text ? text.length * 55 : 0);
  cur.timer = setTimeout(() => _onLineEnd(cur), utt ? est + 600 : est);    // safety net if onend never fires
  if (utt) utt.onend = () => _onLineEnd(cur);
  _current = cur;
}
function _pump() {
  if (_current) return;
  const next = _queue.shift();
  if (next) _startLine(next);
}

export function speakAnnouncement(entry) {
  if (!entry) return;
  const isObj = typeof entry === 'object';
  const key = isObj ? entry.key : null;
  const text = isObj ? entry.text : String(entry);
  const pr = PRIORITY[key] || 1;
  if (pr >= INTERRUPT_PRIORITY) { _queue.length = 0; _startLine({ key, text }); return; }   // countdown: right now
  if (_queue.some((q) => q.key === key)) return;                                             // same-tier spam collapses
  _queue.push({ key, text, pr });
  _queue.sort((a, b) => b.pr - a.pr);
  if (_queue.length > 3) _queue.length = 3;
  _pump();
}

function _speakTTS(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  if (!text) return null;
  _ensureVoice();
  const utt = new SpeechSynthesisUtterance(text);
  if (_voice) utt.voice = _voice;
  utt.rate = 0.92;
  utt.pitch = 0.6;
  utt.volume = 1.0;
  try { window.speechSynthesis.speak(utt); } catch { return null; }
  return utt;
}

// Test hooks
export function _resetAnnouncerForTests() { _stopCurrent(); _queue.length = 0; _missingKeys.clear(); }
export function _announcerQueue() { return _queue.map((q) => q.key); }
export function _announcerSpeaking() { return !!_current; }

// ── Kill-tracker: per-killer running state ──────────────────────────
// Kept as a Map keyed by killer id so multiple simultaneous sprees
// (across different players) don't interfere with each other. The
// engine calls `trackKill(killerId, killT)` on every kill and gets
// back { announcements: [{key,text}, ...] } — whatever tier lines to
// play right now.
export class KillTracker {
  constructor() {
    this.state = new Map();                // killerId → { spree, multi, lastKillT }
  }

  _get(id) {
    let s = this.state.get(id);
    if (!s) { s = { spree: 0, multi: 0, lastKillT: -Infinity, cur: 0, best: 0 }; this.state.set(id, s); }
    return s;
  }

  // Scoreboard read: current kills-since-death streak + best of the match.
  stats(id) {
    const s = this.state.get(id);
    return s ? { cur: s.cur, best: s.best } : { cur: 0, best: 0 };
  }

  // Call on every confirmed kill. Returns a list of announcement
  // objects the caller should broadcast (empty most of the time).
  onKill(killerId, killT) {
    const s = this._get(killerId);
    // Multi-kill chain: kills within MULTI_KILL_WINDOW seconds compound
    // into "Double Kill / Triple Kill / …". Any kill after the window
    // resets the chain to a single kill.
    if (killT - s.lastKillT <= MULTI_KILL_WINDOW) {
      s.multi += 1;
    } else {
      s.multi = 1;
    }
    s.spree += 1;
    s.cur += 1;
    if (s.cur > s.best) s.best = s.cur;
    s.lastKillT = killT;
    const out = [];
    const mk = MULTI_KILL_TIERS[s.multi];
    if (mk) out.push(mk);
    const sp = SPREE_TIERS[s.spree];
    if (sp) {
      out.push(sp);
      if (s.spree >= SPREE_RESET_TIER) {
        // Rampage — reset spree so the next 5 kills earn another
        // Killing Spree line. Multi is left alone; it's time-decay
        // driven anyway.
        s.spree = 0;
      }
    }
    return out;
  }

  // Kill the streak — call on the actor's death. Multi chain remains
  // (multi is naturally time-limited) but the spree tier count zeroes
  // so the next kill after respawn earns a fresh Killing Spree at 5.
  onDeath(killerId) {
    const s = this._get(killerId);
    s.spree = 0;
    s.cur = 0;
  }

  reset() { this.state.clear(); }
}
