// Streetfight weapons.
// Each weapon has a `cooldown`, `damage`, `fire(state, player)`, and a
// pair of `sprite_hold` / `sprite_fire` art paths.  The renderer
// swaps to `sprite_fire` while the player is in the recoil window
// (about `cooldown` seconds after firing), then falls back to
// `sprite_hold` (which itself overrides the default pawn sprite while
// the weapon is the active selection).
//
// Ammo & reload:
//   `magSize`     — rounds per magazine before needing a reload
//                   (null = melee / infinite, displays as ∞ in HUD)
//   `reloadTime`  — seconds the player can't fire while reloading
// `tickPlayer` (in tickers.js) decrements ammo, plays the empty click
// when out, and auto-triggers reload by setting `p.reloadT`.
import { spawnBullet } from './engine.js';
import { playWeapon, playReload, playEmpty } from './sounds.js';

const W = '/streetfight/weapons';

export const WEAPONS = {
  fist: {
    id: 'fist',
    name: 'Fist',
    cooldown: 0.35,
    damage: 18,
    chainPosition: 'filler',
    magSize: null,             // melee — no ammo, HUD shows ∞
    sprite_bash: `${W}/fist_punch.png`,
    fire(state, p) {
      p.meleeCooldown = 0;
      p.inputs.melee = true;
      // Sync the punch impact thump with the apex of the attack-pose
      // sprite swap (sprite swap is ~80ms in).
      playWeapon('fist', 60);
    },
  },
  bat: {
    id: 'bat',
    name: 'Bat',
    cooldown: 0.55,
    damage: 38,
    chainPosition: 'ender',
    meleeReach: 95,
    meleeKnockback: 320,
    magSize: null,             // melee — no ammo, HUD shows ∞
    sprite_hold: `${W}/bat_hold.png`,
    sprite_fire: `${W}/bat_swing.png`,
    sprite_bash: `${W}/bat_swing.png`,    // bat is already a swing weapon
    fire(state, p) {
      p.meleeCooldown = 0;
      p.inputs.melee = true;
      // The bat swing animation takes ~180ms (wind-up + follow-through).
      // The actual "crack" should land at the apex, ~110ms in, so the
      // SFX matches the moment the bat contacts the target.
      playWeapon('bat', 110);
    },
  },
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    cooldown: 0.18,
    damage: 14,
    chainPosition: 'filler',
    magSize: 12,
    reloadTime: 1.4,
    sprite_hold: `${W}/pistol_hold.png`,
    sprite_fire: `${W}/pistol_fire.png`,
    sprite_bash: `${W}/pistol_bash.png`,
    fire(state, p) {
      shoot(state, p, { speed: 660, damage: this.damage, sprite: 'pistol', sfx: 'pistol' });
    },
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    cooldown: 0.09,
    damage: 8,
    chainPosition: 'filler',
    magSize: 32,
    reloadTime: 1.6,
    sprite_hold: `${W}/smg_hold.png`,
    sprite_fire: `${W}/smg_fire.png`,
    sprite_bash: `${W}/smg_bash.png`,
    fire(state, p) {
      shoot(state, p, { speed: 700, damage: this.damage, sprite: 'pistol', sfx: 'smg' });
    },
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    cooldown: 0.35,
    damage: 18,
    chainPosition: 'ender',
    magSize: 6,
    reloadTime: 2.0,
    sprite_hold: `${W}/shotgun_hold.png`,
    sprite_fire: `${W}/shotgun_fire.png`,
    sprite_bash: `${W}/shotgun_bash.png`,
    fire(state, p) {
      for (let i = -2; i <= 2; i++) {
        const angle = (i / 5) * (Math.PI / 8);
        const target = {
          x: p.x + p.facing * 200 * Math.cos(angle),
          y: p.y         + 200 * Math.sin(angle),
        };
        shoot(state, p, { speed: 580, damage: this.damage, sprite: 'pellet', target });
      }
      playWeapon('shotgun');
    },
  },
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    cooldown: 0.13,
    damage: 22,
    chainPosition: 'filler',
    magSize: 20,
    reloadTime: 2.0,
    sprite_hold: `${W}/rifle_hold.png`,
    sprite_fire: `${W}/rifle_fire.png`,
    sprite_bash: `${W}/rifle_bash.png`,
    fire(state, p) {
      shoot(state, p, { speed: 820, damage: this.damage, sprite: 'pistol', sfx: 'rifle' });
    },
  },
  // NEW WEAPONS (AI-generated holding+firing sprites).
  tec9: {
    id: 'tec9',
    name: 'TEC-9',
    cooldown: 0.06,          // sprays fast
    damage: 7,
    chainPosition: 'filler',
    magSize: 50,
    reloadTime: 1.7,
    sprite_hold: `${W}/tec9_hold.png`,
    sprite_fire: `${W}/tec9_fire.png`,
    sprite_bash: `${W}/tec9_bash.png`,
    fire(state, p) {
      // Slight random spread to read as "spray".
      const target = {
        x: p.x + p.facing * 400,
        y: p.y + (Math.random() - 0.5) * 40,
      };
      shoot(state, p, { speed: 740, damage: this.damage, sprite: 'pistol', target, sfx: 'tec9' });
    },
  },
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    cooldown: 0.11,
    damage: 18,
    chainPosition: 'filler',
    magSize: 30,
    reloadTime: 2.2,
    sprite_hold: `${W}/ak47_hold.png`,
    sprite_fire: `${W}/ak47_hold.png`,
    sprite_bash: `${W}/ak47_bash.png`,
    fire(state, p) {
      shoot(state, p, { speed: 820, damage: this.damage, sprite: 'pistol', sfx: 'ak47' });
    },
  },

  rpg: {
    id: 'rpg',
    name: 'RPG',
    cooldown: 1.5,
    damage: 100,
    chainPosition: 'ender',
    magSize: 2,                  // 2 rockets per tube
    reloadTime: 2.8,
    sprite_hold: `${W}/rpg_hold.png`,
    sprite_fire: `${W}/rpg_fire.png`,
    sprite_bash: `${W}/rpg_bash.png`,
    fire(state, p) {
      const target = { x: p.x + p.facing * 700, y: p.y };
      spawnBullet(state, p, target, {
        speed: 540,
        damage: this.damage,
        sprite: 'pistol',
        fromEnemy: false,
        radius: 12,
      });
      playWeapon('rpg');
    },
  },
    pipebomb: {
    id: 'pipebomb',
    name: 'Pipe Bomb',
    cooldown: 1.2,
    damage: 60,
    chainPosition: 'ender',
    magSize: 4,                  // 4 bombs per "satchel"
    reloadTime: 1.0,
    sprite_hold: `${W}/pipebomb_hold.png`,
    sprite_fire: `${W}/pipebomb_throw.png`,
    fire(state, p) {
      const target = { x: p.x + p.facing * 320, y: p.y - 220 };
      spawnBullet(state, p, target, {
        speed: 360,
        damage: this.damage,
        sprite: 'pellet',
        fromEnemy: false,
        radius: 14,
      });
      playWeapon('pipebomb');
    },
  },
};

