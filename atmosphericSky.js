// atmosphericSky.js — big, distant, physically-motivated sky dome +
// time-of-day presets shared between MapEditor3D and mapCustom3d
// runtime. The dome is a huge 3000 m radius sphere with vertex-color
// gradient bands so it reads as an infinitely far skybox regardless
// of how far the camera zooms out or how high a player climbs.
//
// Design notes:
//   • Vertex colors (not a ShaderMaterial) so WebGPURenderer's
//     NodeMaterial path stays quiet — same reason `skyDome.js`
//     uses vertex colors.
//   • Three bands: HORIZON (bottom), MID (~30° up), ZENITH (top).
//     Each preset picks a colour triple that captures real
//     atmospheric scattering at that sun elevation.
//   • `sunColor` + `sunIntensity` drive both the DirectionalLight
//     the editor spawns AND a visible sun-disc billboard that
//     tracks the light's position. Night presets swap the disc
//     for a smaller cool-white moon.
//   • Fog values are supplied so the horizon fades into the fog
//     tint at low altitude — a critical "AAA" cue that separates
//     rendered box arenas from flat-shaded box arenas.
import * as THREE from 'three';

// ── Curated time-of-day presets. Each preset is a *complete*
// world config that stamps sun / hemisphere / ambient / fog / sky
// into the map doc when applied.
export const TIME_OF_DAY_PRESETS = {
  DAWN: {
    label: 'DAWN',
    icon: 'fa-cloud-sun',
    sky: '#3a1e50',
    sky_bands: { horizon: '#ff9060', mid: '#c86080', zenith: '#38246a' },
    sun:        { color: '#ffcc90', intensity: 0.8, azimuth: 0.6,  elevation: 0.18, shadow: false },
    hemisphere: { sky_color: '#ffc0a0', ground_color: '#3a2028', intensity: 1.0 },
    ambient:    { color: '#a89678', intensity: 0.55 },
    fog:        { color: '#4a2e40', near: 80, far: 260 },
    stars: false,
  },
  MORNING: {
    label: 'MORNING',
    icon: 'fa-sun',
    sky: '#7ab0ea',
    sky_bands: { horizon: '#c8e6ff', mid: '#7ab0ea', zenith: '#204a90' },
    sun:        { color: '#fff2d0', intensity: 1.6, azimuth: 0.9,  elevation: 0.6, shadow: false },
    hemisphere: { sky_color: '#c8dcff', ground_color: '#6a5040', intensity: 1.15 },
    ambient:    { color: '#ffe8c0', intensity: 0.6 },
    fog:        { color: '#a8c4e0', near: 120, far: 340 },
    stars: false,
  },
  NOON: {
    label: 'NOON',
    icon: 'fa-circle',
    sky: '#4090e0',
    sky_bands: { horizon: '#a8d4ff', mid: '#4090e0', zenith: '#0e3078' },
    sun:        { color: '#ffffff', intensity: 2.4, azimuth: 0.2,  elevation: 1.35, shadow: false },
    hemisphere: { sky_color: '#b0d0ff', ground_color: '#5a5a5a', intensity: 1.3 },
    ambient:    { color: '#ffffff', intensity: 0.7 },
    fog:        { color: '#a8c8ea', near: 160, far: 420 },
    stars: false,
  },
  GOLDEN: {
    label: 'GOLDEN HOUR',
    icon: 'fa-cloud-sun',
    sky: '#8c3050',
    sky_bands: { horizon: '#ffb060', mid: '#c85078', zenith: '#4a1c60' },
    sun:        { color: '#ffa860', intensity: 1.8, azimuth: 1.35, elevation: 0.32, shadow: false },
    hemisphere: { sky_color: '#ffc890', ground_color: '#3a1a3a', intensity: 1.1 },
    ambient:    { color: '#ffd0a0', intensity: 0.65 },
    fog:        { color: '#7a3a48', near: 90, far: 280 },
    stars: false,
  },
  SUNSET: {
    label: 'SUNSET',
    icon: 'fa-cloud-moon',
    sky: '#4a1a5c',
    sky_bands: { horizon: '#d04030', mid: '#8a2a5a', zenith: '#28104a' },
    sun:        { color: '#ff6a3a', intensity: 1.1, azimuth: 1.55, elevation: 0.09, shadow: false },
    hemisphere: { sky_color: '#ff8060', ground_color: '#2a1030', intensity: 1.0 },
    ambient:    { color: '#ff9080', intensity: 0.55 },
    fog:        { color: '#4a1a3a', near: 70, far: 230 },
    stars: false,
  },
  NIGHT: {
    label: 'NIGHT',
    icon: 'fa-moon',
    sky: '#050614',
    sky_bands: { horizon: '#101828', mid: '#08101f', zenith: '#020210' },
    sun:        { color: '#c8d8ff', intensity: 0.35, azimuth: -0.4, elevation: 0.65, shadow: false }, // moonlight
    hemisphere: { sky_color: '#405878', ground_color: '#101018', intensity: 0.75 },
    ambient:    { color: '#4a5a80', intensity: 0.35 },
    fog:        { color: '#050614', near: 60, far: 200 },
    stars: true,
  },
  STORMY: {
    label: 'STORMY',
    icon: 'fa-cloud-bolt',
    sky: '#2a2a3a',
    sky_bands: { horizon: '#4a4a58', mid: '#2c2c38', zenith: '#181820' },
    sun:        { color: '#b8b8c8', intensity: 0.5, azimuth: 0.6, elevation: 0.8, shadow: false },
    hemisphere: { sky_color: '#7a7a8c', ground_color: '#3a3a4a', intensity: 1.0 },
    ambient:    { color: '#8a8a98', intensity: 0.6 },
    fog:        { color: '#3a3a44', near: 30, far: 130 },
    stars: false,
  },
};

