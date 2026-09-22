// Team Gangsta Brawl — Stilwater city-block arena.  PS2-era look:
// low-poly box buildings with low-res canvas textures (NearestFilter),
// fog, a warm dusk skybox, street grid, crates and car props as cover.
//
// Streaming model
// ───────────────
// The whole arena no longer enters the scene at once.  Essentials
// (ground, sky, lights, inner cover the player spawns next to) are
// resident from frame zero so gameplay starts instantly; perimeter
// buildings, crates, cars, lamps stream in tile-by-tile around the
// player via StreamingManager.  Repeated props (crates, lamps) are
// drawn through InstancedMesh — one draw call for the whole batch,
// auto-frustum-culled by Three.js using the mesh's bounding sphere.
//
// Colliders are returned unconditionally so bullets and movement see
// the full collision set even before a building's mesh has streamed
// in — keeps the game logic deterministic across multiplayer clients.
//
// Exports buildArena(scene, stream?) → { colliders, spawns, half }.
import * as THREE from 'three';
import { StreamingManager } from './streamManager.js';
import { buildSkyDome, buildSkyDomeTextured } from './skyDome.js';
import { addCityProps } from './arenaProps.js';
import { preloadTextures, cloneTexture as cloneAiTex, getTexture as getAiTex, subscribe as subscribeAiTex, FACADE_SLUGS } from './aiTextures.js';
import { configureShadowedDirLight } from './render/lod.js';
import { scatterBarriersForMap } from './jerseyBarrier.js';
import { addBakedLampFixture } from './bakedLights.js';
import {
  makeDumpster, makeVending, makeArcade, makePhoneBooth,
  makeMailbox, makeTrashCan, makeGenerator, makeNewsBox,
  makeParkedCar, makeSandbags,
} from './props3d.js';

// Kick off AI texture downloads at first import. Idempotent.
preloadTextures();

export const ARENA_HALF = 60;          // playable square is ±60 (city block map)

// ── Low-res canvas textures (PS2 vibes) — shared with other maps ─────
export function canvasTex(draw, w = 64, h = 64) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildingTex(base, win) {
  // Pick a façade variant deterministically from the building's base
  // color so each building keeps the SAME texture across frames but
  // different buildings get different façades. Hashing on `base` means
  // re-running the build returns the same look (no flicker).
  const seed = (base || '#000').split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7) >>> 0;
  const slug = FACADE_SLUGS[seed % FACADE_SLUGS.length];
  const ai = cloneAiTex(slug);
  if (ai) {
    ai.magFilter = THREE.LinearFilter;
    ai.minFilter = THREE.LinearMipmapLinearFilter;
    return ai;
  }
  return canvasTex((g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    for (let y = 6; y < h - 8; y += 14) {
      for (let x = 6; x < w - 8; x += 12) {
        g.fillStyle = Math.random() < 0.35 ? '#ffd97a' : win;
        g.fillRect(x, y, 6, 8);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x, y + 7, 6, 1);
      }
    }
  });
}

// Scatter graffiti decal planes on random building faces. Decals are
// drawn slightly proud of the wall surface (offset 0.01) with the
// graffiti texture's alpha so the artwork blends with whatever wall
// material is underneath. Skipped silently if the AI graffiti texture
// hasn't loaded yet.
export function addGraffitiDecals(scene, colliders, stream) {
  const tex = getAiTex('graffiti_decal_sheet');
  if (!tex) return false;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  let placed = 0;
  for (const c of colliders) {
    if (placed >= 12) break;
    if (Math.random() > 0.45) continue;
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    // Pick a random face: 0=N(+z), 1=S(-z), 2=E(+x), 3=W(-x)
    const face = Math.floor(Math.random() * 4);
    const decalW = Math.min(3.2, w * 0.5);
    const decalH = 2.0;
    const yc = 1.6 + Math.random() * Math.max(0.0, c.h - 3);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(decalW, decalH), mat);
    let x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2;
    if (face === 0)      { z = c.z1 + 0.02;                          x += (Math.random() - 0.5) * (w - decalW); }
    else if (face === 1) { z = c.z0 - 0.02; plane.rotation.y = Math.PI; x += (Math.random() - 0.5) * (w - decalW); }
    else if (face === 2) { x = c.x1 + 0.02; plane.rotation.y = -Math.PI / 2; z += (Math.random() - 0.5) * (d - decalW); }
    else                 { x = c.x0 - 0.02; plane.rotation.y =  Math.PI / 2; z += (Math.random() - 0.5) * (d - decalW); }
    plane.position.set(x, yc, z);
    if (stream) stream.addStreamable(plane, x, z);
    else scene.add(plane);
    placed++;
  }
  return placed > 0;
}

