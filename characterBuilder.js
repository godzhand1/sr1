// Character builder — layered/sliced sprite system for BOTH genders.
// Each gender has a set of "master" pose sprites carrying ALL clothing
// layers at once in a flag palette; layeredRecolor.js (male) and
// femaleLayeredRecolor.js (female) classify + toggle + recolor every
// layer independently, so one build applies identically across idle /
// every weapon stance / eating / hiding / cover.
//
// Build state and earned cash live in localStorage so progress carries
// across missions and reloads.

import { recolorMalePose, invalidateMaleCache } from './layeredRecolor.js';
import { recolorFemalePose, invalidateFemaleCache } from './femaleLayeredRecolor.js';

// 8 skin-tone presets across 4 ethnicities.
export const SKIN_TONES = [
  { id: 'white_pale',    name: 'Pale',          hex: '#f3d4b6' },
  { id: 'white_tan',     name: 'Tan',           hex: '#dca882' },
  { id: 'spanish_light', name: 'Light Latino',  hex: '#cb9466' },
  { id: 'spanish_dark',  name: 'Dark Latino',   hex: '#a4733f' },
  { id: 'asian_light',   name: 'Asian Light',   hex: '#e4c39e' },
  { id: 'asian_med',     name: 'Asian Olive',   hex: '#c5a47a' },
  { id: 'black_light',   name: 'Brown',         hex: '#7b4f30' },
  { id: 'black_dark',    name: 'Deep Brown',    hex: '#4a2a16' },
];

// ── Phase 1A: extended HQ character library ────────────────────────────
// Six face presets — distinct cheekbone/jaw silhouettes used by the 3D
// model (characterModel3d.js reads build.facePreset and adjusts head
// geometry + brow ridge).  Sprite system ignores these — its faces are
// painted into the master poses.
export const FACE_PRESETS = [
  { id: 'sharp',   name: 'Sharp' },
  { id: 'square',  name: 'Square Jaw' },
  { id: 'round',   name: 'Round' },
  { id: 'lean',    name: 'Lean' },
  { id: 'broad',   name: 'Broad' },
  { id: 'long',    name: 'Long' },
];

// Hairstyles — a dozen distinct styles for the 3D model.  Each maps to a
// procedural geometry combination (fade, fro, dreads, braids, top knot,
// caesar, mohawk, side-part, shag, hightop, bald, headband-only).
export const HAIR_STYLES = [
  { id: 'fade',     name: 'Low Fade' },
  { id: 'caesar',   name: 'Caesar' },
  { id: 'fro',      name: 'Afro' },
  { id: 'dreads',   name: 'Dreads' },
  { id: 'braids',   name: 'Cornrow Braids' },
  { id: 'mohawk',   name: 'Mohawk' },
  { id: 'hightop',  name: 'Hi-Top' },
  { id: 'sidepart', name: 'Side Part' },
  { id: 'shag',     name: '90s Shag' },
  { id: 'topknot',  name: 'Top Knot' },
  { id: 'bald',     name: 'Bald' },
  { id: 'buzz',     name: 'Buzz' },
];

// Facial hair (male only — character creator hides for female builds).
export const FACIAL_HAIR = [
  { id: 'clean',      name: 'Clean Shave' },
  { id: 'stubble',    name: 'Stubble' },
  { id: 'goatee',     name: 'Goatee' },
  { id: 'chinstrap',  name: 'Chinstrap' },
  { id: 'mustache',   name: 'Mustache' },
  { id: 'fullbeard',  name: 'Full Beard' },
  { id: 'vandyke',    name: 'Van Dyke' },
];

// Eye colours.  The 3D head has two eye orbs; their material colour is
// driven directly from this list.
export const EYE_COLORS = [
  { id: 'brown',    name: 'Brown',    hex: '#3a2417' },
  { id: 'hazel',    name: 'Hazel',    hex: '#7a5a32' },
  { id: 'amber',    name: 'Amber',    hex: '#b9842a' },
  { id: 'green',    name: 'Green',    hex: '#3f6b3a' },
  { id: 'blue',     name: 'Blue',     hex: '#2a5d8f' },
  { id: 'icy',      name: 'Icy Blue', hex: '#8ec2da' },
  { id: 'grey',     name: 'Grey',     hex: '#5a5e66' },
  { id: 'black',    name: 'Jet Black',hex: '#0a0a0a' },
];

