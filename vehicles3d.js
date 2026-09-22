// Team Gangsta Brawl — drivable vehicles.
//
// Top-down arcade car physics + entry/exit + HP/smoke/explosion +
// 10s-after-destruction respawn. One mesh template (`testcar` from
// sr1world.glb) is reused for every car.
//
// Vehicle state shape (one per arena spawn):
//   id, spawn:{x,z,yaw}, x,y,z,yaw, speed,
//   hp, maxHp, dead, wreckedT, destroyedT,
//   driver, passenger,           // player ids ('me' for local) or null
//   team,                        // 'A' | 'B' | null (set by first
//                                //  occupant; locks others out)
//   group (THREE.Group),         // root mesh
//   bodyMesh, smokeGray, smokeBlack, explosionT.
//
// External API:
//   buildVehicleSet(scene, spawns)   → Vehicle[]
//   updateVehicle(v, dt)             → ticks position, smoke, hp
//   damageVehicle(v, dmg, by)        → applies damage, returns true if killed
//   respawnVehicle(v)                → resurrects at original spawn

import * as THREE from 'three';
import { ensureGlb, getGlbGeometry } from './glbAssets.js';
import { preloadQuota, cloneQuotaMesh } from './quotaModel.js';
import { preloadDirtBike, cloneDirtBikeMesh, getDirtBikeAnchors } from './dirtBike.js';
import { preloadVenom, cloneVenomMesh } from './venomCar.js';

// Kick off GLB load at module init so by the time the player enters
// an arena, `testcar` geometry is usually ready. Fallback box is used
// if not.
ensureGlb().catch(() => {});
// Also preload the special-variant Quota (police trike) GLB so cop
// spawns aren't stuck with the procedural fallback for the first
// couple seconds after arena load.
preloadQuota();
// Preload the dirt bike so bike spawns swap the procedural fallback
// out for the real motocross mesh within a second or two of arena load.
preloadDirtBike();
// Preload the Venom (Corvette Stingray) sports car so player-start
// vehicles are visible on the very first frame.
preloadVenom();

const CAR_MAX_HP    = 300;
const CAR_HALF_LEN  = 2.6;     // half length along forward axis
const CAR_HALF_WIDE = 1.2;     // half width perpendicular
const CAR_HEIGHT    = 1.5;
const RESPAWN_DELAY = 10;      // seconds wreckage stays before respawn

// ── Dirt bike constants ────────────────────────────────────────────
// The bike collider is intentionally narrower than a car — riders
// can thread it through pedestrian gaps and squeeze between building
// pillars. Height is lower so bullets over the bars fly true.
const BIKE_MAX_HP    = 140;
const BIKE_HALF_LEN  = 1.20;
const BIKE_HALF_WIDE = 0.55;
const BIKE_HEIGHT    = 1.10;
// Passenger seat offset in bike-local coords (behind the driver).
const BIKE_PASSENGER_OFFSET = -0.55;

// Palette of "nice" SR1-flavoured car body colors. Each spawn picks
// one at random so the lot doesn't look monochrome.
const CAR_COLORS = [
  0x6f1a1a,   // burgundy
  0x1d3b6f,   // saints blue
  0x0e5a3a,   // forest green
  0x6f4e1a,   // mustard
  0x2a2a32,   // gunmetal
  0x4a1e6f,   // deep purple
  0xb8842b,   // rust gold
  0x1c1c1c,   // matte black
];

