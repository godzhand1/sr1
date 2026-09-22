// Team Gangsta Brawl — lightweight destructible props system.
//
// Xbox-360-era approach: no rigid-body engine, just simple HP-per-prop
// and a POOLED debris system. When something breaks:
//   1. The main mesh hides.
//   2. N debris chunks (pre-allocated, reused across breaks) are
//      spawned with random outward velocities.
//   3. Each chunk integrates its own vy (gravity), rotates a bit, and
//      auto-despawns when it hits the floor OR its 3-second lifetime
//      expires — whichever comes first.
//   4. Explosive barrels chain-detonate through the game's existing
//      `_explode` (RPG-style AOE), which in turn can chain-break more
//      barrels via `splashDamage`.
//
// Pool sizes are capped so a match can never accumulate more than
// MAX_DEBRIS active chunks — old chunks get recycled first.

import * as THREE from 'three';
import { SURFACE_OF_PROP } from './render/surfaces.js';
import { playGlassShatterAt, playDebrisBreakAt } from '../streetfight/sounds.js';

// ── Prop registry ────────────────────────────────────────────────────
// Each type is (essentially) a factory for the intact mesh + break
// behavior. Kept in one place so maps just say "spawn me a crate at
// this XZ" and the whole visual/physics dance is handled here.
const REGISTRY = {
  crate: {
    hp: 40,
    aabb: { x: 0.7, y: 0.8, z: 0.7 },
    debrisCount: 6,
    debrisColor: 0x8b6b3a,       // wood
    breakSfx: 'thud',
    build: (x, y, z) => {
      const g = new THREE.BoxGeometry(1.4, 1.6, 1.4);
      const m = new THREE.MeshStandardMaterial({ color: 0xa07840 });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y + 0.8, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
  },
  barrier: {
    hp: 120,
    aabb: { x: 0.9, y: 0.6, z: 0.35 },
    debrisCount: 5,
    debrisColor: 0x8a8a8a,       // concrete
    breakSfx: 'thud',
    build: (x, y, z) => {
      const g = new THREE.BoxGeometry(1.8, 1.2, 0.7);
      const m = new THREE.MeshStandardMaterial({ color: 0x7c7c7c });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y + 0.6, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
  },
  window: {
    hp: 15,
    aabb: { x: 0.9, y: 0.9, z: 0.06 },
    debrisCount: 10,
    debrisColor: 0xa8dceb,       // glass-cyan
    breakSfx: 'thud',
    build: (x, y, z) => {
      const g = new THREE.BoxGeometry(1.8, 1.8, 0.12);
      const m = new THREE.MeshPhongMaterial({
        color: 0xbfe4ff, transparent: true, opacity: 0.45,
        shininess: 120, specular: 0xffffff,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y + 1.6, z);
      mesh.castShadow = false;
      return mesh;
    },
  },
  glass: {
    // Big storefront pane — same visual as window but chunkier.
    hp: 25,
    aabb: { x: 1.6, y: 1.6, z: 0.06 },
    debrisCount: 14,
    debrisColor: 0xa8dceb,
    breakSfx: 'thud',
    build: (x, y, z) => {
      const g = new THREE.BoxGeometry(3.2, 3.2, 0.12);
      const m = new THREE.MeshPhongMaterial({
        color: 0xbfe4ff, transparent: true, opacity: 0.45,
        shininess: 120, specular: 0xffffff,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y + 2.0, z);
      return mesh;
    },
  },
  streetlight: {
    hp: 80,
    aabb: { x: 0.35, y: 3.5, z: 0.35 },
    debrisCount: 4,
    debrisColor: 0x3a3a3a,
    breakSfx: 'thud',
    // Custom light source that dims on break. Stored on the outer
    // record so `_onBreak` can turn it off.
    build: (x, y, z) => {
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.10, 6.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a }),
      );
      pole.position.set(0, 3.2, 0);
      pole.castShadow = true;
      grp.add(pole);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.25, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xffd28a }),
      );
      head.position.set(0, 6.2, 0.4);
      grp.add(head);
      const light = new THREE.PointLight(0xffb060, 3.0, 14);
      light.position.set(0, 5.7, 0.4);
      grp.add(light);
      grp.position.set(x, y, z);
      // Stash for later dim on break.
      grp.__lampLight = light;
      grp.__lampHead = head;
      return grp;
    },
  },
  sign: {
    hp: 35,
    aabb: { x: 0.5, y: 1.5, z: 0.15 },
    debrisCount: 5,
    debrisColor: 0xc0c0c0,
    breakSfx: 'thud',
    build: (x, y, z) => {
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x666666 }),
      );
      pole.position.set(0, 1.3, 0);
      grp.add(pole);
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xd83a3a }),
      );
      face.position.set(0, 2.5, 0);
      grp.add(face);
      grp.position.set(x, y, z);
      return grp;
    },
  },
  barrel_explosive: {
    hp: 20,
    aabb: { x: 0.5, y: 1.1, z: 0.5 },
    debrisCount: 8,
    debrisColor: 0x9c2a2a,
    breakSfx: 'rpg',
    explosive: { damage: 90, blast: 6 },
    build: (x, y, z) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12),
        new THREE.MeshStandardMaterial({ color: 0xc03028 }),
      );
      body.position.set(0, 0.55, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.52, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
      );
      top.position.set(0, 1.14, 0);
      grp.add(top);
      grp.position.set(x, y, z);
      return grp;
    },
  },
};

