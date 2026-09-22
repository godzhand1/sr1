// Blender → game importer.
//
// Companion to `sceneExport.js`. Opens a file picker, loads the
// selected `.glb`, adds it to the running scene, and derives fresh
// AABB colliders from the imported mesh so the player can walk
// against the new geometry immediately — no code changes, no
// server upload, no reload.
//
// COLLISION DERIVATION uses a rotation- and translation-invariant
// voxel occupancy sampler (see `deriveColliders` below). Vertices
// at wall height (0.6m ≤ y ≤ 3.5m) are bucketed into a 2D XZ grid
// at 0.5m resolution; each occupied bin becomes a piece of an AABB
// strip via a greedy X-run merge. Works for garage geometry
// rotated any way, moved anywhere, and props (vending machines,
// sidewalks) get their own colliders automatically.
//
// COLLISION SOURCE: markers AND auto-derive, always both, merged —
// not either/or. Earlier this was "use markers if any exist,
// otherwise auto-derive", which silently drops collision for any
// structural geometry added or edited in Blender that doesn't have
// an explicit COL_* marker on it: the moment ANY marker exists, the
// whole auto-derive branch was skipped, so anything new sitting
// alongside old markers got zero collision. Now both always run —
// markers give precise author-placed boxes for what they cover
// (extractColliderMarkers already removes marker meshes from the
// tree before deriveColliders runs, so there's no double-counting
// from the marker geometry itself), and voxel auto-derive picks up
// everything else, including anything new added without a marker.
// The only cost is some harmless redundant collider overlap where a
// marker's own footprint gets re-covered by an auto-derived box too
// — functionally a no-op, just a couple of extra AABBs.
//
// SCOPE:
//  • The imported mesh REPLACES the original built-in map's
//    STRUCTURAL geometry (garage, ground, roads, sidewalks, fences,
//    barriers) and clears `engine.colliders` in place, so the player
//    doesn't stack against the old walls.
//  • LIGHTING: the sun and its warm/cool bounce fills (all
//    THREE.DirectionalLight) are REMOVED on import — an imported
//    scene shouldn't have a leftover real-time sun casting shadows
//    across geometry it doesn't know about. Hemisphere/ambient sky
//    fill, the interior point light, the sky dome, and clouds are
//    all PRESERVED, so the scene keeps its sky and doesn't go pitch
//    black — it just loses direct directional lighting until the
//    imported GLB's own baked lighting (if any) or a future map
//    rebuild supplies it again.
//  • Prior imports (from earlier in the same session) are also
//    purged so re-importing doesn't stack multiple GLBs.
//  • The imported mesh does NOT re-derive spawn points or pickups —
//    those still come from `arena.spawns` set at map build.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// New dependency: `npm install meshoptimizer`. WASM-based edge-
// collapse simplifier — fast enough to run synchronously-ish in the
// browser on import. Deliberately NOT using three.js's own
// SimplifyModifier (three/examples/jsm/modifiers/SimplifyModifier.js)
// for this — its own source code flags its core edge-cost search as
// an unoptimized O(n²) scan, which on a heavy imported mesh wouldn't
// reduce lag, it would freeze the tab for a very long time while
// "fixing" it. meshoptimizer's simplifier is the same edge-collapse
// approach real asset pipelines use, at a speed that's actually
// viable to run live.
import { MeshoptSimplifier } from 'meshoptimizer';

// Compute the half-extent of the imported group's XZ bounding box —
// used to expand the engine's world clamp so the player can walk to
// the edges of a resized ground plane. Without this, the engine's
// `half` (line 253 of engine3d.js) keeps clamping the player inside
// the ORIGINAL garage's ~45m box, even if the imported ground is
// 200m wide. Returns null if the group has no finite geometry.
function computeWorldHalf(group) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let minX = +Infinity, maxX = -Infinity, minZ = +Infinity, maxZ = -Infinity;
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const arr = pos.array;
    const stride = pos.itemSize || 3;
    for (let i = 0; i < arr.length; i += stride) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      v.set(x, y, z).applyMatrix4(o.matrixWorld);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
  });
  if (!Number.isFinite(minX)) return null;
  // Take the largest absolute XZ extent; add 2m margin so the player
  // can stand right against the boundary without the -1m clamp
  // cutting into visible ground.
  return Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ)) + 2;
}