// ── Quota (police trike) body builder ──────────────────────────────
// The Quota is a SPECIAL VARIANT — a 3-wheeled police cruiser (2 rear
// + 1 front wheel, per spec). Its GLB ships with those wheels already
// modelled; we only add the red/blue emergency-light rig on top so
// the R3-toggle can flash the classic cop bar.
//
// If the GLB isn't loaded yet we render the procedural sedan body so
// the spawn slot isn't empty — swap to the GLB on the first `updateVehicleVisuals`
// tick where it becomes available.
function buildQuotaBody() {
  const g = new THREE.Group();
  // Fallback body — a slimmer sedan approximation with a subtle
  // black-and-white two-tone that reads as "cop car" even before
  // the GLB streams in.
  const fallback = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.9, 4.4),
    new THREE.MeshStandardMaterial({ color: 0x101010 }),
  );
  body.position.y = 0.65;
  fallback.add(body);
  const roofWhite = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 0.4, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }),
  );
  roofWhite.position.set(0, 1.05, -0.1);
  fallback.add(roofWhite);
  fallback.name = '_procQuotaBody';
  g.add(fallback);
  // Emergency light rig — two point-lights + emissive sphere heads
  // mounted on the roof line, red on the LEFT, blue on the RIGHT.
  // Kept invisible by default; the R3 toggle flips `emergencyOn`
  // and `updateVehicleVisuals` writes intensity + emissive per frame.
  const lightBar = new THREE.Group();
  lightBar.name = '_emergencyBar';
  const redHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0 }),
  );
  redHead.position.set(-0.5, 1.35, -0.4);
  redHead.name = '_emergencyRed';
  const blueHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x000420, emissive: 0x2050ff, emissiveIntensity: 0 }),
  );
  blueHead.position.set(0.5, 1.35, -0.4);
  blueHead.name = '_emergencyBlue';
  const redLight = new THREE.PointLight(0xff2030, 0, 8);
  redLight.position.copy(redHead.position);
  redLight.name = '_emergencyRedLight';
  const blueLight = new THREE.PointLight(0x2040ff, 0, 8);
  blueLight.position.copy(blueHead.position);
  blueLight.name = '_emergencyBlueLight';
  // Moving lights — never adopted by the static LightPool.
  redLight.userData.dynamic = true; blueLight.userData.dynamic = true;
  lightBar.add(redHead, blueHead, redLight, blueLight);
  g.add(lightBar);
  g.userData.isQuota = true;
  g.userData.hasGlb = false;
  return g;
}

// Late-swap the procedural Quota fallback with the shipped GLB once
// it loads. Idempotent — called from `updateVehicleVisuals` each
// frame, no-ops after the swap succeeds.
function _tryUpgradeQuotaMesh(v) {
  if (!v.isQuota) return;
  const body = v.bodyMesh;
  if (!body || body.userData.hasGlb) return;
  const glb = cloneQuotaMesh();
  if (!glb) return;
  const fallback = body.getObjectByName('_procQuotaBody');
  if (fallback) fallback.visible = false;
  glb.name = '_quotaGLB';
  body.add(glb);
  body.userData.hasGlb = true;
}

// ── Dirt bike body builder ────────────────────────────────────────
// The dirt bike is a NEW vehicle variant — 2 wheels, tall handlebars,
// motocross frame. We ship a compressed GLB (see /public/vehicles/
// dirt_bike.glb) but need a procedural fallback for the first frame
// after arena load (before the loader resolves).
//
// The procedural fallback is 3 boxes + 2 cylinders — good enough
// silhouette to identify at a glance.
function buildDirtBikeBody() {
  const g = new THREE.Group();
  const fallback = new THREE.Group();
  fallback.name = '_procDirtBikeBody';
  // Main frame — a red/black motocross approximation.
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xb01e1e }),
  );
  tank.position.set(0, 0.75, 0.05);
  fallback.add(tank);
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.10, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x141414 }),
  );
  seat.position.set(0, 0.82, -0.35);
  fallback.add(seat);
  const engine = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.30, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
  );
  engine.position.set(0, 0.55, 0.0);
  fallback.add(engine);
  // Front + rear wheels (fatties). Rotate cylinder to lie on X-axis.
  for (const [wz, name] of [[0.55, '_bikeFrontWheelProc'], [-0.55, '_bikeRearWheelProc']]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.16, 20),
      new THREE.MeshStandardMaterial({ color: 0x101010 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.36, wz);
    wheel.name = name;
    fallback.add(wheel);
  }
  // Handlebars — a cross-bar at rider chest height.
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.60, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a }),
  );
  bar.position.set(0, 1.10, 0.6);
  fallback.add(bar);
  g.add(fallback);
  g.userData.isBike = true;
  g.userData.hasGlb = false;
  return g;
}

