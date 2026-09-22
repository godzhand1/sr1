// Team Gangsta Brawl — 3D weapon definitions.  Damage / rate / mags
// tuned straight from the original SR1 weapons.xtbl MP values
// (Player_Damage): beretta 75, tec9 10, pump 220÷4 pellets, ak47 40,
// rpg one-shot, bat 20, pipe bomb 110 (arc grenade).
//
// Slot order is meaningful: it's what the weapon wheel draws in.  Slot
// 0 sits at the top of the wheel and the rest go clockwise — so with
// EIGHT slots, index 4 lands exactly at the bottom.  Shotgun MUST be
// the bottom slot (user requirement). After the user clarified the
// pipe/rpg slot mix-up, RPG sits between AK47 and PIPE BOMB now.
// Don't reorder this array without updating the wheel layout.
//
// `startReserve` is the number of EXTRA rounds carried beyond the
// loaded magazine on spawn. Reload transfers up to (mag - current) from
// reserve into the mag; when both reserve AND mag hit zero you can
// neither fire nor reload until you pick up more ammo. `reserveMax` is
// the hard ceiling on stockpiled ammo (pickups beyond it are wasted).
export const WEAPONS3D = [
  { id: 'fist',     name: 'FIST',      melee: true,  damage: 18,  cooldown: 0.38, range: 2.4,  mag: null },
  { id: 'bat',      name: 'BAT',       melee: true,  damage: 20,  cooldown: 0.6,  range: 3.0,  mag: null },

  // PIMP SLAP — pickup-only melee that replaces the FIST slot when
  // carried (engine redirects fist-slot requests to this idx if
  // m.hasPimpSlap is true). 360° kill radius (no facing cone),
  // instakill on hit, victim ragdolls. Also forces a PIMP HAT onto
  // the player's head (handled in characterModel3d / engine pickup).
  { id: 'pimpslap', name: 'PIMP SLAP', melee: true, slap: true, hidden: true, damage: 9999, cooldown: 0.30, range: 3.5, mag: null },

  // Pistol — single fire only, ~11 shots to kill (100hp / ~9dmg per shot).
  // Semi-auto: auto:false enforces one shot per trigger pull.
  // (mag/reserve/cap doubled per user request: "twice as much ammo")
  { id: 'pistol',   name: 'PISTOL',    damage: 9,   cooldown: 0.28,  spread: 0.010, range: 65,  mag: 30, reload: 1.4, auto: false, sfx: 'pistol', startReserve: 60, reserveMax: 180 },

  { id: 'tec9',     name: 'TEC-9',     damage: 10,  cooldown: 0.075, spread: 0.035, range: 55,  mag: 100, reload: 1.7, auto: true,  sfx: 'tec9',  startReserve: 0, reserveMax: 400 },

  // Shotgun — pump action, single fire, heavy delay between shots.
  // 4 pellets, each does 14 dmg at close range (56 total = ~2 shots close).
  // Spread blooms heavily at distance so long-range pellets barely tickle.
  // Pump delay enforced via cooldown: 1.1s between shots (bolt cycle feel).
  { id: 'shotgun',  name: 'SHOTGUN',   damage: 14,  cooldown: 1.1,   spread: 0.11,  range: 18,  mag: 16,  reload: 2.2, auto: false, pellets: 4, sfx: 'shotgun', startReserve: 0, reserveMax: 64 },

  // AK-47 — body: 100hp / 7 shots = ~14.3 dmg per shot.
  { id: 'ak47',     name: 'AK-47',     damage: 15,  cooldown: 0.125, spread: 0.022, range: 85,  mag: 60, reload: 2.2, auto: true,  sfx: 'ak47',  startReserve: 0, reserveMax: 300 },

  // RPG — does NOT spawn in loadout. Weapon wheel shows an empty slot
  // unless the player picks one up from the world (center-map pickup).
  // spawnEmpty:true tells the engine to give 0 ammo on spawn/respawn.
  // Cooldown trimmed to 0.9s so back-to-back shots feel snappy — a
  // 2.0s wait between clicks read as "the game is lagging" per user
  // report iter191. Reload timer (used only when there's reserve to
  // feed) untouched.
  { id: 'rpg',      name: 'RPG',       damage: 200, cooldown: 0.9,   spread: 0.004, range: 200, mag: 2,  reload: 2.6, auto: false, projectile: true, blast: 4.5, speed: 32, sfx: 'rpg', spawnEmpty: true, startReserve: 0, reserveMax: 6 },

  // Pipe bomb — pickup-only thrown explosive. 2 per pickup, no reload
  // (the mag IS the supply). Physics-driven throw: gravity + wall bounce
  // + ground roll. Fuse ticks down while the bomb is in flight OR at
  // rest. Direct-hit on an actor deals `impactDamage` + KNOCKDOWN,
  // then the bomb bounces off. Fuse timeout triggers a blast where
  // damage falls off by distance — within `blastKillR` it's an INSTANT
  // KILL, outside that but within `blast` it's the normal damage×falloff.
  // Multiple live pipe bombs chain-detonate: any pipe bomb caught inside
  // a blast radius explodes on the same frame.
  { id: 'pipebomb', name: 'PIPE BOMB', damage: 130, cooldown: 0.55,  spread: 0.0,   range: 80,  mag: 2,  reload: 0,   auto: false, noReload: true, projectile: true, gravity: true, fuse: 3.0, blast: 4.0, blastKillR: 1.2, impactDamage: 28, bounces: true, restitution: 0.42, groundFriction: 0.78, rollThreshold: 0.35, speed: 32, sfx: null,   spawnEmpty: true, startReserve: 0, reserveMax: 0 },
];

export const WEAPON_INDEX = Object.fromEntries(WEAPONS3D.map((w, i) => [w.id, i]));

export function freshAmmo() {
  // spawnEmpty weapons start with 0 ammo — slot shows in wheel but is empty
  // until a world pickup is collected.
  return WEAPONS3D.map(w => {
    if (w.mag == null) return null;   // melee — no ammo concept
    if (w.spawnEmpty) return 0;       // RPG — pickup only
    return w.mag;                     // everything else — full mag on spawn
  });
}

// Extra rounds beyond the loaded mag the player spawns with. Refilled
// by world pickups; drained one mag-worth at a time on reload.
export function freshReserve() {
  return WEAPONS3D.map(w => {
    if (w.mag == null) return null;
    return w.startReserve || 0;
  });
}

// "The Lobby" loadout — pistol, bat, fists only. Every other ranged
// weapon (tec9, shotgun, ak47, pipebomb, rpg) starts at 0 ammo so the
// wheel renders them as empties and the player must walk over warehouse
// pickups to obtain them.
export function lobbyAmmo() {
  return WEAPONS3D.map(w => {
    if (w.mag == null) return null;
    if (w.id === 'pistol') return w.mag;
    return 0;
  });
}

// Warehouse spawn: pistol carries its starter reserve, everything else
// starts at zero reserve so the warehouse pickup hunt actually matters.
export function lobbyReserve() {
  return WEAPONS3D.map(w => {
    if (w.mag == null) return null;
    if (w.id === 'pistol') return w.startReserve || 0;
    return 0;
  });
}
