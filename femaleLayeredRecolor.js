// FEMALE layered-master recolor + toggle engine (Phase A modular).
//
// Mirrors layeredRecolor.js (male): every female master sprite in
// /streetfight/female_l contains ALL layers at once in a flag palette;
// this module classifies pixels into roles, then repaints per build:
//
//   flag → role       toggles
//   RED     bandana   on head / off (shows braids)
//   TEAL    hair      braided ponytail, recolorable
//   GOLD    jewelry   chain + hoops on / off
//   WHITE   shirt     open overshirt on / off
//   PINK    bra       on / off, 3 boob sizes (patch-scaled)
//   PURPLE  thong     straps visible / tucked
//   BLUE    pants     on / thong-only; per-leg rolled-up
//   GREY    socks     on / off
//   MAGENTA shoes     on / off
//
// Headgear overlays (caps, face mask) are the shared isolated item
// sprites from layeredRecolor.js, anchored to the head box of each
// pose — so they track the head in EVERY weapon stance automatically.

import { hexToRgb, rgbToHsl, applyShade, compositeHeadgear } from './layeredRecolor.js';

const F = '/streetfight/female_l';

export const FEMALE_L_POSES = {
  idle: `${F}/femalel_idle.png`,
  attack: `${F}/femalel_attack.png`,
  hit: `${F}/femalel_hit.png`,
  eat_burger: `${F}/femalel_eat_burger.png`,
  burp: `${F}/femalel_burp.png`,
  hide_trash: `${F}/femalel_hide_trash.png`,
  lean_cover: `${F}/femalel_lean_cover.png`,
  fist_punch: `${F}/femalel_fist_punch.png`,
  pistol_hold: `${F}/femalel_pistol_hold.png`,
  pistol_fire: `${F}/femalel_pistol_fire.png`,
  pistol_bash: `${F}/femalel_pistol_bash.png`,
  smg_hold: `${F}/femalel_smg_hold.png`,
  smg_fire: `${F}/femalel_smg_fire.png`,
  smg_bash: `${F}/femalel_smg_bash.png`,
  rifle_hold: `${F}/femalel_rifle_hold.png`,
  rifle_fire: `${F}/femalel_rifle_fire.png`,
  rifle_bash: `${F}/femalel_rifle_bash.png`,
  tec9_hold: `${F}/femalel_tec9_hold.png`,
  tec9_fire: `${F}/femalel_tec9_fire.png`,
  tec9_bash: `${F}/femalel_tec9_bash.png`,
  ak47_hold: `${F}/femalel_ak47_hold.png`,
  ak47_fire: `${F}/femalel_ak47_fire.png`,
  ak47_bash: `${F}/femalel_ak47_bash.png`,
  shotgun_hold: `${F}/femalel_shotgun_hold.png`,
  shotgun_fire: `${F}/femalel_shotgun_fire.png`,
  shotgun_bash: `${F}/femalel_shotgun_bash.png`,
  rpg_hold: `${F}/femalel_rpg_hold.png`,
  rpg_fire: `${F}/femalel_rpg_fire.png`,
  rpg_bash: `${F}/femalel_rpg_bash.png`,
  pipebomb_hold: `${F}/femalel_pipebomb_hold.png`,
  pipebomb_throw: `${F}/femalel_pipebomb_throw.png`,
  bat_hold: `${F}/femalel_bat_hold.png`,
  bat_swing: `${F}/femalel_bat_swing.png`,
};

// ── Preloading ───────────────────────────────────────────────────────
const _images = {};
const _ready = {};
function _kick(key, url) {
  if (_images[key]) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { _ready[key] = true; };
  img.src = url;
  _images[key] = img;
}
export function preloadFemaleLayers() {
  for (const [id, url] of Object.entries(FEMALE_L_POSES)) _kick(id, url);
}
export function areFemaleLayersReady() {
  return ['idle', 'attack', 'hit'].every(id => _ready[id]);
}

// ── Classification (flag palette → roles) ────────────────────────────
const R = {
  none: 0, outline: 1, skin: 2, hair: 3, bandana: 4, gold: 5,
  shirt: 6, bra: 7, thong: 8, pants: 9, socks: 10, shoes: 11, keep: 12,
};