// Late-swap the procedural dirt-bike fallback with the shipped GLB
// once it loads. Idempotent — called from updateVehicleVisuals each
// frame, no-ops after the swap succeeds.
function _tryUpgradeDirtBikeMesh(v) {
  if (v.kind !== 'dirtbike') return;
  const body = v.bodyMesh;
  if (!body || body.userData.hasGlb) return;
  const glb = cloneDirtBikeMesh();
  if (!glb) return;
  const fallback = body.getObjectByName('_procDirtBikeBody');
  if (fallback) fallback.visible = false;
  glb.name = '_dirtBikeGLB';
  body.add(glb);
  body.userData.hasGlb = true;
  // Cache anchor references from the model loader (seat & handlebar
  // offsets in bike-local space) onto the vehicle for the engine's
  // rider-glue code to consume.
  v.anchors = getDirtBikeAnchors() || null;
}

// Late-swap the procedural Venom fallback with the shipped GLB once
// it loads. Idempotent — no-ops after the first successful swap.
function _tryUpgradeVenomMesh(v) {
  if (v.kind !== 'venom') return;
  const body = v.bodyMesh;
  if (!body || body.userData.hasGlb) return;
  const glb = cloneVenomMesh();
  if (!glb) return;
  const fallback = body.getObjectByName('_procVenomBody');
  if (fallback) fallback.visible = false;
  glb.name = '_venomGLB';
  body.add(glb);
  body.userData.hasGlb = true;
}

// ── Car body builder ────────────────────────────────────────────────
// Try the `testcar` GLB asset first. If it isn't loaded yet (or
// missing) fall back to a low-poly box so we never render nothing.
function buildCarBody(color) {
  const g = new THREE.Group();
  let mesh = null;
  try {
    const geom = getGlbGeometry('testcar');
    if (geom) {
      mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color }),
      );
      // The world-matrix bake from `getGlbGeometry` ALSO bakes in
      // the node's translation, so the car geometry is NOT centred
      // on the origin (its bb sits at ~+1.6 X, +5.2 Z for testcar).
      // Re-centre horizontally so the car renders AT its spawn
      // position. Lift vertically so wheels (bb.min.y * scale) touch
      // y=0.
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const lenZ = Math.max(bb.max.z - bb.min.z, 0.001);
      const s = 5.0 / lenZ;
      mesh.scale.set(s, s, s);
      const cx = (bb.min.x + bb.max.x) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      mesh.position.set(-cx * s, -bb.min.y * s, -cz * s);
      g.add(mesh);
    }
  } catch { /* GLB not ready */ }

  if (!mesh) {
    // Procedural fallback — a chunky sedan box.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.0, 5.0),
      new THREE.MeshStandardMaterial({ color }),
    );
    body.position.y = 0.7;
    g.add(body);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.8, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x1e1c22 }),
    );
    cab.position.set(0, 1.6, -0.2);
    g.add(cab);
    for (const [wx, wz] of [[-1.0, 1.6], [1.0, 1.6], [-1.0, -1.6], [1.0, -1.6]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16),
        new THREE.MeshStandardMaterial({ color: 0x111 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.45, wz);
      g.add(wheel);
    }
  }
  // Tag the colored body mesh on the group for later HP-tint adjustments.
  g.userData.bodyColor = color;
  return g;
}

// ── Smoke particle cloud ────────────────────────────────────────────
function buildSmoke(color = 0x888888, opacity = 0.6) {
  const N = 28;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 1.0;
    positions[i * 3 + 1] = Math.random() * 0.6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1.0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color, size: 1.4, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  pts.userData.basePos = positions.slice();
  return pts;
}

// ── Venom (Corvette Stingray sports car) body builder ────────────
// The Venom is a NEW 2-seater sports car variant. Player spawns
// AT the Venom (see engine3d _spawnActor).
// The compressed GLB ships in /public/vehicles/venom.glb; we render
// a low-poly procedural approximation until it streams in.
function buildVenomBody() {
  const g = new THREE.Group();
  const fallback = new THREE.Group();
  fallback.name = '_procVenomBody';
  // Long, low, wide sports-car silhouette in pearl white.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.55, 4.6),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }),
  );
  body.position.y = 0.55;
  fallback.add(body);
  // Curved-back cabin — a rounded chamfer at the roofline.
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e }),
  );
  cab.position.set(0, 1.05, -0.1);
  fallback.add(cab);
  // Front nose splitter — reads as sports-car aggression.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.15, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x101010 }),
  );
  nose.position.set(0, 0.35, 2.2);
  fallback.add(nose);
  // 4 fat wheels — cylinder rotated to lay flat on Z.
  for (const [wx, wz] of [[-0.85, 1.55], [0.85, 1.55], [-0.85, -1.6], [0.85, -1.6]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.36, 18),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.42, wz);
    fallback.add(wheel);
  }
  g.add(fallback);
  g.userData.isVenom = true;
  g.userData.hasGlb = false;
  return g;
}

