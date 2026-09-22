// loadGate.js — "is EVERYTHING resident?" for the pre-match screen.
//
// Every GLTFLoader / TextureLoader / FileLoader in the game goes through
// THREE.DefaultLoadingManager, so its item counters are the ground truth
// for GLBs, PEG/PBR textures, weapon models and character rigs. Loads
// that don't touch a THREE loader (fetch → build, async texture status
// polls, the sky IBL bake) are registered as explicit promises.
// The gate is "done" only when the manager has nothing in flight, every
// tracked promise settled, AND the loaders have been quiet for a beat
// (async chains start their next load a tick after the previous one).
import * as THREE from 'three';

const QUIET_MS = 700;
const MAX_WAIT_MS = 90000;

export function createLoadGate({ onChange } = {}) {
  const mgr = THREE.DefaultLoadingManager;
  let loaded = 0, total = 0, base = 0, baseSet = false;
  let lastActivity = performance.now();
  let lastUrl = '';
  let promTotal = 0, promDone = 0;
  let disposed = false;
  let startedAt = performance.now();

  const emit = () => { if (!disposed) onChange?.(gate.snapshot()); };
  const prev = { onStart: mgr.onStart, onProgress: mgr.onProgress, onLoad: mgr.onLoad, onError: mgr.onError };
  const seen = (url, l, t) => {
    if (!baseSet) { base = Math.max(0, (l | 0)); baseSet = true; }
    loaded = l | 0; total = t | 0; lastActivity = performance.now();
    if (url) lastUrl = String(url).split('?')[0].split('/').pop();
    emit();
  };
  mgr.onStart = (url, l, t) => { seen(url, l, t); prev.onStart?.(url, l, t); };
  mgr.onProgress = (url, l, t) => { seen(url, l, t); prev.onProgress?.(url, l, t); };
  mgr.onLoad = () => { loaded = total; lastActivity = performance.now(); emit(); prev.onLoad?.(); };
  mgr.onError = (url) => { lastActivity = performance.now(); emit(); prev.onError?.(url); };

  const gate = {
    // Register an async step the manager can't see (fetch, bake, status poll).
    track(label, p) {
      promTotal++;
      lastActivity = performance.now();
      Promise.resolve(typeof p === 'function' ? p() : p)
        .catch((err) => { if (typeof console !== 'undefined') console.warn(`[loadGate] ${label} failed`, err); })
        .then(() => { promDone++; lastActivity = performance.now(); emit(); });
      emit();
      return gate;
    },
    snapshot() {
      const items = Math.max(0, total - base), itemsDone = Math.max(0, Math.min(items, loaded - base));
      const denom = items + promTotal;
      const done = itemsDone + promDone;
      const inflight = (loaded < total) || (promDone < promTotal);
      const quietFor = performance.now() - lastActivity;
      const elapsed = performance.now() - startedAt;
      // Safety valve: a stalled stream (slow CDN, huge SR chunk, a loader
      // that never reports) must not strand the player on the pre-match
      // screen forever — after MAX_WAIT_MS we let them in and the rest
      // pops in during play.
      const timedOut = elapsed > MAX_WAIT_MS && quietFor >= QUIET_MS;
      const ready = (!inflight && quietFor >= QUIET_MS && elapsed > QUIET_MS) || timedOut;
      return {
        progress: denom > 0 ? Math.min(1, done / denom) : (ready ? 1 : 0),
        done, total: denom, inflight, ready, lastUrl, timedOut,
        elapsed,
      };
    },
    dispose() {
      disposed = true;
      mgr.onStart = prev.onStart; mgr.onProgress = prev.onProgress; mgr.onLoad = prev.onLoad; mgr.onError = prev.onError;
    },
  };
  return gate;
}
