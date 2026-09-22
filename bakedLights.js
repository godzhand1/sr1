// bakedLights.js — shared "baked lighting" fixtures for every Team
// Gangsta Brawl map (iter192).
//
// Real baked lightmaps aren't practical for our procedurally-built
// arenas — the geometry is generated at runtime from a spec, so we
// can't pre-render UV-mapped shadow textures for it. What we CAN do
// cheaply is treat static PointLights with `castShadow = false` as
// baked fixtures: they light the world consistently, cost effectively
// zero per frame (Three.js clamps them into the shader as constant
// uniforms — no shadow map generation), and let each map ship a
// distinctive lighting mood.
//
// Public API:
//   • addBakedLampFixture(stream, x, y, z, opts?) — one point light
//     with a matching emissive glow bulb + optional pole mesh.
//   • placeBakedLampGrid(stream, {half, kind, ...}) — sprinkle a set
//     of fixtures across an arena's playable area. `kind` picks the
//     color/intensity/geometry preset (streetlamp, warehouse,
//     interior_warm, spotlight, neon).
//
// Every fixture creates its own THREE.Group so the caller (map
// builder) decides whether to `stream.addEssential` (always visible)
// or `stream.addStreamable(x, z)` (LOD unload when far away). We
// return the group and let the caller pick.

import * as THREE from 'three';
import { flattenToInstances } from './render/instanceBatch.js';

// Colour + intensity presets. Keys are the `kind` string passed to
// `placeBakedLampGrid` and `addBakedLampFixture`. Each preset tunes:
//   • light  — { color, intensity, distance, decay }
//   • bulb   — visible emissive sphere size + color
//   • pole   — optional dark stalk from ground up to the light
export const BAKED_LIGHT_PRESETS = {
  // Outdoor streetlight — warm sodium-vapor orange, tall pole.
  streetlamp: {
    light: { color: 0xffb060, intensity: 3.6, distance: 22, decay: 1.6 },
    bulb:  { color: 0xffcf88, radius: 0.20 },
    pole:  { height: 4.4, color: 0x161616, radius: 0.09 },
    yOff: 4.3,
  },
  // Neon accent — magenta / cyan, no pole, tucked under eaves.
  neon_magenta: {
    light: { color: 0xff5cc4, intensity: 2.4, distance: 14, decay: 2.0 },
    bulb:  { color: 0xff88d4, radius: 0.14 },
    pole:  null,
    yOff:  4.2,
  },
  neon_cyan: {
    light: { color: 0x60d9ff, intensity: 2.4, distance: 14, decay: 2.0 },
    bulb:  { color: 0x9fe8ff, radius: 0.14 },
    pole:  null,
    yOff:  4.2,
  },
  // Interior warm bulb — sits at ceiling height.
  interior_warm: {
    light: { color: 0xffd28c, intensity: 2.0, distance: 18, decay: 1.7 },
    bulb:  { color: 0xffe4b0, radius: 0.16 },
    pole:  null,
    yOff:  4.6,
  },
  // Warehouse skylight — cool pale-blue overhead down-light.
  warehouse_skylight: {
    light: { color: 0xd8e2ff, intensity: 1.6, distance: 20, decay: 1.5 },
    bulb:  { color: 0xf0f6ff, radius: 0.25 },
    pole:  null,
    yOff:  6.4,
  },
  // Dramatic overhead spotlight — narrow cone feel for KOTH hills.
  spotlight: {
    light: { color: 0xfff0d0, intensity: 4.0, distance: 26, decay: 1.8 },
    bulb:  { color: 0xffffe0, radius: 0.22 },
    pole:  null,
    yOff:  7.2,
  },
  // Rooftop hazard beacon — deep red, slow pulse looks great but
  // static intensity keeps costs at zero.
  hazard_red: {
    light: { color: 0xff4a3a, intensity: 2.6, distance: 16, decay: 2.0 },
    bulb:  { color: 0xff6a4a, radius: 0.18 },
    pole:  null,
    yOff:  5.6,
  },
};

// Reusable geometry / material caches so 30+ fixtures across the maps
// don't allocate 30+ meshes with unique GPU handles. All meshes are
// static, so shared refs are safe.
const _geomCache = new Map();
const _matCache = new Map();

function _bulbGeom(radius) {
  const key = `bulb_${radius.toFixed(3)}`;
  if (!_geomCache.has(key)) _geomCache.set(key, new THREE.SphereGeometry(radius, 10, 8));
  return _geomCache.get(key);
}
function _bulbMat(color) {
  const key = `bulb_mat_${color.toString(16)}`;
  if (!_matCache.has(key)) {
    _matCache.set(key, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  }
  return _matCache.get(key);
}
function _poleGeom(height, radius) {
  const key = `pole_${height.toFixed(2)}_${radius.toFixed(2)}`;
  if (!_geomCache.has(key)) {
    _geomCache.set(key, new THREE.CylinderGeometry(radius, radius, height, 6, 1));
  }
  return _geomCache.get(key);
}
function _poleMat(color) {
  const key = `pole_mat_${color.toString(16)}`;
  if (!_matCache.has(key)) _matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 }));
  return _matCache.get(key);
}