export function roadTex() {
  // AI-generated tileable asphalt with lane markings + cracks. Falls
  // back to the original canvas-procedural texture if the PNG hasn't
  // finished downloading yet (or backend hasn't generated it).
  const ai = cloneAiTex('asphalt_road');
  if (ai) {
    ai.magFilter = THREE.LinearFilter;
    ai.minFilter = THREE.LinearMipmapLinearFilter;
    return ai;
  }
  return canvasTex((g, w, h) => {
    g.fillStyle = '#2e2c30'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 60; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    g.fillStyle = '#2e2c30';
    g.fillRect(w / 2 - 1, 0, 2, 18);
    g.fillRect(w / 2 - 1, 32, 2, 18);
  }, 64, 64);
}

export function sidewalkTex() {
  // AI-generated weathered concrete sidewalk with expansion joints.
  const ai = cloneAiTex('concrete_sidewalk');
  if (ai) {
    ai.magFilter = THREE.LinearFilter;
    ai.minFilter = THREE.LinearMipmapLinearFilter;
    return ai;
  }
  return canvasTex((g, w, h) => {
    g.fillStyle = '#6e6a63'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  }, 32, 32);
}

export function crateTex() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#7a5a30'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4c3618'; g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.beginPath(); g.moveTo(2, 2); g.lineTo(w - 2, h - 2); g.moveTo(w - 2, 2); g.lineTo(2, h - 2); g.stroke();
  }, 32, 32);
}
// Builds a hollow building from 4 wall segments, leaving a doorway gap in
// one face.  door: 'N'|'S'|'E'|'W', doorW = gap width (default 2.4).

// ── Arena construction ───────────────────────────────────────────────
export function buildArena(scene) {
  const colliders = [];
  const H = ARENA_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 3, unloadRadius: 4 });

  scene.fog = new THREE.Fog(0x2a2138, 55, 170);
  scene.background = new THREE.Color(0x2a2138);

  // Dusk sky dome — gradient fallback. If the AI sunset_sky texture
  // is ready, swap in the textured version immediately; otherwise
  // subscribe so we can upgrade in-place when it streams in.
  let sky = buildSkyDome({ radius: 400, low: '#8c4030', high: '#1a1538' });
  stream.addEssential(sky);
  const _trySkyUpgrade = () => {
    if (scene.userData.physicalSky) return true;   // physical sky owns the horizon now
    const tex = cloneAiTex('sunset_sky');
    if (!tex) return false;
    scene.remove(sky);
    if (sky.geometry) sky.geometry.dispose();
    if (sky.material) sky.material.dispose();
    sky = buildSkyDomeTextured(tex, { radius: 400 });
    scene.add(sky);
    return true;
  };
  if (!_trySkyUpgrade()) {
    const unsubSky = subscribeAiTex(() => { if (_trySkyUpgrade()) unsubSky(); });
  }

  // Lights — dusk city with proper shadow-casting sun. Strong warm
  // key light so the arena reads as golden-hour dusk instead of
  // pitch-black. Hemi tints ground fill toward warm asphalt.
  stream.addEssential(new THREE.HemisphereLight(0xd8c0f2, 0x543424, 2.4));
  stream.addEssential(new THREE.AmbientLight(0x7a708a, 0.9));
  const sun = new THREE.DirectionalLight(0xffcf88, 5.2);
  sun.position.set(-60, 90, -40);
  sun.target.position.set(0, 0, 0);
  configureShadowedDirLight(sun, { arenaHalf: H, resolution: 2048 });
  stream.addEssential(sun);
  stream.addEssential(sun.target);
  // Cool rim fill from behind so buildings pop against the sky
  const rim = new THREE.DirectionalLight(0x7a94d4, 1.1);
  rim.position.set(50, 30, 60);
  stream.addEssential(rim);

  // Ground — big asphalt plane with sidewalk border strips.
  const road = roadTex(); road.repeat.set(24, 24);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(H * 2 + 40, H * 2 + 40),
    new THREE.MeshStandardMaterial({ map: road })
  );
  ground.rotation.x = -Math.PI / 2;
  stream.addEssential(ground);

  const sideTex = sidewalkTex(); sideTex.repeat.set(40, 2);
  const sidewalkMat = new THREE.MeshStandardMaterial({ map: sideTex });

  // Perimeter buildings — walls of the arena (keeps players inside).
  const palettes = [
    ['#6b4a3a', '#1c2740'], ['#54585e', '#252c38'], ['#7a6a52', '#322a20'],
    ['#4a3a4e', '#201a2e'], ['#5e4632', '#28201a'],
  ];
  const bTexes = palettes.map(([b, w]) => buildingTex(b, w));
