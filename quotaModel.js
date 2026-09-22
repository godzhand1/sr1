// QuotaModel — shared cache for the police "Quota" 3-wheeled cruiser GLB.
// Follows the same preload / template / clone pattern used by
// pipeBombModel.js (see comments there for rationale).
//
// Physical characteristics (per user spec):
//   • 3 wheels — 2 in the back, 1 in the front (asymmetric trike-cop)
//   • 2 seats — driver + passenger (matches base vehicle system)
//   • "Decent speed" — slightly faster than the standard testcar
//   • Right-stick click (R3) toggles the red/blue emergency lights
//
// The GLB contains its own three wheels — the vehicle template does
// not need to procedurally add wheels. What we DO add procedurally
// is the emergency-light rig (two small colored point-lights + tiny
// spheres) so the toggle can flash red-and-blue on top of the model.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Decimated in Blender (compress_glb.py): 502k → 44k tris, 4K → 1K
// textures, 17 MB → 2 MB. The Tripo source is archived at
// https://customer-assets-4nw71qhi.emergentagent.net/job_map-editor/artifacts/ibn30c97_police%20vehicle%203d%20model.glb
const QUOTA_URL = '/vehicles/quota.glb';

let _template = null;
let _loadPromise = null;

function _computeFitScale(scene) {
  // Fit the mesh so its LENGTH (Z axis in car-local frame) matches
  // the standard testcar length of ~5.0m. This keeps the trike
  // proportional to the arena and consistent with the driver-door
  // door-radius / AABB collider math already tuned for that size.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const target = 5.0;
  return target / longest;
}

export function preloadQuota() {
  if (_template || _loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      QUOTA_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        // Meshy PBR pass — bump metallic reflectance for the chrome
        // and add environment-map awareness so the vehicle catches
        // arena sky under any lighting.
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              if (o.material.metalness != null) o.material.metalness = Math.max(o.material.metalness, 0.35);
              if (o.material.roughness != null) o.material.roughness = Math.min(o.material.roughness, 0.55);
            }
          }
        });
        const fitScale = _computeFitScale(scene);
        // Compute vertical offset so the wheels sit at y=0 after
        // fitScale is applied. The template box.min.y multiplied by
        // fitScale gives the amount to lift the group.
        const preBox = new THREE.Box3().setFromObject(scene);
        const yLift = -preBox.min.y * fitScale;
        _template = { scene, fitScale, yLift };
        resolve(_template);
      },
      undefined,
      (err) => {
        console.warn('[quotaModel] GLB load failed, will use procedural fallback', err);
        _template = null;
        resolve(null);
      },
    );
  });
  return _loadPromise;
}

export function getQuotaTemplate() {
  return _template;
}

// Clone the shipped GLB scene for a fresh vehicle instance. Returns
// null while the fetch is still in-flight; callers should keep the
// procedural fallback visible until this returns a mesh.
export function cloneQuotaMesh() {
  if (!_template) return null;
  const g = _template.scene.clone(true);
  g.scale.setScalar(_template.fitScale);
  g.position.y = _template.yLift;
  // The shipped police GLB was authored with its forward along +Z,
  // but the vehicle system's "forward" is -Z (see how yaw + drive
  // impulse compute vx/vz in engine3d._updateMyVehicle). Rotate 180°
  // so the trike faces the direction it's driven.
  g.rotation.y = Math.PI;
  return g;
}
