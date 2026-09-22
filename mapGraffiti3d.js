// Team Gangsta Brawl — "GRAFFITI ALLEY" map.
//
// A gritty three-lane brick alley with tagged walls, rooftop catwalks
// for verticality, and a central plaza. Ships in BOTH the TDM
// rotation and the KOTH rotation (three hill candidates: plaza center,
// west rooftop, east rooftop).
//
// User uploaded `grafitti3.glb` but the export shipped empty (132
// bytes, no meshes) so this file builds the arena procedurally from
// primitives + graffiti textures. If a proper GLB lands later we'll
// overlay it as an environmental decoration via `_tryOverlayGlb()`.
//
// Layout (top-down, 60×60 m).
//
//     +------------+----------+------------+   z = -H (north wall)
//     | BUILDING W |  ALLEY N | BUILDING E |
//     |  (rooftop) |          |  (rooftop) |
//     +----+  +----+          +----+  +----+   z = -18
//          |  |                    |  |
//     ALLEY W  <===  PLAZA  ===>  ALLEY E    z =   0
//          |  |                    |  |
//     +----+  +----+          +----+  +----+   z = +18
//     | BUILDING W |  ALLEY S | BUILDING E |
//     |  (rooftop) |          |  (rooftop) |
//     +------------+----------+------------+   z = +H (south wall)
//
// Returns: { colliders, spawns, half, stream, hillCandidates, weaponPickups }.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { StreamingManager } from './streamManager.js';
import { sidewalkTex } from './arena3d.js';
import { cloneTexture as cloneAiTex, subscribe as subscribeAiTex } from './aiTextures.js';
import { scatterBarriersForMap } from './jerseyBarrier.js';
import { placeBakedLampGrid, addBakedLampFixture } from './bakedLights.js';

export const GRAFFITI_HALF = 30;      // 60 × 60 m arena
const BUILDING_H  = 6.5;              // rooftop height
const WALL_H      = 6.5;              // brick wall height
const WALL_T      = 0.5;
const CATWALK_H   = 5.6;              // catwalk deck height (slightly below rooftop for a step-up)

// Graffiti-brick material factory — leans on the existing AI-texture
// pipeline (see aiTextures.js). Falls back to a solid rust/red brick
// tone when the texture set hasn't loaded yet.
function makeBrickMat(tint = 0x7a4635, repeatX = 3, repeatY = 2) {
  const mat = pbr.building({ color: tint, roughness: 0.92 });
  const ai = cloneAiTex('warehouse_concrete_floor');
  if (ai) { ai.repeat.set(repeatX, repeatY); mat.map = ai; }
  subscribeAiTex(() => {
    const upd = cloneAiTex('warehouse_concrete_floor');
    if (upd) { upd.repeat.set(repeatX, repeatY); mat.map = upd; mat.needsUpdate = true; }
  });
  return mat;
}

// Procedural graffiti-tag canvas — cheap DataTexture with 4 random
// tags per wall so every playthrough feels fresh. Colours pulled from
// the SR1 gang palette (Vice Kings gold, Los Carnales red, Westside
// Rollerz blue, Third Street purple).
function makeGraffitiTagTexture(seed = 1) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  // Grimy brick base so bare exposed spots still read as wall.
  g.fillStyle = '#3c2620';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${40 + (i * seed) % 60},${30 + (i * seed * 3) % 40},${25 + (i * seed * 7) % 40},0.6)`;
    g.fillRect((i * seed * 37) % c.width, (i * seed * 53) % c.height, 40 + (i * 3) % 60, 8 + (i * 7) % 16);
  }
  const tags = ['SAINTS', '3RD ST', 'VICE', 'WSR', 'LOSCA', 'BROTHER', 'KING', 'SR1'];
  const palette = ['#fbbf24', '#dc2626', '#3b82f6', '#a855f7', '#22d3ee', '#f97316'];
  for (let i = 0; i < 5; i++) {
    const tag = tags[(i * seed) % tags.length];
    g.font = `${40 + (i * seed) % 30}px Impact, sans-serif`;
    g.fillStyle = palette[(i * seed) % palette.length];
    g.globalAlpha = 0.9;
    g.fillText(tag, (i * seed * 71) % (c.width - 120), 60 + (i * 45) % (c.height - 40));
    // Drop shadow so the tag pops off the brick.
    g.globalAlpha = 0.4;
    g.fillStyle = '#000';
    g.fillText(tag, ((i * seed * 71) % (c.width - 120)) + 3, 63 + (i * 45) % (c.height - 40));
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function buildGraffitiMap(scene) {
  const colliders = [];
  const H = GRAFFITI_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 6, unloadRadius: 10 });

  // ── Atmosphere ─────────────────────────────────────────────────
  scene.fog = new THREE.Fog(0x1a1420, 40, 130);
  scene.background = new THREE.Color(0x0e0a14);

  // Warm streetlight glow at plaza center + rim lighting at each
  // rooftop so the vertical gameplay reads even in low ambient.
  stream.addEssential(new THREE.HemisphereLight(0xffd4a0, 0x2b1f2e, 1.6));
  stream.addEssential(new THREE.AmbientLight(0x8c7ba5, 0.9));
  const streetLamp = new THREE.PointLight(0xffb060, 2.2, 40);
  streetLamp.position.set(0, 4.5, 0);
  stream.addEssential(streetLamp);
  const rooftopW = new THREE.PointLight(0x88a3ff, 1.4, 32);
  rooftopW.position.set(-19, BUILDING_H + 2, 0);
  stream.addEssential(rooftopW);
  const rooftopE = new THREE.PointLight(0xff88a3, 1.4, 32);
  rooftopE.position.set( 19, BUILDING_H + 2, 0);
  stream.addEssential(rooftopE);
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(30, 40, 20);
  stream.addEssential(key);

  // iter192 baked lighting — alley streetlamps line each corridor, and
  // a pair of neon accents (magenta N-alley, cyan S-alley) tie the
  // graffiti tags into a distinct nighttime look.
  stream.addEssential(addBakedLampFixture(-19, -12, 'streetlamp'));
  stream.addEssential(addBakedLampFixture( 19, -12, 'streetlamp'));
  stream.addEssential(addBakedLampFixture(-19,  12, 'streetlamp'));
  stream.addEssential(addBakedLampFixture( 19,  12, 'streetlamp'));
  stream.addEssential(addBakedLampFixture(  0, -22, 'neon_magenta'));
  stream.addEssential(addBakedLampFixture(  0,  22, 'neon_cyan'));

  // ── Ground plane (asphalt) ─────────────────────────────────────
  const asphaltMat = (() => {
    const ai = cloneAiTex('asphalt_road') || cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(10, 10); return pbr.stone({ map: ai, color: 0x2a2028, roughness: 0.75 }); }
    return pbr.stone({ color: 0x201820, roughness: 0.75 });
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), asphaltMat);
  floor.rotation.x = -Math.PI / 2;
  stream.addEssential(floor);
  subscribeAiTex(() => {
    const ai = cloneAiTex('asphalt_road') || cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(10, 10); floor.material.map = ai; floor.material.needsUpdate = true; }
  });

  // Sidewalk borders along the plaza edges.
  try {
    const stex = sidewalkTex ? sidewalkTex() : null;
    if (stex) {
      const swMat = pbr.stone({ map: stex, color: 0x8a8288 });
      const swW = new THREE.Mesh(new THREE.PlaneGeometry(4, H * 2), swMat);
      swW.rotation.x = -Math.PI / 2; swW.position.set(-8, 0.02, 0);
      stream.addEssential(swW);
      const swE = swW.clone(); swE.position.set(8, 0.02, 0);
      stream.addEssential(swE);
    }
  } catch { /* sidewalks optional */ }

  // ── Perimeter wall — inescapable graffiti-tagged brick ─────────
  // Split into segments so the collider list stays flat and each
  // segment can carry a unique graffiti tag texture.
  function pushWall(cx, cz, w, d, opts = {}) {
    const mat = opts.tagged
      ? pbr.building({ map: makeGraffitiTagTexture(opts.seed || 1), color: 0xffffff })
      : makeBrickMat(opts.tint || 0x6a3f30, opts.repeatX || 3, opts.repeatY || 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), mat);
    m.position.set(cx, WALL_H / 2, cz);
    stream.addEssential(m);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h: WALL_H, climbable: false,
    });
    return m;
  }
  // North perimeter
  pushWall(0, -H, H * 2, WALL_T, { tagged: true, seed: 7 });
  // South perimeter
  pushWall(0,  H, H * 2, WALL_T, { tagged: true, seed: 13 });
  // West perimeter
  pushWall(-H, 0, WALL_T, H * 2, { tagged: true, seed: 19 });
  // East perimeter
  pushWall( H, 0, WALL_T, H * 2, { tagged: true, seed: 23 });

  // ── Buildings — 4 corner shops flanking the plaza ──────────────
  // Each building is a 12×12 footprint with a 6.5-m-tall block. The
  // sides facing the plaza are tagged; the outer sides are plain
  // brick. Rooftops are walkable (see catwalks below).
  const BUILDINGS = [
    { cx: -19, cz: -19, tint: 0x4a2c26, seed: 3  },   // NW brownstone
    { cx:  19, cz: -19, tint: 0x352838, seed: 11 },   // NE grey
    { cx: -19, cz:  19, tint: 0x5a2a2a, seed: 17 },   // SW red
    { cx:  19, cz:  19, tint: 0x3a3238, seed: 29 },   // SE dark
  ];
  const BS = 12; // side length
  for (const b of BUILDINGS) {
    const mat = makeBrickMat(b.tint, 3, 2);
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(BS, BUILDING_H, BS), mat);
    body.position.set(b.cx, BUILDING_H / 2, b.cz);
    stream.addEssential(body);
    // Rooftop deck (walkable) — thin box on top so it registers as a
    // collider platform. Slightly tinted lighter so it reads as a
    // tar-and-gravel surface.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(BS, 0.3, BS),
      pbr.building({ color: 0x2a2028, roughness: 0.95 })
    );
    roof.position.set(b.cx, BUILDING_H + 0.15, b.cz);
    stream.addEssential(roof);
    // Body collider
    colliders.push({
      x0: b.cx - BS / 2, z0: b.cz - BS / 2,
      x1: b.cx + BS / 2, z1: b.cz + BS / 2,
      h: BUILDING_H, climbable: false,
    });
    // Rooftop parapet — short walls around the roof edge so players
    // don't ragdoll off accidentally, tagged with a distinct paint.
    const paraH = 1.1;
    const paraT = 0.35;
    const parapet = (cx, cz, w, d) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, paraH, d),
        pbr.building({ color: b.tint, opacity: 0.95, transparent: true })
      );
      m.position.set(cx, BUILDING_H + 0.3 + paraH / 2, cz);
      stream.addEssential(m);
      colliders.push({
        x0: cx - w / 2, z0: cz - d / 2,
        x1: cx + w / 2, z1: cz + d / 2,
        h: paraH, climbable: false, y: BUILDING_H + 0.3,
      });
    };
    parapet(b.cx,               b.cz - BS / 2 + paraT / 2, BS, paraT); // N edge
    parapet(b.cx,               b.cz + BS / 2 - paraT / 2, BS, paraT); // S edge
    parapet(b.cx - BS / 2 + paraT / 2, b.cz,               paraT, BS); // W edge
    parapet(b.cx + BS / 2 - paraT / 2, b.cz,               paraT, BS); // E edge
  }

  // ── Rooftop catwalks — bridge east-west across each row so hills
  // stay contestable from above ────────────────────────────────────
  function pushCatwalk(cx, cz, w, d, y) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.3, d),
      pbr.stone({ color: 0x38323a })
    );
    m.position.set(cx, y + 0.15, cz);
    stream.addEssential(m);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h: 0.3, climbable: false, y: y,
    });
  }
  // North catwalk (bridges NW ↔ NE at rooftop level)
  pushCatwalk(0, -19, 26, 3, BUILDING_H);
  // South catwalk (bridges SW ↔ SE)
  pushCatwalk(0,  19, 26, 3, BUILDING_H);
  // Central plaza catwalk — spans the plaza east-west so gunfights
  // read across the whole map. Slightly below rooftop so players
  // step DOWN onto it from either roof.
  pushCatwalk(0, 0, H * 1.6, 2.5, CATWALK_H);

  // ── Rooftop stairways — climbable stepped colliders so players
  // can access the rooftops from the plaza ────────────────────────
  function pushStairs(cx, cz, w, d, yStart = 0, yEnd = BUILDING_H, steps = 8, facing = 'S') {
    const stepH = (yEnd - yStart) / steps;
    const stepD = d / steps;
    for (let i = 0; i < steps; i++) {
      const y = yStart + stepH * i + stepH / 2;
      let zOff = 0, xOff = 0;
      if (facing === 'S')      zOff = -d / 2 + stepD * i + stepD / 2;
      else if (facing === 'N') zOff =  d / 2 - stepD * i - stepD / 2;
      else if (facing === 'E') xOff = -d / 2 + stepD * i + stepD / 2;
      else                     xOff =  d / 2 - stepD * i - stepD / 2;
      const geo = (facing === 'S' || facing === 'N')
        ? new THREE.BoxGeometry(w, stepH, stepD)
        : new THREE.BoxGeometry(stepD, stepH, w);
      const m = new THREE.Mesh(geo, pbr.stone({ color: 0x2f272f }));
      m.position.set(cx + xOff, y, cz + zOff);
      stream.addEssential(m);
      colliders.push({
        x0: m.position.x - (geo.parameters.width  / 2),
        z0: m.position.z - (geo.parameters.depth  / 2),
        x1: m.position.x + (geo.parameters.width  / 2),
        z1: m.position.z + (geo.parameters.depth  / 2),
        h: stepH, climbable: true, y: y - stepH / 2,
      });
    }
  }
  // Two stairways up from the plaza — one on the west side of the
  // north row, one on the east side of the south row. Diagonal so
  // players from opposite spawns get a symmetrical climb.
  pushStairs(-13, -12, 3, 8, 0, BUILDING_H, 8, 'S');   // NW building south face
  pushStairs( 13,  12, 3, 8, 0, BUILDING_H, 8, 'N');   // SE building north face

  // ── Dumpsters + trash cans for cover in the plaza ──────────────
  function pushProp(cx, cz, w, h, d, color = 0x2a2c2e) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      pbr.building({ color })
    );
    m.position.set(cx, h / 2, cz);
    stream.addEssential(m);
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h, climbable: true,
    });
  }
  pushProp( -6, -6, 2.4, 1.4, 1.6, 0x2a4234);   // green dumpster NW
  pushProp(  6, -6, 2.4, 1.4, 1.6, 0x422a34);   // maroon dumpster NE
  pushProp( -6,  6, 2.4, 1.4, 1.6, 0x2a3442);   // blue dumpster SW
  pushProp(  6,  6, 2.4, 1.4, 1.6, 0x424434);   // olive dumpster SE
  pushProp( -3,  0, 0.7, 1.0, 0.7, 0x1a1a1a);   // trash can W of center
  pushProp(  3,  0, 0.7, 1.0, 0.7, 0x1a1a1a);   // trash can E of center

  // ── Spawns ─────────────────────────────────────────────────────
  // Teams spawn along the north (A) and south (B) alley entries so
  // both sides have equal-length paths to the plaza + rooftops.
  const spawnsA = [
    { x: -12, z: -H + 4, yaw: 0 },
    { x:   0, z: -H + 4, yaw: 0 },
    { x:  12, z: -H + 4, yaw: 0 },
    { x:  -6, z: -H + 8, yaw: 0 },
    { x:   6, z: -H + 8, yaw: 0 },
  ];
  const spawnsB = [
    { x: -12, z:  H - 4, yaw: Math.PI },
    { x:   0, z:  H - 4, yaw: Math.PI },
    { x:  12, z:  H - 4, yaw: Math.PI },
    { x:  -6, z:  H - 8, yaw: Math.PI },
    { x:   6, z:  H - 8, yaw: Math.PI },
  ];
  const spawns = { A: spawnsA, B: spawnsB };

  // ── KOTH hills ────────────────────────────────────────────────
  // Three candidates so KOTH rotation feels varied on this map alone.
  // Rooftop hills force verticality; plaza hill is the classic
  // vase-of-teargas contest zone.
  const hillCandidates = [
    { id: 'plaza',       x:   0, z:   0, radius: 5.5, y: 0,           label: 'PLAZA CENTER' },
    { id: 'nw_rooftop',  x: -19, z: -19, radius: 5.0, y: BUILDING_H,  label: 'NW ROOFTOP' },
    { id: 'se_rooftop',  x:  19, z:  19, radius: 5.0, y: BUILDING_H,  label: 'SE ROOFTOP' },
  ];

  // ── Weapon pickups ────────────────────────────────────────────
  const weaponPickups = [
    { wpn: 'ak47',     x: -19, z: -19, ammo: 60, y: BUILDING_H + 0.4 },   // NW rooftop
    { wpn: 'ak47',     x:  19, z:  19, ammo: 60, y: BUILDING_H + 0.4 },   // SE rooftop
    { wpn: 'tec9',     x:  19, z: -19, ammo: 100, y: BUILDING_H + 0.4 },  // NE rooftop
    { wpn: 'tec9',     x: -19, z:  19, ammo: 100, y: BUILDING_H + 0.4 },  // SW rooftop
    { wpn: 'shotgun',  x:  -8, z:   0, ammo: 16 },                        // W alley chokepoint
    { wpn: 'shotgun',  x:   8, z:   0, ammo: 16 },                        // E alley chokepoint
    { wpn: 'pistol',   x:   0, z: -12, ammo: 24 },                        // approach to plaza N
    { wpn: 'pistol',   x:   0, z:  12, ammo: 24 },                        // approach to plaza S
    { wpn: 'pimpslap', x:   0, z:   0, ammo: 1 },                         // brass-knuckles at plaza core
    { wpn: 'pipebomb', x:  -6, z:  -6, ammo: 2 },                         // NW dumpster
    { wpn: 'pipebomb', x:   6, z:   6, ammo: 2 },                         // SE dumpster
  ];

  // ── Optional prop scatter (jersey barriers). Reuses the KOTH_HOUSE
  // layout as a fallback if graffiti isn't specifically listed. ──
  try { scatterBarriersForMap('graffiti', stream, colliders); } catch { /* optional */ }

  return {
    colliders,
    spawns,
    half: GRAFFITI_HALF,
    stream,
    hillCandidates,
    weaponPickups,
  };
}