function buildingWithDoor(cx, cz, w, d, h, texIdx, doorFace, opts = {}, doorW = 2.4) {
  const hw = w / 2, hd = d / 2;
  const wallT = 0.6; // wall thickness

  // Helper — one wall segment
  function wall(x, z, sw, sd) {
    building(x, z, sw, sd, h, texIdx, opts);
  }

  switch (doorFace) {
    case 'S': { // gap in south face (positive Z)
      const side = (w - doorW) / 2;
      wall(cx - hw + side / 2,   cz + hd, side,  wallT); // west chunk
      wall(cx + hw - side / 2,   cz + hd, side,  wallT); // east chunk
      wall(cx,                   cz - hd, w,     wallT); // north full
      wall(cx - hw + wallT / 2,  cz,      wallT, d - wallT * 2); // west side
      wall(cx + hw - wallT / 2,  cz,      wallT, d - wallT * 2); // east side
      break;
    }
    case 'N': {
      const side = (w - doorW) / 2;
      wall(cx - hw + side / 2,   cz - hd, side,  wallT);
      wall(cx + hw - side / 2,   cz - hd, side,  wallT);
      wall(cx,                   cz + hd, w,     wallT);
      wall(cx - hw + wallT / 2,  cz,      wallT, d - wallT * 2);
      wall(cx + hw - wallT / 2,  cz,      wallT, d - wallT * 2);
      break;
    }
    case 'E': {
      const side = (d - doorW) / 2;
      wall(cx + hw, cz - hd + side / 2,   wallT, side);
      wall(cx + hw, cz + hd - side / 2,   wallT, side);
      wall(cx - hw, cz,                   wallT, d);
      wall(cx,      cz - hd + wallT / 2,  w - wallT * 2, wallT);
      wall(cx,      cz + hd - wallT / 2,  w - wallT * 2, wallT);
      break;
    }
    case 'W': {
      const side = (d - doorW) / 2;
      wall(cx - hw, cz - hd + side / 2,   wallT, side);
      wall(cx - hw, cz + hd - side / 2,   wallT, side);
      wall(cx + hw, cz,                   wallT, d);
      wall(cx,      cz - hd + wallT / 2,  w - wallT * 2, wallT);
      wall(cx,      cz + hd - wallT / 2,  w - wallT * 2, wallT);
      break;
    }
  }

  // Doorframe posts so the gap reads as a door
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2020 });
  const postH = Math.min(h, 2.8);
  function post(x, z) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, postH, 0.22), frameMat);
    p.position.set(x, postH / 2, z);
    opts.essential ? stream.addEssential(p) : stream.addStreamable(p, x, z);
  }
  const dh = doorW / 2;
  if (doorFace === 'S') { post(cx - dh, cz + hd); post(cx + dh, cz + hd); }
  if (doorFace === 'N') { post(cx - dh, cz - hd); post(cx + dh, cz - hd); }
  if (doorFace === 'E') { post(cx + hw, cz - dh); post(cx + hw, cz + dh); }
  if (doorFace === 'W') { post(cx - hw, cz - dh); post(cx - hw, cz + dh); }

  // Lintel above the door gap
  const lintMat = new THREE.MeshStandardMaterial({ color: 0x1e1818 });
  const lintY = 2.6;
  const lintH = h - lintY;
  if (doorFace === 'S' || doorFace === 'N') {
    const lz = doorFace === 'S' ? cz + hd : cz - hd;
    const l = new THREE.Mesh(new THREE.BoxGeometry(doorW, lintH, wallT), lintMat);
    l.position.set(cx, lintY + lintH / 2, lz);
    opts.essential ? stream.addEssential(l) : stream.addStreamable(l, cx, lz);
  } else {
    const lx = doorFace === 'E' ? cx + hw : cx - hw;
    const l = new THREE.Mesh(new THREE.BoxGeometry(wallT, lintH, doorW), lintMat);
    l.position.set(lx, lintY + lintH / 2, cz);
    opts.essential ? stream.addEssential(l) : stream.addStreamable(l, lx, cz);
  }
}
  function building(x, z, w, d, h, texIdx, opts = {}) {
    const tex = bTexes[texIdx % bTexes.length].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ map: tex })
    );
    m.position.set(x, h / 2, z);
    // sidewalk skirt
    const sw = new THREE.Mesh(new THREE.BoxGeometry(w + 3, 0.18, d + 3), sidewalkMat);
    sw.position.set(x, 0.09, z);
    if (opts.essential) {
      stream.addEssential(m); stream.addEssential(sw);
    } else {
      stream.addStreamable(m, x, z);
      stream.addStreamable(sw, x, z);
    }
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h });
    // Sidewalk skirt = walkable 18 cm step (feet stand on it, not in it).
    colliders.push({ x0: x - w / 2 - 1.5, z0: z - d / 2 - 1.5, x1: x + w / 2 + 1.5, z1: z + d / 2 + 1.5, h: 0.18, step: true, mat: 'concrete' });
  }

  // Perimeter ring (gaps are sealed by invisible bounds in the engine).
  // All perimeter buildings are STREAMABLE — they only appear when the
  // player roams near them.
  let i = 0;
  for (let x = -H + 10; x <= H - 10; x += 24) {
    building(x, -H - 6, 20, 14, 14 + (i % 3) * 6, i++);
    building(x, H + 6, 20, 14, 12 + (i % 4) * 5, i++);
  }
  for (let z = -H + 10; z <= H - 10; z += 24) {
    building(-H - 6, z, 14, 20, 13 + (i % 3) * 7, i++);
    building(H + 6, z, 14, 20, 15 + (i % 4) * 4, i++);
  }

  // Inner cover blocks — ESSENTIAL (every spawn faces one).
