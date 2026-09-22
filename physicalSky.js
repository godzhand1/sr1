// physicalSky.js — physically based outdoor lighting rig.
//
//   Sky (Preetham analytic model: Rayleigh + Mie scattering, turbidity,
//   sun disc, horizon haze, procedural clouds)
//     → Sun   DirectionalLight = the sun disc's own irradiance (E·Ω·T),
//              warm at low elevation, white at noon
//     → IBL   PMREM environment map baked FROM the sky (disc removed —
//              the DirectionalLight carries it) so PBR surfaces receive
//              real sky illumination + reflections
//     → Hemi  small HemisphereLight fill from the same irradiance
//     → Haze  scene.fog tinted with the horizon radiance
//     → ACES tone mapping + exposure keyed to a sunlit white surface
//
// The CPU side is a straight port of three's Sky shader so every light
// value is derived from the very sky the camera sees — nothing is a
// hand-picked hex any more. Shared by MapEditor3D and the game runtime.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export const ATMOS_DEFAULTS = Object.freeze({
  model: 'physical',
  elevation: 38,          // degrees above the horizon (negative = night)
  azimuth: 150,           // degrees, clockwise from +Z
  turbidity: 4,           // 1 clear alpine … 20 hazy/smoggy
  rayleigh: 1.6,          // molecular scattering strength (blue sky)
  mieCoefficient: 0.005,  // aerosol scattering (haze / sun glow)
  mieDirectionalG: 0.8,   // forward-scatter lobe of the sun glow
  exposure: null,         // renderer.toneMappingExposure; null = auto (keyed to a sunlit white surface)
  sunIntensity: 1.0,      // multiplier on the derived sun light
  skyIntensity: 1.0,      // scene.environmentIntensity (IBL)
  clouds: 0.35,           // cloud coverage 0..1
  groundAlbedo: 0.25,     // bounce term for the lower hemisphere
  iblSaturation: 0.6,     // sky-light colour saturation for diffuse/IBL (1 = raw Preetham blue; real shade is only mildly blue)
  shadow: true,
  hdrFog: false,          // true when fog is mixed in scene-referred HDR (EffectComposer) instead of after tone mapping
});

export const ATMOS_PRESETS = Object.freeze({
  DAWN:    { elevation: 6,   azimuth: 95,  turbidity: 5,   rayleigh: 2.8, mieCoefficient: 0.004, mieDirectionalG: 0.78, clouds: 0.30 },
  MORNING: { elevation: 28,  azimuth: 120, turbidity: 3,   rayleigh: 1.5, mieCoefficient: 0.005, mieDirectionalG: 0.80, clouds: 0.30 },
  NOON:    { elevation: 72,  azimuth: 180, turbidity: 2.5, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.78, clouds: 0.25 },
  GOLDEN:  { elevation: 10,  azimuth: 250, turbidity: 6,   rayleigh: 2.5, mieCoefficient: 0.003, mieDirectionalG: 0.75, clouds: 0.35 },
  SUNSET:  { elevation: 4,   azimuth: 265, turbidity: 5,   rayleigh: 3.5, mieCoefficient: 0.004, mieDirectionalG: 0.80, clouds: 0.40 },
  NIGHT:   { elevation: -15, azimuth: 300, turbidity: 2,   rayleigh: 1.0, mieCoefficient: 0.003, mieDirectionalG: 0.80, clouds: 0.15 },
  STORMY:  { elevation: 30,  azimuth: 150, turbidity: 14,  rayleigh: 3.5, mieCoefficient: 0.030, mieDirectionalG: 0.70, clouds: 0.85, sunIntensity: 0.30 },
});

