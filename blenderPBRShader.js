// Blender Principled-BSDF shader recreation for Three.js.
//
// Ports the exact node graph the user authored in Blender:
//
//   Texture Coordinate (Generated)
//        ↓
//    Mapping (Point)  loc=(-9.3,-42.4,20.5)  rot=(108°,4.3°,4.2°)  scale=(38.7,-5.6,7.2)
//        ↓
//     ┌──────────────────────┬────────────────────────┐
//     ↓                      ↓                        ↓
//  BASE COLOR (sRGB)     METALLIC ROUGHNESS (Non-Color)
//     ├─ Color → Principled BSDF.Base Color
//     └─ Alpha → Alpha Factor  Multiply ×0.450 → Principled BSDF.Alpha
//                              METALLIC ROUGHNESS
//                                     ↓
//                               Separate Color (RGB)
//                                     ├─ Green → Principled BSDF.Roughness
//                                     └─ Blue → Metallic Factor Multiply ×-26.9 → Principled BSDF.Metallic
//
// Three.js's `MeshStandardMaterial` IS Blender's Principled BSDF —
// same underlying GGX + Schlick + Lambert model, same PBR math. The
// only translation needed is:
//
//  • Alpha Factor multiply → material.opacity + transparent:true
//    (Three.js multiplies opacity by the map's alpha channel
//    automatically when the base color texture has one, so 0.45 is
//    exactly the same effect as the Blender Multiply-0.45 node).
//
//  • Metallic Factor multiply → material.metalness (Three.js already
//    multiplies `metalness` by `metalnessMap.b`, matching the
//    Separate-Color-Blue → Multiply → BSDF.Metallic chain).
//
//  • Green → Roughness works out of the box because Three.js reads
//    `roughnessMap.g` (glTF packing convention: R=Occlusion,
//    G=Roughness, B=Metallic), which is exactly what Separate
//    Color's Green output feeds. `material.roughness` acts as the
//    scalar multiplier (author intent was 1.0 = pure passthrough).
//
//  • Mapping (Point) node → texture.offset / repeat / rotation /
//    center on every input texture. Blender's 3D Point mapping
//    uses X/Y for the 2D UV plane and Z is ignored on a flat UV
//    lookup. Rotation Z is the 2D UV rotation (X/Y rotations bend
//    the UV plane out of screen — irrelevant to a flat texture
//    sample; we ignore them, matching what Blender's Cycles GPU
//    fallback does for flat images).

import * as THREE from 'three';

const DEG2RAD = Math.PI / 180;

// Blender Mapping node values from the user's graph. Exposed so
// callers can override per-material if they duplicate the shader
// for a different mesh with slightly different UV params.
export const BLENDER_MAPPING_DEFAULT = {
  location: { x: -9.3, y: -42.4, z: 20.5 },
  rotation: { x: 108, y: 4.3, z: 4.2 }, // degrees; only Z matters for 2D
  scale:    { x: 38.7, y: -5.6, z: 7.2 },
};

// Alpha Factor (Multiply) value from the graph.
export const BLENDER_ALPHA_FACTOR_DEFAULT = 0.45;

// Metallic Factor (Multiply) value from the graph. Kept as-authored
// even though it's outside the physical [0,1] range — the user's
// intent (per the graph) is to boost/invert the blue channel of the
// MR texture, and MeshStandardMaterial's shader honors the scalar
// literally (no clamp), so the effect is 1:1 with Blender.
export const BLENDER_METALLIC_FACTOR_DEFAULT = -26.9;

// Apply the Blender Mapping node transform to a single texture.
// Called for every input texture in the material so BASE COLOR and
// METALLIC ROUGHNESS stay in perfect UV sync (which is why the
// Blender graph fed the Mapping node into both texture nodes).
function applyMappingTransform(texture, mapping) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Three.js's UV transform is (uv - center) * repeat rotated then
  // offset. Setting center=(0,0) gives exactly Blender's Point
  // mapping: uv * scale + location + rotate around origin.
  texture.center.set(0, 0);
  texture.repeat.set(mapping.scale.x, mapping.scale.y);
  texture.offset.set(mapping.location.x, mapping.location.y);
  texture.rotation = mapping.rotation.z * DEG2RAD;
  texture.needsUpdate = true;
}

