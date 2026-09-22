// Team Gangsta Brawl — "BOARDROOM" map (mp_bac_01).
//
// A four-corner Saints Row street intersection. Central plaza with
// concrete Jersey barriers (from the user's GLB) surrounded by four
// two-storey city-block buildings. Each building has full interior
// walls creating 4 rooms per floor + a stairway between floors, so
// players can flank through side-streets, breach the ground floor
// and camp the second-floor windows above the rocket-spawn plaza.
//
// Character height ≈ 1.8 m — everything else is authored to feel
// large relative to that (building floors 3.5 m ceiling, streets
// 14 m wide, plaza 44 m across).
//
// GLB `mp_bac_01.glb` is loaded async for the small props (Jersey
// barriers + weapon-pickup meshes); everything structural (walls,
// stairs, floor slabs, doorways) is procedural so we can give each
// piece an explicit AABB collider.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { StreamingManager } from './streamManager.js';
import { configureShadowedDirLight } from './render/lod.js';
import { getTexture, createSkyDome } from './textures.js';
import { buildAsphaltTile, buildSidewalkStrip } from './roads.js';
import { scatterBarriersForMap } from './jerseyBarrier.js';
import { placeBakedLampGrid, addBakedLampFixture } from './bakedLights.js';
import {
  makeDumpster, makeVending, makeArcade, makePhoneBooth,
  makeMailbox, makeTrashCan, makeGenerator, makeNewsBox,
  makeParkedCar, makeSandbags,
} from './props3d.js';

const MAP_SCALE = 16.0;
export const BAC_HALF = 72;   // 144 m arena

let _glbPromise = null;
function apiBase() {
  const env = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || '';
  return env.replace(/\/$/, '');
}
export function ensureBoardroomGlb() {
  if (_glbPromise) return _glbPromise;
  const url = `${apiBase()}/api/static/models/mp_bac_01.glb`;
  const loader = new GLTFLoader();
  _glbPromise = new Promise((resolve, reject) => {
    loader.load(url, (g) => resolve(g.scene), undefined, (e) => { _glbPromise = null; reject(e); });
  });
  return _glbPromise;
}

// ── Building specs — 4 corner blocks ────────────────────────────
// Each block is a 24×24 m two-story house. `entry` marks the side
// facing the central plaza (that side has the ground-floor doorway).
const BUILDINGS = [
  { cx: -34, cz: -34, brickCol: 0x3a2a30, roofCol: 0x1a1116, entry: 'NE' }, // SW brownstone
  { cx:  34, cz: -34, brickCol: 0x2a2634, roofCol: 0x14101a, entry: 'NW' }, // SE grey
  { cx: -34, cz:  34, brickCol: 0x4a2830, roofCol: 0x241014, entry: 'SE' }, // NW red-brick
  { cx:  34, cz:  34, brickCol: 0x2c2c34, roofCol: 0x161018, entry: 'SW' }, // NE tall
];

const BUILDING_SIZE = 24;                // per side (24 × 24 m footprint)
const FLOOR_H = 3.5;                     // ground → 2nd floor
const BUILDING_H = 7.5;                  // total (2 storeys + parapet)
const WALL_T = 0.4;
const DOOR_W = 3.0;                      // width of exterior doorway
const INT_DOOR_W = 2.4;                  // width of interior doorway

// Jersey-barrier layout in the central plaza (locations extracted from
// mp_bac_01_mesh_analysis.json, scaled to world units). Barriers are
// full 1.5-m concrete blast walls with collision.
const BARRIERS = [
  { cx:  14.7, cz:  5.4, w: 1.0, d: 3.0, h: 1.5 },
  { cx:  5.4, cz: -15.1, w: 3.0, d: 1.0, h: 1.5 },
  { cx:  5.1, cz:  14.5, w: 3.0, d: 1.0, h: 1.5 },
  { cx: -5.8, cz:  15.1, w: 3.0, d: 1.0, h: 1.5 },
  { cx: -14.9, cz:  5.6, w: 1.0, d: 3.0, h: 1.5 },
  { cx:  14.5, cz: -5.4, w: 1.0, d: 3.0, h: 1.5 },
  { cx: -14.9, cz: -5.5, w: 1.0, d: 3.0, h: 1.5 },
  { cx:  14.5, cz:  5.4, w: 1.0, d: 3.0, h: 1.5 },
  { cx:   0, cz:  9, w: 6.0, d: 0.7, h: 1.2 },
  { cx:   0, cz: -9, w: 6.0, d: 0.7, h: 1.2 },
  { cx:   9, cz:  0, w: 0.7, d: 6.0, h: 1.2 },
  { cx:  -9, cz:  0, w: 0.7, d: 6.0, h: 1.2 },
];