export function buildVehicleSet(scene, spawns) {
  const list = [];
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    const isQuota = s.kind === 'quota';
    const isBike  = s.kind === 'dirtbike';
    const isVenom = s.kind === 'venom';
    // Quota is a fixed black-and-white cruiser — no random palette.
    // Venom is pearl-white in the game (matches the shipped Corvette).
    const color = isQuota ? 0x101010
      : (isBike ? 0xb01e1e
        : (isVenom ? 0xe8e8e8
          : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]));
    const group = new THREE.Group();
    let body;
    if (isBike)       body = buildDirtBikeBody();
    else if (isQuota) body = buildQuotaBody();
    else if (isVenom) body = buildVenomBody();
    else              body = buildCarBody(color);
    group.add(body);
    // Bike pivot — we rotate the body group directly for wheelie
    // (pitch about X) and lean (roll about Z). Keep smoke on the
    // OUTER group so wreckage particles don't tilt with wheelies.
    const smokeGray = buildSmoke(0x888888, 0.65); smokeGray.position.y = 1.2; group.add(smokeGray);
    const smokeBlack = buildSmoke(0x202020, 0.85); smokeBlack.position.y = 1.4; group.add(smokeBlack);
    group.position.set(s.x, 0, s.z);
    group.rotation.y = s.yaw || 0;
    scene.add(group);
    const maxHp = isBike ? BIKE_MAX_HP : CAR_MAX_HP;
    list.push({
      id: `veh_${i}`,
      spawn: { x: s.x, z: s.z, yaw: s.yaw || 0, kind: s.kind || 'testcar' },
      kind: s.kind || 'testcar',
      isQuota, isBike, isVenom,
      // Emergency-light toggle — R3 flips this. Only meaningful for
      // the Quota; keeping it on non-Quota vehicles is harmless (the
      // light mesh isn't present so no visual effect).
      emergencyOn: false,
      _emergencyPhase: 0,
      x: s.x, y: 0, z: s.z,
      yaw: s.yaw || 0,
      speed: 0,
      hp: maxHp, maxHp,
      dead: false, destroyedT: 0,
      driver: null, passenger: null,
      team: null,
      group, bodyMesh: body, smokeGray, smokeBlack,
      bodyColor: color,
      explosionT: 0,
      _visible: true,
      // ── Bike-only physics state (unused by cars — harmless idle) ──
      // wheelieT  — normalised [0..1] tilt back; 0 = level, 1 = full
      //             front-wheel-up pop.
      // hopVY     — vertical velocity in the current hop; when >0 the
      //             bike is airborne and gravity pulls it back down.
      // leanAngle — roll angle applied to the body group during turns,
      //             computed as `steer * speed_norm` in the engine.
      // wheelSpin — accumulated rotation for the front/rear wheels;
      //             updated proportional to abs(v.speed) every frame.
      wheelieT: 0,
      hopVY: 0,
      leanAngle: 0,
      wheelSpin: 0,
      // Anchors — filled by _tryUpgradeDirtBikeMesh once the GLB is
      // in. Consumed by engine3d for rider-seat positioning.
      anchors: null,
    });
  }
  return list;
}