// Configuration for the rotation-agnostic voxel occupancy sampler.
// Old X-strip mode-Z algorithm was tuned for the built-in garage's
// axis-aligned orientation (walls along X, split at Z=0). When the
// user rotates the garage in Blender — even by 90° or 180° — that
// approach produces nonsense colliders (wrong side, missing walls,
// stripes across doorways). The new voxel grid works for ANY yaw
// and any position because it doesn't care about "front" vs "back".
const VX_BIN = 0.5;           // world-space bin size (X and Z)
const VX_WALL_Y_LO = 0.6;     // sample verts from this Y (skips floor)
const VX_WALL_Y_HI = 3.5;     // …up to this Y (skips roof + sky verts)
const VX_MIN_VERTS = 3;       // min verts in a bin to mark it as wall
const VX_COLLIDER_H = 6.0;    // AABB height — tall enough that the
                              // player can't jump over any imported
                              // wall (max jump height is ~2m)

// Derive collision AABBs from an imported group's live scaled
// geometry using a rotation- and translation-invariant voxel
// sampler. Steps:
//   1. Walk every mesh vertex in world space; bucket wall-height
//      verts into a 2D XZ grid at VX_BIN resolution.
//   2. Mark each bin "occupied" if it has ≥ VX_MIN_VERTS.
//   3. Greedy row-merge: for each Z row, sweep X and coalesce
//      consecutive occupied bins into a single AABB collider.
//      This drops collider count 10–30× vs one-per-bin without
//      losing accuracy (doorways cause a gap in the run, so the
//      opening stays walkable).
//
// Works for ANY yaw/position of the imported geometry — the user
// can rotate the garage 360°, move it across the street, add
// props, and the derived colliders still line up with the visible
// mesh.
//
// Returns collider descriptors { x0, x1, z0, z1, h, climbable,
// imported } ready to push into `engine.colliders`.
function deriveColliders(group) {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();

  // Pass 1 — RAW envelope (all verts, no Y filter). The grid must
  // cover every wall-height vert; using a Y-filtered bbox risks
  // clipping off overhang colliders and off-center props.
  let minX = +Infinity, maxX = -Infinity, minZ = +Infinity, maxZ = -Infinity;
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const arr = pos.array;
    const stride = pos.itemSize || 3;
    for (let i = 0; i < arr.length; i += stride) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      v.set(x, y, z).applyMatrix4(o.matrixWorld);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
  });
  if (!Number.isFinite(minX)) return [];

  const nX = Math.max(1, Math.ceil((maxX - minX) / VX_BIN));
  const nZ = Math.max(1, Math.ceil((maxZ - minZ) / VX_BIN));
  // Guard against absurdly-large imports blowing memory. 400×400
  // grid at 0.5m = 200m×200m — plenty for a city block map.
  if (nX * nZ > 400 * 400) return [];
  const grid = new Uint32Array(nX * nZ);

  // Pass 2 — bucket wall-height verts. Position values already
  // computed above but not stored; walk again for locality.
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const arr = pos.array;
    const stride = pos.itemSize || 3;
    for (let i = 0; i < arr.length; i += stride) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      v.set(x, y, z).applyMatrix4(o.matrixWorld);
      if (v.y < VX_WALL_Y_LO || v.y > VX_WALL_Y_HI) continue;
      const ix = Math.floor((v.x - minX) / VX_BIN);
      const iz = Math.floor((v.z - minZ) / VX_BIN);
      if (ix < 0 || ix >= nX || iz < 0 || iz >= nZ) continue;
      grid[iz * nX + ix]++;
    }
  });

  // Pass 3 — greedy row merge into AABB strips.
  const out = [];
  for (let iz = 0; iz < nZ; iz++) {
    let runStart = -1;
    for (let ix = 0; ix < nX; ix++) {
      const occupied = grid[iz * nX + ix] >= VX_MIN_VERTS;
      if (occupied) {
        if (runStart < 0) runStart = ix;
      } else if (runStart >= 0) {
        out.push({
          x0: minX + runStart * VX_BIN,
          x1: minX + ix * VX_BIN,
          z0: minZ + iz * VX_BIN,
          z1: minZ + (iz + 1) * VX_BIN,
          h: VX_COLLIDER_H,
          climbable: false,
          imported: true,
        });
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      out.push({
        x0: minX + runStart * VX_BIN,
        x1: minX + nX * VX_BIN,
        z0: minZ + iz * VX_BIN,
        z1: minZ + (iz + 1) * VX_BIN,
        h: VX_COLLIDER_H,
        climbable: false,
        imported: true,
      });
    }
  }
  return out;
}

