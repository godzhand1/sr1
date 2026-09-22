// grassPatch.js — instanced grass blade renderer.
//
// Each grass patch entry in the map doc looks like:
//   {
//     id: 'grass_1',
//     type: 'grass',
//     x, z:       patch centre (world XZ)
//     y:          ground Y the blades start from (0 by default)
//     w, d:       patch extent along X / Z
//     yaw:        rotation of the patch rectangle
//     density:    blades per m² (default 30, capped at 200)
//     height:     average blade height in metres (default 0.5)
//     color:      base blade tint (fresh grass = '#3a7a2a')
//     wind:       0..1 sway amplitude (visual only, per-frame sine)
//   }
//
// Rendering strategy — InstancedMesh so a 20×20m patch with density
// 30 blades/m² = 12,000 blades is a SINGLE draw call. Each instance
// gets a random (x, z) offset inside the patch, a random height in
// [0.6..1.4] × base_height, a random yaw so blades face every
// direction, and a per-instance color pulled from a 3-tone palette
// so the patch looks organic. Wind sway is a per-frame `updateSway()`
// pass — the caller (mapCustom3d) drives it from its RAF loop.
import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';

// Simple 3-vertex blade — a triangle tapered to a tip. Fewer verts
// than THREE.PlaneGeometry(1,1,1,1) (4 verts) and easier to build.
function bladeGeometry() {
  const geo = new THREE.BufferGeometry();
  const w = 0.06;          // blade base half-width
  const positions = new Float32Array([
    -w, 0,   0,
     w, 0,   0,
     0, 1,   0,             // tip at y=1 (scaled per-instance)
  ]);
  const normals = new Float32Array([
     0, 0, 1,
     0, 0, 1,
     0, 0, 1,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
  return geo;
}

// Palette — 3 fresh-grass tones we mix per instance so the patch
// reads as organic rather than a single flat green.
function paletteFromBase(baseHex) {
  const base = new THREE.Color(baseHex);
  const dark  = base.clone().multiplyScalar(0.7);
  const light = base.clone().multiplyScalar(1.2);
  return [base, dark, light];
}

export function buildGrassPatch(spec) {
  const width   = Math.max(1, spec.w ?? 10);
  const depth   = Math.max(1, spec.d ?? 10);
  const density = Math.max(1, Math.min(200, spec.density ?? 30));
  const baseH   = Math.max(0.05, spec.height ?? 0.5);
  const yaw     = spec.yaw ?? 0;
  const baseColor = spec.color || '#3a7a2a';

  const nBlades = Math.min(60000, Math.floor(width * depth * density));

  const geo = bladeGeometry();
  const mat = pbr.building({
    color: 0xffffff,              // per-instance color override
    side: THREE.DoubleSide,
    transparent: false,
  });
  const inst = new THREE.InstancedMesh(geo, mat, nBlades);
  inst.name = spec.id || 'grass_patch';
  inst.frustumCulled = true;
  inst.userData = { kind: 'grass_patch', id: spec.id, wind: spec.wind ?? 0.2 };

  // Pre-allocate color buffer — InstancedMesh needs a per-instance
  // color attribute wired via `setColorAt`.
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nBlades * 3), 3);

  const palette = paletteFromBase(baseColor);
  const dummy   = new THREE.Object3D();
  const halfW = width / 2, halfD = depth / 2;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

  // Per-instance random parameters — also stashed in a Float32Array
  // so updateSway() can drive wind without recomputing base offsets.
  //  [phase, freq, x_local, z_local, heightScale, bladeYaw]
  const swayBase = new Float32Array(nBlades * 6);

  for (let i = 0; i < nBlades; i++) {
    // Uniform random inside the rectangle in LOCAL space, then
    // rotate by yaw for the world-space instance position.
    const lx = (Math.random() - 0.5) * width;
    const lz = (Math.random() - 0.5) * depth;
    const wx = lx * cosY - lz * sinY;
    const wz = lx * sinY + lz * cosY;
    const heightScale = baseH * (0.6 + Math.random() * 0.8);   // 0.6..1.4 × base
    const bladeYaw = Math.random() * Math.PI * 2;
    dummy.position.set((spec.x ?? 0) + wx, spec.y ?? 0, (spec.z ?? 0) + wz);
    dummy.rotation.set(0, bladeYaw, 0);
    dummy.scale.set(1, heightScale, 1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);

    // Per-instance color — pick from the 3-tone palette weighted
    // slightly toward base tone for a natural mix.
    const colorIdx = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 1 : 2);
    inst.setColorAt(i, palette[colorIdx]);

    swayBase[i * 6    ] = Math.random() * Math.PI * 2;   // phase
    swayBase[i * 6 + 1] = 0.6 + Math.random() * 0.8;     // freq multiplier
    swayBase[i * 6 + 2] = lx;
    swayBase[i * 6 + 3] = lz;
    swayBase[i * 6 + 4] = heightScale;
    swayBase[i * 6 + 5] = bladeYaw;
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.userData.swayBase = swayBase;
  inst.userData.baseSpec = spec;
  return inst;
}

// Called from the RAF tick — cheap wind sway that offsets each blade
// tip in world XZ using a sine of time. We ONLY update the matrix
// each frame (no re-randomisation), so this is a few million float
// mults per frame — fast even for 30k blades.
export function updateGrassSway(inst, timeSec) {
  const wind = inst.userData?.wind ?? 0.2;
  if (wind <= 0) return;
  const swayBase = inst.userData?.swayBase;
  const spec = inst.userData?.baseSpec;
  if (!swayBase || !spec) return;
  const dummy = new THREE.Object3D();
  const cosY = Math.cos(spec.yaw ?? 0), sinY = Math.sin(spec.yaw ?? 0);
  const n = swayBase.length / 6;
  // Sway math — each blade tip drifts on a Lissajous of two sines
  // driven by the blade's phase + frequency. Amplitude scales with
  // wind so wind=0 = perfectly still, wind=1 = ~5° tilt at the tip.
  const AMP = wind * 0.09;
  for (let i = 0; i < n; i++) {
    const phase       = swayBase[i * 6    ];
    const freq        = swayBase[i * 6 + 1];
    const lx          = swayBase[i * 6 + 2];
    const lz          = swayBase[i * 6 + 3];
    const heightScale = swayBase[i * 6 + 4];
    const bladeYaw    = swayBase[i * 6 + 5];
    const wx = lx * cosY - lz * sinY;
    const wz = lx * sinY + lz * cosY;
    const sway = Math.sin(timeSec * freq + phase) * AMP;
    dummy.position.set((spec.x ?? 0) + wx, spec.y ?? 0, (spec.z ?? 0) + wz);
    dummy.rotation.set(sway, bladeYaw, sway * 0.6);   // small X + Z tilt
    dummy.scale.set(1, heightScale, 1);               // preserve original height
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
}
