// render/lightPool.js — fixed-size pool of real PointLights that follows
// the player.
//
// WHY: three.js forward-renders every PointLight in EVERY material's
// fragment shader, and the shader program is keyed on the light COUNT.
// A map that streams ~70 lamp lights in and out (The Projects) therefore
// (a) pays for 70 lights per pixel and (b) recompiles every shader each
// time a lamp crosses the stream radius — the tile-boundary hitch.
//
// The pool adopts every static PointLight (detaches it from the scene
// graph, keeps it as a "virtual" light descriptor) and drives N real
// lights — constant count, constant cost, zero recompiles. Each update
// the N virtual lights closest to the player are bound; intensities
// fade so bindings never pop. The source PointLight object stays the
// source of truth: gameplay code that dims a lamp (destructible
// streetlight → `light.intensity = 0`) keeps working unchanged.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export const LIGHT_BUDGET = { performance: 4, balanced: 6, quality: 10 };

export class LightPool {
  constructor(scene, { max = 5, interval = 0.12, fade = 5 } = {}) {
    this.scene = scene;
    this.max = Math.max(1, max | 0);
    this.interval = interval;
    this.fade = fade;
    this.virtual = [];                 // { src: PointLight, pos: Vector3 }
    this.real = [];                    // pooled PointLights, always in scene
    this._acc = interval;              // bind on first update
    for (let i = 0; i < this.max; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.name = `pooledLight_${i}`;
      l.castShadow = false;
      l.userData.pooled = true;
      l.__bound = null;
      scene.add(l);
      this.real.push(l);
    }
  }

  // Adopt PointLights under `root` (Object3D or array of them). Skips
  // pooled / `userData.dynamic` lights and ones already adopted. With
  // `tracked: true` the light follows its (moving) parent — the world
  // position is re-derived from the parent each update (vehicle sirens).
  adopt(root, { tracked = false } = {}) {
    const roots = Array.isArray(root) ? root : [root];
    const found = [];
    for (const r of roots) {
      if (!r || !r.traverse) continue;
      r.updateMatrixWorld(true);
      r.traverse((o) => {
        if (o.isPointLight && !o.userData.pooled && !o.userData.adopted && (tracked || !o.userData.dynamic)) found.push(o);
      });
    }
    for (const l of found) {
      l.getWorldPosition(_v);
      l.userData.adopted = true;
      const parent = l.parent;
      if (parent) parent.remove(l);
      this.virtual.push({ src: l, pos: _v.clone(), parent, anchor: tracked ? parent : null, local: tracked ? l.position.clone() : null });
    }
    return found.length;
  }

  _refresh(v) {
    if (!v.anchor) return;
    v.anchor.updateWorldMatrix(true, false);
    v.pos.copy(v.local).applyMatrix4(v.anchor.matrixWorld);
  }

  update(px, py, pz, dt) {
    const k = 1 - Math.exp(-this.fade * (dt || 0.016));
    this._acc += dt || 0;
    if (this._acc >= this.interval) {
      this._acc = 0;
      this._rebind(px, py, pz);
    }
    for (const l of this.real) {
      const b = l.__bound;
      const target = b ? Math.max(0, b.src.intensity) : 0;
      if (b) {
        l.color.copy(b.src.color); l.distance = b.src.distance; l.decay = b.src.decay;
        if (b.anchor) { this._refresh(b); l.position.copy(b.pos); }
      }
      l.intensity += (target - l.intensity) * k;
      if (!b && l.intensity < 0.01) l.intensity = 0;
    }
  }

  _rebind(px, py, pz) {
    const V = this.virtual;
    if (!V.length) return;
    // Rank by how much the lamp matters where the player stands: its
    // intensity scaled by how deep inside its range the player is,
    // with a distance tiebreak so far lamps still get a turn.
    for (const v of V) {
      this._refresh(v);
      const d = Math.hypot(v.pos.x - px, v.pos.y - py, v.pos.z - pz);
      const range = v.src.distance > 0 ? v.src.distance : 30;
      v._d = d;
      v._score = v.src.intensity <= 0 ? -1 : v.src.intensity * Math.max(0.05, 1.5 - d / range);
    }
    const top = V.filter((v) => v._score > 0).sort((a, b) => b._score - a._score).slice(0, this.max);
    const want = new Set(top);
    const free = [];
    for (const l of this.real) {
      if (l.__bound && want.has(l.__bound)) { want.delete(l.__bound); continue; }
      free.push(l);
    }
    for (const v of want) {
      const l = free.pop();
      if (!l) break;
      l.__bound = v;
      l.position.copy(v.pos);
      l.intensity = 0;                 // fade in from dark
    }
    for (const l of free) l.__bound = null;   // fade out
  }

  boundCount() { return this.real.filter((l) => l.__bound).length; }

  dispose() {
    for (const l of this.real) this.scene.remove(l);
    this.real.length = 0;
    this.virtual.length = 0;
  }
}
