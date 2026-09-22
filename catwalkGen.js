// ── Catwalk generator (iter164) ─────────────────────────────────────
// A catwalk is a raised, span-across bridge between two anchor points
// somewhere in the map — typically a 2nd-floor door to another
// building's 2nd-floor door, or one rooftop to another. Each catwalk
// is one authored spec that expands into a small handful of primitive
// box objects (the walking surface, two side handrails, optional
// support pillars). Tag every emitted box with `_catwalk_id` so the
// dispatcher can re-generate them when the author edits the spec —
// same pattern as `buildingGen.js`.
//
// Data model:
//   {
//     id: string          // unique per doc; used as `_catwalk_id` tag
//     name: string        // shown in TOC
//     ax, ay, az          // world position of end A (walking surface)
//     bx, by, bz          // world position of end B (walking surface)
//     width: number       // walking-surface width (default 2.4m to
//                         // match AAA stairs)
//     handrails: boolean  // twin torso-height rails on both edges
//     supports:  boolean  // vertical pillars down from mid-span to
//                         // the ground for silhouette + gameplay
//                         // partial cover under the catwalk
//     texture, color              // floor material
//     rail_texture, rail_color    // handrail material
//   }

const DEFAULTS = {
  width: 2.4,
  handrails: true,
  supports: true,
  texture: 'warehouse_concrete_floor',
  color: '#7a7a80',
  rail_texture: '',
  rail_color: '#4a4a52',
};

const FLOOR_THICKNESS = 0.24;
const RAIL_HEIGHT     = 0.9;
const RAIL_THICKNESS  = 0.06;
const SUPPORT_THICKNESS = 0.25;
const SUPPORT_SPACING   = 5.0;    // one pillar every ~5m of run

export const DEFAULT_CATWALK = () => ({
  id: '',
  name: 'Catwalk',
  ax: -4, ay: 3, az: 0,
  bx:  4, by: 3, bz: 0,
  ...DEFAULTS,
});

/** Sanity clamp — every field lands in a valid range. */
function _sanitize(spec) {
  return {
    ...DEFAULTS,
    ...spec,
    ax: +(spec.ax ?? 0),
    ay: Math.max(0.2, +(spec.ay ?? 3)),
    az: +(spec.az ?? 0),
    bx: +(spec.bx ?? 4),
    by: Math.max(0.2, +(spec.by ?? 3)),
    bz: +(spec.bz ?? 0),
    width: Math.max(0.8, Math.min(8, +(spec.width ?? DEFAULTS.width))),
    handrails: spec.handrails !== false,
    supports:  spec.supports  !== false,
  };
}

/** Expand one catwalk spec into a list of primitive box objects
 *  ready to be spread into `doc.objects`. Empty spec (missing id) or
 *  degenerate spans (< 0.5m) return `[]`. */