// ── Per-frame update (visuals only — drive impulse from engine) ────
export function updateVehicleVisuals(v, dt) {
  v.group.position.set(v.x, v.y, v.z);
  v.group.rotation.y = v.yaw;

  // Dirt bike: swap the procedural fallback for the GLB once loaded,
  // and apply per-frame wheelie / lean / wheel-spin animation.
  if (v.kind === 'dirtbike') {
    _tryUpgradeDirtBikeMesh(v);
    if (v.bodyMesh) {
      // Wheelie pitches the body around its X axis backwards (positive
      // pitch on THREE = nose down; we want nose UP → negative). At full
      // pop the front is ~65° up.
      v.bodyMesh.rotation.x = -(v.wheelieT || 0) * (Math.PI / 180) * 65;
      // Lean rolls the body around its Z axis (forward). Steering
      // left tips the top of the bike TO THE LEFT (positive roll
      // in bike-local means -Z lean).
      v.bodyMesh.rotation.z = (v.leanAngle || 0);
    }
    // Wheel spin — rotate front/rear wheels (procedural OR GLB) at
    // speed. Use the local-axle (X) rotation because our wheels are
    // authored lying flat on Z after the cylinder Z-rotation trick.
    const wheelSpin = (v.wheelSpin || 0);
    const fwProc = v.bodyMesh && v.bodyMesh.getObjectByName('_bikeFrontWheelProc');
    const rwProc = v.bodyMesh && v.bodyMesh.getObjectByName('_bikeRearWheelProc');
    if (fwProc) fwProc.rotation.x = wheelSpin;
    if (rwProc) rwProc.rotation.x = wheelSpin;
  }

  // Venom (Corvette): swap in the compressed sports-car GLB when it
  // finishes loading. No per-frame animation beyond the usual body
  // repositioning — the sports-car is a rigid mesh.
  if (v.kind === 'venom') {
    _tryUpgradeVenomMesh(v);
  }

  // Quota: swap the procedural fallback for the GLB once the loader
  // has cached it. Also drive the emergency-light red↔blue alternation
  // at ~1.5 Hz when the R3 toggle is active.
  if (v.isQuota) {
    _tryUpgradeQuotaMesh(v);
    const bar = v.bodyMesh.getObjectByName('_emergencyBar');
    if (bar) {
      if (v.emergencyOn && !v.dead) {
        v._emergencyPhase = (v._emergencyPhase || 0) + dt * 9.4;   // ~1.5 Hz alternation
        // Alternating pulse — red bright while blue dim, then swap.
        const red   = 0.5 + 0.5 * Math.sin(v._emergencyPhase);
        const blue  = 0.5 + 0.5 * Math.sin(v._emergencyPhase + Math.PI);
        const rHead = bar.getObjectByName('_emergencyRed');
        const bHead = bar.getObjectByName('_emergencyBlue');
        const rLight = bar.getObjectByName('_emergencyRedLight');
        const bLight = bar.getObjectByName('_emergencyBlueLight');
        if (rHead && rHead.material) rHead.material.emissiveIntensity = red * 4.5;
        if (bHead && bHead.material) bHead.material.emissiveIntensity = blue * 4.5;
        if (rLight) rLight.intensity = red * 3.2;
        if (bLight) bLight.intensity = blue * 3.2;
        bar.visible = true;
      } else if (bar.visible) {
        // Fade to fully off in one frame — matches a real car's
        // lightbar switching to a hard off state.
        const rHead = bar.getObjectByName('_emergencyRed');
        const bHead = bar.getObjectByName('_emergencyBlue');
        const rLight = bar.getObjectByName('_emergencyRedLight');
        const bLight = bar.getObjectByName('_emergencyBlueLight');
        if (rHead && rHead.material) rHead.material.emissiveIntensity = 0;
        if (bHead && bHead.material) bHead.material.emissiveIntensity = 0;
        if (rLight) rLight.intensity = 0;
        if (bLight) bLight.intensity = 0;
      }
    }
  }

  // HP-based smoke + explosion.
  const hpPct = v.dead ? 0 : v.hp / v.maxHp;
  const grayOn = !v.dead && hpPct <= 0.40;
  const blackOn = !v.dead && hpPct <= 0.20;
  v.smokeGray.visible  = grayOn;
  v.smokeBlack.visible = blackOn;
  // Drift the particles upward + side to side for a wisp effect.
  for (const cloud of [v.smokeGray, v.smokeBlack]) {
    if (!cloud.visible) continue;
    const pos = cloud.geometry.attributes.position;
    const base = cloud.userData.basePos;
    for (let i = 0; i < pos.count; i++) {
      const idx = i * 3;
      pos.array[idx + 0] = base[idx + 0] + Math.sin(performance.now() / 600 + i) * 0.3;
      pos.array[idx + 1] = base[idx + 1] + ((performance.now() / 800 + i * 0.3) % 2.0);
      pos.array[idx + 2] = base[idx + 2] + Math.cos(performance.now() / 700 + i * 1.1) * 0.3;
    }
    pos.needsUpdate = true;
  }

  // Wreckage darkening — tint progressively as HP drops, RESTORED back
  // to the picked random spawn color when the car respawns. Skipped
  // for the Quota (its bodyMesh is a Group with the two-tone livery
  // baked in — arbitrary color tint would murder the paint job) AND
  // for bikes (their bodyMesh is either the GLB or a multi-part
  // procedural group with no single "chassis paint" material). Also
  // skipped for the Venom — its shipped Corvette GLB has a proper
  // PBR pearl-white livery we don't want to override.
  if (!v.isQuota && v.kind !== 'dirtbike' && v.kind !== 'venom' && v.bodyMesh && v.bodyMesh.children && v.bodyMesh.children[0]) {
    const m = v.bodyMesh.children[0].material;
    const base = v.bodyColor != null ? v.bodyColor : 0x9a3a3a;
    if (m && m.color) {
      const br = ((base >> 16) & 0xff) / 255;
      const bg = ((base >>  8) & 0xff) / 255;
      const bb = ( base        & 0xff) / 255;
      const k = Math.max(0.25, hpPct);
      m.color.setRGB(br * k, bg * k, bb * k);
    }
  }

  // Destruction cleanup — 10s after destroyed, hide for respawn.
  if (v.dead) {
    v.destroyedT += dt;
    if (v.destroyedT >= RESPAWN_DELAY) {
      respawnVehicle(v);
    } else if (v.destroyedT >= RESPAWN_DELAY - 1) {
      // Last second: blink out so it's clear it'll respawn.
      v.group.visible = Math.floor(v.destroyedT * 6) % 2 === 0;
    }
  } else if (!v.group.visible) {
    v.group.visible = true;
  }
}