// Public — build a Three.js MeshStandardMaterial that renders the
// exact Blender graph shown above. Textures load asynchronously;
// the returned material is usable immediately (renders as flat
// color until textures arrive, same as Three.js's default behavior).
//
// Params:
//   baseColorURL           — path to the BASE COLOR image (sRGB)
//   metallicRoughnessURL   — path to the METALLIC ROUGHNESS image (linear)
//   normalURL              — optional path to a tangent-space normal
//                            map (linear). Not in the original graph
//                            shown, but supported here for authoring
//                            realistic water/wet surfaces where the
//                            normal micro-detail sells the effect.
//   mapping                — Mapping node values, defaults to
//                            BLENDER_MAPPING_DEFAULT
//   alphaFactor            — Alpha Factor multiply value, default 0.45
//   metallicFactor         — Metallic Factor multiply value, default -26.9
//   roughness              — Roughness scalar (multiplier over the G
//                            channel of the MR map), default 1.0
//
// Returns { material, disposeTextures } — call disposeTextures on
// scene teardown to free the GPU memory (Three.js won't do it
// automatically for shared textures).
export function buildBlenderPrincipledMaterial({
  baseColorURL,
  metallicRoughnessURL,
  normalURL,
  mapping = BLENDER_MAPPING_DEFAULT,
  alphaFactor = BLENDER_ALPHA_FACTOR_DEFAULT,
  metallicFactor = BLENDER_METALLIC_FACTOR_DEFAULT,
  roughness = 1.0,
} = {}) {
  const loader = new THREE.TextureLoader();
  const textures = [];

  const material = new THREE.MeshStandardMaterial({
    // Alpha Factor Multiply ×0.45 → material.opacity + transparent.
    // Three.js multiplies this scalar by the base color map's alpha
    // channel automatically, which is what the Multiply node does
    // in Blender.
    transparent: true,
    opacity: alphaFactor,
    // Metallic Factor Multiply ×-26.9 → scalar, multiplied by
    // metalnessMap.b in the shader (matches Separate-Color-Blue
    // path).
    metalness: metallicFactor,
    // Roughness scalar; multiplied by roughnessMap.g in the shader
    // (matches Separate-Color-Green path). Kept at 1.0 by default
    // so the MR texture drives roughness directly.
    roughness,
    side: THREE.DoubleSide,
    depthWrite: false, // matches typical translucent PBR authoring
  });

  if (baseColorURL) {
    loader.load(baseColorURL, (tex) => {
      // BASE COLOR node has Color Space = sRGB in the graph.
      tex.colorSpace = THREE.SRGBColorSpace;
      applyMappingTransform(tex, mapping);
      material.map = tex;
      // Base color's alpha channel is the Alpha input; Three.js
      // uses map.alpha automatically when transparent = true.
      // No separate alphaMap needed — matches the "Channel Packed"
      // alpha mode in the Blender image node.
      material.needsUpdate = true;
    });
    textures.push(baseColorURL);
  }

  if (metallicRoughnessURL) {
    loader.load(metallicRoughnessURL, (tex) => {
      // METALLIC ROUGHNESS node has Color Space = Non-Color in the
      // graph — that's Linear in Three.js's color space enum.
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      applyMappingTransform(tex, mapping);
      // Same texture drives both — glTF packing convention. Three.js
      // reads .g for roughness and .b for metalness from whichever
      // texture is assigned; we assign the same to both so Separate
      // Color's Green and Blue outputs both come from this map.
      material.metalnessMap = tex;
      material.roughnessMap = tex;
      material.needsUpdate = true;
    });
    textures.push(metallicRoughnessURL);
  }

  if (normalURL) {
    loader.load(normalURL, (tex) => {
      // Normal maps are always Non-Color / linear regardless of
      // authoring pipeline.
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      applyMappingTransform(tex, mapping);
      material.normalMap = tex;
      material.needsUpdate = true;
    });
    textures.push(normalURL);
  }

  const disposeTextures = () => {
    if (material.map) material.map.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.normalMap) material.normalMap.dispose();
    // roughnessMap points to the same texture as metalnessMap;
    // already disposed above
  };

  return { material, disposeTextures, textures };
}

// Convenience — apply the Blender shader to a mesh in place.
// Preserves the mesh's geometry, replaces only its material.
// The old material is disposed to free GPU memory.
export function applyBlenderPrincipledToMesh(mesh, params) {
  if (!mesh || !mesh.isMesh) {
    console.warn('[blenderPBRShader] applyBlenderPrincipledToMesh needs a Mesh, got', mesh);
    return null;
  }
  const { material, disposeTextures } = buildBlenderPrincipledMaterial(params);
  const old = mesh.material;
  mesh.material = material;
  if (old) {
    const oldMats = Array.isArray(old) ? old : [old];
    for (const m of oldMats) m?.dispose?.();
  }
  return { material, disposeTextures };
}