export function generateCatwalk(rawSpec) {
  if (!rawSpec || !rawSpec.id) return [];
  const spec = _sanitize(rawSpec);
  const {
    id, ax, ay, az, bx, by, bz,
    width, handrails, supports,
    texture, color, rail_texture, rail_color,
  } = spec;

  const dx = bx - ax;
  const dz = bz - az;
  const runLen = Math.hypot(dx, dz);
  if (runLen < 0.5) return [];

  // Direction of the span in world XZ. `yaw` is the rotation applied
  // to boxes so their local +Z aligns with A→B. This matches how
  // three.js interprets `mesh.rotation.y = yaw`: a positive yaw
  // rotates local axes clockwise-looking-down-from-+Y, so
  //   world_x =  local_x·cos(y) + local_z·sin(y)
  //   world_z = -local_x·sin(y) + local_z·cos(y)
  // We want local_z (the box's LONG axis) to point from A to B.
  const yaw = Math.atan2(dx, dz);

  const midX = (ax + bx) * 0.5;
  const midZ = (az + bz) * 0.5;
  const midY = (ay + by) * 0.5;
  const rise = by - ay;

  const boxes = [];
  let seq = 0;
  const push = (part, box) => {
    boxes.push({
      id: `${id}_${part}_${seq++}`,
      _catwalk_id: id,
      _catwalk_part: part,
      yaw,
      ...box,
    });
  };

  // ── Walking surface ──────────────────────────────────────────
  // Emit as a slope box when the endpoints differ in Y, otherwise a
  // flat box. The slope collider follows the LOCAL Z axis so the
  // catwalk reads smoothly as the player traverses it — sprint-
  // pushing across a slanted skywalk feels continuous, not stepped.
  if (Math.abs(rise) < 0.01) {
    push('floor', {
      x: midX, y: midY, z: midZ,
      w: width, h: FLOOR_THICKNESS, d: runLen,
      color, texture,
      collision: true,
      climbable: true,
    });
  } else {
    // Slope span: `slope.axis = 'z'` (local Z), yStart at az-side,
    // yEnd at bz-side. The floor's y here is the BASE (midpoint of
    // the box's vertical extent for a slope), interpreted by
    // mapCustom3d — the yaw-aware slope path stores the world
    // centre + local half-span so `topAt` can sample correctly.
    const yLo = Math.min(ay, by);
    const yHi = Math.max(ay, by);
    // The wedge box's LOCAL Y goes from 0 (base) up to (yHi-yLo).
    // Its centre-Y in world is yLo + (yHi-yLo)/2.
    const boxH = (yHi - yLo) + FLOOR_THICKNESS;
    const boxY = yLo + boxH / 2 - FLOOR_THICKNESS / 2;
    // Local slope endpoints — `yStart` at local -Z (mesh's local az
    // side), `yEnd` at local +Z (bz side). yLocalOffset shifts the
    // slope surface up by the walking-plane thickness so the top
    // face sits at the endpoint y coordinates rather than the box
    // centre.
    const slopeYS = (ay < by) ? FLOOR_THICKNESS : (yHi - yLo) + FLOOR_THICKNESS;
    const slopeYE = (ay < by) ? (yHi - yLo) + FLOOR_THICKNESS : FLOOR_THICKNESS;
    push('floor', {
      x: midX, y: boxY, z: midZ,
      w: width, h: boxH, d: runLen,
      color, texture,
      collision: true,
      climbable: true,
      slope: { yStart: slopeYS, yEnd: slopeYE, axis: 'z' },
    });
  }

  // ── Handrails ────────────────────────────────────────────────
  // Two rails hugging the LONG edges. Emitted per-segment (one box
  // per ~2m chunk) so they follow the slope rise smoothly without
  // needing a slope-rail collider. Rails carry `no_bullet:true` so
  // firing along the span never detonates on the rail — matches
  // the stair-handrail rationale in `buildingGen.js`.
  if (handrails) {
    const railSegments = Math.max(1, Math.round(runLen / 2));
    const segLen = runLen / railSegments;
    const perpOff = width / 2 + RAIL_THICKNESS / 2;
    for (let s = 0; s < railSegments; s++) {
      const t = (s + 0.5) / railSegments;         // 0..1 along run
      // Local (0, 0, localZ) → world position with yaw applied.
      const localZ = -runLen / 2 + t * runLen;
      const wx = midX + Math.sin(yaw) * localZ;
      const wz = midZ + Math.cos(yaw) * localZ;
      const wy = ay + (by - ay) * t + RAIL_HEIGHT / 2 + FLOOR_THICKNESS / 2;
      // Positive perp offset (local +X)
      const rxP = wx + Math.cos(yaw) * perpOff;
      const rzP = wz - Math.sin(yaw) * perpOff;
      // Negative perp offset (local -X)
      const rxN = wx - Math.cos(yaw) * perpOff;
      const rzN = wz + Math.sin(yaw) * perpOff;
      push('rail_p', {
        x: rxP, y: wy, z: rzP,
        w: RAIL_THICKNESS, h: RAIL_HEIGHT, d: segLen,
        color: rail_color, texture: rail_texture,
        collision: true,
        no_bullet: true,
      });
      push('rail_n', {
        x: rxN, y: wy, z: rzN,
        w: RAIL_THICKNESS, h: RAIL_HEIGHT, d: segLen,
        color: rail_color, texture: rail_texture,
        collision: true,
        no_bullet: true,
      });
    }
  }

  // ── Support pillars ──────────────────────────────────────────
  // Vertical posts down from the underside of the walking surface
  // to the ground plane. Only emitted for spans long enough to
  // warrant a pillar (≥ 4m); shorter catwalks just look better
  // free-floating between doorways. Pillars sit centred on the
  // catwalk's LONG axis and are `no_bullet:true` so they don't
  // eat rockets fired horizontally at the underside.
  if (supports && runLen >= 4) {
    const nSupports = Math.max(1, Math.floor(runLen / SUPPORT_SPACING));
    for (let s = 0; s < nSupports; s++) {
      const t = (s + 1) / (nSupports + 1);
      const localZ = -runLen / 2 + t * runLen;
      const wx = midX + Math.sin(yaw) * localZ;
      const wz = midZ + Math.cos(yaw) * localZ;
      const wyTop = ay + (by - ay) * t;
      // Pillar spans world-y from 0 to wyTop. Centre at half-height.
      if (wyTop < 0.5) continue;   // too short — skip
      push('support', {
        x: wx, y: wyTop / 2, z: wz,
        w: SUPPORT_THICKNESS, h: wyTop, d: SUPPORT_THICKNESS,
        color: rail_color, texture: rail_texture,
        collision: true,
      });
    }
  }

  return boxes;
}