// Filter out meshes that would break the game — NaN geometry,
// skinned rigs from an accidentally-included player export, etc.
// Also enables castShadow / receiveShadow to match the built-in
// garage's shading behavior.
function sanitizeImportedGroup(root) {
  const toRemove = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) { toRemove.push(o); return; }
    if (o.isMesh && o.geometry?.attributes?.position) {
      const arr = o.geometry.attributes.position.array;
      const step = arr.length > 500000 ? 1000 : 1;
      for (let i = 0; i < arr.length; i += step) {
        if (!Number.isFinite(arr[i])) { toRemove.push(o); return; }
      }
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  for (const o of toRemove) {
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose?.();
  }
  return toRemove.length;
}

// Extract explicit collision markers baked into the imported GLB by
// the exporter. A marker is any mesh whose name starts with `COL_`
// or which carries `userData.__collision === true`. Each marker's
// world-space bounding box becomes an AABB collider — Blender-side
// rotations get axis-aligned automatically (fine, the engine's
// collision is AABB anyway).
//
// Markers are REMOVED from the visible scene tree so they don't
// render as red translucent boxes in-game — they exist only to
// travel between Blender and the game as authoring metadata.
//
// userData.h / .yBase / .climbable / .barrier / .step / .yaw are
// respected if the exporter (or the Blender user) attached them,
// so a perfect round-trip preserves jersey-barrier cover metadata
// and floating-platform semantics. NOTE: Blender's glTF round-trip
// does not reliably preserve custom properties (userData/extras) —
// confirmed empirically on a real round-tripped file, 0 of 220
// nodes carried any extras even though 124 kept their COL_* names
// faithfully. The name-prefix match is what actually does the work
// in practice; treat userData survival as a bonus, not a guarantee.
function extractColliderMarkers(root) {
  const toRemove = [];
  const extracted = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const named = typeof o.name === 'string' && o.name.startsWith('COL_');
    const flagged = o.userData && o.userData.__collision === true;
    if (!named && !flagged) return;
    o.updateMatrixWorld(true);
    const b3 = new THREE.Box3().setFromObject(o);
    if (!Number.isFinite(b3.min.x) || !Number.isFinite(b3.max.x)) { toRemove.push(o); return; }
    const c = {
      x0: b3.min.x, x1: b3.max.x,
      z0: b3.min.z, z1: b3.max.z,
      h: o.userData?.h != null ? o.userData.h : (b3.max.y - Math.max(0, b3.min.y)),
      climbable: !!o.userData?.climbable,
      imported: true,
    };
    if (o.userData?.yBase != null) c.yBase = o.userData.yBase;
    else if (b3.min.y > 0.2) c.yBase = b3.min.y;
    if (o.userData?.barrier) c.barrier = true;
    if (o.userData?.step) c.step = true;
    if (o.userData?.yaw != null) c.yaw = o.userData.yaw;
    extracted.push(c);
    toRemove.push(o);
  });
  for (const o of toRemove) {
    if (o.parent) o.parent.remove(o);
    if (o.geometry) o.geometry.dispose?.();
    const mat = o.material;
    if (Array.isArray(mat)) for (const m of mat) m?.dispose?.();
    else mat?.dispose?.();
  }
  // If the exporter grouped markers under a `COLLISION` empty
  // (see sceneExport.spawnColliderMarkers), the empty is now
  // childless — remove it so an orphan node doesn't linger in the
  // imported scene tree. Blender may also rename it (e.g.
  // `COLLISION.001` on duplicate) so we match by userData flag too.
  const orphans = [];
  root.traverse((o) => {
    if (o.isMesh) return;
    const named = typeof o.name === 'string' && o.name.startsWith('COLLISION');
    const flagged = o.userData && o.userData.__collisionCollection === true;
    if ((named || flagged) && o.children.length === 0) orphans.push(o);
  });
  for (const o of orphans) if (o.parent) o.parent.remove(o);
  return { extracted, removed: toRemove.length };
}

// Deep-dispose an Object3D subtree — used when purging the built-in
// map's structural geometry and any prior imports. Frees the GPU
// memory that would otherwise leak on every re-import.
function disposeSubtree(obj) {
  obj.traverse?.((child) => {
    if (child.isMesh) {
      child.geometry?.dispose?.();
      const mat = child.material;
      if (Array.isArray(mat)) for (const m of mat) m?.dispose?.();
      else mat?.dispose?.();
    }
  });
}