function shoot(state, p, opts) {
  const target = opts.target || { x: p.x + p.facing * 400, y: p.y };
  const dmgMul = (p && p.damageMul != null) ? p.damageMul : 1.0;
  spawnBullet(state, p, target, {
    speed: opts.speed,
    damage: Math.max(1, Math.round(opts.damage * dmgMul)),
    sprite: opts.sprite,
    fromEnemy: false,
  });
  if (opts.sfx) playWeapon(opts.sfx);
}

// Get current ammo for a weapon on a player.  Initialised lazily to
// `magSize` on first read so freshly-picked weapons start fully loaded.
// Melee weapons (magSize == null) always return Infinity.
export function ammoOf(p, w) {
  if (!w || w.magSize == null) return Infinity;
  if (!p.ammo) p.ammo = {};
  if (p.ammo[w.id] == null) p.ammo[w.id] = w.magSize;
  return p.ammo[w.id];
}

// Begin a reload on a weapon — sets p.reloadT (countdown) and plays
// the matching XWB reload SFX (if mapped).  No-op for melee.
export function beginReload(p, w) {
  if (!w || w.magSize == null) return;
  if (ammoOf(p, w) >= w.magSize) return;
  if ((p.reloadT || 0) > 0) return;
  p.reloadT = w.reloadTime || 1.5;
  p.reloadingId = w.id;
  playReload(w.id);
}

