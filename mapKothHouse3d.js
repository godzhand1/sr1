// Team Gangsta Brawl — "KOTH HOUSE" map.
//
// Indoor multi-room building designed for the King of the Hill mode.
// Three hill candidates live in distinct rooms; the engine picks one
// of them at match start (random for solo, lobby-hash derived for
// online consistency).
//
// Layout (top-down, ~52×52 m interior).  +Z is "north" (deep into the
// house), -Z is "south" (front of the house where teams spawn).
//
//        +-----------+----------+-----------+    z = +H  (north wall)
//        |           |          |           |
//        |  KITCHEN  | HALLWAY  |  GARAGE   |
//        | (hill 1)  | (hill 2) | (hill 3)  |
//        |           |          |           |
//        |   +-----+ |          | +-----+   |    z = +12
//        |   |     | |  doorway | |     |   |
//        +---+ door+-+----------+-+ door+---+    z = -2  (partition)
//                                                        with 3 gaps
//        |                                       |
//        |        LIVING ROOM / FOYER            |
//        |                                       |
//        |   spawn A                spawn B      |
//        +---------------------------------------+    z = -H  (south)
//
// Returns: { colliders, spawns, half, hillCandidates, stream }.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { StreamingManager } from './streamManager.js';
import { sidewalkTex } from './arena3d.js';
import { cloneTexture as cloneAiTex, subscribe as subscribeAiTex } from './aiTextures.js';
import { scatterBarriersForMap } from './jerseyBarrier.js';
import { addBakedLampFixture } from './bakedLights.js';

export const KOTH_HALF = 26;        // 52×52 outer bound

export function buildKothHouseMap(scene) {
  const colliders = [];
  const H = KOTH_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 4, unloadRadius: 5 });

  scene.fog = new THREE.Fog(0x2a2230, 40, 140);
  scene.background = new THREE.Color(0x161020);

  // ── Lighting ─────────────────────────────────────────────────────
  stream.addEssential(new THREE.HemisphereLight(0xe6d9ff, 0x3a2f44, 2.2));
  stream.addEssential(new THREE.AmbientLight(0xa089c0, 1.1));
  // Warm ceiling lamps — one per room. Brighter + longer reach so the
  // whole room reads, plus a low fill in the living room.
  const lampKitchen  = new THREE.PointLight(0xffd28c, 1.8, 32); lampKitchen.position.set( -16, 4.5,  12); stream.addEssential(lampKitchen);
  const lampHallway  = new THREE.PointLight(0xffd28c, 1.8, 32); lampHallway.position.set(   0, 4.5,  12); stream.addEssential(lampHallway);
  const lampGarage   = new THREE.PointLight(0xffd28c, 1.8, 32); lampGarage.position.set(  16, 4.5,  12); stream.addEssential(lampGarage);
  const lampLivingW  = new THREE.PointLight(0xffd28c, 1.6, 30); lampLivingW.position.set(-12, 4.5, -14); stream.addEssential(lampLivingW);
  const lampLivingE  = new THREE.PointLight(0xffd28c, 1.6, 30); lampLivingE.position.set( 12, 4.5, -14); stream.addEssential(lampLivingE);
  const lampLivingC  = new THREE.PointLight(0xffd28c, 1.4, 30); lampLivingC.position.set(  0, 4.5,  -8); stream.addEssential(lampLivingC);

  // iter192 baked lighting — 3 KOTH hill spotlights so each hill
  // candidate glows before contest, plus a magenta/cyan neon pair
  // above the front porch so the exterior isn't pitch-dark.
  stream.addEssential(addBakedLampFixture(-16, 12, 'spotlight'));  // kitchen hill
  stream.addEssential(addBakedLampFixture(  0, -8, 'spotlight'));  // living-room hill
  stream.addEssential(addBakedLampFixture( 16, 12, 'spotlight'));  // garage hill
  stream.addEssential(addBakedLampFixture(-10,  H - 4, 'neon_magenta'));
  stream.addEssential(addBakedLampFixture( 10,  H - 4, 'neon_cyan'));

  // ── Floor (hardwood) ────────────────────────────────────────────
  const floorMat = (() => {
    const ai = cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(7, 7); return pbr.stone({ map: ai, color: 0x8a6a4a }); }
    return pbr.stone({ color: 0x5a4534 });
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  stream.addEssential(floor);
  subscribeAiTex(() => {
    const ai = cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(7, 7); floor.material.map = ai; floor.material.needsUpdate = true; }
  });

  // ── Wall materials ──────────────────────────────────────────────
  const wallH = 5.0;
  const wallT = 0.4;
  const exteriorMat = (() => {
    const ai = cloneAiTex('rusty_metal_panel');
    if (ai) { ai.repeat.set(8, 2); return pbr.metal({ map: ai, color: 0x6e4836, roughness: 0.7, metalness: 0.45 }); }
    return pbr.building({ color: 0x6e4836 });
  })();
  const interiorMat = pbr.building({ color: 0xa39080 });

  // pushWall(centerX, centerZ, w, d, opts?) — w along X, d along Z.
  function pushWall(x, z, w, d, opts = {}) {
    if (w <= 0 || d <= 0) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), opts.exterior ? exteriorMat : interiorMat);
    m.position.set(x, wallH / 2, z);
    stream.addEssential(m);
    colliders.push({
      x0: x - w / 2, z0: z - d / 2,
      x1: x + w / 2, z1: z + d / 2,
      h: wallH, climbable: false,
    });
  }

  // Same along the Z axis at x=xc, from z=a to z=b, with one Z-axis gap.
  function wallZWithGap(a, b, xc, gA, gB) {
    if (gA > a) pushWall(xc, (a + gA) / 2, wallT, gA - a);
    if (gB < b) pushWall(xc, (gB + b) / 2, wallT, b - gB);
  }

  // ── Exterior shell ──────────────────────────────────────────────
  pushWall(0,  H, H * 2 + wallT, wallT, { exterior: true }); // north
  pushWall(0, -H, H * 2 + wallT, wallT, { exterior: true }); // south
  pushWall( H, 0, wallT, H * 2 + wallT, { exterior: true }); // east
  pushWall(-H, 0, wallT, H * 2 + wallT, { exterior: true }); // west

  // ── Interior partition (z = -2) separating LIVING ROOM (south,
  // z < -2) from the three hill rooms (north, z > -2). Three doorway
  // gaps so the south room flows to each north room: kitchen door
  // at x ∈ [-19, -14], hallway door at x ∈ [-2, 2], garage door at
  // x ∈ [14, 19].
  pushWall(((-H) + (-19)) / 2, -2, (-19) - (-H), wallT);    // -26 .. -19
  pushWall(((-14) + (-2)) / 2, -2, (-2) - (-14), wallT);    // -14 .. -2
  pushWall(((  2) + ( 14)) / 2, -2, (14) - (2),  wallT);    //   2 .. 14
  pushWall((( 19) + ( H )) / 2, -2, ( H) - (19), wallT);    //  19 .. 26

  // ── Vertical walls splitting the north half into Kitchen /
  // Hallway / Garage. They only exist in z ∈ [-2, H] so they don't
  // bisect the south living room (that was the bug — the previous
  // version put walls from z=-2 to z=H AND spawned teams in the
  // north half, sealing them in a wall-cube). Each vertical wall
  // has a side-door so the hallway connects to kitchen/garage.
  wallZWithGap(-2, H, -8, 8, 12);   // kitchen↔hallway door at z ∈ [8, 12]
  wallZWithGap(-2, H,  8, 8, 12);   // hallway↔garage door at z ∈ [8, 12]

  // ── Furniture / cover ───────────────────────────────────────────
  const crateMat = pbr.wood({
    color: 0x8a6235,
    map: (() => { const t = sidewalkTex(); t.repeat.set(1, 1); return t; })(),
  });
  function pushBox(cx, cz, w, h, d, mat = crateMat, climbable = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, h / 2, cz);
    stream.addStreamable(m, cx, cz);
    colliders.push({ x0: cx - w/2, z0: cz - d/2, x1: cx + w/2, z1: cz + d/2, h, climbable });
  }
  // Kitchen (north-west room) — counter + fridge.
  const kitchenCounterMat = pbr.plastic({ color: 0xc8b890, roughness: 0.4 });
  pushBox(-19,  6, 4.5, 1.0, 0.9, kitchenCounterMat, false);
  pushBox(-12,  6, 2.5, 1.0, 0.9, kitchenCounterMat, false);
  const fridgeMat = pbr.metal({ color: 0xdddde2, roughness: 0.35, metalness: 0.7 });
  pushBox(-22, 22, 1.3, 2.0, 1.3, fridgeMat, false);

  // Hallway (middle north room) — back couch + tv stand to give the
  // hill some cover.
  const couchMat = pbr.plastic({ color: 0x4a2f5a, roughness: 0.85 });
  pushBox(-3, 20, 4.0, 0.8, 1.6, couchMat, true);
  pushBox( 3, 20, 4.0, 0.8, 1.6, couchMat, true);
  const tvMat = pbr.plastic({ color: 0x121214, roughness: 0.25 });
  pushBox(0, 23.5, 2.5, 1.4, 0.4, tvMat, false);

  // Garage (north-east room) — junk crates + workbench.
  pushBox(15, 8, 1.4, 1.2, 1.4, crateMat, true);
  pushBox(17, 8, 1.4, 1.2, 1.4, crateMat, true);
  pushBox(15, 4, 1.4, 2.4, 1.4, crateMat, true);   // taller stack
  const benchMat = pbr.wood({ color: 0x5a4030 });
  pushBox(20, 22, 4.0, 1.0, 1.0, benchMat, false);

  // Living room (south) — couches flanking the centre giving the
  // spawn area some cover before pushing through a doorway.
  pushBox(-6,  -14,  5.0, 0.8, 1.6, couchMat, false);
  pushBox( 6,  -14,  5.0, 0.8, 1.6, couchMat, false);
  pushBox( 0,  -10,  4.0, 0.8, 1.6, couchMat, false);

  // ── Ceiling beams (visual only) ─────────────────────────────────
  const beamMat = pbr.metal({ color: 0x2a2730, roughness: 0.6 });
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 0.25, 0.25), beamMat);
    beam.position.set(0, wallH - 0.3, i * 9);
    stream.addEssential(beam);
  }

  // ── Spawn points (RANDOM, NOT team-segregated). Per user request:
  // KOTH should not lock each gang to a single corner of the south
  // room — both teams pull from a SHARED pool of spawn points
  // scattered across the south LIVING ROOM so respawn assignment
  // feels chaotic and unpredictable. Engine.respawn() picks a
  // random entry from each team's list; pointing both teams at the
  // same pooled list satisfies the "random spawns" requirement
  // without changing engine logic.
  const sharedSpawns = [
    { x: -H + 5,  z: -H + 5,  yaw:  Math.PI / 4  },        // SW corner
    { x: -H + 5,  z: -H + 10, yaw:  Math.PI / 4  },
    { x: -H + 5,  z: -H + 18, yaw:  Math.PI / 4  },
    { x:  H - 5,  z: -H + 5,  yaw: -Math.PI / 4  },        // SE corner
    { x:  H - 5,  z: -H + 10, yaw: -Math.PI / 4  },
    { x:  H - 5,  z: -H + 18, yaw: -Math.PI / 4  },
    { x:  0,      z: -H + 5,  yaw:  0            },        // center-south
    { x:  0,      z: -H + 14, yaw:  0            },
    { x: -10,     z: -H + 22, yaw:  Math.PI / 6  },        // mid-living
    { x:  10,     z: -H + 22, yaw: -Math.PI / 6  },
  ];
  const spawns = { A: sharedSpawns, B: sharedSpawns };

  // ── Weapon pickups — 2 AK + 2 TEC9 in the north rooms so players
  // have to push north (through the partition) to grab them, which
  // also funnels both gangs toward the hill zones.
  const weaponPickups = [
    { wpn: 'ak47', x: -16, z:  -8, ammo: 60  },   // SW of kitchen door
    { wpn: 'ak47', x:  16, z:  -8, ammo: 60  },   // SE of garage door
    { wpn: 'tec9', x:   0, z:   6, ammo: 100 },   // central hallway
    { wpn: 'tec9', x:   0, z:  20, ammo: 100 },   // deep hallway
    { wpn: 'pimpslap', x: 0, z: 0, ammo: 1 },     // brass-knuckles at dead-center
    { wpn: 'pipebomb', x: -8, z: 16, ammo: 2 },   // pipe cache
    { wpn: 'pipebomb', x:  8, z: 16, ammo: 2 },
  ];

  // ── Hill candidates — one per north room ────────────────────────
  // Each hill is centred deep in its room.  The engine picks one of
  // these three at match start.
  const hillCandidates = [
    { id: 'kitchen',    x: -16, z:  14, radius: 4.5, label: 'KITCHEN' },
    { id: 'hallway',    x:   0, z:  14, radius: 4.5, label: 'HALLWAY' },
    { id: 'garage',     x:  16, z:  14, radius: 4.5, label: 'GARAGE' },
  ];

  // Jersey barriers at hallway chokepoints — see JB_LAYOUTS.koth_house.
  scatterBarriersForMap('koth_house', stream, colliders);

  return { colliders, spawns, half: KOTH_HALF, stream, hillCandidates, weaponPickups };
}
