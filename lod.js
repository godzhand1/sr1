// Team Gangsta Brawl — LOD + GPU-instancing helpers.
//
// LOD (Level of Detail): three.js has a built-in `THREE.LOD` object
// which swaps meshes based on camera distance. We wrap it with a
// convenience builder for the common "near / mid / far / cull" case
// so gameplay code just says `buildLod({ near, mid, far, distances })`.
//
// Instancing: many identical props (street lamps, windows, kerbs,
// jersey barriers) can be collapsed into ONE draw call via
// `THREE.InstancedMesh`. Cost per additional instance is a single 4x4
// matrix write — free at scale. Xbox 360 had heavy CPU draw-call
// overhead which is exactly what we're mitigating.

import * as THREE from 'three';

/**
 * Build a THREE.LOD wrapper.
 * @param {object} params
 * @param {THREE.Object3D} params.near   High-detail mesh (0 – distances[0]).
 * @param {THREE.Object3D} [params.mid]  Mid-detail (distances[0] – [1]).
 * @param {THREE.Object3D} [params.far]  Far-detail (distances[1] – [2]).
 * @param {number[]} params.distances    Thresholds in world units.
 */
export function buildLod({ near, mid, far, distances = [30, 80, 200] }) {
  const lod = new THREE.LOD();
  lod.addLevel(near, 0);
  if (mid) lod.addLevel(mid, distances[0]);
  if (far) lod.addLevel(far, distances[1]);
  // Beyond `distances[2]`, cull entirely: an empty group is invisible
  // and skipped by the frustum culler.
  const empty = new THREE.Group();
  empty.visible = false;
  lod.addLevel(empty, distances[2]);
  return lod;
}

/**
 * Build an InstancedMesh from a geometry+material and an array of
 * transforms. Returns the InstancedMesh AND a `setAt(i, {x,y,z,ry,...})`
 * helper for later mutation.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material}       material
 * @param {Array<{x,y,z,rx?,ry?,rz?,sx?,sy?,sz?}>} transforms
 */
export function instanceFromTransforms(geometry, material, transforms) {
  const count = transforms.length;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const tmp = new THREE.Object3D();
  transforms.forEach((t, i) => {
    tmp.position.set(t.x || 0, t.y || 0, t.z || 0);
    tmp.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    tmp.scale.set(t.sx || 1, t.sy || 1, t.sz || 1);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = true;
  // Store the tmp for callers who need to mutate.
  mesh.__tmp = tmp;
  mesh.setAt = (i, t) => {
    tmp.position.set(t.x || 0, t.y || 0, t.z || 0);
    tmp.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    tmp.scale.set(t.sx || 1, t.sy || 1, t.sz || 1);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

/**
 * Configure a directional light for a "two-cascade" shadow feel:
 * a big soft cascade covers the whole play area, and the light is
 * biased to reduce peter-panning on thin geometry (railings, lamp
 * posts).  Real cascaded shadow maps require multiple render targets
 * — this is a single high-res shadow map tuned to feel like a
 * two-cascade split for the play arena.
 */
export function configureShadowedDirLight(light, { arenaHalf = 60, resolution = 2048 } = {}) {
  light.castShadow = true;
  const s = light.shadow;
  s.mapSize.width = resolution;
  s.mapSize.height = resolution;
  const half = arenaHalf * 1.2;   // slight overhang so shadows don't clip at the edge
  s.camera.left = -half;
  s.camera.right = half;
  s.camera.top = half;
  s.camera.bottom = -half;
  s.camera.near = 1;
  s.camera.far = 200;
  s.bias = -0.0005;               // avoids self-shadow acne
  s.normalBias = 0.02;            // avoids peter-panning on thin geo
  s.radius = 2.5;                 // PCF softness
  return light;
}
