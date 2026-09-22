// Built-in map templates for the MapEditor.
//
// The 6 first-party arenas (block, projects, koth_house, boardroom,
// graffiti, lobby) are defined in JS map factories — they can't be
// loaded directly into the editor because their geometry is
// procedural, not data. We ship hand-authored TEMPLATE seeds here so
// admins can start a custom map from a familiar layout and tweak it,
// rather than starting from a blank grid.
//
// Each template mirrors the FEEL of its built-in counterpart: same
// half-size, roughly-same spawn locations, matching mood lighting.
// Author intent: not a pixel-perfect copy — enough scaffolding that
// "customise the CITY BLOCK layout" is a 5-minute nudge, not a
// 3-hour ground-up rebuild.

// Fresh id generator scoped to templates so ids don't collide across
// picks. Every template deep-clones on load, then the editor's own
// nextId() takes over for further edits.
let _tid = 1;
const t = (p) => `${p}_t${_tid++}`;

// iter178 — stamp a TIME_OF_DAY preset into the WORLD block. Keeps
// templates DRY: the preset defines sun / hemisphere / ambient /
// fog / sky_bands / stars so we don't repeat the config per-template.
import { TIME_OF_DAY_PRESETS } from './atmosphericSky.js';
function worldFromTod(key) {
  const p = JSON.parse(JSON.stringify(TIME_OF_DAY_PRESETS[key]));
  return {
    sky:        p.sky,
    sky_bands:  p.sky_bands,
    sun:        p.sun,
    hemisphere: p.hemisphere,
    ambient:    p.ambient,
    fog:        p.fog,
    stars:      p.stars,
    tod_preset: key,
  };
}

// ── CITY BLOCK — 4-quadrant arena with mid-height cover ──────────
const CITY_BLOCK = {
  name: 'CITY BLOCK (Template)',
  mode: 'tdm',
  half: 30,
  world: {
    sky:        '#0a0d18',
    sun:        { azimuth: 0.6, elevation: Math.PI / 3.5, color: '#ffefcc', intensity: 0.7 },
    ambient:    { color: '#7c8aa8', intensity: 0.9 },
    hemisphere: { sky_color: '#a8c3ff', ground_color: '#2b0f30', intensity: 0.5 },
    fog:        { color: '#0a0d18', near: 50, far: 140 },
  },
  objects: [
    // 4 corner buildings (12x8x12).
    { id: t('obj'), x: -18, y: 4, z: -18, w: 12, h: 8, d: 12, color: '#4a2c26', collision: true, texture: 'facade_brick_apartments' },
    { id: t('obj'), x:  18, y: 4, z: -18, w: 12, h: 8, d: 12, color: '#352838', collision: true, texture: 'facade_office_glass' },
    { id: t('obj'), x: -18, y: 4, z:  18, w: 12, h: 8, d: 12, color: '#5a2a2a', collision: true, texture: 'facade_painted_brick' },
    { id: t('obj'), x:  18, y: 4, z:  18, w: 12, h: 8, d: 12, color: '#3a3238', collision: true, texture: 'facade_dark_brownstone' },
    // Central cover objects (dumpsters, low walls).
    { id: t('obj'), x: -4, y: 0.7, z: 0, w: 2.5, h: 1.4, d: 1.5, color: '#2a4234', collision: true, climbable: true },
    { id: t('obj'), x:  4, y: 0.7, z: 0, w: 2.5, h: 1.4, d: 1.5, color: '#422a34', collision: true, climbable: true },
    { id: t('obj'), x: 0, y: 0.6, z: -6, w: 4, h: 1.2, d: 0.5, color: '#7a4635', collision: true, climbable: true },
    { id: t('obj'), x: 0, y: 0.6, z:  6, w: 4, h: 1.2, d: 0.5, color: '#7a4635', collision: true, climbable: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: 0, y: 5, z: 0, color: '#ffb060', intensity: 1.8, radius: 30 },
  ],
  spawns: {
    A: [{ x: -14, z: -24, yaw: 0 }, { x: 0, z: -24, yaw: 0 }, { x: 14, z: -24, yaw: 0 }],
    B: [{ x: -14, z:  24, yaw: Math.PI }, { x: 0, z: 24, yaw: Math.PI }, { x: 14, z: 24, yaw: Math.PI }],
  },
  weapon_pickups: [
    { wpn: 'ak47',     x: -18, z: -18, ammo: 60, y: 8.4 },
    { wpn: 'shotgun',  x:   0, z:   0, ammo: 16 },
    { wpn: 'pistol',   x:  -8, z:   0, ammo: 24 },
    { wpn: 'pistol',   x:   8, z:   0, ammo: 24 },
    { wpn: 'pimpslap', x:   0, z:  -8, ammo: 1 },
  ],
  hill_candidates: [],
};

// ── THE PROJECTS — tight urban chokepoints ───────────────────────
const PROJECTS = {
  name: 'THE PROJECTS (Template)',
  mode: 'tdm',
  half: 30,
  world: {
    sky:        '#141018',
    sun:        { azimuth: 0.9, elevation: Math.PI / 5, color: '#ffcc88', intensity: 0.55 },
    ambient:    { color: '#6a728e', intensity: 0.85 },
    hemisphere: { sky_color: '#8894c8', ground_color: '#241830', intensity: 0.5 },
    fog:        { color: '#141018', near: 40, far: 120 },
  },
  objects: [
    // Two long buildings creating a hallway.
    { id: t('obj'), x: -12, y: 5, z: 0, w: 6, h: 10, d: 40, color: '#3d2820', collision: true, texture: 'facade_warehouse_metal' },
    { id: t('obj'), x:  12, y: 5, z: 0, w: 6, h: 10, d: 40, color: '#3d2820', collision: true, texture: 'facade_warehouse_metal' },
    // Cross-passages.
    { id: t('obj'), x: 0, y: 0.7, z: -10, w: 10, h: 1.4, d: 1, color: '#4a3a20', collision: true, climbable: true },
    { id: t('obj'), x: 0, y: 0.7, z:  10, w: 10, h: 1.4, d: 1, color: '#4a3a20', collision: true, climbable: true },
    // Central pillar.
    { id: t('obj'), x: 0, y: 1.6, z: 0, w: 1.5, h: 3.2, d: 1.5, color: '#2a1a24', collision: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: 0, y: 6, z: -10, color: '#a288ff', intensity: 1.5, radius: 22 },
    { id: t('lt'), type: 'point', x: 0, y: 6, z:  10, color: '#ff88a3', intensity: 1.5, radius: 22 },
  ],
  spawns: {
    A: [{ x: 0, z: -25, yaw: 0 }, { x: -3, z: -25, yaw: 0 }, { x: 3, z: -25, yaw: 0 }],
    B: [{ x: 0, z:  25, yaw: Math.PI }, { x: -3, z: 25, yaw: Math.PI }, { x: 3, z: 25, yaw: Math.PI }],
  },
  weapon_pickups: [
    { wpn: 'shotgun', x: -6, z:  0, ammo: 16 },
    { wpn: 'shotgun', x:  6, z:  0, ammo: 16 },
    { wpn: 'ak47',    x:  0, z:  0, ammo: 60 },
    { wpn: 'rpg',     x:  0, z: 15, ammo: 3, y: 0.6 },
  ],
  hill_candidates: [],
};

// ── KOTH HOUSE — indoor with 3 hills ─────────────────────────────
const KOTH_HOUSE = {
  name: 'KOTH HOUSE (Template)',
  mode: 'koth',
  half: 20,
  world: {
    sky:        '#0a0812',
    sun:        { azimuth: 0.4, elevation: Math.PI / 2.5, color: '#ffe0a8', intensity: 0.4 },
    ambient:    { color: '#8a7ca8', intensity: 1.1 },
    hemisphere: { sky_color: '#c8b0f0', ground_color: '#3a2450', intensity: 0.55 },
    fog:        { color: '#0a0812', near: 25, far: 90 },
  },
  objects: [
    // House walls (perimeter).
    { id: t('obj'), x:   0, y: 2.5, z: -18, w: 40, h: 5, d: 0.6, color: '#5a3826', collision: true },
    { id: t('obj'), x:   0, y: 2.5, z:  18, w: 40, h: 5, d: 0.6, color: '#5a3826', collision: true },
    { id: t('obj'), x: -18, y: 2.5, z:   0, w: 0.6, h: 5, d: 36, color: '#5a3826', collision: true },
    { id: t('obj'), x:  18, y: 2.5, z:   0, w: 0.6, h: 5, d: 36, color: '#5a3826', collision: true },
    // Interior dividers making 3 rooms.
    { id: t('obj'), x: -8, y: 1.5, z:  0, w: 0.4, h: 3, d: 12, color: '#3a2416', collision: true },
    { id: t('obj'), x:  8, y: 1.5, z:  0, w: 0.4, h: 3, d: 12, color: '#3a2416', collision: true },
    // Furniture (couches, tables) for cover.
    { id: t('obj'), x: -12, y: 0.5, z:  0, w: 3, h: 1, d: 1.6, color: '#4a2820', collision: true, climbable: true },
    { id: t('obj'), x:  12, y: 0.5, z:  0, w: 3, h: 1, d: 1.6, color: '#4a2820', collision: true, climbable: true },
    { id: t('obj'), x:   0, y: 0.4, z: -8, w: 1.6, h: 0.8, d: 3, color: '#3a2420', collision: true, climbable: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: -12, y: 4, z: 0, color: '#ffb060', intensity: 1.6, radius: 18 },
    { id: t('lt'), type: 'point', x:   0, y: 4, z: 0, color: '#ffd080', intensity: 2.0, radius: 20 },
    { id: t('lt'), type: 'point', x:  12, y: 4, z: 0, color: '#ffb060', intensity: 1.6, radius: 18 },
  ],
  spawns: {
    A: [{ x: -15, z: -15, yaw: 0 }, { x: -15, z: 15, yaw: -Math.PI / 2 }],
    B: [{ x:  15, z:  15, yaw: Math.PI }, { x: 15, z: -15, yaw: Math.PI / 2 }],
  },
  weapon_pickups: [
    { wpn: 'shotgun', x: -12, z:  0, ammo: 16 },
    { wpn: 'shotgun', x:  12, z:  0, ammo: 16 },
    { wpn: 'ak47',    x:   0, z:  0, ammo: 60 },
    { wpn: 'pistol',  x:  -6, z: -8, ammo: 24 },
    { wpn: 'pistol',  x:   6, z:  8, ammo: 24 },
  ],
  hill_candidates: [
    { id: 'kitchen', x: -12, z: 0, y: 0, radius: 4.5, label: 'KITCHEN' },
    { id: 'living',  x:   0, z: 0, y: 0, radius: 4.5, label: 'LIVING ROOM' },
    { id: 'garage',  x:  12, z: 0, y: 0, radius: 4.5, label: 'GARAGE' },
  ],
};

// ── BOARDROOM — corporate KOTH ───────────────────────────────────
const BOARDROOM = {
  name: 'BOARDROOM (Template)',
  mode: 'koth',
  half: 22,
  world: {
    sky:        '#0e141c',
    sun:        { azimuth: 0.2, elevation: Math.PI / 2.8, color: '#e4f0ff', intensity: 0.55 },
    ambient:    { color: '#6a8ab0', intensity: 1.0 },
    hemisphere: { sky_color: '#a0c0f0', ground_color: '#1e2838', intensity: 0.65 },
    fog:        { color: '#0e141c', near: 30, far: 100 },
  },
  objects: [
    // Perimeter walls with a windowed feel (thin, tall).
    { id: t('obj'), x:   0, y: 2, z: -20, w: 44, h: 4, d: 0.4, color: '#3a4858', collision: true, texture: 'facade_office_glass' },
    { id: t('obj'), x:   0, y: 2, z:  20, w: 44, h: 4, d: 0.4, color: '#3a4858', collision: true, texture: 'facade_office_glass' },
    { id: t('obj'), x: -20, y: 2, z:   0, w: 0.4, h: 4, d: 40, color: '#3a4858', collision: true, texture: 'facade_office_glass' },
    { id: t('obj'), x:  20, y: 2, z:   0, w: 0.4, h: 4, d: 40, color: '#3a4858', collision: true, texture: 'facade_office_glass' },
    // Big central boardroom table.
    { id: t('obj'), x: 0, y: 0.5, z: 0, w: 8, h: 1, d: 3, color: '#3a2a20', collision: true, climbable: true },
    // Corner offices (2F platforms).
    { id: t('obj'), x: -14, y: 3, z: -14, w: 8, h: 0.4, d: 8, color: '#4a5868', collision: true, climbable: false },
    { id: t('obj'), x:  14, y: 3, z:  14, w: 8, h: 0.4, d: 8, color: '#4a5868', collision: true, climbable: false },
    // Stairs to the 2F platforms.
    { id: t('obj'), x: -8, y: 0.5, z: -14, w: 4, h: 1, d: 1, color: '#3a4858', collision: true, climbable: true },
    { id: t('obj'), x: -8, y: 1.5, z: -13, w: 4, h: 1, d: 1, color: '#3a4858', collision: true, climbable: true },
    { id: t('obj'), x: -8, y: 2.5, z: -12, w: 4, h: 1, d: 1, color: '#3a4858', collision: true, climbable: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: 0, y: 4.5, z: 0, color: '#e0f0ff', intensity: 2.0, radius: 26 },
    { id: t('lt'), type: 'directional', x: 20, y: 15, z: 10, color: '#ffffff', intensity: 0.5 },
  ],
  spawns: {
    A: [{ x: -17, z: -17, yaw: 0 }, { x: -17, z: 17, yaw: -Math.PI / 2 }],
    B: [{ x:  17, z:  17, yaw: Math.PI }, { x: 17, z: -17, yaw: Math.PI / 2 }],
  },
  weapon_pickups: [
    { wpn: 'ak47',    x: -14, z: -14, ammo: 60, y: 3.4 },
    { wpn: 'ak47',    x:  14, z:  14, ammo: 60, y: 3.4 },
    { wpn: 'shotgun', x:   0, z:  8, ammo: 16 },
    { wpn: 'shotgun', x:   0, z: -8, ammo: 16 },
    { wpn: 'pistol',  x:  -6, z:  0, ammo: 24 },
    { wpn: 'pistol',  x:   6, z:  0, ammo: 24 },
  ],
  hill_candidates: [
    { id: 'table', x:   0, z: 0, y: 0, radius: 5.5, label: 'BOARDROOM TABLE' },
    { id: 'nw_2f', x: -14, z: -14, y: 3.3, radius: 4, label: 'NW OFFICE' },
    { id: 'se_2f', x:  14, z:  14, y: 3.3, radius: 4, label: 'SE OFFICE' },
  ],
};