// Was: building(-22, -18, 16, 12, 7, 1, { essential: true });
buildingWithDoor(-22, -18, 16, 12, 7, 1, 'E', { essential: true });

// Was: building(24, 16, 14, 16, 8, 2, { essential: true });
buildingWithDoor(24, 16, 14, 16, 8, 2, 'W', { essential: true });

// Was: building(2, 34, 18, 10, 6, 3, { essential: true });
buildingWithDoor(2, 34, 18, 10, 6, 3, 'S', { essential: true });

// Was: building(30, -28, 12, 12, 7, 0, { essential: true });
buildingWithDoor(30, -28, 12, 12, 7, 0, 'N', { essential: true });
// ── BUILDING A: West side — (-22, -18, 16×12, h7) ─────────────────────────
// Layout: side hallway on east face, stairwell in NE corner, open roof
{
  const bx = -22, bz = -18;

  // Floor 1 entrance — short hallway stub jutting east
  building(bx + 10, bz - 2, 4, 6, 3.2, 1, { essential: true });  // hallway segment
  colliders.push({ x0: bx+7, z0: bz-5, x1: bx+13, z1: bz+1, h: 3.2 }); // already added by building()

  // Floor 2 — narrow walkway ledge on east side
  const floorMat2 = new THREE.MeshStandardMaterial({ color: 0x4a3a2e });
  const f2a = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 10), floorMat2);
  f2a.position.set(bx + 9.6, 3.6, bz);
  stream.addEssential(f2a);

  // Floor 3 / roof slab — flat accessible roof
  const roofMatA = new THREE.MeshStandardMaterial({ color: 0x3a3040 });
  const roofA = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 12), roofMatA);
  roofA.position.set(bx, 7.1, bz);
  stream.addEssential(roofA);

  // Stairwell box NE corner — 3 stacked risers
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x5a4830 });
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 1.2), stepMat);
    step.position.set(bx + 5.8, 1.1 + s * 1.2, bz - 4.5 + s * 0.6);
    stream.addEssential(step);
  }
  // Stair landing platform at floor 2
  const landA2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 3), floorMat2);
  landA2.position.set(bx + 5.8, 3.6, bz - 3);
  stream.addEssential(landA2);
  // Stair risers floor 2 → roof
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 1.2), stepMat);
    step.position.set(bx + 5.8, 3.9 + s * 1.1, bz - 3.5 + s * 0.5);
    stream.addEssential(step);
  }

  // Low parapet wall around roof
  const parMat = new THREE.MeshStandardMaterial({ color: 0x5a4a5e });
  const parH = 0.9;
  for (const [px, pz, pw, pd] of [
    [bx, bz - 6.1, 16, 0.3],   // north edge
    [bx, bz + 6.1, 16, 0.3],   // south edge
    [bx - 8.1, bz, 0.3, 12],   // west edge
    [bx + 8.1, bz, 0.3, 12],   // east edge
  ]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(pw, parH, pd), parMat);
    par.position.set(px, 7.1 + parH / 2, pz);
    stream.addEssential(par);
  }
}

