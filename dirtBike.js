// DirtBike — shared cache for the compressed dirt bike GLB.
//
// Follows the same preload/template/clone pattern as quotaModel.js
// (a shipped Meshy asset served from /public/vehicles/).
//
// Physical characteristics (per user spec):
//   • 2 wheels (front + rear), motocross frame with tall handlebars
//   • 2 seats — driver in the middle, passenger on the back seat
//   • Wheelie: pop the front wheel up (hold SHIFT / LT)
//   • Hop: brief lift off the ground (SPACE / X button)
//   • Rider auto-poses to grip the bars — 1-handed while holding a gun,
//     2-handed while unarmed (fists / bat drop, character just rides)
//
// The GLB is served from /public/vehicles/dirt_bike.glb (a headless-
// blender-compressed 3.9 MB build of the original 123 MB source).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DIRT_BIKE_URL = '/vehicles/dirt_bike.glb';

let _template = null;
let _loadPromise = null;
// Bike anchor points computed from the model bounds — filled during
// preload so the engine can query seat and handlebar positions in
// bike-local space (X=right, Y=up, Z=forward).
let _anchors = null;

function _computeFitScale(scene) {
  // Fit the bike so its LONGEST axis is ~2.4m — a real dirt bike is
  // ~2.15m long, add a little pad for larger-than-life arena scale.
  // Also matches the collider math (BIKE_HALF_LEN below in vehicles3d).
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const target = 2.4;
  return target / longest;
}

export function preloadDirtBike() {
  if (_template || _loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      DIRT_BIKE_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        // PBR touch-up — Meshy assets tend to author roughness/metallic
        // on the flat side. Nudge for arena lighting so the frame
        // catches highlights without going full chrome.
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              if (o.material.metalness != null) o.material.metalness = Math.min(o.material.metalness, 0.35);
              if (o.material.roughness != null) o.material.roughness = Math.max(o.material.roughness, 0.45);
            }
          }
        });
        const fitScale = _computeFitScale(scene);
        // Pre-fit measurement to compute per-side anchor positions in
        // WORLD-space at the requested scale — we then bake the
        // group's fitScale into everything so the engine can consume
        // anchor offsets as-is.
        const preBox = new THREE.Box3().setFromObject(scene);
        const size = new THREE.Vector3();
        preBox.getSize(size);
        const yLift = -preBox.min.y * fitScale;
        // Approximate seat / handlebar positions from the fitted bbox.
        // Values were tuned to match the visible motocross layout.
        const fitLen = size.z * fitScale;
        const fitHeight = size.y * fitScale;
        _anchors = {
          driverSeat:    { x: 0.0, y: fitHeight * 0.60, z: 0.0 },
          passengerSeat: { x: 0.0, y: fitHeight * 0.60, z: -fitLen * 0.28 },
          leftGrip:      { x: -0.32, y: fitHeight * 0.90, z: fitLen * 0.32 },
          rightGrip:     { x:  0.32, y: fitHeight * 0.90, z: fitLen * 0.32 },
          frontWheel:    { x: 0.0,   y: 0.0, z: fitLen * 0.40 },
          rearWheel:     { x: 0.0,   y: 0.0, z: -fitLen * 0.36 },
        };
        _template = { scene, fitScale, yLift };
        resolve(_template);
      },
      undefined,
      (err) => {
        console.warn('[dirtBike] GLB load failed, using procedural fallback', err);
        _template = null;
        resolve(null);
      },
    );
  });
  return _loadPromise;
}

export function getDirtBikeTemplate() {
  return _template;
}

export function getDirtBikeAnchors() {
  return _anchors;
}

// Clone the shipped dirt-bike scene for a fresh vehicle instance.
// Returns null while the fetch is still in-flight — the vehicle
// system falls back to a procedural bike until this loads.
export function cloneDirtBikeMesh() {
  if (!_template) return null;
  const g = _template.scene.clone(true);
  g.scale.setScalar(_template.fitScale);
  g.position.y = _template.yLift;
  // Meshy AI shipped this dirt bike with its LONG axis along X and
  // the handlebars on the -X side. Vehicle-system convention is
  // forward = +Z (at yaw=0 the physics moves the bike along +Z).
  // Rotating the model +90° around Y remaps its -X (handlebars)
  // to +Z (world forward). Verified by Blender bbox inspection:
  //   X: 1.90m (length)   Y: 0.67m (height)   Z: 1.11m (width)
  //   -X half top = 0.34   +X half top = 0.18  (bars on -X)
  g.rotation.y = Math.PI / 2;
  return g;
}
