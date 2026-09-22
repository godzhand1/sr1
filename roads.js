// roads.js — unique, non-repeating hi-res asphalt / sidewalk texture
// generator + surface builders. Each surface receives its own seeded
// canvas texture so the eye can't lock onto a tiled pattern.
//
// Style target: pristine, freshly-paved city street (no cracks, no
// paint, no stains). Uses only:
//   • soft large-scale sealcoat tone variance
//   • fine aggregate speckle (individual "stones")
//   • very faint paving-pass seams
//   • optional manhole covers / storm drains as unique details

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';

// Mulberry32 seeded PRNG — deterministic per-tile so builds are stable.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Asphalt canvas ─────────────────────────────────────────────────
export function generateAsphaltTexture(pxW, pxH, opts = {}) {
  const seed = opts.seed || Math.floor(Math.random() * 0xffffffff);
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  // Base charcoal — slightly warm so it doesn't read as pure grey.
  const baseTone = opts.baseTone || '#1e1d1f';
  ctx.fillStyle = baseTone;
  ctx.fillRect(0, 0, pxW, pxH);

  // Sealcoat variance — soft radial gradients randomly placed.
  const patchCount = Math.floor((pxW * pxH) / 32000);
  for (let i = 0; i < patchCount; i++) {
    const px = rnd() * pxW, py = rnd() * pxH;
    const rad = 80 + rnd() * 240;
    const dark = rnd() < 0.5;
    const alpha = 0.05 + rnd() * 0.09;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, dark ? `rgba(0,0,0,${alpha})` : `rgba(220,215,205,${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }

  // Aggregate speckle — individual sub-pixel-ish stones giving the
  // asphalt its gritty micro-texture.
  const stoneCount = Math.floor(pxW * pxH * 0.028);
  const imgData = ctx.getImageData(0, 0, pxW, pxH);
  const data = imgData.data;
  for (let i = 0; i < stoneCount; i++) {
    const px = Math.floor(rnd() * pxW);
    const py = Math.floor(rnd() * pxH);
    const shade = 40 + Math.floor(rnd() * 90);
    const idx = (py * pxW + px) * 4;
    const a = 0.15 + rnd() * 0.4;
    data[idx]     = Math.round(data[idx]     * (1 - a) + shade * a);
    data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + shade * a);
    data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + (shade + rnd() * 6) * a);
  }
  ctx.putImageData(imgData, 0, 0);

  // Very faint darker paving-pass seams (subtle horizontal strokes).
  const seamCount = 2 + Math.floor(rnd() * 4);
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < seamCount; i++) {
    ctx.beginPath();
    const y = rnd() * pxH;
    ctx.moveTo(0, y + (rnd() - 0.5) * 3);
    for (let x = 32; x <= pxW; x += 32) {
      ctx.lineTo(x, y + (rnd() - 0.5) * 3);
    }
    ctx.stroke();
  }

  // Optional manhole covers.  `manholes` = [[u, v], …] in 0-1 UV.
  if (opts.manholes) {
    for (const [mu, mv] of opts.manholes) {
      const cx = mu * pxW, cy = mv * pxH;
      const r = Math.max(30, Math.min(pxW, pxH) * 0.045);
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
      g.addColorStop(0, '#2b2827');
      g.addColorStop(0.85, '#151313');
      g.addColorStop(1, '#080707');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Bar-hatch pattern (like real cast-iron covers)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(35,32,30,0.9)';
      ctx.lineWidth = 1.4;
      for (let k = -r; k <= r; k += 4) {
        ctx.beginPath();
        ctx.moveTo(cx + k, cy - r);
        ctx.lineTo(cx + k, cy + r);
        ctx.stroke();
      }
      ctx.restore();
      // Rim
      ctx.strokeStyle = '#050505';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Optional storm drain grates. `drains` = [[u, v, rot?], …]
  if (opts.drains) {
    for (const d of opts.drains) {
      const [mu, mv, rot = 0] = d;
      const cx = mu * pxW, cy = mv * pxH;
      const halfL = 60, halfW = 18;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // Grate cavity
      ctx.fillStyle = '#0a0908';
      ctx.fillRect(-halfL, -halfW, halfL * 2, halfW * 2);
      // Bar hatch
      ctx.strokeStyle = 'rgba(60,58,55,0.9)';
      ctx.lineWidth = 2.4;
      for (let k = -halfL + 6; k <= halfL - 6; k += 8) {
        ctx.beginPath();
        ctx.moveTo(k, -halfW + 2);
        ctx.lineTo(k, halfW - 2);
        ctx.stroke();
      }
      // Curb-side lip
      ctx.strokeStyle = '#080807';
      ctx.lineWidth = 2;
      ctx.strokeRect(-halfL, -halfW, halfL * 2, halfW * 2);
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ── Sidewalk canvas ────────────────────────────────────────────────
// Pale concrete slabs (~1m each) with expansion joints and grit.
export function generateSidewalkTexture(pxW, pxH, opts = {}) {
  const seed = opts.seed || Math.floor(Math.random() * 0xffffffff);
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  // Base
  ctx.fillStyle = '#7a7773';
  ctx.fillRect(0, 0, pxW, pxH);

  // Slab-scale variance — each slab a slightly different tone.
  const slabPx = opts.slabPx || Math.max(48, Math.floor(pxW / 12));
  const slabsX = Math.ceil(pxW / slabPx);
  const slabsY = Math.ceil(pxH / slabPx);
  for (let sy = 0; sy < slabsY; sy++) {
    for (let sx = 0; sx < slabsX; sx++) {
      const shade = 108 + Math.floor(rnd() * 28);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      ctx.fillRect(sx * slabPx + 1, sy * slabPx + 1, slabPx - 2, slabPx - 2);
    }
  }

  // Expansion joints (dark seams)
  ctx.strokeStyle = 'rgba(15,13,11,0.7)';
  ctx.lineWidth = 2;
  for (let sy = 0; sy <= slabsY; sy++) {
    ctx.beginPath();
    ctx.moveTo(0, sy * slabPx);
    ctx.lineTo(pxW, sy * slabPx);
    ctx.stroke();
  }
  for (let sx = 0; sx <= slabsX; sx++) {
    ctx.beginPath();
    ctx.moveTo(sx * slabPx, 0);
    ctx.lineTo(sx * slabPx, pxH);
    ctx.stroke();
  }

  // Fine grit speckle so slabs read as concrete not painted plastic.
  const imgData = ctx.getImageData(0, 0, pxW, pxH);
  const data = imgData.data;
  const stoneCount = Math.floor(pxW * pxH * 0.012);
  for (let i = 0; i < stoneCount; i++) {
    const px = Math.floor(rnd() * pxW);
    const py = Math.floor(rnd() * pxH);
    const shade = 90 + Math.floor(rnd() * 70);
    const idx = (py * pxW + px) * 4;
    const a = 0.25 + rnd() * 0.3;
    data[idx]     = Math.round(data[idx]     * (1 - a) + shade * a);
    data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + (shade - 4) * a);
    data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + (shade - 12) * a);
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ── Surface builders ───────────────────────────────────────────────

// Flat asphalt tile with a UNIQUE 1:1-mapped texture (no repetition).
// Choose `pxW` / `pxH` to match the tile's aspect so pixel density is
// even.  Defaults to ~18 px/m at pxW=1024.
export function buildAsphaltTile({
  cx, cz, w, d, y = 0, pxW = 1024, pxH, seed, manholes, drains, baseTone,
}) {
  const height = pxH || Math.max(256, Math.round(pxW * d / w));
  const tex = generateAsphaltTexture(pxW, height, { seed, manholes, drains, baseTone });
  const mat = pbr.stone({ map: tex, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  mesh.receiveShadow = true;
  return mesh;
}

// Raised sidewalk strip (0.15m tall — under STEP_UP=0.55 so players
// walk on/off smoothly). Auto-registers a climbable collider.
export function buildSidewalkStrip({ cx, cz, w, d, y = 0, seed, colliders }) {
  const px = Math.min(1024, Math.max(256, Math.floor(Math.max(w, d) * 32)));
  const py = Math.min(1024, Math.max(256, Math.floor(Math.min(w, d) * 32)));
  const tex = generateSidewalkTexture(
    w >= d ? px : py, w >= d ? py : px, { seed },
  );
  const mat = pbr.stone({ map: tex });
  const H_STRIP = 0.15;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, H_STRIP, d), mat);
  mesh.position.set(cx, y + H_STRIP / 2, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  if (colliders) {
    colliders.push({
      x0: cx - w / 2, z0: cz - d / 2,
      x1: cx + w / 2, z1: cz + d / 2,
      h: y + H_STRIP, climbable: true, step: true,
    });
  }
  return mesh;
}

// Low concrete kerb — a very thin (0.2m tall × 0.25m wide) L-shape
// between sidewalk and road. Draws visual separation without adding
// a step obstacle. Returns the mesh only (no collider — climbable).
export function buildKerb({ cx, cz, w, d, y = 0 }) {
  const KERB_H = 0.18;
  const mat = pbr.stone({ color: 0x8a8580 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, KERB_H, d), mat);
  mesh.position.set(cx, y + KERB_H / 2, cz);
  mesh.receiveShadow = true;
  return mesh;
}
