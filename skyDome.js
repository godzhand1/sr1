// Vertex-color sky dome helper.  WebGPURenderer's NodeMaterial system
// chokes on classical ShaderMaterial — we sidestep the issue by baking
// the dusk gradient into the dome's vertex colors and using a plain
// MeshBasicMaterial with vertexColors enabled.  Identical look, zero
// warnings on either backend.
//
// `buildSkyDome` keeps the gradient fallback. `buildSkyDomeTextured`
// wraps an equirectangular sky panorama around the sphere — used once
// the AI-generated `sunset_sky` PNG finishes streaming in. Caller can
// hot-swap the dome to upgrade visuals without rebuilding the arena.
import * as THREE from 'three';

export function buildSkyDome({ radius = 400, low = '#8c4030', high = '#1a1538' } = {}) {
  const geo = new THREE.SphereGeometry(radius, 16, 8);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const lo = new THREE.Color(low);
  const hi = new THREE.Color(high);
  const tmp = new THREE.Color();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, y / radius));
    tmp.copy(lo).lerp(hi, Math.pow(t, 0.6));
    colors[i * 3]     = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.legacySky = true;   // stripped when the physical sky rig takes over
  return mesh;
}

export function buildSkyDomeTextured(texture, { radius = 400 } = {}) {
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  // Flip the geometry so the texture wraps right-side-up on BackSide.
  geo.scale(-1, 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.legacySky = true;
  return mesh;
}
