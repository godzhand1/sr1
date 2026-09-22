// srCollisionGrid.js — runtime collision for imported Saints Row chunk
// maps. Consumes the `collision.bin` blob baked by headless Blender
// (backend/blender/scripts/bake_chunk_collision.py): a uniform XZ grid
// where every cell stores the walkable surface heights it stacks
// (street, sidewalk, stairs, roof…) plus [lo, hi] wall intervals from
// the steep faces (building walls, fences, curb risers).
//
// The grid lives in the chunk's own Y-up space. A collider entry in the
// map's collider list looks like `{ grid, x0:0, x1:0, z0:0, z1:0, h:0 }`
// — the inert AABB fields keep every legacy `for (c of colliders)` loop
// in engine3d / bots3d / minimap from misreading it, while collideXZ /
// topAt / rayWalls branch on `c.grid` and call the methods below.
export const STEP_UP = 0.55;

export function parseCollisionGrid(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SRCL') throw new Error('Not an SRCL collision blob');
  const hlen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
  let off = 8 + hlen;
  const n = header.nx * header.nz;
  const floorCount = new Uint8Array(buf, off, n); off += n;
  const wallCount = new Uint8Array(buf, off, n); off += n;
  off += off % 2;
  const floorH = new Uint16Array(buf, off, header.floor_total); off += header.floor_total * 2;
  const wallLH = new Uint16Array(buf, off, header.wall_total * 2);
  const floorOff = new Uint32Array(n + 1);
  const wallOff = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    floorOff[i + 1] = floorOff[i] + floorCount[i];
    wallOff[i + 1] = wallOff[i] + wallCount[i];
  }
  return new SrCollisionGrid(header, floorOff, floorH, wallOff, wallLH);
}

export async function loadCollisionGrid(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`collision fetch ${r.status}`);
  return parseCollisionGrid(await r.arrayBuffer());
}

export class SrCollisionGrid {
  constructor(header, floorOff, floorH, wallOff, wallLH) {
    this.nx = header.nx; this.nz = header.nz; this.cell = header.cell;
    this.gx0 = header.x0; this.gz0 = header.z0;
    this.y0 = header.y0; this.units = header.units;
    this.floorOff = floorOff; this.floorH = floorH;
    this.wallOff = wallOff; this.wallLH = wallLH;
    // Placement of the chunk inside the map: translation + yaw + scale
    // (mirrors the GLB prop transform in mapCustom3d).
    this.tx = 0; this.ty = 0; this.tz = 0; this.yaw = 0; this.s = 1; this.sy = 1;
    this._cos = 1; this._sin = 0;
  }

  setTransform(x, y, z, yaw = 0, s = 1, sy = s) {
    this.tx = x; this.ty = y; this.tz = z; this.yaw = yaw;
    this.s = s > 0 ? s : 1; this.sy = sy > 0 ? sy : this.s;
    this._cos = Math.cos(yaw); this._sin = Math.sin(yaw);
    return this;
  }

  // World → chunk-local (inverse of three.js `rotation.y = yaw`).
  toLocal(wx, wz) {
    const dx = wx - this.tx, dz = wz - this.tz;
    return [(dx * this._cos - dz * this._sin) / this.s, (dx * this._sin + dz * this._cos) / this.s];
  }
  toWorld(lx, lz) {
    const x = lx * this.s, z = lz * this.s;
    return [x * this._cos + z * this._sin + this.tx, -x * this._sin + z * this._cos + this.tz];
  }
  localY(wy) { return (wy - this.ty) / this.sy; }
  worldY(ly) { return ly * this.sy + this.ty; }