// Add ONE baked lamp fixture at (x,z), lifted to preset.yOff. Returns
// the THREE.Group so the caller decides essential vs. streamable.
export function addBakedLampFixture(x, z, kind = 'streetlamp') {
  const preset = BAKED_LIGHT_PRESETS[kind] || BAKED_LIGHT_PRESETS.streetlamp;
  const g = new THREE.Group();
  const y = preset.yOff;

  // Optional pole (streetlamp only).
  if (preset.pole) {
    const pole = new THREE.Mesh(_poleGeom(preset.pole.height, preset.pole.radius), _poleMat(preset.pole.color));
    pole.position.set(x, preset.pole.height / 2, z);
    pole.castShadow = false;
    pole.receiveShadow = true;
    g.add(pole);
  }

  // Emissive bulb — always visible, no lit-material cost.
  const bulb = new THREE.Mesh(_bulbGeom(preset.bulb.radius), _bulbMat(preset.bulb.color));
  bulb.position.set(x, y, z);
  g.add(bulb);

  // The actual point light — NEVER casts shadows (that's what makes
  // it "baked": constant runtime cost, no shadow-map render pass).
  const pl = new THREE.PointLight(
    preset.light.color,
    preset.light.intensity,
    preset.light.distance,
    preset.light.decay,
  );
  pl.position.set(x, y, z);
  pl.castShadow = false;
  g.add(pl);

  g.userData.bakedLamp = { kind, x, z };
  return g;
}

// Sprinkle a grid of baked lamps across a rectangular play area.
//
// Params:
//   half      — arena half-extent (world units from center to edge)
//   kind      — preset key (see BAKED_LIGHT_PRESETS)
//   step      — spacing between lamps (default: half / 2)
//   inset     — how far to pull lamps in from the border
//   skipCenter — if true, drops the center-most fixture (leaves the
//                arena middle open for KOTH-style playzones)
//   perimeter — if true, ONLY places lamps around the border (no
//               interior fixtures)
//   stream    — StreamingManager. If provided AND `essential=false`,
//               each fixture is added as streamable at its (x,z).
//   essential — if true (default), lamps are always visible.
//
// Returns the array of Group refs so the caller can further customize.
export function placeBakedLampGrid(stream, opts = {}) {
  const {
    half = 30,
    kind = 'streetlamp',
    step = null,
    inset = 6,
    skipCenter = false,
    perimeter = false,
    essential = true,
    yOverride = null,
    instanced = true,
  } = opts;

  const s = step != null ? step : Math.max(10, half * 0.6);
  const groups = [];
  const usable = half - inset;

  const positions = [];
  if (perimeter) {
    // 4 lamps along each edge.
    const count = Math.max(2, Math.floor(usable * 2 / s));
    for (let i = 0; i < count; i++) {
      const t = -usable + (i + 0.5) * (usable * 2 / count);
      positions.push([t, -usable]);
      positions.push([t,  usable]);
      positions.push([-usable, t]);
      positions.push([ usable, t]);
    }
  } else {
    // Sparse interior grid.
    for (let x = -usable; x <= usable + 0.01; x += s) {
      for (let z = -usable; z <= usable + 0.01; z += s) {
        if (skipCenter && Math.hypot(x, z) < s * 0.6) continue;
        positions.push([x, z]);
      }
    }
  }

  const fixtures = [];
  for (const [x, z] of positions) {
    const g = addBakedLampFixture(x, z, kind);
    if (yOverride != null) {
      for (const child of g.children) child.position.y += yOverride;
    }
    fixtures.push(g);
    groups.push(g);
  }
  // Many fixtures → ONE instanced pole batch + ONE bulb batch (2 draw
  // calls instead of 2×N). The lights stay in their groups so the
  // runtime LightPool can adopt them; the groups become essential.
  if (instanced && fixtures.length >= 2) {
    const { instanced: batches, singles } = flattenToInstances(fixtures, { castShadow: false });
    for (const b of batches) stream.addEssential(b);
    for (const s of singles) stream.addEssential(s);
    for (const g of fixtures) stream.addEssential(g);
    return groups;
  }
  for (const g of fixtures) {
    const { x, z } = g.userData.bakedLamp;
    if (essential) stream.addEssential(g);
    else stream.addStreamable(g, x, z);
  }
  return groups;
}