// Returns true if this damage killed the car.
export function damageVehicle(v, dmg) {
  if (v.dead) return false;
  v.hp -= dmg;
  if (v.hp <= 0) {
    v.hp = 0;
    v.dead = true;
    v.destroyedT = 0;
    v.explosionT = 0.6;            // engine plays the burst
    // Eject everyone.
    v.driver = null;
    v.passenger = null;
    v.team = null;
    return true;
  }
  return false;
}

export function respawnVehicle(v) {
  v.x = v.spawn.x; v.z = v.spawn.z;
  v.yaw = v.spawn.yaw;
  v.speed = 0;
  v.hp = v.maxHp;
  v.dead = false;
  v.destroyedT = 0;
  v.driver = null; v.passenger = null;
  v.team = null;
  v.group.visible = true;
}

// Door positions in car-local frame — driver at the LEFT centre-line,
// passenger at the RIGHT centre-line. `lz=0` keeps the door point at
// the true mid-side so rear and front quarters fall outside the
// `nearDriverDoor` / `nearPassengerDoor` radius.
export function doorWorldPositions(v) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const lx = -1.2, lz = 0;
  const rx =  1.2, rz = 0;
  return {
    driver:    { x: v.x + lx * c - lz * s, z: v.z + lx * s + lz * c },
    passenger: { x: v.x + rx * c - rz * s, z: v.z + rx * s + rz * c },
  };
}

// AABB collider for bullet hit-tests (axis-aligned approximation —
// good enough for sniper-style hitscan). Half-extents in world units.
export function vehicleAABB(v) {
  return {
    cx: v.x, cz: v.z, cy: CAR_HEIGHT / 2,
    halfX: CAR_HALF_WIDE, halfY: CAR_HEIGHT / 2, halfZ: CAR_HALF_LEN,
    yaw: v.yaw,
  };
}

