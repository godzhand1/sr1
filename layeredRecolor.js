// MALE layered-master recolor + toggle engine (Phase A modular system).
//
// Every male master sprite contains ALL layers at once in a flag
// palette; this module classifies each pixel into a layer role, then
// repaints according to the build's toggles + colors:
//
//   flag → role        toggles
//   RED    bandana     on head / off (shows hair)
//   TEAL   hair        recolorable
//   GOLD   chain       on / off
//   GREEN  jacket      on / off (+ hood-up overlay)
//   BLUE   shirt       on / off
//   WHITE  undershirt  on / off (off + shirt off = bare chest, hairy option)
//   ORANGE boxers      sag below (visible) / above (pants color) / boxers-only
//   PURPLE pants       on / boxers-only; per-leg rolled-up
//   GREY   socks       on / off
//   MAGENTA shoes      on / off
//
// Headgear overlays (cap straight/back/side, bandana face mask, hood
// up) are isolated item sprites anchored to the head box computed from
// the bandana+hair pixels of each pose — so they track the head in
// EVERY weapon stance automatically.

const M = '/streetfight/male';

export const MALE_POSES = {
  idle: `${M}/male_idle.png`,
  attack: `${M}/male_attack.png`,
  hit: `${M}/male_hit.png`,
  eat_burger: `${M}/male_eat_burger.png`,
  burp: `${M}/male_burp.png`,
  hide_trash: `${M}/male_hide_trash.png`,
  lean_cover: `${M}/male_lean_cover.png`,
  fist_punch: `${M}/male_fist_punch.png`,
  pistol_hold: `${M}/male_pistol_hold.png`,
  pistol_fire: `${M}/male_pistol_fire.png`,
  pistol_bash: `${M}/male_pistol_bash.png`,
  smg_hold: `${M}/male_smg_hold.png`,
  smg_fire: `${M}/male_smg_fire.png`,
  smg_bash: `${M}/male_smg_bash.png`,
  rifle_hold: `${M}/male_rifle_hold.png`,
  rifle_fire: `${M}/male_rifle_fire.png`,
  rifle_bash: `${M}/male_rifle_bash.png`,
  tec9_hold: `${M}/male_tec9_hold.png`,
  tec9_fire: `${M}/male_tec9_fire.png`,
  tec9_bash: `${M}/male_tec9_bash.png`,
  ak47_hold: `${M}/male_ak47_hold.png`,
  ak47_fire: `${M}/male_ak47_fire.png`,
  ak47_bash: `${M}/male_ak47_bash.png`,
  shotgun_hold: `${M}/male_shotgun_hold.png`,
  shotgun_fire: `${M}/male_shotgun_fire.png`,
  shotgun_bash: `${M}/male_shotgun_bash.png`,
  rpg_hold: `${M}/male_rpg_hold.png`,
  rpg_fire: `${M}/male_rpg_fire.png`,
  rpg_bash: `${M}/male_rpg_bash.png`,
  pipebomb_hold: `${M}/male_pipebomb_hold.png`,
  pipebomb_throw: `${M}/male_pipebomb_throw.png`,
  bat_hold: `${M}/male_bat_hold.png`,
  bat_swing: `${M}/male_bat_swing.png`,
};