// Glasses / eyewear — one slot, rendered between brow and cheek.
export const GLASSES_STYLES = [
  { id: 'none',     name: 'None' },
  { id: 'shades',   name: 'Black Shades' },
  { id: 'aviators', name: 'Aviators' },
  { id: 'wrap',     name: 'Wrap-Around' },
  { id: 'tint',     name: 'Yellow Tints' },
  { id: 'clear',    name: 'Clear Frames' },
  { id: 'visor',    name: 'Sport Visor' },
];

// Accessory neck / wrist pieces (in addition to the existing gold chain).
export const ACCESSORIES = [
  { id: 'none',       name: 'None' },
  { id: 'rosary',     name: 'Rosary' },
  { id: 'dogtag',     name: 'Dog Tags' },
  { id: 'crucifix',   name: 'Crucifix' },
  { id: 'beadschoke', name: 'Beaded Choker' },
];

// Hat list — augments the legacy mCapMode flag without breaking it.
export const HAT_STYLES = [
  { id: 'none',      name: 'None' },
  { id: 'cap_str',   name: 'Cap (Straight)' },
  { id: 'cap_back',  name: 'Cap (Backwards)' },
  { id: 'cap_side',  name: 'Cap (Sideways)' },
  { id: 'beanie',    name: 'Beanie' },
  { id: 'bucket',    name: 'Bucket Hat' },
  { id: 'durag',     name: 'Durag' },
  { id: 'fedora',    name: 'Fedora' },
];

// Build-quality presets for the 3D model — drives bone proportions
// (shoulder breadth, leg length, gut girth).  Sprite system still
// honours the legacy BODY_TYPES list for the 2D game.
export const BODY_BUILDS = [
  { id: 'slim',     name: 'Slim',     shoulder: 0.92, gut: 0.85, leg: 1.02 },
  { id: 'avg',      name: 'Average',  shoulder: 1.00, gut: 1.00, leg: 1.00 },
  { id: 'athletic', name: 'Athletic', shoulder: 1.10, gut: 0.92, leg: 1.04 },
  { id: 'heavy',    name: 'Heavy',    shoulder: 1.05, gut: 1.20, leg: 0.96 },
  { id: 'tall',     name: 'Tall',     shoulder: 1.02, gut: 0.96, leg: 1.12 },
];

// Body types — render-time horizontal scale applied to the whole
// sprite in every pose (drawPiece reads record.widthScale).
export const BODY_TYPES = [
  { id: 'slim', name: 'Slim',    scale: 0.9 },
  { id: 'avg',  name: 'Average', scale: 1.0 },
  { id: 'big',  name: 'Big',     scale: 1.12 },
];
export function widthScaleFor(build) {
  const t = BODY_TYPES.find(b => b.id === build.bodyType);
  return t ? t.scale : 1;
}

// Boob sizes — the female recolorer re-draws the bra patch scaled
// around its center in every pose.
export const BOOB_SIZES = [
  { id: 'small', name: 'Small',  scale: 0.78 },
  { id: 'med',   name: 'Medium', scale: 1 },
  { id: 'large', name: 'Large',  scale: 1.28 },
];

// Shared swatch palette for every clothing color picker.
export const FEMALE_COLORS = [
  { id: 'white',  hex: '#e8e8e8' },
  { id: 'black',  hex: '#15151c' },
  { id: 'red',    hex: '#b91c1c' },
  { id: 'pink',   hex: '#ec4899' },
  { id: 'purple', hex: '#7c3aed' },
  { id: 'blue',   hex: '#2746a7' },
  { id: 'sky',    hex: '#0ea5e9' },
  { id: 'green',  hex: '#15803d' },
  { id: 'yellow', hex: '#eab308' },
  { id: 'orange', hex: '#ea580c' },
  { id: 'brown',  hex: '#78350f' },
  { id: 'grey',   hex: '#5e5e66' },
];

export const FEMALE_RACES = [
  { id: 'black',  name: 'Black',  skinDefault: 'black_light'   },
  { id: 'asian',  name: 'Asian',  skinDefault: 'asian_light'   },
  { id: 'white',  name: 'White',  skinDefault: 'white_pale'    },
  { id: 'latina', name: 'Latina', skinDefault: 'spanish_light' },
];

