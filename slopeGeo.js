// slopeGeo.js — buffer geometry helpers for slope colliders.
//
// Used by both:
//   • mapCustom3d.js (runtime map renderer) — builds the visual
//     meshes for RAMP and HILL objects saved on the map doc.
//   • MapEditor3D.jsx (editor viewport) — matches the runtime look
//     so what the designer sees is what the players get.
//
// Coordinate convention:
//   Mesh origin is at the CENTER of the box footprint at ground
//   (y=0). Callers position the mesh via `mesh.position.set(cx, 0,
//   cz)`. The mesh's Y extents run from 0 up to the peak height
//   (yStart / yEnd for wedges, peakHeight for hills). This keeps
//   the visual mesh perfectly aligned with the AABB collider
//   which uses `yBase=0` and `h=max(yStart, yEnd)`.
//
// Both geometries return an indexed BufferGeometry with computed
// vertex normals, ready for MeshLambertMaterial + optional texture.

import * as THREE from 'three';

/**
 * Wedge / ramp geometry.
 *
 * A box with a TILTED top face — the top varies from `yStart` on
 * one side to `yEnd` on the other, along the specified `axis`.
 * Great for driveways, pedestrian ramps, connectors between two
 * elevation levels.
 *
 * @param {number} w      Footprint width (X extent, m).
 * @param {number} d      Footprint depth (Z extent, m).
 * @param {number} yStart Height at the LOW side of the axis (m).
 * @param {number} yEnd   Height at the HIGH side of the axis (m).
 * @param {'x'|'z'} axis  Which axis the tilt runs along.
 * @returns {THREE.BufferGeometry}
 */
export function wedgeGeometry(w, d, yStart, yEnd, axis = 'x') {
  const hw = w / 2, hd = d / 2;
  // 8 vertices — 4 on bottom face (y=0), 4 on tilted top face.
  // Layout is consistent for both axes: verts 0-3 are the bottom
  // corners in (−X, +X, −X, +X) × (−Z, −Z, +Z, +Z) order; verts
  // 4-7 are the same corners lifted to the appropriate tilted Y.
  let v;
  if (axis === 'z') {
    // Tilt runs along Z: Z− side sits at yStart, Z+ side at yEnd.
    v = new Float32Array([
      -hw, 0, -hd,   +hw, 0, -hd,   -hw, 0, +hd,   +hw, 0, +hd,      // bottom
      -hw, yStart, -hd, +hw, yStart, -hd, -hw, yEnd, +hd, +hw, yEnd, +hd,  // top
    ]);
  } else {
    // Tilt runs along X: X− side sits at yStart, X+ side at yEnd.
    v = new Float32Array([
      -hw, 0, -hd,   +hw, 0, -hd,   -hw, 0, +hd,   +hw, 0, +hd,      // bottom
      -hw, yStart, -hd, +hw, yEnd, -hd, -hw, yStart, +hd, +hw, yEnd, +hd, // top
    ]);
  }
  // 12 triangles — CCW when viewed from OUTSIDE the box.
  //   bottom (normal −Y): looked at from below, verts wind CCW
  //   top    (normal +Y): looked at from above, verts wind CCW
  //   +X, −X, +Z, −Z sides: standard box winding
  const idx = new Uint16Array([
    0, 1, 3,  0, 3, 2,          // bottom (viewed from below is CCW)
    4, 6, 7,  4, 7, 5,          // top
    0, 4, 5,  0, 5, 1,          // −Z side
    2, 3, 7,  2, 7, 6,          // +Z side
    0, 2, 6,  0, 6, 4,          // −X side
    1, 5, 7,  1, 7, 3,          // +X side
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Hill / radial-mound geometry.
 *
 * Subdivided plane deformed into a smoothstep-profiled dome. The
 * peak is at the centre of the plane; the perimeter clamps to y=0.
 * Vertex resolution is controlled by `segments` (default 24 per
 * side = 625 verts, 1152 tris — plenty for a smooth silhouette).
 *
 * IMPORTANT: this must be paired with a slope collider whose
 * bounding box exactly matches the plane footprint (2*radius on
 * each side) and uses `axis: 'r'` with `yStart=peakHeight`,
 * `yEnd=0`. The engine's `topAt` uses the same smoothstep
 * formula so the walkable surface tracks the visual mesh
 * perfectly.
 *
 * @param {number} radius     Hill radius (m).
 * @param {number} peakHeight Peak height above the base (m).
 * @param {number} segments   Subdivisions per side (default 24).
 * @returns {THREE.BufferGeometry}
 */
export function hillGeometry(radius, peakHeight, segments = 24) {
  const size = radius * 2;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  // Rotate the plane so it lies in XZ (default PlaneGeometry lives
  // in XY with normal +Z). After this, vertex Y is height.
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rNorm = Math.min(1, Math.hypot(x, z) / radius);
    const t = 1 - rNorm;
    const s = t * t * (3 - 2 * t);         // smoothstep 0..1
    pos.setY(i, s * peakHeight);
  }
  geo.computeVertexNormals();
  return geo;
}