// ── GRAFFITI ALLEY (mirror of the shipped procedural map) ─────────
const GRAFFITI = {
  name: 'GRAFFITI ALLEY (Template)',
  mode: 'tdm',
  half: 30,
  world: {
    sky:        '#0a0710',
    sun:        { azimuth: 0.7, elevation: Math.PI / 4, color: '#ffd4a0', intensity: 0.6 },
    ambient:    { color: '#8c7ba5', intensity: 0.9 },
    hemisphere: { sky_color: '#a8c3ff', ground_color: '#2b0f30', intensity: 0.55 },
    fog:        { color: '#1a1420', near: 40, far: 130 },
  },
  objects: [
    // 4 corner buildings with rooftops.
    { id: t('obj'), x: -19, y: 3.25, z: -19, w: 12, h: 6.5, d: 12, color: '#4a2c26', collision: true, texture: 'facade_painted_brick' },
    { id: t('obj'), x:  19, y: 3.25, z: -19, w: 12, h: 6.5, d: 12, color: '#352838', collision: true, texture: 'facade_brick_apartments' },
    { id: t('obj'), x: -19, y: 3.25, z:  19, w: 12, h: 6.5, d: 12, color: '#5a2a2a', collision: true, texture: 'facade_dark_brownstone' },
    { id: t('obj'), x:  19, y: 3.25, z:  19, w: 12, h: 6.5, d: 12, color: '#3a3238', collision: true, texture: 'facade_painted_brick' },
    // Dumpsters (cover in the plaza).
    { id: t('obj'), x: -6, y: 0.7, z: -6, w: 2.4, h: 1.4, d: 1.6, color: '#2a4234', collision: true, climbable: true },
    { id: t('obj'), x:  6, y: 0.7, z: -6, w: 2.4, h: 1.4, d: 1.6, color: '#422a34', collision: true, climbable: true },
    { id: t('obj'), x: -6, y: 0.7, z:  6, w: 2.4, h: 1.4, d: 1.6, color: '#2a3442', collision: true, climbable: true },
    { id: t('obj'), x:  6, y: 0.7, z:  6, w: 2.4, h: 1.4, d: 1.6, color: '#424434', collision: true, climbable: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: 0, y: 4.5, z: 0, color: '#ffb060', intensity: 2.2, radius: 40 },
    { id: t('lt'), type: 'point', x: -19, y: 8.5, z: 0, color: '#88a3ff', intensity: 1.4, radius: 32 },
    { id: t('lt'), type: 'point', x:  19, y: 8.5, z: 0, color: '#ff88a3', intensity: 1.4, radius: 32 },
  ],
  spawns: {
    A: [{ x: 0, z: -26, yaw: 0 }, { x: -8, z: -26, yaw: 0 }, { x: 8, z: -26, yaw: 0 }],
    B: [{ x: 0, z:  26, yaw: Math.PI }, { x: -8, z: 26, yaw: Math.PI }, { x: 8, z: 26, yaw: Math.PI }],
  },
  weapon_pickups: [
    { wpn: 'ak47',    x: -19, z: -19, ammo: 60, y: 6.9 },
    { wpn: 'ak47',    x:  19, z:  19, ammo: 60, y: 6.9 },
    { wpn: 'shotgun', x:  -8, z:   0, ammo: 16 },
    { wpn: 'shotgun', x:   8, z:   0, ammo: 16 },
    { wpn: 'pimpslap', x:  0, z:   0, ammo: 1 },
  ],
  hill_candidates: [
    { id: 'plaza',      x:   0, z:  0, y: 0, radius: 5.5, label: 'PLAZA CENTER' },
    { id: 'nw_rooftop', x: -19, z:-19, y: 6.5, radius: 5, label: 'NW ROOFTOP' },
    { id: 'se_rooftop', x:  19, z: 19, y: 6.5, radius: 5, label: 'SE ROOFTOP' },
  ],
};

// ── WAREHOUSE LOBBY (deathmatch-free social room) ────────────────
const WAREHOUSE = {
  name: 'WAREHOUSE LOBBY (Template)',
  mode: 'any',
  half: 25,
  world: {
    sky:        '#181418',
    sun:        { azimuth: 0.3, elevation: Math.PI / 2.5, color: '#fff0d4', intensity: 0.6 },
    ambient:    { color: '#a08890', intensity: 1.0 },
    hemisphere: { sky_color: '#e8d4b8', ground_color: '#2c1e28', intensity: 0.6 },
    fog:        { color: '#181418', near: 30, far: 100 },
  },
  objects: [
    // Walls.
    { id: t('obj'), x:   0, y: 3, z: -25, w: 50, h: 6, d: 0.5, color: '#3a2f28', collision: true, texture: 'warehouse_concrete_floor' },
    { id: t('obj'), x:   0, y: 3, z:  25, w: 50, h: 6, d: 0.5, color: '#3a2f28', collision: true, texture: 'warehouse_concrete_floor' },
    { id: t('obj'), x: -25, y: 3, z:   0, w: 0.5, h: 6, d: 50, color: '#3a2f28', collision: true, texture: 'warehouse_concrete_floor' },
    { id: t('obj'), x:  25, y: 3, z:   0, w: 0.5, h: 6, d: 50, color: '#3a2f28', collision: true, texture: 'warehouse_concrete_floor' },
    // Central crate stack.
    { id: t('obj'), x: 0, y: 1, z: 0, w: 3, h: 2, d: 3, color: '#6a4a30', collision: true, climbable: true },
    { id: t('obj'), x: 5, y: 0.75, z: 0, w: 2, h: 1.5, d: 2, color: '#5a3a24', collision: true, climbable: true },
    { id: t('obj'), x: -5, y: 0.75, z: 0, w: 2, h: 1.5, d: 2, color: '#5a3a24', collision: true, climbable: true },
  ],
  lights: [
    { id: t('lt'), type: 'point', x: 0, y: 5, z: 0, color: '#ffd090', intensity: 1.8, radius: 30 },
  ],
  spawns: {
    A: [{ x: -15, z: 0, yaw: Math.PI / 2 }, { x: -15, z: 5, yaw: Math.PI / 2 }, { x: -15, z: -5, yaw: Math.PI / 2 }],
    B: [{ x:  15, z: 0, yaw: -Math.PI / 2 }, { x: 15, z: 5, yaw: -Math.PI / 2 }, { x: 15, z: -5, yaw: -Math.PI / 2 }],
  },
  weapon_pickups: [],
  hill_candidates: [],
};

// =====================================================================
// Iter 173+ — AAA MULTI-STORY TEMPLATES using procedural buildingGen
// =====================================================================
// These templates leverage `doc.buildings` (procedural walls, floors,
// interior rooms, stairs, catwalks) instead of raw `doc.objects` boxes
// — so players can walk INSIDE, up stairs, between floors, across
// rooftop skyways, and through hospital wings. Every building spec
// mirrors the DEFAULT_BUILDING schema from `buildingGen.js`.
//
// Shared helpers ------------------------------------------------------

let _bid = 100;                                 // reserved range for
const bid = () => `bldg_${_bid++}`;             // template building ids
let _cid = 100;                                 // reserved range for
const cid = () => `cw_${_cid++}`;               // template catwalk ids
let _rnid = 100;
const rnid = () => `rn_${_rnid++}`;             // road nodes
let _reid = 100;
const reid = () => `re_${_reid++}`;             // road edges
let _sid = 100;
const sid = () => `st_${_sid++}`;               // stair sub-ids

// Snapshot the residential building_type preset (with our own tweaks)
// as a pure-data blueprint. We keep DEFAULT_BUILDING baseline fields
// so buildingGen accepts the spec without additional sanitisation.
function residentialHouse(overrides = {}) {
  return {
    id: bid(),
    name: 'House',
    building_type: 'residential',
    x: 0, y: 0, z: 0, yaw: 0,
    stories: 3,                    // ground + 2F + loft/attic
    width: 10, depth: 12,
    story_height: 3.0,             // taller ceilings — was 2.7
    wall_thickness: 0.3,
    has_roof: true, has_parapet: true, parapet_height: 0.9,
    has_interior_floors: true,
    floor_thickness: 0.2,
    has_floor_ledges: true, ledge_depth: 0.18, ledge_thickness: 0.12,
    interior_rooms: {
      rows: 1, cols: 2,             // open floor plan — 2 big rooms/floor
      doorway_width: 1.8,           // was 1.4 — comfortable strafing
      doorway_height: 2.4,          // was 2.1 — no ducking
      half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.4,
      per_story: true,
    },
    exterior_texture: 'facade_brick_apartments',
    interior_texture: 'warehouse_concrete_floor',
    roof_texture: 'asphalt_road',
    exterior_color: '#8a6844',
    interior_color: '#a08c74',
    roof_color: '#2a2a2e',
    openings: {
      N: [{ story: 0, kind: 'door', offset: 0, width: 1.4, height: 2.4 }],   // was 0.9×2.05
      S: [
        { story: 0, kind: 'window', offset: -3, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 0, kind: 'window', offset:  3, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 1, kind: 'window', offset: -3, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 1, kind: 'window', offset:  3, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 2, kind: 'window', offset: -3, width: 1.6, height: 1.4, sill: 1.3 },
        { story: 2, kind: 'window', offset:  3, width: 1.6, height: 1.4, sill: 1.3 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 1, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 2, kind: 'window', offset: 0, width: 1.6, height: 1.4, sill: 1.3 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 1, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 1.0 },
        { story: 2, kind: 'window', offset: 0, width: 1.6, height: 1.4, sill: 1.3 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.6, step_height: 0.16, step_depth: 0.42,     // was 2.4 wide
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
    ...overrides,
  };
}

function officeTower(overrides = {}) {
  return {
    id: bid(),
    name: 'Office Tower',
    building_type: 'office',
    x: 0, y: 0, z: 0, yaw: 0,
    stories: 5,
    width: 12, depth: 12,
    story_height: 3.2,                      // matches catwalk anchor math in OFFICE_COMPLEX
    wall_thickness: 0.3,
    has_roof: true, has_parapet: true, parapet_height: 1.0,
    has_interior_floors: true,
    floor_thickness: 0.2,
    has_floor_ledges: true, ledge_depth: 0.14, ledge_thickness: 0.08,
    interior_rooms: {
      rows: 2, cols: 2,                     // was 3×3 = 9 cramped rooms → 4 spacious ones
      doorway_width: 2.0,                   // was 1.4 — clean strafing
      doorway_height: 2.6,                  // was 2.1
      half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.4,
      per_story: true,
    },
    exterior_texture: 'facade_office_glass',
    interior_texture: 'warehouse_concrete_floor',
    roof_texture: 'asphalt_road',
    exterior_color: '#4a5a70',
    interior_color: '#a8a89e',
    roof_color: '#22262c',
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },   // was 1.2×2.4
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
      ],
      S: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
      ],
      E: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
      ],
      W: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 2.2, sill: 0.8 },
      ],
    },
    stairs: [
      {
        id: sid(), enabled: true, side: 'W',
        width: 2.6, step_height: 0.16, step_depth: 0.42,   // was 2.0 wide
        access_rooftop: true, handrails: true,
        layout: 'switchback', single_run: false,
      },
    ],
    ...overrides,
  };
}

function factoryShed(overrides = {}) {
  return {
    id: bid(),
    name: 'Factory',
    building_type: 'factory',
    x: 0, y: 0, z: 0, yaw: 0,
    stories: 1,
    width: 24, depth: 18,
    story_height: 6.2,
    wall_thickness: 0.3,
    has_roof: true, has_parapet: true, parapet_height: 0.6,
    has_interior_floors: false,
    floor_thickness: 0.2,
    has_floor_ledges: false, ledge_depth: 0.18, ledge_thickness: 0.12,
    interior_rooms: {
      rows: 1, cols: 1,
      doorway_width: 3.0, doorway_height: 3.6,
      half_bath: false, half_bath_corner: 'NE', half_bath_size: 2.4,
      per_story: false,
    },
    exterior_texture: 'industrial_metal_wall',
    interior_texture: 'warehouse_concrete_floor',
    roof_texture: 'sheet_metal_ribbed',
    exterior_color: '#5b6472',
    interior_color: '#7a7a80',
    roof_color: '#3a3f48',
    openings: {
      N: [{ story: 0, kind: 'door',   offset: 0, width: 3.2, height: 3.6 }],
      S: [{ story: 0, kind: 'door',   offset: 0, width: 3.2, height: 3.6 }],
      E: [{ story: 0, kind: 'window', offset: 0, width: 4,   height: 1.8, sill: 3.6 }],
      W: [{ story: 0, kind: 'window', offset: 0, width: 4,   height: 1.8, sill: 3.6 }],
    },
    stairs: [],
    ...overrides,
  };
}

