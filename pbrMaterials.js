// pbrMaterials.js — AAA PBR material factory.
//
// Migrates legacy MeshLambertMaterial usage to MeshStandardMaterial
// with sensible defaults per material category. MeshStandardMaterial
// supports:
//   • Environment map reflections (scene.environment) — huge win
//     for cars, glass, and metal props.
//   • Real roughness / metalness spectrum — matte concrete reads
//     different from polished chrome.
//   • Correct rim + ambient light integration.
//
// The categorised helpers below let a caller swap `new THREE
// .MeshLambertMaterial(opts)` → `pbr.building(opts)` with zero
// tuning — the defaults are tuned to match SR1-era arena grit
// without over-metallising anything.
//
// Public helpers:
//   pbr.building(opts)   → matte brick / concrete facade  (r=0.88, m=0)
//   pbr.metal(opts)      → dull metal railing / girder    (r=0.45, m=0.85)
//   pbr.plastic(opts)    → hydrant / meter / seat plastic (r=0.55, m=0)
//   pbr.wood(opts)       → wooden crate / bench slats     (r=0.72, m=0)
//   pbr.stone(opts)      → sidewalk / plaster / low walls (r=0.90, m=0)
//   pbr.paint(opts)      → glossy vehicle chassis         (r=0.32, m=0.55)
//   pbr.glass(opts)      → window pane                    (r=0.05, m=0)
//   pbr.emissive(opts)   → sign / neon (color + intensity)
// Each accepts the same opts shape as MeshLambertMaterial
// (color/map/transparent/opacity/side/etc.) plus optional
// roughness/metalness overrides.

import * as THREE from 'three';

function _make(opts, defaults) {
  const { normalMap, roughnessMap, aoMap, envMapIntensity, ...rest } = opts;
  const params = { color: defaults.color != null ? defaults.color : 0xffffff, roughness: defaults.roughness, metalness: defaults.metalness };
  // Every Lambert-era option (map, transparent, opacity, side, alphaTest,
  // polygonOffset*, emissive…) is a valid MeshStandardMaterial option too.
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) params[k] = v;
  if (params.emissive && params.emissiveIntensity == null) params.emissiveIntensity = 1.0;
  const mat = new THREE.MeshStandardMaterial(params);
  if (normalMap) mat.normalMap = normalMap;
  if (roughnessMap) mat.roughnessMap = roughnessMap;
  if (aoMap) mat.aoMap = aoMap;
  // envMapIntensity — how much the scene.environment IBL reflects.
  // Defaults 1.0; kept unless caller overrides.
  if (envMapIntensity != null) mat.envMapIntensity = envMapIntensity;
  return mat;
}

export const pbr = {
  building: (opts = {}) => _make(opts, { roughness: 0.88, metalness: 0.0, color: 0x888888 }),
  metal:    (opts = {}) => _make(opts, { roughness: 0.45, metalness: 0.85, color: 0x888a8f }),
  plastic:  (opts = {}) => _make(opts, { roughness: 0.55, metalness: 0.0,  color: 0x883a2a }),
  wood:     (opts = {}) => _make(opts, { roughness: 0.72, metalness: 0.0,  color: 0x8a6844 }),
  stone:    (opts = {}) => _make(opts, { roughness: 0.9,  metalness: 0.0,  color: 0x7a7a7f }),
  paint:    (opts = {}) => _make(opts, { roughness: 0.32, metalness: 0.55, color: 0xd83030 }),
  glass:    (opts = {}) => _make(
    { transparent: true, opacity: 0.6, ...opts },
    { roughness: 0.05, metalness: 0.0, color: 0xa8c4e2 },
  ),
  emissive: (opts = {}) => _make(opts, { roughness: 0.55, metalness: 0.0, color: 0xffffff }),
};

// Convenience — legacy code that just does `new THREE.MeshLambertMaterial({...})`
// can swap to `standardFromLambert(opts)` for a 1-line drop-in that
// picks safe defaults (matte, non-metal).
export function standardFromLambert(opts = {}) {
  return pbr.building(opts);
}