// Decide whether a stream-owned object is "preserved" (lights, sky
// dome, cloud holders) vs "structural" (garage, ground, roads,
// sidewalks, fences, barriers, curbs). Preserved items keep the
// scene lit and skyboxed after the built-in map is stripped out —
// the imported GLB is expected to be pure geometry.
function isPreservedMapItem(obj) {
  if (!obj) return true;
  // Directional lights are NOT preserved: mapGarage3d.js's sun plus
  // its warm/cool bounce fills (bounceWarm, bounceCool) are all
  // THREE.DirectionalLight instances, and an imported scene often
  // wants to bring its own lighting rather than fight a leftover
  // real-time sun casting shadows across whatever new geometry just
  // came in. Other light types — hemisphere sky fill, ambient,
  // the interior point light — still stay, so the scene doesn't go
  // pitch black the moment the sun's gone; only the directional
  // "sun-like" lights get removed.
  if (obj.isLight) return !obj.isDirectionalLight;
  // sun.target and similar plain Object3D anchors — keep so lights
  // that reference them don't dangle. Note: once its DirectionalLight
  // is removed above, a target like sun.target becomes an inert,
  // childless Object3D with nothing pointing at it — harmless, just
  // an empty node left in the scene graph, not worth the extra
  // complexity of tracing which light used to own which target.
  if (obj.type === 'Object3D' && !obj.isMesh && !obj.children.length) return true;
  // Sky dome uses ShaderMaterial (see mapGarage3d.makeSkyDome).
  if (obj.isMesh && obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) if (m && (m.isShaderMaterial || m.isRawShaderMaterial)) return true;
  }
  // Cloud holders are Groups tagged with userData.baseX by spawnClouds().
  if (obj.userData && obj.userData.baseX != null) return true;
  return false;
}

// Purge the ORIGINAL built-in map: strip structural geometry from
// the scene, dispose its GPU resources, and clear the collider
// array. Lights, sky dome, and clouds stay so the scene doesn't
// go pitch-black after the swap.
//
// Uses `window.__brawl3dMapStream` (set by buildGarageMap) as the
// authoritative list of what the map originally added — that's the
// only way to distinguish map-owned objects from live players,
// pickups, tracers, etc. without tagging every mesh at build time.
// If the current map doesn't expose a stream ref (non-garage maps),
// we fall back to APPEND-only behavior: no scene changes, no
// collider clear — imported mesh coexists with the map. That keeps
// the tool safe to trigger from any lobby.
function purgeOriginalMap(scene, colliders) {
  const stream = typeof window !== 'undefined' ? window.__brawl3dMapStream : null;
  if (!stream) {
    return { removedEssentials: 0, removedTiles: 0, clearedColliders: 0, purged: false };
  }
  let removedEssentials = 0;
  let removedTiles = 0;
  const keptEssentials = [];
  for (const obj of stream.essentials) {
    if (isPreservedMapItem(obj)) {
      keptEssentials.push(obj);
    } else {
      scene.remove(obj);
      disposeSubtree(obj);
      removedEssentials++;
    }
  }
  stream.essentials = keptEssentials;
  for (const bucket of stream.tiles.values()) {
    for (const o of bucket.objs) {
      if (bucket.resident) scene.remove(o);
      disposeSubtree(o);
      removedTiles++;
    }
  }
  stream.tiles.clear();
  const clearedColliders = colliders.length;
  colliders.length = 0;
  return { removedEssentials, removedTiles, clearedColliders, purged: true };
}

// Purge previous imports from a prior run so we don't stack multiple
// copies of the garage every time the user re-imports. The importer
// tags its root with `.userData.__importedMap = true`; we walk the
// scene for those and remove them + dispose their GPU resources.
//
// If `alsoStripColliders` is true (fallback path when the built-in
// map's stream wasn't disposed), we also filter out any `imported`
// colliders so re-imports don't double-stack collision.
function purgePreviousImports(scene, colliders, alsoStripColliders) {
  const removedGroups = [];
  scene.children.slice().forEach((child) => {
    if (child?.userData?.__importedMap) {
      scene.remove(child);
      disposeSubtree(child);
      removedGroups.push(child);
    }
  });
  if (alsoStripColliders && removedGroups.length && Array.isArray(colliders)) {
    for (let i = colliders.length - 1; i >= 0; i--) {
      if (colliders[i]?.imported) colliders.splice(i, 1);
    }
  }
  return removedGroups.length;
}