/** Regenerate the boxes for every catwalk in the doc, replacing any
 *  previously emitted per-catwalk boxes (tagged with `_catwalk_id`).
 *  Preserves non-catwalk objects untouched. Mirrors
 *  `rebuildAllBuildings` in buildingGen.js. */
export function rebuildAllCatwalks(doc) {
  const catwalks    = Array.isArray(doc.catwalks) ? doc.catwalks : [];
  const keptObjects = (doc.objects || []).filter(o => !o._catwalk_id);
  const generated   = catwalks.flatMap(c => generateCatwalk(c));
  return { ...doc, objects: [...keptObjects, ...generated] };
}

/** Strip a single catwalk's boxes from `objects`. */
export function stripCatwalkBoxes(doc, catwalkId) {
  return {
    ...doc,
    objects: (doc.objects || []).filter(o => o._catwalk_id !== catwalkId),
  };
}

/** Compute the list of world-space snap anchors from every building
 *  in the doc — used by the MapEditor's catwalk inspector to let the
 *  author pick a 2nd-floor door frame or a rooftop edge without
 *  typing coordinates. Returns entries of the shape:
 *
 *    { key, label, x, y, z, buildingId, kind }
 *
 *  `kind` is 'door' (for a story-1+ door) or 'roof' (roof deck edge).
 *  Y is the ideal endpoint height at that anchor:
 *    - door → floor of that story + tiny lift so the walkway sits
 *      flush with the doorway threshold
 *    - roof → top of the roof slab so the walkway meets the roof
 *      deck's WALKABLE surface, not the slab underside
 *
 *  World XYZ math mirrors `generateBuilding`'s `world()` helper
 *  (three.js Y-rotation convention), so this stays consistent even
 *  when the building is yawed. */
export function computeCatwalkAnchors(doc) {
  const out = [];
  for (const b of (doc?.buildings || [])) {
    if (!b || !b.id) continue;
    const yaw = b.yaw || 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const worldOf = (lx, lz) => ({
      x: (b.x || 0) + lx * cy + lz * sy,
      z: (b.z || 0) - lx * sy + lz * cy,
    });
    const W = Math.max(2, b.width || 8);
    const D = Math.max(2, b.depth || 8);
    const T = b.wall_thickness || 0.3;
    const SH = b.story_height || 2.7;
    const stories = Math.max(1, b.stories || 1);
    const rt = b.floor_thickness || 0.2;
    const label = b.name || b.id;

    // ── Story ≥ 1 doors ─────────────────────────────────────
    for (const side of ['N', 'S', 'E', 'W']) {
      const list = (b.openings?.[side] || []).filter(o => o?.kind === 'door' && (o.story || 0) >= 1);
      for (const o of list) {
        const off = +(o.offset || 0);
        const isNS = side === 'N' || side === 'S';
        // Position at the OUTER face of the wall so the catwalk
        // butts up against the doorway threshold. `T/2` offset
        // pushes past the wall centreline to the exterior face.
        let lx, lz;
        if (isNS) {
          lx = off;
          lz = side === 'N' ? (D / 2) : -(D / 2);
        } else {
          lz = off;
          lx = side === 'E' ? (W / 2) : -(W / 2);
        }
        const p = worldOf(lx, lz);
        const y = (b.y || 0) + (o.story || 1) * SH + 0.05;
        out.push({
          key: `${b.id}::door::${side}::${o.story || 1}::${off.toFixed(2)}`,
          label: `${label} · story ${o.story || 1} door ${side}`,
          x: +p.x.toFixed(3), y: +y.toFixed(3), z: +p.z.toFixed(3),
          buildingId: b.id, kind: 'door',
        });
      }
    }

    // ── Rooftop deck perimeter (4 corners + 4 mid-edges) ────
    if (b.has_roof !== false) {
      const roofY = (b.y || 0) + stories * SH + rt;
      const halfW = W / 2 - T / 2, halfD = D / 2 - T / 2;
      const points = [
        { lx: -halfW, lz: -halfD, tag: 'SW corner' },
        { lx:  halfW, lz: -halfD, tag: 'SE corner' },
        { lx: -halfW, lz:  halfD, tag: 'NW corner' },
        { lx:  halfW, lz:  halfD, tag: 'NE corner' },
        { lx:      0, lz: -halfD, tag: 'S edge' },
        { lx:      0, lz:  halfD, tag: 'N edge' },
        { lx: -halfW, lz:      0, tag: 'W edge' },
        { lx:  halfW, lz:      0, tag: 'E edge' },
      ];
      for (const c of points) {
        const p = worldOf(c.lx, c.lz);
        out.push({
          key: `${b.id}::roof::${c.tag}`,
          label: `${label} · roof ${c.tag}`,
          x: +p.x.toFixed(3), y: +roofY.toFixed(3), z: +p.z.toFixed(3),
          buildingId: b.id, kind: 'roof',
        });
      }
    }
  }
  return out;
}