  cellIndex(lx, lz) {
    const ix = Math.floor((lx - this.gx0) / this.cell);
    const iz = Math.floor((lz - this.gz0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }

  _h(v) { return this.y0 + v * this.units; }

  // Highest floor layer at or below `maxY` (local). -Infinity if none.
  floorBelow(ci, maxY) {
    if (ci < 0) return -Infinity;
    const a = this.floorOff[ci], b = this.floorOff[ci + 1];
    for (let k = b - 1; k >= a; k--) {
      const y = this._h(this.floorH[k]);
      if (y <= maxY) return y;
    }
    return -Infinity;
  }
  hasFloor(ci) { return ci >= 0 && this.floorOff[ci + 1] > this.floorOff[ci]; }
  lowestFloor(ci) {
    if (!this.hasFloor(ci)) return -Infinity;
    return this._h(this.floorH[this.floorOff[ci]]);
  }
  // Any wall interval overlapping (lo, hi) in this cell?
  wallBetween(ci, lo, hi) {
    if (ci < 0) return false;
    const a = this.wallOff[ci], b = this.wallOff[ci + 1];
    for (let k = a; k < b; k++) {
      const wl = this._h(this.wallLH[k * 2]), wh = this._h(this.wallLH[k * 2 + 1]);
      if (wl < hi && wh > lo) return true;
    }
    return false;
  }
  // Merged [lo, hi] of the wall intervals overlapping (lo, hi) — the
  // vertical extent of the face a decal can sit on.
  wallSpan(ci, lo, hi) {
    let sl = Infinity, sh = -Infinity;
    if (ci < 0) return null;
    const a = this.wallOff[ci], b = this.wallOff[ci + 1];
    for (let k = a; k < b; k++) {
      const wl = this._h(this.wallLH[k * 2]), wh = this._h(this.wallLH[k * 2 + 1]);
      if (wl < hi && wh > lo) { sl = Math.min(sl, wl); sh = Math.max(sh, wh); }
    }
    return sl === Infinity ? null : [sl, sh];
  }
  // Local direction → world (rotation only).
  dirToWorld(dx, dz) { return [dx * this._cos + dz * this._sin, -dx * this._sin + dz * this._cos]; }
  dirToLocal(dx, dz) { return [dx * this._cos - dz * this._sin, dx * this._sin + dz * this._cos]; }

  // Exposed vertical wall faces around a world point (blast) — cell
  // boundaries between a wall cell (at chest height above the point)
  // and an open neighbour that faces the point. One face per wall
  // line, nearest first, in world space: { x,y,z, nx,ny,nz, dist, w, h,
  // yLo, yHi, surf }.
  wallFacesNear(wx, wy, wz, radius, max = 4) {
    const [lx, lz] = this.toLocal(wx, wz);
    const ly = this.localY(wy);
    const c = this.cell, lr = radius / this.s;
    const ix0 = Math.max(0, Math.floor((lx - lr - this.gx0) / c)), ix1 = Math.min(this.nx - 1, Math.floor((lx + lr - this.gx0) / c));
    const iz0 = Math.max(0, Math.floor((lz - lr - this.gz0) / c)), iz1 = Math.min(this.nz - 1, Math.floor((lz + lr - this.gz0) / c));
    if (ix1 < ix0 || iz1 < iz0) return [];
    const lo = ly + 0.3 / this.sy, hi = ly + 1.6 / this.sy;
    const isWall = (ix, iz) => ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz && this.wallBetween(iz * this.nx + ix, lo, hi);
    const cands = [];
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (!isWall(ix, iz)) continue;
        const x0 = this.gx0 + ix * c, z0 = this.gz0 + iz * c;
        for (const [dx, dz, fx, fz] of [[-1, 0, x0, z0 + c / 2], [1, 0, x0 + c, z0 + c / 2], [0, -1, x0 + c / 2, z0], [0, 1, x0 + c / 2, z0 + c]]) {
          if (isWall(ix + dx, iz + dz)) continue;                          // shared boundary inside the wall
          if ((lx - fx) * dx + (lz - fz) * dz <= 0) continue;              // face turned away from the point
          const dist = Math.hypot(fx - lx, fz - lz) * this.s;
          if (dist > radius) continue;
          cands.push({ ix, iz, dx, dz, fx, fz, dist });
        }
      }
    }
    cands.sort((a, b) => a.dist - b.dist);
    const faces = [];
    for (const f of cands) {
      const key = f.dx !== 0 ? `x${f.dx}:${f.fx.toFixed(3)}` : `z${f.dz}:${f.fz.toFixed(3)}`;
      if (faces.some((g) => g.key === key)) continue;                     // one mark per wall line
      // face width: run along the boundary while the wall/open pattern holds
      const sx = f.dx !== 0 ? 0 : 1, sz = f.dx !== 0 ? 1 : 0;
      let cells = 1;
      for (const dir of [-1, 1]) {
        for (let k = 1; k < 96; k++) {
          const ix2 = f.ix + sx * dir * k, iz2 = f.iz + sz * dir * k;
          if (!isWall(ix2, iz2) || isWall(ix2 + f.dx, iz2 + f.dz)) break;
          cells++;
        }
      }
      const span = this.wallSpan(f.iz * this.nx + f.ix, lo, hi) || [ly, ly + 3 / this.sy];
      const [X, Z] = this.toWorld(f.fx, f.fz);
      const [nx, nz] = this.dirToWorld(f.dx, f.dz);
      const yLo = this.worldY(span[0]), yHi = this.worldY(span[1]);
      faces.push({ key, x: X, y: Math.max(yLo + 0.15, Math.min(yHi - 0.15, wy)), z: Z, nx, ny: 0, nz, dist: f.dist, w: cells * c * this.s, h: yHi - yLo, yLo, yHi, surf: 'concrete' });
      if (faces.length >= max) break;
    }
    return faces.map(({ key: _k, ...rest }) => rest);
  }

  // Is the world point inside a wall interval?
  wallAt(wx, wy, wz) {
    const [lx, lz] = this.toLocal(wx, wz);
    const ly = this.localY(wy);
    return this.wallBetween(this.cellIndex(lx, lz), ly - 0.05, ly + 0.05);
  }

