// mapCustom3d.js — runtime renderer for admin-authored custom maps.
//
// Consumes a plain-JSON map document (saved by MapEditor3D +
// persisted via /api/mapedit) and builds the exact same
// { colliders, spawns, half, stream, hillCandidates, weaponPickups }
// contract every other map factory exports. Because the contract
// matches, the effMap ternary in Brawl3DGame just needs a
// `startsWith('custom_')` branch — the rest of the engine (spawn
// pipeline, collision, KOTH hill picker, weapon-pickup wiring)
// works unchanged.
//
// Textures come from the existing AI-texture library (see
// aiTextures.js). Object types are box-only for Phase 1 (~90% of
// SR-arena geometry). Phase 2 will add cylinder / sphere / ramp /
// GLB prop overlays.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { StreamingManager } from './streamManager.js';
import { cloneTexture as cloneAiTex, subscribe as subscribeAiTex } from './aiTextures.js';
import { wedgeGeometry, hillGeometry } from './slopeGeo.js';
import { buildAtmosphericSky, buildSunDisc, positionCelestialBody } from './atmosphericSky.js';
import { addBakedLampFixture } from './bakedLights.js';
import { buildGrassPatch, updateGrassSway } from './grassPatch.js';
import {
  preloadRoadTiles, buildRoadTileInstancer, TILE_SIZE as ROAD_TILE_SIZE,
} from './roadTiles.js';
import { loadCollisionGrid } from './srCollisionGrid.js';
import { applySrPartOverrides, mergeSrChunkByMaterial, climbBoxesWorld } from './srParts.js';
import { createPbrMaterial, loadPbrLibrary } from './pbrLibrary.js';
import { atmosphereFromWorld, createPhysicalSky } from './physicalSky.js';
import { flattenToInstances, unitBox } from './render/instanceBatch.js';
import { inferSurface } from './render/surfaces.js';

// Session-local GLTFLoader — one instance is fine, it's stateless
// between parse() calls.
const _glbLoader = new GLTFLoader();

// Parse a data:model/gltf-binary base64 payload back into a THREE
// scene subtree. Returns a Promise so callers can await inside a
// map-load; the buildCustomMap synchronous path lets these settle
// AFTER return (StreamingManager collects them lazily as they land).
function _parseGlbUrl(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`GLB fetch ${r.status}`);
    return r.arrayBuffer();
  }).then((buf) => new Promise((resolve, reject) => {
    _glbLoader.parse(buf, '', (gltf) => resolve(gltf.scene || gltf.scenes[0]), (err) => reject(err));
  }));
}

function _parseGlbDataUri(dataUri) {
  return new Promise((resolve, reject) => {
    if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
      return reject(new Error('Not a data URI'));
    }
    const b64 = dataUri.split(',')[1];
    if (!b64) return reject(new Error('Empty base64 payload'));
    try {
      const bin = atob(b64);
      const buf = new ArrayBuffer(bin.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
      _glbLoader.parse(buf, '', (gltf) => resolve(gltf.scene || gltf.scenes[0]), (err) => reject(err));
    } catch (err) { reject(err); }
  });
}

