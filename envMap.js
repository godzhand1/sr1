// envMap.js — shared PMREM environment map for AAA PBR reflections.
//
// Adds realistic Image-Based Lighting (IBL) to every scene that
// installs it. Every PBR material (Venom paint, glass, weapons)
// picks up ambient reflections + rim highlights.
//
// Two IBL modes are exposed:
//
//   1. RoomEnvironment (indoor studio) — the neutral fallback.
//      One 256×256 cube-map (~1 MB VRAM). No arena context.
//
//   2. Sky-preset IBL (outdoor gradient sky) — per TIME_OF_DAY
//      preset. Builds a small scene with a huge sphere that
//      renders the sky bands as an inside-out material, a
//      hemisphere light matching the preset, and (for night)
//      a ring of neon coloured point lights. Bakes that scene
//      through PMREMGenerator so the arena's ACTUAL sky lights
//      the PBR materials.
//
// Public API:
//   installEnvironmentMap(scene, renderer, opts)
//     opts.timeOfDay = 'DAWN' | 'MORNING' | 'NOON' | 'GOLDEN' |
//                      'SUNSET' | 'NIGHT' | 'STORMY' | null
//     Omit or null → uses RoomEnvironment fallback (compat).
//   disposeEnvironmentMap(scene) — free VRAM.

import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TIME_OF_DAY_PRESETS } from './atmosphericSky.js';

const _sceneOwners = new WeakMap(); // scene → { pmrem, texture, mode }

