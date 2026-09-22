// roadGen.js — procedural road network for MapEditor3D.
//
// Data model: a road NETWORK is a graph of `nodes` (intersections,
// dead-ends, junctions) and `edges` (straight-line segments joining
// two nodes). Each edge carries road-type params (width, lanes,
// sidewalk width, curb height, materials). Same architectural
// pattern as buildingGen.js: one pure `generateRoadNetwork(spec)`
// call expands the graph into axis-aligned + yawed box primitives
// that plug directly into the same renderer + collision layer the
// rest of the editor uses. Each emitted box is tagged with
// `_road_id` (network-scope) and `_road_part` so the editor can
// strip + regen on any change without touching author-drawn boxes.
//
// Phase 1 scope (what this file implements):
//   • Straight edges (no curves — those come in Phase 2)
//   • Auto sidewalks along both sides of every edge
//   • Auto curbs along both sides of every sidewalk
//   • Auto intersections at any node with degree ≥ 2 (T + 4-way +
//     angled junctions all handled by the same shrink-and-fill
//     approach)
//   • Dead-end caps for degree-1 nodes
//   • 8 road-type presets (residential / downtown / industrial /
//     commercial / highway / alley / parking / service)
//   • Corner bevel: 1.5m intersection pad on every side so edges
//     stop short of the raw crossing and the corner has room for
//     future furniture (hydrant, lamp, stop sign)
//
// Phase 2+ (documented, not shipped): curved arcs via control
// midpoints, cul-de-sacs, crosswalks/lane markings, furniture
// snap slots, bridges/ramps, terrain conformance, building
// setback + driveway auto-connection.

// ── Road-type presets ────────────────────────────────────────────
// Each preset is a partial edge spec that the ROAD tab spreads into
// a new edge whenever the author picks that type. Numbers were
// picked to feel right for a third-person shooter — wide enough
// for a hover-cover firefight, narrow enough that a straight sprint
// crosses in under two seconds.
export const ROAD_TYPES = [
  'residential', 'downtown', 'industrial', 'commercial',
  'highway', 'alley', 'parking', 'service', 'driveway',
];

