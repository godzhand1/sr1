// Team Gangsta Brawl — "THE PROJECTS" map, traced from the user's SR1
// multiplayer minimap.  Two central courtyard super-blocks ringed by a
// street loop, a big complex up top (the garage), a long planter wall
// + huge building across the bottom, and perimeter housing all around.
// Coordinates were lifted straight off the minimap pixels (1920² image,
// 1px = 1/12 world unit, origin centered) so the street layout matches
// the original flow: ±80 world units.
//
// Perf (iter214): the whole block set is INSTANCED (unit box + per-
// instance transform, 5 shared palette facades with per-instance tint)
// and always resident — nothing streams, nothing pops, ≤ ~20 draw calls
// for the architecture. The 60+ lamp PointLights are adopted by the
// runtime LightPool so only the nearest few are ever real lights.
import * as THREE from 'three';
import { crateTex, addGraffitiDecals } from './arena3d.js';
import { subscribe as subscribeAiTex } from './aiTextures.js';
import { StreamingManager } from './streamManager.js';
import { buildSkyDome } from './skyDome.js';
import { addCityProps } from './arenaProps.js';
import { buildAsphaltTile, generateSidewalkTexture } from './roads.js';
import { generateBrickFacade, generateConcreteFacade } from './buildings4k.js';
import { scatterBarriersForMap } from './jerseyBarrier.js';
import { placeBakedLampGrid, addBakedLampFixture } from './bakedLights.js';
import { flattenToInstances, unitBox } from './render/instanceBatch.js';

const HALF = 80;

// [x0, z0, x1, z1, height, paletteIdx] — world units, traced per-pixel.
const BUILDINGS = [
  // ── top complex (the garage with the entry arrows) + north row
  [-11.7, -62.1, 20.8, -41.2, 12, 0],
  [-47.1, -73.7, -27.5, -52.5, 14, 1],
  [-21.7, -77.5, -9.2, -70.4, 10, 2],
  [2.1, -77.5, 10.0, -70.0, 11, 3],
  [11.7, -77.5, 17.9, -70.0, 9, 4],
  [19.2, -77.5, 27.5, -70.0, 10, 0],
  [30.4, -73.3, 37.5, -67.1, 8, 1],
  [37.5, -63.7, 52.1, -51.2, 12, 2],
  [56.7, -65.0, 65.4, -55.0, 10, 3],
  // ── right side
  [53.7, -42.1, 58.3, -4.6, 11, 4],
  [66.2, -41.7, 73.3, -2.5, 12, 0],
  [34.6, -31.2, 43.3, -25.0, 7, 1],
  [35.0, -22.5, 43.3, -15.8, 7, 2],
  [44.2, -6.7, 52.5, 8.3, 9, 3],
  [43.3, 15.4, 54.6, 23.7, 9, 4],
  [30.8, 18.3, 42.1, 32.5, 10, 0],
  // ── left side
  [-60.8, -39.2, -52.5, -21.7, 10, 1],
  [-60.8, -19.2, -51.2, -9.6, 9, 2],
  [-52.5, -5.0, -33.7, 4.2, 11, 3],
  [-64.6, 14.2, -50.0, 27.1, 10, 4],
  [-63.7, 39.2, -51.2, 50.4, 9, 0],
  [-67.5, 53.3, -52.5, 66.2, 9, 1],
  [-34.6, -24.2, -25.0, -14.2, 7, 2],
  [-34.6, 15.0, -25.8, 22.5, 7, 3],
  [-34.6, 24.6, -25.8, 30.4, 7, 4],
  // ── centerpieces inside the two courtyard super-blocks (ESSENTIAL,
  // spawn points sit next to them)
  [-0.8, -26.2, 10.8, -13.7, 8, 0],
  [0.4, -7.9, 8.3, -2.1, 5, 1],
  [2.1, 7.9, 8.7, 13.3, 5, 2],
  [-2.9, 17.9, 12.5, 30.8, 9, 3],
  // ── bottom
  [-14.2, 49.2, 23.3, 70.4, 13, 4],
  [-45.8, 44.6, -21.7, 58.7, 10, 0],
  [28.3, 47.5, 47.5, 62.1, 10, 1],
  [-34.6, 60.0, -27.5, 69.6, 6, 2],
  [35.0, 60.8, 42.5, 70.0, 6, 3],
];