export function buildCustomMap(scene, mapDoc) {
  const colliders = [];
  const stream = new StreamingManager({ scene, loadRadius: 6, unloadRadius: 10 });

  const world = mapDoc.world || {};
  const half  = Number.isFinite(mapDoc.half) ? mapDoc.half : 30;

  // ── Atmosphere / global lighting ────────────────────────────────
  // Physically based rig by default: Preetham sky → sun light derived
  // from its transmittance → HemisphereLight + fog from its radiance →
  // PMREM IBL (baked by the game shell once the renderer exists).
  // Legacy docs (flat sky colour) are auto-upgraded by atmosphereFromWorld;
  // only `world.atmosphere.model === 'legacy'` keeps the old hand-picked dome.
  const atmos = atmosphereFromWorld(world);
  let isNight = !!world.stars;
  if (atmos) {
    const rig = createPhysicalSky({ ...atmos, hdrFog: true }).attach(scene);
    const sh = Math.max(40, Math.min(140, half * 1.2));
    rig.sun.shadow.camera.left = -sh; rig.sun.shadow.camera.right = sh;
    rig.sun.shadow.camera.top = sh; rig.sun.shadow.camera.bottom = -sh;
    rig.sun.shadow.camera.far = sh * 4;
    rig.sun.shadow.radius = 3;
    scene.userData.physicalSky = rig;
    isNight = !rig.lighting.day;
  } else {
    const sky = world.sky || '#0e0a14';
    const bands = world.sky_bands;
    // If the doc carries a 3-band gradient (iter178 TIME-OF-DAY presets)
    // build the huge AAA sky dome. Otherwise fall back to the flat
    // background color for legacy templates.
    if (bands && (bands.horizon || bands.mid || bands.zenith)) {
      const dome = buildAtmosphericSky(bands, { radius: 3000, stars: !!world.stars });
      stream.addEssential(dome);
      scene.background = new THREE.Color(bands.mid || sky);
    } else {
      scene.background = new THREE.Color(sky);
    }
    const fog = world.fog || {};
    if (fog.color) {
      const near = Number.isFinite(fog.near) ? fog.near : 40;
      const far  = Number.isFinite(fog.far)  ? fog.far  : 130;
      scene.fog = new THREE.Fog(new THREE.Color(fog.color).getHex(), near, far);
    }

    // Ambient + hemisphere are always-on. iter168 AAA lighting —
    // warmer ambient tint, brighter hemispheric fill for softer
    // volumetric feel, and a directional key light with soft
    // shadows so exterior walls + interior slabs have a subtle
    // dawn/dusk gradient across their faces.
    const amb = world.ambient || {};
    stream.addEssential(new THREE.AmbientLight(new THREE.Color(amb.color || '#a89678'), amb.intensity ?? 0.55));

    const hemi = world.hemisphere || {};
    stream.addEssential(new THREE.HemisphereLight(
      new THREE.Color(hemi.sky_color    || '#ffd0a0'),   // warm dusk sky
      new THREE.Color(hemi.ground_color || '#2a1a24'),   // deep-purple bounce
      hemi.intensity ?? 1.15,
    ));

    const sun = world.sun || {};
    // Default the sun on when the map doc doesn't override — even a
    // low-intensity key light dramatically upgrades the visual over
    // a purely ambient scene.
    const sunI = sun.intensity ?? 1.35;
    isNight = !!world.stars || sunI < 0.5;
    if (sunI > 0) {
      const dir = new THREE.DirectionalLight(new THREE.Color(sun.color || '#ffe4b0'), sunI);
      // azimuth is horizontal (radians east from +Z), elevation is
      // vertical (radians above horizon). We place the light at 30 m
      // away so shadow frustums stay tight.
      const az = sun.azimuth   ?? (Math.PI * 0.35);
      const el = sun.elevation ?? (Math.PI * 0.28);   // low dusk angle
      const r = 40;
      dir.position.set(
        r * Math.cos(el) * Math.sin(az),
        r * Math.sin(el),
        r * Math.cos(el) * Math.cos(az),
      );
      dir.castShadow = !!sun.shadow;
      if (dir.castShadow) {
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.camera.left = -60; dir.shadow.camera.right = 60;
        dir.shadow.camera.top  =  60; dir.shadow.camera.bottom = -60;
        dir.shadow.camera.near = 1;   dir.shadow.camera.far    = 120;
        dir.shadow.bias = -0.0004;
        dir.shadow.radius = 3;   // softer shadow edges
      }
      stream.addEssential(dir);
      // AAA rim light — a low-intensity cool fill from the opposite
      // side softens the shadow side of every geometry so walls
      // don't read as pitch-black slabs. Casts no shadows for perf.
      const rim = new THREE.DirectionalLight(new THREE.Color('#7aa8ff'), 0.35);
      rim.position.set(-r * Math.cos(el) * Math.sin(az), r * Math.sin(el) * 0.5, -r * Math.cos(el) * Math.cos(az));
      stream.addEssential(rim);

      // Visible sun / moon disc on the sky dome so authors and
      // players see WHERE the light is coming from. NIGHT presets
      // (low sun intensity, stars on) render a cool-white moon.
      const isMoon = !!world.stars || sunI < 0.5;
      const discRadius = isMoon ? 30 : 55;
      const disc = buildSunDisc(sun.color || (isMoon ? '#e8ecff' : '#fff5c8'), {
        radius: discRadius, distance: 2100, isMoon,
      });
      positionCelestialBody(disc, { azimuth: az, elevation: el });
      stream.addEssential(disc);
    }

  }

  // ── User-authored point / directional lights ───────────────────
  for (const L of (mapDoc.lights || [])) {
    let light;
    if (L.type === 'directional') {
      light = new THREE.DirectionalLight(new THREE.Color(L.color || '#ffffff'), L.intensity ?? 1.0);
      light.position.set(L.x ?? 0, L.y ?? 8, L.z ?? 0);
    } else {
      // Default to point light — matches Phase 1 editor
      light = new THREE.PointLight(
        new THREE.Color(L.color || '#ffffff'),
        L.intensity ?? 1.5,
        L.radius ?? 20,
      );
      light.position.set(L.x ?? 0, L.y ?? 5, L.z ?? 0);
    }
    stream.addEssential(light);
  }

  // iter192 baked lighting — sprinkle a soft grid of streetlamps
  // around the arena border (opt-out via `world.baked_lighting=false`
  // for authors who want a purely dark night map). The 3-preset mix
  // (warm streetlamp + magenta / cyan neon accents) gives even a
  // blank slate map a distinct AAA night ambiance without the author
  // needing to hand-place lights.
  if (world.baked_lighting !== false) {
    const perimeterKind = 'streetlamp';
    const perimeterCount = 4;
    const bakedInset = 8;
    const perim = Math.max(12, half - bakedInset);
    for (let i = 0; i < perimeterCount; i++) {
      const t = -perim + (i + 0.5) * (perim * 2 / perimeterCount);
      stream.addEssential(addBakedLampFixture(t, -perim, perimeterKind));
      stream.addEssential(addBakedLampFixture(t,  perim, perimeterKind));
      stream.addEssential(addBakedLampFixture(-perim, t, perimeterKind));
      stream.addEssential(addBakedLampFixture( perim, t, perimeterKind));
    }
    if (isNight) {
      stream.addEssential(addBakedLampFixture(-perim + 4, -perim + 4, 'neon_magenta'));
      stream.addEssential(addBakedLampFixture( perim - 4,  perim - 4, 'neon_cyan'));
    }
  }

  // ── Ground plane (asphalt fallback so the arena has a floor
  // regardless of whether the author placed one). Custom maps that
  // want a unique floor can add a box object at y=0 to cover it. ──
  // PBR floor (world.floorPbr → library material, triplanar + parallax by
  // default) with the legacy asphalt texture as the no-material fallback.
  loadPbrLibrary();
  const floorPbr = mapDoc.world?.floorPbr;
  const groundMat = floorPbr?.materialId
    ? createPbrMaterial({ triplanar: 'on', ...floorPbr }, { w: half * 2, h: 0, d: half * 2 }, { color: floorPbr.tint || '#ffffff' })
    : (() => {
      const t = cloneAiTex('asphalt_road') || cloneAiTex('warehouse_concrete_floor');
      if (t) { t.repeat.set(10, 10); return new THREE.MeshStandardMaterial({ map: t, color: 0x2a2028 }); }
      return new THREE.MeshStandardMaterial({ color: 0x201820 });
    })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), groundMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  stream.addEssential(floor);
  if (!floorPbr?.materialId) subscribeAiTex(() => {
    const t = cloneAiTex('asphalt_road') || cloneAiTex('warehouse_concrete_floor');
    if (t) { t.repeat.set(10, 10); floor.material.map = t; floor.material.needsUpdate = true; }
  });

  // ── Objects — box primitives + GLB props. Every object drops a
  // collider IF its `collision` flag is on; climbable objects are
  // marked so the pointBoneAt / ledge system can hoist onto them. ─
  // Kick off the road-tile GLB preload upfront so any `road_tile`
  // objects can be dropped into their instancer as soon as they're
  // reached in the loop.
  preloadRoadTiles();
  // Lazy per-variant instancer cache — first `road_tile` of a given
  // kind builds its InstancedMesh, subsequent tiles just append
  // matrices onto the same batch. AAA perf: 40 straight-road tiles
  // ship as ONE draw call instead of 40.
  const roadInstancers = new Map();
  const _pendingRoadTiles = [];
  // Box primitives share ONE unit geometry (scaled per instance) and are
  // collapsed by material into InstancedMesh batches after the loop —
  // a 600-box generated block ships as a few dozen draw calls.
  const UNIT_BOX = unitBox();
  const boxMeshes = [];
  // Editor-tagged glass boxes → breakable panes (registered with the
  // DestructibleSystem by Brawl3DGame; collider dropped on shatter).
  const glassPanes = [];
  for (const o of (mapDoc.objects || [])) {
    // ── ROAD TILE (Meshy modular tile) ──────────────────────────
    // Grid-snap 8m × 8m road segments. Two shipping variants:
    //   • 'straight' — suburban straight road (default)
    //   • 'curve'    — 90° city road corner tile
    // Both use GPU InstancedMesh so a whole road network is ~2 draw
    // calls total. Also drops a thin walkable collider so bullets
    // don't sink through the mesh and bots track the surface.
    if (o.type === 'road_tile') {
      const kind = o.variant === 'curve' ? 'curve' : 'straight';
      const x = o.x ?? 0, y = o.y ?? 0, z = o.z ?? 0;
      const yaw = o.yaw ?? 0;
      // Per-axis scale — `w / TILE_SIZE` widens (X), `d / TILE_SIZE`
      // lengthens (Z). Authors can drag the transform gizmo's SCALE
      // mode along the red arrow (X) or the blue arrow (Z) to make
      // wide highways or long straightaways.
      const baseW = o.w ?? ROAD_TILE_SIZE;
      const baseD = o.d ?? ROAD_TILE_SIZE;
      const scaleX = baseW / ROAD_TILE_SIZE;
      const scaleZ = baseD / ROAD_TILE_SIZE;
      _pendingRoadTiles.push({ kind, x, y, z, yaw, scaleX, scaleZ, o });
      if (o.collision !== false) {
        // Colliders — the STRAIGHT variant has raised curbside
        // sidewalks running down BOTH sides of the tile. Split the
        // footprint into 3 axis-aligned strips so the player's feet
        // sit at 0.18m on the asphalt lane but climb to 0.35m when
        // they step onto a curb.
        //
        // Sidewalks are always on the LONG axis edges. Since road
        // tiles snap to 90° yaw, the long axis is always aligned
        // with world +X or +Z — we branch on the yaw quadrant.
        const scaleY = (scaleX + scaleZ) * 0.5;
        const asphaltH = 0.18 * scaleY;
        const curbH = 0.35 * scaleY;
        // Sidewalk lane width — 1.5m each side of an 8m tile is
        // typical for a suburban street.
        const SIDEWALK_LANE = 1.5;
        const yawQuad = Math.abs(Math.round(yaw / (Math.PI * 0.5)) % 2);
        if (kind === 'straight') {
          if (yawQuad === 0) {
            // Long axis along Z. Curbs on ±X sides of the tile.
            const halfX = baseW * 0.5;
            const halfZ = baseD * 0.5;
            const sw = SIDEWALK_LANE * scaleX;
            // Left curb (−X side).
            colliders.push({
              x0: x - halfX, x1: x - halfX + sw, z0: z - halfZ, z1: z + halfZ,
              h: y + curbH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
            // Right curb (+X side).
            colliders.push({
              x0: x + halfX - sw, x1: x + halfX, z0: z - halfZ, z1: z + halfZ,
              h: y + curbH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
            // Center asphalt lane.
            colliders.push({
              x0: x - halfX + sw, x1: x + halfX - sw, z0: z - halfZ, z1: z + halfZ,
              h: y + asphaltH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
          } else {
            // Long axis along X. Curbs on ±Z sides of the tile.
            const halfX = baseW * 0.5;
            const halfZ = baseD * 0.5;
            const sw = SIDEWALK_LANE * scaleZ;
            colliders.push({
              x0: x - halfX, x1: x + halfX, z0: z - halfZ, z1: z - halfZ + sw,
              h: y + curbH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
            colliders.push({
              x0: x - halfX, x1: x + halfX, z0: z + halfZ - sw, z1: z + halfZ,
              h: y + curbH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
            colliders.push({
              x0: x - halfX, x1: x + halfX, z0: z - halfZ + sw, z1: z + halfZ - sw,
              h: y + asphaltH, yBase: y, step: true, no_bullet: true, climbable: false,
            });
          }
        } else {
          // Curve tile — sidewalks follow an arc; approximating with
          // 3 strips gives a bad silhouette. Just use a single flat
          // collider at asphalt height — good enough for cornering
          // vehicles + walking players.
          const halfX = baseW * 0.5;
          const halfZ = baseD * 0.5;
          colliders.push({
            x0: x - halfX, x1: x + halfX,
            z0: z - halfZ, z1: z + halfZ,
            h: y + asphaltH,
            yBase: y,
            step: true, no_bullet: true, climbable: false,
          });
        }
      }
      continue;
    }

    // GLB prop — the map document carries the inlined base64 GLB
    // payload as `o.glbData` (data: URI). Parse into a subtree and
    // mount at the object's transform. Collider becomes an AABB
    // computed from the loaded scene's bounding box, tinted by the
    // author's `w/h/d` if they preferred a custom hitbox over the
    // model's own extents.
    if (o.type === 'glb' && (o.glbData || o.glbUrl)) {
      const anchor = new THREE.Group();
      anchor.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
      anchor.rotation.y = o.yaw ?? 0;
      const scaleVec = [o.sx, o.sy, o.sz].map(v => Number.isFinite(v) && v > 0 ? v : 1);
      anchor.scale.set(scaleVec[0], scaleVec[1], scaleVec[2]);
      stream.addEssential(anchor);
      (o.glbData ? _parseGlbDataUri(o.glbData) : _parseGlbUrl(o.glbUrl))
        .then((sub) => {
          // Imported SR chunk — apply the author's per-part edits
          // (moved / resized / removed parts), then merge the surviving
          // parts by material so a 500-part chunk is ~60 draw calls.
          if (o.templateId) {
            applySrPartOverrides(sub, o.srParts, { detachRemoved: true });
            sub = mergeSrChunkByMaterial(sub);
          }
          sub.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = true; } });
          anchor.add(sub);
        })
        .catch((err) => {
          if (typeof console !== 'undefined') console.warn('[mapCustom3d] glb parse failed:', err);
        });
      // Climbable SR parts — mantle-able box colliders from the bake.
      if (Array.isArray(o.colClimb) && o.colClimb.length) {
        for (const c of climbBoxesWorld(o.colClimb, o)) colliders.push(c);
      }
      // Imported SR chunk — real-geometry collision baked by headless
      // Blender. Lands in the collider list once the blob streams in;
      // the engine reads the same array reference every frame.
      if (o.colUrl) {
        loadCollisionGrid(o.colUrl)
          .then((grid) => {
            grid.setTransform(o.x ?? 0, o.y ?? 0, o.z ?? 0, o.yaw ?? 0, scaleVec[0], scaleVec[1]);
            colliders.push({ grid, x0: 0, x1: 0, z0: 0, z1: 0, h: 0, yBase: 0, sr_chunk: o.id });
          })
          .catch((err) => {
            if (typeof console !== 'undefined') console.warn('[mapCustom3d] collision grid failed:', err);
          });
      }
      if (o.collision !== false && !o.colUrl) {
        const w = Math.max(0.02, o.w ?? 2), h = Math.max(0.02, o.h ?? 2), d = Math.max(0.02, o.d ?? 2);
        const x = o.x ?? 0, y = o.y ?? h / 2, z = o.z ?? 0;
        const yaw = o.yaw ?? 0;
        const cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw));
        const wOBB = w * cos + d * sin, dOBB = w * sin + d * cos;
        // Collider convention matches every other map builder
        // (arena3d.js, mapKothHouse3d.js, etc.):
        //   c.h     = WORLD TOP Y   (box y-center + boxHeight/2)
        //   c.yBase = WORLD BOTTOM Y (box y-center − boxHeight/2)
        // The old code stored `h = boxHeight` and `y = bottomY`,
        // which made every elevated box look like a ground-level
        // pancake to `collideXZ`/`topAt`. Stair steps on floor 2
        // then teleported the player back to Y=0.22 mid-sprint
        // (iter154 walkability bug root cause).
        colliders.push({
          x0: x - wOBB / 2, z0: z - dOBB / 2,
          x1: x + wOBB / 2, z1: z + dOBB / 2,
          h: y + h / 2,
          yBase: y - h / 2,
          climbable: !!o.climbable,
          ...(inferSurface(o) ? { mat: inferSurface(o) } : {}),
        });
      }
      continue;
    }

    // ── HILL PATCH (radial smoothstep mound) ────────────────────
    // A subdivided plane deformed into a soft dome + a radial slope
    // collider whose smoothstep profile matches the mesh vertex
    // heights bit-for-bit. Origin is the base centre; peak height
    // + radius come straight from the object spec.
    if (o.type === 'hill') {
      const radius = Math.max(0.5, o.radius ?? 5);
      const peak = Math.max(0.05, o.peak ?? 1.5);
      const cx = o.x ?? 0, cz = o.z ?? 0, base = o.y ?? 0;
      const mat = o.pbr?.materialId
        ? createPbrMaterial(o.pbr, { w: radius * 2, h: peak, d: radius * 2 }, { color: o.pbr.tint || '#ffffff' })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color || '#6a8f4a') });
      if (o.texture && !o.pbr?.materialId) {
        const t = cloneAiTex(o.texture);
        if (t) { t.repeat.set(Math.max(2, Math.round(radius)), Math.max(2, Math.round(radius))); mat.map = t; }
      }
      const mesh = new THREE.Mesh(hillGeometry(radius, peak, 32), mat);
      mesh.position.set(cx, base, cz);
      mesh.receiveShadow = true;
      stream.addEssential(mesh);
      if (o.collision !== false) {
        colliders.push({
          x0: cx - radius, z0: cz - radius,
          x1: cx + radius, z1: cz + radius,
          h: base + peak,
          yBase: base,
          slope: { yStart: base + peak, yEnd: base, axis: 'r' },
          climbable: !!o.climbable,
          ...(inferSurface(o) ? { mat: inferSurface(o) } : {}),
        });
      }
      continue;
    }

    // ── RAMP (wedge with a tilted top face) ─────────────────────
    // Straight ramp between two elevation levels. `slope_axis`
    // selects whether the tilt runs along the LOCAL X or Z of the
    // ramp box (before yaw rotation). Mesh sits with its base at
    // `o.y` — pass y=0 to plant the ramp on the ground plane.
    //
    // World-axis resolution mirrors the slope-box path above so
    // yawed ramps (rotated by 90° in the editor) still produce a
    // collider whose interpolation direction matches the mesh.
    if (o.type === 'ramp') {
      const w = Math.max(0.05, o.w ?? 4);
      const dd = Math.max(0.05, o.d ?? 2);
      const yStart = Math.max(0, o.y_start ?? 0);
      const yEnd = Math.max(0, o.y_end ?? 1);
      const localAxis = (o.slope_axis === 'z' ? 'z' : 'x');
      const cx = o.x ?? 0, cz = o.z ?? 0, base = o.y ?? 0;
      const yaw = o.yaw ?? 0;
      const mat = o.pbr?.materialId
        ? createPbrMaterial(o.pbr, { w, h: Math.max(yStart, yEnd), d: dd }, { color: o.pbr.tint || '#ffffff' })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color || '#7a7a80') });
      if (o.texture && !o.pbr?.materialId) {
        const t = cloneAiTex(o.texture);
        if (t) {
          const rx = Math.max(1, Math.round(w / 2));
          const ry = Math.max(1, Math.round(dd / 2));
          t.repeat.set(rx, ry);
          mat.map = t;
        }
      }
      const mesh = new THREE.Mesh(wedgeGeometry(w, dd, yStart, yEnd, localAxis), mat);
      mesh.position.set(cx, base, cz);
      mesh.rotation.y = yaw;
      mesh.receiveShadow = true;
      stream.addEssential(mesh);
      if (o.collision !== false) {
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const cos = Math.abs(cosY), sin = Math.abs(sinY);
        const wOBB = w * cos + dd * sin;
        const dOBB = w * sin + dd * cos;
        // Yaw classification — is this ramp axis-aligned enough for
        // the world-axis resolver, or does it need the diagonal
        // yawed-slope interpolation (iter163)? Threshold is 8° off
        // an axis (cos of 8° ≈ 0.99); tighter than the previous
        // 45° silent fallback because axis-align math shrinks the
        // effective ramp footprint at any non-cardinal yaw.
        const AXIS_ALIGN_COS = 0.99;
        const isAxisAligned = cos > AXIS_ALIGN_COS || sin > AXIS_ALIGN_COS;
        // World-axis resolution for axis-aligned yaws.
        let worldAxis, flip;
        if (localAxis === 'x') {
          if (cos > sin) { worldAxis = 'x'; flip = cosY < 0; }
          else           { worldAxis = 'z'; flip = sinY < 0; }
        } else {
          if (sin > cos) { worldAxis = 'x'; flip = -sinY < 0; }
          else           { worldAxis = 'z'; flip = cosY < 0; }
        }
        const slopeYS = flip ? yEnd : yStart;
        const slopeYE = flip ? yStart : yEnd;
        // Diagonal ramps carry the yaw + local-frame half-span so
        // engine3d.topAt / collideXZ can rotate the sample point
        // into local space before interpolating. For axis-aligned
        // ramps we skip the yaw metadata so the fast axis-aligned
        // sampler path runs.
        const slope = isAxisAligned
          ? { yStart: base + slopeYS, yEnd: base + slopeYE, axis: worldAxis }
          : {
              yStart: base + yStart, yEnd: base + yEnd,
              axis: localAxis,
              yaw, cx, cz,
              localHalf: (localAxis === 'x' ? w : dd) / 2,
            };
        colliders.push({
          x0: cx - wOBB / 2, z0: cz - dOBB / 2,
          x1: cx + wOBB / 2, z1: cz + dOBB / 2,
          h: base + Math.max(yStart, yEnd),
          yBase: base,
          slope,
          climbable: !!o.climbable,
          ...(inferSurface(o) ? { mat: inferSurface(o) } : {}),
        });
      }
      continue;
    }
    // Box primitive (default)
    const w = Math.max(0.02, o.w ?? 1);
    const h = Math.max(0.02, o.h ?? 1);
    const d = Math.max(0.02, o.d ?? 1);
    const x = o.x ?? 0, y = o.y ?? h / 2, z = o.z ?? 0;
    const yaw = o.yaw ?? 0;
    // Slope box: the object requested a wedge collider on a
    // regular-looking box. Same visual geometry as the collider so
    // players can trust their footing.
    //
    // Frame convention (iter159):
    //   • `o.slope` gives yStart / yEnd / axis in LOCAL box space —
    //     `axis` is the wedge's LOCAL tilt direction ('x' or 'z'
    //     before yaw), yStart / yEnd are the heights at the LOW /
    //     HIGH ends of that local axis relative to the box's
    //     BOTTOM face (i.e. add `y - h/2` to get the world Y).
    //   • The COLLIDER stores yStart / yEnd / axis in WORLD space
    //     (`c.x0 → c.x1` for axis='x', `c.z0 → c.z1` for axis='z')
    //     because that's what engine3d's `topAt` interpolates over.
    //   • For yawed boxes we resolve the world axis from the box's
    //     yaw and flip yStart/yEnd if local +X points toward the
    //     world axis LOW side. Restricted to axis-aligned yaws
    //     (0 / ±π/2 / π within ~15°) — non-aligned yaws would need
    //     an OBB→AABB expansion that shrinks the effective slope
    //     footprint and can't be handled precisely by an
    //     axis-aligned collider.
    if (o.slope) {
      const yS = Math.max(0, o.slope.yStart ?? 0);
      const yE = Math.max(0, o.slope.yEnd ?? h);
      const localAxis = (o.slope.axis === 'z' ? 'z' : 'x');
      const base = y - h / 2;
      // Phantom collision slope (iter161) — buildingGen emits these
      // under each stair run so competitive traversal reads as a
      // smooth incline via the engine's slope-collider `topAt`
      // sampler. Skip the visible mesh; the visible step boxes are
      // emitted separately by the same buildingGen pass and stay
      // on-screen. `o.collision` still applies (defaults to true).
      if (!o.no_render) {
        const mat = o.pbr?.materialId
          ? createPbrMaterial(o.pbr, { w, h: Math.max(yS, yE), d }, { color: o.pbr.tint || '#ffffff' })
          : new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color || '#888888') });
        if (o.texture && !o.pbr?.materialId) {
          const t = cloneAiTex(o.texture);
          if (t) {
            const rx = Math.max(1, Math.round(w / 2));
            const ry = Math.max(1, Math.round(d / 2));
            t.repeat.set(rx, ry);
            mat.map = t;
          }
        }
        const mesh = new THREE.Mesh(wedgeGeometry(w, d, yS, yE, localAxis), mat);
        mesh.position.set(x, base, z);
        mesh.rotation.y = yaw;
        mesh.receiveShadow = true;
        stream.addEssential(mesh);
      }
      if (o.collision !== false) {
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const cos = Math.abs(cosY), sin = Math.abs(sinY);
        const wOBB = w * cos + d * sin;
        const dOBB = w * sin + d * cos;
        // iter163 diagonal-slope support — see the RAMP resolver
        // above for the full rationale on axis-align classification.
        const AXIS_ALIGN_COS = 0.99;
        const isAxisAligned = cos > AXIS_ALIGN_COS || sin > AXIS_ALIGN_COS;
        // Resolve world axis + flip (see full explanation above).
        let worldAxis, flip;
        if (localAxis === 'x') {
          if (cos > sin) { worldAxis = 'x'; flip = cosY < 0; }
          else           { worldAxis = 'z'; flip = sinY < 0; }
        } else {
          if (sin > cos) { worldAxis = 'x'; flip = -sinY < 0; }
          else           { worldAxis = 'z'; flip = cosY < 0; }
        }
        const slopeYS = flip ? yE : yS;
        const slopeYE = flip ? yS : yE;
        const slope = isAxisAligned
          ? { yStart: base + slopeYS, yEnd: base + slopeYE, axis: worldAxis }
          : {
              yStart: base + yS, yEnd: base + yE,
              axis: localAxis,
              yaw, cx: x, cz: z,
              localHalf: (localAxis === 'x' ? w : d) / 2,
            };
        colliders.push({
          x0: x - wOBB / 2, z0: z - dOBB / 2,
          x1: x + wOBB / 2, z1: z + dOBB / 2,
          h: base + Math.max(yS, yE),
          yBase: base,
          slope,
          climbable: !!o.climbable,
          no_bullet: !!o.no_bullet,
          ...(inferSurface(o) ? { mat: inferSurface(o) } : {}),
        });
      }
      continue;
    }
    // Material: pick an AI texture if the author chose one, else a
    // solid color. Missing textures degrade gracefully to color.
    // iter168 AAA glass — when `o.is_glass` is set (window pane
    // emitted by buildingGen), swap in a MeshPhysicalMaterial with
    // real transmission + low roughness so the pane reads as
    // actual glass instead of a flat tinted box.
    let mat;
    if (o.is_glass) {
      // Reflective transparent glass. NO `transmission`: a single
      // transmissive material makes three.js render the whole opaque
      // scene a second time every frame (the transmission buffer) —
      // generated blocks with hundreds of panes halved the frame rate.
      mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(o.color || '#a8c4e2'),
        metalness: 0.0,
        roughness: 0.08,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.4,
        depthWrite: false,
      });
    } else if (o.pbr?.materialId) {
      mat = createPbrMaterial(o.pbr, { w, h, d }, { color: o.pbr.tint || '#ffffff', transparent: !!o.transparent, opacity: o.opacity ?? 1 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color || '#888888') });
      if (o.texture) {
        const t = cloneAiTex(o.texture);
        if (t) {
          const rx = Math.max(1, Math.round(w / 2));
          const ry = Math.max(1, Math.round(Math.max(h, d) / 2));
          t.repeat.set(rx, ry);
          mat.map = t;
        }
      }
    }
    const mesh = new THREE.Mesh(UNIT_BOX, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.scale.set(w, h, d);
    mesh.receiveShadow = true;
    const surf = inferSurface(o);
    // Editor-tagged glass boxes are BREAKABLE panes: kept as a single
    // mesh (not instanced) so the brawl can hide it, with a collider the
    // engine drops when the pane shatters. Inferred glass (generated
    // blocks' `is_glass` windows) stays batched — shards + tink on hit only.
    const breakable = o.surface === 'glass' && o.collision !== false;
    if (breakable) { mesh.userData.noBatch = true; stream.addEssential(mesh); }
    else boxMeshes.push(mesh);

    if (o.collision !== false) {
      // Axis-aligned collider derived from position + size + yaw.
      // Yaw != 0 is approximated by an OBB → AABB fit (widens the
      // bbox); good enough for the arcade collision layer.
      const cos = Math.abs(Math.cos(yaw));
      const sin = Math.abs(Math.sin(yaw));
      const wOBB = w * cos + d * sin;
      const dOBB = w * sin + d * cos;
      // See note above — c.h is WORLD TOP, c.yBase is WORLD BOTTOM.
      const collider = {
        x0: x - wOBB / 2, z0: z - dOBB / 2,
        x1: x + wOBB / 2, z1: z + dOBB / 2,
        h: y + h / 2,
        yBase: y - h / 2,
        climbable: !!o.climbable,
        ...(surf ? { mat: surf } : {}),
      };
      colliders.push(collider);
      if (breakable) {
        glassPanes.push({ mesh, collider, x, y: y - h / 2, z, aabb: { x: wOBB / 2, y: h / 2, z: dOBB / 2 }, hp: Math.round(12 + Math.min(60, w * h * 3)) });
      }
    }
  }

  // Collapse the box primitives into instanced batches (one per
  // material signature). Singles keep their own mesh.
  {
    const { instanced, singles } = flattenToInstances(boxMeshes);
    for (const m of instanced) stream.addEssential(m);
    for (const m of singles) stream.addEssential(m);
  }

  // ── AAA Grass patches — instanced blades on the ground plane ───
  // Each patch renders a big InstancedMesh (12k+ blades per 20×20 m
  // patch at density 30) and wires a per-frame sway. The runtime
  // caller (Brawl3DGame's RAF loop) is expected to call
  // `updateGrassSway(patch, tSec)` for each patch each frame; we
  // stash the meshes on `stream` for that purpose. Blades are NOT
  // colliders — they're a purely visual overlay.
  const grassMeshes = [];
  for (const g of (mapDoc.grass_patches || [])) {
    const mesh = buildGrassPatch(g);
    stream.addEssential(mesh);
    grassMeshes.push(mesh);
  }

  // ── Resolve deferred road-tile placements once the GLBs stream ─
  // Every road_tile object queued during the object loop lands
  // here as a matrix in the corresponding InstancedMesh. Loops
  // through the pending queue after preload resolves so we build
  // exactly ONE InstancedMesh per variant even for large maps.
  preloadRoadTiles().then(() => {
    for (const pt of _pendingRoadTiles) {
      let inst = roadInstancers.get(pt.kind);
      if (!inst) {
        inst = buildRoadTileInstancer(scene, pt.kind);
        if (!inst) continue;          // GLB failed to load
        roadInstancers.set(pt.kind, inst);
      }
      inst.add(pt.x, pt.y, pt.z, pt.yaw, pt.scaleX ?? 1, pt.scaleZ ?? pt.scaleX ?? 1);
    }
  }).catch((err) => {
    if (typeof console !== 'undefined') console.warn('[mapCustom3d] road tiles failed to preload', err);
  });

  // ── Spawns / hills / weapons — pass-through from the doc ───────
  const spawns = {
    A: Array.isArray(mapDoc.spawns?.A) ? mapDoc.spawns.A.map(s => ({ x: s.x ?? 0, z: s.z ?? 0, yaw: s.yaw ?? 0, ...(Number.isFinite(s.y) ? { y: s.y } : {}) })) : [{ x: 0, z: -half + 3, yaw: 0 }],
    B: Array.isArray(mapDoc.spawns?.B) ? mapDoc.spawns.B.map(s => ({ x: s.x ?? 0, z: s.z ?? 0, yaw: s.yaw ?? Math.PI, ...(Number.isFinite(s.y) ? { y: s.y } : {}) })) : [{ x: 0, z: half - 3, yaw: Math.PI }],
  };

  const hillCandidates = (mapDoc.hill_candidates || []).map(hc => ({
    id:     hc.id     || 'center',
    x:      hc.x      ?? 0,
    z:      hc.z      ?? 0,
    radius: hc.radius ?? 5,
    y:      hc.y      ?? 0,
    label:  hc.label  || 'CENTER',
  }));

  const weaponPickups = (mapDoc.weapon_pickups || []).map(w => ({
    wpn:  w.wpn  || 'pistol',
    x:    w.x    ?? 0,
    z:    w.z    ?? 0,
    ammo: w.ammo ?? 24,
    ...(Number.isFinite(w.y) ? { y: w.y } : {}),
  }));

  return { colliders, spawns, half, stream, hillCandidates, weaponPickups, grassMeshes, glassPanes };
}
