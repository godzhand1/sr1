// Team Gangsta Brawl — procedural material library.
//
// Every surface in the arena (streets, brick, concrete, wood, glass,
// metal, sky, cloud) is generated on canvas at 1024² (bumped by the
// caller to 2048 if requested) and wrapped as a THREE.CanvasTexture
// with sensible repeat / colorSpace / anisotropy defaults. Textures
// are CACHED — one canvas per surface type is reused across the whole
// scene, so a 100-wall building costs a single upload.
//
// This is the "no downloads, no repo bloat, still looks AAA" path.
// A user who wants literal 4K PNGs can drop them at
// `/public/textures/{key}.png` and swap the material's map — see the
// override hook at the bottom.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';

const TEX_SIZE = 2048;
const _cache = new Map();

// Cheap deterministic PRNG so procedural surfaces are stable frame-
// to-frame and identical across all clients.
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// Faux-perlin: sample smoothstep-interpolated random grid.
function noise2d(x, y, gridSize, rand) {
  const gx = Math.floor(x / gridSize);
  const gy = Math.floor(y / gridSize);
  const fx = (x - gx * gridSize) / gridSize;
  const fy = (y - gy * gridSize) / gridSize;
  const h = (i, j) => {
    const k = ((i * 73856093) ^ (j * 19349663)) >>> 0;
    return ((k % 1000) / 1000) * 0.999 + 0.0005;
  };
  const a = h(gx, gy),     b = h(gx + 1, gy);
  const c = h(gx, gy + 1), d = h(gx + 1, gy + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = a + (b - a) * sx;
  const n = c + (d - c) * sx;
  return m + (n - m) * sy;
}

function canvas(fill) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  const g = c.getContext('2d');
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, TEX_SIZE, TEX_SIZE); }
  return { c, g };
}

