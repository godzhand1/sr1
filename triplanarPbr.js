// triplanarPbr.js — world-space triplanar (box) mapping + steep parallax
// occlusion mapping for MeshStandardMaterial, injected via
// onBeforeCompile so lights / shadows / IBL / tone-mapping stay stock.
//
// Why: editor boxes are scaled BoxGeometry with 0..1 UVs per face, so a
// 40 m wall stretches a 2 m tile 20×. Sampling by world position keeps
// texel density constant on every face regardless of size or rotation
// — the same thing Blender's Image Texture "Box" projection does, which
// is how the .blend export reproduces it.
//
// Sampling per projection (T = ∂pos/∂u, B = ∂pos/∂v):
//   X  uv = (p.z, p.y)   T = +Z  B = +Y
//   Y  uv = (p.x, p.z)   T = +X  B = +Z
//   Z  uv = (p.x, p.y)   T = +X  B = +Y
// Normals are OpenGL/glTF tangent-space (+Y up) blended in world space,
// then moved to view space for three's lighting.
import * as THREE from 'three';

const MAX_STEPS = 32;

const PARS = /* glsl */`
uniform float tpTile;
uniform float tpSharp;
uniform float tpNormalScale;
uniform sampler2D tpHeight;
uniform float tpParScale;
uniform int tpParSteps;
varying vec3 vTpPos;
varying vec3 vTpNrm;

vec3 tpWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(tpSharp));
  return w / max(w.x + w.y + w.z, 1e-5);
}

#ifdef TP_PARALLAX
// Steep parallax + occlusion interpolation on ONE projection. vt is the
// view vector in that projection's (T, B, N) frame, pointing at the eye.
vec2 tpParallax(vec2 uv, vec3 vt) {
  float layer = 1.0 / float(tpParSteps);
  vec2 P = (vt.xy / max(vt.z, 0.2)) * (tpParScale / tpTile);
  vec2 delta = P * layer;
  vec2 cuv = uv;
  float cur = 0.0;
  float h = 1.0 - texture2D(tpHeight, cuv).r;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= tpParSteps || cur >= h) break;
    cuv -= delta;
    h = 1.0 - texture2D(tpHeight, cuv).r;
    cur += layer;
  }
  vec2 prev = cuv + delta;
  float after = h - cur;
  float before = (1.0 - texture2D(tpHeight, prev).r) - cur + layer;
  float wgt = clamp(after / max(after - before, 1e-4), 0.0, 1.0);
  return prev * wgt + cuv * (1.0 - wgt);
}
#endif

// Shared per-fragment state (filled once in tpSetup()).
vec3 tpW; vec2 tpUvX; vec2 tpUvY; vec2 tpUvZ;

void tpSetup() {
  vec3 n = normalize(vTpNrm);
  tpW = tpWeights(n);
  vec3 p = vTpPos / tpTile;
  tpUvX = vec2(p.z, p.y);
  tpUvY = vec2(p.x, p.z);
  tpUvZ = vec2(p.x, p.y);
  #ifdef TP_PARALLAX
    vec3 V = normalize(cameraPosition - vTpPos);
    if (tpW.y >= tpW.x && tpW.y >= tpW.z) {
      tpUvY = tpParallax(tpUvY, vec3(V.x, V.z, abs(V.y)));
    } else if (tpW.x >= tpW.z) {
      tpUvX = tpParallax(tpUvX, vec3(V.z, V.y, abs(V.x)));
    } else {
      tpUvZ = tpParallax(tpUvZ, vec3(V.x, V.y, abs(V.z)));
    }
  #endif
}

vec4 tpSample(sampler2D t) {
  return texture2D(t, tpUvX) * tpW.x + texture2D(t, tpUvY) * tpW.y + texture2D(t, tpUvZ) * tpW.z;
}
`;

const VERT_INJECT = /* glsl */`
#include <project_vertex>
vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTpNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const MAP_FRAG = /* glsl */`
tpSetup();
#ifdef USE_MAP
  vec4 sampledDiffuseColor = tpSample(map);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const ROUGH_FRAG = /* glsl */`
float roughnessFactor = roughness;
vec4 tpORM = vec4(1.0, 1.0, 1.0, 1.0);
#ifdef USE_ROUGHNESSMAP
  tpORM = tpSample(roughnessMap);
  roughnessFactor *= tpORM.g;
#endif
`;

