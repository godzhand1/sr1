// buildingGen.js — procedural building generator for MapEditor3D.
//
// Turns a compact spec (stories, dimensions, doors, windows, stair,
// textures) into a set of axis-aligned box primitives that the
// existing custom-map renderer + collision layer already
// understand. Each emitted box carries `_building_id` and
// `_building_part` tags so the editor can strip an old building's
// boxes and regenerate cleanly on any spec edit.
//
// Design goals:
//   • One-click AAA-looking buildings (walls, doors, windows,
//     interior floors, stairs, parapet roof).
//   • Zero engine changes — output feeds straight into the same
//     `objects` array the box editor uses today, so runtime map
//     load stays untouched.
//   • Cheap to regen on every slider tweak — algorithm is O(walls
//     × openings) with no async work.

/** Reasonable default spec for a fresh building. Two stories, one
 *  ground-floor door on the front, three windows per side upstairs,
 *  interior stair against the east wall. Matches the "downtown row
 *  house" silhouette that reads best in a top-down TDM arena. */
/** Default spec: a small residential row-house tuned to the game's
 *  1.6 m tall × 0.9 m wide character. Every dimension approximates
 *  a real-world minimum residential-code value so builds "feel"
 *  human-scale in first- and third-person cameras.
 *
 *  Scale reference (all in metres):
 *    • Character standing height        1.60   (PLAYER_R × 2 + 0.7)
 *    • Character head clearance         2.05   (default door top)
 *    • Story height (floor→floor)       2.70   (residential code)
 *    • Front door                       2.05 × 0.90
 *    • Interior door / window sill      1.10
 *    • Stair riser                      0.18   (IRC max 0.19)
 *    • Stair tread                      0.28   (IRC min 0.25) */
export const DEFAULT_BUILDING = () => ({
  id: '',
  name: 'Building',
  building_type: 'residential',   // 'residential' | 'factory' | 'office' | 'warehouse'
  x: 0, y: 0, z: 0, yaw: 0,
  stories: 2,
  width: 10,
  depth: 12,
  story_height: 2.7,
  wall_thickness: 0.3,
  has_roof: true,
  has_parapet: true,
  parapet_height: 0.9,
  has_interior_floors: true,
  floor_thickness: 0.2,
  has_floor_ledges: true,         // decorative concrete bands at each floor line
  ledge_depth: 0.18,              // how far the ledge protrudes from the wall
  ledge_thickness: 0.12,          // vertical thickness of the ledge
  // ── Interior partition layout ──────────────────────────────
  // Simple grid split of the floor plan (excluding half-bath).
  // rows × cols = number of rooms per story. Each shared wall
  // opens into the neighbour via an open doorway (no door leaf)
  // at the wall centre. A half-bathroom is a small enclosed
  // ~2.4m × 2.4m room in one specified corner with its OWN
  // doorway. Interior partitions are placed on story 0 only by
  // default; higher stories inherit the same layout.
  interior_rooms: {
    rows: 1,
    cols: 1,
    doorway_width: 1.4,
    doorway_height: 2.1,
    half_bath: false,
    half_bath_corner: 'NE',       // 'NE' | 'NW' | 'SE' | 'SW'
    half_bath_size: 2.4,
    per_story: false,             // true = repeat every story; false = story 0 only
  },
  exterior_texture: 'facade_brick_apartments',
  interior_texture: 'warehouse_concrete_floor',
  roof_texture: 'asphalt_road',
  exterior_color: '#8a6844',
  interior_color: '#a08c74',
  roof_color: '#2a2a2e',
  // Side codes: N (+Z), S (-Z), E (+X), W (-X).
  // `offset` is measured along the wall's own axis:
  //   • N/S walls: along X, 0 = wall centre, positive = east side
  //   • E/W walls: along Z, 0 = wall centre, positive = north side
  openings: {
    N: [
      { story: 0, kind: 'door',   offset: 0,   width: 0.9, height: 2.05 },
      { story: 1, kind: 'window', offset: -3, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 1, kind: 'window', offset:  3, width: 1.2, height: 1.2, sill: 1.1 },
    ],
    S: [
      { story: 0, kind: 'window', offset: -3, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 0, kind: 'window', offset:  3, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 1, kind: 'window', offset: -3, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 1, kind: 'window', offset:  3, width: 1.2, height: 1.2, sill: 1.1 },
    ],
    E: [
      { story: 0, kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 1, kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: 1.1 },
    ],
    W: [
      { story: 0, kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: 1.1 },
      { story: 1, kind: 'window', offset: 0, width: 1.2, height: 1.2, sill: 1.1 },
    ],
  },
  // One or more staircases per building. Every entry is a separate
  // physical stair — the user picks a side, a width, and whether
  // this stair also reaches all the way through the roof so the
  // player emerges on the rooftop deck. Two stairs on the same
  // side clip each other, so the UI enforces sides via a
  // side-slot dropdown; internally we just render whatever the
  // author writes here.
  //
  // AAA COMPETITIVE-SHOOTER DEFAULTS (iter161):
  //   • width       2.4m — fits TWO 0.8m-diameter players side by
  //                        side with 0.8m of breathing room. Critical
  //                        for competitive team play (side-by-side
  //                        pushing, back-peel coverage, wide angles).
  //   • step_height 0.16 — well under STEP_UP=0.55m, gentle climb
  //                        rate at sprint (0.16/12 m/s = 13ms/step).
  //   • step_depth  0.42 — comfortable footprint. A tread ≥ 0.4m
  //                        keeps sprint-strafing sticky against the
  //                        stair surface (no per-step jitter).
  stairs: [
    {
      id: 'st_1',
      enabled: true,
      side: 'E',              // 'E' | 'W' | 'N' | 'S'
      width: 2.4,             // AAA: two players side-by-side
      step_height: 0.16,      // gentler climb than IRC max
      step_depth:  0.42,      // deeper tread for smooth footwork
      access_rooftop: false,  // punch a hole through the roof so
                              // this stair emerges on the roof deck
      handrails: true,        // twin railings along both long edges
      // Layout policy (iter168):
      //   'auto'       — pick straight/L/U based on available room
      //   'straight'   — force zigzag or single-run straight legs
      //   'switchback' — force the U-shape (180° switchback each story)
      //   'L'          — force the L-shape (90° turn each story)
      layout: 'auto',
      // When true AND the layout resolves to a straight run, all
      // stories go in the SAME direction — no zig-zag flip at each
      // landing. Produces one continuous straight run from ground
      // to roof (used for narrow lofts, warehouse gantries, etc.).
      single_run: false,
    },
  ],
});

// ── Internals ────────────────────────────────────────────────────────
const _SIDES = ['N', 'S', 'E', 'W'];
export const BUILDING_SIDES = _SIDES;
export const OPENING_KINDS = ['door', 'window'];
export const BUILDING_TYPES = ['residential', 'factory', 'office', 'warehouse'];
export const STAIR_LAYOUTS = ['auto', 'straight', 'switchback', 'L'];

/** Preset for a building's TYPE — swaps default dimensions,
 *  texture palette, roof style, and stair defaults so the author
 *  can quickly stamp a factory/office/warehouse without hand-tuning
 *  every field. Applied ONLY when the author flips the
 *  `building_type` dropdown to a non-residential value (via
 *  `applyBuildingTypePreset`). Residential = the existing defaults. */
