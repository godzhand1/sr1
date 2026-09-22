// Parallax sky + textured buildings + concrete/asphalt ground for the
// Stilwater Barrio.  Uses real Saints Row 1 textures extracted from the
// user's uploaded `mp_bor_02.peg_xbox2` (see /streetfight/peg/mp_bor_02/).
//
// Layering (back → front):
//   1. Sky gradient (procedural, tinted by timeOfDay)
//   2. Stars (only at night)
//   3. Far skyline silhouette (procedural, dark — keeps depth cues)
//   4. Mid brick wall band (TEXTURED — tiled brick + window grid)
//   5. Graffiti decals on the mid wall
//   6. Neon glow overlay (night only)
// Then renderGround draws:
//   7. Concrete sidewalk strip (TEXTURED tiled concrete)
//   8. Asphalt road (TEXTURED tiled, darker concrete variant)
//   9. Yellow centerline dashes
//  10. Foreground props (dumpsters, barrels, posters) — sparse, deterministic
//  11. Vignette
//
// Time-of-day shading is applied via a multiply-mode overlay on the
// textured bands so the same assets read as day, dusk, or night.

import { getImg } from './render.js';

const TEX = '/streetfight/peg/mp_bor_02';

// Pool of real SR1 textures we'll cycle through.  Only diffuse maps that
// passed a visual verification — DXT-decoded normal/bump maps look like
// rainbow noise and have been excluded.
const BRICK_DIFFUSE = [
  `${TEX}/a13_brick_co.png`,
  `${TEX}/a16_bigbrick_co.png`,
];
const CONCRETE = `${TEX}/sidewalk04g04_co.png`;      // proper sidewalk paving stones
// Road is procedural — extracted DXT asphalt textures had either rainbow
// noise (postcement, a14_concrete) or 37% black pixels (mp_asphalt03b)
// that tiled badly.
const GRAFFITI = [
  `${TEX}/a08_graffiti2.png`,
  `${TEX}/a14_graffiti03_d.png`,
  `${TEX}/a14_graffiti04_d.png`,
  `${TEX}/a15_graffiti_003.png`,
  `${TEX}/a19_graffiti008.png`,
];
const POSTERS = [
  `${TEX}/bustoposter01_gl.png`,
  `${TEX}/bustoposter03_gl.png`,
  `${TEX}/bustoposter08_gl.png`,
  `${TEX}/bustoposter11_gl.png`,
  `${TEX}/bustoposter17_gl.png`,
];

// Pattern cache keyed by `${url}@${scale}`.  CanvasPattern is cheap to
// recreate but we keep a Map anyway so re-renders don't churn.  We always
// composite onto an opaque background so DXT diffuse maps with leftover
// alpha-channel garbage don't show through as black holes.
const _patternCache = new Map();
function getPattern(ctx, url, scale = 1, bg = '#2a1610') {
  const key = `${url}@${scale}@${bg}`;
  const cached = _patternCache.get(key);
  if (cached) return cached;
  const img = getImg(url);
  if (!img.complete || img.naturalWidth === 0) return null;
  const off = document.createElement('canvas');
  off.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
  off.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  // Solid backdrop so transparent pixels don't punch holes.
  octx.fillStyle = bg;
  octx.fillRect(0, 0, off.width, off.height);
  octx.drawImage(img, 0, 0, off.width, off.height);
  const pattern = ctx.createPattern(off, 'repeat');
  if (pattern) _patternCache.set(key, pattern);
  return pattern;
}

