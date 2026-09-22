// buildings4k.js — hi-res realistic building facade texture generator.
//
// Each call returns a THREE.CanvasTexture painted from scratch at
// 1024×2048 (portrait, since building faces are much taller than
// wide when rendered) with:
//   • per-brick / concrete-panel drawing (no obvious tiling)
//   • mortar seams / panel joints
//   • windows in a regular grid — each independently randomized as
//     LIT (warm orange), DIM (dark orange), or OFF (near-black)
//   • window mullions + sills
//   • a subtle top cornice and bottom kick-plate
//
// Every call uses a seeded PRNG so a given building keeps the same
// facade across streams / respawns.

import * as THREE from 'three';

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

// ── Brick facade ─────────────────────────────────────────────────
// Returns a CanvasTexture with individual brick pattern + mortar +
// window grid. `tintHex` optionally shifts the brick color.
export function generateBrickFacade({
  seed = Math.floor(Math.random() * 0xffffffff),
  pxW = 1024,
  pxH = 2048,
  tintHex = 0x5a4a3a,
  windowFrameHex = 0x1a1418,
  litWindowChance = 0.35,
  dimWindowChance = 0.35,
} = {}) {
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  // Convert tint hex → RGB base + darker mortar + lighter variance
  const tR = (tintHex >> 16) & 0xff;
  const tG = (tintHex >> 8) & 0xff;
  const tB = tintHex & 0xff;
  const mortarR = Math.max(0, tR - 30);
  const mortarG = Math.max(0, tG - 28);
  const mortarB = Math.max(0, tB - 22);
  ctx.fillStyle = `rgb(${mortarR},${mortarG},${mortarB})`;
  ctx.fillRect(0, 0, pxW, pxH);

  // Brick dimensions
  const brickH = 26;                                  // px per brick tall
  const brickW = 64;                                  // px per brick wide
  const mortar = 4;
  const rows = Math.ceil(pxH / brickH);
  const cols = Math.ceil(pxW / brickW) + 1;

  for (let r = 0; r < rows; r++) {
    const y = r * brickH;
    // Alternate row offset for a running-bond pattern
    const rowOffset = (r % 2 === 0) ? 0 : brickW / 2;
    for (let c = -1; c < cols; c++) {
      const x = c * brickW + rowOffset;
      // Per-brick colour variance
      const vR = tR + Math.floor((rnd() - 0.5) * 34);
      const vG = tG + Math.floor((rnd() - 0.5) * 30);
      const vB = tB + Math.floor((rnd() - 0.5) * 26);
      ctx.fillStyle = `rgb(${clamp(vR)},${clamp(vG)},${clamp(vB)})`;
      ctx.fillRect(x + mortar / 2, y + mortar / 2, brickW - mortar, brickH - mortar);
      // Random slight highlight edge on ~30% of bricks
      if (rnd() < 0.28) {
        ctx.fillStyle = `rgba(${clamp(vR + 20)},${clamp(vG + 16)},${clamp(vB + 12)},0.35)`;
        ctx.fillRect(x + mortar / 2, y + mortar / 2, brickW - mortar, 3);
      }
      // Random dark chip on ~8% of bricks
      if (rnd() < 0.08) {
        ctx.fillStyle = `rgba(0,0,0,0.25)`;
        const cw = 3 + rnd() * 6, ch = 2 + rnd() * 5;
        ctx.fillRect(
          x + mortar + rnd() * (brickW - mortar - cw - 4),
          y + mortar + rnd() * (brickH - mortar - ch - 4),
          cw, ch,
        );
      }
    }
  }

  // Fine grain speckle across the whole facade (weathered surface).
  const imgData = ctx.getImageData(0, 0, pxW, pxH);
  const data = imgData.data;
  const grit = Math.floor(pxW * pxH * 0.01);
  for (let i = 0; i < grit; i++) {
    const px = Math.floor(rnd() * pxW);
    const py = Math.floor(rnd() * pxH);
    const shade = 40 + Math.floor(rnd() * 80);
    const idx = (py * pxW + px) * 4;
    const a = 0.10 + rnd() * 0.20;
    data[idx]     = Math.round(data[idx]     * (1 - a) + shade * a);
    data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + shade * a);
    data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + shade * a);
  }
  ctx.putImageData(imgData, 0, 0);

  // ── Windows — regular grid, each independently randomized ──
  // Windows are inset by margin; the grid is ~4 wide × 6 tall on a
  // portrait 1024×2048 canvas so it looks like a proper apartment
  // building elevation.
  const winCols = 4;
  const winRows = 6;
  const winPadX = 96;
  const winPadY = 200;
  const winW = (pxW - winPadX * 2 - (winCols - 1) * 40) / winCols;
  const winH = (pxH - winPadY * 2 - (winRows - 1) * 55) / winRows;
  const fR = (windowFrameHex >> 16) & 0xff;
  const fG = (windowFrameHex >> 8) & 0xff;
  const fB = windowFrameHex & 0xff;
  const frameCol = `rgb(${fR},${fG},${fB})`;
  for (let wy = 0; wy < winRows; wy++) {
    for (let wx = 0; wx < winCols; wx++) {
      const x = winPadX + wx * (winW + 40);
      const y = winPadY + wy * (winH + 55);
      // Sill (a slightly-protruding stone)
      ctx.fillStyle = `rgb(${clamp(tR + 12)},${clamp(tG + 10)},${clamp(tB + 8)})`;
      ctx.fillRect(x - 4, y + winH, winW + 8, 8);
      // Frame
      ctx.fillStyle = frameCol;
      ctx.fillRect(x, y, winW, winH);
      // Glass — three states
      const roll = rnd();
      let glass;
      if (roll < litWindowChance) {
        // Lit — warm interior
        const gr = ctx.createLinearGradient(x, y, x, y + winH);
        gr.addColorStop(0, '#ffdb85');
        gr.addColorStop(1, '#c07030');
        glass = gr;
      } else if (roll < litWindowChance + dimWindowChance) {
        // Dim — TV-lit blue or dim orange
        const isTV = rnd() < 0.35;
        const gr = ctx.createLinearGradient(x, y, x, y + winH);
        if (isTV) { gr.addColorStop(0, '#3a5f9c'); gr.addColorStop(1, '#182238'); }
        else      { gr.addColorStop(0, '#a05028'); gr.addColorStop(1, '#402014'); }
        glass = gr;
      } else {
        // Off — near-black with a subtle reflection
        const gr = ctx.createLinearGradient(x, y, x + winW, y + winH);
        gr.addColorStop(0, '#0d1218');
        gr.addColorStop(0.5, '#1a2028');
        gr.addColorStop(1, '#0a0f14');
        glass = gr;
      }
      ctx.fillStyle = glass;
      ctx.fillRect(x + 5, y + 5, winW - 10, winH - 10);
      // Mullion cross (vertical + horizontal bar)
      ctx.fillStyle = frameCol;
      ctx.fillRect(x + winW / 2 - 2, y + 5, 4, winH - 10);
      ctx.fillRect(x + 5, y + winH / 2 - 2, winW - 10, 4);
      // AC unit protrusion on ~15% of windows
      if (rnd() < 0.15) {
        ctx.fillStyle = '#7c7c80';
        ctx.fillRect(x + winW * 0.15, y + winH * 0.60, winW * 0.42, winH * 0.30);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let vv = 0; vv < 5; vv++) {
          ctx.fillRect(x + winW * 0.18 + vv * (winW * 0.42 - 6) / 5, y + winH * 0.62, 4, winH * 0.26);
        }
      }
    }
  }

  // Top cornice (protruding stone band, top ~48px)
  ctx.fillStyle = `rgb(${clamp(tR + 18)},${clamp(tG + 14)},${clamp(tB + 10)})`;
  ctx.fillRect(0, 0, pxW, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 48, pxW, 4);
  // Bottom kick-plate (darker stone ~80px)
  ctx.fillStyle = `rgb(${clamp(tR - 20)},${clamp(tG - 18)},${clamp(tB - 14)})`;
  ctx.fillRect(0, pxH - 80, pxW, 80);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, pxH - 84, pxW, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ── Concrete tenement facade ────────────────────────────────────