// ── Debris pool ──────────────────────────────────────────────────────
// iter186 AAA polish — bumped from 220 → 500 chunks so back-to-back
// barrel-chains don't clip. Chunk size shrunk (0.14 → 0.10) so they
// read as shrapnel rather than blocks. Ground impact triggers a
// short-lived DUST PUFF (expanding grey sphere, fades over 0.6s)
// so explosions LOOK explosive.
const MAX_DEBRIS = 500;
const DEBRIS_TTL = 3.5;               // seconds
const MAX_DUST_PUFFS = 32;
const DUST_TTL = 0.6;                 // seconds

class DebrisPool {
  constructor(scene) {
    this.scene = scene;
    this.chunks = [];                 // { mesh, active, vx, vy, vz, wx, wy, wz, life }
    // Pre-allocate a single geometry we reuse for every chunk — a
    // small tetrahedron looks like a "shard" of anything.
    this.geo = new THREE.TetrahedronGeometry(0.10);
    // Material per-color cache so we can tint chunks by prop type
    // without allocating a new material per burst.
    this._matCache = new Map();
    // Dust puff pool — separate from debris because dust needs a
    // billboard-flat sphere w/ alpha fade, not a solid chunk.
    this.puffs = [];
    this._puffGeo = new THREE.SphereGeometry(0.6, 8, 6);
    this._puffMat = new THREE.MeshBasicMaterial({
      color: 0x9a9a9a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
  }
  _mat(color) {
    let m = this._matCache.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color });
      this._matCache.set(color, m);
    }
    return m;
  }
  spawn(x, y, z, color, count) {
    for (let i = 0; i < count; i++) {
      // Recycle the oldest active chunk if the pool is full.
      let slot = this.chunks.find((c) => !c.active);
      if (!slot) {
        if (this.chunks.length >= MAX_DEBRIS) {
          slot = this.chunks[0];
          this.chunks.push(this.chunks.shift());
          this.scene.remove(slot.mesh);
        } else {
          const mesh = new THREE.Mesh(this.geo, this._mat(color));
          mesh.castShadow = false;
          slot = { mesh, active: false, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, life: 0 };
          this.chunks.push(slot);
        }
      }
      slot.mesh.material = this._mat(color);
      slot.mesh.position.set(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.4);
      slot.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      slot.vx = Math.cos(ang) * sp;
      slot.vz = Math.sin(ang) * sp;
      slot.vy = 4 + Math.random() * 5;
      slot.wx = (Math.random() - 0.5) * 12;
      slot.wy = (Math.random() - 0.5) * 12;
      slot.wz = (Math.random() - 0.5) * 12;
      slot.life = DEBRIS_TTL;
      slot.active = true;
      slot._puffed = false;    // reset so recycled chunks puff on their NEW impact
      this.scene.add(slot.mesh);
    }
  }
  update(dt) {
    for (const c of this.chunks) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) { c.active = false; this.scene.remove(c.mesh); continue; }
      c.vy -= 22 * dt;                // gravity
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += c.wx * dt;
      c.mesh.rotation.y += c.wy * dt;
      c.mesh.rotation.z += c.wz * dt;
      if (c.mesh.position.y <= 0.05) {
        c.mesh.position.y = 0.05;
        // On the FIRST ground bounce, spawn a small dust puff so
        // the impact reads visually. Second and subsequent bounces
        // are silent (avoids puff-spam during the settle).
        if (!c._puffed && c.vy < -1.5) {
          this._spawnDust(c.mesh.position.x, 0.15, c.mesh.position.z, 1.0);
          c._puffed = true;
        }
        c.vy = -c.vy * 0.25;
        c.vx *= 0.55; c.vz *= 0.55;
        c.wx *= 0.4; c.wy *= 0.4; c.wz *= 0.4;
      }
    }
    // Update dust puffs — expand + fade over their lifetime.
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; this.scene.remove(p.mesh); continue; }
      const t = 1 - (p.life / DUST_TTL);          // 0 → 1
      const s = p.startScale + t * 3.5;           // grows fast
      p.mesh.scale.setScalar(s);
      // Fade out — opacity from 0.55 → 0 curved so it hangs early
      // and vanishes fast at the end (matches real dust behaviour).
      p.mesh.material.opacity = 0.55 * (1 - t * t);
      // Slight upward drift so the puff looks buoyant.
      p.mesh.position.y += 0.6 * dt;
    }
  }
  // ── Dust puff spawning ─────────────────────────────────────────────
  // The dust puff is a semi-transparent grey sphere that grows and
  // fades. Materials are per-puff (each fades independently) but
  // geometry is shared for perf.
  _spawnDust(x, y, z, startScale) {
    // Textured smoke-atlas puff when the VFX system is wired.
    if (this.vfx && this.vfx.ready) { this.vfx.dust(x, y, z, startScale * 0.7); return; }
    // Recycle inactive slot if available.
    let slot = this.puffs.find((p) => !p.active);
    if (!slot) {
      if (this.puffs.length >= MAX_DUST_PUFFS) {
        // Pool full — recycle the oldest.
        slot = this.puffs[0];
        this.puffs.push(this.puffs.shift());
        this.scene.remove(slot.mesh);
      } else {
        const mesh = new THREE.Mesh(this._puffGeo, this._puffMat.clone());
        mesh.renderOrder = 5;
        slot = { mesh, active: false, life: 0, startScale: 1 };
        this.puffs.push(slot);
      }
    }
    slot.mesh.material.opacity = 0.55;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(startScale);
    slot.startScale = startScale;
    slot.life = DUST_TTL;
    slot.active = true;
    this.scene.add(slot.mesh);
  }
  // Public API — trigger a big dust cloud at (x, y, z) (used by the
  // barrel-explosive chain-detonation for the initial blast puff).
  spawnDust(x, y, z, count = 3, radius = 1.2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this._spawnDust(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1.5 + Math.random());
    }
  }
  dispose() {
    for (const c of this.chunks) this.scene.remove(c.mesh);
    for (const p of this.puffs) this.scene.remove(p.mesh);
    this.chunks.length = 0;
    this.puffs.length = 0;
    this.geo.dispose();
    this._puffGeo.dispose();
    this._puffMat.dispose();
    for (const m of this._matCache.values()) m.dispose();
    this._matCache.clear();
  }
}