// Public — file-picker driven import. Resolves with a small stats
// object; rejects with a readable error the pause menu can display.
// How aggressively to simplify heavy imported meshes. Only meshes
// above SIMPLIFY_TRIANGLE_THRESHOLD get touched at all — small
// props aren't worth the CPU time and don't move the needle on
// frame rate. Anything above that gets reduced toward
// SIMPLIFY_TARGET_RATIO of its original triangle count (floored at
// SIMPLIFY_MIN_TRIANGLES so nothing gets simplified into a blob).
// Tune these if imports are still heavy after this pass, or if
// results look over-simplified.
const SIMPLIFY_TRIANGLE_THRESHOLD = 8000;
const SIMPLIFY_TARGET_RATIO = 0.25;
const SIMPLIFY_MIN_TRIANGLES = 300;
const SIMPLIFY_ERROR = 0.02; // meshopt's own error metric, not a %

// Simplify every heavy mesh in an imported group in place. Runs
// AFTER extractColliderMarkers, so COL_* marker boxes are already
// gone from `root`'s tree by the time this traverses it — collision
// markers never get simplified (their exact bounding box matters,
// and they're tiny/cheap already, nothing to gain).
//
// Heaviest meshes are processed first, so if something in a huge
// scene goes wrong partway through, the biggest wins are already
// banked. Yields to the browser between meshes (a bare
// setTimeout(0)) so a long pass over "I added two buildings" worth
// of geometry doesn't look like a frozen tab the whole time.
async function simplifyHeavyMeshes(root, onProgress) {
  if (!MeshoptSimplifier.supported) {
    console.warn('[sceneImport] meshoptimizer WASM not supported in this environment — skipping simplification');
    return { simplifiedCount: 0, trianglesBefore: 0, trianglesAfter: 0, skipped: true };
  }
  await MeshoptSimplifier.ready;

  const candidates = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const geo = o.geometry;
    const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    if (triCount >= SIMPLIFY_TRIANGLE_THRESHOLD) candidates.push({ mesh: o, triCount });
  });
  candidates.sort((a, b) => b.triCount - a.triCount);

  let simplifiedCount = 0;
  let trianglesBefore = 0;
  let trianglesAfter = 0;

  for (const { mesh, triCount } of candidates) {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    trianglesBefore += triCount;

    const positions = posAttr.array instanceof Float32Array
      ? posAttr.array
      : Float32Array.from(posAttr.array);

    let indices;
    if (geo.index) {
      indices = geo.index.array instanceof Uint32Array
        ? geo.index.array
        : Uint32Array.from(geo.index.array);
    } else {
      // Non-indexed geometry — meshopt needs an index buffer to
      // work with, so build the trivial 0..N-1 identity index.
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    const targetCount = Math.max(
      SIMPLIFY_MIN_TRIANGLES * 3,
      Math.floor((indices.length * SIMPLIFY_TARGET_RATIO) / 3) * 3,
    );

    let result;
    try {
      const [simplified] = MeshoptSimplifier.simplify(
        indices, positions, 3, targetCount, SIMPLIFY_ERROR, ['LockBorder'],
      );
      result = simplified;
    } catch (err) {
      console.warn('[sceneImport] simplify failed on one mesh, leaving it as-is —', err);
      continue;
    }
    if (!result || result.length === 0) continue;

    geo.setIndex(new THREE.BufferAttribute(result, 1));
    geo.index.needsUpdate = true;
    // Topology changed — stale authored normals would shade wrong
    // at the new simplified edges. Recomputing is the right call
    // for decimated geometry even though it discards any custom
    // authored normals this mesh may have had.
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    trianglesAfter += result.length / 3;
    simplifiedCount++;
    onProgress?.({ stage: 'simplifying', done: simplifiedCount, of: candidates.length });

    // Yield one tick so the browser can breathe between heavy meshes.
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    simplifiedCount,
    trianglesBefore: Math.round(trianglesBefore),
    trianglesAfter: Math.round(trianglesAfter),
    skipped: false,
  };
}

