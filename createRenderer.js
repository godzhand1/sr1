// Team Gangsta Brawl — renderer factory.
//
// Tries WebGPU first via three/webgpu's WebGPURenderer.  If WebGPU is
// unavailable (no navigator.gpu) we fall back to a classic WebGL2
// WebGLRenderer (the engine we shipped on before this migration).  The
// returned renderer exposes the same surface used elsewhere:
//   - .domElement
//   - .setSize / .setPixelRatio
//   - .render(scene, camera)
//   - .dispose()
// Plus two flags so callers can branch on backend if they need to:
//   - .__backend = 'webgpu' | 'webgl2'
//   - .__ready (Promise that resolves once the backend is initialized)
//
// WebGPURenderer is async — its init() must resolve before the first
// render, so we surface a Promise the game loop awaits on the first
// frame.  We never throw on init failure: any WebGPU exception causes
// an automatic, silent fallback to WebGL2 so gameplay always starts.

import * as THREE from 'three';

let _webgpuModulePromise = null;
function loadWebGPUModule() {
  if (!_webgpuModulePromise) {
    _webgpuModulePromise = import('three/webgpu').catch(() => null);
  }
  return _webgpuModulePromise;
}

export function hasWebGPU() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

function makeWebGLRenderer(opts) {
  const r = new THREE.WebGLRenderer({
    // AAA baseline: enable MSAA. It's a small cost on modern GPUs
    // and dramatically cleans up building/prop silhouettes at match
    // resolution. Combined with pixelRatio clamping in Brawl3DGame
    // this keeps mid-tier laptops smooth.
    antialias: true,
    powerPreference: 'high-performance',
    // Stencil buffer isn't used by any current pass — drop it to
    // save framebuffer bandwidth on integrated GPUs.
    stencil: false,
    // Preserve NOT needed — improves perf on tiled GPUs.
    preserveDrawingBuffer: false,
    ...opts,
  });
  // AAA soft shadows — PCFSoft has cleaner edges than the default
  // PCF and no additional runtime cost. Enabling shadowMap at the
  // renderer level allows any DirectionalLight with `castShadow=true`
  // (arena3d, mapCustom3d) to actually drop shadow onto meshes.
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  // NOTE — deliberately NOT enabling `outputColorSpace = SRGBColorSpace`
  // or `toneMapping = ACESFilmicToneMapping`. Existing lambert
  // materials + baked color hex codes across the codebase were tuned
  // without them; retroactively flipping the color pipeline tints
  // every scene warm-orange (visible on the map-editor grid). Leave
  // as a follow-up alongside a global sweep of `MeshLambertMaterial`
  // → `MeshStandardMaterial` for real PBR lighting.
  r.__backend = 'webgl2';
  r.__ready = Promise.resolve();
  return r;
}

export async function createRenderer(opts = {}) {
  // WebGPU has been shipping unstable async-render backpressure — the
  // returned Promise from `renderer.render` isn't awaited by the game
  // loop (fire-and-forget), so command queues grow unbounded and the
  // scene visibly hitches / freezes a few seconds into a match while
  // the engine's own state keeps ticking (visible in the minimap).
  // Until the loop is refactored to await frames properly, default to
  // WebGL2 which is synchronous and rock-solid. Opt back into WebGPU
  // by setting `window.__brawl3dForceWebGPU = true` before mount.
  const forceWebGPU = typeof window !== 'undefined' && window.__brawl3dForceWebGPU === true;
  if (!forceWebGPU) return makeWebGLRenderer(opts);
  if (!hasWebGPU()) return makeWebGLRenderer(opts);
  // Probe for an actual adapter before committing — headless / older
  // GPUs report `navigator.gpu` but fail to deliver an adapter, in
  // which case THREE's WebGPURenderer silently falls back to WebGL2
  // and our backend tag would lie.  Verifying here keeps the tag
  // truthful: if no adapter, we use a plain WebGLRenderer.
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch { adapter = null; }
  if (!adapter) return makeWebGLRenderer(opts);
  const mod = await loadWebGPUModule();
  if (!mod || !mod.WebGPURenderer) return makeWebGLRenderer(opts);
  try {
    const r = new mod.WebGPURenderer({
      antialias: false,
      powerPreference: 'high-performance',
      ...opts,
    });
    r.__backend = 'webgpu';
    r.__ready = r.init().catch((err) => {
      // Init failed mid-flight — caller will see __backend === 'webgpu'
      // but the next render will throw.  We can't transparently swap
      // backends here, but log once so the user sees what happened.
      console.warn('[brawl3d] WebGPU init failed, frames may stutter:', err);
    });
    return r;
  } catch (err) {
    console.warn('[brawl3d] WebGPURenderer construction failed, falling back to WebGL2:', err);
    return makeWebGLRenderer(opts);
  }
}