// Build a small procedural scene that captures the preset's sky
// gradient + lighting. Rendered ONCE through PMREM to bake an
// environment map — never added to the main game scene.
function _buildPresetIBLScene(preset) {
  const s = new THREE.Scene();

  // Sky sphere — inside-out so the CAMERA-inside sees the gradient
  // as if it were the world sky. Vertex-shaded 3-band gradient
  // matches the same math the visible sky dome uses.
  const bands = preset.sky_bands || {
    horizon: preset.sky || '#4090e0',
    mid:     preset.sky || '#4090e0',
    zenith:  preset.sky || '#204a90',
  };
  const horizonC = new THREE.Color(bands.horizon);
  const midC     = new THREE.Color(bands.mid);
  const zenithC  = new THREE.Color(bands.zenith);
  const skyGeo = new THREE.SphereGeometry(50, 32, 24);
  // Simple shader material — sample by y direction (up-vector dot)
  // to smoothstep between the three bands.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uHorizon: { value: horizonC },
      uMid:     { value: midC },
      uZenith:  { value: zenithC },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon;
      uniform vec3 uMid;
      uniform vec3 uZenith;
      varying vec3 vDir;
      void main() {
        // t in [-1, 1] — up direction
        float t = clamp(vDir.y, -1.0, 1.0);
        vec3 col;
        if (t < 0.0) {
          // Below horizon → ground/horizon blend
          col = mix(uHorizon, uHorizon * 0.6, -t);
        } else if (t < 0.5) {
          // Horizon → mid
          col = mix(uHorizon, uMid, smoothstep(0.0, 0.5, t));
        } else {
          // Mid → zenith
          col = mix(uMid, uZenith, smoothstep(0.5, 1.0, t));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  s.add(skyMesh);

  // Hemisphere light — matches the preset (sky above, ground bounce below).
  const hemi = preset.hemisphere || { sky_color: '#ffffff', ground_color: '#3a2028', intensity: 1.0 };
  s.add(new THREE.HemisphereLight(
    new THREE.Color(hemi.sky_color),
    new THREE.Color(hemi.ground_color),
    hemi.intensity ?? 1.0,
  ));

  // Ambient light — subtle uniform floor so the shaded side of
  // objects doesn't get PMREM'd into pitch black.
  const amb = preset.ambient || { color: '#ffffff', intensity: 0.35 };
  s.add(new THREE.AmbientLight(
    new THREE.Color(amb.color),
    (amb.intensity ?? 0.35) * 0.5,      // 0.5x since PMREM double-counts hemi + ambient
  ));

  // Sun / moon disc as a small emissive sphere — gives PBR paints
  // a bright hotspot they can bounce.
  const sun = preset.sun || { color: '#ffffff', intensity: 1.2, azimuth: 0.6, elevation: 0.4 };
  const sunI = sun.intensity ?? 1.0;
  if (sunI > 0) {
    const az = sun.azimuth ?? 0.5;
    const el = sun.elevation ?? 0.4;
    const dir = new THREE.DirectionalLight(new THREE.Color(sun.color), sunI * 1.4);
    dir.position.set(
      30 * Math.cos(el) * Math.sin(az),
      30 * Math.sin(el),
      30 * Math.cos(el) * Math.cos(az),
    );
    s.add(dir);
  }

  // Night preset → sprinkle a ring of neon point lights around the
  // horizon so metal/glass materials pick up the "neon city" gang-
  // hood vibe: hot pink, electric cyan, deep purple, arcade green.
  if (preset.stars || (preset.label && preset.label.toUpperCase() === 'NIGHT')) {
    const neons = [
      { c: '#ff2a6d', a:  0.0 },        // hot pink
      { c: '#05d9ff', a:  Math.PI * 0.4 }, // electric cyan
      { c: '#c14eff', a:  Math.PI * 0.8 }, // purple
      { c: '#39ff14', a:  Math.PI * 1.2 }, // arcade green
      { c: '#ff6a3a', a:  Math.PI * 1.6 }, // sodium-orange street lamp
    ];
    for (const n of neons) {
      const p = new THREE.PointLight(new THREE.Color(n.c), 1.8, 0, 0);
      // Ring of lights just above the horizon.
      p.position.set(20 * Math.cos(n.a), 3, 20 * Math.sin(n.a));
      s.add(p);
    }
  }

  return s;
}

export function installEnvironmentMap(scene, renderer, opts = {}) {
  if (!scene || !renderer) return null;
  const existing = _sceneOwners.get(scene);
  const wantMode = opts.timeOfDay || 'ROOM';
  if (existing && existing.mode === wantMode) return existing.texture;
  if (existing) disposeEnvironmentMap(scene);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let texture = null;
  let ownedScene = null;
  try {
    if (opts.timeOfDay && TIME_OF_DAY_PRESETS[opts.timeOfDay]) {
      const preset = TIME_OF_DAY_PRESETS[opts.timeOfDay];
      ownedScene = _buildPresetIBLScene(preset);
      const target = pmrem.fromScene(ownedScene, 0.02);
      texture = target.texture;
    } else {
      // Fallback — indoor studio IBL (no arena context).
      const roomEnv = new RoomEnvironment();
      const target = pmrem.fromScene(roomEnv, 0.04);
      texture = target.texture;
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[envMap] PMREM bake failed', err);
    pmrem.dispose();
    return null;
  }
  scene.environment = texture;
  // Tuned intensity — 0.85 for sky IBLs (they're brighter than the
  // studio fallback), 0.8 for RoomEnvironment.
  scene.environmentIntensity = opts.timeOfDay ? 0.85 : 0.8;
  _sceneOwners.set(scene, { pmrem, texture, mode: wantMode, ownedScene });
  return texture;
}

export function disposeEnvironmentMap(scene) {
  const owner = _sceneOwners.get(scene);
  if (!owner) return;
  try { owner.texture.dispose?.(); } catch (_) { /* ignore */ }
  try { owner.pmrem.dispose?.(); } catch (_) { /* ignore */ }
  if (owner.ownedScene) {
    owner.ownedScene.traverse((n) => {
      n.geometry?.dispose?.();
      n.material?.dispose?.();
    });
  }
  scene.environment = null;
  _sceneOwners.delete(scene);
}