// Configure shadow-casting on any lights that came in AS PART OF
// the imported GLB itself (via glTF's KHR_lights_punctual
// extension, which GLTFLoader already converts into real
// THREE.DirectionalLight/PointLight/SpotLight objects with no code
// needed here for that basic case — position, color, and intensity
// all come through automatically).
//
// What glTF's lights extension does NOT carry, because it's outside
// the spec entirely: whether a light casts shadows. An imported
// light is shadowless and has no shadow camera configured by
// default, which looks flat next to the built-in sun it's meant to
// replace (2048 shadow map, tuned bias, a frustum sized to the play
// area). This sets those up with sensible defaults, sized to the
// imported scene's actual footprint (`worldHalf`, the same number
// that expands the engine's walk-clamp — reused here so the shadow
// frustum actually covers the new geometry instead of a generic
// guess).
// Shadow-casting light budget. A shadow-casting DirectionalLight or
// SpotLight costs ONE extra scene render pass per frame. A shadow-
// casting PointLight costs SIX — three.js renders point-light
// shadows as a cubemap, one pass per cube face, every frame. Add a
// handful of point lights in Blender and casting real shadows from
// all of them can genuinely tank frame rate; this is almost always
// the actual cause of "it got laggy right after I added lighting".
// Budget is spent cheapest-and-most-important first: directional
// (usually the one "sun" light and the most visually significant),
// then spot, then point last — so if the budget runs out, it's the
// 6×-cost point lights that lose real shadows first, not the sun.
// Anything past budget still lights the scene normally, it just
// doesn't cast a shadow.
const MAX_SHADOW_CASTING_LIGHTS = 3;

// Sane intensity ceiling for imported lights. Blender's glTF
// exporter converts light power from Watts into glTF's lux
// (directional) / candela (point, spot) units, and that conversion
// has known quirks across Blender/exporter versions — it's easy to
// end up with an imported light at an intensity of hundreds or
// thousands where the rest of the scene's lights sit in single
// digits (the built-in sun is 3.1). A light that bright blows out
// bloom/tone-mapping into exactly the kind of streaking visual
// corruption that shows up as "how do I get rid of this light"
// screenshots — the light itself isn't rendering wrong, it's just
// absurdly overbright. Clamping here is a safety net; the actual
// fix is still checking that light's Watts value in Blender.
const MAX_IMPORTED_LIGHT_INTENSITY = 8;

function configureImportedLights(root, worldHalf) {
  const half = Number.isFinite(worldHalf) && worldHalf > 0 ? worldHalf : 40;
  const found = {
    directional: 0, point: 0, spot: 0, other: 0,
    shadowCasters: 0, shadowSkipped: 0, intensityClamped: 0,
  };

  const lights = [];
  root.traverse((o) => { if (o.isLight) lights.push(o); });

  // Directional first, then spot, then point — cheapest/most
  // important first so the budget is spent there before the 6×-cost
  // point lights ever get a turn.
  const priority = (o) => (o.isDirectionalLight ? 0 : o.isSpotLight ? 1 : o.isPointLight ? 2 : 3);
  lights.sort((a, b) => priority(a) - priority(b));

  let shadowBudget = MAX_SHADOW_CASTING_LIGHTS;

  for (const o of lights) {
    if (o.isDirectionalLight) found.directional++;
    else if (o.isPointLight) found.point++;
    else if (o.isSpotLight) found.spot++;
    else found.other++;

    if (Number.isFinite(o.intensity) && o.intensity > MAX_IMPORTED_LIGHT_INTENSITY) {
      console.warn(
        `[sceneImport] imported light "${o.name || o.type}" intensity ${o.intensity.toFixed(1)} `
        + `clamped to ${MAX_IMPORTED_LIGHT_INTENSITY} — likely a Blender Watts→lux/candela export `
        + `quirk. Check this light's Power value in Blender if it's meant to be this bright.`,
      );
      o.intensity = MAX_IMPORTED_LIGHT_INTENSITY;
      found.intensityClamped++;
    }

    if (!o.isDirectionalLight && !o.isPointLight && !o.isSpotLight) continue; // no shadow concept (hemisphere/ambient)

    if (shadowBudget <= 0) {
      o.castShadow = false;
      found.shadowSkipped++;
      continue;
    }
    shadowBudget--;
    found.shadowCasters++;
    o.castShadow = true;

    if (o.isDirectionalLight) {
      o.shadow.mapSize.set(2048, 2048);
      o.shadow.camera.left = -half * 1.1;
      o.shadow.camera.right = half * 1.1;
      o.shadow.camera.top = half * 1.1;
      o.shadow.camera.bottom = -half * 1.1;
      o.shadow.camera.near = 1;
      o.shadow.camera.far = half * 3;
      o.shadow.bias = -0.0003;
      o.shadow.normalBias = 0.02;
      o.shadow.radius = 2.5;
      o.shadow.camera.updateProjectionMatrix();
    } else if (o.isSpotLight) {
      o.shadow.mapSize.set(1024, 1024);
      o.shadow.bias = -0.0004;
      o.shadow.camera.near = 0.5;
      o.shadow.camera.far = Math.max(half, o.distance || half);
    } else if (o.isPointLight) {
      // Cubemap shadow — 6 passes even at this size, so keep it
      // small. Only reachable at all if directional/spot lights
      // didn't already exhaust the budget above.
      o.shadow.mapSize.set(512, 512);
      o.shadow.bias = -0.0004;
      o.shadow.camera.near = 0.5;
      o.shadow.camera.far = Math.max(half, o.distance || half);
    }
  }

  return found;
}

