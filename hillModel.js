// HillModel — shared cache for the KOTH "hill" GLB, replacing the
// procedural ring + wall-of-light cylinder that used to mark the
// zone.  User uploaded a game-ready hill mesh; when a player stands
// on it we tint every mesh's `emissive` to that team's color.
//
// Follows the pipeBombModel.js / quotaModel.js pattern: preload once
// at engine boot, clone-on-demand per hill.  Callers should keep a
// tiny procedural fallback ring visible until this loader resolves.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const HILL_URL = 'https://customer-assets-4nw71qhi.emergentagent.net/job_map-editor/artifacts/fc7ewsjy_Meshy_AI_Create_a_game_ready__0726191221_texture.glb';

let _template = null;
let _loadPromise = null;

// Fit the mesh so it fills the caller's target diameter horizontally,
// AND is capped vertically at `maxHeight` (default 1.5m) so its top
// stays within a standing-mantle reach (~1.6m). Non-uniform scale —
// hills naturally squish in height without breaking readability, and
// this keeps the visual footprint matching the KOTH capture zone.
function _computeFitScales(scene, targetDiameter, maxHeight = 1.5) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longestHoriz = Math.max(size.x, size.z) || 1;
  const naturalH = size.y || 1;
  const horizFit = targetDiameter / longestHoriz;
  const naturalV = naturalH * horizFit;         // vertical if we used uniform horiz fit
  const vertFit = naturalV > maxHeight ? (maxHeight / naturalH) : horizFit;
  return { xz: horizFit, y: vertFit };
}

// Kick off the load without blocking. Result cached forever after
// first successful fetch; callers just await this once at engine
// boot (or ignore the promise and read `getHillTemplate()`).
export function preloadHill() {
  if (_template || _loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      HILL_URL,
      (gltf) => {
        const scene = gltf.scene || gltf.scenes[0];
        // Enable shadows + prep every material for emissive tinting.
        // MeshStandardMaterial supports .emissive/.emissiveIntensity;
        // any MeshBasic in the GLB gets swapped to Standard so the
        // team-color glow works uniformly.
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (let i = 0; i < mats.length; i++) {
              let m = mats[i];
              if (!m) continue;
              // If the material lacks `emissive` (e.g. MeshBasicMaterial),
              // clone it into a MeshStandard so we can tint it. This
              // is a one-time promotion per template mesh; clones inherit.
              if (!m.emissive) {
                const upgraded = new THREE.MeshStandardMaterial({
                  map: m.map || null,
                  color: m.color ? m.color.clone() : 0xffffff,
                  metalness: 0.15,
                  roughness: 0.7,
                  emissive: new THREE.Color(0x000000),
                  emissiveIntensity: 0,
                });
                if (Array.isArray(o.material)) o.material[i] = upgraded;
                else o.material = upgraded;
              } else {
                m.emissive = m.emissive || new THREE.Color(0x000000);
                m.emissiveIntensity = 0;
                // Save the base non-emissive color so we can restore
                // it if the hill goes neutral again (never returns to
                // "grey" through emissive alone).
                m.userData._hillBaseColor = m.color ? m.color.getHex() : 0xffffff;
              }
            }
          }
        });
        _template = { scene };
        resolve(_template);
      },
      undefined,
      (err) => {
        console.warn('[hillModel] GLB load failed, will use procedural fallback', err);
        _template = null;
        resolve(null);
      },
    );
  });
  return _loadPromise;
}

export function getHillTemplate() {
  return _template;
}

/**
 * Clone the shipped hill mesh, fit to the caller's target diameter
 * (2× the hill's control radius). Returns null while loading.
 */
export function cloneHillMesh(targetDiameter) {
  if (!_template) return null;
  const g = _template.scene.clone(true);
  // Deep-clone materials so per-hill tinting doesn't leak across
  // multiple hills in the same match. (Three.js .clone() reuses
  // materials by default.)
  g.traverse((o) => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material = o.material.map(m => m.clone());
      } else {
        o.material = o.material.clone();
      }
      // Preserve the base-color hint on each cloned material so
      // `applyHillTint` can restore neutral state cleanly.
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.userData && m.userData._hillBaseColor == null) {
          m.userData._hillBaseColor = m.color ? m.color.getHex() : 0xffffff;
        }
      }
    }
  });
  const s = _computeFitScales(g, targetDiameter);
  g.scale.set(s.xz, s.y, s.xz);
  // Anchor to the arena floor. Some GLBs are authored with min.y ≠ 0;
  // lift the group so wheels/base sit on y=0.
  const preBox = new THREE.Box3().setFromObject(g);
  g.position.y = -preBox.min.y;
  return g;
}

/**
 * Apply a team-color emissive tint to every mesh in a cloned hill.
 * Called each frame from Brawl3DGame's render loop.
 *   • `hex` — target emissive color (team color, contested yellow, or 0 for neutral)
 *   • `intensity` — 0..1.5 range. Values > 1 push into a glow beyond ambient.
 * A pulse envelope may pass an intensity above 1 to make the mesh
 * visibly "throb" while contested.
 */
export function applyHillTint(hillGroup, hex, intensity) {
  if (!hillGroup) return;
  hillGroup.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.emissive) {
        m.emissive.setHex(hex);
        m.emissiveIntensity = intensity;
      }
    }
  });
}