// ── BUILDING B: East side — (24, 16, 14×16, h8) ────────────────────────────
// Layout: exterior staircase on south face, interior corridor floor 2,
//         rooftop water tower accent
{
  const bx = 24, bz = 16;

  // Exterior staircase — south face, open metal-look steps
  const stepMatB = new THREE.MeshStandardMaterial({ color: 0x2c3c48 });
  const landMatB = new THREE.MeshStandardMaterial({ color: 0x263038 });

  // Ground → floor 2 (8 steps climbing north along south wall)
  for (let s = 0; s < 7; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 1.0), stepMatB);
    step.position.set(bx - 5.5, 0.2 + s * 0.55, bz + 8.5 - s * 0.7);
    stream.addEssential(step);
  }
  // Floor 2 landing
  const landB2 = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 3), landMatB);
  landB2.position.set(bx - 5.5, 4.1, bz + 5.5);
  stream.addEssential(landB2);

  // Floor 2 interior — L-shaped corridor offset from stairs
  const corrMatB = new THREE.MeshStandardMaterial({ color: 0x3a4448 });
  const corrB = new THREE.Mesh(new THREE.BoxGeometry(10, 0.22, 4), corrMatB);
  corrB.position.set(bx, 4.1, bz - 2);
  stream.addEssential(corrB);

  // Floor 2 → roof stair (inside, NW corner)
  for (let s = 0; s < 4; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1.0), stepMatB);
    step.position.set(bx - 3.5, 4.3 + s * 0.95, bz - 5.5 + s * 0.6);
    stream.addEssential(step);
  }
  // Roof landing
  const landB3 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 3), landMatB);
  landB3.position.set(bx - 3.5, 8.1, bz - 3.5);
  stream.addEssential(landB3);

  // Roof slab
  const roofMatB = new THREE.MeshStandardMaterial({ color: 0x2a3840 });
  const roofB = new THREE.Mesh(new THREE.BoxGeometry(14, 0.25, 16), roofMatB);
  roofB.position.set(bx, 8.1, bz);
  stream.addEssential(roofB);

  // Water tower on roof (cylinder + cone cap) — gives snipers a prop to hide behind
  const wtBody = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x6a4a28 })
  );
  wtBody.position.set(bx + 4.5, 9.4, bz - 5.5);
  const wtCap = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 1.0, 10),
    new THREE.MeshStandardMaterial({ color: 0x4a3018 })
  );
  wtCap.position.set(bx + 4.5, 10.75, bz - 5.5);
  stream.addEssential(wtBody);
  stream.addEssential(wtCap);
  colliders.push({ x0: bx+3.2, z0: bz-6.8, x1: bx+5.8, z1: bz-4.2, h: 11 });

  // Parapet
  const parMatB = new THREE.MeshStandardMaterial({ color: 0x2a3440 });
  for (const [px, pz, pw, pd] of [
    [bx, bz - 8.1, 14, 0.3],
    [bx, bz + 8.1, 14, 0.3],
    [bx - 7.1, bz, 0.3, 16],
    [bx + 7.1, bz, 0.3, 16],
  ]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.85, pd), parMatB);
    par.position.set(px, 8.55, pz);
    stream.addEssential(par);
  }
}

// ── BUILDING C: North — (2, 34, 18×10, h6) ─────────────────────────────────
// Layout: internal spiral-feel stairwell (square switchback), wide flat roof
//         with AC units as cover props
{
  const bx = 2, bz = 34;

  // Switchback stair — ground to floor 2, tucked in SE corner
  const stepMatC = new THREE.MeshStandardMaterial({ color: 0x505840 });
  const landMatC = new THREE.MeshStandardMaterial({ color: 0x404830 });

  // Run 1: west → east along south wall
  for (let s = 0; s < 4; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 2.5), stepMatC);
    step.position.set(bx + 4.5 - s * 1.1, 0.2 + s * 0.7, bz + 3.5);
    stream.addEssential(step);
  }
  // Mid landing
  const midLandC = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2.5), landMatC);
  midLandC.position.set(bx + 1, 3.0, bz + 3.5);
  stream.addEssential(midLandC);
  // Run 2: doubles back east → west at mid level
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 2.5), stepMatC);
    step.position.set(bx + 1 + s * 1.1, 3.2 + s * 0.6, bz + 3.5);
    stream.addEssential(step);
  }
  // Floor 2 landing
  const landC2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 3.5), landMatC);
  landC2.position.set(bx + 4.5, 3.1, bz + 3);
  stream.addEssential(landC2);

  // Floor 2 open deck — entire width, half depth
  const deckMatC = new THREE.MeshStandardMaterial({ color: 0x484c38 });
  const deckC = new THREE.Mesh(new THREE.BoxGeometry(16, 0.22, 8), deckMatC);
  deckC.position.set(bx, 3.1, bz);
  stream.addEssential(deckC);

  // Roof stair (short, NE corner)
  for (let s = 0; s < 4; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 1.0), stepMatC);
    step.position.set(bx + 6, 3.3 + s * 0.7, bz - 4 + s * 0.55);
    stream.addEssential(step);
  }

  // Roof slab
  const roofMatC = new THREE.MeshStandardMaterial({ color: 0x3c4030 });
  const roofC = new THREE.Mesh(new THREE.BoxGeometry(18, 0.25, 10), roofMatC);
  roofC.position.set(bx, 6.1, bz);
  stream.addEssential(roofC);

  // AC units on roof — staggered cover
  const acMat = new THREE.MeshStandardMaterial({ color: 0x5c6058 });
  for (const [ox, oz] of [[-5, -1], [0, 2], [5, -2]]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.6), acMat);
    ac.position.set(bx + ox, 6.55, bz + oz);
    stream.addEssential(ac);
    colliders.push({ x0: bx+ox-1.2, z0: bz+oz-0.8, x1: bx+ox+1.2, z1: bz+oz+0.8, h: 7.0 });
  }

  // Low parapet
  const parMatC = new THREE.MeshStandardMaterial({ color: 0x484c38 });
  for (const [px, pz, pw, pd] of [
    [bx, bz - 5.1, 18, 0.3],
    [bx, bz + 5.1, 18, 0.3],
    [bx - 9.1, bz, 0.3, 10],
    [bx + 9.1, bz, 0.3, 10],
  ]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.8, pd), parMatC);
    par.position.set(px, 6.5, pz);
    stream.addEssential(par);
  }
}

