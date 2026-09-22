// Team Gangsta Brawl — asset streaming manager.
//
// Splits the arena into a coarse XZ grid of tiles.  Each non-essential
// object (perimeter buildings, decorative props, lamps, hedges, etc.)
// is registered with the tile it lives in.  Essential objects (ground,
// sky dome, lights, inner-cover blocks, colliders the player spawns
// adjacent to) are always resident.
//
// Each frame the manager checks the player's current tile; tiles
// within `loadRadius` are added to the scene, tiles beyond
// `unloadRadius` are removed.  This gives us free fade-in/out streaming
// without ever loading the whole map before gameplay begins.
//
// Colliders are kept resident regardless of tile state — bullets and
// movement queries always see the full collision set, so distant
// buildings still block shots even when their meshes are unloaded.

import { warmUpScene } from './render/warmup.js';

const TILE = 30;                                       // metres per tile

function tileKey(x, z) {
  return `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
}

export class StreamingManager {
  constructor({ scene, loadRadius = 2, unloadRadius = 3 }) {
    this.scene = scene;
    this.loadRadius = loadRadius;
    this.unloadRadius = unloadRadius;
    this.tiles = new Map();                            // key → { objs:[], resident:bool }
    this.essentials = [];                              // always-resident objects
    this.currentKey = '';
    this.lastCheck = 0;
  }

  /** Add an object that should always be in the scene. */
  addEssential(obj) {
    this.essentials.push(obj);
    this.scene.add(obj);
  }

  /** Add an object that should stream in/out based on its world XZ. */
  addStreamable(obj, x, z) {
    const k = tileKey(x, z);
    let bucket = this.tiles.get(k);
    if (!bucket) { bucket = { objs: [], resident: false, cx: Math.floor(x / TILE), cz: Math.floor(z / TILE) }; this.tiles.set(k, bucket); }
    bucket.objs.push(obj);
    // Lazy: don't add to scene yet — first update() will load nearby.
  }

  /** Number of streamable tiles (debug/HUD). */
  tileCount() { return this.tiles.size; }

  residentTileCount() {
    let n = 0;
    for (const b of this.tiles.values()) if (b.resident) n++;
    return n;
  }

  /** Run from the game loop with the player position. */
  update(px, pz, now) {
    // Throttle to ~6Hz — streaming decisions don't need 60fps.
    if (now - this.lastCheck < 0.166) return;
    this.lastCheck = now;

    const ck = tileKey(px, pz);
    if (ck === this.currentKey) return;
    this.currentKey = ck;

    const pcx = Math.floor(px / TILE), pcz = Math.floor(pz / TILE);
    for (const bucket of this.tiles.values()) {
      const dx = bucket.cx - pcx, dz = bucket.cz - pcz;
      const d = Math.max(Math.abs(dx), Math.abs(dz));     // Chebyshev
      if (!bucket.resident && d <= this.loadRadius) {
        for (const o of bucket.objs) this.scene.add(o);
        bucket.resident = true;
      } else if (bucket.resident && d > this.unloadRadius) {
        for (const o of bucket.objs) this.scene.remove(o);
        bucket.resident = false;
      }
    }
  }

  /** Force every tile resident — used for the initial frame so the
   *  scene isn't empty before the first update() lands. */
  primeAround(px, pz) {
    const pcx = Math.floor(px / TILE), pcz = Math.floor(pz / TILE);
    for (const bucket of this.tiles.values()) {
      const dx = bucket.cx - pcx, dz = bucket.cz - pcz;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (!bucket.resident && d <= this.loadRadius) {
        for (const o of bucket.objs) this.scene.add(o);
        bucket.resident = true;
      }
    }
    this.currentKey = tileKey(px, pz);
  }

  /** Every registered object (resident or not) plus essentials. */
  allObjects() {
    const out = [...this.essentials];
    for (const b of this.tiles.values()) out.push(...b.objs);
    return out;
  }

  /** Non-resident streamables only (for warm-up passes). */
  parkedObjects() {
    const out = [];
    for (const b of this.tiles.values()) if (!b.resident) out.push(...b.objs);
    return out;
  }

  /**
   * Shader + texture warm-up (render/warmup.js) with every parked tile
   * temporarily resident, so a tile streaming in never compiles or
   * uploads anything mid-match. Returns the texture count.
   */
  warmUp(renderer, camera, opts = {}) {
    return warmUpScene(renderer, this.scene, camera, { ...opts, extraObjects: this.parkedObjects() }).textures;
  }

  dispose() {
    for (const bucket of this.tiles.values()) {
      if (bucket.resident) {
        for (const o of bucket.objs) this.scene.remove(o);
      }
      bucket.resident = false;
    }
    this.tiles.clear();
    for (const o of this.essentials) this.scene.remove(o);
    this.essentials.length = 0;
  }
}