// ── Realistic day/night colour interpolation ────────────────────
// Each palette maps to a specific `timeOfDay` anchor. Between anchors
// we lerp componentwise so the sky/light/tint drift smoothly instead
// of snapping when `t` crosses a phase boundary. Anchors are chosen
// to hit iconic moments (dawn, noon, golden hour, dusk, night).
const _SKY_ANCHORS = [
  { t: 0.00, c: ['#04040c', '#0c1130', '#1e1b4b'] }, // deep night
  { t: 0.12, c: ['#0d1336', '#3b2553', '#854a3b'] }, // dawn
  { t: 0.30, c: ['#1d4ed8', '#60a5fa', '#fde68a'] }, // morning
  { t: 0.50, c: ['#3b82f6', '#93c5fd', '#fef3c7'] }, // noon
  { t: 0.62, c: ['#7c2d12', '#ea580c', '#f5d061'] }, // golden hour
  { t: 0.74, c: ['#3b1255', '#7e22ce', '#dc2626'] }, // dusk
  { t: 0.88, c: ['#0a0a23', '#1e3a8a', '#312e81'] }, // night
  { t: 1.00, c: ['#04040c', '#0c1130', '#1e1b4b'] }, // late night → loop
];
const _AMBIENT_ANCHORS = [
  { t: 0.00, rgba: [8,  10, 30, 0.82] },    // late night
  { t: 0.12, rgba: [60, 50, 110, 0.55] },   // dawn deep
  { t: 0.30, rgba: [255, 245, 220, 0]   },  // clear
  { t: 0.50, rgba: [255, 245, 220, 0]   },  // noon (no tint)
  { t: 0.62, rgba: [255, 170, 90, 0.30] },  // golden
  { t: 0.74, rgba: [170, 70, 130, 0.50] },  // dusk
  { t: 0.88, rgba: [20, 25, 60, 0.72] },    // night
  { t: 1.00, rgba: [8,  10, 30, 0.82] },    // wraps
];
const _LIGHT_ANCHORS = [
  { t: 0.00, rgba: [4,  6, 22, 0.55] },
  { t: 0.12, rgba: [20, 15, 50, 0.30] },
  { t: 0.30, rgba: [255, 245, 220, 0]   },
  { t: 0.50, rgba: [255, 245, 220, 0]   },
  { t: 0.62, rgba: [200, 110, 70, 0.18] },
  { t: 0.74, rgba: [120, 50, 110, 0.28] },
  { t: 0.88, rgba: [10, 14, 40, 0.40] },
  { t: 1.00, rgba: [4,  6, 22, 0.55] },
];

// Parse #RRGGBB → [r,g,b].
function _hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function _rgbHex(r, g, b) {
  const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
function _findBracket(anchors, t) {
  for (let i = 0; i < anchors.length - 1; i++) {
    if (t >= anchors[i].t && t <= anchors[i + 1].t) {
      const span = (anchors[i + 1].t - anchors[i].t) || 1;
      const u = (t - anchors[i].t) / span;
      return [anchors[i], anchors[i + 1], u];
    }
  }
  return [anchors[anchors.length - 1], anchors[anchors.length - 1], 0];
}
function _lerp(a, b, u) { return a + (b - a) * u; }

// Sky gradient palette by time-of-day (0..1) — SMOOTHLY interpolated
// between anchors so the drift feels natural instead of stepped.
function skyPalette(t) {
  const [a, b, u] = _findBracket(_SKY_ANCHORS, t);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const [r0, g0, b0] = _hexRgb(a.c[i]);
    const [r1, g1, b1] = _hexRgb(b.c[i]);
    out.push(_rgbHex(_lerp(r0, r1, u), _lerp(g0, g1, u), _lerp(b0, b1, u)));
  }
  return out;
}