export const DEFAULT_BUILD = {
  gender:    'male',
  ethnicity: 'spanish',
  skinId:    'spanish_light',
  bodyType:  'avg',
  // ── Phase 1A HQ character fields (shared, gender-agnostic) ──
  facePreset:  'sharp',
  hairStyle:   'fade',
  facialHair:  'stubble',
  eyeColor:    'brown',
  glasses:     'none',
  accessory:   'none',
  hatStyle:    'none',          // overrides legacy mCapMode when not 'none'
  bodyBuild:   'avg',           // drives 3D bone proportions
  // ── Male layered fields ──
  mHairHex:    '#2b2b33',
  mBandanaOn:  false,
  mBandanaHex: '#7c3aed',
  mCapMode:    'off',          // off | straight | back | side
  mCapHex:     '#b91c1c',
  mMaskOn:     false,
  mMaskHex:    '#7c3aed',
  mChainOn:    true,
  mJacketOn:   true,
  mJacketHex:  '#15803d',
  mHoodUp:     false,
  mShirtOn:    true,
  mShirtHex:   '#2746a7',
  mUnderOn:    true,
  mUnderHex:   '#e8e8e8',
  mHairy:      false,
  mSag:        'below',        // below | above | none (boxers only)
  mBoxersHex:  '#ea580c',
  mPantsHex:   '#15151c',
  mLegLeftUp:  false,
  mLegRightUp: false,
  mSocksOn:    true,
  mSocksHex:   '#e8e8e8',
  mShoesOn:    true,
  mShoesHex:   '#e8e8e8',
  // ── Female layered fields ──
  femRace:     'latina',
  fHairHex:    '#143d3d',
  fBandanaOn:  true,
  fBandanaHex: '#b91c1c',
  fCapMode:    'off',
  fCapHex:     '#b91c1c',
  fMaskOn:     false,
  fMaskHex:    '#b91c1c',
  fChainOn:    true,
  fShirtOn:    true,
  fShirtHex:   '#e8e8e8',
  fBraOn:      true,
  fBraHex:     '#ec4899',
  // Optional SR1 GLB bra overlay (`cs_bra` mesh) — off by default; the
  // procedural fBra still wins when on. User can stack both, or use
  // either alone.
  fCsBraOn:    false,
  fBoobs:      'med',
  fThongOn:    true,
  fThongHex:   '#7c3aed',
  fPantsOn:    true,
  fPantsHex:   '#2746a7',
  fLegLeftUp:  false,
  fLegRightUp: false,
  fSocksOn:    true,
  fSocksHex:   '#e8e8e8',
  fShoesOn:    true,
  fShoesHex:   '#ec4899',
  // ── SR vanilla clothing OBJ defaults ────────────────────────────
  // These populate `paletteFromBuild(build).srClothing` and drive the
  // OBJ overlays attached in characterMeshy.js / characterModel3d.js
  // (`attachCosmetics` / `rotateAndAttach`). Without these keys a
  // freshly-created character would render naked on the new auto-
  // rigged body — the legacy procedural clothing meshes only exist on
  // the old `characterModel3d.js` path.
  srShirt:      'cunds_tshirt_cl',
  srPants:      'cbotm_dresspants_nh',
  srShoes:      'cshoe_addidas',
  srHair:       'htop_flatclippered',
  srFacialHair: 'none',
  srHat:        'none',
  srJacket:     'none',
  srGlasses:    'none',
  srSocks:      'none',
  srBoxers:     'none',
};

// One-click 90s style presets — male.
export const MALE_STYLE_PRESETS = [
  {
    id: 'gangsta', name: '90s Gangsta',
    patch: {
      mBandanaOn: false, mBandanaHex: '#7c3aed', mCapMode: 'off', mMaskOn: false,
      mChainOn: true, mJacketOn: false, mShirtOn: false, mUnderOn: true,
      mUnderHex: '#e8e8e8', mSag: 'below', mBoxersHex: '#b91c1c',
      mPantsHex: '#15151c', mLegLeftUp: true, mLegRightUp: false,
      mSocksOn: true, mSocksHex: '#e8e8e8', mShoesOn: true, mShoesHex: '#e8e8e8',
    },
  },
  {
    id: 'hiphop', name: '90s Hip-Hop',
    patch: {
      mBandanaOn: false, mCapMode: 'back', mCapHex: '#b91c1c', mMaskOn: false,
      mChainOn: true, mJacketOn: true, mJacketHex: '#15803d', mHoodUp: false,
      mShirtOn: true, mShirtHex: '#eab308', mUnderOn: true, mUnderHex: '#e8e8e8',
      mSag: 'below', mBoxersHex: '#0ea5e9', mPantsHex: '#2746a7',
      mLegLeftUp: false, mLegRightUp: false, mSocksOn: true, mShoesOn: true,
    },
  },
  {
    id: 'alternative', name: '90s Alternative',
    patch: {
      mBandanaOn: false, mCapMode: 'off', mMaskOn: false, mChainOn: false,
      mJacketOn: true, mJacketHex: '#78350f', mHoodUp: true,
      mShirtOn: true, mShirtHex: '#15151c', mUnderOn: false,
      mSag: 'above', mPantsHex: '#5e5e66', mLegLeftUp: false, mLegRightUp: false,
      mSocksOn: false, mShoesOn: true, mShoesHex: '#15151c',
    },
  },
];

