// Team Gangsta Brawl — Reflection & IBL probe helpers (Tier 2).
//
// A **reflection probe** is a cube camera we bake once at a fixed
// world position, then use as the environment map for any material
// in that region. The AAA target is 4-6 probes per arena, one per
// major room / corner, blended per-fragment. This module ships the
// SINGLE-PROBE happy path (one env map applied globally as
// `scene.environment`), which is what Xbox-360-era engines did
// before per-probe blending arrived on PS4-era hardware.
//
// Baked GI is a MUCH bigger job (offline UV-atlas + lightmap
// generator) — we approximate it here by generating the env map
// AFTER the scene has finished authoring itself, so the probe
// captures REAL lit surfaces including sun, sky, and window
// emissives. That gives PBR materials a plausible ambient response
// with no offline tooling required.

import * as THREE from 'three';

/**
 * Bake an environment map from a cube camera at the given world
 * position, then apply it as `scene.environment`. Also returns the
 * PMREM-generated texture so callers can use it on individual
 * materials.
 *
 * @param {object}   opts
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {THREE.Scene}         opts.scene
 * @param {THREE.Vector3}       [opts.position]     Probe world pos, default (0, 4, 0).
 * @param {number}              [opts.near]         Cube camera near, default 0.5.
 * @param {number}              [opts.far]          Cube camera far, default 250.
 * @param {number}              [opts.resolution]   Cube face size, default 256.
 * @param {number}              [opts.intensity]    Applied to scene.environmentIntensity (r161+).
 */
export function bakeSceneReflectionProbe({
  renderer, scene,
  position = new THREE.Vector3(0, 4, 0),
  near = 0.5, far = 250,
  resolution = 256,
  intensity = 0.85,
  beforeCapture = null,   // e.g. hide the sun disc so the half-float cube never sees Inf
  afterCapture = null,
} = {}) {
  if (!renderer || !scene) return null;

  const rt = new THREE.WebGLCubeRenderTarget(resolution, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipMapLinearFilter,
    type: THREE.HalfFloatType,
  });
  const cam = new THREE.CubeCamera(near, far, rt);
  cam.position.copy(position);
  scene.add(cam);
  const capture = () => {
    try { beforeCapture?.(); cam.update(renderer, scene); } finally { afterCapture?.(); }
  };

  // Wait one animation frame so streamable lights have a chance to
  // add themselves before we bake — otherwise the probe captures a
  // half-lit scene.
  requestAnimationFrame(() => {
    try {
      capture();
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileCubemapShader();
      const envTex = pmrem.fromCubemap(rt.texture).texture;
      scene.environment = envTex;
      if ('environmentIntensity' in scene) {
        scene.environmentIntensity = intensity;
      }
      pmrem.dispose();
      scene.remove(cam);
    } catch (err) {
      console.warn('[reflectionProbe] bake failed — falling back to no IBL', err);
    }
  });

  return {
    rebake() {
      try {
        capture();
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileCubemapShader();
        const envTex = pmrem.fromCubemap(rt.texture).texture;
        scene.environment = envTex;
        pmrem.dispose();
      } catch (err) {
        console.warn('[reflectionProbe] rebake failed', err);
      }
    },
    dispose() {
      rt.dispose();
      scene.remove(cam);
      if (scene.environment) { scene.environment.dispose?.(); scene.environment = null; }
    },
  };
}
