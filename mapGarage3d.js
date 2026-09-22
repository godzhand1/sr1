// Team Gangsta Brawl — "The Garage" alternate lobby map.
import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StreamingManager } from './streamManager.js';
import { sidewalkTex } from './arena3d.js';
import { spawnBarrier } from './jerseyBarrier.js';
import { addBakedLampFixture, placeBakedLampGrid } from './bakedLights.js';
export const GARAGE_HALF = 45;
const GARAGE_TARGET_X = 50.0;
const GARAGE_TARGET_Y = 10.0;
const GARAGE_TARGET_Z = 30.0;
const INTERIOR_CX = -3.7;
const INTERIOR_HALF_X = 4.3;
const INTERIOR_HALF_Z = 10.0;
const GARAGE_URL = '/models/garage.glb';
let _garageTplPromise = null;
let _garageTpl = null;
function _loadGarage() {
  if (_garageTpl) return Promise.resolve(_garageTpl);
  if (_garageTplPromise) return _garageTplPromise;
  const loader = new GLTFLoader();
  _garageTplPromise = new Promise((resolve, reject) => {
    loader.load(GARAGE_URL, (gltf) => {
      const scene = gltf.scene || gltf.scenes[0];
      const toRemove = [];
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.geometry) {
            const pos = o.geometry.attributes.position;
            if (pos && pos.array && pos.array.length > 0) {
              const arr = pos.array;
              let hasNaN = false;
              // Full scan, not a sparse sample — a mesh this size
              // (500k+ vertices) means a handful of sample points
              // has almost no chance of landing on an isolated bad
              // vertex, and a missed NaN here is exactly the kind of
              // bug that causes a mesh's bounding sphere to compute
              // as NaN, which can make three.js frustum-cull it
              // incorrectly — i.e. it silently stops being drawn
              // from some camera angles, which looks identical to a
              // missing/black texture but isn't one at all. This is
              // a one-time load cost, not per-frame, so correctness
              // matters more than scan speed here.
              for (let i = 0; i < arr.length; i++) {
                if (!Number.isFinite(arr[i])) { hasNaN = true; break; }
              }
              if (hasNaN) toRemove.push(o);
            } else {
              toRemove.push(o);
            }
          }
        }
      });
      for (const m of toRemove) {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose?.();
      }
      if (toRemove.length) console.warn('[garage] dropped', toRemove.length, 'degenerate meshes');
      const bbox = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const safeSize = (v) => (Number.isFinite(v) && v > 0.001 ? v : 1.0);
      const sx = GARAGE_TARGET_X / safeSize(size.x);
      const sy = GARAGE_TARGET_Y / safeSize(size.y);
      const sz = GARAGE_TARGET_Z / safeSize(size.z);
      const offY = Number.isFinite(bbox.min.y) ? -bbox.min.y * sy : 0;
      console.log('[mapGarage3d] garage loaded — bbox size:', size.toArray(), '→ scale', [sx, sy, sz]);
      _garageTpl = { scene, sx, sy, sz, offY };
      resolve(_garageTpl);
    }, undefined, (err) => reject(err));
  });
  return _garageTplPromise;
}
_loadGarage().catch(() => {});
// Storm cloud
const CLOUD_URL = '/models/stormCloud_optimized.glb';
const CLOUD_TARGET_X = 28;
const CLOUD_TARGET_Y = 12;
const CLOUD_TARGET_Z = 24;
let _cloudTplPromise = null;
let _cloudTpl = null;
function _loadCloud() {
  if (_cloudTpl) return Promise.resolve(_cloudTpl);
  if (_cloudTplPromise) return _cloudTplPromise;
  const loader = new GLTFLoader();
  _cloudTplPromise = new Promise((resolve, reject) => {
    loader.load(CLOUD_URL, (gltf) => {
      const scene = gltf.scene || gltf.scenes[0];
      const toRemove = [];
      scene.traverse((o) => {
        if (o.isMesh && o.geometry) {
          const pos = o.geometry.attributes.position;
          if (!pos || !pos.array || pos.array.length === 0) { toRemove.push(o); return; }
          const arr = pos.array;
          for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) { toRemove.push(o); break; }
          }
        }
      });
      for (const m of toRemove) {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose?.();
      }
      if (toRemove.length) console.warn('[cloud] dropped', toRemove.length, 'degenerate meshes');
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const old = o.material;
        o.material = pbr.paint({ color: 0xf2f5fb });
        if (old) {
          ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'emissiveMap', 'aoMap'].forEach(k => old[k]?.dispose?.());
          old.dispose?.();
        }
      });
      const bbox = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const safeSize = (v) => (Number.isFinite(v) && v > 0.001 ? v : 1.0);
      const sx = CLOUD_TARGET_X / safeSize(size.x);
      const sy = CLOUD_TARGET_Y / safeSize(size.y);
      const sz = CLOUD_TARGET_Z / safeSize(size.z);
      _cloudTpl = { scene, sx, sy, sz, center };
      resolve(_cloudTpl);
    }, undefined, (err) => reject(err));
  });
  return _cloudTplPromise;
}
_loadCloud().catch(() => {});
const CLOUD_LAYOUT = [
  { x: -30, y: 40, z: -20, scale: 1.15, yaw: 0.4 },
  { x: 24, y: 46, z: 16, scale: 1.4, yaw: -0.6 },
  { x: -8, y: 52, z: -42, scale: 0.9, yaw: 1.1 },
  { x: 38, y: 44, z: -30, scale: 1.0, yaw: -1.3 },
  { x: -36, y: 48, z: 32, scale: 1.25, yaw: 2.0 },
];
function spawnClouds(stream) {
  _loadCloud().then((tpl) => {
    const holders = [];
    for (const c of CLOUD_LAYOUT) {
      const inner = tpl.scene.clone(true);
      const csx = tpl.sx * c.scale, csy = tpl.sy * c.scale, csz = tpl.sz * c.scale;
      inner.scale.set(csx, csy, csz);
      inner.position.set(-tpl.center.x * csx, -tpl.center.y * csy, -tpl.center.z * csz);
      inner.traverse((o) => {
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      });
      const holder = new THREE.Group();
      holder.position.set(c.x, c.y, c.z);
      holder.rotation.y = c.yaw;
      holder.userData.baseX = c.x;
      holder.add(inner);
      stream.addEssential(holder);
      holders.push(holder);
    }
    const DRIFT_SPEED = 0.5;
    const WRAP_SPAN = 90;
    let lastT = performance.now();
    function tick(now) {
      if (holders.every((h) => !h.parent)) return;
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      for (const h of holders) {
        if (!h.parent) continue;
        let x = h.position.x + DRIFT_SPEED * dt;
        if (x - h.userData.baseX > WRAP_SPAN) x -= WRAP_SPAN * 2;
        h.position.x = x;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }).catch((err) => console.warn('[mapGarage3d] storm cloud placement skipped —', err));
}
const SUN_DIRECTION = new THREE.Vector3(25, 32, 12).normalize();
const SKY_RADIUS = 400;
function makeSkyDome() {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uZenithColor: { value: new THREE.Color(0x4a5a78) },
      uHorizonColor: { value: new THREE.Color(0x8f9eb8) },
      uSunDirection: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: new THREE.Color(0xfff0d0) },
      uSunIntensity: { value: 1.8 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uZenithColor, uHorizonColor, uSunDirection, uSunColor;
      uniform float uSunIntensity;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 sky = mix(uHorizonColor, uZenithColor, pow(h, 0.52));
        float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
        float core = pow(sunDot, 950.0) * 2.8;
        float halo = pow(sunDot, 7.5) * 0.35;
        sky += uSunColor * (core + halo) * uSunIntensity;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.userData.legacySky = true;
  return dome;
}
// Asphalt — real photographed texture (user-supplied) instead of
// the earlier procedural canvas noise. Loaded once and cached; the
// texture object is usable immediately even though the image data
// itself finishes decoding asynchronously (three.js handles that
// transparently — nothing else here needs to wait on it).
//
// Shared loader used by every custom texture below. A failed load
// (wrong path, file not actually deployed yet, etc.) otherwise
// renders as OPAQUE SOLID BLACK in three.js — not invisible, not the
// material's base color, just black — which is exactly what showed
// up as the crosswalk's missing white stripes and, because that
// opaque black plane sits right on top of the centerline, made the
// yellow line look broken/misaligned where it passed underneath.
// This loads onto a material that already has a sensible flat
// fallback .color set, and only touches .map on success — so a
// failed load now just shows that flat color instead of a black hole.
function loadTextureOnto(material, url, configure) {
  new THREE.TextureLoader().load(
    url,
    (tex) => {
      tex.anisotropy = 4;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      if (configure) configure(tex);
      material.map = tex;
      material.needsUpdate = true;
      // Logged on purpose: a texture can call this onLoad callback
      // yet still render solid black — most commonly a CORS-tainted
      // image (loads fine as an <img>, but the browser blocks
      // WebGL from reading its pixel data, so it uploads as black
      // with no error anywhere). Logging the decoded size here
      // means "did this fire at all" and "is the image actually the
      // size I expect" are both answered from the console, instead
      // of guessing blind.
      const img = tex.image;
      console.log('[mapGarage3d] texture loaded —', url, img ? `${img.width}×${img.height}` : '(no image?)');
    },
    undefined,
    (err) => console.warn('[mapGarage3d] texture FAILED to load, showing flat fallback color instead of black —', url, err),
  );
}
// Caveat worth knowing: this is a single photo with one distinct
// crack running through it, not a seamlessly-tileable pattern. Tiled
// too small, that same crack repeats visibly across the road. Tiled
// large instead (below) so it reads as a handful of naturally-placed
// weathered slabs rather than an obvious stamp — reasonable given a
// single source photo, but if you want zero visible repetition,
// you'd want either a proper seamless asphalt tile or to blend two
// rotated copies, which is a bigger change than this one image asks for.
const ASPHALT_URL = '/images/asphalt_road.jpg';
// Centerline — a photo of a continuous double yellow no-passing
// line (user-supplied), replacing the earlier flat-color dashed
// strip. In the source photo the line runs along the image's own
// vertical axis and sits at ~33%–64% of the image's width (center
// ~48%, i.e. already close to dead-center).
//
// Correction: the first version of this used texture.rotation to
// swap axes, which was wrong — I verified the actual math afterward
// (three.js's setUvTransform scales along the ROTATED basis, not
// the original one) and it was putting the "tile 6×" factor on the
// STRIP'S WIDTH instead of its length, which is exactly the "way too
// thin, looks like multiple parallel streaks" bug from the
// screenshot: six copies of the line squeezed side-by-side into one
// strip. Fixed properly this time by swapping the geometry's own UV
// buffer (so mesh-U ↔ the strip's width, mesh-V ↔ its length) and
// using a plain crop + tile on the texture with no rotation at all:
// offset/repeat on X crop tightly into the measured yellow band
// (0.335–0.635) so the whole strip width is genuine line, no wasted
// dark margin; repeat on Y tiles that along the road's length.
const CENTERLINE_URL = '/images/road_double_yellow.jpg';
// Sidewalk — real photographed paver texture (user-supplied),
// replacing the arena3d.js sidewalkTex() import for this one mesh
// only. sidewalkTex() is still used for the ground pad elsewhere in
// this file (and presumably other maps) — leaving that alone, this
// only swaps the actual sidewalk strip.
const SIDEWALK_PAVER_URL = '/images/sidewalk_pavers.jpg';
// Crosswalk — user-supplied photo of the full striped pattern.
const CROSSWALK_URL = '/images/crosswalk_stripes.jpg';
// Curb line — user-supplied photo of a worn painted curb stripe.
// Source file had the checkerboard "transparent" pattern literally
// baked into flat RGB pixels (no real alpha channel) — I converted
// it to genuine alpha via a brightness threshold before using it
// (background cluster ~40-70 luminance, line cluster ~100+, clean
// gap between them) and cropped tight to just the opaque line band
// (~56.5%-65.5% of the image height) so there's no wasted transparent
// padding. Use alphaTest here instead of blended transparency — it's
// a hard 0/255 cutout, not a soft gradient, so alphaTest gives
// correct depth-sorting/shadows for free instead of the sorting
// quirks blended transparency can have.
const CURB_LINE_URL = '/images/curb_paint_line.png';
export function buildGarageMap(scene) {
  const colliders = [];
  const H = GARAGE_HALF;
  const stream = new StreamingManager({ scene, loadRadius: 4, unloadRadius: 5 });
  scene.fog = new THREE.Fog(0x8f9eb8, 38, 135);
  scene.background = null;
  stream.addEssential(makeSkyDome());
  spawnClouds(stream);
  // Lighting
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.1);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(42);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -H * 1.1;
  sun.shadow.camera.right = H * 1.1;
  sun.shadow.camera.top = H * 1.1;
  sun.shadow.camera.bottom = -H * 1.1;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.018;
  sun.shadow.radius = 2.8;
  stream.addEssential(sun);
  stream.addEssential(sun.target);
  stream.addEssential(new THREE.HemisphereLight(0xc5d8ff, 0x3f2e1f, 0.95));
  const bounceWarm = new THREE.DirectionalLight(0xffd9b3, 0.45);
  bounceWarm.position.set(12, 8, 22);
  stream.addEssential(bounceWarm);
  const bounceCool = new THREE.DirectionalLight(0x9eb8e0, 0.35);
  bounceCool.position.set(-18, 14, -20);
  stream.addEssential(bounceCool);
  stream.addEssential(new THREE.AmbientLight(0x8a9ab8, 0.22));
  const interiorFill = new THREE.PointLight(0xffd4a8, 1.35, 18, 1.8);
  interiorFill.position.set(INTERIOR_CX, 3.2, -3.5);
  stream.addEssential(interiorFill);

  // iter192 baked lighting — perimeter streetlamps around the yard
  // + warm interior lamps inside the shop bay so the walk-in path
  // reads clearly at night.
  placeBakedLampGrid(stream, {
    half: H, kind: 'streetlamp',
    perimeter: true, inset: 8, essential: true,
    step: 22,
  });
  // Interior shop bays — 3 warm bulbs along the ceiling.
  stream.addEssential(addBakedLampFixture(INTERIOR_CX - 4, -12, 'interior_warm'));
  stream.addEssential(addBakedLampFixture(INTERIOR_CX,      -6, 'interior_warm'));
  stream.addEssential(addBakedLampFixture(INTERIOR_CX + 4,   0, 'interior_warm'));
  // LOWERED ENTIRE MAP
  const FLOOR_OFFSET = -0.15;
  // Ground pad
  const groundMat = pbr.stone({
    color: 0x5f584f,
    map: (() => { const t = sidewalkTex(); t.repeat.set(14, 14); return t; })(),
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_OFFSET;
  ground.receiveShadow = true;
  stream.addEssential(ground);
  const STREET_HALF_W = 32;
  const SIDEWALK_Z0 = GARAGE_TARGET_Z / 2 + 0.2;
  const SIDEWALK_DEPTH = 5;
  const SIDEWALK_Z1 = SIDEWALK_Z0 + SIDEWALK_DEPTH;
  const CURB_H = 0.14;
  const ROAD_DEPTH = 13;
  const ROAD_CZ = (SIDEWALK_Z1 + ROAD_DEPTH / 2);
  // Sidewalk — smaller square pavers
  const sidewalkMat = pbr.stone({ 
    color: 0xa8a39a,
    roughness: 0.92,
  });

  loadTextureOnto(sidewalkMat, SIDEWALK_PAVER_URL, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    
    // Increased repeat = smaller pavers
    const squareRepeat = 22;   // ← was ~11.5, now much smaller tiles
    
    t.repeat.set(squareRepeat, squareRepeat * (SIDEWALK_DEPTH / (STREET_HALF_W * 2)));
    
    t.offset.set(0.12, 0.07);
    
    sidewalkMat.color.set(0xffffff);
  });
  const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(STREET_HALF_W * 2, SIDEWALK_DEPTH), sidewalkMat);
  sidewalk.rotation.x = -Math.PI / 2;
  sidewalk.position.set(0, 0.012 + FLOOR_OFFSET, SIDEWALK_Z0 + SIDEWALK_DEPTH / 2);
  sidewalk.receiveShadow = true;
  stream.addEssential(sidewalk);
  // Verge
  const verge = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET_HALF_W * 2, 1.8),
    pbr.stone({ color: 0x4a3f2e, roughness: 0.98 })
  );
  verge.rotation.x = -Math.PI / 2;
  verge.position.set(0, 0.008 + FLOOR_OFFSET, SIDEWALK_Z1 + 0.9);
  verge.receiveShadow = true;
  stream.addEssential(verge);
  // Curb line — flat decal instead of a raised flat-color box, using
  // the painted curb-stripe photo. Sits right at the sidewalk/road
  // seam like the old box did, just as a thin textured strip now.
  {
    const CURB_LINE_WIDTH = 0.35; // physical width of the painted stripe
    const g = new THREE.PlaneGeometry(STREET_HALF_W * 2, CURB_LINE_WIDTH);
    g.rotateX(-Math.PI / 2);
    g.translate(0, CURB_H + FLOOR_OFFSET, SIDEWALK_Z1 + 0.1);
    const curbMat = pbr.stone({
      color: 0x9e9788, // fallback if the photo fails to load
      alphaTest: 0.5,
    });
    loadTextureOnto(curbMat, CURB_LINE_URL, (t) => {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping; // crop axis — must not wrap
      t.offset.set(0, 0.565);
      t.repeat.set(8, 0.09); // ~8m per repeat along the line's length; crop to just the opaque band vertically
      curbMat.color.set(0xffffff);
    });
    const curb = new THREE.Mesh(g, curbMat);
    curb.receiveShadow = true;
    stream.addEssential(curb);
  }
  // ==================== MAIN ROAD (base layer) ====================
  const roadMat = pbr.stone({ 
    color: 0x222226, 
    roughness: 0.96 
  });

  loadTextureOnto(roadMat, ASPHALT_URL, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const roadRepeat = 18;
    t.repeat.set(roadRepeat, roadRepeat * (ROAD_DEPTH / (STREET_HALF_W * 2)));
    roadMat.color.set(0xffffff);
  });

  const road = new THREE.Mesh(new THREE.PlaneGeometry(STREET_HALF_W * 2, ROAD_DEPTH), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.008 + FLOOR_OFFSET, ROAD_CZ);   // lowest
  road.receiveShadow = true;
  stream.addEssential(road);

  // ==================== WEAR PATCHES (slightly raised + better offset) ====================
  {
    const geos = [];
    for (let i = 0; i < 6; i++) {
      const w = 4 + Math.random() * 6;
      const g = new THREE.PlaneGeometry(w, 5 + Math.random() * 4);
      g.rotateX(-Math.PI / 2);
      g.translate(
        -STREET_HALF_W / 2 + Math.random() * STREET_HALF_W * 1.6,
        0.011 + FLOOR_OFFSET,        // slightly above road
        ROAD_CZ - ROAD_DEPTH/3 + Math.random() * ROAD_DEPTH * 0.7
      );
      geos.push(g);
    }
    const wearMat = pbr.stone({ 
      color: 0x2a2a2f, 
      roughness: 0.9 
    });
    loadTextureOnto(wearMat, ASPHALT_URL, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(13, 11);
    });
    const wear = new THREE.Mesh(mergeGeometries(geos, false), wearMat);
    wear.renderOrder = 1;
    wear.position.y = 0.0005;   // tiny lift to prevent z-fighting
    wear.receiveShadow = true;
    stream.addEssential(wear);
  }

  // ==================== CENTERLINE ====================
  {
    const CENTERLINE_WIDTH = 0.6;
    const g = new THREE.PlaneGeometry(STREET_HALF_W * 2, CENTERLINE_WIDTH);
    // UV swap for correct orientation
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, v, u);
    }
    uv.needsUpdate = true;

    g.rotateX(-Math.PI / 2);
    // FIXED: this was two separate g.translate() calls stacked —
    // BufferGeometry.translate() adds to the existing position, it
    // doesn't set an absolute one, so calling it twice moved this
    // by BOTH offsets combined. Z was ending up at 2× ROAD_CZ
    // (~53.4), past the back fence and nowhere near the actual
    // road. One translate call, using the intended 0.022 offset.
    g.translate(0, 0.022 + FLOOR_OFFSET, ROAD_CZ);
    const centerlineMat = pbr.plastic({
      color: 0xe8c44a, roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    loadTextureOnto(centerlineMat, CENTERLINE_URL, (t) => {
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.offset.set(0.335, 0);
      t.repeat.set(0.3, 6);
      centerlineMat.color.set(0xffffff);
    });
    stream.addEssential(new THREE.Mesh(g, centerlineMat));
  }

  // ==================== CROSSWALK ====================
  {
    const crosswalkMat = pbr.plastic({
      color: 0xf8f4e8, roughness: 0.7,
      transparent: true,
      opacity: 0.97,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    });

    loadTextureOnto(crosswalkMat, CROSSWALK_URL, (t) => {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      crosswalkMat.color.set(0xffffff);
    });

    const g = new THREE.PlaneGeometry(9.6, ROAD_DEPTH - 0.6);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.023 + FLOOR_OFFSET, ROAD_CZ);

    const crosswalk = new THREE.Mesh(g, crosswalkMat);
    crosswalk.renderOrder = 2;
    stream.addEssential(crosswalk);
  }
  // Fence
  const fenceMat = pbr.metal({ color: 0x2a2622, roughness: 0.55 });
  function pushFence(x, z, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.0, d), fenceMat);
    m.position.set(x, 1.0 + FLOOR_OFFSET, z);
    stream.addEssential(m);
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h: 2.0, climbable: false });
  }
  pushFence(0, H, H * 2, 0.3);
  pushFence(0, -H, H * 2, 0.3);
  pushFence(H, 0, 0.3, H * 2);
  pushFence(-H, 0, 0.3, H * 2);
  // Garage
  const garageGroup = new THREE.Group();
  garageGroup.userData.__garageModel = true; // lets sceneExport.js keep this one's real textures instead of stripping to a placeholder
  stream.addEssential(garageGroup);
  _loadGarage().then((tpl) => {
    const clone = tpl.scene.clone(true);
    clone.scale.set(tpl.sx, tpl.sy, tpl.sz);
    clone.position.y = tpl.offY + FLOOR_OFFSET;
    garageGroup.add(clone);
    garageGroup.updateMatrixWorld(true);
    let minX = +Infinity, maxX = -Infinity, minZ = +Infinity, maxZ = -Infinity;
    let wMinX = +Infinity, wMaxX = -Infinity, wMinZ = +Infinity, wMaxZ = -Infinity;
    const WALL_Y_LO = 1.0;
    const WALL_Y_HI = 5.0;
    const v = new THREE.Vector3();
    clone.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      const arr = pos.array;
      const stride = pos.itemSize || 3;
      for (let i = 0; i < arr.length; i += stride) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        v.set(x, y, z).applyMatrix4(o.matrixWorld);
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
        if (v.y >= WALL_Y_LO && v.y <= WALL_Y_HI) {
          if (v.x < wMinX) wMinX = v.x; if (v.x > wMaxX) wMaxX = v.x;
          if (v.z < wMinZ) wMinZ = v.z; if (v.z > wMaxZ) wMaxZ = v.z;
        }
      }
    });
    if (!Number.isFinite(minX)) {
      minX = -GARAGE_TARGET_X / 2; maxX = GARAGE_TARGET_X / 2;
      minZ = -GARAGE_TARGET_Z / 2; maxZ = GARAGE_TARGET_Z / 2;
    }
    if (Number.isFinite(wMinX)) {
      minX = wMinX; maxX = wMaxX; minZ = wMinZ; maxZ = wMaxZ;
    }
    const outerH = GARAGE_TARGET_Y;
    const STRIP_W = 0.25;
    const Z_BIN_W = 0.1;
    const MIN_STRIP_VERTS = 20;
    const HIST_Y_LO = 1.2;
    const HIST_Y_HI = 2.6;
    const nStrips = Math.ceil((maxX - minX) / STRIP_W);
    const frontBins = new Array(nStrips).fill(null).map(() => new Map());
    const backBins = new Array(nStrips).fill(null).map(() => new Map());
    clone.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      const arr = pos.array;
      const stride = pos.itemSize || 3;
      for (let i = 0; i < arr.length; i += stride) {
        const x0 = arr[i], y0 = arr[i + 1], z0 = arr[i + 2];
        if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(z0)) continue;
        v.set(x0, y0, z0).applyMatrix4(o.matrixWorld);
        if (v.y < HIST_Y_LO || v.y > HIST_Y_HI) continue;
        const sIdx = Math.floor((v.x - minX) / STRIP_W);
        if (sIdx < 0 || sIdx >= nStrips) continue;
        const zBin = Math.floor(v.z / Z_BIN_W);
        const map = v.z > 0 ? frontBins[sIdx] : backBins[sIdx];
        map.set(zBin, (map.get(zBin) || 0) + 1);
      }
    });
    for (let s = 0; s < nStrips; s++) {
      const xS = minX + s * STRIP_W;
      const xE = Math.min(maxX, xS + STRIP_W);
      if (xE - xS < 0.01) continue;
      let fBin = null, fCount = 0;
      for (const [b, c] of frontBins[s]) if (c > fCount) { fCount = c; fBin = b; }
      let bBin = null, bCount = 0;
      for (const [b, c] of backBins[s]) if (c > bCount) { bCount = c; bBin = b; }
      if (fBin != null && fCount >= MIN_STRIP_VERTS) {
        const frontZ = fBin * Z_BIN_W + Z_BIN_W;
        colliders.push({ x0: xS, x1: xE, z0: minZ, z1: frontZ, h: outerH, climbable: false });
      } else if (bBin != null && bCount >= MIN_STRIP_VERTS) {
        const backZ = bBin * Z_BIN_W + Z_BIN_W;
        colliders.push({ x0: xS, x1: xE, z0: minZ, z1: backZ, h: outerH, climbable: false });
      }
    }
  }).catch((err) => {
    console.warn('[mapGarage3d] garage GLB load failed — fallback box', err);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(GARAGE_TARGET_X, GARAGE_TARGET_Y, GARAGE_TARGET_Z),
      pbr.building({ color: 0x555250 })
    );
    box.position.y = GARAGE_TARGET_Y / 2 + FLOOR_OFFSET;
    garageGroup.add(box);
  });
  // Barriers
  const vehicleSpawns = [
    { x: INTERIOR_CX, z: -INTERIOR_HALF_Z + 4.5, yaw: 0 },
    { x: INTERIOR_CX + 6, z: -INTERIOR_HALF_Z + 4.5, yaw: 0, kind: 'quota' },
  ];
  const BARRIER_LAYOUT = [
    { x: -10, z: 22, yaw: 0 }, { x: 0, z: 25, yaw: 0 }, { x: 10, z: 22, yaw: 0 },
    { x: -20, z: 18, yaw: -Math.PI / 4 }, { x: 20, z: 18, yaw: Math.PI / 4 },
    { x: -12, z: -28, yaw: Math.PI / 2 }, { x: 12, z: -28, yaw: Math.PI / 2 },
    { x: 0, z: -34, yaw: 0 },
    { x: -30, z: 0, yaw: Math.PI / 2 }, { x: 30, z: 0, yaw: Math.PI / 2 },
    { x: -28, z: 28, yaw: Math.PI / 4 }, { x: 28, z: 28, yaw: -Math.PI / 4 },
  ];
  for (const spec of BARRIER_LAYOUT) {
    const holder = new THREE.Group();
    stream.addEssential(holder);
    spawnBarrier(holder, colliders, spec);
  }
  // Spawns (slightly lowered if needed)
  const spawns = {
    A: [
      { x: INTERIOR_CX + 1.5, z: 1, yaw: 0 },
      { x: INTERIOR_CX + 1.5, z: 3, yaw: 0 },
    ],
    B: [
      { x: INTERIOR_CX - 1.5, z: 1, yaw: 0 },
      { x: INTERIOR_CX - 1.5, z: 3, yaw: 0 },
    ],
  };
  // sceneImport.js's purgeOriginalMap looks for this global to know
  // what the CURRENT map added, so it can strip that geometry out
  // before an imported .glb replaces it. Without this line, that
  // lookup always finds nothing, always takes its safe append-only
  // fallback, and old structural geometry (garage/road/sidewalk/
  // fences/barriers) never actually gets removed on re-import —
  // which is exactly the "kept the old meshes" symptom.
  if (typeof window !== 'undefined') window.__brawl3dMapStream = stream;

  return { colliders, spawns, half: GARAGE_HALF, stream, vehicleSpawns };
}
export function garagePickupSpawns() {
  return [
    { id: 'garage_tec9_a', wpn: 'tec9', x: 7, z: 15, ammo: 50 },
    { id: 'garage_tec9_b', wpn: 'tec9', x: -7, z: 15, ammo: 50 },
    { id: 'garage_shotgun', wpn: 'shotgun', x: 0, z: 28, ammo: 8 },
    { id: 'garage_ak47_a', wpn: 'ak47', x: -22, z: 8, ammo: 30 },
    { id: 'garage_ak47_b', wpn: 'ak47', x: 22, z: 8, ammo: 30 },
    { id: 'garage_pipe', wpn: 'pipebomb', x: 0, z: -32, ammo: 3 },
  ];
}