export function buildBoardroomMap(scene) {
  const colliders = [];
  const H = BAC_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 8, unloadRadius: 12 });

  // ── Atmosphere ─────────────────────────────────────────────────
  scene.fog = new THREE.Fog(0x2a3050, 100, 380);
  scene.background = new THREE.Color(0x162040);

  // Sky-dome — huge textured sphere with the procedural sunset-cloud
  // texture. Sits at the very back of the render order so nothing
  // clips through it. Cloud drift is handled by the game loop via
  // `scrollClouds(mesh, dt)`.
  const skyDome = createSkyDome(420);
  scene.add(skyDome);
  scene.__skyDome = skyDome;

  // ── Lighting ──────────────────────────────────────────────────
  // Night city — cool moonlight from the NE with warm sodium fill
  // from the plaza sign so shadows stay chiseled. Ambient is kept
  // low so the directional light does the heavy lifting.
  stream.addEssential(new THREE.HemisphereLight(0x8ea6d0, 0x2a1830, 1.8));
  stream.addEssential(new THREE.AmbientLight(0x6a5c8a, 0.65));
  const moon = new THREE.DirectionalLight(0xd8e2ff, 3.6);
  moon.position.set(-60, 110, 40);
  moon.target.position.set(0, 0, 0);
  configureShadowedDirLight(moon, { arenaHalf: 80, resolution: 2048 });
  stream.addEssential(moon);
  stream.addEssential(moon.target);
  // Warm sodium counter-light from the opposite side for rim highlight
  const rim = new THREE.DirectionalLight(0xffb070, 0.6);
  rim.position.set(80, 40, -30);
  stream.addEssential(rim);

  // Central plaza flare so the rocket spawn is easy to find.
  const plazaSpot = new THREE.PointLight(0xffa670, 4.2, 60, 1.6);
  plazaSpot.position.set(0, 6, 0);
  stream.addEssential(plazaSpot);

  // iter192 baked lighting — perimeter streetlamps ring the plaza at
  // even spacing, plus 4 neon accents on the corner-building facades
  // so the boardroom-district feel reads at night.
  placeBakedLampGrid(stream, {
    half: 80, kind: 'streetlamp',
    perimeter: true, inset: 12, step: 22, essential: false,
  });
  stream.addEssential(addBakedLampFixture(-32, -32, 'neon_magenta'));
  stream.addEssential(addBakedLampFixture( 32, -32, 'neon_cyan'));
  stream.addEssential(addBakedLampFixture(-32,  32, 'neon_cyan'));
  stream.addEssential(addBakedLampFixture( 32,  32, 'neon_magenta'));

  // ── Ground: 3×3 grid of UNIQUE hi-res asphalt tiles ───────────
  // The whole 172.8 m arena floor is split into nine ~57.6 m tiles.
  // Each tile has its own seeded canvas texture mapped 1:1 (no repeat)
  // so nothing tiles at eye level. Middle-edge tiles get a storm
  // drain near the road-side edge, the centre tile gets a pair of
  // manhole covers so the plaza has something to break up the field
  // of asphalt.
  const groundSize = H * 2.4;                       // 172.8 m
  const tileSize = groundSize / 3;                  // 57.6 m
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      const tcx = gx * tileSize;
      const tcz = gz * tileSize;
      const opts = { seed: 1000 + (gz + 1) * 3 + (gx + 1) };
      if (gx === 0 && gz === 0) {
        opts.manholes = [[0.32, 0.42], [0.68, 0.63]];
      }
      if (gx !== 0 && gz === 0) {
        // storm drain along the road-facing curb of each E/W edge tile
        opts.drains = [[gx < 0 ? 0.94 : 0.06, 0.5, Math.PI / 2]];
      }
      if (gz !== 0 && gx === 0) {
        opts.drains = [[0.5, gz < 0 ? 0.94 : 0.06, 0]];
      }
      const tile = buildAsphaltTile({
        cx: tcx, cz: tcz,
        w: tileSize + 0.1, d: tileSize + 0.1,   // small overlap to hide seams
        y: -0.02,
        pxW: 1024,
        ...opts,
      });
      stream.addEssential(tile);
    }
  }

  // ── Sidewalks: raised concrete strips framing each corner building
  // A sidewalk hugs the two plaza-facing sides of every corner
  // building. Strip is 0.15m tall (climbable step) with a unique
  // slab texture per strip. Colliders auto-registered.
  const SW_W = 3.2;                                 // sidewalk width (m)
  const B_HALF = BUILDING_SIZE / 2;                 // 12 m
  for (const b of BUILDINGS) {
    const isW = b.cx < 0;
    const isS = b.cz < 0;
    // Strip parallel to X (in front of the building, plaza side)
    const swZ = b.cz + (isS ? B_HALF + SW_W / 2 : -B_HALF - SW_W / 2);
    stream.addEssential(buildSidewalkStrip({
      cx: b.cx, cz: swZ,
      w: BUILDING_SIZE + 2 * SW_W, d: SW_W,
      y: 0, seed: Math.floor(b.cx * 7 + b.cz * 3 + 500), colliders,
    }));
    // Strip parallel to Z (down the plaza-facing side of the building)
    const swX = b.cx + (isW ? B_HALF + SW_W / 2 : -B_HALF - SW_W / 2);
    stream.addEssential(buildSidewalkStrip({
      cx: swX, cz: b.cz,
      w: SW_W, d: BUILDING_SIZE,
      y: 0, seed: Math.floor(b.cx * 3 + b.cz * 5 + 700), colliders,
    }));
  }

  // ── Building factory ──────────────────────────────────────────
  // Each wall material is a clone of the shared brick texture with a
  // per-block color tint. `getBrickMat` caches by tint so identical
  // buildings share one material upload.
  const brickMatCache = new Map();
  function getBrickMat(col) {
    if (!brickMatCache.has(col)) {
      const tex = getTexture('brick', { tint: col }).clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 2);   // ~3 brick-tiles per building face
      brickMatCache.set(col, pbr.building({ map: tex, roughness: 0.92 }));
    }
    return brickMatCache.get(col);
  }
  const wallMat = getBrickMat(0x5a4a52);
  // Concrete rooftop / interior floors
  const roofTex = getTexture('concrete', { tint: 0x2a2028 });
  roofTex.repeat.set(3, 3);
  const roofMat = pbr.building({ map: roofTex, roughness: 0.95 });
  const floorTex = getTexture('wood');
  floorTex.repeat.set(2, 2);
  const floorSlabMat = pbr.wood({ map: floorTex });
  const stairMat = pbr.stone({ map: getTexture('concrete', { tint: 0x3a2830 }) });
  const windowLitMat = new THREE.MeshBasicMaterial({ color: 0xffcc70, side: THREE.DoubleSide });
  const windowDimMat = new THREE.MeshBasicMaterial({ color: 0xd88a3a, side: THREE.DoubleSide });
  const windowOffMat = new THREE.MeshBasicMaterial({ color: 0x1a1218, side: THREE.DoubleSide });

  // Push a solid box wall + AABB collider (collider spans y=0..cy+h/2).
  function pushWall(cx, cy, cz, w, h, d, mat, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    stream.addEssential(m);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h: cy + h / 2,
      climbable: !!opts.climbable,
    });
  }

  // Same as pushWall but skips the collider — used for visual-only
  // elements (roofs, floor slabs where the collider is a climbable
  // top surface added separately).
  function pushMesh(cx, cy, cz, w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    stream.addEssential(m);
  }

  // Add a wall of given LENGTH running along the specified axis with
  // optional holes (doorways). Wall spans y = 0 to `h` (full-height
  // collider so both floors share it).
  function segmentedFullWall(cx, cz, len, h, mat, axis, holes = []) {
    const sorted = holes.slice().sort((a, b) => a[0] - b[0]);
    let cursor = -len / 2;
    for (const [a, b] of sorted) {
      const start = Math.max(-len / 2, a);
      const end = Math.min(len / 2, b);
      if (start > cursor) {
        const segLen = start - cursor;
        const segMid = cursor + segLen / 2;
        if (axis === 'x') pushWall(cx + segMid, h / 2, cz, segLen, h, WALL_T, mat);
        else               pushWall(cx, h / 2, cz + segMid, WALL_T, h, segLen, mat);
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < len / 2) {
      const segLen = len / 2 - cursor;
      const segMid = cursor + segLen / 2;
      if (axis === 'x') pushWall(cx + segMid, h / 2, cz, segLen, h, WALL_T, mat);
      else               pushWall(cx, h / 2, cz + segMid, WALL_T, h, segLen, mat);
    }
  }

  // Interior partition wall (ground floor only — height = FLOOR_H,
  // collider top = FLOOR_H so 2nd floor players walk over freely).
  function segmentedIntWall(cx, cz, len, mat, axis, holes = []) {
    const sorted = holes.slice().sort((a, b) => a[0] - b[0]);
    let cursor = -len / 2;
    const h = FLOOR_H;
    for (const [a, b] of sorted) {
      const start = Math.max(-len / 2, a);
      const end = Math.min(len / 2, b);
      if (start > cursor) {
        const segLen = start - cursor;
        const segMid = cursor + segLen / 2;
        if (axis === 'x') pushWall(cx + segMid, h / 2, cz, segLen, h, WALL_T, mat);
        else               pushWall(cx, h / 2, cz + segMid, WALL_T, h, segLen, mat);
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < len / 2) {
      const segLen = len / 2 - cursor;
      const segMid = cursor + segLen / 2;
      if (axis === 'x') pushWall(cx + segMid, h / 2, cz, segLen, h, WALL_T, mat);
      else               pushWall(cx, h / 2, cz + segMid, WALL_T, h, segLen, mat);
    }
  }

  // Add glowing window quads on a wall face. `axis` describes which
  // face this is: '+x' / '-x' / '+z' / '-z'. `centre` is the middle
  // of the wall, `len` its horizontal span. Windows are 1.4 × 1.6 m,
  // three per floor, evenly spaced.
  const winGeom = new THREE.PlaneGeometry(1.8, 2.0);
  function paintWindows(cx, cz, len, axis, floorBase) {
    const yFloor1 = floorBase + 1.8;
    const yFloor2 = floorBase + FLOOR_H + 1.8;
    const step = len / 4;                       // 3 windows: -step, 0, +step
    for (let i = -1; i <= 1; i++) {
      for (const wy of [yFloor1, yFloor2]) {
        const roll = Math.random();
        const mat = roll < 0.20 ? windowOffMat : (roll < 0.55 ? windowDimMat : windowLitMat);
        const win = new THREE.Mesh(winGeom, mat);
        if (axis === '+x') { win.position.set(cx + 0.02, wy, cz + i * step); win.rotation.y = -Math.PI / 2; }
        else if (axis === '-x') { win.position.set(cx - 0.02, wy, cz + i * step); win.rotation.y = Math.PI / 2; }
        else if (axis === '+z') { win.position.set(cx + i * step, wy, cz + 0.02); }
        else if (axis === '-z') { win.position.set(cx + i * step, wy, cz - 0.02); win.rotation.y = Math.PI; }
        stream.addEssential(win);
      }
    }
  }

  // Two-storey building constructor.
  function buildHouse(cx, cz, brickCol, entryDir) {
    const brick = getBrickMat(brickCol);
    const size = BUILDING_SIZE;
    const half = size / 2;
    // Doorway position: cut into the wall FACING the plaza. entryDir
    // encodes which corner faces inward — split the door between the
    // two adjacent faces so the building always has a plaza-facing
    // opening no matter which quadrant it sits in.
    const doorHoles = { '+x': [], '-x': [], '+z': [], '-z': [] };
    // Every building gets a single doorway centred on its plaza-facing
    // wall (whichever face has smaller absolute distance to origin).
    const facingX = cx > 0 ? '-x' : '+x';
    const facingZ = cz > 0 ? '-z' : '+z';
    doorHoles[facingX].push([-DOOR_W / 2, DOOR_W / 2]);
    doorHoles[facingZ].push([-DOOR_W / 2, DOOR_W / 2]);

    // ── Outer walls — FULL HEIGHT (single collider spans both floors)
    // Ground-floor doorway gap so players enter from the plaza side.
    // North wall (z = cz + half), runs along X.
    segmentedFullWall(cx, cz + half, size, BUILDING_H, brick, 'x', doorHoles['+z']);
    segmentedFullWall(cx, cz - half, size, BUILDING_H, brick, 'x', doorHoles['-z']);
    segmentedFullWall(cx + half, cz, size, BUILDING_H, brick, 'z', doorHoles['+x']);
    segmentedFullWall(cx - half, cz, size, BUILDING_H, brick, 'z', doorHoles['-x']);

    // Lintel above each doorway on the plaza-facing walls — purely
    // visual (no collider) so it looks like a proper door frame.
    const lintelMat = brick;
    const lintelH = BUILDING_H - 2.4;
    if (facingX === '+x') pushMesh(cx + half, 2.4 + lintelH / 2, cz, WALL_T, lintelH, DOOR_W, lintelMat);
    else if (facingX === '-x') pushMesh(cx - half, 2.4 + lintelH / 2, cz, WALL_T, lintelH, DOOR_W, lintelMat);
    if (facingZ === '+z') pushMesh(cx, 2.4 + lintelH / 2, cz + half, DOOR_W, lintelH, WALL_T, lintelMat);
    else if (facingZ === '-z') pushMesh(cx, 2.4 + lintelH / 2, cz - half, DOOR_W, lintelH, WALL_T, lintelMat);

    // ── Roof parapet (visual only, no collider) ───────────────
    pushMesh(cx, BUILDING_H + 0.35, cz + half, size, 0.7, WALL_T, brick);
    pushMesh(cx, BUILDING_H + 0.35, cz - half, size, 0.7, WALL_T, brick);
    pushMesh(cx + half, BUILDING_H + 0.35, cz, WALL_T, 0.7, size, brick);
    pushMesh(cx - half, BUILDING_H + 0.35, cz, WALL_T, 0.7, size, brick);

    // ── Roof cap (climbable via rooftop parkour) ──────────────
    // yBase = BUILDING_H so this collider only blocks horizontal
    // movement AT roof height (players walking on it). Players
    // walking INSIDE the building at any floor pass right through
    // this AABB without penalty.
    pushMesh(cx, BUILDING_H + 0.05, cz, size, 0.1, size, roofMat);
    colliders.push({
      x0: cx - half, z0: cz - half,
      x1: cx + half, z1: cz + half,
      h: BUILDING_H + 0.1,
      yBase: BUILDING_H - 0.15,
      climbable: false,
    });

    // ── Stairway config (needed so the slabs align to the well)
    // 7 climbable steps up 3.5 m — each step 0.5m tall (under
    // engine's STEP_UP threshold), walked-up automatically.
    // Well sits in NE quadrant; stairs run south → north.
    const stepCount = 7;
    const stepH = FLOOR_H / stepCount;
    const stepD = 0.8;
    const stairwellCX = cx + 6;                       // NE quadrant, x-centre
    const stairwellCZ = cz + 6;                       // NE quadrant, z-centre
    const wellX0 = cx + 4;                            // stairwell hole west edge
    const wellX1 = cx + 9;                            // hole east edge
    const wellZ0 = cz + 3;                            // hole south edge (stair base)
    const stairTopZ = wellZ0 + stepCount * stepD;     // z where the 7th step ends
    const wellZ1 = stairTopZ;                         // north edge of hole = end of stairs

    // ── Second-floor slab — 4 rectangles surrounding the stairwell
    // Every collider gets `yBase: FLOOR_H - 0.15` so the underside
    // is a "ceiling" the ground-floor player walks under freely.
    // Only players standing ON the slab (playerY >= FLOOR_H) or
    // with their head above the slab underside collide with the
    // AABB. `topAt` still uses `h: FLOOR_H` so the top surface is
    // walkable as normal.
    const SLAB_YBASE = FLOOR_H - 0.15;
    function pushSlab(minX, minZ, maxX, maxZ) {
      const w = maxX - minX, d = maxZ - minZ;
      if (w <= 0 || d <= 0) return;
      const scx = (minX + maxX) / 2;
      const scz = (minZ + maxZ) / 2;
      pushMesh(scx, FLOOR_H, scz, w, 0.25, d, floorSlabMat);
      colliders.push({
        x0: minX, z0: minZ, x1: maxX, z1: maxZ,
        h: FLOOR_H, yBase: SLAB_YBASE, climbable: true,
      });
    }
    // South of hole — full-width strip
    pushSlab(cx - half, cz - half, cx + half, wellZ0);
    // North of hole — full-width strip (starts where the stairs top out)
    pushSlab(cx - half, wellZ1, cx + half, cz + half);
    // West of hole — narrow strip
    pushSlab(cx - half, wellZ0, wellX0, wellZ1);
    // East of hole — narrow strip
    pushSlab(wellX1, wellZ0, cx + half, wellZ1);

    // ── Interior partition walls (ground floor only — 4 rooms) ─
    // Vertical divider (N-S) with a doorway offset from centre.
    segmentedIntWall(cx, cz, size, wallMat, 'z', [[-1.2, 1.2]]);
    // Horizontal divider (E-W) with a doorway.
    segmentedIntWall(cx, cz, size, wallMat, 'x', [[-1.2, 1.2]]);

    // ── Stair risers (7 steps fully inside the stairwell hole) ─
    for (let i = 0; i < stepCount; i++) {
      const sZ = wellZ0 + stepD / 2 + i * stepD;
      const sH = stepH * (i + 1);
      const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(3.0, sH, stepD), stairMat);
      stepMesh.position.set(stairwellCX, sH / 2, sZ);
      stepMesh.receiveShadow = true;
      stepMesh.castShadow = true;
      stream.addEssential(stepMesh);
      colliders.push({
        x0: stairwellCX - 1.5, z0: sZ - stepD / 2,
        x1: stairwellCX + 1.5, z1: sZ + stepD / 2,
        h: sH, climbable: true, step: true,
      });
    }
    // Stair railing (visual + collision so you don't fall off the
    // side coming down). Railing itself is FULL-HEIGHT (blocks the
    // ground floor too — you can't walk under it).
    pushWall(stairwellCX - 1.6, FLOOR_H / 2 + 0.4, stairwellCZ, 0.15, FLOOR_H - 0.2, stepCount * stepD, stairMat);

    // ── Interior lamps (both floors) ──────────────────────────
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a4 });
    for (const y of [FLOOR_H - 0.5, BUILDING_H - 0.6]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lampMat);
      bulb.position.set(cx - half / 2, y, cz - half / 2);
      stream.addEssential(bulb);
      const light = new THREE.PointLight(0xffcc90, 1.4, 14);
      light.position.copy(bulb.position);
      stream.addEssential(light);

      const bulb2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lampMat);
      bulb2.position.set(cx + half / 2, y, cz + half / 2);
      stream.addEssential(bulb2);
      const light2 = new THREE.PointLight(0xffcc90, 1.4, 14);
      light2.position.copy(bulb2.position);
      stream.addEssential(light2);
    }

    // ── Windows — three per floor per outer face (offset outward past
    // the wall thickness so they sit ON the outside face).
    const wOff = WALL_T / 2 + 0.03;
    paintWindows(cx, cz + half + wOff, size, '+z', 0);
    paintWindows(cx, cz - half - wOff, size, '-z', 0);
    paintWindows(cx + half + wOff, cz, size, '+x', 0);
    paintWindows(cx - half - wOff, cz, size, '-x', 0);

    // Exterior building label (address plate) so each block reads as
    // a distinct address.
    const addrMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    const addr = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.6), addrMat);
    // Place plate above the plaza-facing doorway.
    if (facingX === '+x') { addr.position.set(cx + half + 0.06, FLOOR_H + 0.5, cz); addr.rotation.y = -Math.PI / 2; }
    else if (facingX === '-x') { addr.position.set(cx - half - 0.06, FLOOR_H + 0.5, cz); addr.rotation.y = Math.PI / 2; }
    stream.addEssential(addr);
    // Silence unused-var linter for entryDir which is passed for readability.
    void entryDir;
  }

  // Instantiate the four corner houses.
  BUILDINGS.forEach(({ cx, cz, brickCol, entry }) => buildHouse(cx, cz, brickCol, entry));

  // ── Central plaza floor (light-concrete look) ──────────────────
  const plazaMat = pbr.stone({ color: 0x2a2830, roughness: 0.8 });
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  stream.addEssential(plaza);

  // Kerbs delineating plaza edge.
  const kerbMat = pbr.stone({ color: 0x555560 });
  function kerb(cx, cz, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), kerbMat);
    m.position.set(cx, 0.11, cz);
    stream.addEssential(m);
  }
  kerb(0,  22, 44, 0.4);
  kerb(0, -22, 44, 0.4);
  kerb( 22, 0, 0.4, 44);
  kerb(-22, 0, 0.4, 44);

  // ── Concrete Jersey barriers ───────────────────────────────────
  const barrierMat = pbr.stone({ color: 0x8a8a90 });
  BARRIERS.forEach(({ cx, cz, w, d, h }) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), barrierMat);
    m.position.set(cx, h / 2, cz);
    stream.addStreamable(m, cx, cz);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h, climbable: false,
    });
  });

  // ── Realistic street & alley props ────────────────────────────
  // Fills the four side-streets between corner buildings with parked
  // cars, dumpsters, arcades and vending machines so the arena reads
  // as a city block instead of an empty plaza. Every prop registers
  // its own AABB so bullets and movement respect the silhouette.
  const propGroup = new THREE.Group();
  const P = { colliders };
  const _add = (m) => propGroup.add(m);
  // Parked cars along the four through-streets (broadside to the road)
  _add(makeParkedCar({ ...P, x: -50, z:  16, rot: 0, bodyCol: 0x8c1c2c, roofCol: 0x421218 }));
  _add(makeParkedCar({ ...P, x: -50, z: -16, rot: Math.PI, bodyCol: 0x1a1a24, roofCol: 0x0a0a12 }));
  _add(makeParkedCar({ ...P, x:  50, z:  16, rot: Math.PI, bodyCol: 0x3c6a5c, roofCol: 0x1a3028 }));
  _add(makeParkedCar({ ...P, x:  50, z: -16, rot: 0, bodyCol: 0x6a6a70, roofCol: 0x2a2a30 }));
  _add(makeParkedCar({ ...P, x:  16, z:  50, rot: Math.PI / 2, bodyCol: 0x263a5a, roofCol: 0x141826 }));
  _add(makeParkedCar({ ...P, x: -16, z: -50, rot: -Math.PI / 2, bodyCol: 0x8a5a20, roofCol: 0x3a2410 }));
  // Alley clusters (behind each corner building)
  const alleyOffsets = [
    { cx: -50, cz: -50, rot: 0.6 },
    { cx:  50, cz: -50, rot: -0.6 },
    { cx: -50, cz:  50, rot: 2.5 },
    { cx:  50, cz:  50, rot: -2.5 },
  ];
  for (const a of alleyOffsets) {
    _add(makeDumpster({ ...P, x: a.cx, z: a.cz, rot: a.rot }));
    _add(makeTrashCan({ ...P, x: a.cx + Math.cos(a.rot + 1.2) * 2, z: a.cz + Math.sin(a.rot + 1.2) * 2 }));
    _add(makeGenerator({ ...P, x: a.cx + Math.cos(a.rot - 1.5) * 3.6, z: a.cz + Math.sin(a.rot - 1.5) * 3.6, rot: a.rot + Math.PI / 2 }));
  }
  // Corner "storefront" fronts — arcade + vending outside plaza-facing walls
  _add(makeArcade({ ...P, x: -26, z: -22, rot: 0.7, screenColor: 0xff2a8a }));
  _add(makeVending({ ...P, x: -27.5, z: -21.2, rot: 0.7, color: 0xb91c1c }));
  _add(makePhoneBooth({ ...P, x:  27, z: -22, rot: -0.6 }));
  _add(makeArcade({ ...P, x:  26, z:  22, rot: -2.2, screenColor: 0x60c0ff }));
  _add(makeVending({ ...P, x:  27.5, z:  21.2, rot: -2.2, color: 0x1b6ea0 }));
  _add(makePhoneBooth({ ...P, x: -27, z:  22, rot: 2.4 }));
  // Corner mailboxes / newsboxes on plaza kerbs
  _add(makeMailbox({ ...P, x: -22, z: -22, rot: 0.7 }));
  _add(makeMailbox({ ...P, x:  22, z:  22, rot: -Math.PI + 0.7 }));
  _add(makeNewsBox({ ...P, x:  22, z: -22, rot: -0.7, color: 0xa02020 }));
  _add(makeNewsBox({ ...P, x: -22, z:  22, rot: 2.4, color: 0x3040aa }));
  _add(makeTrashCan({ ...P, x: -19, z: -22 }));
  _add(makeTrashCan({ ...P, x:  19, z:  22 }));
  // Sandbag stack around the rocket obelisk — chest-high cover
  _add(makeSandbags({ ...P, x:  6, z:  2.5, rot: 0, len: 3 }));
  _add(makeSandbags({ ...P, x: -6, z: -2.5, rot: Math.PI, len: 3 }));
  stream.addEssential(propGroup);

  // ── Street lamps around the plaza + along the streets ─────────
  function streetLamp(cx, cz) {
    const postMat = pbr.metal({ color: 0x1a1a20, roughness: 0.5 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6.0, 6), postMat);
    post.position.set(cx, 3.0, cz);
    stream.addEssential(post);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe4a8 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), bulbMat);
    bulb.position.set(cx, 6.2, cz);
    stream.addEssential(bulb);
    const lamp = new THREE.PointLight(0xffd396, 2.2, 22, 1.6);
    lamp.position.set(cx, 5.8, cz);
    stream.addEssential(lamp);
    colliders.push({ x0: cx - 0.2, z0: cz - 0.2, x1: cx + 0.2, z1: cz + 0.2, h: 6, climbable: false });
  }
  // Ring of lamps around the plaza.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    streetLamp(Math.cos(a) * 24, Math.sin(a) * 24);
  }
  // Lamps along the streets between buildings.
  [-52, -40, 40, 52].forEach((v) => {
    streetLamp(v, 0);
    streetLamp(0, v);
  });

  // ── Central obelisk (rocket-pickup marker) ────────────────────
  const obeliskMat = pbr.stone({ color: 0xa8a8b0, roughness: 0.6 });
  const obelisk = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 4), obeliskMat);
  obelisk.position.set(0, 1.2, 0);
  obelisk.rotation.y = Math.PI / 4;
  stream.addEssential(obelisk);
  const rpgHalo = new THREE.PointLight(0xff6a4a, 2.6, 18);
  rpgHalo.position.set(0, 3.0, 0);
  stream.addEssential(rpgHalo);

  // ── Arena boundary (invisible) ────────────────────────────────
  const invMat = new THREE.MeshBasicMaterial({ visible: false });
  function bound(cx, cz, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 60, d), invMat);
    m.position.set(cx, 30, cz);
    stream.addEssential(m);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h: 60, climbable: false,
    });
  }
  bound(0,  H, H * 2, 0.6);
  bound(0, -H, H * 2, 0.6);
  bound( H, 0, 0.6, H * 2);
  bound(-H, 0, 0.6, H * 2);

  // ── GLB visual overlay (just the small props from the source) ──
  // The GLB contains a big wrapper mesh that would fill the arena;
  // we prune to only the pickup / prop models.
  const GLB_KEEP_PREFIXES = ['cs_pumpshotgun', 'p_rpg', 'pimphat'];
  ensureBoardroomGlb().then((glbScene) => {
    const root = glbScene.clone(true);
    root.scale.setScalar(MAP_SCALE);
    root.position.y = 0.02;
    const toRemove = [];
    root.traverse((o) => {
      if (o === root || !o.isMesh) return;
      const keep = GLB_KEEP_PREFIXES.some((p) => o.name && o.name.startsWith(p));
      if (!keep) toRemove.push(o);
    });
    toRemove.forEach((o) => o.parent && o.parent.remove(o));
    scene.add(root);
  }).catch((err) => {
    console.warn('[Boardroom] GLB visual load failed:', err);
  });

  // ── Spawns — south street (Team A) / north street (Team B) ────
  const spawnsA = [
    { x:  -6, z: -60, yaw: 0 },
    { x:   0, z: -60, yaw: 0 },
    { x:   6, z: -60, yaw: 0 },
    { x: -55, z:   0, yaw:  Math.PI / 2 },
    { x:  55, z:   0, yaw: -Math.PI / 2 },
  ];
  const spawnsB = [
    { x:  -6, z:  60, yaw: Math.PI },
    { x:   0, z:  60, yaw: Math.PI },
    { x:   6, z:  60, yaw: Math.PI },
    { x: -55, z:  20, yaw:  Math.PI / 2 },
    { x:  55, z:  20, yaw: -Math.PI / 2 },
  ];
  const spawns = { A: spawnsA, B: spawnsB };

  // ── KOTH hills ────────────────────────────────────────────────
  const hillCandidates = [
    { id: 'plaza',        x:  0, z:   0, radius: 6.5, y: 0,        label: 'PLAZA CENTER' },
    { id: 'sw_rooftop',   x: -34, z: -34, radius: 6.0, y: BUILDING_H, label: 'SW ROOFTOP' },
    { id: 'ne_rooftop',   x:  34, z:  34, radius: 6.0, y: BUILDING_H, label: 'NE ROOFTOP' },
    { id: 'ne_2f',        x:  34, z:  34, radius: 5.0, y: FLOOR_H,    label: 'NE 2ND FLOOR' },
  ];

  // ── Weapon pickups ────────────────────────────────────────────
  const weaponPickups = [
    { wpn: 'rpg',      x:   0, z:   0, ammo: 2   },
    { wpn: 'shotgun',  x:  18, z:   0, ammo: 16  },
    { wpn: 'shotgun',  x: -18, z:   0, ammo: 16  },
    { wpn: 'ak47',     x:  30, z:  30, ammo: 60, y: FLOOR_H + 0.2 },   // upstairs NE
    { wpn: 'ak47',     x: -30, z: -30, ammo: 60, y: FLOOR_H + 0.2 },   // upstairs SW
    { wpn: 'tec9',     x: -30, z:  30, ammo: 100 },                    // downstairs NW
    { wpn: 'tec9',     x:  30, z: -30, ammo: 100 },                    // downstairs SE
    { wpn: 'pimpslap', x:   0, z:  18, ammo: 1   },
    // Pipe-bomb caches — 2 grenades per pickup, always come in pairs.
    { wpn: 'pipebomb', x:  10, z:   6, ammo: 2   },
    { wpn: 'pipebomb', x: -10, z:  -6, ammo: 2   },
  ];

  // Jersey barriers around the table + rear approach — see
  // JB_LAYOUTS.boardroom in jerseyBarrier.js.
  scatterBarriersForMap('boardroom', stream, colliders);

  return {
    colliders,
    spawns,
    half: BAC_HALF,
    stream,
    hillCandidates,
    weaponPickups,
  };
}