  // ── engine contract ────────────────────────────────────────────
  // Support height under (wx, wz) for a body currently at `currentY`
  // (world). Returns -Infinity when the grid has nothing walkable
  // there so the caller's baseline (arena floor 0) wins.
  topAt(wx, wz, currentY) {
    const [lx, lz] = this.toLocal(wx, wz);
    const ci = this.cellIndex(lx, lz);
    if (ci < 0) return -Infinity;
    const cy = Number.isFinite(currentY) ? this.localY(currentY) : Infinity;
    const y = this.floorBelow(ci, cy + STEP_UP + 0.05);
    return y === -Infinity ? -Infinity : this.worldY(y);
  }

  // Does this cell block a body whose feet are at localY py?
  blocks(ci, py, ph) {
    if (ci < 0 || !this.hasFloor(ci)) return false;
    const f = this.floorBelow(ci, py + STEP_UP);
    if (f === -Infinity) return true;                          // only floors above reach → wall of a ledge
    return this.wallBetween(ci, py + STEP_UP, py + ph - 0.05);
  }

  // Push a circle (wx, wz, r) out of blocking cells. Returns [x, z].
  resolveXZ(wx, wz, r, playerY, playerH) {
    let [lx, lz] = this.toLocal(wx, wz);
    const py = this.localY(playerY), ph = playerH / this.sy, lr = r / this.s;
    const c = this.cell;
    const ix0 = Math.floor((lx - lr - this.gx0) / c), ix1 = Math.floor((lx + lr - this.gx0) / c);
    const iz0 = Math.floor((lz - lr - this.gz0) / c), iz1 = Math.floor((lz + lr - this.gz0) / c);
    if (ix1 < 0 || iz1 < 0 || ix0 >= this.nx || iz0 >= this.nz) return [wx, wz];
    for (let iz = Math.max(0, iz0); iz <= Math.min(this.nz - 1, iz1); iz++) {
      for (let ix = Math.max(0, ix0); ix <= Math.min(this.nx - 1, ix1); ix++) {
        const ci = iz * this.nx + ix;
        if (!this.blocks(ci, py, ph)) continue;
        const x0 = this.gx0 + ix * c, x1 = x0 + c, z0 = this.gz0 + iz * c, z1 = z0 + c;
        const cx = Math.max(x0, Math.min(lx, x1)), cz = Math.max(z0, Math.min(lz, z1));
        const dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
        if (d2 >= lr * lr) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          lx = cx + (dx / d) * lr; lz = cz + (dz / d) * lr;
        } else {
          const pen = [lx - x0 + lr, x1 - lx + lr, lz - z0 + lr, z1 - lz + lr];
          const m = Math.min(...pen);
          if (m === pen[0]) lx = x0 - lr;
          else if (m === pen[1]) lx = x1 + lr;
          else if (m === pen[2]) lz = z0 - lr;
          else lz = z1 + lr;
        }
      }
    }
    return this.toWorld(lx, lz);
  }

  // March a world-space segment; returns the parametric t (0..1) of the
  // first solid contact or Infinity. Solid = inside a wall interval, or
  // crossing downward through a floor layer. `lastNormal` (world) is
  // left describing the face that was hit: wall → axis-aligned, facing
  // back along the ray's dominant horizontal component; floor → up.
  segmentHit(ax, ay, az, bx, by, bz) {
    const [lax, laz] = this.toLocal(ax, az), [lbx, lbz] = this.toLocal(bx, bz);
    const lay = this.localY(ay), lby = this.localY(by);
    const len = Math.hypot(lbx - lax, lby - lay, lbz - laz);
    if (len < 1e-6) return Infinity;
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    let px = lax, py = lay, pz = laz, pt = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lax + (lbx - lax) * t, y = lay + (lby - lay) * t, z = laz + (lbz - laz) * t;
      const ci = this.cellIndex(x, z);
      if (ci >= 0) {
        if (this.wallBetween(ci, y - 0.02, y + 0.02)) {
          const ldx = lbx - lax, ldz = lbz - laz;
          const [nx, nz] = Math.abs(ldx) >= Math.abs(ldz) ? this.dirToWorld(-Math.sign(ldx) || 1, 0) : this.dirToWorld(0, -Math.sign(ldz) || 1);
          this.lastNormal = { nx, ny: 0, nz };
          return t;
        }
        if (y < py) {
          const f = this.floorBelow(ci, py + 0.02);
          if (f !== -Infinity && y < f) { this.lastNormal = { nx: 0, ny: 1, nz: 0 }; return pt + (t - pt) * ((py - f) / (py - y)); }
        }
      }
      px = x; py = y; pz = z; pt = t;
    }
    return Infinity;
  }

  // Ray version used by rayWalls: origin o {x,y,z}, dir d (unit), maxT.
  rayT(o, d, maxT) {
    const range = Math.min(maxT, 400);
    const t = this.segmentHit(o.x, o.y, o.z, o.x + d.x * range, o.y + d.y * range, o.z + d.z * range);
    return t === Infinity ? Infinity : t * range;
  }
}