// ── DestructibleSystem ───────────────────────────────────────────────
export class DestructibleSystem {
  constructor(scene) {
    this.scene = scene;
    this.props = [];                  // { id, type, x, y, z, hp, alive, mesh, aabb, def, tint }
    this.debris = new DebrisPool(scene);
    this._nextId = 1;
    this._pendingExplosions = [];     // queued for engine to pick up
    this.vfx = null;
  }
  // Wire the Blender-textured VFX system: breaks + debris landings use
  // its splinters / shards / sparks / smoke instead of the legacy puffs.
  setVfx(vfx) { this.vfx = vfx; this.debris.vfx = vfx; }
  spawn(type, x, y, z, opts = {}) {
    const def = REGISTRY[type];
    if (!def) { console.warn(`[destructibles] unknown type: ${type}`); return null; }
    const mesh = def.build(x, y, z);
    this.scene.add(mesh);
    const rec = {
      id: this._nextId++,
      type,
      def,
      x, y, z,
      hp: opts.hp || def.hp,
      alive: true,
      mesh,
      aabb: def.aabb,
      color: def.debrisColor,
    };
    this.props.push(rec);
    return rec;
  }
  // Adopt an existing scene mesh (editor glass pane) as a breakable prop.
  // `y` is the pane's BOTTOM, aabb = half extents. `collider` is handed
  // to `onBreak` so the engine can drop it once the pane is gone.
  adoptPane({ mesh, collider = null, x, y, z, aabb, hp }) {
    const def = REGISTRY.glass;
    const rec = {
      id: this._nextId++, type: 'glass', def, x, y, z,
      hp: hp || def.hp, alive: true, mesh, aabb, color: def.debrisColor, collider, adopted: true,
    };
    this.props.push(rec);
    return rec;
  }
  // Ray-vs-AABB test — used by hitscan weapons to see if a bullet is
  // going to hit destructible geometry BEFORE it reaches a person.
  // Returns { rec, t } for the closest hit (or null).
  hitscan(o, d, range) {
    let best = null, bestT = range;
    for (const p of this.props) {
      if (!p.alive) continue;
      const a = p.aabb;
      const t = raySlab(o, d,
        p.x - a.x, p.x + a.x,
        p.y,       p.y + a.y * 2,
        p.z - a.z, p.z + a.z,
      );
      if (t != null && t < bestT) { best = p; bestT = t; }
    }
    return best ? { rec: best, t: bestT } : null;
  }
  // Point-in-AABB — for melee cone checks.
  meleeHit(x, y, z, range) {
    const hits = [];
    for (const p of this.props) {
      if (!p.alive) continue;
      const dx = Math.max(0, Math.max(p.x - p.aabb.x - x, x - (p.x + p.aabb.x)));
      const dz = Math.max(0, Math.max(p.z - p.aabb.z - z, z - (p.z + p.aabb.z)));
      const d2 = dx * dx + dz * dz;
      if (d2 <= range * range) hits.push(p);
    }
    return hits;
  }
  // AOE damage from an explosion.
  splashDamage(x, y, z, radius, dmg) {
    for (const p of this.props) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius) continue;
      const localDmg = Math.round(dmg * (1 - d / radius));
      if (localDmg > 0) this.damage(p.id, localDmg);
    }
  }
  damage(id, dmg) {
    const p = this.props.find((x) => x.id === id);
    if (!p || !p.alive) return;
    p.hp -= dmg;
    if (p.hp <= 0) this._break(p);
  }
  _break(p) {
    p.alive = false;
    // Streetlight: dim its point light so the area actually gets
    // darker after you shoot it out.
    if (p.type === 'streetlight' && p.mesh && p.mesh.__lampLight) {
      p.mesh.__lampLight.intensity = 0;
      if (p.mesh.__lampHead) p.mesh.__lampHead.material.color.setHex(0x2a2a2a);
    } else {
      // Everything else: just hide the main mesh.
      p.mesh.visible = false;
    }
    // Debris: the Blender-textured VFX (splinters / chips / sparks /
    // shards + smoke-atlas dust) when wired, else the pooled tet chunks
    // and grey puffs. Barrels skip their own cloud — the engine's
    // explosion (fireball + smoke + shockwave) comes from drainExplosions.
    const surf = SURFACE_OF_PROP[p.type] || 'metal';
    const vfx = this.vfx && this.vfx.ready ? this.vfx : null;
    if (vfx) {
      if (surf === 'glass') {
        vfx.glassShatter(p.x, p.y + p.aabb.y, p.z, { w: p.aabb.x * 2, h: p.aabb.y * 2, nx: p.aabb.x >= p.aabb.z ? 0 : 1, nz: p.aabb.x >= p.aabb.z ? 1 : 0, count: p.def.debrisCount * 3 });
        playGlassShatterAt(p.x, p.y + p.aabb.y, p.z, p.aabb.x * p.aabb.y > 1.2);
      } else if (!p.def.explosive) {
        this.debris.spawn(p.x, p.y + p.aabb.y, p.z, p.color, p.def.debrisCount);
        vfx.debrisBurst(p.x, p.y + p.aabb.y * 0.7, p.z, surf, p.def.debrisCount + 2);
        playDebrisBreakAt(surf, p.x, p.y + p.aabb.y, p.z);
      } else {
        this.debris.spawn(p.x, p.y + p.aabb.y, p.z, p.color, p.def.debrisCount);
      }
    } else {
      // Spawn debris in a burst at prop center.
      this.debris.spawn(p.x, p.y + p.aabb.y, p.z, p.color, p.def.debrisCount);
      // AAA dust puff on break — a small cloud rises at the base for
      // non-explosive props, a big cloud at chest height for barrels.
      if (p.def.explosive) {
        this.debris.spawnDust(p.x, p.y + p.aabb.y * 0.5, p.z, 6, 2.4);
      } else {
        this.debris.spawnDust(p.x, p.y + 0.15, p.z, 2, 0.8);
      }
    }
    // Explosive barrel — queue an explosion for the engine to process.
    if (p.def.explosive) {
      this._pendingExplosions.push({
        x: p.x, y: p.y + p.aabb.y, z: p.z,
        damage: p.def.explosive.damage,
        blast: p.def.explosive.blast,
        wpnId: 'rpg',
      });
    }
    if (typeof this.onBreak === 'function') this.onBreak(p);
  }
  // Engine drains queued barrel detonations each frame — it applies
  // AOE damage to actors AND chain-detonates other destructibles.
  drainExplosions() {
    if (!this._pendingExplosions.length) return [];
    const out = this._pendingExplosions;
    this._pendingExplosions = [];
    return out;
  }
  update(dt) {
    this.debris.update(dt);
  }
  dispose() {
    for (const p of this.props) this.scene.remove(p.mesh);
    this.props.length = 0;
    this.debris.dispose();
  }
}

