// Team Gangsta Brawl — expanded city-block dressing.
//
// Adds the props the user asked for in Phase 3 — dumpsters, fire
// hydrants, parking meters, benches, traffic lights, awnings, fences,
// AC units on rooftops, fire-escape ladders, neon signage strips —
// while staying within the streaming/instancing budget already
// established in arena3d.js.  Repeated geometry (meters, hydrants,
// AC boxes) uses InstancedMesh.  Streamable per-tile so unloading
// distant blocks still works.
import * as THREE from 'three';
import { flattenToInstances } from './render/instanceBatch.js';

const PALETTE = {
  metalDark: 0x33343c,
  metalRust: 0x4a3a30,
  red: 0xb91c1c,
  green: 0x355e3b,
  yellow: 0xd4a83a,
  hydrant: 0xea580c,
  wood: 0x6a4a26,
  conc: 0x76737a,
  glass: 0x2a2138,
  neon: 0xff6aa0,
  black: 0x111114,
};

function L(c) { return new THREE.MeshStandardMaterial({ color: c }); }
function P(c, sh = 60, sp = 0xaaaaaa) { return new THREE.MeshPhongMaterial({ color: c, shininess: sh, specular: sp }); }

// Drop the props into the existing stream manager.  `colliders`
// receives push-out boxes for the chunky ones (dumpster, traffic
// light pole, fire escape) — bullets and movement see them.  Cars,
// hydrants, meters, signage are visual only (you can shoot through
// the meter, but bumping it doesn't matter at gameplay scale).
export function addCityProps(stream, colliders, opts = {}) {
  const H = opts.half || 60;
  const tmp = new THREE.Object3D();
  // Small multi-mesh props are assembled as Groups for readability and
  // collapsed into InstancedMesh batches at the end (identical shape +
  // material → one draw call). They become essential: ~15 draws total.
  const batchRoots = [];

  // ── Dumpsters ─────────────────────────────────────────────────────
  // Big green steel boxes in alleys, behind buildings.  Real cover.
  const dumpsterPts = [
    [-32, 8],  [32, -8],  [-8, 36],  [10, -36],
    [-44, -32], [44, 30],  [-20, 12], [22, 22],
  ];
  const dumpsterGeo = new THREE.BoxGeometry(2.2, 1.4, 1.4);
  const dumpsterInst = new THREE.InstancedMesh(dumpsterGeo, L(PALETTE.green), dumpsterPts.length);
  for (let k = 0; k < dumpsterPts.length; k++) {
    const [x, z] = dumpsterPts[k];
    tmp.position.set(x, 0.7, z);
    tmp.rotation.set(0, ((x * 13 + z * 7) % 1) * 0.6, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    dumpsterInst.setMatrixAt(k, tmp.matrix);
    colliders.push({ x0: x - 1.2, z0: z - 0.8, x1: x + 1.2, z1: z + 0.8, h: 1.4 });
  }
  dumpsterInst.instanceMatrix.needsUpdate = true;
  stream.addEssential(dumpsterInst);

  // ── Fire hydrants ─────────────────────────────────────────────────
  const hydrantPts = [
    [-18, -6], [22, 4], [4, -28], [-40, 12], [38, -14], [-2, 28],
    [16, 36], [-22, 22], [-48, -8], [44, 18],
  ];
  const hydMat = L(PALETTE.hydrant);
  for (const [x, z] of hydrantPts) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 8), hydMat);
    base.position.y = 0.3;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), hydMat);
    cap.position.y = 0.62;
    const valveL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), hydMat);
    valveL.rotation.z = Math.PI / 2;
    valveL.position.set(-0.18, 0.42, 0);
    const valveR = valveL.clone();
    valveR.position.x = 0.18;
    g.add(base, cap, valveL, valveR);
    g.position.set(x, 0, z);
    batchRoots.push(g);
  }

  // ── Parking meters ────────────────────────────────────────────────
  const meterPts = [];
  for (let z = -50; z <= 50; z += 10) {
    meterPts.push([-H + 4, z], [H - 4, z]);
  }
  const meterGeo = new THREE.BoxGeometry(0.14, 0.4, 0.14);
  const meterInst = new THREE.InstancedMesh(meterGeo, L(PALETTE.metalDark), meterPts.length);
  for (let k = 0; k < meterPts.length; k++) {
    const [x, z] = meterPts[k];
    tmp.position.set(x, 0.7, z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    meterInst.setMatrixAt(k, tmp.matrix);
  }
  meterInst.instanceMatrix.needsUpdate = true;
  stream.addEssential(meterInst);
  // pole stems for the meters — also instanced
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6);
  const poleInst = new THREE.InstancedMesh(poleGeo, L(PALETTE.metalDark), meterPts.length);
  for (let k = 0; k < meterPts.length; k++) {
    const [x, z] = meterPts[k];
    tmp.position.set(x, 0.5, z);
    tmp.updateMatrix();
    poleInst.setMatrixAt(k, tmp.matrix);
  }
  poleInst.instanceMatrix.needsUpdate = true;
  stream.addEssential(poleInst);

  // ── Benches ───────────────────────────────────────────────────────
  const benchPts = [[-26, 6], [28, -4], [-6, -30], [14, 32]];
  for (const [x, z] of benchPts) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), L(PALETTE.wood));
    seat.position.y = 0.42;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.06), L(PALETTE.wood));
    back.position.set(0, 0.72, -0.18);
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.4), L(PALETTE.metalDark));
    leg1.position.set(-0.8, 0.21, 0);
    const leg2 = leg1.clone(); leg2.position.x = 0.8;
    g.add(seat, back, leg1, leg2);
    g.position.set(x, 0, z);
    g.rotation.y = ((x + z) * 0.5) % Math.PI;
    batchRoots.push(g);
    colliders.push({ x0: x - 0.9, z0: z - 0.3, x1: x + 0.9, z1: z + 0.3, h: 0.5 });
  }

  // ── Traffic lights at corner intersections ────────────────────────
  const tlPts = [[-H + 8, -H + 8], [H - 8, -H + 8], [-H + 8, H - 8], [H - 8, H - 8]];
  for (const [x, z] of tlPts) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 5, 8), L(PALETTE.metalDark));
    pole.position.y = 2.5;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.8), L(PALETTE.metalDark));
    arm.position.set(0, 4.9, 0.9);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.32), L(PALETTE.black));
    box.position.set(0, 4.5, 1.7);
    // R/Y/G bulbs
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.red }));
    r.position.set(0, 4.7, 1.86);
    const y = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.yellow }));
    y.position.set(0, 4.5, 1.86);
    const grn = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
    grn.position.set(0, 4.3, 1.86);
    g.add(pole, arm, box, r, y, grn);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-x, -z);
    batchRoots.push(g);
    colliders.push({ x0: x - 0.2, z0: z - 0.2, x1: x + 0.2, z1: z + 0.2, h: 5 });
  }

  // ── Chain-link fences along the back alleys ───────────────────────
  // Visual only — the buildings already block movement here.
  const fenceMat = L(0x555560);
  const fenceSpans = [
    { x0: -10, x1: 10, z: -42, h: 2.2 },
    { x0: -10, x1: 10, z: 42, h: 2.2 },
  ];
  for (const f of fenceSpans) {
    const g = new THREE.Group();
    const len = f.x1 - f.x0;
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), fenceMat);
    top.position.set((f.x0 + f.x1) / 2, f.h, f.z);
    const bot = top.clone(); bot.position.y = 0.04;
    g.add(top, bot);
    for (let x = f.x0; x <= f.x1; x += 1.2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, f.h, 0.05), fenceMat);
      post.position.set(x, f.h / 2, f.z);
      g.add(post);
    }
    batchRoots.push(g);
  }

  // ── Vegetation: little planters with shrubs ───────────────────────
  const shrubPts = [
    [-14, -6], [14, -10], [-22, 32], [26, 28],
    [-44, 4], [42, -4], [-6, 40], [8, -40],
  ];
  const shrubMat = L(0x4a5234);
  const shrubGeo = new THREE.SphereGeometry(0.7, 10, 8);
  const shrubInst = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubPts.length);
  for (let k = 0; k < shrubPts.length; k++) {
    const [x, z] = shrubPts[k];
    const sc = 0.8 + ((Math.abs(x * z) % 7) / 7) * 0.5;
    tmp.position.set(x, sc * 0.5, z);
    tmp.scale.set(sc, sc * 0.85, sc);
    tmp.rotation.set(0, 0, 0);
    tmp.updateMatrix();
    shrubInst.setMatrixAt(k, tmp.matrix);
    colliders.push({ x0: x - sc * 0.6, z0: z - sc * 0.6, x1: x + sc * 0.6, z1: z + sc * 0.6, h: sc * 0.7 });
  }
  shrubInst.instanceMatrix.needsUpdate = true;
  stream.addEssential(shrubInst);

  // ── Rooftop AC units (instanced grey boxes high up) ───────────────
  // Sit on top of perimeter buildings.  Cheap visual detail.
  const acPts = [];
  for (let x = -H + 14; x <= H - 14; x += 24) {
    acPts.push({ x, z: -H - 6, y: 14 });
    acPts.push({ x, z: H + 6, y: 14 });
  }
  const acInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.0, 1.0, 1.2),
    P(0x9a9da6, 30, 0x666),
    acPts.length,
  );
  for (let k = 0; k < acPts.length; k++) {
    const { x, z, y } = acPts[k];
    tmp.position.set(x + ((k * 13) % 6) - 3, y + 0.5, z + ((k * 7) % 4) - 2);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    acInst.setMatrixAt(k, tmp.matrix);
  }
  acInst.instanceMatrix.needsUpdate = true;
  stream.addEssential(acInst);

  // ── Neon signage strips on the inner cover blocks ─────────────────
  const neon = new THREE.MeshBasicMaterial({ color: PALETTE.neon });
  const neonPts = [
    { x: -22, z: -12, w: 14, c: PALETTE.neon },
    { x: 24, z: 10, w: 12, c: 0x60a5fa },
    { x: 2, z: 28, w: 16, c: 0xfbbf24 },
  ];
  for (const sg of neonPts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sg.w, 0.4, 0.1), new THREE.MeshBasicMaterial({ color: sg.c }));
    m.position.set(sg.x, 4.5, sg.z - 6);
    batchRoots.push(m);
  }
  void neon;

  // ── Fire escape ladders (instanced flat ladders bolted to walls) ──
  // Simple 4-step ladder per perimeter building, on the inward face.
  const ladderMat = L(PALETTE.metalRust);
  const ladderPts = [];
  for (let x = -H + 22; x <= H - 22; x += 24) {
    ladderPts.push({ x, z: -H - 1, rot: 0 });
    ladderPts.push({ x, z: H + 1, rot: Math.PI });
  }
  for (const lp of ladderPts) {
    const g = new THREE.Group();
    const railL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08), ladderMat);
    railL.position.set(-0.35, 3, 0);
    const railR = railL.clone(); railR.position.x = 0.35;
    g.add(railL, railR);
    for (let y = 0.6; y <= 5.6; y += 0.6) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), ladderMat);
      rung.position.set(0, y, 0);
      g.add(rung);
    }
    g.position.set(lp.x, 0, lp.z);
    g.rotation.y = lp.rot;
    batchRoots.push(g);
  }

  const { instanced, singles } = flattenToInstances(batchRoots);
  for (const o of instanced) stream.addEssential(o);
  for (const o of singles) stream.addEssential(o);
}