function warehouseSlab(overrides = {}) {
  return {
    id: bid(),
    name: 'Warehouse',
    building_type: 'warehouse',
    x: 0, y: 0, z: 0, yaw: 0,
    stories: 1,
    width: 30, depth: 22,
    story_height: 7.4,
    wall_thickness: 0.3,
    has_roof: true, has_parapet: false, parapet_height: 0.9,
    has_interior_floors: false,
    floor_thickness: 0.2,
    has_floor_ledges: false, ledge_depth: 0.18, ledge_thickness: 0.12,
    interior_rooms: {
      rows: 1, cols: 1,
      doorway_width: 4.0, doorway_height: 4.2,
      half_bath: false, half_bath_corner: 'NE', half_bath_size: 2.4,
      per_story: false,
    },
    exterior_texture: 'industrial_metal_wall',
    interior_texture: 'warehouse_concrete_floor',
    roof_texture: 'sheet_metal_ribbed',
    exterior_color: '#7d5a3a',
    interior_color: '#8a8880',
    roof_color: '#3a3f48',
    openings: {
      N: [{ story: 0, kind: 'door',   offset: 0, width: 5.0, height: 4.5 }],
      S: [{ story: 0, kind: 'door',   offset: 0, width: 5.0, height: 4.5 }],
      E: [{ story: 0, kind: 'window', offset: 0, width: 5.0, height: 1.6, sill: 4.5 }],
      W: [{ story: 0, kind: 'window', offset: 0, width: 5.0, height: 1.6, sill: 4.5 }],
    },
    stairs: [],
    ...overrides,
  };
}