// yF here is normalized to the figure's content bbox (not the canvas)
// so crouch / kneel poses keep their proportional bands.
function classify(r, g, b, yF) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const chroma = mx - mn;
  const luma = (r + g + b) / 3;
  if (r + g + b < 60) return R.outline;

  // TEAL braids — g≈b clearly above r, upper 62% of the figure.
  if (g > r * 1.15 && b > r * 1.15 && Math.abs(g - b) < Math.max(18, g * 0.22)) {
    return yF < 0.62 ? R.hair : R.pants;
  }

  // BLUE pants — blue dominant (incl. dark blue-teal shading).
  if (b > 70 && b > r * 1.25 && b > g * 1.2) return R.pants;

  // GOLD jewelry (chain + hoops) vs muzzle flash.
  if (r > 120 && g > r * 0.55 && b < g * 0.6) {
    if (luma > 185) return R.keep;                  // flash highlights
    return (yF > 0.05 && yF < 0.5) ? R.gold : R.keep;
  }

  // PINK family — bra (chest) / thong (waist) / magenta shoes (feet).
  if (r > 90 && b > r * 0.42 && g < r * 0.62 && b > g * 1.15 && b < r) {
    if (yF > 0.72) return R.shoes;
    if (yF > 0.5) return R.thong;
    return R.bra;
  }

  // RED bandana — strong red, very low blue.  Red props (pipe bomb)
  // sit at hand height and stay untouched.
  if (r > 100 && g < r * 0.5 && b < r * 0.42) {
    return yF < 0.38 ? R.bandana : R.keep;
  }

  // SKIN — warm, red-led.
  if (luma > 55 && chroma > 16 && r > g && g > b * 0.8 && b < r * 0.85) return R.skin;

  // LOW CHROMA bright — open shirt (torso) / socks (ankles).
  if (chroma < 42 && luma > 120) {
    if (yF > 0.78) return R.socks;
    if (yF > 0.08 && yF < 0.72) return R.shirt;
    return R.keep;
  }
  return R.keep;
}

const _classCache = new Map();
function classifyPose(poseId) {
  const hit = _classCache.get(poseId);
  if (hit) return hit;
  const img = _images[poseId];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const W = img.naturalWidth, H = img.naturalHeight;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0);
  const px = octx.getImageData(0, 0, W, H).data;

  // Pass 1 — content bbox (figure is bottom-anchored on the canvas).
  let top = H, bot = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] >= 8) {
        if (y < top) top = y;
        if (y > bot) bot = y;
        break;
      }
    }
  }
  const span = Math.max(1, bot - top);

  const roles = new Uint8Array(W * H);
  const Larr = new Uint8Array(W * H);
  let hx0 = W, hx1 = 0, hy0 = H, hy1 = 0;          // head (bandana+hair)
  let px0 = W, px1 = 0, py0 = H, py1 = 0;          // pants
  let bx0 = W, bx1 = 0, by0 = H, by1 = 0;          // bra
  for (let y = 0; y < H; y++) {
    const yF = (y - top) / span;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const idx = i * 4;
      if (px[idx + 3] < 8) { roles[i] = R.none; continue; }
      const r = px[idx], g = px[idx + 1], b = px[idx + 2];
      const role = classify(r, g, b, yF);
      roles[i] = role;
      const [, , L] = rgbToHsl(r, g, b);
      Larr[i] = Math.round(L * 255);
      if (role === R.bandana || role === R.hair) {
        if (x < hx0) hx0 = x; if (x > hx1) hx1 = x;
        if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
      } else if (role === R.pants) {
        if (x < px0) px0 = x; if (x > px1) px1 = x;
        if (y < py0) py0 = y; if (y > py1) py1 = y;
      } else if (role === R.bra) {
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
  }
  const out = {
    roles, L: Larr, W, H,
    head: hx1 >= hx0 ? { x: hx0, y: hy0, w: hx1 - hx0 + 1, h: hy1 - hy0 + 1 } : null,
    pants: px1 >= px0 ? { x: px0, y: py0, w: px1 - px0 + 1, h: py1 - py0 + 1 } : null,
    bra: bx1 >= bx0 ? { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } : null,
  };
  _classCache.set(poseId, out);
  return out;
}

// ── Main: recolor a female pose for a build ──────────────────────────
const _outCache = new Map();
export function invalidateFemaleCache() {
  _outCache.clear();
  _classCache.clear();
}

