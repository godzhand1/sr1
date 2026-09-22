// Character definitions for the playable Saints — reuses the existing
// 3rd Street Saints chess sprites so we don't need new character art.
// Each character points to base + walking + back + attack sprites; the
// renderer auto-mirrors based on facing.

const SAINTS = '/pieces/3rd';

export const CHARACTERS = {
  diesel: {
    id: 'diesel',
    name: 'Diesel',
    blurb: 'Pistol grit. Loud. Lethal.',
    portrait: `${SAINTS}/king.png`,
    startWeapon: 'pistol',
    sprites: {
      base:   `${SAINTS}/pawn.png`,
      attack: `${SAINTS}/pawn_attack.png`,
      step:   { left: `${SAINTS}/pawn_step_left.png`,  right: `${SAINTS}/pawn_step_right.png` },
      back:   { left: `${SAINTS}/pawn_back_left.png`,  right: `${SAINTS}/pawn_back_right.png` },
      hit:    `${SAINTS}/pawn_hit.png`,
    },
  },
  switch: {
    id: 'switch',
    name: 'Switch',
    blurb: 'Tuner-car queen. Fast & nasty.',
    portrait: `${SAINTS}/queen.png`,
    startWeapon: 'smg',
    sprites: {
      base:   `${SAINTS}/pawn.png`,
      attack: `${SAINTS}/pawn_attack.png`,
      step:   { left: `${SAINTS}/pawn_step_left.png`,  right: `${SAINTS}/pawn_step_right.png` },
      back:   { left: `${SAINTS}/pawn_back_left.png`,  right: `${SAINTS}/pawn_back_right.png` },
      hit:    `${SAINTS}/pawn_hit.png`,
    },
  },
  boomer: {
    id: 'boomer',
    name: 'Boomer',
    blurb: 'Shotgun lifer. No words. Crooked smile.',
    portrait: '/streetfight/weapons/shotgun_fire.png',
    startWeapon: 'shotgun',
    sprites: {
      base:   `${SAINTS}/pawn.png`,
      attack: `${SAINTS}/pawn_attack.png`,
      step:   { left: `${SAINTS}/pawn_step_left.png`,  right: `${SAINTS}/pawn_step_right.png` },
      back:   { left: `${SAINTS}/pawn_back_left.png`,  right: `${SAINTS}/pawn_back_right.png` },
      hit:    `${SAINTS}/pawn_hit.png`,
    },
  },
};

import { WEAPONS } from './weapons.js';
import {
  loadBuild, widthScaleFor,
  buildAllFemaleSprites, femaleSpriteFor,
  buildAllMaleSprites, maleSpriteFor,
} from './characterBuilder.js';

// Pose names shared by the male and female layered master sets — every
// weapon's hold / fire / bash art rides on the character record so even
// mid-mission pickups keep the player's exact outfit.
const WEAPON_POSE_MAP = {
  bat:      { hold: 'bat_hold',      fire: 'bat_swing',      bash: 'bat_swing' },
  pistol:   { hold: 'pistol_hold',   fire: 'pistol_fire',    bash: 'pistol_bash' },
  smg:      { hold: 'smg_hold',      fire: 'smg_fire',       bash: 'smg_bash' },
  rifle:    { hold: 'rifle_hold',    fire: 'rifle_fire',     bash: 'rifle_bash' },
  tec9:     { hold: 'tec9_hold',     fire: 'tec9_fire',      bash: 'tec9_bash' },
  shotgun:  { hold: 'shotgun_hold',  fire: 'shotgun_fire',   bash: 'shotgun_bash' },
  ak47:     { hold: 'ak47_hold',     fire: 'ak47_fire',      bash: 'ak47_bash' },
  rpg:      { hold: 'rpg_hold',      fire: 'rpg_fire',       bash: 'rpg_bash' },
  pipebomb: { hold: 'pipebomb_hold', fire: 'pipebomb_throw' },
};

// Build the "character record" the engine state expects.  Preset Saints
// (Diesel / Switch / Boomer) also receive the full 8-slot arsenal — the
// weapon they "start with" determines which slot is highlighted by
// default but they can switch via the wheel like a custom Saint can.
// AI weapon sprites stay un-recolored for presets (they always wear
// the canonical purple bandana).
export function buildCharacterRecord(id) {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`Unknown character ${id}`);
  const startIdx = startSlotForWeapon(c.startWeapon);
  return {
    id: c.id,
    name: c.name,
    startWeapon: { ...WEAPONS[c.startWeapon] },
    startArsenal: defaultArsenal(),
    startWeaponIdx: startIdx,
    spriteBase:   c.sprites.base,
    spriteAttack: c.sprites.attack,
    spriteStep:   c.sprites.step,
    spriteBack:   c.sprites.back,
    spriteHit:    c.sprites.hit,
    spriteSize: 96,
  };
}