export const HEAD_ITEMS = {
  cap_straight: `${M}/male_item_cap_straight.png`,
  cap_back: `${M}/male_item_cap_back.png`,
  cap_side: `${M}/male_item_cap_side.png`,
  mask: `${M}/male_item_bandana_mask.png`,
  hood: `${M}/male_item_hood_up.png`,
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
export function preloadMaleLayers() {
  for (const [id, url] of Object.entries(MALE_POSES)) _kick(id, url);
  for (const [id, url] of Object.entries(HEAD_ITEMS)) _kick(`item:${id}`, url);
}
export function areMaleLayersReady() {
  return ['idle', 'attack', 'hit'].every(id => _ready[id]);
}

// ── Color helpers (shared with femaleLayeredRecolor.js) ─────────────
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: break;
    }
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60)        [r1, g1, b1] = [c, x, 0];
  else if (h < 120)  [r1, g1, b1] = [x, c, 0];
  else if (h < 180)  [r1, g1, b1] = [0, c, x];
  else if (h < 240)  [r1, g1, b1] = [0, x, c];
  else if (h < 300)  [r1, g1, b1] = [x, 0, c];
  else               [r1, g1, b1] = [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
export function applyShade(targetRgb, srcL255) {
  const [tH, tS, tL] = rgbToHsl(targetRgb[0], targetRgb[1], targetRgb[2]);
  const srcL = srcL255 / 255;
  let finalL;
  if (srcL < 0.18) finalL = srcL * 0.85 + tL * 0.15;
  else finalL = tL + (srcL - 0.5) * 0.22;
  finalL = Math.max(0.02, Math.min(0.98, finalL));
  return hslToRgb(tH, tS, finalL);
}

// ── Classification (flag palette → roles) ────────────────────────────
export const ROLES = {
  none: 0, outline: 1, skin: 2, hair: 3, bandana: 4, chain: 5,
  jacket: 6, shirt: 7, under: 8, boxers: 9, pants: 10, socks: 11,
  shoes: 12, keep: 13,
};
const R = ROLES;

function classify(r, g, b, yF) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const chroma = mx - mn;
  const luma = (r + g + b) / 3;
  if (r + g + b < 60) return R.outline;

  // GREEN jacket — green clearly dominant.
  if (g > 90 && g > r * 1.25 && g > b * 1.25) return R.jacket;

  // TEAL hair — cyan family (g≈b, both above r).
  if (g > r * 1.15 && b > r * 1.15 && Math.abs(g - b) < Math.max(40, g * 0.35)) return R.hair;

  // BLUE shirt — blue dominant.
  if (b > 90 && b > r * 1.3 && b > g * 1.25) return R.shirt;

  // PURPLE pants — red+blue, low green.
  if (b > 70 && r > 60 && b > g * 1.35 && r > g * 1.15 && r < b * 1.35 && b < r * 2.2) {
    // magenta shoes have much stronger red; purple keeps r ≲ b*1.35.
    if (r > b * 1.15 && yF > 0.7) return R.shoes;
    return R.pants;
  }

  // MAGENTA shoes — strong red WITH a real blue component.
  if (r > 130 && b > r * 0.42 && g < r * 0.55 && b > g * 1.2) {
    return yF > 0.6 ? R.shoes : R.bandana;
  }

  // RED bandana — strong red, low green AND blue.
  if (r > 100 && g < r * 0.55 && b < r * 0.5 && r - Math.max(g, b) > 35) {
    return yF > 0.72 ? R.shoes : R.bandana;
  }

  // GOLD chain vs ORANGE boxers vs muzzle flash:
  if (r > 120 && g > r * 0.45 && b < g * 0.8) {
    if (luma > 185) return R.keep;                 // flash highlights
    if (g > r * 0.72) {                            // gold-ish
      return (yF > 0.16 && yF < 0.52) ? R.chain : R.keep;
    }
    // orange
    if (yF > 0.36 && yF < 0.72) return R.boxers;
    return R.keep;                                 // flash mid-tones
  }

  // SKIN — warm, red-led, moderate chroma.
  if (luma > 55 && chroma > 16 && r > g && g > b * 0.8 && b < r * 0.85) return R.skin;

  // LOW CHROMA — undershirt (torso) / socks (ankles) / gun metal (keep).
  if (chroma < 40) {
    if (luma > 120) {
      if (yF > 0.78) return R.socks;
      if (yF > 0.14 && yF < 0.68) return R.under;
      return R.keep;
    }
    return R.keep;                                 // gun metal / shadows
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
  const roles = new Uint8Array(W * H);
  const Larr = new Uint8Array(W * H);
  // head box accumulators (bandana+hair)
  let hx0 = W, hx1 = 0, hy0 = H, hy1 = 0;
  // pants bbox (for rolled-up legs)
  let px0 = W, px1 = 0, py0 = H, py1 = 0;
  for (let y = 0; y < H; y++) {
    const yF = y / H;
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
      }
    }
  }
  const out = {
    roles, L: Larr, W, H,
    head: hx1 >= hx0 ? { x: hx0, y: hy0, w: hx1 - hx0 + 1, h: hy1 - hy0 + 1 } : null,
    pants: px1 >= px0 ? { x: px0, y: py0, w: px1 - px0 + 1, h: py1 - py0 + 1 } : null,
  };
  _classCache.set(poseId, out);
  return out;
}

// ── Headgear overlay compositing (shared with the female pipeline) ───
// Recolors an item's dominant hue to `hex`, then draws it anchored to
// the head box.
function tintItem(itemKey, hex) {
  const img = _images[`item:${itemKey}`];
  if (!img || !img.complete || !img.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  if (hex) {
    const target = hexToRgb(hex);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 28 || r + g + b < 70) continue;   // keep ink + greys
      const [, , L] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = applyShade(target, Math.round(L * 255));
      px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
    }
    ctx.putImageData(data, 0, 0);
  }
  return c;
}