// Tests if a player at (px, pz) is within `range` of the car body
// (any side). Used for "near the car" checks before entry.
export function nearCar(v, px, pz, range = 2.5) {
  const dx = px - v.x, dz = pz - v.z;
  // Rotate into car-local frame.
  const c = Math.cos(-v.yaw), s = Math.sin(-v.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ox = Math.max(0, Math.abs(lx) - CAR_HALF_WIDE);
  const oz = Math.max(0, Math.abs(lz) - CAR_HALF_LEN);
  return ox * ox + oz * oz <= range * range;
}

// Tests if a player is near the DRIVER door — left side of the car.
// Tighter range (1.8m) so rear-quarter positions don't accidentally
// match the door zone.
export function nearDriverDoor(v, px, pz, range = 1.8) {
  const dp = doorWorldPositions(v);
  const dx = px - dp.driver.x, dz = pz - dp.driver.z;
  return dx * dx + dz * dz <= range * range;
}
// Tests if a player is near the PASSENGER door (right side).
export function nearPassengerDoor(v, px, pz, range = 1.8) {
  const dp = doorWorldPositions(v);
  const dx = px - dp.passenger.x, dz = pz - dp.passenger.z;
  return dx * dx + dz * dz <= range * range;
}
// Player standing ON TOP of the car (mantled up): horizontal inside
// the AABB AND height above the roofline.
export function onTopOfCar(v, px, py, pz) {
  if (py < 1.0) return false;
  const c = Math.cos(-v.yaw), s = Math.sin(-v.yaw);
  const lx = (px - v.x) * c - (pz - v.z) * s;
  const lz = (px - v.x) * s + (pz - v.z) * c;
  return Math.abs(lx) <= CAR_HALF_WIDE + 0.2 && Math.abs(lz) <= CAR_HALF_LEN + 0.2;
}

export const VEHICLE_CONSTS = {
  MAX_HP: CAR_MAX_HP, HALF_LEN: CAR_HALF_LEN, HALF_WIDE: CAR_HALF_WIDE,
  HEIGHT: CAR_HEIGHT, RESPAWN_DELAY,
  BIKE_MAX_HP, BIKE_HALF_LEN, BIKE_HALF_WIDE, BIKE_HEIGHT,
  BIKE_PASSENGER_OFFSET,
};

// ── Bike helpers ──────────────────────────────────────────────────
// Bikes don't have doors — proximity to either side of the frame is
// good enough to prompt the entry action. A single tighter radius
// (1.6m) matches the model's actual footprint.
export function nearBike(v, px, pz, range = 1.6) {
  const dx = px - v.x, dz = pz - v.z;
  const c = Math.cos(-v.yaw), s = Math.sin(-v.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ox = Math.max(0, Math.abs(lx) - BIKE_HALF_WIDE);
  const oz = Math.max(0, Math.abs(lz) - BIKE_HALF_LEN);
  return ox * ox + oz * oz <= range * range;
}

// World-space seat position for the driver / passenger on the bike.
// Passenger sits BEHIND the driver — see BIKE_PASSENGER_OFFSET.
export function bikeSeatWorld(v, role) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const lz = role === 'passenger' ? BIKE_PASSENGER_OFFSET : 0.0;
  // NB: forward vector = (sin yaw, cos yaw) — matches engine's `sn,cs`
  // convention where `sn * v.speed * dt` is the X drift.
  return {
    x: v.x + lz * s,
    z: v.z + lz * c,
    // Seat height ≈ 0.90m on the compressed model. When wheelieing,
    // the driver visually rises a bit as the bike pitches back — this
    // small lift is handled by the pose overlay in view3d.
    y: 0.90 + (v.y || 0),
  };
}

// Car seat offsets (in vehicle-LOCAL coords where the car forward is
// +Z and left is +X). Driver sits on the left, slightly behind the
// front axle. Passenger sits mirrored on the right. iter193 places
// the visible occupant at these local coords so their head pokes up
// through the windshield / above the seatback.
const CAR_DRIVER_LOCAL   = { x: -0.38, z: -0.25, y: 0.82 };
const CAR_PASSENGER_LOCAL = { x:  0.38, z: -0.25, y: 0.82 };

export function carSeatWorld(v, role) {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const seat = role === 'passenger' ? CAR_PASSENGER_LOCAL : CAR_DRIVER_LOCAL;
  // Vehicle forward = (sin yaw, cos yaw), right vector = (cos yaw, -sin yaw).
  // World offset = local.x * right + local.z * forward.
  return {
    x: v.x + seat.x * c + seat.z * s,
    z: v.z - seat.x * s + seat.z * c,
    y: seat.y + (v.y || 0),
  };
}