// Resolve a doc's world block into physical-sky params. Docs written
// before this system (flat sky colour / legacy sun) are auto-upgraded:
// their time-of-day preset if they had one, NIGHT if they had stars,
// otherwise NOON — keeping the legacy sun azimuth so shadows still
// fall the way the author placed them.
export function atmosphereFromWorld(world = {}) {
  const a = world.atmosphere;
  if (a && a.model === 'legacy') return null;
  const p = { ...ATMOS_DEFAULTS };
  if (a) return Object.assign(p, a);
  const preset = ATMOS_PRESETS[world.tod_preset] || (world.stars ? ATMOS_PRESETS.NIGHT : ATMOS_PRESETS.NOON);
  Object.assign(p, preset);
  const sun = world.sun;
  if (!world.tod_preset && sun && Number.isFinite(sun.azimuth)) p.azimuth = THREE.MathUtils.radToDeg(sun.azimuth);
  if (sun && sun.shadow != null) p.shadow = !!sun.shadow;
  return p;
}

// ── CPU port of three/examples Sky.js (no clouds, no sun disc) ──────
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const THREE_OVER_SIXTEENPI = 0.05968310365946075;
const ONE_OVER_FOURPI = 0.07957747154594767;
const SUN_DISC_SR = Math.PI * 0.00465 * 0.00465;   // solid angle of the shader's 0.533° disc
const DISC_GAIN = 19000 * 0.04;                     // L0 += E·19000·Fex ; texColor = (…)·0.04
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const d2r = THREE.MathUtils.degToRad;

function totalMie(T) { const c = 0.2 * T * 10e-18; return MIE_CONST.map((m) => 0.434 * c * m); }
function sunE(zenithCos) {
  const za = Math.acos(Math.min(1, Math.max(-1, zenithCos)));
  return 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - za) / 1.5)));
}
function opticalInverse(dirY) {
  const za = Math.acos(Math.max(0, dirY));
  return 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
}

export function sunDirection(elevationDeg, azimuthDeg) {
  const el = d2r(elevationDeg), az = d2r(azimuthDeg);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}

// Extinction toward `dir` (per channel) — what survives the atmosphere.
export function transmittance(dir, p) {
  const inv = opticalInverse(dir.y);
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const betaM = totalMie(p.turbidity);
  return TOTAL_RAYLEIGH.map((bR, i) => Math.exp(-(bR * p.rayleigh * sR + betaM[i] * p.mieCoefficient * sM)));
}

// Sky radiance seen along `dir` — same units the Sky shader writes.
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const GLOW_CONE_COS = 0.9397;   // cos 20° — circumsolar Mie glow inside this cone is delivered by the sun light

export function skyRadiance(dir, sunDir, p, suppressGlow = false) {
  const E = sunE(sunDir.y);
  const betaM = totalMie(p.turbidity);
  const inv = opticalInverse(dir.y);
  const sR = 8.4e3 * inv, sM = 1.25e3 * inv;
  const cosTheta = dir.dot(sunDir);
  const rPhase = THREE_OVER_SIXTEENPI * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG, g2 = g * g;
  const glowCut = suppressGlow ? 1 - smoothstep(GLOW_CONE_COS, 1, cosTheta) : 1;
  const mPhase = ONE_OVER_FOURPI * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5)) * glowCut;
  const horizonMix = clamp01(Math.pow(1 - sunDir.y, 5));
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = TOTAL_RAYLEIGH[i] * p.rayleigh, bM = betaM[i] * p.mieCoefficient;
    const fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let lin = Math.pow(Math.max(0, E * ratio * (1 - fex)), 1.5);
    lin *= 1 + (Math.pow(Math.max(0, E * ratio * fex), 0.5) - 1) * horizonMix;
    const l0 = 0.1 * fex;
    out[i] = (lin + l0) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  return out;
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Hemispherical sky irradiance E = Σ L·cosθ·dΩ (Riemann sum, 216 taps)
// plus the plain mean radiance, and the horizon radiance away from the
// sun (the haze colour distant geometry fades into).
export function skyIrradiance(sunDir, p) {
  const E = [0, 0, 0], avg = [0, 0, 0], hor = [0, 0, 0], view = [0, 0, 0];
  let n = 0, nh = 0, nv = 0;
  const dE = d2r(10), dA = d2r(15);
  for (let e = 5; e < 90; e += 10) {
    const sinE = Math.sin(d2r(e)), dOmega = Math.cos(d2r(e)) * dE * dA;
    for (let a = 0; a < 360; a += 15) {
      const dir = sunDirection(e, a);
      const L = skyRadiance(dir, sunDir, p, true);
      for (let i = 0; i < 3; i++) { E[i] += L[i] * sinE * dOmega; avg[i] += L[i]; }
      n++;
      if (e < 40) {   // what an eye-level camera sees, sun glow included
        const Lv = skyRadiance(dir, sunDir, p, false);
        for (let i = 0; i < 3; i++) view[i] += Lv[i];
        nv++;
      }
    }
  }
  for (let a = 0; a < 360; a += 15) {
    let d = Math.abs(a - p.azimuth) % 360; if (d > 180) d = 360 - d;
    if (d < 60) continue;                     // skip the sun glow — haze, not glare
    const L = skyRadiance(sunDirection(3, a), sunDir, p);
    for (let i = 0; i < 3; i++) hor[i] += L[i];
    nh++;
  }
  return { E, avg: avg.map((v) => v / n), horizon: hor.map((v) => v / nh), view: view.map((v) => v / nv) };
}