// Default 8-slot arsenal — used for both preset and custom Saints.
// Slot order matches the radial weapon-wheel layout (clockwise from
// 12 o'clock): FIST → MELEE (bat) → PISTOL → TEC-9 → SHOTGUN (6 o'clock)
//   → AK-47 → RPG → PIPE BOMB.
function defaultArsenal() {
  return [
    { ...WEAPONS.fist },
    { ...WEAPONS.bat },
    { ...WEAPONS.pistol },
    { ...WEAPONS.tec9 },
    { ...WEAPONS.shotgun },
    { ...WEAPONS.ak47 },
    { ...WEAPONS.rpg },
    { ...WEAPONS.pipebomb },
  ];
}
function startSlotForWeapon(name) {
  const order = ['fist', 'bat', 'pistol', 'tec9', 'shotgun', 'ak47', 'rpg', 'pipebomb'];
  const i = order.indexOf(name);
  return i >= 0 ? i : 2;   // default to pistol slot
}

// Build a record from a custom-painted character (CharacterCreator).
// MALE uses the layered-master system (layeredRecolor.js): every pose
// master carries all clothing layers in flag colors, so one build's
// toggles + colors apply identically across idle / every weapon /
// eating / hiding / cover.  Weapon skins ride on the record so even
// mid-mission pickups keep the player's exact outfit.
export function buildCustomCharacterRecord(build) {
  const b = build || loadBuild();
  if (b.gender === 'female') return buildFemaleCharacterRecord(b);
  return buildMaleCharacterRecord(b);
}

function buildMaleCharacterRecord(b) {
  const sprites = buildAllMaleSprites(b);
  const weaponSkins = {};
  for (const [key, poses] of Object.entries(WEAPON_POSE_MAP)) {
    weaponSkins[key] = {
      sprite_hold: poses.hold ? maleSpriteFor(b, poses.hold) : undefined,
      sprite_fire: poses.fire ? maleSpriteFor(b, poses.fire) : undefined,
      sprite_bash: poses.bash ? maleSpriteFor(b, poses.bash) : undefined,
    };
  }
  weaponSkins.fist = { sprite_bash: maleSpriteFor(b, 'fist_punch') };
  const armWith = (key) => ({ ...WEAPONS[key], ...weaponSkins[key] });
  return {
    id: 'custom',
    name: 'YOUR SAINT',
    build: b,
    weaponSkins,
    widthScale: widthScaleFor(b),
    startWeapon: { ...WEAPONS.pistol },
    startWeaponIdx: 2,
    startArsenal: [
      { ...WEAPONS.fist, ...weaponSkins.fist },
      armWith('bat'),
      armWith('pistol'),
      armWith('tec9'),
      armWith('shotgun'),
      armWith('ak47'),
      armWith('rpg'),
      armWith('pipebomb'),
    ],
    ...sprites,
  };
}

// ── Female custom Saint (90s gangsta girl) ───────────────────────────
// Same layered-master system as the male — femaleLayeredRecolor.js
// recolors every pose to the build's toggles + colors.
function buildFemaleCharacterRecord(b) {
  const sprites = buildAllFemaleSprites(b);
  // Skin map for EVERY weapon — applied both to the start arsenal and
  // to weapons picked up mid-mission (see tickPickup).
  const weaponSkins = {};
  for (const [key, poses] of Object.entries(WEAPON_POSE_MAP)) {
    weaponSkins[key] = {
      sprite_hold: poses.hold ? femaleSpriteFor(b, poses.hold) : undefined,
      sprite_fire: poses.fire ? femaleSpriteFor(b, poses.fire) : undefined,
      sprite_bash: poses.bash ? femaleSpriteFor(b, poses.bash) : undefined,
    };
  }
  weaponSkins.fist = { sprite_bash: femaleSpriteFor(b, 'fist_punch') };
  const armWith = (key) => ({ ...WEAPONS[key], ...weaponSkins[key] });
  return {
    id: 'custom',
    name: 'YOUR SAINT',
    build: b,
    weaponSkins,
    widthScale: widthScaleFor(b),
    startWeapon: { ...WEAPONS.pistol },
    startWeaponIdx: 2,
    startArsenal: [
      { ...WEAPONS.fist, ...weaponSkins.fist },
      armWith('bat'),
      armWith('pistol'),
      armWith('tec9'),
      armWith('shotgun'),
      armWith('ak47'),
      armWith('rpg'),
      armWith('pipebomb'),
    ],
    ...sprites,
  };
}