const LOW_WALLS = [
  [-15.8, 41.2, 23.3, 43.4, 2.2],
];

const GRASS = [
  [-13.3, -61.2, -12.1, -41.7],
  [21.5, -60.8, 22.7, -42.1],
  [-22.5, -33.3, -21.2, -2.1],
  [29.0, -33.3, 30.2, -2.1],
];

const PLAZAS = [
  [-20.4, -33.3, -4.6, -2.1],
  [12.9, -33.3, 28.7, -2.1],
  [-20.8, 4.2, -5.0, 35.4],
  [12.5, 4.2, 28.3, 35.4],
];

export function buildProjectsArena(scene) {
  const colliders = [];
  const stream = new StreamingManager({ scene, loadRadius: 3, unloadRadius: 4 });

  // Cooler, deeper dusk than the city block — projects at nightfall.
  scene.fog = new THREE.Fog(0x241e33, 60, 190);
  scene.background = new THREE.Color(0x241e33);

  const sky = buildSkyDome({ radius: 420, low: '#73383a', high: '#121034' });
  stream.addEssential(sky);

  stream.addEssential(new THREE.HemisphereLight(0xaaa0d6, 0x4e4034, 1.6));
  stream.addEssential(new THREE.AmbientLight(0x6b627e, 1.15));
  const sun = new THREE.DirectionalLight(0xff9d66, 1.6);
  sun.position.set(60, 75, -50);
  stream.addEssential(sun);

  // iter192 baked lighting — the Projects at dusk needs perimeter
  // streetlamps + a couple of red hazard beacons on rooftops for
  // silhouette pop. Center is skipped (KOTH-style, keep the courtyard
  // open) and lamps are streamable so far-side ones unload with LOD.
  placeBakedLampGrid(stream, {
    half: HALF, kind: 'streetlamp',
    step: 20, inset: 10, skipCenter: true, essential: false,
  });
  // Rooftop hazard beacons on the two tallest buildings.
  stream.addEssential(addBakedLampFixture(-37, -63, 'hazard_red'));
  stream.addEssential(addBakedLampFixture( 42,  55, 'hazard_red'));

  // ── Ground: 3×3 grid of unique hi-res asphalt tiles ──────────────
  // Nothing tiles — each tile has its own seeded canvas texture at 1:1
  // mapping. Same system used by the Boardroom map. Middle-edge tiles
  // include storm drains, centre tile has manhole covers.
  const groundSize = (HALF * 2 + 40);
  const tileSize = groundSize / 3;
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      const tcx = gx * tileSize;
      const tcz = gz * tileSize;
      const opts = { seed: 4000 + (gz + 1) * 3 + (gx + 1) };
      if (gx === 0 && gz === 0) {
        opts.manholes = [[0.28, 0.42], [0.62, 0.68]];
      }
      if (gx !== 0 && gz === 0) {
        opts.drains = [[gx < 0 ? 0.94 : 0.06, 0.5, Math.PI / 2]];
      }
      if (gz !== 0 && gx === 0) {
        opts.drains = [[0.5, gz < 0 ? 0.94 : 0.06, 0]];
      }
      const tile = buildAsphaltTile({
        cx: tcx, cz: tcz,
        w: tileSize + 0.1, d: tileSize + 0.1,
        y: -0.02,
        pxW: 1024,
        ...opts,
      });
      stream.addEssential(tile);
    }
  }

  // Shared hi-res concrete-slab sidewalk texture (used for the
  // per-building surround). Slightly larger canvas → crisper slabs.
  const sidewalkTexHR = generateSidewalkTexture(512, 512, { seed: 8001 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ map: sidewalkTexHR });

  // Everything below is built as plain meshes on a shared unit box and
  // then collapsed into InstancedMesh batches (one draw call per
  // material) — see render/instanceBatch.js.
  const UNIT = unitBox();
  const batchable = [];
  const box = (mat, cx, cy, cz, w, h, d, ry = 0) => {
    const m = new THREE.Mesh(UNIT, mat);
    m.position.set(cx, cy, cz); m.rotation.y = ry; m.scale.set(w, h, d);
    batchable.push(m);
    return m;
  };

  // Courtyard plazas — slightly raised concrete pads.
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x76737a });
  for (const [x0, z0, x1, z1] of PLAZAS) box(plazaMat, (x0 + x1) / 2, 0.06, (z0 + z1) / 2, x1 - x0, 0.12, z1 - z0);

  // Buildings — 5 palette facades SHARED across the 34 blocks (was one
  // unique 1024×2048 canvas per building ≈ 300 MB of VRAM + a GPU
  // upload hitch every time one streamed in). Variety comes from a
  // per-instance tint (instanceColor) and 2 window-pattern seeds per
  // palette. All buildings land in ≤10 instanced draw calls and are
  // always resident — no pop-in, nothing to stream.
  const palettes = [
    // [tintHex (brick/concrete base), isBrick]
    [0x5a4638, true],   // warm brownstone brick
    [0x4a3a3e, true],   // deep red brick
    [0x5a5e64, false],  // grey concrete tenement
    [0x6a5842, true],   // sandy brick
    [0x5a4a5a, false],  // purple-grey concrete
  ];
  const facadeMats = new Map();
  const facadeMat = (ti, variant) => {
    const key = `${ti}:${variant}`;
    if (!facadeMats.has(key)) {
      const [tint, isBrick] = palettes[ti % palettes.length];
      const tex = (isBrick ? generateBrickFacade : generateConcreteFacade)({
        seed: 5000 + ti * 17 + variant * 101, pxW: 1024, pxH: 2048, tintHex: tint,
      });
      facadeMats.set(key, new THREE.MeshStandardMaterial({ map: tex }));
    }
    return facadeMats.get(key);
  };
  const tintCol = new THREE.Color();
  for (let bi = 0; bi < BUILDINGS.length; bi++) {
    const [x0, z0, x1, z1, h, ti] = BUILDINGS[bi];
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const m = box(facadeMat(ti, bi & 1), cx, h / 2, cz, w, h, d);
    m.castShadow = true; m.receiveShadow = true;
    // Subtle per-building brightness / warmth shift so shared facades
    // never read as copy-paste.
    const k = 0.9 + ((bi * 37) % 11) / 50;
    m.userData.instanceColor = tintCol.setRGB(k, k * (0.98 + ((bi * 13) % 5) / 100), k * 0.97).clone();
    box(sidewalkMat, cx, 0.09, cz, w + 2.4, 0.18, d + 2.4).receiveShadow = true;
    colliders.push({ x0, z0, x1, z1, h });
    // Raised sidewalk skirt is a walkable step so feet stand ON it,
    // not 18 cm inside it (support comes from topAt; collideXZ passes).
    colliders.push({ x0: x0 - 1.2, z0: z0 - 1.2, x1: x1 + 1.2, z1: z1 + 1.2, h: 0.18, step: true, mat: 'concrete' });
  }

  // Low planter walls (mid cover).
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5d584f });
  for (const [x0, z0, x1, z1, h] of LOW_WALLS) {
    box(wallMat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0);
    colliders.push({ x0, z0, x1, z1, h });
  }

  // Grass hedges.
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x4a5234 });
  for (const [x0, z0, x1, z1] of GRASS) {
    box(grassMat, (x0 + x1) / 2, 0.27, (z0 + z1) / 2, x1 - x0 + 0.6, 0.55, z1 - z0);
    colliders.push({ x0: x0 - 0.3, z0, x1: x1 + 0.3, z1, h: 0.55 });
  }

  // Boundary walls — sealing slabs.
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2c2733 });
  const EDGES = [
    [-72, -80, 76, -77.6, 16],
    [-72, 73.5, 76, 77, 16],
    [-72, -80, -69.4, 77, 16],
    [74.2, -80, 76.6, 77, 16],
  ];
  for (const [x0, z0, x1, z1, h] of EDGES) {
    box(edgeMat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0);
    colliders.push({ x0, z0, x1, z1, h });
  }

  // Crates.
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex() });
  const cratePts = [[-5, -37], [26, -37], [-44, 9], [58, 12], [-5, 44.5], [25.5, 45], [-44, -16], [13, -10], [31, 1], [-23, 38]];
  for (const [x, z] of cratePts) {
    box(crateMat, x, 0.65, z, 1.3, 1.3, 1.3, (x * 13 + z * 7) % 1).castShadow = true;
    colliders.push({ x0: x - 0.65, z0: z - 0.65, x1: x + 0.65, z1: z + 0.65, h: 1.3 });
  }

  // Drivable cars — Brawl3DGame builds them from this spawn list using
  // the GLB testcar mesh. 2 cars per map per user spec, plus a
  // motocross dirt bike for a lighter-and-faster ride option, plus
  // the "Venom" (Corvette Stingray) sports car — player literally
  // spawns AS its driver on match start.
  // NOTE: Venom sits ADJACENT to Team A's spawn (-44, 38.5) with
  // yaw matching the spawn direction, so the player fires up in the
  // driver's seat facing the map centre with clear tarmac ahead. The
  // old (0,0) placement clipped building 26's AABB (0.4→8.3, -7.9→-2.1)
  // so the car couldn't move in any direction on match start.
  const vehicleSpawns = [
    { x: -25, z: -38, yaw: 0.1 },
    { x:  27, z:  -8, yaw: 1.55 },
    { x:   0, z:  38, yaw: 0, kind: 'quota' },
    { x: -12, z:  20, yaw: -0.6, kind: 'dirtbike' },
    { x:  16, z: -20, yaw:  2.4, kind: 'dirtbike' },
    { x: -40, z:  34, yaw: -0.82, kind: 'venom' },
  ];

  // Weapon pickups — 2 AK + 2 TEC9, scattered across the projects so
  // both gangs have routes to grab one. (User request: 2 AK + 2 TEC9.)
  const weaponPickups = [
    { wpn: 'ak47', x: -42, z:  10, ammo: 60 },
    { wpn: 'ak47', x:  44, z: -12, ammo: 60 },
    { wpn: 'tec9', x:  -5, z:  38, ammo: 100 },
    { wpn: 'tec9', x:   5, z: -38, ammo: 100 },
    { wpn: 'pimpslap', x: 0, z: 0, ammo: 1 },
  ];

  // Lamps — instanced poles + glow bulbs, one PointLight per lamp. The
  // lights are adopted by the runtime LightPool (Brawl3DGame) so only
  // the handful nearest the player are ever real.
  const lampPts = [[-23, -10], [25, 12], [0, -36], [0, 40], [-48, 8], [56, -12]];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x33343c });
  const glowGeo = new THREE.SphereGeometry(0.3, 6, 4);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd97a });
  const lampLights = new THREE.Group();
  for (const [x, z] of lampPts) {
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, 3, z); batchable.push(pole);
    const glow = new THREE.Mesh(glowGeo, glowMat); glow.position.set(x, 5.9, z); batchable.push(glow);
    const pl = new THREE.PointLight(0xffc060, 8, 16);
    pl.position.set(x, 5.6, z);
    lampLights.add(pl);
  }
  stream.addEssential(lampLights);

  // Collapse every box / pole / bulb above into instanced batches.
  const { instanced, singles } = flattenToInstances(batchable);
  for (const o of instanced) stream.addEssential(o);
  for (const o of singles) stream.addEssential(o);

  // ── Phase 3 extras: hydrants/meters/benches/lights/fences/vegetation.
  addCityProps(stream, colliders, { half: HALF });

  const spawns = {
    A: Array.from({ length: 6 }, (_, k) => ({ x: -44 + (k % 3) * 3.4, z: 38.5 + Math.floor(k / 3) * 3, yaw: -0.82 })),
    B: Array.from({ length: 6 }, (_, k) => ({ x: 38.5 + (k % 3) * 3.4, z: -45.5 + Math.floor(k / 3) * 3, yaw: 2.32 })),
  };

  // Prime around the center so spawn-adjacent tiles are populated on
  // frame 1 — players see the courtyards immediately.
  stream.primeAround(0, 0);

  // Sprinkle graffiti tags on random project block faces — works the
  // moment the AI texture finishes streaming in.
  if (!addGraffitiDecals(scene, colliders, stream)) {
    const unsub = subscribeAiTex((set) => {
      if (set.graffiti_decal_sheet) {
        addGraffitiDecals(scene, colliders, stream);
        unsub();
      }
    });
  }

  // Jersey barriers at chokepoints — see JB_LAYOUTS.projects.
  scatterBarriersForMap('projects', stream, colliders);

  return { colliders, spawns, half: HALF, stream, vehicleSpawns, weaponPickups };
}