// Same window logic but plain concrete panels instead of bricks.
// Slightly different vibe — looks like a projects building.
export function generateConcreteFacade({
  seed = Math.floor(Math.random() * 0xffffffff),
  pxW = 1024,
  pxH = 2048,
  tintHex = 0x6a6a6c,
  windowFrameHex = 0x14161a,
  litWindowChance = 0.28,
  dimWindowChance = 0.30,
} = {}) {
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d');

  const tR = (tintHex >> 16) & 0xff;
  const tG = (tintHex >> 8) & 0xff;
  const tB = tintHex & 0xff;
  ctx.fillStyle = `rgb(${tR},${tG},${tB})`;
  ctx.fillRect(0, 0, pxW, pxH);

  // Panel joints — vertical seams every 320px, horizontal every 512px
  const panelW = 320;
  const panelH = 512;
  // Per-panel variance
  for (let py = 0; py < pxH; py += panelH) {
    for (let px = 0; px < pxW; px += panelW) {
      const vR = tR + Math.floor((rnd() - 0.5) * 18);
      const vG = tG + Math.floor((rnd() - 0.5) * 16);
      const vB = tB + Math.floor((rnd() - 0.5) * 14);
      ctx.fillStyle = `rgb(${clamp(vR)},${clamp(vG)},${clamp(vB)})`;
      ctx.fillRect(px + 2, py + 2, panelW - 4, panelH - 4);
    }
  }
  // Joint lines
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 3;
  for (let py = 0; py <= pxH; py += panelH) {
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(pxW, py); ctx.stroke();
  }
  for (let px = 0; px <= pxW; px += panelW) {
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, pxH); ctx.stroke();
  }

  // Rain-streak stains — vertical dark blurs starting from window sills
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let s = 0; s < 24; s++) {
    const sx = rnd() * pxW;
    const sy = rnd() * (pxH * 0.7);
    const sw = 4 + rnd() * 12;
    const sh = 60 + rnd() * 320;
    ctx.fillRect(sx, sy, sw, sh);
  }

  // Grain speckle
  const imgData = ctx.getImageData(0, 0, pxW, pxH);
  const data = imgData.data;
  const grit = Math.floor(pxW * pxH * 0.010);
  for (let i = 0; i < grit; i++) {
    const px = Math.floor(rnd() * pxW);
    const py = Math.floor(rnd() * pxH);
    const shade = 40 + Math.floor(rnd() * 80);
    const idx = (py * pxW + px) * 4;
    const a = 0.10 + rnd() * 0.18;
    data[idx]     = Math.round(data[idx]     * (1 - a) + shade * a);
    data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + shade * a);
    data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + shade * a);
  }
  ctx.putImageData(imgData, 0, 0);

  // Windows — same grid as brick variant
  const winCols = 4;
  const winRows = 6;
  const winPadX = 96;
  const winPadY = 200;
  const winW = (pxW - winPadX * 2 - (winCols - 1) * 40) / winCols;
  const winH = (pxH - winPadY * 2 - (winRows - 1) * 55) / winRows;
  const fR = (windowFrameHex >> 16) & 0xff;
  const fG = (windowFrameHex >> 8) & 0xff;
  const fB = windowFrameHex & 0xff;
  const frameCol = `rgb(${fR},${fG},${fB})`;
  for (let wy = 0; wy < winRows; wy++) {
    for (let wx = 0; wx < winCols; wx++) {
      const x = winPadX + wx * (winW + 40);
      const y = winPadY + wy * (winH + 55);
      // Sill
      ctx.fillStyle = `rgb(${clamp(tR + 12)},${clamp(tG + 10)},${clamp(tB + 8)})`;
      ctx.fillRect(x - 4, y + winH, winW + 8, 8);
      // Frame
      ctx.fillStyle = frameCol;
      ctx.fillRect(x, y, winW, winH);
      // Glass state
      const roll = rnd();
      let glass;
      if (roll < litWindowChance) {
        const gr = ctx.createLinearGradient(x, y, x, y + winH);
        gr.addColorStop(0, '#ffcf7a'); gr.addColorStop(1, '#a05820');
        glass = gr;
      } else if (roll < litWindowChance + dimWindowChance) {
        const isTV = rnd() < 0.35;
        const gr = ctx.createLinearGradient(x, y, x, y + winH);
        if (isTV) { gr.addColorStop(0, '#2f5390'); gr.addColorStop(1, '#141c30'); }
        else      { gr.addColorStop(0, '#8a4620'); gr.addColorStop(1, '#38180c'); }
        glass = gr;
      } else {
        const gr = ctx.createLinearGradient(x, y, x + winW, y + winH);
        gr.addColorStop(0, '#0d1218'); gr.addColorStop(0.5, '#1a2028'); gr.addColorStop(1, '#0a0f14');
        glass = gr;
      }
      ctx.fillStyle = glass;
      ctx.fillRect(x + 5, y + 5, winW - 10, winH - 10);
      // Mullion cross
      ctx.fillStyle = frameCol;
      ctx.fillRect(x + winW / 2 - 2, y + 5, 4, winH - 10);
      ctx.fillRect(x + 5, y + winH / 2 - 2, winW - 10, 4);
      if (rnd() < 0.18) {
        ctx.fillStyle = '#7c7c80';
        ctx.fillRect(x + winW * 0.15, y + winH * 0.60, winW * 0.42, winH * 0.30);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let vv = 0; vv < 5; vv++) {
          ctx.fillRect(x + winW * 0.18 + vv * (winW * 0.42 - 6) / 5, y + winH * 0.62, 4, winH * 0.26);
        }
      }
    }
  }

  // Top cornice + bottom plate
  ctx.fillStyle = `rgb(${clamp(tR + 14)},${clamp(tG + 12)},${clamp(tB + 10)})`;
  ctx.fillRect(0, 0, pxW, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 48, pxW, 4);
  ctx.fillStyle = `rgb(${clamp(tR - 18)},${clamp(tG - 16)},${clamp(tB - 12)})`;
  ctx.fillRect(0, pxH - 80, pxW, 80);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, pxH - 84, pxW, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }
