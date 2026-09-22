// Team Gangsta Brawl — upgraded ragdoll for dying Saints.
//
// v2 improvements (Feb 2026):
//   • Multi-bounce floor contact — 2-3 diminishing elastic bounces
//     before final settle instead of the old "kill vy on contact" clamp.
//     Reads like a real limp body hitting concrete rather than
//     magnet-locking to the ground.
//   • Random final-rest pose picked from the seed — the body may
//     settle face-up, face-down, on their side (either), or curled.
//     Adds visual variety across the deathmatch.
//   • Full 3-axis angular integration with independent damping per
//     axis so head-first spins don't decay identically to sideways.
//   • Head-lag bob + limb-flail flags — the accompanying character
//     mesh (see `characterMeshy.js`) reads these to add per-bone
//     visual flails on top of the group-level rigid body motion.
//   • Ground-slide friction is speed-dependent — a hard hit slides
//     far before settling, a gentle push barely moves.
//
// Still a single-rigid-body ragdoll (multi-link physics is too heavy
// for shared authority + the mobile browser target) — the sim runs
// per client but is deterministic-ish from the actor id so remote
// deaths match the killer's client visually within a frame or two.

const GRAVITY = 18;
const FRICTION = 4.8;                    // ground sliding decay (was 5.5 — slides longer)
const ANG_DECAY_AIR = 0.4;               // slow decay while airborne — keeps tumble alive
const ANG_DECAY_GROUND_X = 2.2;          // pitch settles fast (upright/prone)
const ANG_DECAY_GROUND_Z = 3.4;          // side-roll settles very fast
const ANG_DECAY_GROUND_Y = 1.6;          // yaw twist keeps a hair longer

// Menu of possible resting poses (rx, rz targets). The exact one is
// picked from the ragdoll's seed so deaths vary but stay deterministic.
const PANCAKE_SPEED = 5.5;   // m/s into a wall → body sticks flat then slides
const REST_POSES = [
  { rx: -Math.PI / 2, rz: 0,             name: 'supine' },       // classic face-up
  { rx:  Math.PI / 2, rz: 0,             name: 'prone' },        // face-down
  { rx: -Math.PI / 2, rz:  Math.PI / 3,  name: 'sideR' },        // rolled right
  { rx: -Math.PI / 2, rz: -Math.PI / 3,  name: 'sideL' },        // rolled left
  { rx: -Math.PI / 2 + 0.35, rz: 0,      name: 'crumpled' },     // half-sitting
];

export class Ragdoll {
  constructor(seed) {
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.rx = 0; this.rz = 0; this.ry = 0;                       // accumulated rotations
    this.wx = 0; this.wz = 0; this.wy = 0;                       // angular velocities
    this.grounded = false;
    this.settleT = 0;
    this.seed = seed;
    this.gravityMul = 1;                                          // 1 = normal; <1 = floaty
    this.balloon = false;                                         // AK-headshot easter egg
    this.balloonT = 0;                                            // seconds airborne
    // Multi-bounce state — remaining bounce budget. Each floor
    // contact consumes one bounce and shrinks the return velocity;
    // when it hits 0, the body sticks and slides.
    this.bouncesLeft = 2;
    // Deterministic rest pose pick.
    const pi = (((seed | 0) * 2654435761) >>> 0) % REST_POSES.length;
    this.restPose = REST_POSES[pi];
    // Head-lag pointer (radians) — the mesh reads this and lags the
    // head bone behind body rotation for that "lolling" feel.
    this.headLag = 0;
    // Limb-flail intensity 0..1 — high during airborne + first
    // ground contact, fades to 0 as body settles.
    this.limbFlail = 0;
    // Impact-shock timer — bumps to 1 on each floor contact, decays
    // over ~0.4s. Character mesh reads this for a brief limb jerk.
    this.impactShock = 0;
    // Direction of initial impulse (unit vector). Used by the mesh
    // to bias limb positions (arms trail behind, legs kick forward).
    this.dirX = 0; this.dirZ = 1;
  }

  // Kick the ragdoll on the very first frame of death.  `yaw` is the
  // Saint's facing — they fall backwards (away from where they were
  // facing) so it reads as "they got shot in the chest".
  start(yaw, impulse = 1) {
    const back = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const jitter = (((this.seed * 1103515245 + 12345) >>> 0) % 1000) / 1000 - 0.5;
    this.vx = back.x * 3.4 * impulse + jitter * 1.4;
    this.vz = back.z * 3.4 * impulse + jitter * 1.4;
    this.vy = 3.6 * impulse;
    // Full 3-axis initial spin — pitch back + a randomised sideways
    // roll + yaw twist for variety.
    this.wx = -3.8 * impulse + jitter * 0.6;
    this.wz = jitter * 2.4;
    this.wy = jitter * 1.4;
    this.grounded = false;
    this.settleT = 0;
    this.bouncesLeft = 2;
    this.limbFlail = 1;
    this.impactShock = 0.5;
    this.dirX = back.x; this.dirZ = back.z;
  }

  // Directed impulse — used for shotgun blowback, pimp-slap fling,
  // AK-47 headshot balloon. `dir` is a normalized world-space vector
  // pointing IN THE DIRECTION THE BODY SHOULD TRAVEL (i.e. away from
  // the attacker). `up` is an extra vertical bias. Options:
  //   • strength   linear velocity magnitude (m/s)
  //   • spin       extra angular kick around the horizontal axis
  //   • balloon    true → tiny gravity, huge upward push, delayed
  //                settle → the AK-headshot "float away" effect
  //   • mode       'crumple' (knees buckle, barely moves) · 'stagger'
  //                (twisting fall) · 'blast' (flung) · 'headsnap' (whip
  //                back) · 'spin' (melee side-spin) · 'launch'
  //   • rest       final pose name (supine/prone/sideR/sideL/crumpled)
  //                — derived from the hit direction by the engine
  //   • twist      extra yaw spin (rad/s) · lateral  sideways m/s
  startImpulse({ dx = 0, dy = 0, dz = 0, up = 0, strength = 6, spin = 4, balloon = false, gravityMul = 1, mode = 'default', rest = null, twist = 0, lateral = 0 } = {}) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const jitter = (((this.seed * 1103515245 + 12345) >>> 0) % 1000) / 1000 - 0.5;
    this.vx = ux * strength + jitter * 1.2;
    this.vy = uy * strength + up;
    this.vz = uz * strength + jitter * 1.2;
    // Spin backward around the direction of travel — reads as a
    // tumbling knockback rather than a flat slide.
    this.wx = -spin + jitter * 1.6;
    this.wz = jitter * 2.4;
    this.wy = jitter * 1.8 + twist;
    this.mode = mode;
    if (lateral) { const flat0 = Math.hypot(ux, uz) || 1; this.vx += (-uz / flat0) * lateral; this.vz += (ux / flat0) * lateral; }
    if (mode === 'crumple') { this.wx = -spin * 0.5; this.wz = jitter * 0.8; }
    if (mode === 'headsnap') { this.wx = -spin - 4; }
    const rp = rest && REST_POSES.find((r) => r.name === rest);
    if (rp) this.restPose = rp;
    this.pancake = null;
    this.grounded = false;
    this.settleT = 0;
    this.balloon = !!balloon;
    this.balloonT = 0;
    this.gravityMul = balloon ? 0.06 : gravityMul;
    this.bouncesLeft = balloon ? 0 : 2;
    this.limbFlail = 1;
    this.impactShock = 0.6;
    // Direction of travel bias for the mesh to read.
    const flat = Math.hypot(ux, uz) || 1;
    this.dirX = ux / flat; this.dirZ = uz / flat;
  }

  // Re-kick an already-ragdolled body — used when a live player
  // slaps / kicks a corpse. Adds velocity on top of whatever the
  // ragdoll is currently doing so multi-hits chain cleanly.
  applyImpulse({ dx = 0, dy = 0, dz = 0, up = 0, strength = 6, spin = 4 } = {}) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    this.vx += ux * strength;
    this.vy += uy * strength + up;
    this.vz += uz * strength;
    this.wx -= spin;
    this.wy += (Math.random() - 0.5) * 3;
    this.wz += (Math.random() - 0.5) * 3;
    // Any additional push counts as new airtime — reset the settle
    // clock so the pose doesn't lock face-down mid-tumble.
    this.grounded = false;
    this.settleT = 0;
    this.bouncesLeft = Math.max(this.bouncesLeft, 1);
    this.limbFlail = Math.max(this.limbFlail, 0.7);
    this.impactShock = 1;
  }

  // Per-frame integration.  Pos is the actor's world-space position
  // (mutated in place).  `colliders` is the arena's AABB list.
  step(dt, pos, colliders, half) {
    // Pancaked against a wall: no gravity/bounce physics — hold, then slide.
    if (this.pancake) {
      const pk = this.pancake;
      pk.t += dt;
      pos.x = pk.x; pos.z = pk.z;
      // flatten against the wall (upright, no roll), head lolls
      this.rx += (0 - this.rx) * Math.min(1, dt * 9);
      this.rz += (0 - this.rz) * Math.min(1, dt * 9);
      if (pk.t > pk.hold) {
        // slide down the face — friction keeps it slower than free fall
        this.vy = Math.max(-4.5, this.vy - GRAVITY * 0.35 * dt);
        pos.y += this.vy * dt;
        this.rz += (pk.nx !== 0 ? 0.35 : -0.35) * dt;          // start tipping as it slides
      }
      this.limbFlail = Math.max(0.35, this.limbFlail - dt * 0.4);
      let floorY = 0;
      for (const c of colliders) if (c.grid) floorY = Math.max(floorY, c.grid.topAt(pos.x, pos.z, pos.y + 0.5));
      if (pos.y <= floorY) {
        // slumps at the base and slides off the wall a touch
        pos.y = floorY;
        this.pancake = null;
        this.grounded = true; this.settleT = 0;
        this.vy = 0; this.vx = pk.nx * 0.6; this.vz = pk.nz * 0.6;
        this.wx = 0; this.wz = 0; this.wy = 0;
        this.impactShock = 0.8;
      }
      this.headLag += (0.4 - this.headLag) * Math.min(1, dt * 4);
      this.impactShock = Math.max(0, this.impactShock - dt * 2.5);
      return;
    }
    if (this.settleT > 3 && !this.balloon) {
      // Decay lingering visual state so the mesh reads as still.
      this.limbFlail = Math.max(0, this.limbFlail - dt * 0.5);
      this.impactShock = Math.max(0, this.impactShock - dt * 2);
      return;
    }
    // Balloon bodies float upward instead of falling — a slow gravity
    // multiplier keeps them drifting for a few seconds before the
    // engine despawns them.
    if (this.balloon) {
      this.balloonT += dt;
      // Slight vertical assist so the body keeps climbing even after
      // the initial impulse decays.
      this.vy += 4 * dt;
    }
    // gravity + linear
    this.vy -= GRAVITY * this.gravityMul * dt;
    pos.x += this.vx * dt;
    pos.y += this.vy * dt;
    pos.z += this.vz * dt;
    // arena bounds
    const lim = half - 0.4;
    if (pos.x > lim) { pos.x = lim; this.vx *= -0.3; this.impactShock = Math.max(this.impactShock, 0.6); }
    if (pos.x < -lim) { pos.x = -lim; this.vx *= -0.3; this.impactShock = Math.max(this.impactShock, 0.6); }
    if (pos.z > lim) { pos.z = lim; this.vz *= -0.3; this.impactShock = Math.max(this.impactShock, 0.6); }
    if (pos.z < -lim) { pos.z = -lim; this.vz *= -0.3; this.impactShock = Math.max(this.impactShock, 0.6); }
    // AABB push-out (slide along walls) — skipped for ballooned
    // bodies since they're above building tops.
    let floorY = 0;
    if (!this.balloon) {
      for (const c of colliders) {
        if (c.grid) {
          // Imported SR chunk — the street under the body is the floor.
          const gt = c.grid.topAt(pos.x, pos.z, pos.y + 0.5);
          if (gt > floorY) floorY = gt;
          continue;
        }
        if (pos.y > c.h + 0.2) continue;
        if (pos.x < c.x0 || pos.x > c.x1 || pos.z < c.z0 || pos.z > c.z1) continue;
        // Closest edge
        const dxL = pos.x - c.x0, dxR = c.x1 - pos.x;
        const dzN = pos.z - c.z0, dzF = c.z1 - pos.z;
        const m = Math.min(dxL, dxR, dzN, dzF);
        // Speed INTO the wall — a body flung hard enough pancakes.
        const intoWall = m === dxL ? this.vx : m === dxR ? -this.vx : m === dzN ? this.vz : -this.vz;
        const nx = m === dxL ? -1 : m === dxR ? 1 : 0, nz = m === dzN ? -1 : m === dzF ? 1 : 0;
        if (m === dxL) { pos.x = c.x0 - 0.01; this.vx = -Math.abs(this.vx) * 0.3; }
        else if (m === dxR) { pos.x = c.x1 + 0.01; this.vx = Math.abs(this.vx) * 0.3; }
        else if (m === dzN) { pos.z = c.z0 - 0.01; this.vz = -Math.abs(this.vz) * 0.3; }
        else { pos.z = c.z1 + 0.01; this.vz = Math.abs(this.vz) * 0.3; }
        this.impactShock = Math.max(this.impactShock, 0.5);
        if (intoWall > PANCAKE_SPEED && !this.grounded && !this.pancake && c.h - pos.y > 0.6) {
          // ── Wall pancake: stick flat to the face, hold, slide down ──
          this.pancake = { t: 0, hold: 0.3 + 0.35 * Math.min(1, intoWall / 14), nx, nz, x: pos.x, z: pos.z, floor: 0 };
          this.vx = 0; this.vz = 0; this.vy = 0;
          this.wx = 0; this.wz = 0; this.wy = 0;
          this.impactShock = 1; this.limbFlail = 1;
          this.bouncesLeft = 0;
          this.restPose = REST_POSES.find((r) => r.name === 'crumpled') || this.restPose;
        }
      }
    }
    // floor — multi-bounce.
    if (pos.y <= floorY && !this.balloon) {
      pos.y = floorY;
      const bounceStrength = 0.35;                        // return velocity fraction on bounce
      if (this.vy < -1.4 && this.bouncesLeft > 0) {
        // Elastic bounce — return upward with diminishing energy.
        this.vy = -this.vy * bounceStrength;
        this.vx *= 0.7; this.vz *= 0.7;
        // Angular energy also transfers — the body spins a bit more
        // on each bounce (bones flap).
        this.wx *= 0.55; this.wz *= 0.85; this.wy *= 0.85;
        this.bouncesLeft--;
        this.impactShock = 1;
        this.limbFlail = Math.min(1, this.limbFlail + 0.4);
      } else if (!this.grounded) {
        // First terminal contact — kill vertical, dampen horizontal.
        this.vy = 0;
        this.vx *= 0.55; this.vz *= 0.55;
        this.wx *= 0.4; this.wz *= 0.4; this.wy *= 0.4;
        this.grounded = true;
        this.impactShock = 0.7;
      } else {
        // Sliding friction — speed-dependent so a hard-hit body
        // slides way further than a lightly-tapped one.
        this.vy = 0;
        const sp = Math.hypot(this.vx, this.vz);
        const k = Math.max(0, 1 - FRICTION * dt / Math.max(0.001, sp));
        this.vx *= k; this.vz *= k;
      }
    }
    // angular integration + axis-independent damping.
    this.rx += this.wx * dt;
    this.rz += this.wz * dt;
    this.ry += this.wy * dt;
    // Decay each axis on its own — air phase is softly damped
    // (keeps the tumble alive), grounded phase snaps to rest fast.
    let dampX, dampZ, dampY;
    if (this.grounded) {
      dampX = ANG_DECAY_GROUND_X;
      dampZ = ANG_DECAY_GROUND_Z;
      dampY = ANG_DECAY_GROUND_Y;
    } else if (this.balloon) {
      dampX = ANG_DECAY_AIR * 0.3;
      dampZ = ANG_DECAY_AIR * 0.3;
      dampY = ANG_DECAY_AIR * 0.3;
    } else {
      dampX = ANG_DECAY_AIR;
      dampZ = ANG_DECAY_AIR;
      dampY = ANG_DECAY_AIR;
    }
    this.wx *= Math.max(0, 1 - dampX * dt);
    this.wz *= Math.max(0, 1 - dampZ * dt);
    this.wy *= Math.max(0, 1 - dampY * dt);
    // Head-lag — the "head" rotation follows the body rx with a
    // small delay so a hard tumble reads with a distinct head bob.
    // Character mesh reads `this.headLag` and offsets the head bone.
    const headTarget = this.rx * 0.35;
    this.headLag += (headTarget - this.headLag) * Math.min(1, dt * 6.5);
    // Clamp to rest pose once grounded — pull rx toward the chosen
    // final pose (supine/prone/side/crumpled — deterministic from seed)
    // instead of forcing everyone flat on their back.
    if (this.grounded) {
      this.settleT += dt;
      const easeK = Math.min(1, dt * 1.7);
      this.rx += (this.restPose.rx - this.rx) * easeK;
      this.rz += (this.restPose.rz - this.rz) * easeK;
    }
    // Limb-flail intensity fades gradually — bones get progressively
    // less floppy as the body settles. Impact shock decays quickly.
    const flailDecay = this.grounded ? 0.9 : 0.15;
    this.limbFlail = Math.max(0, this.limbFlail - dt * flailDecay);
    this.impactShock = Math.max(0, this.impactShock - dt * 2.5);
  }

  /** Apply to a Three.js Object3D — sets its rotation order to YXZ so
   *  the face-plant pitch is independent of yaw twist. */
  apply(obj3d) {
    obj3d.rotation.order = 'YXZ';
    obj3d.rotation.x = this.rx;
    obj3d.rotation.y += this.ry;                          // additive twist on top of yaw
    obj3d.rotation.z = this.rz;
  }
}