export const BUILDING_TYPE_PRESETS = {
  residential: {
    label: 'Residential',
  },
  factory: {
    label: 'Factory',
    stories: 1,
    width: 24, depth: 18,
    story_height: 6.2,           // industrial ceiling clearance
    has_parapet: true, parapet_height: 0.6,
    has_interior_floors: false,  // one massive open floor plate
    has_floor_ledges: false,
    exterior_texture: 'industrial_metal_wall',
    exterior_color: '#5b6472',
    roof_texture: 'sheet_metal_ribbed',
    roof_color: '#3a3f48',
    interior_texture: 'warehouse_concrete_floor',
    interior_color: '#7a7a80',
    interior_rooms: { rows: 1, cols: 1, doorway_width: 3.0, doorway_height: 3.6, half_bath: false, half_bath_corner: 'NE', half_bath_size: 2.4, per_story: false },
    // Wide roll-up doors on two sides + skylight-style windows.
    openings: {
      N: [{ story: 0, kind: 'door',   offset: 0, width: 3.2, height: 3.6 }],
      S: [{ story: 0, kind: 'door',   offset: 0, width: 3.2, height: 3.6 }],
      E: [{ story: 0, kind: 'window', offset: 0, width: 4,   height: 1.8, sill: 3.6 }],
      W: [{ story: 0, kind: 'window', offset: 0, width: 4,   height: 1.8, sill: 3.6 }],
    },
    stairs: [],                 // factories don't get a stair by default
  },
  office: {
    label: 'Office Tower',
    stories: 5,
    width: 8, depth: 8,
    story_height: 3.2,
    has_parapet: true, parapet_height: 1.0,
    has_interior_floors: true,
    has_floor_ledges: true, ledge_depth: 0.14, ledge_thickness: 0.08,
    exterior_texture: 'facade_office_glass',
    exterior_color: '#4a5a70',
    roof_texture: 'asphalt_road',
    roof_color: '#22262c',
    interior_texture: 'warehouse_concrete_floor',
    interior_color: '#a8a89e',
    interior_rooms: { rows: 2, cols: 2, doorway_width: 1.4, doorway_height: 2.1, half_bath: true, half_bath_corner: 'NE', half_bath_size: 2.2, per_story: true },
    // Wall-to-wall glass windows on every floor, single ground-
    // floor door for entry.
    openings: {
      N: [
        { story: 0, kind: 'door',   offset: 0, width: 1.2, height: 2.4 },
        { story: 1, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
      ],
      S: [
        { story: 1, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 2, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 3, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
        { story: 4, kind: 'window', offset: 0, width: 5.0, height: 1.8, sill: 0.8 },
      ],
      E: [], W: [],
    },
    stairs: [{
      id: 'st_1', enabled: true, side: 'W',
      width: 2.4, step_height: 0.16, step_depth: 0.42,
      access_rooftop: true, handrails: true,
      layout: 'switchback',      // switchback for tall towers — reads AAA
      single_run: false,
    }],
  },
  warehouse: {
    label: 'Warehouse',
    stories: 1,
    width: 30, depth: 22,
    story_height: 7.4,
    has_parapet: false,          // clean flat roof, no lip
    has_interior_floors: false,
    has_floor_ledges: false,
    exterior_texture: 'industrial_metal_wall',
    exterior_color: '#7d5a3a',
    roof_texture: 'sheet_metal_ribbed',
    roof_color: '#3a3f48',
    interior_texture: 'warehouse_concrete_floor',
    interior_color: '#8a8880',
    interior_rooms: { rows: 1, cols: 1, doorway_width: 4.0, doorway_height: 4.2, half_bath: false, half_bath_corner: 'NE', half_bath_size: 2.4, per_story: false },
    openings: {
      N: [{ story: 0, kind: 'door',   offset: 0, width: 5.0, height: 4.5 }],
      S: [{ story: 0, kind: 'door',   offset: 0, width: 5.0, height: 4.5 }],
      E: [{ story: 0, kind: 'window', offset: 0, width: 5.0, height: 1.6, sill: 4.5 }],
      W: [{ story: 0, kind: 'window', offset: 0, width: 5.0, height: 1.6, sill: 4.5 }],
    },
    stairs: [],
  },
};

/** Apply a building-type preset to an existing spec — returns a
 *  fresh spec with the preset's fields overlaid on top of the
 *  DEFAULT_BUILDING baseline. Preserves the spec's `id`, `name`,
 *  and world position so switching type doesn't teleport buildings. */
export function applyBuildingTypePreset(spec, type) {
  const preset = BUILDING_TYPE_PRESETS[type] || BUILDING_TYPE_PRESETS.residential;
  const base = DEFAULT_BUILDING();
  return {
    ...base, ...preset,
    id: spec.id, name: spec.name || preset.label || 'Building',
    building_type: type,
    x: spec.x ?? 0, y: spec.y ?? 0, z: spec.z ?? 0, yaw: spec.yaw ?? 0,
  };
}

/** Sanity-clamp any spec loaded from disk so downstream math never
 *  divides by zero or renders zero-length boxes. Also migrates the
 *  legacy single-`stair` field into the modern `stairs: []` array
 *  so older saved buildings keep working without a data migration
 *  pass on the backend. */
function _sanitize(spec) {
  const clean = {
    ...spec,
    building_type: BUILDING_TYPES.includes(spec.building_type) ? spec.building_type : 'residential',
    stories:      Math.max(1, Math.min(8,  Math.round(spec.stories || 1))),
    width:        Math.max(2,   spec.width  || 8),
    depth:        Math.max(2,   spec.depth  || 8),
    story_height: Math.max(2.2, spec.story_height || 3.0),
    wall_thickness: Math.max(0.1, Math.min(1, spec.wall_thickness || 0.3)),
    parapet_height: Math.max(0.3, spec.parapet_height || 0.8),
    floor_thickness: Math.max(0.1, Math.min(0.5, spec.floor_thickness || 0.2)),
    has_floor_ledges: spec.has_floor_ledges !== false,
    ledge_depth: Math.max(0.05, Math.min(0.6, spec.ledge_depth ?? 0.18)),
    ledge_thickness: Math.max(0.04, Math.min(0.4, spec.ledge_thickness ?? 0.12)),
    interior_rooms: {
      rows: Math.max(1, Math.min(4, Math.round(spec.interior_rooms?.rows ?? 1))),
      cols: Math.max(1, Math.min(4, Math.round(spec.interior_rooms?.cols ?? 1))),
      doorway_width:  Math.max(0.9, Math.min(4, spec.interior_rooms?.doorway_width ?? 1.4)),
      doorway_height: Math.max(1.8, Math.min(4, spec.interior_rooms?.doorway_height ?? 2.1)),
      half_bath: !!spec.interior_rooms?.half_bath,
      half_bath_corner: ['NE','NW','SE','SW'].includes(spec.interior_rooms?.half_bath_corner) ? spec.interior_rooms.half_bath_corner : 'NE',
      half_bath_size: Math.max(1.6, Math.min(4, spec.interior_rooms?.half_bath_size ?? 2.4)),
      per_story: !!spec.interior_rooms?.per_story,
    },
  };
  if (!Array.isArray(clean.stairs)) {
    // Migration path — either a legacy `stair` object or nothing.
    // Legacy stairs default `access_rooftop` to false so nobody
    // suddenly loses their roof to an accidental hole.
    if (spec.stair && typeof spec.stair === 'object') {
      clean.stairs = [{
        id: spec.stair.id || 'st_legacy',
        enabled: spec.stair.enabled !== false,
        side: spec.stair.side || 'E',
        width: spec.stair.width ?? 1.4,
        step_height: spec.stair.step_height ?? 0.22,
        step_depth: spec.stair.step_depth ?? 0.34,
        access_rooftop: !!spec.stair.access_rooftop,
        handrails: spec.stair.handrails !== false,
        layout: 'auto', single_run: false,
      }];
    } else {
      clean.stairs = [];
    }
  } else {
    // Legacy stairs missing `layout`/`single_run` — backfill.
    clean.stairs = clean.stairs.map(s => ({
      layout: 'auto',
      single_run: false,
      ...s,
    }));
  }
  return clean;
}

/** Design a staircase for the given building spec. Returns a
 *  `plan` object whose `type` field is one of:
 *
 *    'straight' — one straight run per story, alternating
 *                 direction between stories so the top of story N
 *                 forms the bottom landing of story N+1. Requires
 *                 (D-2T) ≥ landing + runLen + landing on the run
 *                 axis.
 *    'L'        — a run + mid-landing + perpendicular run. Halves
 *                 the run length on each leg. Used when the run
 *                 axis is too short for a full straight staircase
 *                 with proper landings.
 *    'U'        — two parallel half-runs going in opposite
 *                 directions with a half-landing at the turn. Used
 *                 when the building is deep enough for only one
 *                 half-run but wide enough for two side by side.
 *    'none'     — no shape fits; the caller should skip the stair
 *                 and surface a warning in the editor.
 *
 *  Landings are sized for third-person sprint clearance (~1.4m or
 *  a little wider than the stair itself). Every plan guarantees:
 *    • the first step never touches a wall (bottom landing gap),
 *    • the last step never ends flush against the upstairs wall
 *      (top landing gap on the second-floor slab),
 *    • the stair is centred against its chosen interior face along
 *      the perp axis. */
function _planStair(spec, stairCfg) {
  if (!stairCfg || !stairCfg.enabled) return null;
  const S = stairCfg;
  const SH = spec.story_height;
  const T = spec.wall_thickness;
  const W = spec.width;
  const D = spec.depth;
  const stepH = S.step_height ?? 0.22;
  const stepD = S.step_depth  ?? 0.34;
  const stairWidth = S.width  ?? 1.4;
  const side = S.side || 'E';
  // Layout preference — 'auto' (default), or force a specific
  // shape. `single_run` is a straight-only tweak that keeps all
  // stories going the same direction.
  const layoutPref = S.layout || 'auto';
  const singleRun  = !!S.single_run;

  // Landings sized for a sprinting third-person character. 1.4m is
  // the SR4/Watch Dogs/GTA V benchmark for hallway clearance.
  const landing = Math.max(1.4, stairWidth * 1.15);

  // For E/W sides: stair runs along Z (uses D as run axis) and its
  // width extends along X (uses W as perp axis). Mirror for N/S.
  const runAxisLen  = (side === 'E' || side === 'W') ? (D - 2 * T) : (W - 2 * T);
  const perpAxisLen = (side === 'E' || side === 'W') ? (W - 2 * T) : (D - 2 * T);

  // How many steps do we want per story? Prefer the author's chosen
  // step_height. Compute the exact actualStepH so the top step lands
  // precisely on the next floor level (no half-step at the top).
  const stepsPerStory  = Math.max(6, Math.ceil(SH / stepH));
  const actualStepH    = SH / stepsPerStory;
  const runLen         = stepsPerStory * stepD;
  const perpNeeded     = stairWidth + 0.4;

  // Sub-step counts used by L / U layouts.
  const halfStepsPerLeg = Math.max(4, Math.ceil(stepsPerStory / 2));
  const halfStepH       = SH / (halfStepsPerLeg * 2);
  const halfRun         = halfStepsPerLeg * stepD;
  const midLanding      = Math.max(landing, stairWidth + 0.3);

  const straightFits = (landing + runLen + landing <= runAxisLen) && (perpNeeded <= perpAxisLen);
  const lFits =
    (landing + halfRun + midLanding <= runAxisLen) &&
    (midLanding + halfRun + landing <= perpAxisLen) &&
    (perpNeeded <= perpAxisLen) && (perpNeeded <= runAxisLen);
  const uFits =
    (landing + halfRun + midLanding <= runAxisLen) &&
    (2 * stairWidth + 0.3 <= perpAxisLen);

  const makeStraight = () => ({
    type: 'straight',
    side, stairWidth, stepH: actualStepH, stepD,
    landing, stepsPerStory, runLen,
    access_rooftop: !!stairCfg.access_rooftop,
    handrails: stairCfg.handrails !== false,
    single_run: singleRun,
    T, W, D, SH,
  });
  const makeL = () => ({
    type: 'L',
    side, stairWidth, stepH: halfStepH, stepD,
    landing, midLanding,
    halfStepsPerLeg, halfRun,
    access_rooftop: !!stairCfg.access_rooftop,
    handrails: stairCfg.handrails !== false,
    T, W, D, SH,
  });
  const makeU = () => ({
    type: 'U',
    side, stairWidth, stepH: halfStepH, stepD,
    landing, midLanding,
    halfStepsPerLeg, halfRun,
    access_rooftop: !!stairCfg.access_rooftop,
    handrails: stairCfg.handrails !== false,
    T, W, D, SH,
  });

  // Honour explicit layout choice when it fits; otherwise fall
  // through to the auto-selection order below.
  if (layoutPref === 'straight'   && straightFits) return makeStraight();
  if (layoutPref === 'L'          && lFits)        return makeL();
  if (layoutPref === 'switchback' && uFits)        return makeU();

  // ── AUTO ────────────────────────────────────────────────────
  if (straightFits) return makeStraight();
  if (lFits)        return makeL();
  if (uFits)        return makeU();

  return { type: 'none', reason: 'Building too small for stair. Widen or deepen the footprint.' };
}

/** Subtract a list of axis-aligned rectangular holes from a
 *  rectangle centred at (0,0) with size (W × D). Returns a list of
 *  sub-rectangles that tile the remaining area. Used to build
 *  interior floor slabs with stair wells punched through, and to
 *  cut skylights out of the roof.
 *
 *  Algorithm: start with one big tile; for each hole, split every
 *  tile that overlaps into up to 4 sub-tiles around the overlap.
 *  For our typical N ≤ 3 holes this stays well under a dozen output
 *  boxes. */
function _rectMinusHoles(W, D, holes) {
  let tiles = [{ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 }];
  for (const h of (holes || [])) {
    if (!h) continue;
    const next = [];
    for (const t of tiles) {
      const ix0 = Math.max(t.x0, h.x0);
      const ix1 = Math.min(t.x1, h.x1);
      const iz0 = Math.max(t.z0, h.z0);
      const iz1 = Math.min(t.z1, h.z1);
      if (ix1 <= ix0 + 0.02 || iz1 <= iz0 + 0.02) {
        // Hole doesn't clip this tile — pass it through unchanged.
        next.push(t);
        continue;
      }
      // Split into up to 4 sub-tiles around the intersection.
      if (t.z0 < iz0 - 0.02) next.push({ x0: t.x0, x1: t.x1, z0: t.z0, z1: iz0 });
      if (iz1 < t.z1 - 0.02) next.push({ x0: t.x0, x1: t.x1, z0: iz1, z1: t.z1 });
      if (t.x0 < ix0 - 0.02) next.push({ x0: t.x0, x1: ix0, z0: iz0, z1: iz1 });
      if (ix1 < t.x1 - 0.02) next.push({ x0: ix1, x1: t.x1, z0: iz0, z1: iz1 });
    }
    tiles = next;
  }
  return tiles.map(t => ({
    x: (t.x0 + t.x1) / 2,
    z: (t.z0 + t.z1) / 2,
    w: t.x1 - t.x0,
    d: t.z1 - t.z0,
  })).filter(p => p.w > 0.05 && p.d > 0.05);
}

/** Main entry — expand one building spec into a flat list of box
 *  primitives ready to be spread into `doc.objects`. Returns [] if
 *  the spec is missing an id (defensive). */
export function generateBuilding(rawSpec) {
  if (!rawSpec || !rawSpec.id) return [];
  const spec = _sanitize(rawSpec);
  const boxes = [];
  const {
    id: buildingId,
    stories, width: W, depth: D, story_height: SH,
    wall_thickness: T, yaw = 0,
  } = spec;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  // World-position helper: converts a local (lx, lz) into world
  // coords by rotating around the building origin then translating.
  //
  // Sign convention matches THREE.js' right-handed Y-rotation applied
  // by `mesh.rotation.y = yaw` and `group.rotation.y = yaw`:
  //   x' = lx * cos(yaw) + lz * sin(yaw)
  //   z' = -lx * sin(yaw) + lz * cos(yaw)
  //
  // The previous convention (x = lx*cos - lz*sin, z = lx*sin + lz*cos)
  // was a −yaw rotation, so world CENTRES rotated one way while each
  // emitted box carried yaw and rotated the other way — which sheared
  // the whole house apart at any yaw != 0 (iter151 USER REQUEST #3
  // regression). Positions and orientations must rotate in the SAME
  // direction for the group to stay rigid under any yaw.
  const world = (lx, lz) => ({
    x: (spec.x || 0) + lx * cy + lz * sy,
    z: (spec.z || 0) - lx * sy + lz * cy,
  });

  const emitBox = (part, lx, ly, lz, w, h, d, opts = {}) => {
    if (w < 0.05 || h < 0.05 || d < 0.05) return;
    const p = world(lx, lz);
    const box = {
      id: `${buildingId}_${part}_${boxes.length}`,
      _building_id: buildingId,
      _building_part: part,
      x: +p.x.toFixed(3), y: +((spec.y || 0) + ly).toFixed(3), z: +p.z.toFixed(3),
      yaw,
      w: +w.toFixed(3), h: +h.toFixed(3), d: +d.toFixed(3),
      color:     opts.color     ?? spec.exterior_color ?? '#8a6844',
      texture:   opts.texture   ?? spec.exterior_texture ?? '',
      collision: opts.collision !== false,
      climbable: !!opts.climbable,
    };
    // Iter161 phantom collision slopes — the buildingGen stair
    // pipeline emits a hidden wedge collider under each stair run
    // so competitive-shooter traversal reads as a smooth incline
    // rather than per-step Y-snaps. mapCustom3d skips the visual
    // mesh when `no_render` is set but keeps the collider.
    //
    // Iter162 `no_bullet` — the same phantom slopes are marked
    // no_bullet so RPGs / rifles / pipe-bombs don't detonate on
    // the invisible ~2.4m ceiling of the slope AABB (which fires
    // rockets shot horizontally OVER a stair back into the
    // shooter's face). The visible step boxes still block
    // projectiles at their actual heights, so the AAA-smooth
    // player movement smoothing has zero cost to combat.
    if (opts.no_render) box.no_render = true;
    if (opts.no_bullet) box.no_bullet = true;
    if (opts.slope)     box.slope     = opts.slope;
    if (opts.is_glass)  box.is_glass  = true;
    boxes.push(box);
  };

  const openings = spec.openings || {};

  // Helper: emit one wall along its local axis, cutting out any
  // openings on that side + story. Axis 'x' means the wall runs
  // along X (side N/S). Axis 'z' means it runs along Z (side E/W).
  // For N/S walls we keep the full width so corners look flush.
  // For E/W walls we cut the length by 2*T so they slot between
  // the N and S walls — no z-fighting or overlapping corner boxes.
  function emitWall(side, storyIndex) {
    const yBase = storyIndex * SH;
    const list = (openings[side] || []).filter(o => o.story === storyIndex)
                                        .sort((a, b) => a.offset - b.offset);
    const isNS = side === 'N' || side === 'S';
    const length = isNS ? W : (D - 2 * T);
    const sideCoord = (
      side === 'N' ?  (D / 2 - T / 2) :
      side === 'S' ? -(D / 2 - T / 2) :
      side === 'E' ?  (W / 2 - T / 2) :
                     -(W / 2 - T / 2)
    );

    let cursor = -length / 2;
    const pushSeg = (start, end, yStart, hh) => {
      const segLen = end - start;
      if (segLen < 0.05 || hh < 0.05) return;
      const centre = (start + end) / 2;
      if (isNS) emitBox(`wall_${side}_${storyIndex}`, centre, yStart + hh / 2, sideCoord, segLen, hh, T);
      else      emitBox(`wall_${side}_${storyIndex}`, sideCoord, yStart + hh / 2, centre, T, hh, segLen);
    };

    for (const o of list) {
      const halfW  = Math.max(0.3, o.width || 1.2) / 2;
      const left   = o.offset - halfW;
      const right  = o.offset + halfW;
      const sill   = o.kind === 'window' ? (o.sill ?? 1.1) : 0;
      const openH  = o.height ?? (o.kind === 'door' ? 2.2 : 1.2);
      const top    = sill + openH;
      if (left > cursor) pushSeg(cursor, left, yBase, SH);
      if (sill > 0)      pushSeg(left, right, yBase, sill);
      if (top  < SH)     pushSeg(left, right, yBase + top, SH - top);
      // AAA glass pane (iter168) — for every WINDOW opening we
      // drop a thin translucent slab in the cavity so windows
      // read as real glass at a distance. Emitted as a plain
      // emitBox with `is_glass:true` (mapCustom3d handles the
      // physically-based translucency) + collision off so the
      // player can shatter through them naturally on impact.
      if (o.kind === 'window' && openH > 0.1 && (right - left) > 0.1) {
        const paneCentre = (left + right) / 2;
        const paneW      = right - left - 0.02;      // gap for depth cue
        const paneH      = openH - 0.02;
        const paneY      = yBase + sill + openH / 2;
        // 0.06m thick — above emitBox's 0.05m minimum size floor.
        const paneT = 0.06;
        if (isNS) {
          emitBox(
            `glass_${side}_${storyIndex}_${(o.offset || 0).toFixed(2)}`,
            paneCentre, paneY, sideCoord, paneW, paneH, paneT,
            { collision: false, is_glass: true, color: '#8fb0d0', texture: '' },
          );
        } else {
          emitBox(
            `glass_${side}_${storyIndex}_${(o.offset || 0).toFixed(2)}`,
            sideCoord, paneY, paneCentre, paneT, paneH, paneW,
            { collision: false, is_glass: true, color: '#8fb0d0', texture: '' },
          );
        }
      }
      cursor = right;
    }
    if (cursor < length / 2) pushSeg(cursor, length / 2, yBase, SH);
  }

  // Emit interior floor slab for a story (skipped on the ground
  // floor — the map already has a floor). Accepts a list of holes
  // that punch clear of the stair. The un-holed portions of the
  // slab automatically serve as top landings for the story below.
  function emitInteriorFloor(storyIndex, holes) {
    if (!spec.has_interior_floors) return;
    if (storyIndex === 0) return;
    const yTop = storyIndex * SH;
    const ft   = spec.floor_thickness || 0.2;
    const parts = _rectMinusHoles(W - 2 * T, D - 2 * T, holes);
    for (const p of parts) {
      emitBox(
        `floor_${storyIndex}`, p.x, yTop - ft / 2, p.z, p.w, ft, p.d,
        { texture: spec.interior_texture, color: spec.interior_color, climbable: true },
      );
    }
  }

  // Flat roof + optional parapet (short surrounding wall — makes
  // rooftops feel like real playable arenas, hides shadow acne).
  // Accepts a list of holes: any stair with `access_rooftop=true`
  // registers its top-story stair run as a roof hole so the player
  // pops out onto the deck instead of hitting the underside.
  function emitRoof(holes) {
    if (!spec.has_roof) return;
    const yTop = stories * SH;
    const rt   = spec.floor_thickness || 0.2;
    const parts = _rectMinusHoles(W, D, holes || []);
    for (const p of parts) {
      emitBox(
        'roof', p.x, yTop + rt / 2, p.z, p.w, rt, p.d,
        { texture: spec.roof_texture, color: spec.roof_color, climbable: true },
      );
    }
    if (spec.has_parapet) {
      const ph = spec.parapet_height || 0.8;
      const yPar = yTop + rt;
      // N/S parapet walls (along X)
      emitBox('parapet_N',  0, yPar + ph / 2,  (D / 2 - T / 2), W, ph, T);
      emitBox('parapet_S',  0, yPar + ph / 2, -(D / 2 - T / 2), W, ph, T);
      // E/W parapet walls (along Z), cut short so corners fit
      emitBox('parapet_E',  (W / 2 - T / 2), yPar + ph / 2, 0, T, ph, D - 2 * T);
      emitBox('parapet_W', -(W / 2 - T / 2), yPar + ph / 2, 0, T, ph, D - 2 * T);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STAIRCASE EMISSION
  //
  // Every stair honours a strict gameplay contract:
  //   • Bottom landing: `plan.landing` metres of clear interior
  //     floor before the first step. Achieved by offsetting the
  //     first step inward from the near wall.
  //   • Top landing: same clearance beyond the last step. Achieved
  //     naturally by punching the story-above floor hole to stop
  //     short of the far wall.
  //   • Direction alternates between stories for straight stairs so
  //     the top of one story's stair forms the bottom landing of
  //     the next (classic zigzag).
  // ─────────────────────────────────────────────────────────────

  // Emit one straight step run and return the axis-aligned hole
  // rectangle that should be punched in the slab above so the
  // player can rise through cleanly.
  function _emitStraightRun(cfg) {
    const {
      storyIdx, legIdx, xFixed, zFixed, axisIsZ, startCoord, dir,
      steps, stepH, stepD, stairWidth, yBase, handrails,
    } = cfg;
    for (let i = 0; i < steps; i++) {
      const yStep = yBase + stepH * i;
      const coord = startCoord + dir * (stepD * i + stepD / 2);
      let lx, lz, w, d;
      if (axisIsZ) { lz = coord; lx = xFixed; w = stairWidth; d = stepD; }
      else         { lx = coord; lz = zFixed; w = stepD;      d = stairWidth; }
      emitBox(
        `stair_${storyIdx}_${legIdx}_${i}`,
        lx, yStep + stepH / 2, lz, w, stepH, d,
        { texture: spec.interior_texture, color: spec.interior_color, climbable: true },
      );
      // ── HANDRAILS ─────────────────────────────────────────────
      // Twin torso-height rails along both long edges of the stair.
      // Emitted per-step so they follow the slope naturally. Thin
      // (0.06m) along the perp axis and offset ~0.04m outside the
      // stair edge so a centre-line player never brushes them —
      // walkability of a 2.4m stair stays fully clear. They DO
      // block projectiles (real cover), but bullets fired down the
      // stair run naturally pass BETWEEN the two rails.
      if (handrails) {
        const railH   = 0.9;                        // torso height
        const railT   = 0.06;                       // thickness along perp axis
        const railY   = yStep + stepH + railH / 2;  // sit on top of step
        const perpOff = stairWidth / 2 + railT / 2;
        if (axisIsZ) {
          // Rails run along Z (with the stair), offset in ±X.
          emitBox(
            `stair_${storyIdx}_${legIdx}_${i}_rail_p`,
            lx + perpOff, railY, lz, railT, railH, d,
            { texture: spec.interior_texture, color: spec.interior_color },
          );
          emitBox(
            `stair_${storyIdx}_${legIdx}_${i}_rail_n`,
            lx - perpOff, railY, lz, railT, railH, d,
            { texture: spec.interior_texture, color: spec.interior_color },
          );
        } else {
          // Rails run along X (with the stair), offset in ±Z.
          emitBox(
            `stair_${storyIdx}_${legIdx}_${i}_rail_p`,
            lx, railY, lz + perpOff, w, railH, railT,
            { texture: spec.interior_texture, color: spec.interior_color },
          );
          emitBox(
            `stair_${storyIdx}_${legIdx}_${i}_rail_n`,
            lx, railY, lz - perpOff, w, railH, railT,
            { texture: spec.interior_texture, color: spec.interior_color },
          );
        }
      }
    }
    // ── PHANTOM COLLISION SLOPE (iter161) ───────────────────────
    // AAA competitive-shooter stair-feel — the visible step boxes
    // stay AABB colliders (blocks bullets, hides behind cover, etc.)
    // but we ALSO emit a HIDDEN slope collider covering the full
    // run footprint. The slope's top surface interpolates smoothly
    // from `yBase` at the LOW end to `yBase + stepH * steps` at the
    // HIGH end.
    //
    // `sampleSupportY` in engine3d takes MAX across probed points, so
    // wherever the slope's top exceeds the underlying step box top
    // (i.e. between step centres) the player walks on the slope
    // instead of jittering across step edges. Sprint-strafing UP or
    // DOWN a wide stair now reads as a single continuous incline —
    // no per-step Y-snap flicker at any move speed.
    //
    // The slope collider is marked `no_render:true` so mapCustom3d
    // skips its mesh but keeps the collider. `collision:true` is
    // implicit; `climbable:true` mirrors the stairs.
    const runFrom = startCoord;
    const runTo   = startCoord + dir * steps * stepD;
    const runLo   = Math.min(runFrom, runTo);
    const runHi   = Math.max(runFrom, runTo);
    // The slope's local Y coordinates are relative to `rampBase`
    // (the local BOTTOM of the wedge box). We drop rampBase 2cm
    // below the actual stair yBase so the wedge skirt doesn't
    // z-fight with the ground plane; the slope's LOW-end top
    // surface then sits at local Y = 0.02, i.e. world Y = yBase.
    // HIGH end: local Y = stepH*steps + 0.02 so world Y matches
    // the last step's top (yBase + stepH*steps) — verified in the
    // iter161 buildingGen phantom-slope integration tests.
    const yBottom = yBase;
    const yTop    = yBase + stepH * steps;
    const rampBase    = yBottom - 0.02;
    const yLowLocal   = 0.02;
    const yHighLocal  = (yTop - yBottom) + 0.02;
    // Slope tilt direction — dir=+1 means the run rises as `coord`
    // increases (yStart at runLo=start, yEnd at runHi=top). dir=−1
    // is the opposite: the top is at runLo, base at runHi.
    const yStartLocal = (dir > 0) ? yLowLocal  : yHighLocal;
    const yEndLocal   = (dir > 0) ? yHighLocal : yLowLocal;
    // Slope box centre + half-height in world.
    const rampH_local = Math.max(yStartLocal, yEndLocal);
    const rampCX = axisIsZ ? xFixed : (runLo + runHi) / 2;
    const rampCZ = axisIsZ ? (runLo + runHi) / 2 : zFixed;
    const rampW  = axisIsZ ? stairWidth : (runHi - runLo);
    const rampD  = axisIsZ ? (runHi - runLo) : stairWidth;
    emitBox(
      `stair_${storyIdx}_${legIdx}_ramp`,
      rampCX, rampBase + rampH_local / 2, rampCZ,
      rampW, rampH_local, rampD,
      {
        climbable: true,
        no_render: true,                    // invisible — pure collision
        no_bullet: true,                    // bullets/rockets/bombs pass through — visible step boxes still block
        slope: {
          yStart: yStartLocal,
          yEnd:   yEndLocal,
          axis:   axisIsZ ? 'z' : 'x',      // local box-space axis
        },
      },
    );
    return axisIsZ
      ? { x0: xFixed - stairWidth / 2, x1: xFixed + stairWidth / 2,
          z0: runLo, z1: runHi }
      : { x0: runLo, x1: runHi,
          z0: zFixed - stairWidth / 2,  z1: zFixed + stairWidth / 2 };
  }

  function _emitMidLanding(cfg) {
    const { storyIdx, legIdx, x, z, w, d, yLandingTop } = cfg;
    const ft = spec.floor_thickness || 0.2;
    emitBox(
      `stair_landing_${storyIdx}_${legIdx}`,
      x, yLandingTop - ft / 2, z, w, ft, d,
      { texture: spec.interior_texture, color: spec.interior_color, climbable: true },
    );
  }

  // Straight zigzag: story N ascends along the run axis in
  // direction +1 (even N) or −1 (odd N). Because each story ends
  // where the next starts, the un-holed floor at the top of one
  // story is automatically the bottom landing of the next.
  function _emitStraightZigzag(plan, holesByStory, roofHoles, stairSeq) {
    const { side, stairWidth, stepH, stepD, landing, stepsPerStory, handrails } = plan;
    const singleRun = !!plan.single_run;
    const axisIsZ = side === 'E' || side === 'W';
    const xFixed = axisIsZ
      ? (side === 'E' ? (W / 2 - T - stairWidth / 2) : -(W / 2 - T - stairWidth / 2))
      : 0;
    const zFixed = !axisIsZ
      ? (side === 'N' ? (D / 2 - T - stairWidth / 2) : -(D / 2 - T - stairWidth / 2))
      : 0;
    const runAxisMin = axisIsZ ? -(D / 2 - T) : -(W / 2 - T);
    const runAxisMax = axisIsZ ?  (D / 2 - T) :  (W / 2 - T);
    const stairFloors = plan.access_rooftop ? stories : Math.max(0, stories - 1);
    for (let s = 0; s < stairFloors; s++) {
      // Single-run stairs (iter168) keep the SAME direction on every
      // story so the whole staircase reads as one continuous run
      // instead of a switchback zigzag.
      const dir = singleRun ? +1 : ((s % 2 === 0) ? +1 : -1);
      const startCoord = (dir > 0) ? (runAxisMin + landing) : (runAxisMax - landing);
      const hole = _emitStraightRun({
        storyIdx: `${stairSeq}_s${s}`, legIdx: 0, xFixed, zFixed, axisIsZ,
        startCoord, dir, steps: stepsPerStory,
        stepH, stepD, stairWidth, yBase: s * SH,
        handrails,
      });
      (holesByStory[s + 1] ||= []).push(hole);
    }
    // Rooftop access: if this stair reaches the roof, punch the
    // same-shape hole through the roof slab so the player emerges
    // on the top deck instead of hitting the underside of the roof.
    // We also register a top-slab hole equal to the top-story
    // stair's exit region so the roof isn't just a stopper.
    if (plan.access_rooftop) {
      const topDir = ((stories - 1) % 2 === 0) ? +1 : -1;
      const topStart = (topDir > 0) ? (runAxisMin + landing) : (runAxisMax - landing);
      const rh = _stairRunRect({
        xFixed, zFixed, axisIsZ,
        startCoord: topStart, dir: topDir, steps: stepsPerStory,
        stepD, stairWidth,
        pad: 0.5,   // AAA roof cutout: 0.5m extra clearance on all sides
      });
      roofHoles.push(rh);
      // A tiny rooftop landing so the player steps out flush with the
      // roof deck surface (which sits `rt` above the top slab). Positioned
      // just past the top step in the exit direction.
      const rt = spec.floor_thickness || 0.2;
      const yTop = stories * SH;
      // Landing is placed a half-tread beyond the last step.
      const lastStepCoord = topStart + topDir * (stepsPerStory * stepD - stepD / 2);
      const landingCoord = lastStepCoord + topDir * (stairWidth / 2);
      const lx = axisIsZ ? xFixed : landingCoord;
      const lz = axisIsZ ? landingCoord : zFixed;
      const lw = axisIsZ ? stairWidth : stairWidth;
      const ld = axisIsZ ? stairWidth : stairWidth;
      emitBox(
        `stair_${stairSeq}_rooftop_landing`,
        lx, yTop + rt / 2, lz, lw, rt, ld,
        { texture: spec.roof_texture, color: spec.roof_color, climbable: true },
      );
    }
  }

  // Helper — pure geometry version of the run rect used both by
  // the emitter (for floor holes) and by rooftop-access (for the
  // roof hole).
  //
  // `pad` (metres) uniformly expands the rect on all sides. Roof
  // holes use pad ≈ 0.5m so the wider AAA stairs (2.4m) don't
  // scrape the player's shoulders as they emerge onto the deck.
  // Floor-slab holes stay pad=0 so interior walls remain flush
  // against the stair envelope.
  function _stairRunRect({ xFixed, zFixed, axisIsZ, startCoord, dir, steps, stepD, stairWidth, pad = 0 }) {
    const runTo = startCoord + dir * steps * stepD;
    return axisIsZ
      ? { x0: xFixed - stairWidth / 2 - pad, x1: xFixed + stairWidth / 2 + pad,
          z0: Math.min(startCoord, runTo) - pad, z1: Math.max(startCoord, runTo) + pad }
      : { x0: Math.min(startCoord, runTo) - pad, x1: Math.max(startCoord, runTo) + pad,
          z0: zFixed - stairWidth / 2 - pad,  z1: zFixed + stairWidth / 2 + pad };
  }

  // L-shape: Leg 1 climbs half-height along the primary side axis
  // from the near corner. A mid-landing at y=SH/2 turns the player
  // 90° inward, then Leg 2 climbs the rest along the perpendicular
  // axis. The same layout repeats for each story.
  function _emitLShape(plan, holesByStory, roofHoles, stairSeq) {
    const { side, stairWidth, stepH, stepD, landing, midLanding, halfStepsPerLeg, handrails } = plan;
    const axis1IsZ = side === 'E' || side === 'W';
    const xLeg1 = axis1IsZ
      ? (side === 'E' ? (W / 2 - T - stairWidth / 2) : -(W / 2 - T - stairWidth / 2))
      : 0;
    const zLeg1 = !axis1IsZ
      ? (side === 'N' ? (D / 2 - T - stairWidth / 2) : -(D / 2 - T - stairWidth / 2))
      : 0;
    const axis1Min = axis1IsZ ? -(D / 2 - T) : -(W / 2 - T);
    // Leg 2 heads inward on the perpendicular axis. E/N sides →
    // negative direction; W/S → positive. Keeps the geometry inside
    // the building instead of clipping through the far wall.
    const signPerp = (side === 'E' || side === 'N') ? -1 : +1;
    let lastLeg2Endpoint = null;
    // See _emitStraightZigzag — same story cap logic applies to L/U.
    const stairFloors = plan.access_rooftop ? stories : Math.max(0, stories - 1);
    for (let s = 0; s < stairFloors; s++) {
      const yBase       = s * SH;
      const startCoord1 = axis1Min + landing;
      const hole1 = _emitStraightRun({
        storyIdx: `${stairSeq}_s${s}`, legIdx: 0, xFixed: xLeg1, zFixed: zLeg1, axisIsZ: axis1IsZ,
        startCoord: startCoord1, dir: +1, steps: halfStepsPerLeg,
        stepH, stepD, stairWidth, yBase,
        handrails,
      });
      // Mid-landing centred just past the top of Leg 1.
      const midEndCoord    = startCoord1 + halfStepsPerLeg * stepD;
      const midCentreCoord = midEndCoord + midLanding / 2;
      const mlX = axis1IsZ ? xLeg1          : midCentreCoord;
      const mlZ = axis1IsZ ? midCentreCoord : zLeg1;
      _emitMidLanding({
        storyIdx: `${stairSeq}_s${s}`, legIdx: 0, x: mlX, z: mlZ,
        w: axis1IsZ ? stairWidth : midLanding,
        d: axis1IsZ ? midLanding : stairWidth,
        yLandingTop: yBase + SH / 2,
      });
      // Leg 2 starts adjacent to the mid-landing, heading inward.
      const startCoord2 = axis1IsZ
        ? (side === 'E' ? (W / 2 - T - stairWidth) : -(W / 2 - T - stairWidth))
        : (side === 'N' ? (D / 2 - T - stairWidth) : -(D / 2 - T - stairWidth));
      const axis2IsZ = !axis1IsZ;
      const xLeg2 = axis1IsZ ? startCoord2    : midCentreCoord;
      const zLeg2 = axis1IsZ ? midCentreCoord : startCoord2;
      const hole2 = _emitStraightRun({
        storyIdx: `${stairSeq}_s${s}`, legIdx: 1, xFixed: xLeg2, zFixed: zLeg2, axisIsZ: axis2IsZ,
        startCoord: startCoord2, dir: signPerp, steps: halfStepsPerLeg,
        stepH, stepD, stairWidth, yBase: yBase + SH / 2,
        handrails,
      });
      const list = (holesByStory[s + 1] ||= []);
      list.push(hole1);
      list.push(hole2);
      list.push(axis1IsZ
        ? { x0: xLeg1 - stairWidth / 2, x1: xLeg1 + stairWidth / 2,
            z0: midCentreCoord - midLanding / 2, z1: midCentreCoord + midLanding / 2 }
        : { x0: midCentreCoord - midLanding / 2, x1: midCentreCoord + midLanding / 2,
            z0: zLeg1 - stairWidth / 2,  z1: zLeg1 + stairWidth / 2 });
      if (s === stories - 1) {
        // Remember the top-story Leg 2 endpoint so we can drop a
        // rooftop landing box there if `access_rooftop` is set.
        lastLeg2Endpoint = {
          xFixed: xLeg2, zFixed: zLeg2, axisIsZ: axis2IsZ,
          startCoord: startCoord2, dir: signPerp, steps: halfStepsPerLeg,
          stepD, stairWidth, midCentreCoord, xLeg1, zLeg1,
        };
      }
    }
    if (plan.access_rooftop && lastLeg2Endpoint) {
      // Punch the roof over BOTH legs of the top L (players ascend
      // through the vertical column formed by Leg 1 + mid-landing +
      // Leg 2 → all three regions need to be open through the roof).
      const rh2 = _stairRunRect({ ...lastLeg2Endpoint, pad: 0.5 });
      roofHoles.push(rh2);
      // Rooftop exit landing.
      const rt = spec.floor_thickness || 0.2;
      const yTop = stories * SH;
      const runTo = lastLeg2Endpoint.startCoord + lastLeg2Endpoint.dir * lastLeg2Endpoint.steps * lastLeg2Endpoint.stepD;
      const lx = lastLeg2Endpoint.axisIsZ ? lastLeg2Endpoint.xFixed
        : runTo + lastLeg2Endpoint.dir * (lastLeg2Endpoint.stairWidth / 2);
      const lz = lastLeg2Endpoint.axisIsZ
        ? runTo + lastLeg2Endpoint.dir * (lastLeg2Endpoint.stairWidth / 2)
        : lastLeg2Endpoint.zFixed;
      emitBox(
        `stair_${stairSeq}_rooftop_landing`,
        lx, yTop + rt / 2, lz, lastLeg2Endpoint.stairWidth, rt, lastLeg2Endpoint.stairWidth,
        { texture: spec.roof_texture, color: spec.roof_color, climbable: true },
      );
    }
  }

  // Dispatcher — iterates over every stair in `spec.stairs`,
  // dispatches to the right shape emitter, and merges the per-story
  // floor-hole lists so a multi-stair building's slabs are punched
  // correctly. Also collects `roofHoles` for stairs that have
  // `access_rooftop` set, which the roof pass then subtracts.
  function emitStair(stairs) {
    const holesByStory = {};
    const roofHoles    = [];
    if (!Array.isArray(stairs)) return { holesByStory, roofHoles };
    let seq = 0;
    for (const s of stairs) {
      seq += 1;
      if (!s || !s.enabled) continue;
      const plan = _planStair(spec, s);
      if (!plan || plan.type === 'none') continue;
      if (plan.type === 'straight') _emitStraightZigzag(plan, holesByStory, roofHoles, `st${seq}`);
      else if (plan.type === 'L' || plan.type === 'U') _emitLShape(plan, holesByStory, roofHoles, `st${seq}`);
    }
    return { holesByStory, roofHoles };
  }

  // ── AAA architectural ledges (iter168) ───────────────────────
  // A thin decorative concrete band wrapping the exterior walls at
  // every floor line. Sits SLIGHTLY proud of the wall face (~0.18m
  // by default) and 0.12m tall. Climbable so parkour reads across
  // the facade — jump up onto a ledge, then mantle in through a
  // 2nd-floor window. Skipped when `has_floor_ledges = false` (set
  // by warehouse/factory presets that shouldn't have residential
  // trim on them).
  function emitFloorLedges() {
    if (!spec.has_floor_ledges) return;
    const ld = spec.ledge_depth ?? 0.18;
    const lt = spec.ledge_thickness ?? 0.12;
    // Emit a ledge at the TOP of every story so ledges land at
    // story-line height (e.g. y = SH, 2·SH, 3·SH, …). Skip the
    // very top when the roof already has a parapet — no need to
    // stack decoration on decoration.
    const nLedges = (spec.has_parapet ? stories - 1 : stories);
    for (let s = 0; s < nLedges; s++) {
      const yBand = (s + 1) * SH;
      const yc   = yBand - lt / 2;
      // Four ledge boxes wrapping the exterior. Each ledge is
      // pushed OUTWARD by ld/2 so the outer face sits (ld/2)
      // proud of the wall skin, and inward by wall_thickness/2
      // so it's flush with the outer wall face.
      const half = (n) => (n / 2) + ld / 2 - T / 2;
      // N (+Z) — runs along X, sits along the north wall
      emitBox(`ledge_N_${s}`, 0, yc,  half(D),          W + ld, lt, ld,
        { texture: spec.exterior_texture, color: spec.exterior_color, climbable: true });
      emitBox(`ledge_S_${s}`, 0, yc, -half(D),          W + ld, lt, ld,
        { texture: spec.exterior_texture, color: spec.exterior_color, climbable: true });
      emitBox(`ledge_E_${s}`,  half(W), yc, 0,          ld,     lt, D - 2 * T,
        { texture: spec.exterior_texture, color: spec.exterior_color, climbable: true });
      emitBox(`ledge_W_${s}`, -half(W), yc, 0,          ld,     lt, D - 2 * T,
        { texture: spec.exterior_texture, color: spec.exterior_color, climbable: true });
    }
  }

  // ── Interior partitions + half-bathroom (iter168) ────────────
  // Divides the story's interior into a rows × cols grid of
  // rooms. Each partition wall has one open doorway (no leaf) in
  // its centre. The half-bathroom, if enabled, is a small square
  // room in the specified corner with its OWN doorway.
  // Story loops call this once per story if `per_story` is true
  // (default false so ground-floor holds the layout).
  function emitInteriorPartitions(storyIndex) {
    const ir = spec.interior_rooms;
    if (!ir) return;
    if (storyIndex > 0 && !ir.per_story) return;
    const yBase = storyIndex * SH;
    const wallH = SH - 0.02;                    // stop just under the ceiling
    const dwWidth  = ir.doorway_width  ?? 1.4;
    const dwHeight = ir.doorway_height ?? 2.1;
    const innerW = W - 2 * T;
    const innerD = D - 2 * T;
    const xL = -innerW / 2, xR = innerW / 2;
    const zN =  innerD / 2, zS = -innerD / 2;

    // Emit a partition wall along a fixed X (running along Z),
    // punched at (x, zGap) for the doorway.
    const partAlongZ = (xFixed, zGap, id) => {
      const gapHalf = dwWidth / 2;
      const upperH = wallH - dwHeight;
      // Segment 1: from zS to zGap - gapHalf
      if (zGap - gapHalf > zS + 0.05) {
        const segLen = (zGap - gapHalf) - zS;
        emitBox(id + '_a', xFixed, yBase + wallH / 2, (zS + (zGap - gapHalf)) / 2, T, wallH, segLen,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      // Segment 2: from zGap + gapHalf to zN
      if (zN - (zGap + gapHalf) > 0.05) {
        const segLen = zN - (zGap + gapHalf);
        emitBox(id + '_b', xFixed, yBase + wallH / 2, ((zGap + gapHalf) + zN) / 2, T, wallH, segLen,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      // Segment 3: lintel over the doorway
      if (upperH > 0.05) {
        emitBox(id + '_lintel', xFixed, yBase + dwHeight + upperH / 2, zGap, T, upperH, dwWidth,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
    };
    // Mirror for a partition wall running along X (fixed Z).
    const partAlongX = (zFixed, xGap, id) => {
      const gapHalf = dwWidth / 2;
      const upperH = wallH - dwHeight;
      if (xGap - gapHalf > xL + 0.05) {
        const segLen = (xGap - gapHalf) - xL;
        emitBox(id + '_a', (xL + (xGap - gapHalf)) / 2, yBase + wallH / 2, zFixed, segLen, wallH, T,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      if (xR - (xGap + gapHalf) > 0.05) {
        const segLen = xR - (xGap + gapHalf);
        emitBox(id + '_b', ((xGap + gapHalf) + xR) / 2, yBase + wallH / 2, zFixed, segLen, wallH, T,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      if (upperH > 0.05) {
        emitBox(id + '_lintel', xGap, yBase + dwHeight + upperH / 2, zFixed, dwWidth, upperH, T,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
    };

    const rows = Math.max(1, ir.rows);
    const cols = Math.max(1, ir.cols);
    // Vertical partitions between columns (fixed X).
    for (let c = 1; c < cols; c++) {
      const xF = xL + (innerW * c) / cols;
      partAlongZ(xF, 0, `part_${storyIndex}_c${c}`);
    }
    // Horizontal partitions between rows (fixed Z).
    for (let r = 1; r < rows; r++) {
      const zF = zS + (innerD * r) / rows;
      partAlongX(zF, 0, `part_${storyIndex}_r${r}`);
    }

    // ── HALF BATHROOM ──────────────────────────────────────────
    if (ir.half_bath) {
      const bs = Math.max(1.6, ir.half_bath_size ?? 2.4);
      const corner = ir.half_bath_corner || 'NE';
      // Corner mapping: (NE/NW/SE/SW) → the two adjacent inner
      // walls of the story. Place a small L-shaped pair of walls
      // enclosing an interior box of size bs × bs, with a doorway
      // on ONE of the walls (facing the room's interior, away
      // from the corner).
      const signX = (corner === 'NE' || corner === 'SE') ? +1 : -1;
      const signZ = (corner === 'NE' || corner === 'NW') ? +1 : -1;
      const cx = signX * (innerW / 2 - bs / 2);
      const cz = signZ * (innerD / 2 - bs / 2);
      // Two walls: one facing -signX (interior X wall) and one
      // facing -signZ (interior Z wall). Put the doorway on the
      // longer perp wall — for a square bath both are equal so
      // pick the X-wall arbitrarily.
      const gapHalf = dwWidth / 2;
      const wallH   = SH - 0.02;
      const upperH  = wallH - dwHeight;
      // X-facing wall: at world x = cx - signX*bs/2, spans Z from cz-bs/2 to cz+bs/2
      const wx = cx - signX * bs / 2;
      const zLo = cz - bs / 2, zHi = cz + bs / 2;
      // Doorway centred on the wall
      const zGap = (zLo + zHi) / 2;
      // Segments around the doorway
      if (zGap - gapHalf > zLo + 0.05) {
        emitBox(`halfbath_${storyIndex}_x_a`, wx, yBase + wallH / 2, (zLo + (zGap - gapHalf)) / 2, T, wallH, (zGap - gapHalf) - zLo,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      if (zHi - (zGap + gapHalf) > 0.05) {
        emitBox(`halfbath_${storyIndex}_x_b`, wx, yBase + wallH / 2, ((zGap + gapHalf) + zHi) / 2, T, wallH, zHi - (zGap + gapHalf),
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      if (upperH > 0.05) {
        emitBox(`halfbath_${storyIndex}_x_lintel`, wx, yBase + dwHeight + upperH / 2, zGap, T, upperH, dwWidth,
          { texture: spec.interior_texture, color: spec.interior_color });
      }
      // Z-facing wall (solid, no doorway): at world z = cz - signZ*bs/2
      const wz = cz - signZ * bs / 2;
      emitBox(`halfbath_${storyIndex}_z`, cx, yBase + wallH / 2, wz, bs, wallH, T,
        { texture: spec.interior_texture, color: spec.interior_color });
    }
  }

  // ── Actual emission order ──
  // Emit stairs first so we can collect per-story floor holes and
  // per-roof-slab holes; the interior-floor + roof passes then punch
  // each slab with the matching holes.
  const { holesByStory, roofHoles } = emitStair(spec.stairs);
  for (let s = 0; s < stories; s++) {
    for (const side of _SIDES) emitWall(side, s);
    emitInteriorFloor(s, holesByStory[s] || []);
    emitInteriorPartitions(s);
  }
  emitRoof(roofHoles);
  emitFloorLedges();

  return boxes;
}

/** Inspect the stair layout for every stair on a spec. Returns
 *  an array of `{ id, type, reason?, side, access_rooftop }`
 *  entries in the same order as `spec.stairs`. The editor uses
 *  this to render a shape badge next to each stair row. */
export function analyzeStairs(spec) {
  if (!spec) return [];
  const sanitised = _sanitize(spec);
  return (sanitised.stairs || []).map(s => {
    if (!s || !s.enabled) return { id: s?.id, type: 'disabled', side: s?.side };
    const plan = _planStair(sanitised, s);
    if (!plan) return { id: s.id, type: 'disabled', side: s.side };
    return {
      id: s.id, type: plan.type, reason: plan.reason || null,
      side: s.side, access_rooftop: !!s.access_rooftop,
    };
  });
}

/** Back-compat single-stair inspector — returns the first entry
 *  or `{ type: 'disabled' }` if there are none. Kept because the
 *  BUILD tab's older UI still calls it. */
export function analyzeStair(spec) {
  const list = analyzeStairs(spec);
  return list[0] || { type: 'disabled' };
}

/** Regenerate the boxes for every building in the doc, replacing
 *  any previously emitted per-building boxes (tagged with
 *  `_building_id`). Preserves non-building objects untouched. */
export function rebuildAllBuildings(doc) {
  const buildings   = Array.isArray(doc.buildings) ? doc.buildings : [];
  const keptObjects = (doc.objects || []).filter(o => !o._building_id);
  const generated   = buildings.flatMap(b => generateBuilding(b));
  return { ...doc, objects: [...keptObjects, ...generated] };
}

/** Strip a single building's boxes from `objects`. Cheap — used
 *  when the author deletes a building without wanting to touch the
 *  other authored objects. */
export function stripBuildingBoxes(doc, buildingId) {
  return {
    ...doc,
    objects: (doc.objects || []).filter(o => o._building_id !== buildingId),
  };
}