const METAL_FRAG = /* glsl */`
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  metalnessFactor *= tpORM.b;
#endif
`;

const NORMAL_FRAG = /* glsl */`
#ifdef USE_NORMALMAP
{
  vec3 nW = normalize(vTpNrm);
  vec3 nx = texture2D(normalMap, tpUvX).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(normalMap, tpUvY).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(normalMap, tpUvZ).xyz * 2.0 - 1.0;
  vec3 pert =
      tpW.x * (vec3(0.0, 0.0, 1.0) * nx.x + vec3(0.0, 1.0, 0.0) * nx.y)
    + tpW.y * (vec3(1.0, 0.0, 0.0) * ny.x + vec3(0.0, 0.0, 1.0) * ny.y)
    + tpW.z * (vec3(1.0, 0.0, 0.0) * nz.x + vec3(0.0, 1.0, 0.0) * nz.y);
  nW = normalize(nW + pert * tpNormalScale);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  #ifdef DOUBLE_SIDED
    normal *= faceDirection;
  #endif
}
#endif
`;

const AO_FRAG = /* glsl */`
#ifdef USE_AOMAP
  float ambientOcclusion = (tpORM.r - 1.0) * aoMapIntensity + 1.0;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate(dot(geometryNormal, geometryViewDir));
    reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
  #endif
#endif
`;

// Apply the patch. `opts`: { tile, sharpness, normalScale, parallax: { scale, steps } | null, heightMap }
export function patchTriplanar(material, opts = {}) {
  const tile = Math.max(0.1, opts.tile ?? 2);
  const sharp = Math.max(1, opts.sharpness ?? 4);
  const par = opts.parallax && opts.heightMap ? opts.parallax : null;
  const uniforms = {
    tpTile: { value: tile },
    tpSharp: { value: sharp },
    tpNormalScale: { value: opts.normalScale ?? 1 },
    tpHeight: { value: opts.heightMap || null },
    tpParScale: { value: par ? Math.max(0, par.scale ?? 0.03) : 0 },
    tpParSteps: { value: par ? Math.min(MAX_STEPS, Math.max(2, Math.round(par.steps ?? 12))) : 0 },
  };
  material.defines = { ...(material.defines || {}), TP_TRIPLANAR: '' };
  if (par) material.defines.TP_PARALLAX = ''; else delete material.defines.TP_PARALLAX;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
      .replace('#include <project_vertex>', VERT_INJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', MAP_FRAG)
      .replace('#include <roughnessmap_fragment>', ROUGH_FRAG)
      .replace('#include <metalnessmap_fragment>', METAL_FRAG)
      .replace('#include <normal_fragment_maps>', NORMAL_FRAG)
      .replace('#include <aomap_fragment>', AO_FRAG);
  };
  material.customProgramCacheKey = () => `srtp|${par ? 'p' : 'n'}`;
  material.userData.tpUniforms = uniforms;
  material.needsUpdate = true;
  return material;
}

// Live-update the patched uniforms (editor sliders) without a recompile.
export function updateTriplanar(material, opts = {}) {
  const u = material.userData.tpUniforms;
  if (!u) return false;
  if (opts.tile != null) u.tpTile.value = Math.max(0.1, opts.tile);
  if (opts.sharpness != null) u.tpSharp.value = Math.max(1, opts.sharpness);
  if (opts.normalScale != null) u.tpNormalScale.value = opts.normalScale;
  if (opts.parallax) {
    if (opts.parallax.scale != null) u.tpParScale.value = Math.max(0, opts.parallax.scale);
    if (opts.parallax.steps != null) u.tpParSteps.value = Math.min(MAX_STEPS, Math.max(2, Math.round(opts.parallax.steps)));
  }
  if (opts.heightMap !== undefined) u.tpHeight.value = opts.heightMap;
  return true;
}

// Test hook — builds the patched shader source for a stock standard
// material so unit tests can assert the injected chunks are present.
export function _debugPatchedSource(opts = {}) {
  const mat = new THREE.MeshStandardMaterial();
  patchTriplanar(mat, opts);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>\n',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>\n',
  };
  mat.onBeforeCompile(shader);
  return { ...shader, defines: mat.defines };
}