// Try to fire a single weapon — ammo decrement + empty click + auto
// reload.  Returns true iff a shot went off.  Melee bypass ammo.
//
// Exported as `fireSelected` for tickPlayer to use the single-weapon
// path (respects the radial wheel selection) instead of the multi-
// weapon chain pattern.
export function fireSelected(state, p, w) {
  return tryFire(state, p, w);
}
function tryFire(state, p, w) {
  if (!w) return false;
  if (w.magSize == null) {
    w.fire(state, p);
    p.fireCooldown = w.cooldown;
    return true;
  }
  if ((p.reloadT || 0) > 0) return false;
  const cur = ammoOf(p, w);
  if (cur <= 0) {
    playEmpty();
    beginReload(p, w);
    p.fireCooldown = 0.3;
    return false;
  }
  w.fire(state, p);
  // Pipe duplication speed-tech: if the player rapidly flipped facing
  // direction within the last ~300ms before the throw, treat it as a
  // glitched throw — the bomb still launches but the ammo doesn't tick
  // down.  Speed-runners can chain unlimited pipes by alternating left/
  // right just before the trigger.  Only applies to pipebomb.
  if (w.id === 'pipebomb' && p._dirFlipT != null && p._dirFlipT < 0.30) {
    pipeGlitchLog(p);
    p._dirFlipT = null;          // consume the glitch — needs another flip
  } else {
    p.ammo[w.id] = cur - 1;
  }
  p.fireCooldown = w.cooldown;
  if (p.ammo[w.id] <= 0) beginReload(p, w);
  return true;
}

// Light visual log when the pipe-glitch triggers, so the speed-tech is
// discoverable but doesn't spam the message log.  Once every 2 seconds.
function pipeGlitchLog(p) {
  const t = Date.now();
  if (!p._pipeGlitchT || t - p._pipeGlitchT > 2000) {
    p._pipeGlitchT = t;
    if (window && window.__sfDebugLog) window.__sfDebugLog('⚡ PIPE GLITCH');
  }
}

// Chain pattern: rotate through "filler" weapons N times then fire one
// "ender" weapon (if any).  Pure pistols → just fires pistol forever.
// Pistol + shotgun → fires pistol 3 times then shotgun, repeat.
// Pistol + SMG + shotgun → SMG 3 + pistol 1 + shotgun, repeat.  This
// reads as "the more weapons you carry, the more layered your fire feels".
//
// Each fire is routed through `tryFire` which gates on ammo / reload —
// so an empty magazine no longer "skips" the slot but instead clicks
// and triggers an automatic reload with the matching XWB SFX.
export function fireWeaponStack(state, p) {
  if (!p.weapons.length) return;
  if ((p.reloadT || 0) > 0) return;          // locked during reload
  const enders  = p.weapons.filter(w => w.chainPosition === 'ender');
  const fillers = p.weapons.filter(w => w.chainPosition !== 'ender');

  if (!enders.length) {
    const w = fillers[p.chainStep % fillers.length] || p.weapons[0];
    if (tryFire(state, p, w)) p.chainStep = (p.chainStep + 1) % fillers.length;
    return;
  }

  if (p.chainStep < 3 && fillers.length) {
    const w = fillers[p.chainStep % fillers.length];
    if (tryFire(state, p, w)) p.chainStep += 1;
  } else {
    const w = enders[enders.length - 1];
    if (tryFire(state, p, w)) {
      p.fireCooldown = w.cooldown + 0.18;
      p.chainStep = 0;
    }
  }
}