// ── Build a HUGE atmospheric sky dome (radius 3000 m by default so
// the horizon reads as infinitely distant even when the camera pulls
// all the way back for a HALF=400 arena). Three vertex-color bands:
//   • bottom cap  → HORIZON tint
//   • equator     → MID tint
//   • top cap     → ZENITH tint
// Bands blended with a smoothstep so there's no visible seam. The
// dome renders FIRST (renderOrder = -1000) with depthWrite:false so
// EVERY other scene object composites correctly on top.
export function buildAtmosphericSky(bands, { radius = 2400, stars = false } = {}) {
  const horizon = new THREE.Color(bands.horizon || '#ff9060');
  const mid     = new THREE.Color(bands.mid     || '#8a5060');
  const zenith  = new THREE.Color(bands.zenith  || '#1a0a30');

  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const pos = geo.attributes.position;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;           // -1 .. 1 (bottom .. top)
    // t=0 at horizon (y=0), t=1 at zenith (y=1), t=-0.5 below the horizon
    // Squash into 0..1 range for gradient sampling; below-horizon tinted
    // toward horizon.
    const t = Math.max(-0.3, Math.min(1, y));
    let c;
    if (t < 0) {
      // Below horizon — fade horizon toward a slightly darker ground fog.
      c = tmp.copy(horizon).multiplyScalar(0.7);
    } else if (t < 0.35) {
      // horizon → mid (smoothstep)
      const u = smoothstep(0, 0.35, t);
      c = tmp.copy(horizon).lerp(mid, u);
    } else {
      // mid → zenith (smoothstep, slower toward top)
      const u = smoothstep(0.35, 1.0, t);
      c = tmp.copy(mid).lerp(zenith, u);
    }
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,                             // sky must NEVER receive fog
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1000;
  dome.name = 'atmosphericSkyDome';

  // Optional star field for NIGHT preset — a lightweight Points mesh
  // scattered on an inner sphere so they occlude gracefully behind
  // the sun/moon geometry.
  if (stars) {
    const starCount = 800;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starSize = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      // Distribute uniformly on a sphere hemisphere (upper half only —
      // stars below the horizon would be hidden by the ground plane
      // anyway).
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - 2 * v);
      const r = radius * 0.92;
      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = Math.abs(r * Math.cos(phi));    // upper hemisphere only
      const sz = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3]     = sx;
      starPos[i * 3 + 1] = sy;
      starPos[i * 3 + 2] = sz;
      starSize[i] = Math.random() * 3 + 1;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    starPoints.renderOrder = -999;
    starPoints.name = 'atmosphericStars';
    dome.add(starPoints);
  }
  return dome;
}

// ── Visible sun disc that follows the DirectionalLight position.
// A billboard-facing sprite is overkill here — a small emissive
// sphere on a fixed direction ray works fine because the sky dome
// is HUGE (r=3000) so parallax vanishes. Caller must position it
// along `sun.position.clone().normalize().multiplyScalar(distance)`.
export function buildSunDisc(color = '#fff5c8', { radius = 40, distance = 2100, isMoon = false } = {}) {
  const geo = new THREE.SphereGeometry(radius, 24, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    fog: false,
    depthWrite: false,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -998;
  mesh.name = isMoon ? 'moonDisc' : 'sunDisc';
  mesh.userData.distance = distance;

  // Optional glow halo — a larger, translucent sphere behind the
  // sun for the "corona" effect. Small perf cost, big AAA payoff.
  const haloGeo = new THREE.SphereGeometry(radius * 2.4, 20, 20);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    fog: false,
    depthWrite: false,
    transparent: true,
    opacity: isMoon ? 0.18 : 0.35,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = -999;
  mesh.add(halo);
  return mesh;
}

// Position a sun/moon disc from a sun descriptor (azimuth + elevation).
export function positionCelestialBody(mesh, { azimuth = 0.35, elevation = 0.3 }) {
  const distance = mesh.userData.distance || 2100;
  mesh.position.set(
    distance * Math.cos(elevation) * Math.sin(azimuth),
    distance * Math.sin(elevation),
    distance * Math.cos(elevation) * Math.cos(azimuth),
  );
}

// ── Interior-vs-exterior lighting inference. Called by the runtime
// when a player enters a building (per-frame check): if the player
// is inside the AABB of a building, DIM the exterior lights and
// LIFT the interior AO ambient. Purely additive — implemented as an
// optional interior brightness scaler exposed here so both editor
// and runtime can call the same helper.
export function computeIndoorFactor(px, pz, py, buildingBounds) {
  for (const b of buildingBounds || []) {
    if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1 &&
        py >= b.yBase && py <= b.yTop) {
      return 1.0;
    }
  }
  return 0.0;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