// ── OFFICE COMPLEX — 3 skyscrapers + connecting sky-bridges ──────
//
// Three office towers on the E-W axis, spaced 25m apart. Every
// tower has a switchback stair reaching the roof and is bridged to
// its neighbour at story-2 door + story-3 door via two catwalks —
// creating a "downtown skyline with sky-walks" arena. TDM spawns on
// N/S sides, weapon pickups tucked behind cover in the ground plaza
// AND up on the sky-bridge deck.
const OFFICE_COMPLEX = (() => {
  _bid = 100; _cid = 100; _sid = 100;
  const towerA = officeTower({
    name: 'Tower A', x: -30, y: 0, z: 0, yaw: 0,
    stories: 5,
    // add doors on the E side at stories 1 and 2 for catwalks
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.2, height: 2.4 },
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      S: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      E: [
        { story: 1, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 2, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      W: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
    },
  });
  const towerB = officeTower({
    name: 'Tower B', x: 0, y: 0, z: 0, yaw: 0,
    stories: 6, width: 12, depth: 12,
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.2, height: 2.4 },
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 5, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      S: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 5, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      E: [
        { story: 1, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 2, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 5, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      W: [
        { story: 1, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 2, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 5, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
    },
    exterior_color: '#3a4c66',
    stairs: [{
      id: sid(), enabled: true, side: 'S',
      width: 2.4, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });
  const towerC = officeTower({
    name: 'Tower C', x: 30, y: 0, z: 0, yaw: 0,
    stories: 5,
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.2, height: 2.4 },
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      S: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      E: [
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
      W: [
        { story: 1, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 2, kind: 'door',   offset: 0, width: 1.4, height: 2.4 },
        { story: 3, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.8 },
      ],
    },
    exterior_color: '#5a4a68',
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.4, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });
  // Sky-bridges — story 1 (Y ≈ 3.35) and story 2 (Y ≈ 6.55).
  // Tower spans: A east wall at x = -30 + 6 = -24; B west wall at
  // x = -6; B east wall at x = 6; C west wall at x = 24.
  // ay = story_floor + 0.05 lift; story N floor = N * story_height
  //     with story_height = 3.2. Add 0.05 clearance.
  return {
    name: 'OFFICE COMPLEX (Template)',
    mode: 'tdm',
    half: 80,
    world: worldFromTod('NIGHT'),   // downtown after-hours skyline
    buildings: [towerA, towerB, towerC],
    catwalks: [
      // A → B, story 1
      { id: cid(), name: 'A→B skywalk L1', ax: -24, ay: 3.25, az: 0, bx: -6, by: 3.25, bz: 0,
        width: 2.4, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#7a7a72' },
      // A → B, story 2
      { id: cid(), name: 'A→B skywalk L2', ax: -24, ay: 6.45, az: 0, bx: -6, by: 6.45, bz: 0,
        width: 2.4, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#7a7a72' },
      // B → C, story 1
      { id: cid(), name: 'B→C skywalk L1', ax:  6,  ay: 3.25, az: 0, bx: 24, by: 3.25, bz: 0,
        width: 2.4, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#7a7a72' },
      // B → C, story 2
      { id: cid(), name: 'B→C skywalk L2', ax:  6,  ay: 6.45, az: 0, bx: 24, by: 6.45, bz: 0,
        width: 2.4, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#7a7a72' },
    ],
    objects: [
      // ── Ground plaza planters + benches ───────────────────────
      { id: 'obj_o1', x: -15, y: 0.6, z: -18, w: 3, h: 1.2, d: 3, color: '#3a4a3a', collision: true, climbable: true, texture: 'concrete_sidewalk' },
      { id: 'obj_o2', x:  15, y: 0.6, z: -18, w: 3, h: 1.2, d: 3, color: '#3a4a3a', collision: true, climbable: true, texture: 'concrete_sidewalk' },
      { id: 'obj_o3', x: -15, y: 0.6, z:  18, w: 3, h: 1.2, d: 3, color: '#3a4a3a', collision: true, climbable: true, texture: 'concrete_sidewalk' },
      { id: 'obj_o4', x:  15, y: 0.6, z:  18, w: 3, h: 1.2, d: 3, color: '#3a4a3a', collision: true, climbable: true, texture: 'concrete_sidewalk' },
      { id: 'obj_o5', x: 0, y: 0.4, z: -25, w: 3.2, h: 0.8, d: 0.6, color: '#4a3a24', collision: true, climbable: true },
      { id: 'obj_o6', x: 0, y: 0.4, z:  25, w: 3.2, h: 0.8, d: 0.6, color: '#4a3a24', collision: true, climbable: true },
      // ── Central fountain (plaza centerpiece) ──────────────────
      { id: 'obj_o7', x: 0, y: 0.4, z: 0, w: 5.0, h: 0.8, d: 5.0, color: '#4c5a68', collision: true, climbable: true, texture: 'concrete_sidewalk' },
      { id: 'obj_o8', x: 0, y: 1.1, z: 0, w: 1.6, h: 1.4, d: 1.6, color: '#c8d4e0', collision: true, texture: 'facade_office_glass' },
      // ── Street lamps at plaza corners ─────────────────────────
      { id: 'obj_o9',  x: -18, y: 2.5, z: -28, w: 0.25, h: 5.0, d: 0.25, color: '#28282c', collision: true },
      { id: 'obj_o10', x:  18, y: 2.5, z: -28, w: 0.25, h: 5.0, d: 0.25, color: '#28282c', collision: true },
      { id: 'obj_o11', x: -18, y: 2.5, z:  28, w: 0.25, h: 5.0, d: 0.25, color: '#28282c', collision: true },
      { id: 'obj_o12', x:  18, y: 2.5, z:  28, w: 0.25, h: 5.0, d: 0.25, color: '#28282c', collision: true },
      // ── Tower A rooftop kit (roof deck Y = 16.2m) ─────────────
      { id: 'obj_o13', x: -32, y: 16.95, z: -3, w: 3.0, h: 1.5, d: 2.0, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' }, // AC unit
      { id: 'obj_o14', x: -28, y: 17.45, z:  3, w: 1.6, h: 2.5, d: 1.6, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },  // Water tank
      { id: 'obj_o15', x: -30, y: 16.35, z:  0, w: 1.5, h: 0.3, d: 1.5, color: '#3a3a44', collision: true, climbable: true },  // Satellite dish base
      { id: 'obj_o16', x: -33, y: 16.85, z:  3, w: 0.6, h: 1.2, d: 0.6, color: '#28282c', collision: true },  // Vent stack
      // ── Tower B rooftop kit (roof deck Y = 19.4m) ─────────────
      { id: 'obj_o17', x:  0, y: 20.15, z:  3, w: 3.0, h: 1.5, d: 2.0, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_o18', x:  3, y: 20.65, z: -3, w: 2.0, h: 2.5, d: 2.0, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_o19', x:  0, y: 20.90, z: -3, w: 0.15, h: 3.0, d: 0.15, color: '#c04030', collision: true },  // Radio antenna
      { id: 'obj_o20', x: -3, y: 20.00, z:  0, w: 0.6, h: 1.2, d: 0.6, color: '#28282c', collision: true },
      { id: 'obj_o21', x: -3, y: 19.75, z: -3, w: 1.5, h: 0.5, d: 1.5, color: '#3a3a44', collision: true, climbable: true }, // Skylight
      // ── Tower C rooftop kit (roof deck Y = 16.2m) ─────────────
      { id: 'obj_o22', x: 32, y: 16.95, z:  3, w: 3.0, h: 1.5, d: 2.0, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_o23', x: 28, y: 17.45, z: -3, w: 1.6, h: 2.5, d: 1.6, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_o24', x: 30, y: 16.35, z:  0, w: 1.5, h: 0.3, d: 1.5, color: '#3a3a44', collision: true, climbable: true },
      { id: 'obj_o25', x: 33, y: 16.85, z: -3, w: 0.6, h: 1.2, d: 0.6, color: '#28282c', collision: true },
    ],
    lights: [
      { id: 'lt_o1', type: 'point', x: -30, y: 20, z: 0, color: '#e0f0ff', intensity: 2.4, radius: 45 },
      { id: 'lt_o2', type: 'point', x:   0, y: 24, z: 0, color: '#ffe0c0', intensity: 2.8, radius: 55 },
      { id: 'lt_o3', type: 'point', x:  30, y: 20, z: 0, color: '#e0f0ff', intensity: 2.4, radius: 45 },
      // Plaza street-lamp point lights
      { id: 'lt_o4', type: 'point', x: -18, y: 5.2, z: -28, color: '#ffd090', intensity: 1.6, radius: 22 },
      { id: 'lt_o5', type: 'point', x:  18, y: 5.2, z: -28, color: '#ffd090', intensity: 1.6, radius: 22 },
      { id: 'lt_o6', type: 'point', x: -18, y: 5.2, z:  28, color: '#ffd090', intensity: 1.6, radius: 22 },
      { id: 'lt_o7', type: 'point', x:  18, y: 5.2, z:  28, color: '#ffd090', intensity: 1.6, radius: 22 },
      // Tower B rooftop radio blinker
      { id: 'lt_o8', type: 'point', x:  0, y: 22.4, z: -3, color: '#ff2020', intensity: 1.6, radius: 12 },
    ],
    spawns: {
      A: [
        { x: -30, z: -35, yaw: 0 }, { x: 0, z: -35, yaw: 0 }, { x: 30, z: -35, yaw: 0 },
      ],
      B: [
        { x: -30, z:  35, yaw: Math.PI }, { x: 0, z: 35, yaw: Math.PI }, { x: 30, z: 35, yaw: Math.PI },
      ],
    },
    weapon_pickups: [
      { wpn: 'ak47',     x:   0, z: -30, ammo: 60 },
      { wpn: 'ak47',     x:   0, z:  30, ammo: 60 },
      { wpn: 'shotgun',  x: -30, z:   0, ammo: 16, y: 3.55 },   // on tower A story-1 bridge landing
      { wpn: 'shotgun',  x:  30, z:   0, ammo: 16, y: 3.55 },
      { wpn: 'pistol',   x: -15, z: -15, ammo: 24 },
      { wpn: 'pistol',   x:  15, z:  15, ammo: 24 },
      { wpn: 'rpg',      x:   0, z:   0, ammo: 3,  y: 6.85 },   // top skyway
      { wpn: 'pimpslap', x:   0, z:  -5, ammo: 1 },
    ],
    hill_candidates: [
      { id: 'plaza',    x:   0, z:  0, y: 0,    radius: 5,   label: 'PLAZA FOUNTAIN' },
      { id: 'a_roof',   x: -30, z:  0, y: 16.5, radius: 4.5, label: 'TOWER A ROOFTOP' },
      { id: 'b_roof',   x:   0, z:  0, y: 19.7, radius: 4.5, label: 'TOWER B ROOFTOP' },
      { id: 'c_roof',   x:  30, z:  0, y: 16.5, radius: 4.5, label: 'TOWER C ROOFTOP' },
    ],
    roads: { nodes: [], edges: [] },
  };
})();

// ── CITY HOSPITAL — big main building with wings + rooms ─────────
//
// Central 4-story hospital block (30x22, 3x4 rooms per floor, per-story
// so every floor has its own ward layout). Two side wings on E/W —
// smaller 2-story residential-typed clinics. A single-story warehouse
// slab plays "morgue / receiving dock" on the S side. Entry via
// front doors on the N side facing a small road.
const CITY_HOSPITAL = (() => {
  _bid = 200; _cid = 200; _sid = 200;
  const main = residentialHouse({
    name: 'Main Hospital', building_type: 'residential',
    x: 0, y: 0, z: 0, yaw: 0,
    stories: 4, width: 30, depth: 22,
    story_height: 3.4,
    has_parapet: true, parapet_height: 1.1,
    exterior_texture: 'facade_office_glass',
    exterior_color: '#c8ccd4',
    interior_color: '#dcdce0',
    roof_color: '#3a3a44',
    interior_rooms: {
      rows: 2, cols: 3,                 // 6 big wards per floor — was 3×4 crammed
      doorway_width: 2.2,               // was 1.6 — hospital gurneys fit through
      doorway_height: 2.8,              // was 2.2
      half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.6,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door', offset: -6, width: 2.4, height: 3.0 },     // main lobby — was 1.6×2.6
        { story: 0, kind: 'door', offset:  6, width: 2.4, height: 3.0 },     // ER entrance
        { story: 1, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset:  -3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset:   3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset:  -3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset:   3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset:  -3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset:   3, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 0, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset:   0, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset:   0, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 2, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset: -10, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset:   0, width: 3.2, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset:  10, width: 3.2, height: 1.8, sill: 0.9 },
      ],
      E: [
        { story: 0, kind: 'door',   offset: 0, width: 2.0, height: 2.8 },       // was 1.4×2.4
        { story: 1, kind: 'door',   offset: 0, width: 2.0, height: 2.8 },
        { story: 2, kind: 'window', offset: 0, width: 3.6, height: 1.8, sill: 0.9 },
        { story: 3, kind: 'window', offset: 0, width: 3.6, height: 1.8, sill: 0.9 },
      ],
      W: [
        { story: 0, kind: 'door',   offset: 0, width: 2.0, height: 2.8 },
        { story: 1, kind: 'door',   offset: 0, width: 2.0, height: 2.8 },
        { story: 2, kind: 'window', offset: 0, width: 3.0, height: 1.4, sill: 1.0 },
        { story: 3, kind: 'window', offset: 0, width: 3.0, height: 1.4, sill: 1.0 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'S',
      width: 2.8, step_height: 0.16, step_depth: 0.42,       // was 2.4 wide
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });
  const westWing = residentialHouse({
    name: 'West Wing', x: -26, y: 0, z: 0, yaw: 0,
    stories: 2, width: 12, depth: 16,
    story_height: 3.0,
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#b0b8bc',
    interior_color: '#dcdce0',
    interior_rooms: {
      rows: 2, cols: 2, doorway_width: 1.8, doorway_height: 2.4,
      half_bath: true, half_bath_corner: 'NW', half_bath_size: 2.4,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
      ],
      E: [
        { story: 0, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
        { story: 1, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 2.0, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.0, height: 1.6, sill: 0.9 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'W',
      width: 2.4, step_height: 0.16, step_depth: 0.42,      // was 2.0 wide
      access_rooftop: true, handrails: true,          // WING roof access
      layout: 'switchback', single_run: false,
    }],
  });
  const eastWing = residentialHouse({
    name: 'East Wing', x: 26, y: 0, z: 0, yaw: 0,
    stories: 2, width: 12, depth: 16,
    story_height: 3.0,
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#b0b8bc',
    interior_color: '#dcdce0',
    interior_rooms: {
      rows: 2, cols: 2, doorway_width: 1.8, doorway_height: 2.4,
      half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.4,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
      ],
      W: [
        { story: 0, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
        { story: 1, kind: 'door',   offset: 0, width: 1.8, height: 2.8 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 2.0, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.0, height: 1.6, sill: 0.9 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.4, step_height: 0.16, step_depth: 0.42,      // was 2.0 wide
      access_rooftop: true, handrails: true,          // WING roof access
      layout: 'switchback', single_run: false,
    }],
  });
  const morgue = warehouseSlab({
    name: 'Morgue / Receiving Dock',
    x: 0, y: 0, z: 30, yaw: 0,
    stories: 1, width: 22, depth: 12,
    story_height: 4.2,
  });
  return {
    name: 'CITY HOSPITAL (Template)',
    mode: 'tdm',
    half: 80,
    world: worldFromTod('SUNSET'),   // ER shift-change at dusk
    buildings: [main, westWing, eastWing, morgue],
    catwalks: [
      // West wing story-1 door → Main hospital west door
      { id: cid(), name: 'W wing → Main L1', ax: -20, ay: 3.05, az: 0, bx: -15, by: 3.45, bz: 0,
        width: 2.0, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#a09082' },
      // East wing story-1 door → Main hospital east door
      { id: cid(), name: 'E wing → Main L1', ax:  20, ay: 3.05, az: 0, bx:  15, by: 3.45, bz: 0,
        width: 2.0, handrails: true, supports: true, texture: 'concrete_sidewalk', color: '#a09082' },
    ],
    objects: [
      // ── Front driveway ambulance pad + canopy ─────────────────
      { id: 'obj_h1', x: 0, y: 0.06, z: -15, w: 20, h: 0.12, d: 8, color: '#28282a', collision: false, texture: 'asphalt_road' },
      // Emergency bay bollards
      { id: 'obj_h2', x: -8, y: 0.5, z: -12, w: 0.6, h: 1.0, d: 0.6, color: '#e0e0e0', collision: true },
      { id: 'obj_h3', x:  8, y: 0.5, z: -12, w: 0.6, h: 1.0, d: 0.6, color: '#e0e0e0', collision: true },
      // Ambulance parked (visual)
      { id: 'obj_h4', x: -6, y: 1.1, z: -14, w: 5.0, h: 2.2, d: 2.4, color: '#f4f4f4', collision: true, climbable: true, texture: 'facade_office_glass' },
      // Ambulance canopy overhang (climbable partial roof)
      { id: 'obj_h5', x: 0, y: 4.2, z: -14, w: 22, h: 0.25, d: 8, color: '#c8ccd4', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_h6', x: -10, y: 2.1, z: -11, w: 0.4, h: 4.2, d: 0.4, color: '#3a3a44', collision: true }, // pillar
      { id: 'obj_h7', x:  10, y: 2.1, z: -11, w: 0.4, h: 4.2, d: 0.4, color: '#3a3a44', collision: true },
      { id: 'obj_h8', x: -10, y: 2.1, z: -17, w: 0.4, h: 4.2, d: 0.4, color: '#3a3a44', collision: true },
      { id: 'obj_h9', x:  10, y: 2.1, z: -17, w: 0.4, h: 4.2, d: 0.4, color: '#3a3a44', collision: true },

      // ── Main hospital rooftop (Y = 13.8m) — helipad complex ───
      // Yellow "H" landing pad marker
      { id: 'obj_h10', x: 0, y: 14.05, z: 3, w: 8, h: 0.05, d: 8, color: '#f4d000', collision: false },
      // Helipad edge lights (4 corners, red)
      { id: 'obj_h11', x: -4, y: 14.15, z:  7, w: 0.3, h: 0.4, d: 0.3, color: '#ff2020', collision: true },
      { id: 'obj_h12', x:  4, y: 14.15, z:  7, w: 0.3, h: 0.4, d: 0.3, color: '#ff2020', collision: true },
      { id: 'obj_h13', x: -4, y: 14.15, z: -1, w: 0.3, h: 0.4, d: 0.3, color: '#ff2020', collision: true },
      { id: 'obj_h14', x:  4, y: 14.15, z: -1, w: 0.3, h: 0.4, d: 0.3, color: '#ff2020', collision: true },
      // Rooftop utilities on N half of the main roof
      { id: 'obj_h15', x: -10, y: 14.7,  z: -8, w: 4, h: 1.6, d: 2.5, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },  // AC bank
      { id: 'obj_h16', x:  10, y: 14.7,  z: -8, w: 4, h: 1.6, d: 2.5, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_h17', x: -12, y: 15.3,  z:  6, w: 1.8, h: 2.8, d: 1.8, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' }, // Water tank
      { id: 'obj_h18', x:  12, y: 15.3,  z:  6, w: 1.8, h: 2.8, d: 1.8, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      // Radio antenna (rooftop centerpiece)
      { id: 'obj_h19', x: -6, y: 16.3,  z:  0, w: 0.2, h: 5.0, d: 0.2, color: '#c04030', collision: true },
      { id: 'obj_h20', x:  6, y: 16.3,  z:  0, w: 0.2, h: 5.0, d: 0.2, color: '#c04030', collision: true },
      // Rooftop skylight
      { id: 'obj_h21', x: 0, y: 14.15, z: -6, w: 3, h: 0.3, d: 3, color: '#8ac4f0', collision: true, texture: 'facade_office_glass' },

      // ── West Wing rooftop (Y = 6.2m) ──────────────────────────
      { id: 'obj_h22', x: -26, y: 7.1, z:  4, w: 3, h: 1.4, d: 2, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_h23', x: -28, y: 7.5, z: -4, w: 1.4, h: 2.2, d: 1.4, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },

      // ── East Wing rooftop (Y = 6.2m) ──────────────────────────
      { id: 'obj_h24', x:  26, y: 7.1, z: -4, w: 3, h: 1.4, d: 2, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_h25', x:  28, y: 7.5, z:  4, w: 1.4, h: 2.2, d: 1.4, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      // Solar panels
      { id: 'obj_h26', x:  24, y: 6.4, z:  0, w: 4, h: 0.15, d: 4, color: '#101828', collision: true, climbable: true, texture: 'facade_office_glass' },

      // ── Morgue rooftop (Y = 4.4m) — vent shafts ───────────────
      { id: 'obj_h27', x: -6, y: 5.4, z:  30, w: 1.6, h: 2.0, d: 1.6, color: '#8a8880', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_h28', x:  6, y: 5.4, z:  30, w: 1.6, h: 2.0, d: 1.6, color: '#8a8880', collision: true, climbable: true, texture: 'industrial_metal_wall' },

      // ── Ground-floor cover: hedge planters + benches ──────────
      { id: 'obj_h29', x: -18, y: 0.5, z: -8, w: 3, h: 1.0, d: 1, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_h30', x:  18, y: 0.5, z: -8, w: 3, h: 1.0, d: 1, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_h31', x: -18, y: 0.5, z:  8, w: 3, h: 1.0, d: 1, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_h32', x:  18, y: 0.5, z:  8, w: 3, h: 1.0, d: 1, color: '#2a4a2a', collision: true, climbable: true },
    ],
    lights: [
      { id: 'lt_h1', type: 'point', x:   0, y: 6, z: -14, color: '#ff4030', intensity: 2.4, radius: 20 },  // red ambulance pulse
      { id: 'lt_h2', type: 'point', x:   0, y: 12, z: 0,  color: '#e0f0ff', intensity: 2.6, radius: 40 },  // main roof light
      { id: 'lt_h3', type: 'point', x: -20, y: 6, z: 0,   color: '#ffd0a0', intensity: 1.6, radius: 22 },
      { id: 'lt_h4', type: 'point', x:  20, y: 6, z: 0,   color: '#ffd0a0', intensity: 1.6, radius: 22 },
      // Helipad landing lights
      { id: 'lt_h5', type: 'point', x:   0, y: 14.4, z: 3, color: '#fff5a0', intensity: 2.4, radius: 14 },
      // Antenna blinker
      { id: 'lt_h6', type: 'point', x:   0, y: 21, z: 0, color: '#ff2020', intensity: 1.5, radius: 10 },
      // Rooftop side lights on the wings
      { id: 'lt_h7', type: 'point', x: -26, y: 8, z: 0, color: '#e0f0ff', intensity: 1.4, radius: 16 },
      { id: 'lt_h8', type: 'point', x:  26, y: 8, z: 0, color: '#e0f0ff', intensity: 1.4, radius: 16 },
    ],
    spawns: {
      A: [
        { x: -30, z: -30, yaw: Math.PI / 3 }, { x: 0, z: -32, yaw: 0 }, { x: 30, z: -30, yaw: -Math.PI / 3 },
      ],
      B: [
        { x: -30, z:  40, yaw: -2 * Math.PI / 3 }, { x: 0, z: 42, yaw: Math.PI }, { x: 30, z: 40, yaw: 2 * Math.PI / 3 },
      ],
    },
    weapon_pickups: [
      { wpn: 'ak47',     x:   0, z: -25, ammo: 60 },
      { wpn: 'ak47',     x:   0, z:  25, ammo: 60 },
      { wpn: 'shotgun',  x: -14, z:   0, ammo: 16 },
      { wpn: 'shotgun',  x:  14, z:   0, ammo: 16 },
      { wpn: 'pistol',   x:  -8, z:  -8, ammo: 24 },
      { wpn: 'pistol',   x:   8, z:   8, ammo: 24 },
      { wpn: 'rpg',      x:   0, z:   0, ammo: 3, y: 14.6 },   // rooftop helipad
      { wpn: 'pimpslap', x: -20, z:   0, ammo: 1 },
    ],
    hill_candidates: [
      { id: 'lobby',      x:   0, z: -6,  y: 0,    radius: 5,   label: 'HOSPITAL LOBBY' },
      { id: 'helipad',    x:   0, z:  3,  y: 14,   radius: 4.5, label: 'HELIPAD' },
      { id: 'main_roof',  x:   0, z: -8,  y: 14,   radius: 5,   label: 'MAIN ROOF' },
      { id: 'w_wing_r',   x: -26, z:  0,  y: 6.3,  radius: 4,   label: 'WEST WING ROOF' },
      { id: 'e_wing_r',   x:  26, z:  0,  y: 6.3,  radius: 4,   label: 'EAST WING ROOF' },
      { id: 'morgue',     x:   0, z: 30,  y: 0,    radius: 5,   label: 'MORGUE DOCK' },
    ],
    roads: { nodes: [], edges: [] },
  };
})();

// ── INDUSTRIAL DISTRICT — factories + warehouse + road network ───
//
// Two factory sheds and one warehouse arranged around a connecting
// L-shaped road with driveways to each entrance. Great for
// mid-range firefights with lots of long sightlines and heavy
// industrial cover objects.
const INDUSTRIAL_DISTRICT = (() => {
  _bid = 300; _cid = 300; _sid = 300; _rnid = 300; _reid = 300;
  const factoryA = factoryShed({
    name: 'Factory A', x: -22, y: 0, z: -18, yaw: 0,
    stories: 1, width: 22, depth: 16,
    story_height: 6.0,
    // Add roof-access emergency stair on outer (W) side.
    stairs: [{
      id: sid(), enabled: true, side: 'W',
      width: 2.0, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'straight', single_run: true,
    }],
  });
  const factoryB = factoryShed({
    name: 'Factory B', x:  22, y: 0, z: -18, yaw: 0,
    stories: 1, width: 22, depth: 16,
    story_height: 6.0,
    exterior_color: '#5b7268',
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.0, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'straight', single_run: true,
    }],
  });
  const warehouseMain = warehouseSlab({
    name: 'Warehouse', x: 0, y: 0, z: 22, yaw: 0,
    stories: 1, width: 32, depth: 22,
    story_height: 7.0,
    stairs: [{
      id: sid(), enabled: true, side: 'W',
      width: 2.0, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'straight', single_run: true,
    }],
  });
  // Small 2-story office / break-room between the two factories.
  const breakRoom = residentialHouse({
    name: 'Break Room', x: 0, y: 0, z: -18, yaw: 0,
    stories: 2, width: 12, depth: 10, story_height: 3.2,
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#8a5044',
    interior_color: '#c8a888',
    roof_color: '#2a2a2e',
    interior_rooms: {
      rows: 1, cols: 2, doorway_width: 1.8, doorway_height: 2.4,  // open 2-room plan
      half_bath: true, half_bath_corner: 'SW', half_bath_size: 2.4,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.6, height: 2.6 },   // was 1.0×2.2
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.6, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'window', offset: -3, width: 1.6, height: 1.6, sill: 0.9 },
        { story: 0, kind: 'window', offset:  3, width: 1.6, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: -3, width: 1.6, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset:  3, width: 1.6, height: 1.6, sill: 0.9 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 0.9 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 1.6, height: 1.6, sill: 0.9 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.0, step_height: 0.16, step_depth: 0.42,     // was 1.6 — comfortably passable
      access_rooftop: true, handrails: true,
      layout: 'straight', single_run: true,
    }],
  });
  // Road nodes for an H-shape connector.
  const nA = { id: rnid(), x: -22, z:  4, y: 0 };  // south of factory A
  const nB = { id: rnid(), x:  22, z:  4, y: 0 };  // south of factory B
  const nC = { id: rnid(), x: -22, z: 12, y: 0 };  // dock A
  const nD = { id: rnid(), x:  22, z: 12, y: 0 };  // dock B
  const nE = { id: rnid(), x: -22, z: -8, y: 0 };  // factory A north dock
  const nF = { id: rnid(), x:  22, z: -8, y: 0 };  // factory B north dock
  const nG = { id: rnid(), x:   0, z:  4, y: 0 };  // T intersection
  const nH = { id: rnid(), x:   0, z: 12, y: 0 };  // warehouse dock
  const roadPreset = {
    road_width: 9, lanes: 2, lane_width: 4.5, sidewalk_width: 1.8, curb_height: 0.15,
    asphalt_color: '#28282a', sidewalk_color: '#7a7a72',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  };
  const drivePreset = {
    road_width: 3.0, lanes: 1, lane_width: 3.0, sidewalk_width: 0, curb_height: 0.06,
    asphalt_color: '#3a382f', sidewalk_color: '#000000',
    asphalt_texture: 'concrete_sidewalk', sidewalk_texture: '',
  };
  return {
    name: 'INDUSTRIAL DISTRICT (Template)',
    mode: 'tdm',
    half: 90,
    world: worldFromTod('GOLDEN'),   // late-afternoon factory glow
    buildings: [factoryA, factoryB, warehouseMain, breakRoom],
    catwalks: [
      // Rooftop catwalk connecting the two factory roofs (Y ≈ 6.3)
      { id: cid(), name: 'A→B roof pipe walkway', ax: -22, ay: 6.35, az: -18, bx: 22, by: 6.35, bz: -18,
        width: 1.6, handrails: true, supports: false, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
      // Catwalk from break-room roof to factory A roof (Y ≈ 6.2 both)
      { id: cid(), name: 'BR→A skywalk', ax: -6, ay: 6.25, az: -18, bx: -11, by: 6.35, bz: -18,
        width: 1.4, handrails: true, supports: true, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
      // Catwalk from break-room roof to factory B roof
      { id: cid(), name: 'BR→B skywalk', ax:  6, ay: 6.25, az: -18, bx:  11, by: 6.35, bz: -18,
        width: 1.4, handrails: true, supports: true, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
    ],
    objects: [
      // ── Central plaza cover — crates, dumpsters, drums ────────
      { id: 'obj_i1', x: -8, y: 1.0, z: 6, w: 2.4, h: 2.0, d: 2.4, color: '#5a3a24', collision: true, climbable: true },
      { id: 'obj_i2', x:  8, y: 1.0, z: 6, w: 2.4, h: 2.0, d: 2.4, color: '#5a3a24', collision: true, climbable: true },
      { id: 'obj_i3', x: -8, y: 1.0, z: -8, w: 2.4, h: 2.0, d: 2.4, color: '#4a2c1a', collision: true, climbable: true },
      { id: 'obj_i4', x:  8, y: 1.0, z: -8, w: 2.4, h: 2.0, d: 2.4, color: '#4a2c1a', collision: true, climbable: true },
      { id: 'obj_i5', x: 0, y: 0.7, z: -2, w: 12, h: 1.4, d: 0.6, color: '#3a3a44', collision: true, climbable: true },
      { id: 'obj_i6', x:-14, y: 0.55, z: 14, w: 1.1, h: 1.1, d: 1.1, color: '#c04030', collision: true },
      { id: 'obj_i7', x:-12, y: 0.55, z: 14, w: 1.1, h: 1.1, d: 1.1, color: '#c04030', collision: true },
      { id: 'obj_i8', x: 12, y: 0.55, z: 14, w: 1.1, h: 1.1, d: 1.1, color: '#c04030', collision: true },
      { id: 'obj_i9', x: 14, y: 0.55, z: 14, w: 1.1, h: 1.1, d: 1.1, color: '#c04030', collision: true },
      // ── Loading dock ramps (angled, low grades) ──────────────
      { id: 'obj_i10', x: -22, y: 0.4, z: -8, w: 4, h: 0.8, d: 3, color: '#3a3a44', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i11', x:  22, y: 0.4, z: -8, w: 4, h: 0.8, d: 3, color: '#3a3a44', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i12', x:   0, y: 0.4, z: 10, w: 6, h: 0.8, d: 3, color: '#3a3a44', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      // ── Factory A rooftop kit (Y = 6.2m) ─────────────────────
      { id: 'obj_i13', x: -22, y: 10.4, z: -22, w: 1.5, h: 8.0, d: 1.5, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' }, // Smokestack A
      { id: 'obj_i14', x: -30, y: 6.9,  z: -14, w: 2.6, h: 1.4, d: 2, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' }, // Roof AC A
      { id: 'obj_i15', x: -18, y: 7.1,  z: -20, w: 1.4, h: 1.8, d: 1.4, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' }, // Water tank A
      { id: 'obj_i16', x: -22, y: 6.8,  z: -14, w: 0.8, h: 1.2, d: 0.8, color: '#28282c', collision: true }, // Vent A
      // ── Factory B rooftop kit ────────────────────────────────
      { id: 'obj_i17', x:  22, y: 10.4, z: -22, w: 1.5, h: 8.0, d: 1.5, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' }, // Smokestack B
      { id: 'obj_i18', x:  30, y: 6.9,  z: -14, w: 2.6, h: 1.4, d: 2, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i19', x:  18, y: 7.1,  z: -20, w: 1.4, h: 1.8, d: 1.4, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_i20', x:  22, y: 6.8,  z: -14, w: 0.8, h: 1.2, d: 0.8, color: '#28282c', collision: true },
      // ── Warehouse rooftop kit (Y = 7.2m) ─────────────────────
      { id: 'obj_i21', x: -10, y: 8.1, z: 22, w: 4, h: 1.6, d: 2.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i22', x:  10, y: 8.1, z: 22, w: 4, h: 1.6, d: 2.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i23', x:   0, y: 8.6, z: 28, w: 2.6, h: 2.6, d: 2.6, color: '#5a5560', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_i24', x:   0, y: 10.6, z: 22, w: 0.2, h: 5.0, d: 0.2, color: '#c04030', collision: true }, // Antenna
      // ── Grain silos next to the warehouse (E side) ────────────
      { id: 'obj_i25', x:  22, y: 5.0, z: 22, w: 3.6, h: 10.0, d: 3.6, color: '#c8b090', collision: true, texture: 'industrial_metal_wall' },
      { id: 'obj_i26', x:  26, y: 5.0, z: 26, w: 3.6, h: 10.0, d: 3.6, color: '#c8b090', collision: true, texture: 'industrial_metal_wall' },
      // ── Industrial pipes between factories (visual, thin cylinders) ──
      { id: 'obj_i27', x:   0, y: 3.5, z: -25, w: 44, h: 0.3, d: 0.3, color: '#8a5030', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      { id: 'obj_i28', x:   0, y: 3.9, z: -25, w: 44, h: 0.3, d: 0.3, color: '#8a5030', collision: true, climbable: true, texture: 'industrial_metal_wall' },
      // ── Yard forklifts / small cargo (climbable cover) ───────
      { id: 'obj_i29', x: -14, y: 0.8, z:  0, w: 3.0, h: 1.6, d: 1.4, color: '#c0a030', collision: true, climbable: true },
      { id: 'obj_i30', x:  14, y: 0.8, z:  0, w: 3.0, h: 1.6, d: 1.4, color: '#c0a030', collision: true, climbable: true },
      // ── Chain-link fence perimeter (S side, gate at centre) ──
      { id: 'obj_i31', x: -22, y: 1.5, z: 28, w: 20, h: 3.0, d: 0.15, color: '#606060', collision: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_i32', x:  22, y: 1.5, z: 28, w: 20, h: 3.0, d: 0.15, color: '#606060', collision: true, texture: 'sheet_metal_ribbed' },
    ],
    lights: [
      { id: 'lt_i1', type: 'point', x: -22, y: 7, z: -18, color: '#ff9060', intensity: 1.9, radius: 32 },
      { id: 'lt_i2', type: 'point', x:  22, y: 7, z: -18, color: '#ff9060', intensity: 1.9, radius: 32 },
      { id: 'lt_i3', type: 'point', x:   0, y: 8, z:  22, color: '#ffd090', intensity: 2.4, radius: 42 },
      { id: 'lt_i4', type: 'point', x:   0, y: 4, z:   0, color: '#e8b060', intensity: 1.5, radius: 24 },
      // Smokestack blinkers
      { id: 'lt_i5', type: 'point', x: -22, y: 14.5, z: -22, color: '#ff2020', intensity: 1.5, radius: 12 },
      { id: 'lt_i6', type: 'point', x:  22, y: 14.5, z: -22, color: '#ff2020', intensity: 1.5, radius: 12 },
      // Warehouse antenna blinker
      { id: 'lt_i7', type: 'point', x:   0, y: 13.5, z:  22, color: '#ff2020', intensity: 1.4, radius: 10 },
      // Break-room warm interior glow
      { id: 'lt_i8', type: 'point', x:   0, y: 4.5, z: -18, color: '#ffcf80', intensity: 1.4, radius: 14 },
    ],
    spawns: {
      A: [
        { x: -30, z: -28, yaw: Math.PI / 4 }, { x: -22, z: -30, yaw: 0 }, { x: -14, z: -28, yaw: -Math.PI / 4 },
      ],
      B: [
        { x:  14, z: -28, yaw: Math.PI / 4 }, { x:  22, z: -30, yaw: 0 }, { x:  30, z: -28, yaw: -Math.PI / 4 },
      ],
    },
    weapon_pickups: [
      { wpn: 'ak47',     x: -22, z:   0, ammo: 60 },
      { wpn: 'ak47',     x:  22, z:   0, ammo: 60 },
      { wpn: 'shotgun',  x:   0, z:  -8, ammo: 16 },
      { wpn: 'shotgun',  x:   0, z:  22, ammo: 16 },
      { wpn: 'pistol',   x: -10, z:   4, ammo: 24 },
      { wpn: 'pistol',   x:  10, z:   4, ammo: 24 },
      { wpn: 'rpg',      x:   0, z:   4, ammo: 3 },
      { wpn: 'rpg',      x:   0, z:  22, ammo: 3, y: 7.6 },   // warehouse rooftop
      { wpn: 'ak47',     x: -22, z: -18, ammo: 60, y: 6.6 },   // factory A rooftop
      { wpn: 'ak47',     x:  22, z: -18, ammo: 60, y: 6.6 },   // factory B rooftop
      { wpn: 'pimpslap', x:   0, z:  22, ammo: 1 },
    ],
    hill_candidates: [
      { id: 'yard',    x:   0, z:  4, y: 0,    radius: 6,   label: 'CENTRAL YARD' },
      { id: 'dockA',   x: -22, z: 12, y: 0,    radius: 4,   label: 'DOCK A' },
      { id: 'dockB',   x:  22, z: 12, y: 0,    radius: 4,   label: 'DOCK B' },
      { id: 'roofA',   x: -22, z:-18, y: 6.4,  radius: 5,   label: 'FACTORY A ROOF' },
      { id: 'roofB',   x:  22, z:-18, y: 6.4,  radius: 5,   label: 'FACTORY B ROOF' },
      { id: 'wh_roof', x:   0, z: 22, y: 7.4,  radius: 6,   label: 'WAREHOUSE ROOF' },
      { id: 'br_roof', x:   0, z:-18, y: 6.4,  radius: 3.5, label: 'BREAK ROOM ROOF' },
    ],
    roads: {
      nodes: [nA, nB, nC, nD, nE, nF, nG, nH],
      edges: [
        // East-west main road (through the yard)
        { id: reid(), a: nA.id, b: nG.id, type: 'industrial', ...roadPreset },
        { id: reid(), a: nG.id, b: nB.id, type: 'industrial', ...roadPreset },
        // Driveways up to each dock/entrance
        { id: reid(), a: nA.id, b: nE.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nB.id, b: nF.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nA.id, b: nC.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nB.id, b: nD.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nG.id, b: nH.id, type: 'industrial', ...roadPreset },
      ],
    },
  };
})();

// ── SUBURBAN NEIGHBORHOOD — grid of houses with roads + sidewalks ─
//
// 6 residential houses arranged in two rows of three, separated by a
// through-street with sidewalks. Each row of houses faces the street.
// Perfect large-scale TDM arena with hard cover (houses), soft cover
// (parked cars / mailboxes), and destructible windows.
const SUBURBAN_NEIGHBORHOOD = (() => {
  _bid = 400; _cid = 400; _sid = 400; _rnid = 400; _reid = 400;
  // North row (behind the street, facing south → yaw = Math.PI so N wall points -Z)
  // 3-story houses (ground + 2F + loft) with rooftop access via the helper.
  const houseN1 = residentialHouse({
    name: 'N1 House', x: -30, y: 0, z: 20, yaw: Math.PI,
    exterior_color: '#8a6844',
  });
  const houseN2 = residentialHouse({
    name: 'N2 House', x:   0, y: 0, z: 20, yaw: Math.PI,
    exterior_color: '#a06844',
    exterior_texture: 'facade_dark_brownstone',
  });
  const houseN3 = residentialHouse({
    name: 'N3 House', x:  30, y: 0, z: 20, yaw: Math.PI,
    exterior_color: '#68704a',
    exterior_texture: 'facade_painted_brick',
  });
  // South row (facing north → yaw = 0 so N wall points +Z which is the street side)
  const houseS1 = residentialHouse({
    name: 'S1 House', x: -30, y: 0, z: -20, yaw: 0,
    exterior_color: '#7a5a3a',
    exterior_texture: 'facade_painted_brick',
  });
  const houseS2 = residentialHouse({
    name: 'S2 House', x:   0, y: 0, z: -20, yaw: 0,
    exterior_color: '#4a3868',
    exterior_texture: 'facade_dark_brownstone',
  });
  const houseS3 = residentialHouse({
    name: 'S3 House', x:  30, y: 0, z: -20, yaw: 0,
    exterior_color: '#5a5a5a',
  });
  // Small MINI-MART / gas station at west cul-de-sac.
  const miniMart = residentialHouse({
    name: 'Mini-Mart', x: -50, y: 0, z: 20, yaw: Math.PI,
    stories: 1, width: 12, depth: 10, story_height: 3.6,        // taller ceiling; wider footprint
    exterior_texture: 'facade_office_glass',
    exterior_color: '#e8b060',
    interior_color: '#f4e0b8',
    roof_color: '#c04030',
    has_parapet: true, parapet_height: 0.8,
    interior_rooms: {
      rows: 1, cols: 1, doorway_width: 2.0, doorway_height: 2.6,   // open single room
      half_bath: false, half_bath_corner: 'NE', half_bath_size: 2.0,
      per_story: false,
    },
    openings: {
      N: [{ story: 0, kind: 'door', offset: 0, width: 2.4, height: 2.8 }],    // was 1.8×2.4
      S: [
        { story: 0, kind: 'window', offset: -3, width: 2.0, height: 1.8, sill: 0.9 },
        { story: 0, kind: 'window', offset:  3, width: 2.0, height: 1.8, sill: 0.9 },
      ],
      E: [{ story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 }],
      W: [{ story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 }],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'E',
      width: 2.0, step_height: 0.16, step_depth: 0.42,      // was 1.4 wide
      access_rooftop: true, handrails: true,
      layout: 'straight', single_run: true,
    }],
  });
  // Small COMMUNITY CENTER at east cul-de-sac.
  const commCenter = residentialHouse({
    name: 'Community Center', x: 50, y: 0, z: -20, yaw: 0,
    stories: 2, width: 12, depth: 12, story_height: 3.2,         // was 10×10 at 3.0
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#a04070',
    interior_color: '#f4c8d8',
    interior_rooms: {
      rows: 1, cols: 2, doorway_width: 2.0, doorway_height: 2.6, // 2 big open halls per floor
      half_bath: true, half_bath_corner: 'NW', half_bath_size: 2.4,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 2.0, height: 2.8 },
        { story: 1, kind: 'window', offset: 0, width: 3.0, height: 1.8, sill: 0.8 },
      ],
      S: [
        { story: 0, kind: 'window', offset: 0, width: 3.0, height: 1.8, sill: 0.8 },
        { story: 1, kind: 'window', offset: 0, width: 3.0, height: 1.8, sill: 0.8 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 2.0, height: 1.8, sill: 0.8 },
        { story: 1, kind: 'window', offset: 0, width: 2.0, height: 1.8, sill: 0.8 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 2.0, height: 1.8, sill: 0.8 },
        { story: 1, kind: 'window', offset: 0, width: 2.0, height: 1.8, sill: 0.8 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'W',
      width: 2.4, step_height: 0.16, step_depth: 0.42,           // was 1.8 wide
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });
  // Road network: main east-west street between the rows + a
  // perpendicular cul-de-sac at both ends + driveways to every front
  // door. Front-door y ≈ ground; we tuck driveway nodes right at the
  // house wall.
  const nMainW = { id: rnid(), x: -55, z: 0, y: 0 };
  const nMainE = { id: rnid(), x:  55, z: 0, y: 0 };
  const nInt1  = { id: rnid(), x: -30, z: 0, y: 0 };
  const nInt2  = { id: rnid(), x:   0, z: 0, y: 0 };
  const nInt3  = { id: rnid(), x:  30, z: 0, y: 0 };
  // Driveway endpoints at each house front door (facing the street).
  // North row: front door on side S (yaw=π) so front is at z = 20 - 6 = 14.
  const nDN1  = { id: rnid(), x: -30, z: 14, y: 0 };
  const nDN2  = { id: rnid(), x:   0, z: 14, y: 0 };
  const nDN3  = { id: rnid(), x:  30, z: 14, y: 0 };
  // South row: front door on side N (yaw=0) so front is at z = -20 + 6 = -14.
  const nDS1  = { id: rnid(), x: -30, z: -14, y: 0 };
  const nDS2  = { id: rnid(), x:   0, z: -14, y: 0 };
  const nDS3  = { id: rnid(), x:  30, z: -14, y: 0 };
  const resPreset = {
    road_width: 6.5, lanes: 2, lane_width: 3.25, sidewalk_width: 2, curb_height: 0.16,
    asphalt_color: '#2c2c2c', sidewalk_color: '#a09082',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  };
  const drivePreset = {
    road_width: 3.0, lanes: 1, lane_width: 3.0, sidewalk_width: 0, curb_height: 0.06,
    asphalt_color: '#3a382f', sidewalk_color: '#000000',
    asphalt_texture: 'concrete_sidewalk', sidewalk_texture: '',
  };
  return {
    name: 'SUBURBAN NEIGHBORHOOD (Template)',
    mode: 'tdm',
    half: 100,
    world: worldFromTod('MORNING'),   // sunny cul-de-sac morning
    buildings: [houseN1, houseN2, houseN3, houseS1, houseS2, houseS3, miniMart, commCenter],
    catwalks: [],
    objects: [
      // ── Parked cars along the street (visual + cover) ─────────
      { id: 'obj_n1', x: -20, y: 0.75, z:  6, w: 4.6, h: 1.5, d: 2.0, color: '#c04030', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n2', x:  10, y: 0.75, z:  6, w: 4.6, h: 1.5, d: 2.0, color: '#3040c0', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n3', x:  40, y: 0.75, z:  6, w: 4.6, h: 1.5, d: 2.0, color: '#f0f0f0', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n4', x: -40, y: 0.75, z: -6, w: 4.6, h: 1.5, d: 2.0, color: '#308050', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n5', x:   0, y: 0.75, z: -6, w: 4.6, h: 1.5, d: 2.0, color: '#f0a020', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n6', x:  20, y: 0.75, z: -6, w: 4.6, h: 1.5, d: 2.0, color: '#101014', collision: true, climbable: true, texture: 'facade_office_glass' },
      // ── Trees / bushes as soft cover ─────────────────────────
      { id: 'obj_n7',  x: -45, y: 1.0, z: 20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n8',  x: -15, y: 1.0, z: 20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n9',  x:  15, y: 1.0, z: 20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n10', x:  45, y: 1.0, z: 20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n11', x: -45, y: 1.0, z: -20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n12', x: -15, y: 1.0, z: -20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n13', x:  15, y: 1.0, z: -20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      { id: 'obj_n14', x:  45, y: 1.0, z: -20, w: 2.0, h: 2.0, d: 2.0, color: '#2a4a2a', collision: true, climbable: true },
      // ── Mailboxes at each front driveway ─────────────────────
      { id: 'obj_n15', x: -30, y: 0.6, z: 13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },
      { id: 'obj_n16', x:   0, y: 0.6, z: 13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },
      { id: 'obj_n17', x:  30, y: 0.6, z: 13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },
      { id: 'obj_n18', x: -30, y: 0.6, z:-13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },
      { id: 'obj_n19', x:   0, y: 0.6, z:-13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },
      { id: 'obj_n20', x:  30, y: 0.6, z:-13, w: 0.3, h: 1.2, d: 0.3, color: '#c8c8c8', collision: true },

      // ── House rooftop cover — each house at Y = 8.3m ─────────
      // N1 rooftop
      { id: 'obj_n21', x: -33, y: 9.0, z: 20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' }, // AC unit
      { id: 'obj_n22', x: -28, y: 9.3, z: 22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' }, // Chimney
      // N2 rooftop
      { id: 'obj_n23', x:  -3, y: 9.0, z: 20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_n24', x:   2, y: 9.3, z: 22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' },
      { id: 'obj_n25', x:   0, y: 8.6, z: 18, w: 1.4, h: 0.4, d: 1.4, color: '#3a3a44', collision: true, climbable: true }, // Satellite dish
      // N3 rooftop
      { id: 'obj_n26', x:  27, y: 9.0, z: 20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_n27', x:  32, y: 9.3, z: 22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' },
      // S1 rooftop
      { id: 'obj_n28', x: -33, y: 9.0, z: -20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_n29', x: -28, y: 9.3, z: -22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' },
      // S2 rooftop
      { id: 'obj_n30', x:  -3, y: 9.0, z: -20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_n31', x:   2, y: 9.3, z: -22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' },
      { id: 'obj_n32', x:   0, y: 8.6, z: -18, w: 1.4, h: 0.4, d: 1.4, color: '#3a3a44', collision: true, climbable: true },
      // S3 rooftop
      { id: 'obj_n33', x:  27, y: 9.0, z: -20, w: 1.4, h: 1.4, d: 1.4, color: '#4a4a4e', collision: true, climbable: true, texture: 'sheet_metal_ribbed' },
      { id: 'obj_n34', x:  32, y: 9.3, z: -22, w: 0.6, h: 2.0, d: 0.6, color: '#3a3438', collision: true, texture: 'industrial_metal_wall' },

      // ── Fences between yards (thin wood panels) ──────────────
      // Between N row houses
      { id: 'obj_n35', x: -15, y: 0.9, z: 20, w: 0.15, h: 1.8, d: 10, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n36', x:  15, y: 0.9, z: 20, w: 0.15, h: 1.8, d: 10, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      // Between S row houses
      { id: 'obj_n37', x: -15, y: 0.9, z: -20, w: 0.15, h: 1.8, d: 10, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n38', x:  15, y: 0.9, z: -20, w: 0.15, h: 1.8, d: 10, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      // Back fences (behind north row and south row)
      { id: 'obj_n39', x: -30, y: 0.9, z: 27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n40', x:   0, y: 0.9, z: 27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n41', x:  30, y: 0.9, z: 27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n42', x: -30, y: 0.9, z:-27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n43', x:   0, y: 0.9, z:-27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },
      { id: 'obj_n44', x:  30, y: 0.9, z:-27, w: 10, h: 1.8, d: 0.15, color: '#5a3a24', collision: true, texture: 'facade_painted_brick' },

      // ── East-end community park + playground ─────────────────
      // Slide (angled block)
      { id: 'obj_n45', x: 42, y: 1.5, z: -5, w: 4, h: 3, d: 1.4, color: '#3070c0', collision: true, climbable: true, texture: 'facade_office_glass' },
      // Swing set frame (A-frame)
      { id: 'obj_n46', x: 48, y: 1.5, z: -2, w: 0.25, h: 3, d: 0.25, color: '#c04030', collision: true },
      { id: 'obj_n47', x: 48, y: 1.5, z:  2, w: 0.25, h: 3, d: 0.25, color: '#c04030', collision: true },
      { id: 'obj_n48', x: 48, y: 3.0, z:  0, w: 0.2, h: 0.2, d: 4.5, color: '#c04030', collision: true, climbable: true },
      // Sandbox
      { id: 'obj_n49', x: 45, y: 0.15, z:  6, w: 5, h: 0.3, d: 5, color: '#d0b878', collision: true, texture: 'concrete_sidewalk' },
      // Park bench near playground
      { id: 'obj_n50', x: 42, y: 0.4, z:  8, w: 3.2, h: 0.8, d: 0.6, color: '#4a3a24', collision: true, climbable: true },

      // ── West-end gas station canopy + pumps ──────────────────
      { id: 'obj_n51', x: -50, y: 3.6, z: 10, w: 10, h: 0.3, d: 6, color: '#c8c8c8', collision: true, climbable: true, texture: 'facade_office_glass' },
      { id: 'obj_n52', x: -54, y: 1.75, z:  8, w: 0.3, h: 3.5, d: 0.3, color: '#3a3a44', collision: true }, // canopy pillar
      { id: 'obj_n53', x: -46, y: 1.75, z:  8, w: 0.3, h: 3.5, d: 0.3, color: '#3a3a44', collision: true },
      { id: 'obj_n54', x: -54, y: 1.75, z: 12, w: 0.3, h: 3.5, d: 0.3, color: '#3a3a44', collision: true },
      { id: 'obj_n55', x: -46, y: 1.75, z: 12, w: 0.3, h: 3.5, d: 0.3, color: '#3a3a44', collision: true },
      // Gas pumps
      { id: 'obj_n56', x: -52, y: 0.75, z: 10, w: 0.6, h: 1.5, d: 1.0, color: '#e04040', collision: true },
      { id: 'obj_n57', x: -48, y: 0.75, z: 10, w: 0.6, h: 1.5, d: 1.0, color: '#40b040', collision: true },
    ],
    lights: [
      // Street lamps
      { id: 'lt_n1', type: 'point', x: -40, y: 6, z: 0, color: '#ffd090', intensity: 2.0, radius: 26 },
      { id: 'lt_n2', type: 'point', x:   0, y: 6, z: 0, color: '#ffd090', intensity: 2.0, radius: 26 },
      { id: 'lt_n3', type: 'point', x:  40, y: 6, z: 0, color: '#ffd090', intensity: 2.0, radius: 26 },
      { id: 'lt_n4', type: 'point', x: -45, y: 8, z: -25, color: '#a8c8ff', intensity: 1.2, radius: 32 },
      { id: 'lt_n5', type: 'point', x:  45, y: 8, z:  25, color: '#a8c8ff', intensity: 1.2, radius: 32 },
      // Mini-mart glow
      { id: 'lt_n6', type: 'point', x: -50, y: 4, z: 15, color: '#ffe090', intensity: 2.2, radius: 22 },
      // Community center porch light
      { id: 'lt_n7', type: 'point', x:  50, y: 4, z: -14, color: '#ffcf80', intensity: 1.8, radius: 18 },
      // Playground area accent
      { id: 'lt_n8', type: 'point', x:  45, y: 5, z:   0, color: '#e0f0ff', intensity: 1.4, radius: 18 },
    ],
    spawns: {
      A: [
        { x: -50, z: -40, yaw: Math.PI / 3 }, { x: -50, z:   0, yaw: Math.PI / 2 }, { x: -50, z:  40, yaw: 2 * Math.PI / 3 },
      ],
      B: [
        { x:  50, z: -40, yaw: -Math.PI / 3 }, { x:  50, z:   0, yaw: -Math.PI / 2 }, { x:  50, z:  40, yaw: -2 * Math.PI / 3 },
      ],
    },
    weapon_pickups: [
      { wpn: 'ak47',     x: -30, z:   0, ammo: 60 },
      { wpn: 'ak47',     x:  30, z:   0, ammo: 60 },
      { wpn: 'shotgun',  x:   0, z:  15, ammo: 16 },
      { wpn: 'shotgun',  x:   0, z: -15, ammo: 16 },
      { wpn: 'pistol',   x: -15, z:   0, ammo: 24 },
      { wpn: 'pistol',   x:  15, z:   0, ammo: 24 },
      { wpn: 'rpg',      x:   0, z:   0, ammo: 3 },
      { wpn: 'pimpslap', x: -45, z:  25, ammo: 1 },
      { wpn: 'pimpslap', x:  45, z: -25, ammo: 1 },
    ],
    hill_candidates: [
      { id: 'mid_street', x:   0, z: 0, y: 0,   radius: 6, label: 'MID STREET' },
      { id: 'w_end',      x: -45, z: 0, y: 0,   radius: 5, label: 'WEST END' },
      { id: 'e_end',      x:  45, z: 0, y: 0,   radius: 5, label: 'EAST END' },
      { id: 'n2_roof',    x:   0, z: 20, y: 8.4, radius: 4, label: 'N2 ROOFTOP' },
      { id: 's2_roof',    x:   0, z: -20, y: 8.4, radius: 4, label: 'S2 ROOFTOP' },
      { id: 'minimart',   x: -50, z: 20, y: 0,   radius: 4, label: 'MINI-MART' },
      { id: 'comm_ctr',   x:  50, z: -20, y: 0,  radius: 4, label: 'COMMUNITY CENTER' },
      { id: 'park',       x:  45, z: -2, y: 0,   radius: 4, label: 'PLAYGROUND' },
    ],
    roads: {
      nodes: [
        nMainW, nMainE, nInt1, nInt2, nInt3,
        nDN1, nDN2, nDN3, nDS1, nDS2, nDS3,
      ],
      edges: [
        // Main street (west to east)
        { id: reid(), a: nMainW.id, b: nInt1.id, type: 'residential', ...resPreset },
        { id: reid(), a: nInt1.id,  b: nInt2.id, type: 'residential', ...resPreset },
        { id: reid(), a: nInt2.id,  b: nInt3.id, type: 'residential', ...resPreset },
        { id: reid(), a: nInt3.id,  b: nMainE.id, type: 'residential', ...resPreset },
        // Driveways to north row
        { id: reid(), a: nInt1.id,  b: nDN1.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nInt2.id,  b: nDN2.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nInt3.id,  b: nDN3.id, type: 'driveway', ...drivePreset },
        // Driveways to south row
        { id: reid(), a: nInt1.id,  b: nDS1.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nInt2.id,  b: nDS2.id, type: 'driveway', ...drivePreset },
        { id: reid(), a: nInt3.id,  b: nDS3.id, type: 'driveway', ...drivePreset },
      ],
    },
  };
})();

// ── STADIUM ARENA — tiered bleachers, jumbotron, tunnel entrances ─
//
// A giant sports stadium built around a central rectangular field.
// Four tiered "wedge" bleachers (one per cardinal side) rise from
// field level up to +8m — implemented as ramps so players can sprint
// up the slope naturally. Between the ramps, four corner press-box
// buildings ring the arena. Two locker-room / tunnel buildings sit
// behind the north and south endzones — spawn points route through
// them. Above midfield, a big jumbotron scoreboard hangs suspended
// on 4 corner light towers.
const STADIUM_ARENA = (() => {
  _bid = 500; _cid = 500; _sid = 500; _rnid = 500; _reid = 500;

  // Two locker-room buildings at N/S ends (behind the endzones).
  const lockerN = residentialHouse({
    name: 'North Locker Room', x: 0, y: 0, z: 42, yaw: Math.PI,
    stories: 2, width: 24, depth: 12, story_height: 3.6,     // bigger, taller
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#3a4c66',
    interior_color: '#c8ccd4',
    roof_color: '#22262c',
    has_parapet: true, parapet_height: 0.9,
    interior_rooms: {
      rows: 2, cols: 2, doorway_width: 2.0, doorway_height: 2.6,   // 4 big locker halls
      half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.6,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 4.0, height: 3.4 },     // TUNNEL onto field
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'door',   offset: 0, width: 2.4, height: 2.8 },     // Back entrance
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.9 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'S',
      width: 2.6, step_height: 0.16, step_depth: 0.42,       // was 2.0 wide
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });
  const lockerS = residentialHouse({
    name: 'South Locker Room', x: 0, y: 0, z: -42, yaw: 0,
    stories: 2, width: 24, depth: 12, story_height: 3.6,
    exterior_texture: 'facade_painted_brick',
    exterior_color: '#66403a',
    interior_color: '#c8ccd4',
    roof_color: '#22262c',
    has_parapet: true, parapet_height: 0.9,
    interior_rooms: {
      rows: 2, cols: 2, doorway_width: 2.0, doorway_height: 2.6,
      half_bath: true, half_bath_corner: 'NW', half_bath_size: 2.6,
      per_story: true,
    },
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 4.0, height: 3.4 },
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.9 },
      ],
      S: [
        { story: 0, kind: 'door',   offset: 0, width: 2.4, height: 2.8 },
        { story: 1, kind: 'window', offset: 0, width: 8.0, height: 1.8, sill: 0.9 },
      ],
      E: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
      ],
      W: [
        { story: 0, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
        { story: 1, kind: 'window', offset: 0, width: 2.4, height: 1.8, sill: 0.9 },
      ],
    },
    stairs: [{
      id: sid(), enabled: true, side: 'S',
      width: 2.6, step_height: 0.16, step_depth: 0.42,        // was 2.0 wide
      access_rooftop: true, handrails: true,
      layout: 'switchback', single_run: false,
    }],
  });

  // Four corner press-box towers — 3-story office-style buildings
  // between the tiered bleachers. Position their inner face flush
  // with the outer edge of the ramps (Z=±37 for N/S, X=±47 for E/W).
  const pressNE = officeTower({
    name: 'NE Press Box', x:  40, y: 0, z: 30, yaw: 0,
    stories: 3, width: 10, depth: 8, story_height: 3.2,
    exterior_color: '#3a4258',
  });
  const pressNW = officeTower({
    name: 'NW Press Box', x: -40, y: 0, z: 30, yaw: 0,
    stories: 3, width: 10, depth: 8, story_height: 3.2,
    exterior_color: '#3a4258',
  });
  const pressSE = officeTower({
    name: 'SE Press Box', x:  40, y: 0, z: -30, yaw: 0,
    stories: 3, width: 10, depth: 8, story_height: 3.2,
    exterior_color: '#3a4258',
  });
  const pressSW = officeTower({
    name: 'SW Press Box', x: -40, y: 0, z: -30, yaw: 0,
    stories: 3, width: 10, depth: 8, story_height: 3.2,
    exterior_color: '#3a4258',
  });

  // Ramp bleachers — one per side. slope_axis='z' rises toward +Z (or -Z).
  // Ramp primitive uses `type: 'ramp'`, with y_start/y_end and slope_axis.
  // We author them as raw objects; the runtime slope collider handles
  // walking up smoothly at any speed.
  const bleacherRampN = {
    id: 'obj_bl_n', type: 'ramp',
    x: 0, y: 0, z: 27, yaw: 0,
    w: 60, d: 14,
    y_start: 0.05, y_end: 8.0,
    slope_axis: 'z',
    color: '#a03030', texture: 'concrete_sidewalk',
    collision: true, climbable: true,
  };
  const bleacherRampS = {
    id: 'obj_bl_s', type: 'ramp',
    x: 0, y: 0, z: -27, yaw: Math.PI,       // rotated so slope rises to -Z
    w: 60, d: 14,
    y_start: 0.05, y_end: 8.0,
    slope_axis: 'z',
    color: '#a03030', texture: 'concrete_sidewalk',
    collision: true, climbable: true,
  };
  const bleacherRampE = {
    id: 'obj_bl_e', type: 'ramp',
    x: 32, y: 0, z: 0, yaw: Math.PI / 2,     // 90° rotate so slope rises to +X
    w: 40, d: 14,
    y_start: 0.05, y_end: 8.0,
    slope_axis: 'z',                          // local Z after rotation = world +X
    color: '#a03030', texture: 'concrete_sidewalk',
    collision: true, climbable: true,
  };
  const bleacherRampW = {
    id: 'obj_bl_w', type: 'ramp',
    x: -32, y: 0, z: 0, yaw: -Math.PI / 2,   // -90° so slope rises to -X
    w: 40, d: 14,
    y_start: 0.05, y_end: 8.0,
    slope_axis: 'z',
    color: '#a03030', texture: 'concrete_sidewalk',
    collision: true, climbable: true,
  };

  // Visual "step lines" on top of each ramp — flat non-collision
  // decal boxes at the row breaks to sell the bleacher look.
  const stepLines = [];
  for (let i = 1; i <= 5; i++) {
    const y = i * 1.5 + 0.05;
    const z = 20 + i * 2.3;   // outward along the N ramp
    stepLines.push(
      { id: `obj_stpN_${i}`, x: 0, y, z, w: 60 - i * 0.5, h: 0.06, d: 0.25, color: '#f4d000', collision: false },
      { id: `obj_stpS_${i}`, x: 0, y, z: -z, w: 60 - i * 0.5, h: 0.06, d: 0.25, color: '#f4d000', collision: false },
      { id: `obj_stpE_${i}`, x: 20 + i * 2.3, y, z: 0, w: 0.25, h: 0.06, d: 40 - i * 0.5, color: '#f4d000', collision: false },
      { id: `obj_stpW_${i}`, x: -(20 + i * 2.3), y, z: 0, w: 0.25, h: 0.06, d: 40 - i * 0.5, color: '#f4d000', collision: false },
    );
  }

  // Field markings — thin painted lines on the grass.
  const fieldLines = [
    // Grass field pad
    { id: 'obj_field',   x: 0, y: 0.02, z: 0,   w: 44, h: 0.05, d: 34, color: '#2c5c34', collision: false, texture: 'concrete_sidewalk' },
    // Midfield line
    { id: 'obj_midline', x: 0, y: 0.06, z: 0,   w: 44, h: 0.02, d: 0.3, color: '#f0f0f0', collision: false },
    // End zone lines
    { id: 'obj_ezN',     x: 0, y: 0.06, z:  14, w: 44, h: 0.02, d: 0.3, color: '#f0f0f0', collision: false },
    { id: 'obj_ezS',     x: 0, y: 0.06, z: -14, w: 44, h: 0.02, d: 0.3, color: '#f0f0f0', collision: false },
    // Sidelines
    { id: 'obj_slE',     x: 22, y: 0.06, z: 0,  w: 0.3, h: 0.02, d: 34, color: '#f0f0f0', collision: false },
    { id: 'obj_slW',     x: -22, y: 0.06, z: 0, w: 0.3, h: 0.02, d: 34, color: '#f0f0f0', collision: false },
    // Center circle (approximated with 4 corner spots)
    { id: 'obj_cc1',     x:  4, y: 0.06, z:  4, w: 0.4, h: 0.02, d: 0.4, color: '#f0f0f0', collision: false },
    { id: 'obj_cc2',     x: -4, y: 0.06, z:  4, w: 0.4, h: 0.02, d: 0.4, color: '#f0f0f0', collision: false },
    { id: 'obj_cc3',     x:  4, y: 0.06, z: -4, w: 0.4, h: 0.02, d: 0.4, color: '#f0f0f0', collision: false },
    { id: 'obj_cc4',     x: -4, y: 0.06, z: -4, w: 0.4, h: 0.02, d: 0.4, color: '#f0f0f0', collision: false },
  ];

  // Goalposts — H-frame at each endzone.
  const goalposts = [
    // North goalpost (behind end zone)
    { id: 'obj_gpN_L',  x: -3, y: 2.5, z: 17, w: 0.2, h: 5.0, d: 0.2, color: '#f4d000', collision: true },
    { id: 'obj_gpN_R',  x:  3, y: 2.5, z: 17, w: 0.2, h: 5.0, d: 0.2, color: '#f4d000', collision: true },
    { id: 'obj_gpN_XB', x:  0, y: 3.5, z: 17, w: 6.0, h: 0.2, d: 0.2, color: '#f4d000', collision: true, climbable: true },
    // South goalpost
    { id: 'obj_gpS_L',  x: -3, y: 2.5, z: -17, w: 0.2, h: 5.0, d: 0.2, color: '#f4d000', collision: true },
    { id: 'obj_gpS_R',  x:  3, y: 2.5, z: -17, w: 0.2, h: 5.0, d: 0.2, color: '#f4d000', collision: true },
    { id: 'obj_gpS_XB', x:  0, y: 3.5, z: -17, w: 6.0, h: 0.2, d: 0.2, color: '#f4d000', collision: true, climbable: true },
  ];

  // Jumbotron scoreboard — suspended above midfield by 4 corner
  // light towers. The towers are climbable up to their tops.
  const jumbotron = [
    // Central hanging screen
    { id: 'obj_jumbo', x: 0, y: 16, z: 0, w: 12, h: 5, d: 6, color: '#101018', collision: true, climbable: true, texture: 'facade_office_glass' },
    { id: 'obj_jumbo_hood', x: 0, y: 18.6, z: 0, w: 14, h: 0.3, d: 8, color: '#2a2a34', collision: true, climbable: true },
    // 4 corner floodlight towers (climbable)
    { id: 'obj_lt_ne', x:  22, y: 10, z:  16, w: 1.2, h: 20, d: 1.2, color: '#3a3a44', collision: true, climbable: true, texture: 'industrial_metal_wall' },
    { id: 'obj_lt_nw', x: -22, y: 10, z:  16, w: 1.2, h: 20, d: 1.2, color: '#3a3a44', collision: true, climbable: true, texture: 'industrial_metal_wall' },
    { id: 'obj_lt_se', x:  22, y: 10, z: -16, w: 1.2, h: 20, d: 1.2, color: '#3a3a44', collision: true, climbable: true, texture: 'industrial_metal_wall' },
    { id: 'obj_lt_sw', x: -22, y: 10, z: -16, w: 1.2, h: 20, d: 1.2, color: '#3a3a44', collision: true, climbable: true, texture: 'industrial_metal_wall' },
    // Floodlight housings on top
    { id: 'obj_fl_ne', x:  22, y: 20.5, z:  16, w: 2.4, h: 1.0, d: 2.4, color: '#f4d000', collision: true, climbable: true },
    { id: 'obj_fl_nw', x: -22, y: 20.5, z:  16, w: 2.4, h: 1.0, d: 2.4, color: '#f4d000', collision: true, climbable: true },
    { id: 'obj_fl_se', x:  22, y: 20.5, z: -16, w: 2.4, h: 1.0, d: 2.4, color: '#f4d000', collision: true, climbable: true },
    { id: 'obj_fl_sw', x: -22, y: 20.5, z: -16, w: 2.4, h: 1.0, d: 2.4, color: '#f4d000', collision: true, climbable: true },
  ];

  // Perimeter railing at the top of each bleacher (safety barrier).
  const railings = [
    { id: 'obj_rN', x: 0, y: 8.8, z:  34, w: 60, h: 1.1, d: 0.15, color: '#e0e0e8', collision: true, texture: 'sheet_metal_ribbed' },
    { id: 'obj_rS', x: 0, y: 8.8, z: -34, w: 60, h: 1.1, d: 0.15, color: '#e0e0e8', collision: true, texture: 'sheet_metal_ribbed' },
    { id: 'obj_rE', x: 39, y: 8.8, z: 0, w: 0.15, h: 1.1, d: 40, color: '#e0e0e8', collision: true, texture: 'sheet_metal_ribbed' },
    { id: 'obj_rW', x: -39, y: 8.8, z: 0, w: 0.15, h: 1.1, d: 40, color: '#e0e0e8', collision: true, texture: 'sheet_metal_ribbed' },
  ];

  return {
    name: 'STADIUM ARENA (Template)',
    mode: 'tdm',
    half: 100,
    world: worldFromTod('NOON'),   // game-day sunshine
    buildings: [lockerN, lockerS, pressNE, pressNW, pressSE, pressSW],
    catwalks: [
      // Roof-line catwalk connecting the four corner press boxes.
      { id: cid(), name: 'NE→NW press deck', ax:  35, ay: 9.9, az: 30, bx: -35, by: 9.9, bz: 30,
        width: 2.0, handrails: true, supports: false, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
      { id: cid(), name: 'SE→SW press deck', ax:  35, ay: 9.9, az: -30, bx: -35, by: 9.9, bz: -30,
        width: 2.0, handrails: true, supports: false, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
      { id: cid(), name: 'NE→SE press deck', ax:  40, ay: 9.9, az:  25, bx:  40, by: 9.9, bz: -25,
        width: 2.0, handrails: true, supports: false, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
      { id: cid(), name: 'NW→SW press deck', ax: -40, ay: 9.9, az:  25, bx: -40, by: 9.9, bz: -25,
        width: 2.0, handrails: true, supports: false, texture: 'sheet_metal_ribbed', color: '#4a4a4e' },
    ],
    objects: [
      ...fieldLines,
      bleacherRampN, bleacherRampS, bleacherRampE, bleacherRampW,
      ...stepLines,
      ...goalposts,
      ...jumbotron,
      ...railings,
    ],
    lights: [
      // 4 floodlights on the corner towers
      { id: 'lt_st1', type: 'point', x:  22, y: 20, z:  16, color: '#fff5c8', intensity: 3.0, radius: 60 },
      { id: 'lt_st2', type: 'point', x: -22, y: 20, z:  16, color: '#fff5c8', intensity: 3.0, radius: 60 },
      { id: 'lt_st3', type: 'point', x:  22, y: 20, z: -16, color: '#fff5c8', intensity: 3.0, radius: 60 },
      { id: 'lt_st4', type: 'point', x: -22, y: 20, z: -16, color: '#fff5c8', intensity: 3.0, radius: 60 },
      // Jumbotron ambient glow
      { id: 'lt_jumbo', type: 'point', x: 0, y: 16, z: 0, color: '#4a80ff', intensity: 1.8, radius: 22 },
      // Tunnel entrance warm glow
      { id: 'lt_ntun', type: 'point', x: 0, y: 3, z: 38, color: '#ffa060', intensity: 1.4, radius: 14 },
      { id: 'lt_stun', type: 'point', x: 0, y: 3, z: -38, color: '#ffa060', intensity: 1.4, radius: 14 },
    ],
    spawns: {
      A: [
        // Spawn in the N locker room (interior)
        { x: -6, z: 42, yaw: Math.PI }, { x: 0, z: 42, yaw: Math.PI }, { x: 6, z: 42, yaw: Math.PI },
      ],
      B: [
        { x: -6, z: -42, yaw: 0 }, { x: 0, z: -42, yaw: 0 }, { x: 6, z: -42, yaw: 0 },
      ],
    },
    weapon_pickups: [
      // Midfield centrepiece
      { wpn: 'rpg',      x:   0, z:   0, ammo: 3 },
      // Around the field at 5m from centre
      { wpn: 'ak47',     x: -10, z:   0, ammo: 60 },
      { wpn: 'ak47',     x:  10, z:   0, ammo: 60 },
      { wpn: 'shotgun',  x:   0, z:  10, ammo: 16 },
      { wpn: 'shotgun',  x:   0, z: -10, ammo: 16 },
      // On top of the ramps — sniping perches
      { wpn: 'ak47',     x:   0, z:  33, ammo: 60, y: 8.1 },
      { wpn: 'ak47',     x:   0, z: -33, ammo: 60, y: 8.1 },
      { wpn: 'shotgun',  x:  38, z:   0, ammo: 16, y: 8.1 },
      { wpn: 'shotgun',  x: -38, z:   0, ammo: 16, y: 8.1 },
      // Press-box rooftop
      { wpn: 'rpg',      x:  40, z:  30, ammo: 3, y: 10.0 },
      { wpn: 'rpg',      x: -40, z: -30, ammo: 3, y: 10.0 },
      // Pistols at each endzone
      { wpn: 'pistol',   x:   0, z:  14, ammo: 24 },
      { wpn: 'pistol',   x:   0, z: -14, ammo: 24 },
      // Pimpslap — bragging rights, on the jumbotron
      { wpn: 'pimpslap', x:   0, z:   0, ammo: 1, y: 19.0 },
    ],
    hill_candidates: [
      { id: 'midfield',   x:   0, z:   0, y: 0,   radius: 6, label: 'MIDFIELD' },
      { id: 'north_ez',   x:   0, z:  14, y: 0,   radius: 4.5, label: 'NORTH END ZONE' },
      { id: 'south_ez',   x:   0, z: -14, y: 0,   radius: 4.5, label: 'SOUTH END ZONE' },
      { id: 'n_top',      x:   0, z:  33, y: 8,   radius: 5, label: 'NORTH BLEACHER TOP' },
      { id: 's_top',      x:   0, z: -33, y: 8,   radius: 5, label: 'SOUTH BLEACHER TOP' },
      { id: 'jumbo',      x:   0, z:   0, y: 16,  radius: 4, label: 'JUMBOTRON DECK' },
      { id: 'ne_press',   x:  40, z:  30, y: 10,  radius: 4, label: 'NE PRESS ROOF' },
      { id: 'sw_press',   x: -40, z: -30, y: 10,  radius: 4, label: 'SW PRESS ROOF' },
    ],
    roads: { nodes: [], edges: [] },
  };
})();

export const BUILTIN_MAP_TEMPLATES = [
  { id: 'tmpl_block',        label: 'CITY BLOCK',            source: () => JSON.parse(JSON.stringify(CITY_BLOCK)) },
  { id: 'tmpl_projects',     label: 'THE PROJECTS',          source: () => JSON.parse(JSON.stringify(PROJECTS)) },
  { id: 'tmpl_koth',         label: 'KOTH HOUSE',            source: () => JSON.parse(JSON.stringify(KOTH_HOUSE)) },
  { id: 'tmpl_boardroom',    label: 'BOARDROOM',             source: () => JSON.parse(JSON.stringify(BOARDROOM)) },
  { id: 'tmpl_graffiti',     label: 'GRAFFITI ALLEY',        source: () => JSON.parse(JSON.stringify(GRAFFITI)) },
  { id: 'tmpl_warehouse',    label: 'WAREHOUSE LOBBY',       source: () => JSON.parse(JSON.stringify(WAREHOUSE)) },
  { id: 'tmpl_office_cplx',  label: 'OFFICE COMPLEX',        source: () => JSON.parse(JSON.stringify(OFFICE_COMPLEX)) },
  { id: 'tmpl_hospital',     label: 'CITY HOSPITAL',         source: () => JSON.parse(JSON.stringify(CITY_HOSPITAL)) },
  { id: 'tmpl_industrial',   label: 'INDUSTRIAL DISTRICT',   source: () => JSON.parse(JSON.stringify(INDUSTRIAL_DISTRICT)) },
  { id: 'tmpl_suburbs',      label: 'SUBURBAN NEIGHBORHOOD', source: () => JSON.parse(JSON.stringify(SUBURBAN_NEIGHBORHOOD)) },
  { id: 'tmpl_stadium',      label: 'STADIUM ARENA',         source: () => JSON.parse(JSON.stringify(STADIUM_ARENA)) },
];
