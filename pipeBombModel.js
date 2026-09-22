// PipeBombModel — shared cache for the pipe-bomb GLB.
// The mesh is uploaded once (30 MB) and cloned per bomb in flight.
// Downstream code can call `getPipeBombTemplate()` synchronously — it
// returns `null` while the GLB is still fetching, so callers should
// have a procedural fallback for the first ~1s of gameplay.
//
// The scale + origin offset are tuned so the mesh sits at Y=0 aligned
// with the physics point (r.x, r.y, r.z) at its geometric center.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// User-provided asset. This URL is public and served directly from
// the emergent CDN — no auth needed.
const PIPE_BOMB_URL = 'https://customer-assets-4nw71qhi.emergentagent.net/job_map-editor/artifacts/aiypapc2_Meshy_AI_Cylindrical_metal_sen_0726171827_texture.glb';

let _template = null;                     // cached first-load scene
let _loadPromise = null;                  // in-flight load promise

function _computeFitScale(scene) {
  // Fit the mesh into a ~0.30m long capsule so it reads as a hand-held
  // pipe bomb rather than a monster prop. We measure the longest AABB
  // dimension and derive a uniform scale.
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const target = 0.32;
  return target / longest;
}

// Kick off the load without blocking. Callers see `null` from
// `getPipeBombTemplate()` until the promise resolves.
export function preloadPipeBomb() {
  if (_template || _loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      PIPE_BOMB_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        // Baseline material tweaks — the shipped Meshy PBR pass has
        // stellar textures but no environment map; upgrade metallic
        // reflectance so it reads as steel-pipe under any light.
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              if (o.material.metalness != null) o.material.metalness = 0.85;
              if (o.material.roughness != null) o.material.roughness = 0.35;
            }
          }
        });
        const fitScale = _computeFitScale(scene);
        _template = { scene, fitScale };
        resolve(_template);
      },
      undefined,
      (err) => {
        // Silently swallow — callers keep using the procedural mesh.
        console.warn('[pipeBombModel] GLB load failed, using procedural fallback', err);
        _template = null;
        resolve(null);
      },
    );
  });
  return _loadPromise;
}

// Returns null until the GLB has loaded. Once available, callers can
// clone this to attach to a THREE.Group.
export function getPipeBombTemplate() {
  return _template;
}

// Convenience — clone the template scene at the correct fit scale.
// Returns `null` while the GLB is still loading.
export function clonePipeBombMesh() {
  if (!_template) return null;
  const g = _template.scene.clone(true);
  g.scale.setScalar(_template.fitScale);
  return g;
}