// One-click 90s style presets — female.
export const FEMALE_STYLE_PRESETS = [
  {
    id: 'gangsta_girl', name: '90s Gangsta Girl',
    patch: {
      fBandanaOn: false, fBandanaHex: '#b91c1c', fCapMode: 'off', fMaskOn: false,
      fChainOn: true, fShirtOn: false, fBraOn: true, fBraHex: '#ec4899',
      fThongOn: true, fThongHex: '#7c3aed', fPantsOn: true, fPantsHex: '#2746a7',
      fLegLeftUp: true, fLegRightUp: false, fSocksOn: true, fSocksHex: '#e8e8e8',
      fShoesOn: true, fShoesHex: '#ec4899',
    },
  },
  {
    id: 'around_way', name: 'Around The Way',
    patch: {
      fBandanaOn: false, fCapMode: 'back', fCapHex: '#15151c', fMaskOn: false,
      fChainOn: true, fShirtOn: true, fShirtHex: '#e8e8e8', fBraOn: true,
      fBraHex: '#15151c', fThongOn: false, fPantsOn: true, fPantsHex: '#15151c',
      fLegLeftUp: false, fLegRightUp: false, fSocksOn: true, fShoesOn: true,
      fShoesHex: '#e8e8e8',
    },
  },
  {
    id: 'summer_heat', name: 'Summer Heat',
    patch: {
      fBandanaOn: false, fCapMode: 'off', fMaskOn: false, fChainOn: true,
      fShirtOn: false, fBraOn: true, fBraHex: '#e8e8e8', fThongOn: true,
      fThongHex: '#b91c1c', fPantsOn: false, fSocksOn: false, fShoesOn: true,
      fShoesHex: '#e8e8e8',
    },
  },
];

const STORAGE_KEY = 'sr_streetfight_build';
export function loadBuild() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BUILD };
    return { ...DEFAULT_BUILD, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_BUILD }; }
}
export function saveBuild(build) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(build)); } catch {}
}

// ── 3D-only Saint build ─────────────────────────────────────────────
// Team Gangsta Brawl keeps its own persisted Saint completely separate
// from the 2D Stilwater Streets game so the player can dial in a 3D-
// focused look (e.g. lower-poly-friendly cloth combos) without messing
// up their 2D sprite. Same shape as DEFAULT_BUILD.
const BRAWL3D_STORAGE_KEY = 'sr_brawl3d_build';
export function loadBrawl3DBuild() {
  try {
    const raw = localStorage.getItem(BRAWL3D_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BUILD };
    return { ...DEFAULT_BUILD, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_BUILD }; }
}
export function saveBrawl3DBuild(build) {
  try { localStorage.setItem(BRAWL3D_STORAGE_KEY, JSON.stringify(build)); } catch {}
}

// Cash wallet, persisted locally (clothing shop is upcoming).
const CASH_KEY = 'sr_streetfight_cash';
export function loadCash() {
  try { return parseInt(localStorage.getItem(CASH_KEY), 10) || 0; }
  catch { return 0; }
}
export function saveCash(amount) {
  try { localStorage.setItem(CASH_KEY, String(Math.max(0, Math.floor(amount)))); } catch {}
}

export function invalidateSpriteCache() {
  _femCache.clear();
  _maleCache.clear();
  invalidateFemaleCache();
  invalidateMaleCache();
}