export const ROAD_TYPE_PRESETS = {
  residential: {
    road_width: 6.5, lanes: 2, lane_width: 3.25, sidewalk_width: 2, curb_height: 0.16,
    asphalt_color: '#2c2c2c', sidewalk_color: '#a09082',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  downtown: {
    road_width: 11, lanes: 4, lane_width: 2.75, sidewalk_width: 3.2, curb_height: 0.2,
    asphalt_color: '#1f1f21', sidewalk_color: '#888884',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  industrial: {
    road_width: 9, lanes: 2, lane_width: 4.5, sidewalk_width: 1.8, curb_height: 0.15,
    asphalt_color: '#28282a', sidewalk_color: '#7a7a72',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  commercial: {
    road_width: 8, lanes: 2, lane_width: 4, sidewalk_width: 2.6, curb_height: 0.18,
    asphalt_color: '#24242a', sidewalk_color: '#9a9088',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  highway: {
    road_width: 14, lanes: 4, lane_width: 3.5, sidewalk_width: 0, curb_height: 0.3,
    asphalt_color: '#191a1c', sidewalk_color: '#666666',
    asphalt_texture: 'asphalt_road', sidewalk_texture: '',
  },
  alley: {
    road_width: 3.6, lanes: 1, lane_width: 3.6, sidewalk_width: 0, curb_height: 0.1,
    asphalt_color: '#31312e', sidewalk_color: '#7a7a70',
    asphalt_texture: 'asphalt_road', sidewalk_texture: '',
  },
  parking: {
    road_width: 12, lanes: 0, lane_width: 3, sidewalk_width: 1.4, curb_height: 0.14,
    asphalt_color: '#28282a', sidewalk_color: '#a09082',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  service: {
    road_width: 5, lanes: 1, lane_width: 5, sidewalk_width: 1.2, curb_height: 0.12,
    asphalt_color: '#26262a', sidewalk_color: '#909084',
    asphalt_texture: 'asphalt_road', sidewalk_texture: 'concrete_sidewalk',
  },
  driveway: {
    // Narrow private connector used by "CONNECT TO ROAD" on the
    // BUILD tab. No sidewalks (it terminates at the building) and a
    // low curb so vehicles can pull straight in.
    road_width: 3.0, lanes: 1, lane_width: 3.0, sidewalk_width: 0, curb_height: 0.06,
    asphalt_color: '#3a382f', sidewalk_color: '#000000',
    asphalt_texture: 'concrete_sidewalk', sidewalk_texture: '',
  },
};

// Intersection corner-bevel padding (in metres). The user asked for
// a 1.5m fixed default that matches the building wall-thickness
// vibe: every edge stops this far short of its incident node so
// the corner has room to breathe (and to host furniture in
// Phase 2/3).
export const CORNER_BEVEL = 1.5;

// Curb visual thickness (perpendicular to the road). Kept small —
// its main job is to sell the raised-sidewalk profile, not to
// block player movement, per the gameplay contract.
const CURB_THICKNESS = 0.14;

// ── Factory helpers used by MapEditor3D ─────────────────────────
export function newRoadNetwork() { return { nodes: [], edges: [] }; }

export function newRoadNode({ x, z, y = 0 }) {
  return {
    id: '',
    x: +(+x).toFixed(2),
    z: +(+z).toFixed(2),
    y: +(+y).toFixed(2),
  };
}

export function newRoadEdge({ a, b, type = 'residential' }) {
  return {
    id: '',
    a, b,
    type,
    ...ROAD_TYPE_PRESETS[type],
  };
}

/** Return the id of the nearest existing node within `snapDist`
 *  metres of (x, z), or null if nothing is close enough. Used by
 *  the click-to-place UX to snap-and-share endpoints instead of
 *  spawning a duplicate node on top of an existing one. */
export function nearestNode(network, x, z, snapDist = 3) {
  let bestId = null, bestD2 = snapDist * snapDist;
  for (const n of (network?.nodes || [])) {
    const dx = n.x - x, dz = n.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestId = n.id; }
  }
  return bestId;
}

/** Project point (px, pz) onto segment A→B and return the closest
 *  point, the segment-parameter `t` (0 at A, 1 at B) and the
 *  distance. Used by "CONNECT TO ROAD" to split an edge at the
 *  spot nearest to a building's front door. */
export function closestPointOnEdgeSegment(px, pz, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const abLen2 = abx * abx + abz * abz;
  if (abLen2 < 1e-6) {
    return { x: a.x, z: a.z, t: 0, dist: Math.hypot(px - a.x, pz - a.z) };
  }
  const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (pz - a.z) * abz) / abLen2));
  const cx = a.x + t * abx;
  const cz = a.z + t * abz;
  return { x: cx, z: cz, t, dist: Math.hypot(px - cx, pz - cz) };
}

/** Iterate every edge in the network and return the closest
 *  { edge, point, t, dist } to (px, pz), or null if the network is
 *  empty. The Y of the returned point is linearly interpolated from
 *  the endpoints' Y so an auto-driveway can dock onto an elevated
 *  bridge without ending mid-air. */
export function findClosestEdgePoint(network, px, pz) {
  const nodes = network?.nodes || [];
  const edges = network?.edges || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  let best = null;
  for (const edge of edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (!a || !b) continue;
    const proj = closestPointOnEdgeSegment(px, pz, a, b);
    if (best === null || proj.dist < best.dist) {
      const y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * proj.t;
      best = { edge, a, b, ...proj, y };
    }
  }
  return best;
}

// ── Internals ────────────────────────────────────────────────────
function _degree(edges, nodeId) {
  let d = 0;
  for (const e of edges) if (e.a === nodeId || e.b === nodeId) d++;
  return d;
}

function _neighbourEdges(edges, nodeId) {
  return edges.filter(e => e.a === nodeId || e.b === nodeId);
}

/** Compute the "inset" at a node — the distance the incident edge
 *  should be shrunk on the node side so its asphalt stops before
 *  the intersection tile takes over. Inset = half the widest
 *  incident road + the corner bevel pad. For degree-1 (dead-end)
 *  nodes the inset is 0 — the edge terminates flush with the cap. */
function _nodeInset(node, edges) {
  const inc = _neighbourEdges(edges, node.id);
  if (inc.length < 2) return 0;
  const maxWidth = inc.reduce((m, e) => Math.max(m, e.road_width || 6.5), 0);
  return maxWidth / 2 + CORNER_BEVEL;
}

/** Half-width along the perpendicular axis for the "sidewalk +
 *  curb" belt on one side of a road. Used both by edge emission
 *  (to place sidewalk/curb strips at the right offset) and by
 *  intersection emission (to size the sidewalk frame around the
 *  central asphalt tile). */
function _sidewalkOffset(edge) {
  return (edge.road_width || 6.5) / 2 + (edge.sidewalk_width || 0) / 2;
}
function _curbOffset(edge) {
  return (edge.road_width || 6.5) / 2 + CURB_THICKNESS / 2;
}

/** Y-height at which the sidewalk sits above the asphalt. Uses the
 *  edge's own curb height so shorter curbs on residential streets
 *  don't visually merge with tall highway curbs. */
function _sidewalkTop(edge) { return (edge.curb_height || 0.15) + 0.05; }

// ── Main entry ───────────────────────────────────────────────────
/** Expand a road network into a flat list of box primitives ready
 *  to spread into `doc.objects`. Each box carries `_road_id` (the
 *  network id — always the string 'road' for now since the doc has
 *  a single network) and `_road_part` describing what it is (e.g.
 *  'asphalt', 'sw_L', 'curb_R', 'inter_frame_N'). */
export function generateRoadNetwork(network) {
  if (!network || !Array.isArray(network.edges)) return [];
  const nodes = network.nodes || [];
  const edges = network.edges || [];
  const boxes = [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Cache per-node intersection inset so we don't recompute it for
  // every incident edge.
  const insetById = new Map();
  for (const n of nodes) insetById.set(n.id, _nodeInset(n, edges));

  const emit = (part, x, y, z, w, h, d, yaw, opts = {}) => {
    if (w < 0.05 || h < 0.02 || d < 0.05) return;
    const box = {
      id: `road_${part}_${boxes.length}`,
      _road_id: 'road',
      _road_part: part,
      x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3),
      yaw: +yaw.toFixed(4),
      w: +w.toFixed(3), h: +h.toFixed(3), d: +d.toFixed(3),
      color:     opts.color     ?? '#2a2a2a',
      texture:   opts.texture   ?? '',
      collision: opts.collision !== false,
      climbable: !!opts.climbable,
    };
    // Slope hint (iter159) — when the emitter wants this box's TOP
    // face to tilt (auto-smooth road ramp, driveway) it passes
    // `opts.slope = { yStart, yEnd, axis }` in LOCAL box space (i.e.
    // relative to the box's bottom face). mapCustom3d picks this
    // up, builds the wedge visual + slope collider, so the runtime
    // walkable surface tracks the visual ramp perfectly.
    if (opts.slope) box.slope = opts.slope;
    boxes.push(box);
  };

  // ── Edge emission ─────────────────────────────────────────────
  // Straight edges. Each edge produces (at most):
  //   • one asphalt tile (or a stepped ramp if node A.y ≠ node B.y)
  //   • two sidewalk strips (one per side) if sidewalk_width > 0
  //   • two curb strips (one per side) if sidewalk_width > 0
  //   • vertical support columns underneath if the edge is a
  //     "bridge" (both endpoints elevated ≥ 0.5m above ground)
  //
  // Both sidewalks and curbs are shrunk by the incident nodes'
  // intersection insets so they never overlap the intersection
  // frame. The asphalt tile is shrunk half as much — that gives
  // the classic "asphalt bleeds into the intersection but the
  // sidewalks stop short and let the intersection sidewalk frame
  // handle the corner" look.
  //
  // Ramp handling (Phase 3, 1a — "stepped ramp"): when the two
  // endpoints sit at different Y heights the emitter subdivides the
  // edge into ~1.5m-long sub-tiles, each stepped upward toward the
  // higher endpoint. The runtime engine already handles
  // small-vertical-step traversal via its ledge-climb path, so no
  // engine changes were needed.
  for (const edge of edges) {
    const nA = nodeById.get(edge.a);
    const nB = nodeById.get(edge.b);
    if (!nA || !nB) continue;
    const dx = nB.x - nA.x;
    const dz = nB.z - nA.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const yaw = Math.atan2(dz, dx);
    const perpX = -Math.sin(yaw);
    const perpZ =  Math.cos(yaw);

    const rw   = edge.road_width || 6.5;
    const sw   = edge.sidewalk_width || 0;
    const ch   = edge.curb_height || 0.15;
    const swH  = _sidewalkTop(edge);
    const swOff = _sidewalkOffset(edge);
    const cbOff = _curbOffset(edge);

    const yA = nA.y || 0;
    const yB = nB.y || 0;
    const dY = yB - yA;
    const isRamp = Math.abs(dY) > 0.05;

    // Insets: asphalt shrinks by half (so it reaches into the
    // intersection tile and hides any Y-fighting seam) while the
    // sidewalk / curb strips shrink by the full inset (so they
    // stop cleanly at the frame edge).
    const insetA = insetById.get(edge.a) || 0;
    const insetB = insetById.get(edge.b) || 0;
    const asphaltInsetA = insetA * 0.55;
    const asphaltInsetB = insetB * 0.55;
    const swInsetA = insetA;
    const swInsetB = insetB;

    /** Emit one segment tile at the middle of (t0, t1). `perpDist=0`
     *  emits a single centred tile; non-zero emits BOTH left and
     *  right strips (used for sidewalks + curbs). `yStart` and
     *  `yEnd` bracket the ramp height across this sub-tile so we
     *  can interpolate the tile's centre Y — for flat edges caller
     *  passes yStart=yEnd=yA. */
    const emitTile = (part, t0, t1, perpDist, yStart, yEnd, height, thickness, opts) => {
      const segLen = len * (t1 - t0);
      if (segLen < 0.05) return;
      const midT   = (t0 + t1) / 2;
      const cx     = nA.x + dx * midT;
      const cz     = nA.z + dz * midT;
      const yMid   = (yStart + yEnd) / 2;
      if (perpDist === 0) {
        emit(part, cx, yMid + height / 2, cz, segLen, height, thickness, yaw, opts);
      } else {
        emit(`${part}_L`, cx + perpX * perpDist, yMid + height / 2, cz + perpZ * perpDist, segLen, height, thickness, yaw, opts);
        emit(`${part}_R`, cx - perpX * perpDist, yMid + height / 2, cz - perpZ * perpDist, segLen, height, thickness, yaw, opts);
      }
    };

    /** Subdivide the effective segment (after insets) into N sub-
     *  tiles for ramps, or emit a single tile for flat edges. The
     *  sub-tile count is bounded from both directions:
     *   • at least one tile per 1.5m of horizontal run, and
     *   • at least one tile per 0.5m of vertical rise (so the per-
     *     step riser never exceeds the engine's STEP_UP height of
     *     0.55m — otherwise steep ramps become invisible walls).
     *
     *  Adjacent tiles are also given an overlapping Y-skirt: each
     *  tile extends downward to the previous step's top surface
     *  plus a 5cm overlap so the ramp reads as one solid stepped
     *  ramp rather than a row of floating slabs.
     *
     *  AUTO-SMOOTH SLOPE (iter159): when the incline is gentle
     *  enough (rise/run ≤ 0.4 ≈ 22°) OR the edge is a DRIVEWAY (which
     *  should always ramp smoothly, no visible risers) AND the yaw
     *  is axis-aligned (within 15° of 0 / ±π/2 / π), emit ONE box
     *  with a `slope` hint that mapCustom3d turns into a wedge mesh
     *  + slope collider. The runtime engine (engine3d.js
     *  `sampleSupportY` + `topAt` slope branch) interpolates the
     *  walkable height perfectly so sprinting up a driveway feels
     *  like a real ramp. Non-axis-aligned yawed ramps fall back to
     *  the stepped path — the axis-aligned world-slope collider
     *  wouldn't match a rotated wedge accurately enough for AAA
     *  feel. Steep grades (>22°) also stay stepped so the risers
     *  are visible as actual stairs, which is more readable at
     *  gameplay pace than a floaty smooth slope. */
    const emitEdgePart = (part, insetStart, insetEnd, perpDist, height, thickness, opts) => {
      const effLen = len - insetStart - insetEnd;
      if (effLen < 0.3) return;
      const startT = insetStart / len;
      const endT   = 1 - insetEnd / len;
      if (!isRamp) {
        emitTile(part, startT, endT, perpDist, yA, yA, height, thickness, opts);
        return;
      }
      // Compute the AUTO-SMOOTH viability. Requires:
      //   • Yaw within 15° of an axis (|cos|>0.966 or |sin|>0.966)
      //   • Grade ≤ 0.4 rise/run OR the edge is a driveway (which
      //     is authoritatively a smooth ramp by design)
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const axisAligned = Math.abs(cosY) > 0.966 || Math.abs(sinY) > 0.966;
      const grade = Math.abs(dY) / Math.max(0.5, effLen);
      const isDriveway = edge.road_type === 'driveway' || edge.type === 'driveway';
      const canSmooth = axisAligned && (isDriveway || grade <= 0.4);
      if (canSmooth) {
        // Effective per-tile endpoints Y (in world). The inset means
        // the visible ramp doesn't reach all the way to the raw node
        // Y — recompute the endpoint Ys at the inset boundaries.
        const yStartW = yA + dY * startT;
        const yEndW   = yA + dY * endT;
        // Base Y sits 5cm below the low end so the ramp visually
        // meets the ground/road tile at the low endpoint without
        // a hovering seam.
        const baseY = Math.min(yStartW, yEndW) - 0.05;
        const yS_local = yStartW - baseY;
        const yE_local = yEndW - baseY;
        // Box "height" for the collider AABB — the top face's max Y.
        // Add the requested part height so sidewalks sit above the
        // wedge asphalt with the correct raised profile.
        const h_visual = Math.max(yS_local, yE_local) + height;
        const centre_y = baseY + h_visual / 2;
        const midT = (startT + endT) / 2;
        const cx = nA.x + dx * midT;
        const cz = nA.z + dz * midT;
        const emitOpts = { ...opts, slope: { yStart: yS_local, yEnd: yE_local, axis: 'x' } };
        if (perpDist === 0) {
          emit(`${part}_smooth`, cx, centre_y, cz, effLen, h_visual, thickness, yaw, emitOpts);
        } else {
          emit(`${part}_smooth_L`, cx + perpX * perpDist, centre_y, cz + perpZ * perpDist, effLen, h_visual, thickness, yaw, emitOpts);
          emit(`${part}_smooth_R`, cx - perpX * perpDist, centre_y, cz - perpZ * perpDist, effLen, h_visual, thickness, yaw, emitOpts);
        }
        return;
      }
      // Stepped-ramp fallback (steep grade OR yawed diagonally). Split
      // into segments long enough that no single riser exceeds ~0.5m
      // (< engine STEP_UP = 0.55). 2cm overlap along the edge axis
      // hides seams between adjacent risers.
      const nSubs = Math.max(6, Math.ceil(effLen / 1.5), Math.ceil(Math.abs(dY) / 0.5));
      const riser = Math.abs(dY) / nSubs;
      const solidH = height + riser + 0.05;
      for (let i = 0; i < nSubs; i++) {
        const t0 = startT + (endT - startT) * (i     / nSubs);
        const t1 = startT + (endT - startT) * ((i + 1) / nSubs);
        const yMid = yA + dY * ((t0 + t1) / 2);
        const overlap = 0.02 / len;
        const t0o = Math.max(startT, t0 - overlap);
        const t1o = Math.min(endT,   t1 + overlap);
        const yTop = yMid + height / 2;
        const yBottom = yTop - solidH;
        const yCentre = (yTop + yBottom) / 2;
        const segLen = len * (t1o - t0o);
        const midT   = (t0o + t1o) / 2;
        const cx     = nA.x + dx * midT;
        const cz     = nA.z + dz * midT;
        if (perpDist === 0) {
          emit(`${part}_${i}`, cx, yCentre, cz, segLen, solidH, thickness, yaw, opts);
        } else {
          emit(`${part}_${i}_L`, cx + perpX * perpDist, yCentre, cz + perpZ * perpDist, segLen, solidH, thickness, yaw, opts);
          emit(`${part}_${i}_R`, cx - perpX * perpDist, yCentre, cz - perpZ * perpDist, segLen, solidH, thickness, yaw, opts);
        }
      }
    };

    // Asphalt: single wide tile down the middle (or a stepped ramp).
    emitEdgePart(`asphalt_${edge.id}`, asphaltInsetA, asphaltInsetB, 0, 0.05, rw, {
      color: edge.asphalt_color, texture: edge.asphalt_texture, climbable: true,
    });

    if (sw > 0.01) {
      // Sidewalks (raised — they sit `swH` above the asphalt).
      emitEdgePart(`sw_${edge.id}`, swInsetA, swInsetB, swOff, swH, sw, {
        color: edge.sidewalk_color, texture: edge.sidewalk_texture, climbable: true,
      });
      // Curbs (thin, taller than sidewalk lip so the profile reads
      // from the driver's-eye camera).
      emitEdgePart(`curb_${edge.id}`, swInsetA, swInsetB, cbOff, ch, CURB_THICKNESS, {
        color: '#4a4a4a', texture: '', climbable: false,
      });
    }

    // Bridge supports: if the deck runs at least ~0.6m above ground
    // for its whole length we drop vertical stone columns so it
    // doesn't look like the road floats. Column count is picked so
    // every ~8m of span gets one column AND every elevated span has
    // at least one — a 12m bridge previously emitted zero, which
    // looked comically airborne. Not emitted for a pure ramp (one
    // endpoint on the ground) — that reads as a hill, not a bridge.
    const minDeckY = Math.min(yA, yB);
    if (minDeckY > 0.6) {
      // Aim for one column every ~8m, rounded to the nearest even
      // number ≥ 2 so we always have at least one interior column
      // to render.
      const nCols = Math.max(2, Math.round(len / 8));
      for (let i = 1; i < nCols; i++) {
        const t     = i / nCols;
        const cx    = nA.x + dx * t;
        const cz    = nA.z + dz * t;
        const yTop  = yA + dY * t;    // deck base at this point
        if (yTop < 0.4) continue;
        emit(
          `bridge_col_${edge.id}_${i}`,
          cx, yTop / 2, cz,
          0.6, yTop, 0.6, 0,
          { color: '#4a4a4a', texture: '', collision: true, climbable: false },
        );
      }
    }
  }

  // ── Node emission ─────────────────────────────────────────────
  // Intersection tile at nodes with degree ≥ 2 + dead-end cap at
  // degree-1 nodes. Zero-degree nodes emit nothing (they're just
  // scratch placement points).
  for (const n of nodes) {
    const inc = _neighbourEdges(edges, n.id);
    if (inc.length === 0) continue;

    if (inc.length === 1) {
      // ── Dead-end ────────────────────────────────────────────
      // Emit a short sidewalk cap crossing the road end so the
      // player doesn't sprint off into empty space. Curb wraps
      // around the cap. The asphalt itself already reaches the
      // node point (inset is 0 for degree-1), so we just add the
      // perpendicular cap piece.
      const e = inc[0];
      // Direction pointing INTO the road (from node toward the
      // other endpoint).
      const other = nodeById.get(e.a === n.id ? e.b : e.a);
      if (!other) continue;
      const dxo = other.x - n.x, dzo = other.z - n.z;
      const l = Math.hypot(dxo, dzo);
      if (l < 0.5) continue;
      const yawIn = Math.atan2(dzo, dxo);
      // "Out" direction — perpendicular to the road, pointing away
      // from the node. Cap sits on the far side of the node.
      const outX = -dxo / l;
      const outZ = -dzo / l;
      const sw = e.sidewalk_width || 0;
      const rw = e.road_width || 6.5;
      const ch = e.curb_height || 0.15;
      if (sw > 0.01) {
        const swH = _sidewalkTop(e);
        // Sidewalk cap: sits ACROSS the road end. Because the box's
        // yaw matches the road direction, its local X aligns with
        // the road axis — so the "along-road" dimension is `w` and
        // the "across-road" dimension is `d`. The cap is thin
        // (~sw) along the road and full-width (rw + 2*sw) across
        // it. Bug fixed in iter 145: the arguments used to be
        // swapped, producing a raised slab down the middle of the
        // carriageway instead of a proper terminator.
        const nY = n.y || 0;
        emit(
          `deadend_sw_${n.id}`,
          n.x + outX * (sw / 2),
          nY + swH / 2,
          n.z + outZ * (sw / 2),
          sw, swH, rw + 2 * sw,
          yawIn,
          { color: e.sidewalk_color, texture: e.sidewalk_texture, climbable: true },
        );
        // Curb cap: matching orientation, thin along the road, full
        // road-width across.
        emit(
          `deadend_curb_${n.id}`,
          n.x + outX * (CURB_THICKNESS / 2),
          nY + ch / 2,
          n.z + outZ * (CURB_THICKNESS / 2),
          CURB_THICKNESS, ch, rw,
          yawIn,
          { color: '#4a4a4a', texture: '' },
        );
      }
      continue;
    }

    // ── Intersection (degree ≥ 2) ────────────────────────────
    // A central asphalt square + a picture-frame sidewalk around
    // it. The frame is oriented axis-aligned since we don't know
    // the "canonical" road direction at a >2 junction. Any
    // incident edge cuts through the frame; because that edge's
    // sidewalk was shrunk by the inset, the frame's opening on
    // that side is naturally clear — the frame is a full square
    // and the edges just happen not to overlap in the corners.
    //
    // The frame is composed of FOUR corner sidewalk pads so the
    // 1.5m corner bevel reads as physical geometry the author can
    // later dock furniture to. Roads that enter through a corner
    // (rare — only for angled junctions) will visually clip the
    // pad; that's acceptable Phase-1 behaviour and gets fixed by
    // Phase-2 angular-wedge sidewalks.
    const maxWidth   = inc.reduce((m, e) => Math.max(m, e.road_width || 6.5), 0);
    const maxSw      = inc.reduce((m, e) => Math.max(m, e.sidewalk_width || 0), 0);
    const maxCh      = inc.reduce((m, e) => Math.max(m, e.curb_height || 0.15), 0);
    const anySw      = maxSw > 0.01;
    // Any preset — we just need colours/textures. Averaging colours
    // would need parsing hex; simpler + Phase-1-fine to use the first
    // incident edge's palette.
    const src = inc[0];
    const halfTile   = maxWidth / 2 + CORNER_BEVEL;
    // Intersections at elevated nodes (bridges, ramps) sit at the
    // node's own Y so the incident edges dock cleanly.
    const nY = n.y || 0;

    // Central asphalt tile — slightly larger than the shrink so it
    // covers any tiny gap left by asphalt inset math.
    emit(`inter_asphalt_${n.id}`,
      n.x, nY + 0.025, n.z,
      2 * halfTile, 0.05, 2 * halfTile,
      0,
      { color: src.asphalt_color, texture: src.asphalt_texture, climbable: true },
    );

    if (anySw) {
      // 4 corner sidewalk pads (each `maxSw` × `maxSw`) at the four
      // diagonal corners of the intersection. This is the visual
      // "bevel" — every corner has a maxSw × maxSw pad that later
      // becomes the furniture anchor in Phase 2.
      const swH   = maxCh + 0.05;
      const cornerC = halfTile + maxSw / 2;    // corner centre distance from node
      const corners = [
        { part: 'inter_sw_NE', ox:  cornerC, oz:  cornerC },
        { part: 'inter_sw_NW', ox: -cornerC, oz:  cornerC },
        { part: 'inter_sw_SE', ox:  cornerC, oz: -cornerC },
        { part: 'inter_sw_SW', ox: -cornerC, oz: -cornerC },
      ];
      for (const c of corners) {
        emit(`${c.part}_${n.id}`,
          n.x + c.ox, nY + swH / 2, n.z + c.oz,
          maxSw, swH, maxSw,
          0,
          { color: src.sidewalk_color, texture: src.sidewalk_texture, climbable: true },
        );
      }
      // Corner CURBS — thin strips on the two "asphalt-facing" faces
      // of every corner pad. Curbs run from the corner pad toward
      // the intersection centre along both axes.
      for (const c of corners) {
        // North/South face of the corner (the one facing +Z or −Z
        // toward the intersection centre).
        const facingZ = -Math.sign(c.oz); // face points into intersection
        emit(`${c.part}_curbZ_${n.id}`,
          n.x + c.ox, nY + maxCh / 2, n.z + c.oz + facingZ * (maxSw / 2 - CURB_THICKNESS / 2),
          maxSw, maxCh, CURB_THICKNESS,
          0,
          { color: '#4a4a4a', texture: '' },
        );
        // East/West face.
        const facingX = -Math.sign(c.ox);
        emit(`${c.part}_curbX_${n.id}`,
          n.x + c.ox + facingX * (maxSw / 2 - CURB_THICKNESS / 2), nY + maxCh / 2, n.z + c.oz,
          CURB_THICKNESS, maxCh, maxSw,
          0,
          { color: '#4a4a4a', texture: '' },
        );
      }
    }
  }

  return boxes;
}

/** Regenerate every road-network box on the doc. Same contract as
 *  `rebuildAllBuildings` — keeps non-road objects untouched, wipes
 *  and re-emits everything tagged `_road_id`. */
export function rebuildRoadNetwork(doc) {
  const network = doc.roads || newRoadNetwork();
  const keptObjects = (doc.objects || []).filter(o => !o._road_id);
  const generated = generateRoadNetwork(network);
  return { ...doc, objects: [...keptObjects, ...generated] };
}

/** Strip all road boxes from `objects` without touching anything
 *  else. Used before deleting the entire road network. */
export function stripRoadBoxes(doc) {
  return { ...doc, objects: (doc.objects || []).filter(o => !o._road_id) };
}

/** Detect what a node's degree-derived "kind" is for UI display
 *  (used purely for the ROAD tab badge / colour coding). No effect
 *  on geometry generation. */
export function classifyNode(network, nodeId) {
  const d = _degree(network.edges || [], nodeId);
  if (d === 0) return 'orphan';
  if (d === 1) return 'dead-end';
  if (d === 2) return 'bend';
  if (d === 3) return 'T';
  if (d === 4) return '4-way';
  return `${d}-way`;
}