// Ray-vs-AABB (branchless slab test). Returns closest positive
// entry-t, or null if no hit inside [0, range].
function raySlab(o, d, x0, x1, y0, y1, z0, z1) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [dc, oc, lo, hi] of [
    [d.x, o.x, x0, x1],
    [d.y, o.y, y0, y1],
    [d.z, o.z, z0, z1],
  ]) {
    if (Math.abs(dc) < 1e-6) {
      if (oc < lo || oc > hi) return null;
    } else {
      let t1 = (lo - oc) / dc, t2 = (hi - oc) / dc;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin > 0 ? tmin : null;
}

// Convenience — a stock scatter of destructibles for any brawl map so
// every arena immediately gets breakable props without each map having
// to hand-place them. Maps that want bespoke placements pass their
// own list to `system.spawn(...)`; this helper just populates the
// generic street furniture.
export function scatterDefaultProps(system, half) {
  const jitter = (r) => (Math.random() - 0.5) * 2 * r;
  const h = Math.max(20, (half || 40));
  // Corner streetlights (one per quadrant, offset from the wall).
  for (const s of [-1, 1]) for (const s2 of [-1, 1]) {
    system.spawn('streetlight', s * (h - 4) + jitter(1), 0, s2 * (h - 4) + jitter(1));
  }
  // Explosive barrel piles (2 per side).
  for (let i = 0; i < 6; i++) {
    system.spawn('barrel_explosive', jitter(h * 0.7), 0, jitter(h * 0.7));
  }
  // Wooden crates scattered around.
  for (let i = 0; i < 8; i++) {
    system.spawn('crate', jitter(h * 0.8), 0, jitter(h * 0.8));
  }
  // Concrete barriers along the perimeter.
  for (let i = 0; i < 6; i++) {
    system.spawn('barrier', jitter(h * 0.9), 0, jitter(h * 0.9));
  }
  // A few traffic signs.
  for (let i = 0; i < 4; i++) {
    system.spawn('sign', jitter(h * 0.6), 0, jitter(h * 0.6));
  }
}
