// Flood-above-ground effect.
//
// Spawns a large translucent water plane hovering slightly above
// the map's ground so it looks like the arena is flooded. The
// surface uses the exact Blender Principled BSDF graph the user
// authored — BASE COLOR (sRGB) + METALLIC ROUGHNESS (Non-Color)
// with the same Mapping node UV transform (loc, rot, scale),
// Alpha Factor Multiply 0.45, and Metallic Factor Multiply -26.9.
// A tangent-space Normal map is layered on top for water micro-
// ripples; the two greyscale foam variants are alternated as an
// emissive foam mask so the surface glints subtly under the
// interior fill light. All maps share the same Mapping transform
// (matches the Blender graph fan-out from a single Mapping node).
//
// UV FLOW: after spawning, an `onBeforeRender` hook drifts every
// input texture's UV offset per frame so the water visibly moves.
// All three textures (map / metalness+roughness / normal) drift in
// lockstep — that's the same behavior a shared Mapping node would
// produce in Blender. Speed defaults to a gentle 0.03 U + 0.012 V
// per second; callers can override via `flowSpeed` or disable
// entirely with `flowSpeed: { x: 0, y: 0 }` for a still surface.
//
// The flood plane is:
//   • Rotated flat (rotation.x = -π/2) so it lies on the XZ plane
//   • Positioned at FLOOD_Y (~0.15m above ground) so it visibly
//     "floods" the arena without z-fighting the ground plane
//   • Sized to cover the entire GARAGE_HALF footprint × 2 with a
//     safety margin so the water reaches the fence line
//   • Tagged with `userData.__flood = true` so it can be found
//     for removal and skipped by the exporter's marker pass
//
// Public API:
//   spawnFloodAboveGround(scene, options)   → { mesh, dispose }
//   removeFloodAboveGround(scene)           → number of meshes removed
//
// Call `dispose` on scene teardown to free the GPU textures.

import * as THREE from 'three';
import { buildBlenderPrincipledMaterial } from './blenderPBRShader';

const FLOOD_TEXTURE_URLS = {
  baseColorURL: '/images/flood/basecolor.png',
  metallicRoughnessURL: '/images/flood/metallic_roughness.png',
  normalURL: '/images/flood/normal.png',
};

// How high the water sits above y=0. Small enough that the player
// visually wades through it, large enough that ground decals don't
// z-fight the water surface.
const FLOOD_Y_DEFAULT = 0.15;

// Half-extent of the water plane. Covers a generous city-block-
// sized area by default; individual maps can override via options.
const FLOOD_HALF_DEFAULT = 80;

// Segment count along each axis. Higher = smoother normal-map
// perturbation at the cost of triangle count. 32 is a good balance
// for a flat surface.
const FLOOD_SEGMENTS_DEFAULT = 32;

// UV drift per second — tuned to be visible but not distracting.
// Positive X = water flows toward +U (visually rightward on the
// mesh); positive Y = toward +V. Slight non-axis-aligned drift
// (0.03/0.012) keeps the flow looking natural rather than a strict
// horizontal band.
const FLOW_SPEED_DEFAULT = { x: 0.03, y: 0.012 };

export function spawnFloodAboveGround(scene, options = {}) {
  const {
    y = FLOOD_Y_DEFAULT,
    half = FLOOD_HALF_DEFAULT,
    segments = FLOOD_SEGMENTS_DEFAULT,
    flowSpeed = FLOW_SPEED_DEFAULT,
    // Pass-through overrides for the Blender shader — callers can
    // dial the mapping / alpha / metallic to taste per-map without
    // re-editing this file.
    mapping,
    alphaFactor,
    metallicFactor,
    roughness,
  } = options;

  const geom = new THREE.PlaneGeometry(half * 2, half * 2, segments, segments);
  const { material, disposeTextures } = buildBlenderPrincipledMaterial({
    ...FLOOD_TEXTURE_URLS,
    mapping,
    alphaFactor,
    metallicFactor,
    roughness,
  });

  const mesh = new THREE.Mesh(geom, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  // No shadow casting — a translucent water surface would produce
  // muddy blob shadows on the ground beneath. Receive shadows so
  // the garage's overhead structure casts onto the water surface.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 5; // render after opaque ground / roads so
                       // blending is stable (opaque z-buffer set
                       // before the transparent pass)
  mesh.name = 'flood_above_ground';
  mesh.userData.__flood = true;
  // Marked as map geometry so purgeOriginalMap in sceneImport.js
  // can strip it on GLB re-import along with the rest of the
  // built-in map.
  mesh.userData.__mapGeometry = true;

  // UV flow: cache each texture's Blender-authored base offset
  // once (populated lazily as textures arrive — the loader is
  // async), then drift the live offset per render call. This keeps
  // the Mapping node's Location XY intact while adding a monotonic
  // scroll on top.
  const baseOffsets = new WeakMap();
  const clock = new THREE.Clock();
  clock.start();
  const captureBase = (tex) => {
    if (!tex || baseOffsets.has(tex)) return;
    baseOffsets.set(tex, { x: tex.offset.x, y: tex.offset.y });
  };
  mesh.onBeforeRender = () => {
    // Skip work if user configured a still surface.
    if (flowSpeed.x === 0 && flowSpeed.y === 0) return;
    const t = clock.getElapsedTime();
    // All three input textures share the same Mapping node in the
    // Blender graph, so they must drift in lockstep. Updating each
    // one identically preserves that "single Mapping fan-out"
    // semantic while keeping their Blender-authored base offsets
    // as anchor points.
    for (const key of ['map', 'metalnessMap', 'normalMap']) {
      const tex = material[key];
      if (!tex) continue;
      captureBase(tex);
      const base = baseOffsets.get(tex);
      tex.offset.x = base.x + t * flowSpeed.x;
      tex.offset.y = base.y + t * flowSpeed.y;
    }
    // metalnessMap === roughnessMap (same texture instance) so we
    // don't need to update roughnessMap separately.
  };

  scene.add(mesh);

  const dispose = () => {
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.onBeforeRender = () => {}; // detach flow hook
    geom.dispose();
    disposeTextures();
    material.dispose();
  };

  return { mesh, dispose };
}

// Convenience — find & remove all flood planes from the scene.
// Returns the number of meshes removed so callers can log status.
export function removeFloodAboveGround(scene) {
  const flood = [];
  scene.traverse((o) => {
    if (o.userData?.__flood) flood.push(o);
  });
  for (const o of flood) {
    if (o.parent) o.parent.remove(o);
    o.geometry?.dispose?.();
    const mat = o.material;
    if (Array.isArray(mat)) for (const m of mat) m?.dispose?.();
    else mat?.dispose?.();
  }
  return flood.length;
}
