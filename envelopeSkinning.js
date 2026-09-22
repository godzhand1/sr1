// Envelope-based auto-skinning.
//
// Given a mesh geometry (position attribute in world space) and a
// list of bone segments {head, tail}, produces two BufferAttributes
// suitable for a THREE.SkinnedMesh:
//   • skinIndex — Uint16Array of length numVerts*4, top-4 bone
//                 indices per vertex
//   • skinWeight — Float32Array of length numVerts*4, normalized
//                  bone weights that sum to 1
//
// Algorithm — inverse-squared distance falloff on point-to-segment:
//   1. For each vertex, compute distance to each bone segment (closest
//      point on the head-tail line, clamped to [head, tail]).
//   2. Weight per bone = 1 / (dist² + ε).
//   3. Keep the top 4 weights, normalize so they sum to 1.
//   4. Write into skinIndex / skinWeight buffers.
//
// This is the same "envelope skinning" Blender's Object → Parent →
// With Envelope Weights uses. Produces clean results on humanoid
// meshes; the visible artifacts are on very thin geometry (fingers)
// or fabric that overlaps multiple bones. For those, the user can
// re-weight in Blender after import.
//
// Cost: O(numVerts * numBones). For a 20-bone humanoid on a 20k-vert
// mesh that's 400k distance calcs — fast enough to run synchronously
// in the browser (~50 ms).

import * as THREE from 'three';

const EPS = 1e-6;

// Distance from point `p` to line segment `a→b`. Returns the
// squared distance (avoids the sqrt where the caller squares it
// again for the weight).
function pointToSegmentDist2(px, py, pz, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq < EPS) {
    // Degenerate segment — treat as a point.
    const ex = px - ax, ey = py - ay, ez = pz - az;
    return ex * ex + ey * ey + ez * ez;
  }
  const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq;
  const clamped = Math.max(0, Math.min(1, t));
  const cx = ax + clamped * dx;
  const cy = ay + clamped * dy;
  const cz = az + clamped * dz;
  const ex = px - cx, ey = py - cy, ez = pz - cz;
  return ex * ex + ey * ey + ez * ez;
}

// Public — bake skin weights into a geometry.
//
// Params:
//   geometry — THREE.BufferGeometry with a `position` attribute (in
//              LOCAL space; caller must apply the mesh's world
//              matrix first if the skeleton is in world coords).
//              Modified in place: `skinIndex` + `skinWeight`
//              attributes are set/replaced.
//   segments — array of { head: Vector3, tail: Vector3 } in the
//              SAME coordinate frame as the geometry positions.
//   numJointsPerVertex — 4 (glTF standard); larger not supported by
//              MeshStandardMaterial's shader.
//
// Returns { computedVerts, computedBones } for status logging.
export function bakeEnvelopeSkinning(geometry, segments, numJointsPerVertex = 4) {
  const pos = geometry.attributes.position;
  if (!pos) throw new Error('bakeEnvelopeSkinning: geometry missing position attribute');
  const numVerts = pos.count;
  const numBones = segments.length;
  if (numBones === 0) throw new Error('bakeEnvelopeSkinning: no bone segments provided');

  const skinIndexArr = new Uint16Array(numVerts * numJointsPerVertex);
  const skinWeightArr = new Float32Array(numVerts * numJointsPerVertex);

  // Scratch storage for the top-K per vertex.
  const topIdx = new Array(numJointsPerVertex);
  const topWgt = new Array(numJointsPerVertex);

  for (let v = 0; v < numVerts; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);

    for (let k = 0; k < numJointsPerVertex; k++) {
      topIdx[k] = 0;
      topWgt[k] = 0;
    }

    for (let b = 0; b < numBones; b++) {
      const s = segments[b];
      const dist2 = pointToSegmentDist2(
        px, py, pz,
        s.head.x, s.head.y, s.head.z,
        s.tail.x, s.tail.y, s.tail.z,
      );
      const w = 1 / (dist2 + EPS);
      // Insertion into top-K sorted by weight (largest first).
      // Only 4 slots so the manual comparison beats a heap.
      let insertAt = -1;
      for (let k = 0; k < numJointsPerVertex; k++) {
        if (w > topWgt[k]) { insertAt = k; break; }
      }
      if (insertAt >= 0) {
        // Shift the tail down by one slot to make room.
        for (let k = numJointsPerVertex - 1; k > insertAt; k--) {
          topWgt[k] = topWgt[k - 1];
          topIdx[k] = topIdx[k - 1];
        }
        topWgt[insertAt] = w;
        topIdx[insertAt] = b;
      }
    }

    // Normalize top-K weights so they sum to 1. If the vertex
    // happens to be exactly on a bone (weight = ∞), the +ε in the
    // denominator keeps things finite and normalization still works.
    let sum = 0;
    for (let k = 0; k < numJointsPerVertex; k++) sum += topWgt[k];
    if (sum < EPS) {
      // Every distance was ~∞ — should never happen, but be safe:
      // dump 100% into the root (bone 0).
      skinIndexArr[v * numJointsPerVertex] = 0;
      skinWeightArr[v * numJointsPerVertex] = 1;
      continue;
    }
    const inv = 1 / sum;
    for (let k = 0; k < numJointsPerVertex; k++) {
      skinIndexArr[v * numJointsPerVertex + k] = topIdx[k];
      skinWeightArr[v * numJointsPerVertex + k] = topWgt[k] * inv;
    }
  }

  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndexArr, numJointsPerVertex));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeightArr, numJointsPerVertex));

  return { computedVerts: numVerts, computedBones: numBones };
}