export function recolorFemalePose(poseId, b) {
  const img = _images[poseId];
  if (!img || !img.complete || !img.naturalWidth) return FEMALE_L_POSES[poseId];
  const key = poseId + '|' + JSON.stringify(b);
  const cached = _outCache.get(key);
  if (cached) return cached;
  const cls = classifyPose(poseId);
  if (!cls) return FEMALE_L_POSES[poseId];
  const { roles, L: Larr, W, H, head, pants, bra } = cls;

  const skin = hexToRgb(b.skinHex || '#cb9466');
  const hair = hexToRgb(b.hairHex || '#143d3d');
  const pantsRgb = hexToRgb(b.pantsHex || '#2746a7');
  const targets = {
    [R.skin]: skin,
    [R.hair]: hair,
    [R.bandana]: b.bandanaOn ? hexToRgb(b.bandanaHex || '#b91c1c') : hair,
    [R.gold]: b.chainOn ? null : skin,            // null = keep gold
    [R.shirt]: b.shirtOn ? hexToRgb(b.shirtHex || '#e8e8e8') : skin,
    [R.bra]: b.braOn ? hexToRgb(b.braHex || '#ec4899') : skin,
    [R.thong]: b.thongOn ? hexToRgb(b.thongHex || '#7c3aed')
      : (b.pantsOn ? pantsRgb : skin),
    [R.pants]: b.pantsOn ? pantsRgb : skin,
    [R.socks]: b.socksOn ? hexToRgb(b.socksHex || '#e8e8e8') : skin,
    [R.shoes]: b.shoesOn ? hexToRgb(b.shoesHex || '#e8e8e8') : skin,
  };

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const out = ctx.getImageData(0, 0, W, H);
  const data = out.data;

  const legMidX = pants ? pants.x + pants.w / 2 : W / 2;
  const legTopY = pants ? pants.y + pants.h * 0.55 : H;
  const boobScale = b.braOn ? (b.boobScale || 1) : 1;
  const scaleBra = bra && boobScale !== 1;

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    let target = targets[role];
    if (target === undefined) continue;          // none/outline/keep
    const x = i % W, y = (i / W) | 0;

    if (role === R.pants && b.pantsOn && y > legTopY) {
      const side = x < legMidX ? 'left' : 'right';
      if ((side === 'left' && b.legLeftUp) || (side === 'right' && b.legRightUp)) {
        target = skin;
      }
    }
    if (target === null) continue;               // gold kept
    // When the bra patch will be re-drawn at another size, the body
    // pass paints the original bra area as skin underneath.
    const paint = (scaleBra && role === R.bra) ? skin : target;
    const [nr, ng, nb] = applyShade(paint, Larr[i]);
    const idx = i * 4;
    data[idx] = nr; data[idx + 1] = ng; data[idx + 2] = nb;
  }

  // Extract the recolored bra patch BEFORE writing the skin-underlay
  // version back, so the patch carries the bra color.
  let patch = null;
  if (scaleBra && b.braOn) {
    patch = document.createElement('canvas');
    patch.width = bra.w; patch.height = bra.h;
    const pctx = patch.getContext('2d');
    const pdata = pctx.createImageData(bra.w, bra.h);
    const braRgb = targets[R.bra];
    for (let y = 0; y < bra.h; y++) {
      for (let x = 0; x < bra.w; x++) {
        const si = (bra.y + y) * W + (bra.x + x);
        if (roles[si] !== R.bra) continue;
        const [nr, ng, nb] = applyShade(braRgb, Larr[si]);
        const di = (y * bra.w + x) * 4;
        pdata.data[di] = nr; pdata.data[di + 1] = ng; pdata.data[di + 2] = nb;
        pdata.data[di + 3] = data[si * 4 + 3];
      }
    }
    pctx.putImageData(pdata, 0, 0);
  }

  ctx.putImageData(out, 0, 0);

  if (patch) {
    const s = boobScale;
    const cx = bra.x + bra.w / 2, cy = bra.y + bra.h / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(patch, cx - (bra.w * s) / 2, cy - (bra.h * s) / 2, bra.w * s, bra.h * s);
  }

  // Caps / face mask — shared male item overlays, anchored to her head.
  compositeHeadgear(ctx, head, {
    capMode: b.capMode,
    capHex: b.capHex,
    maskOn: b.maskOn,
    maskHex: b.maskHex,
    hoodUp: false,
  });

  const url = canvas.toDataURL('image/png');
  _outCache.set(key, url);
  return url;
}

preloadFemaleLayers();