export function compositeHeadgear(ctx, head, opts) {
  if (!head) return;
  const { capMode, capHex, maskOn, maskHex, hoodUp, hoodHex } = opts;
  if (maskOn) {
    const m = tintItem('mask', maskHex);
    if (m) {
      const w = head.w * 1.1;
      const h = w * (m.height / m.width);
      ctx.drawImage(m, head.x + head.w / 2 - w / 2 + head.w * 0.05, head.y + head.h * 0.40, w, h);
    }
  }
  if (hoodUp) {
    const hd = tintItem('hood', hoodHex);
    if (hd) {
      const w = head.w * 1.5;
      const h = w * (hd.height / hd.width);
      ctx.drawImage(hd, head.x + head.w / 2 - w / 2, head.y - head.h * 0.28, w, h);
    }
    return;   // hood covers any cap
  }
  if (capMode && capMode !== 'off') {
    const cp = tintItem(`cap_${capMode}`, capHex);
    if (cp) {
      const w = head.w * 1.3;
      const h = w * (cp.height / cp.width);
      ctx.drawImage(cp, head.x + head.w / 2 - w / 2, head.y - h * 0.42, w, h);
    }
  }
}

// ── Main: recolor a male pose for a build ────────────────────────────
const _outCache = new Map();
export function invalidateMaleCache() {
  _outCache.clear();
  _classCache.clear();
}

// Deterministic speckle for chest hair.
function speck(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) % 100;
}

export function recolorMalePose(poseId, b) {
  const img = _images[poseId];
  if (!img || !img.complete || !img.naturalWidth) return MALE_POSES[poseId];
  const key = poseId + '|' + JSON.stringify(b);
  const cached = _outCache.get(key);
  if (cached) return cached;
  const cls = classifyPose(poseId);
  if (!cls) return MALE_POSES[poseId];
  const { roles, L: Larr, W, H, head, pants } = cls;

  const skin = hexToRgb(b.skinHex || '#cb9466');
  const hair = hexToRgb(b.hairHex || '#2b2b33');
  const cascadeTorso = b.shirtOn ? hexToRgb(b.shirtHex || '#2746a7')
    : (b.underOn ? hexToRgb(b.underHex || '#e8e8e8') : skin);
  const cascadeUnder = b.underOn ? hexToRgb(b.underHex || '#e8e8e8') : skin;
  const pantsRgb = hexToRgb(b.pantsHex || '#2746a7');
  const targets = {
    [R.skin]: skin,
    [R.hair]: hair,
    [R.bandana]: b.bandanaOn ? hexToRgb(b.bandanaHex || '#b91c1c') : hair,
    [R.chain]: b.chainOn ? null : cascadeUnder,   // null = keep gold
    [R.jacket]: b.jacketOn ? hexToRgb(b.jacketHex || '#15803d') : cascadeTorso,
    [R.shirt]: b.shirtOn ? hexToRgb(b.shirtHex || '#2746a7') : cascadeUnder,
    [R.under]: b.underOn ? hexToRgb(b.underHex || '#e8e8e8') : skin,
    [R.boxers]: b.sag === 'above' ? pantsRgb : hexToRgb(b.boxersHex || '#ea580c'),
    [R.pants]: b.sag === 'none' ? skin : pantsRgb,
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

  const bareChest = !b.underOn && !b.shirtOn;
  const legMidX = pants ? pants.x + pants.w / 2 : W / 2;
  const legTopY = pants ? pants.y + pants.h * 0.55 : H;

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    let target = targets[role];
    if (target === undefined) continue;       // none/outline/keep
    const x = i % W, y = (i / W) | 0;

    if (role === R.pants && b.sag !== 'none') {
      // Rolled-up legs — lower part of the pants region, split by side.
      if (y > legTopY) {
        const side = x < legMidX ? 'left' : 'right';
        if ((side === 'left' && b.legLeftUp) || (side === 'right' && b.legRightUp)) {
          target = skin;
        }
      }
    }
    if (target === null) continue;            // chain kept gold

    let [nr, ng, nb] = applyShade(target, Larr[i]);
    // Chest hair stipple on bare torso.
    if (bareChest && b.hairy && target === skin &&
        (role === R.under || role === R.shirt || role === R.jacket || (role === R.skin && y / H > 0.2 && y / H < 0.55)) &&
        speck(x, y) < 9) {
      [nr, ng, nb] = [hair[0], hair[1], hair[2]];
    }
    const idx = i * 4;
    data[idx] = nr; data[idx + 1] = ng; data[idx + 2] = nb;
  }
  ctx.putImageData(out, 0, 0);

  // Hide-pose has no jacket — never draw the hood there.
  compositeHeadgear(ctx, head, {
    capMode: b.capMode,
    capHex: b.capHex,
    maskOn: b.maskOn,
    maskHex: b.maskHex,
    hoodUp: b.hoodUp && b.jacketOn && poseId !== 'hide_trash',
    hoodHex: b.jacketHex,
  });

  const url = canvas.toDataURL('image/png');
  _outCache.set(key, url);
  return url;
}

preloadMaleLayers();