// ── Male layered pipeline ────────────────────────────────────────────
export function maleLayerBuild(build) {
  const skin = SKIN_TONES.find(s => s.id === build.skinId) || SKIN_TONES[2];
  return {
    skinHex: skin.hex,
    hairHex: build.mHairHex,
    bandanaOn: build.mBandanaOn !== true,
    bandanaHex: build.mBandanaHex,
    capMode: build.mCapMode || 'off',
    capHex: build.mCapHex,
    maskOn: !!build.mMaskOn,
    maskHex: build.mMaskHex,
    chainOn: build.mChainOn !== false,
    jacketOn: build.mJacketOn !== false,
    jacketHex: build.mJacketHex,
    hoodUp: !!build.mHoodUp,
    shirtOn: build.mShirtOn !== false,
    shirtHex: build.mShirtHex,
    underOn: build.mUnderOn !== false,
    underHex: build.mUnderHex,
    hairy: !!build.mHairy,
    sag: build.mSag || 'below',
    boxersHex: build.mBoxersHex,
    pantsHex: build.mPantsHex,
    legLeftUp: !!build.mLegLeftUp,
    legRightUp: !!build.mLegRightUp,
    socksOn: build.mSocksOn !== false,
    socksHex: build.mSocksHex,
    shoesOn: build.mShoesOn !== false,
    shoesHex: build.mShoesHex,
  };
}

const _maleCache = new Map();
export function maleSpriteFor(build, pose) {
  const lb = maleLayerBuild(build);
  const k = pose + '|' + JSON.stringify(lb);
  if (_maleCache.has(k)) return _maleCache.get(k);
  const url = recolorMalePose(pose, lb);
  _maleCache.set(k, url);
  return url;
}

export function buildAllMaleSprites(build) {
  const base = maleSpriteFor(build, 'idle');
  return {
    spriteBase:   base,
    spriteAttack: maleSpriteFor(build, 'attack'),
    spriteHit:    maleSpriteFor(build, 'hit'),
    spriteStep:   { left: base, right: base },
    spriteBack:   { left: base, right: base },
    spriteSize:   96,
    poseSprites: {
      eat:  maleSpriteFor(build, 'eat_burger'),
      burp: maleSpriteFor(build, 'burp'),
      hide: maleSpriteFor(build, 'hide_trash'),
      lean: maleSpriteFor(build, 'lean_cover'),
    },
  };
}

// ── Female layered pipeline ──────────────────────────────────────────
export function femaleLayerBuild(build) {
  const skin = SKIN_TONES.find(s => s.id === build.skinId) || SKIN_TONES[2];
  const boobs = BOOB_SIZES.find(s => s.id === build.fBoobs) || BOOB_SIZES[1];
  return {
    skinHex: skin.hex,
    hairHex: build.fHairHex,
    bandanaOn: build.fBandanaOn !== true,
    bandanaHex: build.fBandanaHex,
    capMode: build.fCapMode || 'off',
    capHex: build.fCapHex,
    maskOn: !!build.fMaskOn,
    maskHex: build.fMaskHex,
    chainOn: build.fChainOn !== false,
    shirtOn: build.fShirtOn !== false,
    shirtHex: build.fShirtHex,
    braOn: build.fBraOn !== false,
    braHex: build.fBraHex,
    boobScale: boobs.scale,
    thongOn: build.fThongOn !== false,
    thongHex: build.fThongHex,
    pantsOn: build.fPantsOn !== false,
    pantsHex: build.fPantsHex,
    legLeftUp: !!build.fLegLeftUp,
    legRightUp: !!build.fLegRightUp,
    socksOn: build.fSocksOn !== false,
    socksHex: build.fSocksHex,
    shoesOn: build.fShoesOn !== false,
    shoesHex: build.fShoesHex,
  };
}

const _femCache = new Map();
export function femaleSpriteFor(build, pose) {
  const fb = femaleLayerBuild(build);
  const k = pose + '|' + JSON.stringify(fb);
  if (_femCache.has(k)) return _femCache.get(k);
  const url = recolorFemalePose(pose, fb);
  _femCache.set(k, url);
  return url;
}

export function buildAllFemaleSprites(build) {
  const base = femaleSpriteFor(build, 'idle');
  return {
    spriteBase:   base,
    spriteAttack: femaleSpriteFor(build, 'attack'),
    spriteHit:    femaleSpriteFor(build, 'hit'),
    spriteStep:   { left: base, right: base },
    spriteBack:   { left: base, right: base },
    spriteSize:   96,
    poseSprites: {
      eat:  femaleSpriteFor(build, 'eat_burger'),
      burp: femaleSpriteFor(build, 'burp'),
      hide: femaleSpriteFor(build, 'hide_trash'),
      lean: femaleSpriteFor(build, 'lean_cover'),
    },
  };
}
