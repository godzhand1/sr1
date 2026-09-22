// render/surfaces.js — what did the bullet / blast actually hit?
//
// Pure geometry + classification helpers shared by the engine (hitscan)
// and the view (decals). Surfaces: concrete · metal · wood · glass · dirt.
// Colliders may carry an explicit `mat`; otherwise thin, tall boxes read
// as street furniture (poles, fences, rails, ladders) → metal, everything
// else is concrete. Destructible props map by type.

export const SURFACES = ['concrete', 'metal', 'wood', 'glass', 'dirt'];
export const SURFACE_CODE = Object.fromEntries(SURFACES.map((s, i) => [s, i]));
export const surfaceFromCode = (c) => SURFACES[c | 0] || 'concrete';

export const SURFACE_OF_PROP = {
  crate: 'wood', barrier: 'concrete', window: 'glass', glass: 'glass',
  streetlight: 'metal', sign: 'metal', barrel_explosive: 'metal',
};

export function surfaceOfCollider(c) {
  if (!c) return 'concrete';
  if (c.mat && SURFACE_CODE[c.mat] != null) return c.mat;
  if (c.grid) return 'concrete';
  const w = (c.x1 - c.x0), d = (c.z1 - c.z0), h = c.h - (c.yBase != null ? c.yBase : 0);
  if (Math.min(w, d) <= 0.45 && h >= 0.8) return 'metal';       // pole / fence / rail
  return 'concrete';
}

// Outward face normal of an AABB at a surface point (dominant axis of the
// point's offset from the box centre, normalised by the half extents).
export function aabbFaceNormal(px, py, pz, x0, x1, y0, y1, z0, z1) {
  const hx = Math.max(1e-6, (x1 - x0) / 2), hy = Math.max(1e-6, (y1 - y0) / 2), hz = Math.max(1e-6, (z1 - z0) / 2);
  const rx = (px - (x0 + x1) / 2) / hx, ry = (py - (y0 + y1) / 2) / hy, rz = (pz - (z0 + z1) / 2) / hz;
  const ax = Math.abs(rx), ay = Math.abs(ry), az = Math.abs(rz);
  if (ax >= ay && ax >= az) return { nx: Math.sign(rx) || 1, ny: 0, nz: 0 };
  if (ay >= az) return { nx: 0, ny: Math.sign(ry) || 1, nz: 0 };
  return { nx: 0, ny: 0, nz: Math.sign(rz) || 1 };
}

// Normal facing back along the shot when nothing better is known.
export function normalFromDir(dx, dy, dz) {
  if (Math.abs(dy) > 0.7) return { nx: 0, ny: dy > 0 ? -1 : 1, nz: 0 };
  const l = Math.hypot(dx, dz) || 1;
  return { nx: -dx / l, ny: 0, nz: -dz / l };
}

// Vertical collider faces inside a blast radius → scorch/crack anchors.
// Returns up to `max` faces, nearest first: { x,y,z, nx,ny,nz, dist, w, h,
// yLo, yHi, surf }. Imported SR chunk grids contribute their own faces
// through `grid.wallFacesNear` (cell boundaries between wall and open).
export function wallFacesNearBlast(colliders, x, y, z, radius, max = 4) {
  const out = [];
  for (const c of colliders || []) {
    if (!c || c.no_bullet) continue;
    if (c.grid) {
      if (typeof c.grid.wallFacesNear === 'function') out.push(...c.grid.wallFacesNear(x, y, z, radius, max));
      continue;
    }
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) continue;       // blast is inside/over the box
    const yLo = c.yBase != null ? c.yBase : 0;
    if (c.h - yLo < 0.6) continue;                                            // kerbs / slabs: ground scorch covers them
    const cx = Math.min(Math.max(x, c.x0), c.x1), cz = Math.min(Math.max(z, c.z0), c.z1);
    const cy = Math.min(Math.max(y, yLo), c.h);
    const dist = Math.hypot(cx - x, cy - y, cz - z);
    if (dist > radius) continue;
    // face = axis with the larger outside offset
    const ox = x < c.x0 ? c.x0 - x : (x > c.x1 ? x - c.x1 : 0);
    const oz = z < c.z0 ? c.z0 - z : (z > c.z1 ? z - c.z1 : 0);
    const n = ox >= oz ? { nx: x < c.x0 ? -1 : 1, ny: 0, nz: 0 } : { nx: 0, ny: 0, nz: z < c.z0 ? -1 : 1 };
    const w = n.nx !== 0 ? (c.z1 - c.z0) : (c.x1 - c.x0);
    out.push({ x: cx, y: Math.max(yLo + 0.15, Math.min(c.h - 0.15, y)), z: cz, ...n, dist, w, h: c.h - yLo, yLo, yHi: c.h, surf: surfaceOfCollider(c) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, max);
}

// Editor objects: explicit `surface` tag wins, else read the material /
// texture / model name, else undefined (collider heuristic applies).
export function inferSurface(o) {
  if (!o) return undefined;
  if (o.surface && SURFACE_CODE[o.surface] != null) return o.surface;
  if (o.is_glass) return 'glass';
  const hint = `${o.pbr?.materialId || ''} ${o.texture || ''} ${o.glb || o.model || o.asset || ''}`.toLowerCase();
  if (!hint.trim()) return undefined;
  if (/glass|window|pane/.test(hint)) return 'glass';
  if (/wood|plank|timber|pallet|crate|log/.test(hint)) return 'wood';
  if (/metal|steel|iron|rust|chrome|alumin|container|dumpster|fence|rail|grate|corrugated/.test(hint)) return 'metal';
  if (/dirt|soil|mud|grass|gravel|sand|lawn|ground|earth/.test(hint)) return 'dirt';
  return undefined;
}