function _lerpRgba(a, b, u) {
  const r = _lerp(a[0], b[0], u);
  const g = _lerp(a[1], b[1], u);
  const bl = _lerp(a[2], b[2], u);
  const al = _lerp(a[3], b[3], u);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)}, ${al.toFixed(3)})`;
}

// Color used as a multiply-mode shadow over textured bands — pulls SR1's
// daylight-baked diffuse maps toward the current ambient.
function ambientTint(t) {
  const [a, b, u] = _findBracket(_AMBIENT_ANCHORS, t);
  return _lerpRgba(a.rgba, b.rgba, u);
}

function neonOn(t) {
  // Smooth window: 0.60 → 0.98. Callers can also fade via `neonIntensity(t)`.
  return t >= 0.60 && t <= 0.98;
}

// Neon intensity envelope for smooth fade-in / fade-out around dusk +
// night. Used by callers that want to modulate glow strength.
export function neonIntensity(t) {
  if (t < 0.60 || t > 0.98) return 0;
  if (t < 0.72) return (t - 0.60) / 0.12;       // fade in dusk → 1
  if (t > 0.94) return (0.98 - t) / 0.04;       // fade out just before dawn
  return 1;
}

// Source-over overlay (vs multiply) used on textured ground.  Lighter
// so the asphalt/concrete texture details stay visible at dusk/night
// instead of being crushed to hard black blocks.
function lightTint(t) {
  const [a, b, u] = _findBracket(_LIGHT_ANCHORS, t);
  return _lerpRgba(a.rgba, b.rgba, u);
}

export function renderBackground(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const t = state.timeOfDay;
  const [c0, c1, c2] = skyPalette(t);

  // Sky.
  const grd = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  grd.addColorStop(0, c0);
  grd.addColorStop(0.55, c1);
  grd.addColorStop(1, c2);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h * 0.7);

  // Stars at night.
  if (t > 0.78 && t < 0.99) {
    const starAlpha = Math.min(1, (t - 0.78) / 0.1);
    ctx.fillStyle = `rgba(255,255,255,${0.8 * starAlpha})`;
    const camX = state.cameraX;
    for (let i = 0; i < 40; i++) {
      const sx = (((i * 137 + 91) % 1000) - camX * 0.05) % w;
      const sy = ((i * 73) % (h * 0.5));
      ctx.fillRect(sx >= 0 ? sx : sx + w, sy, 1.5, 1.5);
    }
  }

  // Far skyline — keep procedural silhouette (extra depth cue, hides
  // behind the textured mid band).
  drawSilhouetteLayer(ctx, state, 0.2, 0.32, '#10131e', 110);

  // Mid wall band — TEXTURED bricks, runs from yLine roughly to ground.
  drawBrickWall(ctx, state);

  // Graffiti decals on the brick wall.
  drawGraffitiDecals(ctx, state);

  // Neon glow strip across the wall at night.
  if (neonOn(t)) {
    const glowGrad = ctx.createLinearGradient(0, h * 0.42, 0, h * 0.62);
    glowGrad.addColorStop(0, 'rgba(255, 0, 162, 0)');
    glowGrad.addColorStop(0.5, 'rgba(255, 0, 162, 0.18)');
    glowGrad.addColorStop(1, 'rgba(255, 0, 162, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, h * 0.42, w, h * 0.2);
  }
}

// Simple far-distance silhouette (no texture).  Kept procedural so the
// skyline reads even before textures finish loading.
function drawSilhouetteLayer(ctx, state, parallax, baseY, color, jitter) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const offset = -state.cameraX * parallax;
  const yLine = h * baseY;
  ctx.fillStyle = color;
  for (let bx = -120; bx < w + 120; bx += 90) {
    const worldX = bx - offset;
    const seed = Math.abs(Math.sin(worldX * 0.013)) * 1e3;
    const bh = 80 + ((seed | 0) % jitter) + jitter * 0.4;
    ctx.fillRect(bx, yLine - bh, 70, bh + h * (1 - baseY));
  }
}

// Mid wall: tile brick textures across the band, varying which brick
// asset is used per column.  Adds a window grid on top using a real SR1
// window texture.
function drawBrickWall(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const t = state.timeOfDay;
  const parallax = 0.45;
  const offset = -state.cameraX * parallax;
  const yTop = h * 0.30;   // top of the wall band (flat — variations baked into the texture)
  const yBot = h * 0.62;   // sidewalk top
  const colW = 256;        // each "building" column ~256px wide
  const startCol = Math.floor((-offset - colW) / colW);
  const endCol   = Math.ceil((w - offset + colW) / colW);

  // First pass: paint the entire wall band as one tiled brick fill so we
  // never get black "gaps" between column boundaries.  Use the bigger
  // 256×256 brick which has consistent brick density (no large mortar
  // bands like the 128×256 variant has).
  const basePat = getPattern(ctx, `${TEX}/a16_bigbrick_co.png`, 0.5, '#2a1610');
  if (basePat) {
    ctx.fillStyle = basePat;
    ctx.fillRect(0, yTop, w, yBot - yTop);
  } else {
    ctx.fillStyle = t < 0.78 ? '#3a1d28' : '#1a0d10';
    ctx.fillRect(0, yTop, w, yBot - yTop);
  }

  for (let c = startCol; c <= endCol; c++) {
    const sx = c * colW + offset;
    // Per-column deterministic randomness.
    const seed = Math.abs(Math.sin(c * 12.9898 + 78.233)) * 43758.5453;
    const seedInt = Math.abs(seed | 0);

    // Column divider — a vertical dark seam every colW to read as
    // building-to-building separation.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx + colW - 2, yTop, 4, yBot - yTop);

    // Inset window grid — drawn as solid lit rectangles (the SR1 window
    // diffuse maps DXT-decoded into noisy garbage, so we paint stylized
    // windows ourselves and reserve the brick texture for the wall).
    // Per-column padY jitter so window rows don't perfectly line up
    // across columns and form horizontal dark "bands".
    const winW = 32, winH = 42, padX = 22, gapX = 22, gapY = 22;
    const padY = 26 + (seedInt % 18);
    for (let wy = yTop + padY; wy + winH < yBot - 6; wy += winH + gapY) {
      for (let wx = sx + padX; wx + winW < sx + colW - padX; wx += winW + gapX) {
        // Skip a few windows for variety.
        if (((wx + wy + seedInt) | 0) % 5 === 0) continue;
        // Glass — lit yellow at night, dim slate by day.
        const lit = neonOn(t) && (((wx + wy) | 0) % 3 !== 0);
        if (lit) {
          ctx.fillStyle = '#fde047';
          ctx.fillRect(wx, wy, winW, winH);
          // Sash cross.
          ctx.fillStyle = '#a16207';
          ctx.fillRect(wx + winW / 2 - 1, wy, 2, winH);
          ctx.fillRect(wx, wy + winH / 2 - 1, winW, 2);
        } else {
          ctx.fillStyle = t < 0.45 ? '#3b4659' : '#1c2330';
          ctx.fillRect(wx, wy, winW, winH);
          // Subtle reflection bar.
          ctx.fillStyle = t < 0.45 ? '#5b7393' : '#2a3344';
          ctx.fillRect(wx, wy + 4, winW, 3);
        }
        // Thin sill at the bottom (lighter so it reads against the brick).
        ctx.fillStyle = 'rgba(255, 230, 200, 0.25)';
        ctx.fillRect(wx - 2, wy + winH, winW + 4, 2);
      }
    }
  }

  // Ambient multiply tint over the wall band so time-of-day reads on the
  // textured surface (SR1 diffuses are baked for daylight).
  const tint = ambientTint(t);
  if (tint !== 'rgba(255, 245, 220, 0)') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(0, yTop, w, yBot - yTop);
    ctx.restore();
  }
}

// Scatter graffiti tags along the brick wall.  Deterministic per
// world-x bucket so the same tag stays in the same spot as you walk.
function drawGraffitiDecals(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const parallax = 0.45;
  const yWall = h * 0.50;
  const offset = -state.cameraX * parallax;
  const bucket = 380;
  const startB = Math.floor((-offset - bucket) / bucket);
  const endB   = Math.ceil((w - offset + bucket) / bucket);

  for (let b = startB; b <= endB; b++) {
    const seed = Math.abs(Math.sin(b * 7.13 + 19.7)) * 1e4;
    const seedInt = (seed | 0);
    const gIdx = seedInt % GRAFFITI.length;
    const img = getImg(GRAFFITI[gIdx]);
    if (!img.complete || img.naturalWidth === 0) continue;
    const x = b * bucket + offset + ((seedInt >> 6) % 120);
    const y = yWall + ((seedInt >> 3) % 40) - 20;
    const scale = 0.75 + ((seedInt >> 9) % 30) / 100;
    const dw = 140 * scale;
    const dh = (img.naturalHeight / img.naturalWidth) * dw;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, x, y, dw, dh);
    ctx.restore();
  }
}

// Ground — concrete sidewalk lip + asphalt road, both textured.  Also
// draws scattered foreground props (dumpster/barrel/poster) that sit
// against the wall lip for parallax depth.
export function renderGround(ctx, state) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const t = state.timeOfDay;
  const groundTop = h * 0.62;
  const sidewalkH = 22;

  // Sidewalk concrete (textured, opaque backdrop).  Drawn without
  // ctx.translate so the pattern tiles cleanly from canvas origin
  // (translate + pattern + cached pattern combo produced visible seams).
  const sidewalkPat = getPattern(ctx, CONCRETE, 0.5, '#4a4a52');
  if (sidewalkPat) {
    ctx.fillStyle = sidewalkPat;
    ctx.fillRect(0, groundTop, w, sidewalkH);
  } else {
    ctx.fillStyle = t > 0.78 ? '#2a2a35' : '#5a5a65';
    ctx.fillRect(0, groundTop, w, sidewalkH);
  }

  // Road asphalt — procedural.  We bake a small canvas with deterministic
  // pseudo-random noise then tile it as a pattern so the asphalt has
  // visible grain without relying on any extracted DXT texture.
  const roadPat = getProceduralAsphalt(ctx);
  ctx.fillStyle = roadPat;
  ctx.fillRect(0, groundTop + sidewalkH, w, h - (groundTop + sidewalkH));
  // Darken at night.
  if (t > 0.78) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, groundTop + sidewalkH, w, h - (groundTop + sidewalkH));
  }

  // Sidewalk seam lines.
  ctx.strokeStyle = t > 0.78 ? '#13131a' : '#3e3e48';
  ctx.lineWidth = 1;
  const dashOffset = state.cameraX % 80;
  for (let x = -dashOffset; x < w; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, groundTop);
    ctx.lineTo(x, groundTop + sidewalkH);
    ctx.stroke();
  }

  // Dashed yellow centerline (kept procedural — easier to control).
  ctx.fillStyle = '#facc15';
  const centerY = h * 0.82;
  const dashOff = state.cameraX % 70;
  for (let x = -dashOff; x < w; x += 70) {
    ctx.fillRect(x, centerY, 40, 5);
  }

  // Foreground props along the sidewalk lip.  Deterministic per world
  // bucket so the same dumpster sits in the same alley.
  drawSidewalkProps(ctx, state, groundTop);

  // Apply ambient tint to the ground band (multiplies textured asphalt /
  // concrete to night tones at dusk/night) — softer than the wall tint
  // because the SR1 sidewalk/asphalt diffuses have dark patches that
  // turn into hard black at heavy multiply.
  const tint = ambientTint(t);
  if (tint !== 'rgba(255, 245, 220, 0)') {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // Use a lifted, semi-transparent overlay instead of multiply so
    // texture detail isn't crushed into hard black blocks.
    ctx.fillStyle = lightTint(t);
    ctx.fillRect(0, groundTop, w, h - groundTop);
    ctx.restore();
  }

  // Vignette toward bottom.
  const gradV = ctx.createLinearGradient(0, h * 0.7, 0, h);
  gradV.addColorStop(0, 'rgba(0,0,0,0)');
  gradV.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = gradV;
  ctx.fillRect(0, h * 0.7, w, h * 0.3);
}

function drawSidewalkProps(ctx, state, groundTop) {
  const w = ctx.canvas.width;
  // Props live at parallax 1.0 (foreground), so they move 1:1 with camera.
  const offset = -state.cameraX;
  const bucket = 280;
  const startB = Math.floor((-offset - bucket) / bucket);
  const endB   = Math.ceil((w - offset + bucket) / bucket);

  for (let b = startB; b <= endB; b++) {
    const seed = Math.abs(Math.sin(b * 3.71 + 41.13)) * 1e4;
    const seedInt = Math.abs(seed | 0);
    const kind = seedInt % 4;  // 0=dumpster, 1=barrel, 2=poster, 3=empty
    const localX = (seedInt >> 5) % 180;
    const x = b * bucket + offset + localX;
    const yBase = groundTop + 22;  // top of asphalt = where props sit

    if (kind === 0) drawDumpster(ctx, x, yBase, seedInt);
    else if (kind === 1) drawBarrel(ctx, x, yBase, seedInt);
    else if (kind === 2) {
      // Poster on the wall just above the sidewalk.
      const pIdx = (seedInt >> 8) % POSTERS.length;
      const img = getImg(POSTERS[pIdx]);
      if (img.complete && img.naturalWidth > 0) {
        const dw = 60, dh = 88;
        // Solid backdrop so DXT alpha leftovers stay hidden.
        ctx.fillStyle = '#0e0e10';
        ctx.fillRect(x - 2, groundTop - dh - 30 - 2, dw + 4, dh + 4);
        ctx.drawImage(img, x, groundTop - dh - 30, dw, dh);
      }
    }
  }
}

// Procedural asphalt tile — 128×128 dark gray with deterministic specks
// and a couple of pale cracks.  Cached once.
let _asphaltPattern = null;
function getProceduralAsphalt(ctx) {
  if (_asphaltPattern) return _asphaltPattern;
  const SIZE = 128;
  const off = document.createElement('canvas');
  off.width = SIZE; off.height = SIZE;
  const octx = off.getContext('2d');
  // Base.
  octx.fillStyle = '#15151a';
  octx.fillRect(0, 0, SIZE, SIZE);
  // Specks.
  for (let i = 0; i < 1400; i++) {
    const x = (i * 89) % SIZE;
    const y = ((i * 53) ^ (i * 17)) % SIZE;
    const v = 18 + ((i * 7) % 32);
    octx.fillStyle = `rgb(${v},${v},${v + 2})`;
    octx.fillRect(x, y, 1, 1);
  }
  // Pale gravel pieces.
  for (let i = 0; i < 60; i++) {
    const x = (i * 37 + 11) % SIZE;
    const y = (i * 71 + 19) % SIZE;
    const v = 60 + ((i * 5) % 30);
    octx.fillStyle = `rgb(${v},${v},${v - 4})`;
    octx.fillRect(x, y, 2, 1);
  }
  // A few hairline cracks (one diagonal, one curved).
  octx.strokeStyle = 'rgba(110, 100, 90, 0.35)';
  octx.lineWidth = 1;
  octx.beginPath();
  octx.moveTo(6, 90); octx.lineTo(40, 64); octx.lineTo(70, 80); octx.lineTo(120, 50);
  octx.stroke();
  _asphaltPattern = ctx.createPattern(off, 'repeat');
  return _asphaltPattern;
}

// Procedural dumpster — sits on the sidewalk lip.  Saints purple accents
// at top so it reads as 3rd Street's.
function drawDumpster(ctx, x, yBase, seedInt) {
  const w = 92, h = 60;
  const y = yBase - h;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x + w / 2, yBase + 4, w / 2 + 4, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Body.
  const tag = seedInt % 3;
  const bodyColor = tag === 0 ? '#1d3a8a' : tag === 1 ? '#3a1d28' : '#1f3a1f';  // saints blue / brick / olive
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, y + 10, w, h - 10);
  // Lid.
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(x - 3, y + 4, w + 6, 8);
  // Front panel highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, y + 12, w, 4);
  // Ribs.
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let rx = x + 14; rx < x + w - 6; rx += 18) {
    ctx.fillRect(rx, y + 14, 2, h - 18);
  }
  // Saints tag spray.
  ctx.fillStyle = '#5b21b6';
  ctx.font = 'bold 11px Chivo, sans-serif';
  ctx.fillText('3rd', x + 8, y + h - 8);
}

// Procedural rusty oil drum.
function drawBarrel(ctx, x, yBase, seedInt) {
  const w = 32, h = 56;
  const y = yBase - h;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x + w / 2, yBase + 3, w / 2 + 3, 5, 0, 0, Math.PI * 2); ctx.fill();
  const variant = seedInt % 3;
  const body = variant === 0 ? '#7a2e1a' : variant === 1 ? '#3a3a3a' : '#a16207';
  ctx.fillStyle = body;
  ctx.fillRect(x, y, w, h);
  // Top + bottom rims.
  ctx.fillStyle = '#1a1209';
  ctx.fillRect(x, y, w, 4);
  ctx.fillRect(x, y + h - 4, w, 4);
  // Belt rings.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + 18, w, 3);
  ctx.fillRect(x, y + h - 18, w, 3);
  // Vertical highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x + 3, y + 6, 3, h - 12);
  // Hazard glyph.
  if (variant === 2) {
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(x + w / 2 - 6, y + h / 2 - 6, 12, 12);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(x + w / 2 - 3, y + h / 2 - 6, 1, 9);
    ctx.fillRect(x + w / 2 + 1, y + h / 2 - 6, 1, 9);
  }
}
