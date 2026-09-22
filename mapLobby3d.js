// Team Gangsta Brawl — "The Lobby" map.
//
// A chill warehouse interior where players spawn before queueing into
// matches. Designed for casual hangout + light skirmishes:
//   • Indoor concrete floor + corrugated-metal walls (rusty_metal_panel)
//   • Stacks of climbable crates as cover and parkour
//   • Catwalk overlooks at second-floor level
//   • Weapon pickups scattered on the floor (no RPG)
//   • Soft warm lighting from skylights
//
// Game-mode rules (enforced by Brawl3DGame, not here):
//   • Zero bots
//   • Starting loadout: pistol + bat + fists (all other ranged weapons
//     are marked spawnEmpty so the wheel renders them as empties until
//     the player walks over a pickup in the warehouse)

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { StreamingManager } from './streamManager.js';
import { sidewalkTex } from './arena3d.js';
import { cloneTexture as cloneAiTex, getTexture as getAiTex, subscribe as subscribeAiTex } from './aiTextures.js';
import { placeBakedLampGrid, addBakedLampFixture } from './bakedLights.js';

export const LOBBY_HALF = 28;        // 56×56 m interior

export function buildLobbyMap(scene) {
  const colliders = [];
  const H = LOBBY_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 4, unloadRadius: 5 });

  scene.fog = new THREE.Fog(0x161422, 30, 110);
  scene.background = new THREE.Color(0x0a0810);

  // ── Lighting ─────────────────────────────────────────────────────
  stream.addEssential(new THREE.HemisphereLight(0xbbaadd, 0x33282a, 1.3));
  stream.addEssential(new THREE.AmbientLight(0x666080, 0.7));
  // Two warm spotlights mimicking skylights overhead.
  const skyA = new THREE.DirectionalLight(0xffd380, 1.6);
  skyA.position.set(8, 14, -6); stream.addEssential(skyA);
  const skyB = new THREE.DirectionalLight(0xffb060, 1.0);
  skyB.position.set(-10, 14, 8); stream.addEssential(skyB);

  // iter192 baked lighting — warehouse skylight rig + neon accents.
  // 4 pale-blue skylight cones down the middle of the roof, plus a
  // pair of magenta/cyan neon lamps at opposite corners so the
  // interior reads like a proper hangout warehouse instead of a flat
  // ambient-only box.
  placeBakedLampGrid(stream, {
    half: H, kind: 'warehouse_skylight',
    step: 14, inset: 8, essential: true,
  });
  stream.addEssential(addBakedLampFixture(-H + 6,  H - 6, 'neon_magenta'));
  stream.addEssential(addBakedLampFixture( H - 6, -H + 6, 'neon_cyan'));

  // ── Floor (warehouse concrete) ──────────────────────────────────
  const floorMat = (() => {
    const ai = cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(8, 8); return pbr.stone({ map: ai }); }
    return pbr.stone({ color: 0x393843 });
  })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  stream.addEssential(floor);
  subscribeAiTex(() => {
    const ai = cloneAiTex('warehouse_concrete_floor');
    if (ai) { ai.repeat.set(8, 8); floor.material.map = ai; floor.material.needsUpdate = true; }
  });

  // ── Perimeter walls (corrugated metal) ──────────────────────────
  const wallH = 7.0;
  const wallT = 0.6;
  const wallMat = (() => {
    const ai = cloneAiTex('rusty_metal_panel');
    if (ai) { ai.repeat.set(8, 2); return pbr.metal({ map: ai, roughness: 0.7, metalness: 0.45 }); }
    return pbr.building({ color: 0x4a3a2c });
  })();
  function pushWall(x, z, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2, z);
    stream.addEssential(m);
    // Perimeter walls are NEVER climbable — they're the play-area bounds.
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h: wallH, climbable: false });
  }
  pushWall(0,  H, H * 2 + wallT, wallT);     // north
  pushWall(0, -H, H * 2 + wallT, wallT);     // south
  pushWall( H, 0, wallT, H * 2 + wallT);     // east
  pushWall(-H, 0, wallT, H * 2 + wallT);     // west

  // ── Ceiling beams (visual only) ─────────────────────────────────
  const beamMat = pbr.metal({ color: 0x2a2730, roughness: 0.6 });
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(H * 2, 0.3, 0.3), beamMat);
    beam.position.set(0, wallH - 0.4, i * 9);
    stream.addEssential(beam);
  }

  // ── Crate stacks (climbable cover) ─────────────────────────────
  const crateMat = pbr.wood({
    color: 0x8a6235,
    map: (() => { const t = sidewalkTex(); t.repeat.set(1, 1); return t; })(),
  });
  function stackCrates(cx, cz, tiers, perTier = 3) {
    for (let k = 0; k < tiers; k++) {
      for (let j = 0; j < perTier; j++) {
        const x = cx + (j - (perTier - 1) / 2) * 1.3;
        const z = cz + (Math.random() < 0.5 ? 0 : (k & 1 ? 0.4 : -0.4));
        const y = 0.6 + k * 1.25;
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
        c.position.set(x, y, z);
        stream.addStreamable(c, x, z);
        // Crates are CLIMBABLE — mantle by pressing X (jump) while
        // facing them. Stacks reach 4.6m (3 tiers × 1.25m + 0.6m base).
        // Tallest reachable from standing = 1.6m (top of tier-1);
        // jumping mid-air bumps reach to ~2.6m; eating a cheeseburger
        // (burgerBoost) extends another 1m for the third tier.
        colliders.push({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6, h: y + 0.6, climbable: true });
      }
    }
  }
  stackCrates( 10,  10, 3, 3);
  stackCrates(-12,  -8, 2, 4);
  stackCrates( -6,  12, 2, 3);
  stackCrates( 14,  -4, 3, 2);
  stackCrates(  4,  -14, 1, 5);

  // ── Catwalk along the north wall (jumpable from crate stack) ──
  const catwalkMat = pbr.metal({ color: 0x383230, roughness: 0.6 });
  const cw = new THREE.Mesh(new THREE.BoxGeometry(H * 1.8, 0.25, 2.5), catwalkMat);
  cw.position.set(0, 4.0, H - 1.6);
  stream.addEssential(cw);
  // Catwalk is climbable from the top of the tallest crate stack.
  colliders.push({ x0: -H * 0.9, z0: H - 2.85, x1: H * 0.9, z1: H - 0.35, h: 4.25, climbable: true });
  // Railing — visual, blocking
  const railMat = pbr.metal({ color: 0x222024, roughness: 0.45 });
  const railing = new THREE.Mesh(new THREE.BoxGeometry(H * 1.8, 1.0, 0.08), railMat);
  railing.position.set(0, 4.6, H - 2.8);
  stream.addEssential(railing);

  // ── Spawn points (4 corners offset from walls) ──────────────────
  const spawns = {
    A: [
      { x: -H + 6, z: -H + 6, yaw: Math.PI / 4 },
      { x:  H - 6, z: -H + 6, yaw: -Math.PI / 4 },
    ],
    B: [
      { x: -H + 6, z:  H - 6, yaw: Math.PI * 3 / 4 },
      { x:  H - 6, z:  H - 6, yaw: -Math.PI * 3 / 4 },
    ],
  };

  return { colliders, spawns, half: LOBBY_HALF, stream };
}

// Weapon pickup placements for the lobby — used by the game-mode
// initialiser to seed `engine.pickups`. Pistol/bat/fist are LOADOUT
// items (not pickups); everything else is scattered for grabs.
export function lobbyPickupSpawns() {
  return [
    { id: 'lobby_tec9_a',     wpn: 'tec9',     x:  10,  z:  -10, ammo: 50 },
    { id: 'lobby_tec9_b',     wpn: 'tec9',     x: -10,  z:   10, ammo: 50 },
    { id: 'lobby_shotgun_a',  wpn: 'shotgun',  x:  14,  z:    6, ammo:  8 },
    { id: 'lobby_shotgun_b',  wpn: 'shotgun',  x: -14,  z:   -6, ammo:  8 },
    { id: 'lobby_ak47_a',     wpn: 'ak47',     x:   0,  z:  -14, ammo: 30 },
    { id: 'lobby_ak47_b',     wpn: 'ak47',     x:   0,  z:   14, ammo: 30 },
    { id: 'lobby_pipe_a',     wpn: 'pipebomb', x:  18,  z:    0, ammo:  3 },
    { id: 'lobby_pipe_b',     wpn: 'pipebomb', x: -18,  z:    0, ammo:  3 },
  ];
}