// ── BUILDING D: Southeast — (30, -28, 12×12, h7) ───────────────────────────
// Layout: fire-escape style exterior ladder on west face, small interior
//         shaft, rooftop billboard frame as cover
{
  const bx = 30, bz = -28;

  // Fire escape — west face, vertical ladder rungs + landing grates
  const ladderMat = new THREE.MeshStandardMaterial({ color: 0x3a3028 });
  const grateMat  = new THREE.MeshStandardMaterial({ color: 0x2e2820 });

  // Grate 1 at floor 2 height (~3.5)
  const grate1 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 2), grateMat);
  grate1.position.set(bx - 7, 3.5, bz);
  stream.addEssential(grate1);

  // Grate 2 at floor 3 / roof height (~7)
  const grate2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 2), grateMat);
  grate2.position.set(bx - 7, 7.1, bz);
  stream.addEssential(grate2);

  // Ladder rungs between ground and grate 1
  for (let r = 0; r < 6; r++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), ladderMat);
    rung.position.set(bx - 7, 0.5 + r * 0.52, bz - 0.65);
    stream.addEssential(rung);
  }
  // Ladder rungs grate 1 → grate 2
  for (let r = 0; r < 7; r++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), ladderMat);
    rung.position.set(bx - 7, 3.65 + r * 0.52, bz - 0.65);
    stream.addEssential(rung);
  }

  // Interior stair shaft — small box attached to inside west wall
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x302820 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 3), shaftMat);
  shaft.position.set(bx - 3.5, 3.5, bz - 3.5);
  stream.addEssential(shaft);
  colliders.push({ x0: bx-5, z0: bz-5, x1: bx-2, z1: bz-2, h: 7 });

  // Interior step risers visible at shaft opening
  for (let s = 0; s < 5; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 0.9), ladderMat);
    step.position.set(bx - 3.5, 1.0 + s * 1.2, bz - 3 + s * 0.3);
    stream.addEssential(step);
  }

  // Roof slab
  const roofMatD = new THREE.MeshStandardMaterial({ color: 0x302828 });
  const roofD = new THREE.Mesh(new THREE.BoxGeometry(12, 0.25, 12), roofMatD);
  roofD.position.set(bx, 7.1, bz);
  stream.addEssential(roofD);

  // Billboard frame on roof — two vertical posts + crossbar, cover prop
  const billMat = new THREE.MeshStandardMaterial({ color: 0x4a3820 });
  const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.5, 0.3), billMat);
  post1.position.set(bx - 3.5, 8.85, bz - 1);
  const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.5, 0.3), billMat);
  post2.position.set(bx + 3.5, 8.85, bz - 1);
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 0.3), billMat);
  crossbar.position.set(bx, 10.4, bz - 1);
  const signFace = new THREE.Mesh(
    new THREE.BoxGeometry(7, 2.2, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x7a1a0a })
  );
  signFace.position.set(bx, 9.5, bz - 1.1);
  stream.addEssential(post1);
  stream.addEssential(post2);
  stream.addEssential(crossbar);
  stream.addEssential(signFace);
  colliders.push({ x0: bx-4, z0: bz-1.5, x1: bx+4, z1: bz-0.5, h: 10.6 });

  // Parapet
  const parMatD = new THREE.MeshStandardMaterial({ color: 0x382828 });
  for (const [px, pz, pw, pd] of [
    [bx, bz - 6.1, 12, 0.3],
    [bx, bz + 6.1, 12, 0.3],
    [bx - 6.1, bz, 0.3, 12],
    [bx + 6.1, bz, 0.3, 12],
  ]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.85, pd), parMatD);
    par.position.set(px, 7.55, pz);
    stream.addEssential(par);
  }
}
  // Cover props — mix of urban street props and arcade-style objects
  // replacing the old placeholder crate instancing. Each prop is a
  // small group with its own AABB collider so it reads as real cover
  // and stops bullets / movement correctly. Positions preserved from
  // the old crate layout so gameplay lanes remain unchanged.
  const _propMkArgs = { colliders };
  const propGroup = new THREE.Group();
  const _pushProp = (mesh) => propGroup.add(mesh);
  // Central alley cluster (near spawns) — heavy cover blob
  _pushProp(makeDumpster({ ..._propMkArgs, x: -6, z: -2, rot: 0.2 }));
  _pushProp(makeSandbags({ ..._propMkArgs, x: -4, z: -2, rot: Math.PI / 2, len: 3 }));
  _pushProp(makeArcade({ ..._propMkArgs, x: -5, z: -0.2, rot: -0.4, screenColor: 0xff2a8a }));
  // Mid arena — arcade cabinets grouped as a chokepoint
  _pushProp(makeArcade({ ..._propMkArgs, x: 12, z: -12, rot: 0.4, screenColor: 0x60c0ff }));
  _pushProp(makeVending({ ..._propMkArgs, x: 14, z: -12, rot: -0.5, color: 0xb91c1c }));
  // NW alley — dumpster + trash cans
  _pushProp(makeDumpster({ ..._propMkArgs, x: -14, z: 8, rot: -0.3 }));
  _pushProp(makeTrashCan({ ..._propMkArgs, x: -12.6, z: 8.6 }));
  _pushProp(makeTrashCan({ ..._propMkArgs, x: -12.6, z: 7.4 }));
  // NE crossing — parked car and phone booth
  _pushProp(makeParkedCar({ ..._propMkArgs, x: 8, z: 24, rot: 0.7, bodyCol: 0x8a1c2c, roofCol: 0x421218 }));
  _pushProp(makePhoneBooth({ ..._propMkArgs, x: 6, z: 22, rot: -0.4 }));
  // SW industrial — generator + newspaper box
  _pushProp(makeGenerator({ ..._propMkArgs, x: -18, z: -30, rot: 1.1 }));
  _pushProp(makeNewsBox({ ..._propMkArgs, x: -16.5, z: -30, rot: -0.2, color: 0x3040aa }));
  _pushProp(makeMailbox({ ..._propMkArgs, x: -15.4, z: -29.5, rot: 0.5 }));
  // SE — vending + arcade combo (arcade + soda spot)
  _pushProp(makeVending({ ..._propMkArgs, x: 20, z: 2, rot: 1.2, color: 0x1b6ea0 }));
  _pushProp(makeArcade({ ..._propMkArgs, x: 20.9, z: 2.9, rot: 1.2 - Math.PI / 6, screenColor: 0x66e070 }));
  // Center south — parked car (broadside cover)
  _pushProp(makeParkedCar({ ..._propMkArgs, x: 0, z: -24, rot: Math.PI / 2, bodyCol: 0x1a1a20, roofCol: 0x0a0a10 }));
  // West perimeter — dumpster + trash + phone
  _pushProp(makeDumpster({ ..._propMkArgs, x: -34, z: -4, rot: Math.PI / 2 }));
  _pushProp(makePhoneBooth({ ..._propMkArgs, x: -33, z: -6, rot: -Math.PI / 2 }));
  _pushProp(makeMailbox({ ..._propMkArgs, x: -33, z: -2, rot: -Math.PI / 2 }));
  // East perimeter — parked car + newsbox
  _pushProp(makeParkedCar({ ..._propMkArgs, x: 34, z: 6, rot: Math.PI, bodyCol: 0x6a6a70, roofCol: 0x2a2a30 }));
  _pushProp(makeNewsBox({ ..._propMkArgs, x: 32.5, z: 3, rot: -Math.PI / 2, color: 0xa02020 }));
  _pushProp(makeTrashCan({ ..._propMkArgs, x: 32.5, z: 4.2 }));
  stream.addEssential(propGroup);

  // Drivable spawns — 2 civilian testcars + 1 Quota (police trike,
  // special variant with red/blue emergency lights toggled via R3),
  // plus 2 motocross dirt bikes for faster / lighter mounts, plus
  // the Venom (Corvette Stingray) sports car — player spawns in it.
  // NOTE: Venom placed near Team A's spawn corner so the player's
  // auto-mount lands on clear tarmac (the arena's building layout
  // covers a chunk of the origin — spawning at 0,0 blocked motion).
  const vehicleSpawns = [
    { x: -12, z: 14, yaw: 0.4 },
    { x:  16, z: -22, yaw: 1.8 },
    { x:   0, z:  32, yaw: 0, kind: 'quota' },
    { x: -6, z: -8, yaw: -0.9, kind: 'dirtbike' },
    { x:  8, z:  6, yaw:  1.2, kind: 'dirtbike' },
    { x: -40, z: -40, yaw: Math.PI / 4, kind: 'venom' },
  ];

  // Weapon pickups — 2 AK + 2 TEC9 drops in opposite-corner positions
  // so both teams have a reasonable route to grab one without crossing
  // the spawn line of the other team. (User request: 2 AK + 2 TEC9.)
  const weaponPickups = [
    { wpn: 'ak47', x: -28, z:  4, ammo: 60 },
    { wpn: 'ak47', x:  28, z: -4, ammo: 60 },
    { wpn: 'tec9', x:  -4, z:  26, ammo: 100 },
    { wpn: 'tec9', x:   4, z: -26, ammo: 100 },
    { wpn: 'pimpslap', x: 0, z: 0, ammo: 1 },
  ];

  // Street lamps — instanced poles + per-light point lights.  Pole
  // geometry shares one InstancedMesh; lamps + their point lights
  // stream per-tile so we never light the entire block at once.
  const lampPts = [[-20, 0], [20, 30], [0, -16], [36, -10], [-36, 18]];
  const lampPoles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.12, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x33343c }),
    lampPts.length,
  );
  const tmp = new THREE.Object3D();
  for (let k = 0; k < lampPts.length; k++) {
    const [x, z] = lampPts[k];
    tmp.position.set(x, 3, z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    lampPoles.setMatrixAt(k, tmp.matrix);
  }
  lampPoles.instanceMatrix.needsUpdate = true;
  stream.addEssential(lampPoles);

  for (const [x, z] of lampPts) {
    const lampGroup = new THREE.Group();
    const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd97a }));
    lampGlow.position.set(x, 5.9, z);
    const pl = new THREE.PointLight(0xffc060, 8, 16);
    pl.position.set(x, 5.6, z);
    lampGroup.add(lampGlow, pl);
    stream.addStreamable(lampGroup, x, z);
  }

  // iter192 baked lighting — neon accent lamps at the 4 corner
  // districts so the block reads at a glance even at dusk. Streamable
  // so they LOD out when the player is on the opposite side.
  stream.addEssential(addBakedLampFixture(-H + 8, -H + 8, 'neon_magenta'));
  stream.addEssential(addBakedLampFixture( H - 8, -H + 8, 'neon_cyan'));
  stream.addEssential(addBakedLampFixture(-H + 8,  H - 8, 'neon_cyan'));
  stream.addEssential(addBakedLampFixture( H - 8,  H - 8, 'neon_magenta'));

  // ── Phase 3 extras: dumpsters, hydrants, parking meters, benches,
  //    traffic lights, fences, vegetation, AC units, signage, fire
  //    escapes.  All streamed/instanced through `stream` + `colliders`.
  addCityProps(stream, colliders, { half: H });

  // Team spawn corners (Saints SW / Rollerz NE), 6 jittered points each.
  const spawns = {
    A: Array.from({ length: 6 }, (_, k) => ({ x: -H + 14 + (k % 3) * 4, z: -H + 14 + Math.floor(k / 3) * 4, yaw: Math.PI / 4 })),
    B: Array.from({ length: 6 }, (_, k) => ({ x: H - 14 - (k % 3) * 4, z: H - 14 - Math.floor(k / 3) * 4, yaw: Math.PI + Math.PI / 4 })),
  };

  // Prime around mid-spawn so the player's immediate surroundings are
  // loaded before frame 1 — avoids a one-frame "empty world" flash.
  stream.primeAround(0, 0);

  // Sprinkle graffiti decals across random building faces. If the AI
  // texture hasn't loaded yet, subscribe so we can place them as soon
  // as the graffiti PNG finishes streaming in.
  if (!addGraffitiDecals(scene, colliders, stream)) {
    const unsub = subscribeAiTex((set) => {
      if (set.graffiti_decal_sheet) {
        addGraffitiDecals(scene, colliders, stream);
        unsub();
      }
    });
  }

  // ── Jersey barriers — permanent hard cover at chokepoints ─────
  // See JB_LAYOUTS.block in jerseyBarrier.js for the per-map layout.
  scatterBarriersForMap('block', stream, colliders);

  return { colliders, spawns, half: ARENA_HALF, stream, vehicleSpawns, weaponPickups };
}