// Irradiance (perpendicular to the beam) of the circumsolar Mie glow the
// IBL bake removes — it rides along with the sun's DirectionalLight.
export function circumsolarIrradiance(sunDir, p) {
  const out = [0, 0, 0];
  const up = Math.abs(sunDir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(sunDir, up).normalize();
  const t2 = new THREE.Vector3().crossVectors(sunDir, t1).normalize();
  const RINGS = 6, SEG = 12, CONE = Math.acos(GLOW_CONE_COS);
  for (let k = 0; k < RINGS; k++) {
    const th0 = CONE * k / RINGS, th1 = CONE * (k + 1) / RINGS, th = (th0 + th1) / 2;
    const dOmega = 2 * Math.PI * (Math.cos(th0) - Math.cos(th1)) / SEG;
    for (let sgi = 0; sgi < SEG; sgi++) {
      const phi = 2 * Math.PI * (sgi + 0.5) / SEG;
      const dir = sunDir.clone().multiplyScalar(Math.cos(th))
        .addScaledVector(t1, Math.sin(th) * Math.cos(phi))
        .addScaledVector(t2, Math.sin(th) * Math.sin(phi));
      if (dir.y <= 0) continue;
      const full = skyRadiance(dir, sunDir, p, false), supp = skyRadiance(dir, sunDir, p, true);
      for (let i = 0; i < 3; i++) out[i] += Math.max(0, full[i] - supp[i]) * dOmega;
    }
  }
  return out;
}

// three's ACESFilmicToneMapping (Stephen Hill fit), CPU side.
export function acesFilmic(c, exposure) {
  const s = exposure / 0.6;
  const r = c[0] * s, g = c[1] * s, b = c[2] * s;
  const v = [
    0.59719 * r + 0.35458 * g + 0.04823 * b,
    0.07600 * r + 0.90834 * g + 0.01566 * b,
    0.02840 * r + 0.13383 * g + 0.83777 * b,
  ].map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  return [
    clamp01(1.60475 * v[0] - 0.53108 * v[1] - 0.07367 * v[2]),
    clamp01(-0.10208 * v[0] + 1.10813 * v[1] - 0.00605 * v[2]),
    clamp01(-0.00327 * v[0] - 0.07276 * v[1] + 1.07602 * v[2]),
  ];
}

// Everything the lights need, derived from the sky model.
export function deriveLighting(p) {
  const sunDir = sunDirection(p.elevation, p.azimuth);
  const day = sunDir.y > -0.03;
  const { E: skyE, avg: skyAvg, horizon, view: skyView } = skyIrradiance(sunDir, p);
  const skyLum = Math.max(lum(skyE), 1e-5);            // sky irradiance on a horizontal surface
  // Sun: the disc's irradiance E·Ω·T per channel. Colour = transmittance
  // (white at noon, orange at the horizon). The physical sun:sky ratio
  // (~4:1 at noon) is compressed with a 0.7 power so shade under a
  // single exposure isn't crushed — what every real-time renderer does.
  const tr = transmittance(sunDir, p);
  const circ = day ? circumsolarIrradiance(sunDir, p) : [0, 0, 0];
  const sunEPhys = tr.map((t, i) => SUN_DISC_SR * DISC_GAIN * sunE(sunDir.y) * t + circ[i]);
  const sunMax = Math.max(...sunEPhys, 1e-9);
  const sunColor = new THREE.Color(sunEPhys[0] / sunMax, sunEPhys[1] / sunMax, sunEPhys[2] / sunMax);
  const sunLumPhys = lum(sunEPhys);
  // Preetham's circumsolar glow explodes at low sun, so the sun:sky ratio
  // is capped (3.5:1 high sun, easing toward 1.4:1 at the horizon where
  // the direct beam really does give way to the sky) then compressed.
  const ratioCap = 3.5 * Math.sqrt(smoothstep(0, 0.35, sunDir.y));
  const ratio = Math.min(sunLumPhys / skyLum, ratioCap);
  const sunLum = day ? skyLum * Math.pow(ratio, 0.8) * (p.sunIntensity ?? 1) : 0;
  const sunIntensity = sunLum / Math.max(lum([sunColor.r, sunColor.g, sunColor.b]), 1e-3);
  // Hemisphere: a 15 % fill in the sky's colour. The IBL (PMREM of this
  // same sky) carries the real diffuse sky light for PBR *and* Lambert.
  const sat = p.iblSaturation ?? 0.6;
  const skyEd = skyE.map((v) => lum(skyE) + (v - lum(skyE)) * sat);   // same desaturation the IBL bake applies
  const skyMax = Math.max(...skyEd, 1e-6);
  const hemiSky = new THREE.Color(skyEd[0] / skyMax, skyEd[1] / skyMax, skyEd[2] / skyMax);
  const hemiGround = hemiSky.clone().multiplyScalar(p.groundAlbedo ?? 0.25).lerp(new THREE.Color(0.3, 0.28, 0.26), 0.35);
  const hemiIntensity = Math.max(0.001, skyLum * 0.15 / Math.max(lum([hemiSky.r, hemiSky.g, hemiSky.b]), 1e-3));
  // Auto exposure — log-average metering like a camera: 60 % a white
  // horizontal surface in sun + sky, 40 % the visible sky band (glow
  // included), so a low sun doesn't blow the whole sky to white while
  // the ground stays readable. Target ~0.9 linear at high sun (≈0.75
  // display after ACES), 0.6 at the horizon; night floor keeps the moon.
  const whiteRadiance = (skyLum + sunLum * Math.max(0, sunDir.y)) / Math.PI;
  const keyLum = Math.exp(0.6 * Math.log(Math.max(whiteRadiance, 1e-4)) + 0.4 * Math.log(Math.max(lum(skyView), 1e-4)));
  const keyTarget = 0.55 + 0.35 * smoothstep(0, 0.4, sunDir.y);
  const autoExposure = clamp(keyTarget / keyLum, 0.05, 12);
  const exposure = Number.isFinite(p.exposure) && p.exposure > 0 ? p.exposure : autoExposure;
  // Fog = horizon haze. Fog is mixed after tone mapping when rendering
  // straight to the canvas, so hand it the tone-mapped colour there;
  // an HDR pipeline (EffectComposer) tone-maps the fog itself.
  const fogColor = new THREE.Color(...(p.hdrFog ? horizon : acesFilmic(horizon, exposure)));
  const fogFar = Math.max(140, Math.min(650, 160 + 1400 / Math.max(1, p.turbidity)));
  // Night: a cool moon opposite the (below-horizon) sun, ~0.25 display on white.
  const moonDir = sunDirection(Math.max(25, -p.elevation + 20), p.azimuth + 180);
  const moonIntensity = day ? 0 : (0.28 * Math.PI / exposure) * (p.sunIntensity ?? 1);
  // Ground bounce radiance for the lower half of the IBL.
  const groundRadiance = skyEd.map((e, i) => (p.groundAlbedo ?? 0.25) * (e + sunEPhys[i] * (sunLum / Math.max(sunLumPhys, 1e-6)) * Math.max(0, sunDir.y)) / Math.PI);
  return {
    sunDir, day, sunColor, sunIntensity, sunLum, sunEPhys, hemiSky, hemiGround, hemiIntensity,
    skyE, skyAvg, skyLum, horizon, groundRadiance, fogColor, fogFar, moonDir, moonIntensity, exposure, autoExposure,
  };
}

// Sky material with two extra knobs the stock Sky lacks:
//   sunDiscIntensity — 0 while baking IBL (the DirectionalLight is the sun)
//   radianceClamp    — keeps the 4e5-radiance disc inside half-float
//                      range so PMREM / bloom never see Inf → NaN → black
function makeSkyMesh() {
  const sky = new Sky();
  const shader = Sky.SkyShader;
  if (shader) {
    const frag = shader.fragmentShader
      .replace('uniform float time;', 'uniform float time;\n\t\t\tuniform float sunDiscIntensity;\n\t\t\tuniform float radianceClamp;\n\t\t\tuniform float glowSuppress;\n\t\t\tuniform float skySaturation;')
      .replace('float mPhase = hgPhase( cosTheta, mieDirectionalG );', 'float mPhase = hgPhase( cosTheta, mieDirectionalG ) * ( 1.0 - glowSuppress * smoothstep( 0.9397, 1.0, cosTheta ) );')
      .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk * sunDiscIntensity;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'texColor = mix( vec3( dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), texColor, skySaturation );\n\t\t\tgl_FragColor = vec4( min( texColor, vec3( radianceClamp ) ), 1.0 );');
    if (frag.includes('sunDiscIntensity;') && frag.includes('radianceClamp )') && frag.includes('glowSuppress *')) {
      sky.material.dispose();
      sky.material = new THREE.ShaderMaterial({
        name: 'PhysicalSkyShader',
        uniforms: { ...THREE.UniformsUtils.clone(shader.uniforms), sunDiscIntensity: { value: 1 }, radianceClamp: { value: 4000 }, glowSuppress: { value: 0 }, skySaturation: { value: 1 } },
        vertexShader: shader.vertexShader,
        fragmentShader: frag,
        side: THREE.BackSide,
        depthWrite: false,
      });
    }
  }
  const u = sky.material.uniforms;
  if (!u.sunDiscIntensity) u.sunDiscIntensity = { value: 1 };
  if (!u.glowSuppress) u.glowSuppress = { value: 0 };
  if (!u.skySaturation) u.skySaturation = { value: 1 };
  return sky;
}

