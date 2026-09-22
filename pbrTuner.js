// pbrTuner.js — post-hoc PBR tuning pass for a scene.
//
// After a map factory builds its scene, run tunePbr(scene) to walk
// every mesh and apply category-appropriate roughness/metalness
// based on:
//   • userData.pbrHint — an explicit category string set by the
//     builder (highest priority).
//   • material.color — heuristic categorisation from the paint colour
//     (dark grey → concrete; warm brown → brick; bright red → paint).
//
// The tuner leaves materials that already have non-default
// roughness/metalness (set by the map author) untouched. Only
// "bulk-swapped" defaults (roughness=1, metalness=0) get replaced.
//
// Public API:
//   tunePbr(scene)       — walk + tune, idempotent (marks tuned mats)
//   PBR_HINTS            — the vocabulary of category strings

import * as THREE from 'three';

// Per-category roughness / metalness / envMapIntensity presets.
// Values tuned to give the arena AAA-lit feel:
//   • pavement  → damp asphalt, low-key highlights
//   • rooftop   → gravelly / tar, no highlights
//   • building  → matte concrete / brick
//   • metal     → chromed steel handrails, forklift bones
//   • plastic   → hydrants / meters / signs
//   • wood      → benches, crates, boardwalks
//   • glass     → window panes (transparent, sharp reflections)
//   • paint     → glossy car chassis (dielectric paint)
//   • neon      → sign emissives (kept metalless, low roughness)
export const PBR_PRESETS = {
  pavement: { roughness: 0.72, metalness: 0.02, envMapIntensity: 0.9 },
  rooftop:  { roughness: 0.95, metalness: 0.0,  envMapIntensity: 0.7 },
  building: { roughness: 0.9,  metalness: 0.0,  envMapIntensity: 0.6 },
  concrete: { roughness: 0.88, metalness: 0.0,  envMapIntensity: 0.6 },
  brick:    { roughness: 0.92, metalness: 0.0,  envMapIntensity: 0.55 },
  metal:    { roughness: 0.4,  metalness: 0.85, envMapIntensity: 1.0 },
  plastic:  { roughness: 0.55, metalness: 0.0,  envMapIntensity: 0.9 },
  wood:     { roughness: 0.72, metalness: 0.0,  envMapIntensity: 0.7 },
  glass:    { roughness: 0.05, metalness: 0.0,  envMapIntensity: 1.4 },
  paint:    { roughness: 0.32, metalness: 0.55, envMapIntensity: 1.1 },
  neon:     { roughness: 0.35, metalness: 0.0,  envMapIntensity: 1.2 },
  dirt:     { roughness: 0.98, metalness: 0.0,  envMapIntensity: 0.5 },
};

export const PBR_HINTS = Object.keys(PBR_PRESETS);

// Heuristic categorisation from a paint colour. Returns null if we
// can't confidently guess — the tuner keeps such materials matte.
function _guessCategory(mat) {
  if (!mat || !mat.color) return null;
  const c = mat.color;
  const r = c.r, g = c.g, b = c.b;
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  // Explicit emissive → probably a neon sign.
  if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.05) return 'neon';
  // Transparent low-opacity → glass.
  if (mat.transparent && mat.opacity < 0.85) return 'glass';
  // Very dark greys (0.1-0.3 luminance, ~monochrome) → pavement.
  if (brightness < 0.3 && Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05) return 'pavement';
  // Mid greys with a very slight warm tint → concrete.
  if (brightness < 0.55 && Math.abs(r - g) < 0.08 && Math.abs(g - b) < 0.08) return 'concrete';
  // Warm brown/orange (r > g > b, r > 0.35) → brick / dirt.
  if (r > g && g > b && r - b > 0.1 && r > 0.3) return 'brick';
  // Pastel bright colours are usually painted plastic / signs.
  return null;
}

export function tunePbr(scene) {
  if (!scene) return;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat || !mat.isMeshStandardMaterial) continue;
      if (mat.userData && mat.userData._pbrTuned) continue;
      // Only tune materials that still have DEFAULT roughness/metalness
      // (r=1, m=0) — respect authors that already tuned deliberately.
      // Also: don't skip if envMapIntensity is default (1.0) — many
      // authors pick roughness but forget to boost envMapIntensity.
      const isDefault = Math.abs(mat.roughness - 1.0) < 0.001 &&
                        Math.abs(mat.metalness - 0.0) < 0.001;
      if (!isDefault) {
        mat.userData._pbrTuned = true;
        continue;
      }
      // Priority 1 — explicit hint on the MESH's userData.
      const hint = (o.userData && o.userData.pbrHint) ||
                   (mat.userData && mat.userData.pbrHint) ||
                   _guessCategory(mat);
      const preset = hint && PBR_PRESETS[hint];
      if (preset) {
        mat.roughness = preset.roughness;
        mat.metalness = preset.metalness;
        if (preset.envMapIntensity != null) mat.envMapIntensity = preset.envMapIntensity;
      }
      mat.userData._pbrTuned = true;
      mat.needsUpdate = true;
    }
  });
}