// Guaranteed base ambient fill so dark interior corners of an
// imported map are never pure black, regardless of whether the GLB
// brought its own lights (and regardless of the shadow/intensity
// budget above skipping some of them). A flat AmbientLight is used
// deliberately instead of another HemisphereLight — Ambient
// illuminates every surface equally no matter which way it faces,
// which is what "so I can see the walls in the dark" actually
// needs; Hemisphere still leaves downward-facing surfaces dim since
// it varies by normal direction relative to up.
//
// Tagged with userData.__importAmbientFill and removed-then-
// re-added on every import (not just added once) so repeated
// imports replace it instead of stacking multiple copies and
// slowly washing out the scene's contrast over successive imports.
const IMPORT_AMBIENT_INTENSITY = 1.6;

function ensureImportAmbientFill(scene) {
  const existing = [];
  scene.traverse((o) => {
    if (o.userData && o.userData.__importAmbientFill) existing.push(o);
  });
  for (const o of existing) scene.remove(o);

  const fill = new THREE.AmbientLight(0xffffff, IMPORT_AMBIENT_INTENSITY);
  fill.userData.__importAmbientFill = true;
  scene.add(fill);
  return fill;
}

export function pickAndImportMapGLB(onProgress, options = {}) {
  const { useMarkers = true } = options;
  return new Promise((resolve, reject) => {
    const scene = typeof window !== 'undefined' ? window.__brawl3dScene : null;
    const engine = typeof window !== 'undefined' ? window.__brawl3dEngine : null;
    if (!scene || !engine || !Array.isArray(engine.colliders)) {
      reject(new Error('Enter a lobby before importing — scene not ready.'));
      return;
    }
    const colliders = engine.colliders;

    // Open a native file picker. This must happen inside a user
    // gesture (the button click), so we do it synchronously.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
    input.style.display = 'none';
    document.body.appendChild(input);

    let picked = false;
    input.addEventListener('change', () => {
      picked = true;
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) { reject(new Error('No file chosen.')); return; }

      onProgress?.({ stage: 'reading', bytes: file.size });
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      loader.load(
        url,
        async (gltf) => {
          onProgress?.({ stage: 'sanitizing' });
          const root = gltf.scene || gltf.scenes?.[0];
          if (!root) {
            URL.revokeObjectURL(url);
            reject(new Error('GLB has no scene node.'));
            return;
          }
          root.userData.__importedMap = true;
          // Also tag as __garageModel — the same flag
          // sceneExport.js's isGarageInstance() checks to decide
          // what keeps its real material on export. Without this,
          // re-exporting after an import strips EVERYTHING: the
          // original buildGarageMap() group carried this marker,
          // but purgeOriginalMap() just removed that whole group
          // (marker included) as part of clearing the old
          // structural geometry, and nothing here replaced it — so
          // the freshly imported (and possibly freshly re-textured)
          // content had no exemption left anywhere in the scene on
          // the next export.
          root.userData.__garageModel = true;
          const removedMeshes = sanitizeImportedGroup(root);

          // Extract explicit COL_* collision markers BEFORE the
          // structural mesh count is used — markers are metadata,
          // not visible geometry, so they don't count toward the
          // "no geometry to import" check. This also REMOVES marker
          // meshes from `root`'s tree, so the voxel derive pass
          // below never sees them — no double-counting from the
          // marker boxes' own geometry.
          onProgress?.({ stage: 'extracting-markers' });
          const markerStats = extractColliderMarkers(root);

          // Simplify heavy meshes now — after markers are stripped
          // (nothing here ever touches a collision box), before
          // collision derivation runs (so the voxel auto-derive
          // scans the same, lighter geometry the player will
          // actually render against, not the pre-simplified one).
          onProgress?.({ stage: 'simplifying' });
          const simplifyStats = await simplifyHeavyMeshes(root, onProgress);

          // Two-stage purge: (1) strip built-in map structural geo
          // + clear ALL colliders in place (garage lobby only); (2)
          // drop any prior imported groups so re-imports don't stack.
          onProgress?.({ stage: 'purging-original' });
          const origStats = purgeOriginalMap(scene, colliders);

          onProgress?.({ stage: 'purging-previous' });
          const purged = purgePreviousImports(scene, colliders, !origStats.purged);

          scene.add(root);

          // Guaranteed uniform fill so dark corners aren't pure
          // black — see ensureImportAmbientFill's comment for why
          // this is a flat AmbientLight rather than relying on
          // whatever came in with the GLB or was already preserved.
          ensureImportAmbientFill(scene);

          // Collision: markers AND auto-derive, always both, merged
          // — not either/or. Markers give precise author-placed
          // boxes for whatever they cover; voxel auto-derive (run
          // on `root` AFTER markers are stripped out of it, so it
          // only sees the real remaining geometry) picks up
          // anything else, including structural geometry that's new
          // or was edited in Blender without a matching marker.
          // Previously this was "if any markers exist, use ONLY
          // markers" — which silently gave zero collision to new
          // unmarked geometry the moment even one marker was
          // present anywhere in the file.
          //
          // `useMarkers` (from the TOOLS-tab checkbox) lets the
          // user skip marker adoption entirely — e.g. when a
          // Blender-authored GLB has stale/wrong COL_* boxes they
          // want to overwrite with a fresh auto-derive. Marker
          // meshes are still EXTRACTED (so they don't show as red
          // boxes in-game), just not pushed as colliders.
          let markerCount = 0;
          if (useMarkers) {
            onProgress?.({ stage: 'using-markers' });
            for (const c of markerStats.extracted) colliders.push(c);
            markerCount = markerStats.extracted.length;
          }

          onProgress?.({ stage: 'deriving-collision' });
          const derived = deriveColliders(root);
          for (const c of derived) colliders.push(c);
          const derivedCount = derived.length;

          const addedCount = markerCount + derivedCount;
          const collisionSource =
            markerCount > 0 && derivedCount > 0 ? 'markers+auto-derived'
            : markerCount > 0 ? 'markers'
            : derivedCount > 0 ? 'auto-derived'
            : 'none';

          // Expand the engine's world clamp so the player can walk
          // to the edges of the imported ground plane. Only shrink
          // is disallowed — if the imported map is SMALLER than the
          // original, keep the larger box so the player doesn't get
          // stuck outside their newly-minted world by half a metre.
          let newHalf = null;
          if (origStats.purged) {
            const wh = computeWorldHalf(root);
            if (wh != null && Number.isFinite(wh)) {
              newHalf = Math.max(wh, engine.half || 0);
              engine.half = newHalf;
              // The engine snapshotted arena.half at construction —
              // no need to touch arena.half; engine.half is what the
              // per-frame clamp reads (line 253 of engine3d.js).
            }
          }

          // Set up shadow-casting on whatever lights actually came
          // in from the GLB (see configureImportedLights' comment
          // for why glTF's own lights extension can't do this
          // itself). Sized to newHalf if we have it, otherwise a
          // generic default.
          onProgress?.({ stage: 'configuring-lights' });
          const lightStats = configureImportedLights(root, newHalf);

          URL.revokeObjectURL(url);
          resolve({
            file: file.name,
            bytes: file.size,
            addedColliders: addedCount,
            collisionSource,
            markerCount,
            derivedCount,
            simplifiedMeshCount: simplifyStats.simplifiedCount,
            trianglesBeforeSimplify: simplifyStats.trianglesBefore,
            trianglesAfterSimplify: simplifyStats.trianglesAfter,
            importedLights: lightStats,
            removedMeshesInSanitize: removedMeshes,
            purgedPreviousImports: purged,
            purgedOriginalEssentials: origStats.removedEssentials,
            purgedOriginalTiles: origStats.removedTiles,
            clearedColliders: origStats.clearedColliders,
            newHalf,
          });
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          reject(new Error('GLB load failed: ' + (err?.message || String(err))));
        },
      );
    });

    // If the user cancels the file dialog there is no reliable
    // event (browsers don't fire `cancel` cross-platform). Cleanup
    // the stray <input> after a delay if no file was picked.
    setTimeout(() => {
      if (!picked && input.parentNode) {
        input.parentNode.removeChild(input);
        reject(new Error('Import cancelled (no file selected).'));
      }
    }, 120000);

    input.click();
  });
}

if (typeof window !== 'undefined') {
  window.__brawl3dImportMap = pickAndImportMapGLB;
}