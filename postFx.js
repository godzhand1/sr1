// Team Gangsta Brawl — Post-processing composer.
//
// Xbox 360-era AAA look: ACES filmic tone-mapping, contrast/saturation
// colour grade, UnrealBloom for neon highlights, SSAO for corner
// darkening. Composer is fed by the existing WebGLRenderer target.
//
// Everything here degrades gracefully: if a pass fails to build we
// fall back to the raw render — the game NEVER loses its picture just
// because a shader compile hiccups.
//
// Usage:
//   const fx = createPostFX({ renderer, scene, camera, w, h });
//   // in render loop, replace `renderer.render(scene, camera)` with:
//   fx.render(scene, camera, dt);
//   // on resize:
//   fx.setSize(w, h);
//   // dispose:
//   fx.dispose();

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ── Color-grade shader (contrast + saturation + slight warm lift) ─
// Cheap replacement for a proper LUT — one texture-read, three
// arithmetic ops per pixel. Matches the "Saints Row-style teal-
// shadow / warm-highlight" grade AAA titles ship with.
const ColorGradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    contrast:    { value: 1.08 },
    saturation:  { value: 1.15 },
    warmTint:    { value: new THREE.Vector3(1.04, 1.0, 0.93) },
    vignette:    { value: 0.25 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform vec3  warmTint;
    uniform float vignette;
    varying vec2  vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Contrast around 0.5 grey.
      c = (c - 0.5) * contrast + 0.5;
      // Saturation via luma pivot.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // Warm/cool tint per channel.
      c *= warmTint;
      // Vignette (radial darkening from centre).
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * vignette * 4.0;
      c *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createPostFX({ renderer, scene, camera, w, h, mode = 'quality' }) {
  // Set tone-mapping on the base renderer — ACES filmic is the
  // gold-standard for a "cinematic" look; we clamp exposure so night
  // scenes don't get grey-washed.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Exposure = scene base (set by the physical sky / map) × user bias
  // (Video Settings slider, 1.85 == neutral for legacy reasons).
  let exposureBase = 0.7, exposureBias = 1;
  let bloom = null;
  const applyExposure = () => {
    renderer.toneMappingExposure = exposureBase * exposureBias;
    // Bloom runs on the HDR buffer *before* exposure — scale its threshold
    // so only genuinely over-exposed pixels (≥1.5 display-linear: sun glow,
    // muzzle flash, neon) bloom, not the whole daylight sky.
    if (bloom) bloom.threshold = 1.5 / Math.max(0.01, exposureBase * exposureBias);
  };
  applyExposure();

  let composer = null;
  let ssao = null;
  let grade = null;
  let fallback = false;

  try {
    composer = new EffectComposer(renderer);
    composer.setSize(w, h);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // SSAO — corner darkening. It is a SECOND full-scene pass (normals +
    // depth) plus a 32-tap kernel per pixel, so it only runs at the
    // 'quality' preset; 'balanced' (the 60-FPS default) and
    // 'performance' skip it.
    if (mode !== 'performance') {
      ssao = new SSAOPass(scene, camera, w, h);
      ssao.kernelRadius = 8;
      ssao.minDistance = 0.005;
      ssao.maxDistance = 0.1;
      ssao.output = SSAOPass.OUTPUT.Default;
      ssao.enabled = mode === 'quality';
      composer.addPass(ssao);
    }

    // Bloom — neon highlights (windows, muzzle flashes, RPG halo). The
    // mip chain runs at HALF resolution: bloom is a blur, the result is
    // indistinguishable and it saves ~4× the bandwidth of the pass.
    bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(64, w >> 1), Math.max(64, h >> 1)),
      /* strength */ 0.45,
      /* radius */   0.75,
      /* threshold*/ 0.85,
    );
    bloom.enabled = mode !== 'performance';
    composer.addPass(bloom);
    applyExposure();

    // HDR → display: ACES tone-map + sRGB encode. Without this pass the
    // composer wrote linear HDR straight to the canvas and the
    // renderer's tone mapping never ran (it only applies on-screen).
    composer.addPass(new OutputPass());

    // Colour-grade as the FINAL (LDR) pass so it applies to bloom + SSAO.
    grade = new ShaderPass(ColorGradeShader);
    grade.renderToScreen = true;
    composer.addPass(grade);
  } catch (err) {
    console.warn('[postFx] composer build failed — using raw render', err);
    fallback = true;
    composer = null;
  }

  const api = {
    __composer: composer,
    setExposure(base) { if (Number.isFinite(base)) { exposureBase = base; applyExposure(); } },
    setExposureBias(bias) { if (Number.isFinite(bias) && bias > 0) { exposureBias = bias; applyExposure(); } },
    getExposure() { return { base: exposureBase, bias: exposureBias, value: renderer.toneMappingExposure }; },
    render(sceneArg, cameraArg /* dt not used yet */) {
      if (fallback || !composer) {
        renderer.render(sceneArg || scene, cameraArg || camera);
        return;
      }
      // If caller passed a fresh scene/camera (they can change mid-
      // session), re-point the RenderPass and SSAO before rendering.
      if (sceneArg) composer.passes[0].scene = sceneArg;
      if (cameraArg) composer.passes[0].camera = cameraArg;
      if (ssao && sceneArg) ssao.scene = sceneArg;
      if (ssao && cameraArg) ssao.camera = cameraArg;
      composer.render();
    },
    setSize(nw, nh) {
      const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      if (composer) composer.setSize(nw, nh);
      if (ssao) ssao.setSize(Math.round(nw * pr), Math.round(nh * pr));
      if (bloom) bloom.setSize(Math.max(64, Math.round(nw * pr) >> 1), Math.max(64, Math.round(nh * pr) >> 1));
    },
    // Dynamic resolution: re-point every render target at the new
    // device pixel ratio (the composer caches the ratio it was built with).
    setPixelRatio(pr, nw, nh) {
      if (composer) { composer.setPixelRatio(pr); composer.setSize(nw, nh); }
      if (ssao) ssao.setSize(Math.round(nw * pr), Math.round(nh * pr));
      if (bloom) bloom.setSize(Math.max(64, Math.round(nw * pr) >> 1), Math.max(64, Math.round(nh * pr) >> 1));
    },
    ssaoEnabled: () => !!(ssao && ssao.enabled),
    bloomEnabled: () => !!(bloom && bloom.enabled),
    setQuality(newMode) {
      // Toggle bloom/SSAO intensity without rebuilding the composer.
      if (newMode === 'performance') {
        if (ssao) ssao.enabled = false;
        if (bloom) bloom.enabled = false;
      } else if (newMode === 'balanced') {
        if (ssao) ssao.enabled = true;
        if (bloom) { bloom.enabled = true; bloom.strength = 0.4; }
      } else {
        if (ssao) ssao.enabled = true;
        if (bloom) { bloom.enabled = true; bloom.strength = 0.55; }
      }
    },
    setGrade({ contrast, saturation, warmTint, vignette }) {
      if (!grade) return;
      if (contrast != null) grade.uniforms.contrast.value = contrast;
      if (saturation != null) grade.uniforms.saturation.value = saturation;
      if (warmTint) grade.uniforms.warmTint.value.copy(warmTint);
      if (vignette != null) grade.uniforms.vignette.value = vignette;
    },
    setBloom({ strength, radius, threshold } = {}) {
      if (!bloom) return;
      if (strength != null) bloom.strength = strength;
      if (radius != null) bloom.radius = radius;
      if (threshold != null) bloom.threshold = threshold;
    },
    isFallback: () => fallback,
    dispose() {
      composer?.dispose?.();
    },
  };
  return api;
}