function buildStars(count = 900, radius = 900) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random(), v = Math.random();
    const th = 2 * Math.PI * u, ph = Math.acos(1 - 2 * v);
    pos[i * 3] = radius * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(radius * Math.cos(ph)) + 20;
    pos[i * 3 + 2] = radius * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false });
  const pts = new THREE.Points(g, m);
  pts.name = 'physicalStars';
  pts.renderOrder = -999;
  return pts;
}

// Build the rig. Call `attach(scene)` (adds sky, lights, fog), then
// `apply(params)` for live changes and `bakeEnvironment(renderer)` to
// (re)generate the IBL. `tick(dt)` drifts the clouds. `setBakeMode(on)`
// hides the sun disc while an external probe captures the scene.
export function createPhysicalSky(params = {}) {
  let p = { ...ATMOS_DEFAULTS, ...params };
  const sky = makeSkyMesh();
  sky.name = 'physicalSky';
  sky.scale.setScalar(4000);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = 'physicalSun';
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const moon = new THREE.DirectionalLight(0xb8c8ff, 0);
  moon.name = 'physicalMoon';
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  hemi.name = 'physicalHemi';
  const stars = buildStars();
  stars.visible = false;
  const group = new THREE.Group();
  group.name = 'physicalSkyRig';
  group.add(sky, stars);

  let scene = null;
  let envOwner = null;   // { texture }
  let time = 0;

  const handle = {
    get params() { return p; },
    sky, sun, moon, hemi, group, stars,
    lighting: null,
    attach(target) {
      scene = target;
      scene.add(group, sun, sun.target, moon, hemi);
      handle.apply(p);
      return handle;
    },
    apply(next = {}) {
      p = { ...p, ...next };
      const L = deriveLighting(p);
      handle.lighting = L;
      const u = sky.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mieCoefficient;
      u.mieDirectionalG.value = p.mieDirectionalG;
      u.sunPosition.value.copy(L.sunDir);
      if (u.cloudCoverage) { u.cloudCoverage.value = p.clouds ?? 0.35; u.cloudDensity.value = 0.45; }
      sun.color.copy(L.sunColor);
      sun.intensity = L.sunIntensity;
      sun.position.copy(L.sunDir).multiplyScalar(120);
      sun.target.position.set(0, 0, 0);
      sun.castShadow = !!p.shadow && L.sunIntensity > 0.05;
      moon.intensity = L.moonIntensity;
      moon.position.copy(L.moonDir).multiplyScalar(120);
      hemi.color.copy(L.hemiSky);
      hemi.groundColor.copy(L.hemiGround);
      hemi.intensity = L.hemiIntensity;
      stars.visible = !L.day;
      if (scene) {
        scene.background = null;                       // the Sky mesh IS the background
        const far = Number.isFinite(p.fogFar) ? p.fogFar : L.fogFar;
        scene.fog = new THREE.Fog(L.fogColor, far * 0.18, far);
        scene.environmentIntensity = p.skyIntensity ?? 1;
      }
      return L;
    },
    // While an external probe captures the scene: no disc, no circumsolar
    // glow — both are already delivered by the sun DirectionalLight.
    setBakeMode(on) {
      sky.material.uniforms.sunDiscIntensity.value = on ? 0 : 1;
      sky.material.uniforms.glowSuppress.value = on ? 1 : 0;
      sky.material.uniforms.skySaturation.value = on ? (p.iblSaturation ?? 0.6) : 1;
    },
    // PMREM from the sky alone (+ a ground disc so the lower hemisphere
    // is bounce, not horizon glare). Cheap: ~10 ms at 256².
    bakeEnvironment(renderer, { target = scene } = {}) {
      if (!renderer) return null;
      const L = handle.lighting || deriveLighting(p);
      const bakeScene = new THREE.Scene();
      const bakeSky = makeSkyMesh();
      bakeSky.scale.setScalar(400);
      const bu = bakeSky.material.uniforms, su = sky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) bu[k].value = su[k].value;
      bu.sunPosition.value.copy(su.sunPosition.value);
      bu.sunDiscIntensity.value = 0;                   // sun = DirectionalLight, sky = IBL
      bu.glowSuppress.value = 1;
      bu.skySaturation.value = p.iblSaturation ?? 0.6;
      if (bu.cloudCoverage) bu.cloudCoverage.value = p.clouds ?? 0.35;
      bakeScene.add(bakeSky);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(...L.groundRadiance), side: THREE.DoubleSide, toneMapped: false, fog: false }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -1;
      bakeScene.add(ground);
      const pmrem = new THREE.PMREMGenerator(renderer);
      let texture = null;
      try {
        texture = pmrem.fromScene(bakeScene, 0.02).texture;
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[physicalSky] PMREM bake failed', err);
      } finally {
        pmrem.dispose();
        bakeSky.material.dispose(); bakeSky.geometry.dispose();
        ground.geometry.dispose(); ground.material.dispose();
      }
      if (!texture) return null;
      if (envOwner) envOwner.texture.dispose();
      envOwner = { texture };
      if (target) {
        target.environment = texture;
        target.environmentIntensity = p.skyIntensity ?? 1;
      }
      return texture;
    },
    get exposure() { return (handle.lighting || deriveLighting(p)).exposure; },
    applyExposure(renderer) {
      if (!renderer) return;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = handle.exposure;
    },
    tick(dt) {
      time += dt || 0;
      const u = sky.material.uniforms;
      if (u.time) u.time.value = time;
    },
    dispose() {
      if (scene) { scene.remove(group, sun, sun.target, moon, hemi); if (scene.environment === envOwner?.texture) scene.environment = null; }
      sky.material.dispose(); sky.geometry.dispose();
      stars.geometry.dispose(); stars.material.dispose();
      if (envOwner) { envOwner.texture.dispose(); envOwner = null; }
      scene = null;
    },
  };
  return handle;
}
