// VenomCar — shared cache for the compressed Corvette Stingray GLB
// (arena nickname: "Venom").
//
// Follows the same preload/template/clone pattern as quotaModel.js
// and dirtBike.js — a Meshy AI PBR asset served from /public/vehicles/.
//
// Physical characteristics (per user spec):
//   • 2-seater sports car
//   • Sharp acceleration (quicker than the testcar)
//   • Sharper turning radius
//   • Player spawns AT the Venom on match start
//
// The GLB is served from /public/vehicles/venom.glb (a headless-
// blender-compressed 3.9 MB build of the original 78 MB source).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const VENOM_URL = '/vehicles/venom.glb';

let _template = null;
let _loadPromise = null;

function _computeFitScale(scene) {
  // Fit the car so its LONGEST axis matches the standard testcar
  // length of ~5.0m — keeps the vehicle template proportional to
  // the arena and consistent with existing collider math.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const target = 5.0;
  return target / longest;
}

export function preloadVenom() {
  if (_template || _loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      VENOM_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        // PBR touch-up for the arena lighting — bump metallic on the
        // chassis so the sports-car paint reads shiny, keep roughness
        // moderate so headlight highlights still glint properly.
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              if (o.material.metalness != null) o.material.metalness = Math.max(o.material.metalness, 0.45);
              if (o.material.roughness != null) o.material.roughness = Math.min(o.material.roughness, 0.5);
            }
          }
        });
        const fitScale = _computeFitScale(scene);
        const preBox = new THREE.Box3().setFromObject(scene);
        const yLift = -preBox.min.y * fitScale;
        _template = { scene, fitScale, yLift };
        resolve(_template);
      },
      undefined,
      (err) => {
        console.warn('[venom] GLB load failed, using procedural fallback', err);
        _template = null;
        resolve(null);
      },
    );
  });
  return _loadPromise;
}

export function getVenomTemplate() {
  return _template;
}

// Clone the shipped Venom scene for a fresh vehicle instance.
// Returns null while the fetch is still in-flight — the vehicle
// system falls back to a procedural sports car until this loads.
export function cloneVenomMesh() {
  if (!_template) return null;
  const g = _template.scene.clone(true);
  g.scale.setScalar(_template.fitScale);
  g.position.y = _template.yLift;
  // The Meshy Corvette Stingray ships authored with its long axis
  // along X (verified via Blender bbox inspection:
  //   X=1.90m len, Y=0.80m, Z=0.53m).
  // Vehicle-system forward is +Z, so rotate +90° around Y to align
  // the long axis with the driving direction. If the car drives
  // rear-first in-arena, add another π here to flip 180°.
  g.rotation.y = Math.PI / 2;
  return g;
}