function toTex(c, { repeat = [1, 1], anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// ── Brick ────────────────────────────────────────────────────────────
// Staggered brick pattern, per-brick tint variance for character.
function drawBrick(g, tint) {
  const rows = 24, brickW = TEX_SIZE / 6, brickH = TEX_SIZE / rows;
  const r = rng(tint & 0xffff);
  // Base mortar backdrop.
  g.fillStyle = '#2a2018';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const base = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
  for (let row = 0; row < rows; row++) {
    const offset = (row & 1) ? brickW / 2 : 0;
    for (let col = -1; col < 7; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      // Individual brick tint variance.
      const v = (r() - 0.5) * 40;
      const col2 = `rgb(${Math.max(20, base[0] + v)|0}, ${Math.max(15, base[1] + v * 0.7)|0}, ${Math.max(15, base[2] + v * 0.5)|0})`;
      g.fillStyle = col2;
      g.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);
      // Weathering flecks
      for (let k = 0; k < 6; k++) {
        const px = x + r() * brickW, py = y + r() * brickH;
        g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.2})`;
        g.fillRect(px, py, 2 + r() * 3, 1 + r() * 2);
      }
    }
  }
}

// ── Concrete ─────────────────────────────────────────────────────────
// Speckled gray with dark cracks + stains.
function drawConcrete(g, tint = 0x8a8a8a) {
  const base = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
  const img = g.createImageData(TEX_SIZE, TEX_SIZE);
  const d = img.data;
  const r = rng(0xc0ffee);
  for (let i = 0; i < d.length; i += 4) {
    const n = 0.85 + r() * 0.3;
    d[i    ] = Math.min(255, base[0] * n);
    d[i + 1] = Math.min(255, base[1] * n);
    d[i + 2] = Math.min(255, base[2] * n);
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Big stains
  for (let k = 0; k < 6; k++) {
    const x = r() * TEX_SIZE, y = r() * TEX_SIZE;
    const rad = 80 + r() * 200;
    const grad = g.createRadialGradient(x, y, 8, x, y, rad);
    grad.addColorStop(0, 'rgba(30, 30, 30, 0.35)');
    grad.addColorStop(1, 'rgba(30, 30, 30, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  }
  // Cracks
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    let x = r() * TEX_SIZE, y = r() * TEX_SIZE;
    g.moveTo(x, y);
    const steps = 12 + (r() * 10) | 0;
    for (let s = 0; s < steps; s++) {
      x += (r() - 0.5) * 80; y += (r() - 0.5) * 80;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

// ── Asphalt ──────────────────────────────────────────────────────────
// Dark gritty with faint paint stripe if `stripe=true`.
function drawAsphalt(g, stripe = false) {
  const img = g.createImageData(TEX_SIZE, TEX_SIZE);
  const d = img.data;
  const r = rng(0xa5fa17);
  for (let i = 0; i < d.length; i += 4) {
    const n = 30 + r() * 30;
    d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255;
    if (r() < 0.008) { d[i] = d[i + 1] = d[i + 2] = 90 + r() * 40; }  // grit
  }
  g.putImageData(img, 0, 0);
  if (stripe) {
    g.fillStyle = 'rgba(230, 210, 90, 0.85)';
    g.fillRect(TEX_SIZE / 2 - 8, 0, 16, TEX_SIZE);
    // Faded gaps
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    for (let y = 0; y < TEX_SIZE; y += 80) g.fillRect(TEX_SIZE / 2 - 8, y + 30, 16, 30);
  }
}

// ── Wood planks ──────────────────────────────────────────────────────
function drawWood(g) {
  const r = rng(0x123456);
  g.fillStyle = '#4a331e';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const plankW = TEX_SIZE / 4;
  for (let p = 0; p < 4; p++) {
    const x0 = p * plankW;
    const base = 55 + r() * 40;
    g.fillStyle = `rgb(${base + 15}, ${base}, ${base - 15})`;
    g.fillRect(x0 + 2, 0, plankW - 4, TEX_SIZE);
    // Grain
    g.strokeStyle = 'rgba(20, 10, 5, 0.35)';
    for (let ln = 0; ln < 30; ln++) {
      g.lineWidth = 0.5 + r() * 1.5;
      g.beginPath();
      const y = r() * TEX_SIZE;
      g.moveTo(x0, y);
      for (let s = 1; s < 20; s++) g.lineTo(x0 + s * (plankW / 20), y + (noise2d(s * 20, y + p * 100, 40, r) - 0.5) * 30);
      g.stroke();
    }
    // Plank divide
    g.fillStyle = '#1a0f08';
    g.fillRect(x0, 0, 2, TEX_SIZE);
  }
}

// ── Metal / catwalk ──────────────────────────────────────────────────
function drawMetal(g) {
  const grad = g.createLinearGradient(0, 0, TEX_SIZE, 0);
  grad.addColorStop(0, '#4a4a4a');
  grad.addColorStop(0.5, '#7c7c7c');
  grad.addColorStop(1, '#4a4a4a');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Vertical brush lines
  g.strokeStyle = 'rgba(30,30,30,0.3)';
  g.lineWidth = 1;
  for (let x = 0; x < TEX_SIZE; x += 3) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TEX_SIZE); g.stroke();
  }
}

// ── Sky ──────────────────────────────────────────────────────────────
// Radial gradient blue → yellow-orange horizon. Painted on an
// equirectangular canvas so the sky-sphere shows a warm sunset lip.
function drawSky(g) {
  const grad = g.createLinearGradient(0, 0, 0, TEX_SIZE);
  grad.addColorStop(0.00, '#0e1b3a');
  grad.addColorStop(0.35, '#245a94');
  grad.addColorStop(0.60, '#8bb0d0');
  grad.addColorStop(0.80, '#f0b070');
  grad.addColorStop(1.00, '#603828');
  g.fillStyle = grad;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // Cloud layer — soft billowing puffs using noise-modulated alpha.
  const r = rng(0x51ce7a);
  for (let k = 0; k < 32; k++) {
    const x = r() * TEX_SIZE;
    const y = TEX_SIZE * (0.15 + r() * 0.35);      // upper 50%
    const w = 60 + r() * 180;
    const h = 20 + r() * 40;
    const cg = g.createRadialGradient(x, y, 4, x, y, w);
    const alpha = 0.35 + r() * 0.35;
    cg.addColorStop(0.00, `rgba(255,255,255,${alpha})`);
    cg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.fill();
  }
  // Stars in the deep-blue upper strip.
  g.fillStyle = 'rgba(255, 250, 220, 0.6)';
  for (let k = 0; k < 120; k++) {
    const x = r() * TEX_SIZE;
    const y = r() * (TEX_SIZE * 0.25);
    g.fillRect(x, y, 1 + r() * 1.5, 1);
  }
}

// ── Public API ───────────────────────────────────────────────────────
export function getTexture(kind, opts = {}) {
  const key = `${kind}:${opts.tint || ''}:${opts.stripe ? 1 : 0}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const { c, g } = canvas('#000');
  switch (kind) {
    case 'brick':    drawBrick(g, opts.tint || 0x6a4030); break;
    case 'concrete': drawConcrete(g, opts.tint || 0x8a8a8a); break;
    case 'asphalt':  drawAsphalt(g, !!opts.stripe); break;
    case 'wood':     drawWood(g); break;
    case 'metal':    drawMetal(g); break;
    case 'sky':      drawSky(g); break;
    default:         drawConcrete(g, 0x808080); break;
  }
  const tex = toTex(c, { repeat: opts.repeat || [1, 1], anisotropy: opts.anisotropy || 8 });
  _cache.set(key, tex);
  return tex;
}

// Convenience — a fully-configured Lambert material for a surface kind.
// `repeat` scales the tile density based on face size (auto-derived
// by the caller from mesh dimensions).
export function materialFor(kind, opts = {}) {
  const tex = getTexture(kind, opts);
  const mat = pbr.building({
    map: tex,
    color: 0xffffff,
    transparent: !!opts.transparent,
    opacity: opts.opacity != null ? opts.opacity : 1.0,
  });
  return mat;
}

// Sky-dome material (BackSide) — a huge sphere sits around the scene
// with THIS material, giving all maps a shared sky look. Cloud drift
// happens via texture-uv scroll in a per-frame update (see caller).
export function skyDomeMaterial() {
  const tex = getTexture('sky');
  return new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// Convenience — create the sky sphere (radius picked to comfortably
// enclose the arena). Returns the mesh; caller adds it to scene and
// can call `scrollClouds(mesh, dt)` per-frame for slow drift.
export function createSkyDome(radius = 400) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = skyDomeMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.userData.legacySky = true;
  return mesh;
}

// Called each frame with dt; scrolls the sky texture horizontally so
// the clouds appear to drift.
export function scrollClouds(domeMesh, dt) {
  if (!domeMesh || !domeMesh.material || !domeMesh.material.map) return;
  const tex = domeMesh.material.map;
  tex.offset.x = (tex.offset.x + dt * 0.005) % 1;
}
