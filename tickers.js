// Streetfight tickers — per-entity-kind update functions called every
// frame.  Kept separate from engine.js so each behaviour reads top-down
// without crawling through the central state machine.
import { WORLD, spawn, damage, pushLog, spawnBullet } from './engine.js';
import { WEAPONS, beginReload, fireSelected } from './weapons.js';
import { playWeapon } from './sounds.js';

// Spawn an explosion effect when a barrel/canister takes lethal damage.
// Creates a fire-burst particle plume, AoE damage to nearby entities,
// and turns the prop into a 6-second smouldering fire patch.
export function tickProps(state, dt) {
  if (!state.props || !state.props.length) return;
  for (const prop of state.props) {
    if (!prop.exploded) continue;
    if (prop.fireT > 0) {
      prop.fireT -= dt;
      // Continuous fire damage to anyone standing on top of the fire
      // patch.  ~12 dps for the player, knockback-free.
      const p = state.player;
      if (p && !p.dead) {
        const d = Math.hypot(p.x - prop.x, p.y - prop.y);
        if (d < prop.r + 10) damage(state, p, 12 * dt, null);
      }
      for (const e of Object.values(state.entities)) {
        if (e.kind !== 'enemy' || e.dead) continue;
        const d = Math.hypot(e.x - prop.x, e.y - prop.y);
        if (d < prop.r + 10) damage(state, e, 18 * dt, null);
      }
      // Spawn 1-2 fire particles per frame.
      if (!state.particles) state.particles = [];
      if (Math.random() < 0.8) {
        const ang = -Math.PI/2 + (Math.random() - 0.5) * 0.6;
        const spd = 60 + Math.random() * 100;
        state.particles.push({
          x: prop.x + (Math.random() - 0.5) * prop.r,
          y: prop.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 60,
          life: 0.6, maxLife: 0.6,
          size: 4 + Math.random() * 3,
          color: `rgba(${230 + Math.random()*25 | 0}, ${100 + Math.random()*80 | 0}, ${20 + Math.random()*30 | 0}, %a)`,
          kind: 'fire',
        });
      }
    }
  }
}

// Spawn an explosion when a barrel/canister takes lethal damage.
// Creates a fire-burst particle plume, AoE damage to nearby entities,
// and turns the prop into a smouldering fire patch.
export function explodeProp(state, prop) {
  prop.exploded = true;
  prop.fireT = prop.kind === 'canister' ? 8 : 5;     // canister burns longer
  const aoeR = prop.kind === 'canister' ? 110 : 80;
  const aoeDmg = prop.kind === 'canister' ? 70 : 45;
  // AoE damage to anyone within radius (incl. the player).
  for (const e of Object.values(state.entities)) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - prop.x, e.y - prop.y);
    if (d < aoeR) {
      const falloff = 1 - (d / aoeR);
      damage(state, e, Math.round(aoeDmg * falloff), null);
      e.knockback = { vx: Math.sign(e.x - prop.x) * 280 * falloff, dt: 0.18 };
    }
  }
  if (!state.particles) state.particles = [];
  // Big fire burst — 24 radial particles in orange/yellow.
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 140 + Math.random() * 260;
    state.particles.push({
      x: prop.x, y: prop.y - 20,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 120,
      life: 0.8 + Math.random() * 0.4,
      maxLife: 1.2,
      size: 5 + Math.random() * 6,
      color: `rgba(${230 + Math.random()*25 | 0}, ${120 + Math.random()*100 | 0}, ${30 + Math.random()*40 | 0}, %a)`,
      kind: 'fire',
    });
  }
  pushLog(state, 'BOOM');
}

// Spawn a Negan-style finisher effect on `victim` — gore particles,
// a brief screen-shake / slow-mo flash, and the bat-finisher SFX.
// Particles live in state.particles (drawn by render.js).
function spawnFinisher(state, victim, dir) {
  if (!state.particles) state.particles = [];
  // Gore burst — 14 radial droplets with random velocity + size.
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 120 + Math.random() * 220;
    state.particles.push({
      x: victim.x, y: victim.y - 36 - (victim.z || 0),
      vx: Math.cos(ang) * spd + dir * 60,
      vy: Math.sin(ang) * spd - 100,
      life: 0.55 + Math.random() * 0.35,
      maxLife: 0.85,
      size: 3 + Math.random() * 4,
      color: 'rgba(180, 16, 16, %a)',
      kind: 'gore',
    });
  }
  // Bone chunk — a couple of white-ish bigger particles.
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI/2 + (Math.random() - 0.5) * 1.2;
    state.particles.push({
      x: victim.x, y: victim.y - 40,
      vx: Math.cos(ang) * 180 + dir * 80,
      vy: Math.sin(ang) * 220,
      life: 0.7, maxLife: 0.7,
      size: 5, color: 'rgba(240, 232, 210, %a)', kind: 'bone',
    });
  }
  // Slow-mo / hit-stop — pause the world briefly for impact emphasis.
  state.hitStopT = Math.max(state.hitStopT || 0, 0.10);
  // Bat finisher SFX (separate stream from the bat swing).
  playWeapon('bat_finisher');
}

// Recruit the currently-prompted NPC (set by tickPlayer) into the
// player's squad.  Used by both d-pad UP tap and the E/Y interact alias.
function tryRecruit(state, p) {
  const target = state.promptNpcId ? state.entities[state.promptNpcId] : null;
  if (target && target.kind === 'npc' && !target.recruited && !target.dismissed) {
    target.recruited = true;
    target.followIdx = state.player.squad.length;
    target.fireT = 0;                       // start shooting immediately
    target.hostile = false;                 // squad-mates aren't enemies
    state.player.squad.push(target.id);
    pushLog(state, `${target.name} GANGED UP`);
  }
}

// ── PLAYER ───────────────────────────────────────────────────────────
export function tickPlayer(state, p, dt) {
  // ── EATING / HEALING ────────────────────────────────────────────
  // Down on the D-pad (or S/Down arrow tap-and-hold) starts the eat-
  // cheeseburger heal animation.  Sequence:
  //   * Hold the input → `p.eatT` increments
  //   * 0.0 → 2.0 s: kneeling/eat sprite, NO heal yet
  //   * 2.0 → 4.5 s: hp regen ramps up while still eating
  //   * Once hp >= maxHp: hop to BURP for 0.6 s, then done
  //   * Taking ANY damage during eating cancels immediately
  //   * Pressing fire / melee / movement also cancels
  //   * No-op if hp is already full
  const eatIntent = !!p.inputs.eat && p.hp < p.maxHp && !p.hideT && (p.reloadT || 0) <= 0;
  if (p.burpT && p.burpT > 0) {
    p.burpT -= dt;
    if (p.burpT <= 0) { p.burpT = 0; p.eatT = 0; p.eating = false; }
    return;          // burping locks all other input
  }
  if (eatIntent) {
    // Movement / fire / melee inputs auto-cancel.
    const moving = p.inputs.left || p.inputs.right || p.inputs.up || p.inputs.down;
    const interrupted = moving || p.inputs.fire || p.inputs.melee || p.inputs.jump;
    if (interrupted) {
      p.eatT = 0; p.eating = false;
    } else {
      p.eating = true;
      p.eatT = (p.eatT || 0) + dt;
      if (p.eatT > 2.0) {
        // Past the 2 s buy-in — start regen.  Full heal ramps over the
        // next ~2.5 s of continued holding.
        p.hp = Math.min(p.maxHp, p.hp + (p.maxHp / 2.5) * dt);
        if (p.hp >= p.maxHp) {
          // Hop into BURP — instant stand-up + sound.
          p.burpT = 0.6;
          p.eating = false;
          pushLog(state, 'BUUUURP');
        }
      }
      // Lock all other actions while eating — return early.
      p.fireCooldown = Math.max(p.fireCooldown || 0, 0.2);
      return;
    }
  } else if (p.eating) {
    // Released the eat input mid-animation — stand back up.
    p.eating = false;
    p.eatT = 0;
  }

  // ── HIDE-IN-TRASH-CAN ───────────────────────────────────────────
  // Pressing the interact input while standing next to a trashcan
  // makes the player JUMP IN and become invisible to enemy bullets.
  // Press again to climb out.
  if (p.hideT != null) {
    p.hideT += dt;
    // Allow re-interact to climb back out after 0.4 s grace period.
    if (p.inputs.interact && p.hideT > 0.4) {
      p.hideT = null;
      p.hideTrashId = null;
      p.inputs.interact = false;
    }
    return;          // locked while hiding
  }

  // Crouch — toggled while inputs.crouch is held (L3 on gamepad, C on
  // keyboard).  Crouching halves move speed and offsets the sprite
  // visually (handled in render).  Player can still shoot while
  // crouching.
  p.crouching = !!p.inputs.crouch;
  // Horizontal + depth movement.  Speed scales: crouching = ½, jumping
  // = 0.85.  Shooting while moving stays free (no penalty).
  let speedMul = 1;
  if (p.crouching) speedMul *= 0.5;
  if (p.z > 0)     speedMul *= 0.85;
  const speed = p.moveSpeed * speedMul;
  let vx = 0, vy = 0;
  if (p.inputs.left)  vx -= 1;
  if (p.inputs.right) vx += 1;
  if (p.inputs.up)    vy -= 1;
  if (p.inputs.down)  vy += 1;
  if (vx || vy) {
    const inv = 1 / Math.hypot(vx, vy);
    p.x += vx * inv * speed * dt;
    p.y += vy * inv * speed * dt;
    if (vx) {
      // Track direction flips for the "pipe duplication" speed-tech —
      // if the player rapidly reverses then throws a pipe within the
      // glitch window, the pipe count is preserved.  See weapons.js
      // tryFire ammo logic which reads p._dirFlipT.
      const newFacing = vx > 0 ? 1 : -1;
      if (p.facing !== newFacing) {
        p._dirFlipT = 0;          // freshly flipped — start window
      }
      p.facing = newFacing;
    }
    p.walkPhase = (p.walkPhase || 0) + dt * 6;
  }
  // Advance flip-window timer regardless of input so the glitch only
  // triggers when the throw happens within the brief window after a
  // back-and-forth reversal.
  if (p._dirFlipT != null) p._dirFlipT += dt;
  p.y = Math.max(WORLD.groundTop, Math.min(WORLD.groundBottom, p.y));

  // Jump physics (z = height above ground) — disabled while crouching.
  if (p.inputs.jump && p.z === 0 && !p.crouching) p.vz = 580;
  if (p.z > 0 || p.vz > 0) {
    p.vz -= WORLD.gravity * dt;
    p.z = Math.max(0, p.z + p.vz * dt);
    if (p.z === 0) p.vz = 0;
  }

  // Weapon switching is driven by the WeaponWheel UI overlay (player
  // holds B/Tab → picks slot → wheel writes weaponIdx directly).  We
  // intentionally do not cycle here on a switchWeapon edge any more.

  // Cover detection — Jersey barriers laid ACROSS the road.  The long
  // axis is Y (depth into screen), the short axis is X (player travel).
  // Player approaches from LEFT or RIGHT and auto-leans against the
  // thin face on their side.  Y-overlap with the barrier's `length`
  // strip is required; otherwise the player can skirt past at either
  // end (front or back edge of the barrier).
  p.inCover = false;
  p.coverSide = 0;          // -1 = player on left side, +1 = player on right side
  p.nearCover = null;
  if (state.covers && state.covers.length && p.z <= 2) {
    for (const c of state.covers) {
      const yOverlap = p.y >= c.y && p.y <= c.y + c.length;
      if (!yOverlap) continue;
      // 24px detection band on either X-face.
      const leftEdge  = c.x;
      const rightEdge = c.x + c.thickness;
      if (p.x >= leftEdge - 24 && p.x <= leftEdge + 2) {
        p.nearCover = c;
        p.coverSide = -1;
        p.inCover = true;
        break;
      } else if (p.x >= rightEdge - 2 && p.x <= rightEdge + 24) {
        p.nearCover = c;
        p.coverSide = 1;
        p.inCover = true;
        break;
      }
    }
  }
  // Damage multiplier on outgoing shots while leaning:
  //   * inCover + crouched — blind-fire arc over → 0.5
  //   * inCover + standing — peek over the top   → 0.7
  //   * otherwise                                → 1.0
  if (p.inCover) {
    p.damageMul = p.crouching ? 0.5 : 0.7;
  } else {
    p.damageMul = 1.0;
  }
  // Prop collision + trash-can hide-interact.
  if (state.props && state.props.length && p.z <= 2) {
    for (const prop of state.props) {
      if (prop.exploded && (prop.kind === 'barrel' || prop.kind === 'canister')) continue;
      const dx = p.x - prop.x;
      const dy = p.y - prop.y;
      const dist = Math.hypot(dx, dy);
      // Hide-interact — trashcan only.  Press E within reach to dive in.
      if (prop.kind === 'trashcan' && dist < prop.r + 22 && p.inputs.interact && p.hideT == null) {
        p.hideT = 0;
        p.hideTrashId = prop;
        p.x = prop.x;
        p.y = prop.y;
        p.inputs.interact = false;       // edge-trigger
        break;
      }
      // Solid collision — push back along the impact normal.
      if (dist < prop.r + 14) {
        const push = (prop.r + 14 - dist) || 0.1;
        p.x += (dx / dist) * push;
        p.y += (dy / dist) * push;
      }
    }
  }
  // Solid X-collision — barrier thickness blocks player on the X-axis
  // unless they're skirting past the front/back end (Y outside length).
  if (state.covers && p.z <= 2) {
    for (const c of state.covers) {
      const yOverlap = p.y >= c.y && p.y <= c.y + c.length;
      if (!yOverlap) continue;
      const leftEdge  = c.x;
      const rightEdge = c.x + c.thickness;
      if (p.x > leftEdge + 2 && p.x < rightEdge - 2) {
        // Inside the thickness — push back to nearest face on X.
        const distL = p.x - leftEdge;
        const distR = rightEdge - p.x;
        if (distL < distR) p.x = leftEdge - 0.5;
        else               p.x = rightEdge + 0.5;
      }
    }
  }
  if (p.reloadT && p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      const wpn = p.weapons.find(w => w.id === p.reloadingId);
      if (wpn && wpn.magSize) {
        if (!p.ammo) p.ammo = {};
        p.ammo[wpn.id] = wpn.magSize;
      }
      p.reloadingId = null;
    }
  }

  // Manual reload — R key on keyboard, X-long-press on gamepad.  The
  // input is set in StreetfightGame.jsx.
  if (p.inputs.reload) {
    const wpn = p.weapons[p.weaponIdx || 0];
    if (wpn) beginReload(p, wpn);
    p.inputs.reload = false;       // edge-trigger
  }

  // Fire (J / RT / X) — routes through fireWeaponStack so the ammo /
  // reload / empty-click system kicks in for every shot.
  if (p.fireCooldown > 0) p.fireCooldown -= dt;
  if (p.inputs.fire && p.fireCooldown <= 0) {
    const wpn = p.weapons[p.weaponIdx || 0] || p.weapons[0];
    if (wpn) {
      // Use the simple "current weapon" path — bypass the chain since
      // we now respect the wheel pick.  The ammo/reload gating still
      // applies (via the same logic inside fireWeaponStack).
      fireSelected(state, p, wpn);
    }
  }
  if (p.meleeCooldown > 0) p.meleeCooldown -= dt;
  if (p.inputs.melee && p.meleeCooldown <= 0) {
    // If the equipped weapon is melee (fist or bat), use its tuning.
    const wpn = p.weapons[p.weaponIdx || 0];
    const isMelee = wpn && (wpn.id === 'bat' || wpn.id === 'fist');
    const reach     = wpn && wpn.meleeReach     != null ? wpn.meleeReach     : 70;
    const knockback = wpn && wpn.meleeKnockback != null ? wpn.meleeKnockback : 220;
    // LT-melee with a ranged weapon = pistol-whip / rifle-butt / RPG-
    // bash.  Damage scales by the weapon's projectile damage so the
    // RPG-as-club hits like a freight train (50) while the pistol
    // whip is a quick stunner (10).
    let baseDmg;
    if (isMelee) {
      baseDmg = wpn.damage;
    } else if (wpn) {
      baseDmg = Math.round(wpn.damage * 0.6) + 6;   // pistol 14→14, rpg 100→66
      // Cap so the RPG-as-club doesn't one-shot everything.
      if (baseDmg > 55) baseDmg = 55;
      // Play the bat swing sound for the gun-as-club thump.
      playWeapon('bat', 100);
    } else {
      baseDmg = 25;
    }
    p.meleeCooldown = wpn && wpn.cooldown ? Math.max(wpn.cooldown, 0.4) : 0.45;
    p.meleeT = 0;          // for sprite swap window
    const isBat = wpn && wpn.id === 'bat';
    // Anyone within reach in front gets a wallop.
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (Math.abs(e.y - p.y) > 30) continue;
      const dx = e.x - p.x;
      if (p.facing > 0 ? (dx > 0 && dx < reach) : (dx < 0 && dx > -reach)) {
        // Negan-style FINISHER — if the bat hit will drop the enemy
        // below ~25% HP, treat it as a skull-crush kill: triple damage,
        // spawn the gore + slow-mo flash effect, play the finisher
        // SFX, and add bonus score.  Reads as "the bat just deleted
        // them" not "yet another wallop".
        const lowHp = e.hp != null && e.hp <= Math.max(15, e.maxHp * 0.25);
        const useFinisher = isBat && lowHp;
        const dmg = useFinisher ? baseDmg * 3 : baseDmg;
        damage(state, e, dmg, p.id);
        e.knockback = { vx: p.facing * (useFinisher ? knockback * 1.8 : knockback), dt: 0.18 };
        if (useFinisher) {
          spawnFinisher(state, e, p.facing);
          p.score += 25;
          pushLog(state, 'SKULL-CRUSHER');
        }
      }
    }
  }
  if (p.meleeT != null) {
    p.meleeT += dt;
    if (p.meleeT > 0.18) p.meleeT = null;
  }

  // Recruit / dismiss on D-pad UP (or W / ↑ on keyboard).
  // - Tap (release within 600ms) near a non-recruited NPC → recruit
  // - Hold ≥ 600ms while having squad members → dismiss the closest
  //   recruited follower
  // The `interact` (E / Y) button still works as a secondary recruit
  // shortcut for accessibility.
  const upHeld = !!p.inputs.up;
  if (upHeld) {
    p._upHoldT = (p._upHoldT || 0) + dt;
  }
  if (p._upHoldT >= 0.6 && !p._upHandled) {
    // Hold trigger fired — dismiss closest recruited follower.
    p._upHandled = true;
    let best = null, bestD = Infinity;
    for (const sid of state.player.squad) {
      const m = state.entities[sid];
      if (!m || m.dead || !m.recruited) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) {
      best.recruited = false;
      best.dismissed = true;
      state.player.squad = state.player.squad.filter(id => id !== best.id);
      pushLog(state, `${best.name} DISMISSED`);
    } else {
      pushLog(state, 'NO ONE TO DISMISS');
    }
  }
  if (!upHeld) {
    // Released — was it a tap?  If yes, attempt recruit.
    if (p._upHoldT > 0 && p._upHoldT < 0.6 && !p._upHandled) {
      tryRecruit(state, p);
    }
    p._upHoldT = 0;
    p._upHandled = false;
  }

  // Y / E (interact) still works as a recruit alias for accessibility.
  if (p.inputs.interact && !p._consumedInteract) {
    p._consumedInteract = true;
    tryRecruit(state, p);
  }
  if (!p.inputs.interact) p._consumedInteract = false;

  // Detect a recruitable NPC nearby (closest within 90px).
  state.promptNpcId = null;
  let bestDist = 90;
  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'npc' || e.recruited || e.dead || e.dismissed) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestDist) { bestDist = d; state.promptNpcId = e.id; }
  }

  // Knockback decay.
  if (p.knockback) {
    p.x += p.knockback.vx * dt;
    p.knockback.dt -= dt;
    if (p.knockback.dt <= 0) p.knockback = null;
  }
}

// ── ENEMY (LC pawn / bishop / knight-car / rook-rpg / queen) ─────────
export function tickEnemy(state, e, dt) {
  const p = state.player;
  e._aiT = (e._aiT || 0) + dt;

  // Knockback first; AI is paused while reeling.
  if (e.knockback) {
    e.x += e.knockback.vx * dt;
    e.knockback.dt -= dt;
    if (e.knockback.dt <= 0) e.knockback = null;
    return;
  }

  // Hostility gate — non-hostile gang members just loiter / wander until
  // notoriety rises (or until the player smacks them).  This mirrors
  // Saints Row's "you can walk past Carnales until you piss them off"
  // behaviour at low star levels.
  const noto = Math.floor(state.notoriety || 0);
  if (!e.hostile && noto < 1) {
    tickLoiter(e, dt);
    return;
  }
  // At notoriety 1+, ALL gang members of the rival archetype turn hostile.
  if (!e.hostile && noto >= 1) {
    e.hostile = true;
  }

  // Steer toward player on (x, y) plane, but at a minimum range so they
  // don't all stack on the same pixel.
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy);
  const minRange = e.minRange || 56;
  // Aggression multiplier scales speed + attack cadence with notoriety.
  // At noto=1 they're slow & cautious, at noto=5 they sprint and burst-fire.
  const aggr = 0.7 + 0.18 * Math.max(0, noto - 1);
  if (dist > minRange) {
    const sp = e.moveSpeed * aggr * dt;
    e.x += (dx / dist) * sp;
    e.y += (dy / dist) * sp;
    e.facing = dx >= 0 ? 1 : -1;
    e.walkPhase = (e.walkPhase || 0) + dt * 4.5;
  } else {
    // In range — periodically attack.
    e.atkT = (e.atkT || 0) - dt;
    if (e.atkT <= 0) {
      e.atkT = e.atkCooldown / aggr;
      doEnemyAttack(state, e);
    }
  }
  e.y = Math.max(WORLD.groundTop, Math.min(WORLD.groundBottom, e.y));
}

// Non-hostile loitering — gentle back-and-forth wandering on the spot.
function tickLoiter(e, dt) {
  e.wanderT = (e.wanderT || 0) + dt;
  if (e.wanderT > 2.5) {
    e.wanderT = 0;
    e.facing = e.facing === 1 ? -1 : 1;
  }
  e.walkPhase = (e.walkPhase || 0) + dt * 1.4;
  e.x += e.facing * 18 * dt;
}

function doEnemyAttack(state, e) {
  const p = state.player;
  if (e.archetype === 'pawn') {
    // Pistol shot.
    spawnBullet(state, e, p, { speed: 540, damage: 8, fromEnemy: true });
  } else if (e.archetype === 'bishop') {
    // Melee swing — deals damage if player is within range.
    if (Math.hypot(p.x - e.x, p.y - e.y) < 65 && !p.dead) {
      damage(state, p, 12, e.id);
      p.knockback = { vx: e.facing * 150, dt: 0.15 };
    }
  } else if (e.archetype === 'rook') {
    // RPG — slow rocket, big damage on hit.
    spawnBullet(state, e, p, {
      speed: 380, damage: 45, fromEnemy: true,
      sprite: 'rocket', radius: 32,
    });
  } else if (e.archetype === 'queen') {
    // 3-bullet burst.
    for (let i = -1; i <= 1; i++) {
      spawnBullet(state, e, { x: p.x + i * 28, y: p.y }, {
        speed: 460, damage: 10, fromEnemy: true,
      });
    }
  }
}

// Local wrapper kept as a private helper in case file-level callers
// want to add bullet-specific tweaks later.  Not exported.
// eslint-disable-next-line no-unused-vars
function spawnBullet_local(state, src, dst, opts) {
  return spawnBullet(state, src, dst, opts);
}

// ── NPC (recruitable bystander) ──────────────────────────────────────
export function tickNpc(state, n, dt) {
  if (!n.recruited) {
    // Idle bystander — just stands at their spawn waving the prompt.
    n.idlePhase = (n.idlePhase || 0) + dt;
    return;
  }
  // Find nearest hostile enemy first — recruit prioritises threats
  // over staying in formation.  If something's shooting, they should
  // be shooting back.
  let nearest = null, bestD = 520;
  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'enemy' || e.dead) continue;
    const d2 = Math.hypot(e.x - n.x, e.y - n.y);
    if (d2 < bestD) { bestD = d2; nearest = e; }
  }

  // Movement — if there's a target nearby, hold position and aim at it.
  // Otherwise tail the player at a formation offset.
  const p = state.player;
  if (nearest && bestD < 360) {
    // Combat stance — face the target, sidle into range but don't get
    // on top of them.
    const tdx = nearest.x - n.x, tdy = nearest.y - n.y;
    const td = Math.hypot(tdx, tdy) || 1;
    const desiredRange = 220;
    if (td > desiredRange + 20) {
      const sp = (n.moveSpeed || 220) * 0.85 * dt;
      n.x += (tdx / td) * sp;
      n.y += (tdy / td) * sp;
      n.walkPhase = (n.walkPhase || 0) + dt * 5;
    } else if (td < desiredRange - 30) {
      // Back away if too close — soldiers don't melee with pistols.
      const sp = (n.moveSpeed || 220) * 0.6 * dt;
      n.x -= (tdx / td) * sp;
      n.walkPhase = (n.walkPhase || 0) + dt * 5;
    }
    n.facing = tdx >= 0 ? 1 : -1;
  } else {
    // Follow the player at an offset behind.
    const followX = p.x - p.facing * (52 + 30 * n.followIdx);
    const followY = p.y + (n.followIdx % 2 === 0 ? -12 : 12);
    const dx = followX - n.x, dy = followY - n.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      const sp = (n.moveSpeed || 220) * dt;
      n.x += (dx / d) * sp;
      n.y += (dy / d) * sp;
      n.facing = (p.facing >= 0) ? 1 : -1;
      n.walkPhase = (n.walkPhase || 0) + dt * 5;
    }
  }

  // Auto-fire at the nearest enemy in range — fast cadence so the
  // squad reads as actively contributing to combat.
  n.fireT = (n.fireT || 0) - dt;
  if (n.fireT <= 0 && nearest) {
    spawnBullet(state, n, nearest, { speed: 620, damage: 14, fromEnemy: false });
    n.muzzleT = 0.12;                                 // small visible flash
    n.fireT = 0.32 + Math.random() * 0.18;            // ~3 shots / sec
  } else if (n.fireT <= 0) {
    // No targets — just check again shortly.
    n.fireT = 0.25;
  }
  if (n.muzzleT != null) {
    n.muzzleT -= dt;
    if (n.muzzleT <= 0) n.muzzleT = null;
  }
}

// ── BULLET ───────────────────────────────────────────────────────────
export function tickBullet(state, b, dt) {
  b.t += dt;
  // Blind-fire arc — gravity pulls the over-the-wall shot back down so
  // it lands a beat later than a flat-line shot.
  if (b.aboveCover) {
    b.vy += 380 * dt;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.t > b.lifetime || b.x < state.cameraX - 50 || b.x > state.cameraX + WORLD.viewW + 50) {
    b.dead = true;
    return;
  }

  // Remote co-op tracers are visual-only — the shooter's client owns
  // hit detection and relays damage via 'hit' messages, so these never
  // collide with anything locally (prevents double damage).
  if (b.remoteVisual) return;

  // Prop collision — barrels/canisters explode when hp drops to 0,
  // trashcans soak hits with no effect (they're hp:Infinity).  Bullets
  // landing inside the prop's radius are absorbed.
  if (state.props && state.props.length) {
    for (const prop of state.props) {
      if (prop.exploded && prop.kind !== 'canister' && prop.kind !== 'barrel') continue;
      const dx = b.x - prop.x;
      const dy = b.y - prop.y;
      if (Math.abs(dx) < prop.r + 2 && Math.abs(dy) < 14) {
        // Hit!  Subtract HP unless trashcan (huge HP).
        prop.hp -= b.damage;
        if (prop.hp <= 0 && !prop.exploded && (prop.kind === 'barrel' || prop.kind === 'canister')) {
          explodeProp(state, prop);
        }
        // Spawn metallic spark particle.
        if (!state.particles) state.particles = [];
        for (let i = 0; i < 3; i++) {
          state.particles.push({
            x: b.x, y: b.y,
            vx: -Math.sign(b.vx) * (80 + Math.random() * 60),
            vy: -80 - Math.random() * 60,
            life: 0.35, maxLife: 0.35,
            size: 2 + Math.random() * 2,
            color: 'rgba(255, 200, 100, %a)', kind: 'spark',
          });
        }
        b.dead = true;
        return;
      }
    }
  }
  // Cover collision — across-the-road Jersey barriers.  The bullet
  // footprint is the c.thickness × c.length strip on the ground.
  if (state.covers && state.covers.length && !b.aboveCover) {
    for (const c of state.covers) {
      const xHit = b.x >= c.x - 2 && b.x <= c.x + c.thickness + 2;
      const yHit = b.y >= c.y - 4 && b.y <= c.y + c.length + 4;
      if (xHit && yHit) {
        c.chipped = Math.min(1, (c.chipped || 0) + 0.04);
        if (!state.particles) state.particles = [];
        for (let i = 0; i < 3; i++) {
          state.particles.push({
            x: b.x, y: b.y,
            vx: -Math.sign(b.vx) * (60 + Math.random() * 60),
            vy: -60 - Math.random() * 60,
            life: 0.4, maxLife: 0.4,
            size: 2 + Math.random() * 2,
            color: 'rgba(220, 220, 220, %a)', kind: 'dust',
          });
        }
        b.dead = true;
        return;
      }
    }
  }

  // Collide with enemies (if from player/npc) or player (if from enemy).
  if (b.fromEnemy) {
    const p = state.player;
    // Hiding in a trashcan = invisible to enemy bullets.
    if (p.hideT != null) { /* phase through */ }
    else if (!p.dead && pointHits(b, p)) {
      // If player is leaning in cover and the bullet came in along the
      // cover edge from outside the lean side, treat it as a graze.
      let dmg = b.damage;
      if (p.inCover && !p.crouching === false) {
        // Crouched in cover — reduce incoming damage by 60%.
        dmg = Math.max(1, Math.round(b.damage * 0.4));
      }
      damage(state, p, dmg, b.sourceId);
      b.dead = true;
    }
  } else {
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (pointHits(b, e)) {
        damage(state, e, b.damage, b.sourceId);
        e.knockback = { vx: Math.sign(b.vx) * 160, dt: 0.12 };
        b.dead = true;
        break;
      }
    }
    // Co-op FRIENDLY FIRE — local player bullets clip other Saints.
    // We detect the hit on the shooter's client and relay it; the
    // victim's client applies the damage to their own player.
    if (!b.dead && state.coop && state.coop.connected && b.sourceId === state.player.id) {
      for (const r of state.coop.getRemotes(performance.now())) {
        if (r.dead || r.hiding) continue;
        if (Math.abs(b.x - r.x) < 30 && Math.abs(b.y - (r.y - 30)) < 40) {
          state.coop.sendHit(r.id, b.damage);
          state.floatingTexts.push({
            x: r.x, y: r.y - 10, t: 0, lifetime: 0.5,
            text: String(Math.round(b.damage)), color: '#fb923c',
          });
          b.dead = true;
          break;
        }
      }
    }
  }
}

function pointHits(b, target) {
  return Math.abs(b.x - (target.x + (target.w || 40) / 2)) < 30
      && Math.abs(b.y - (target.y - 30)) < 40;
}

// ── PICKUP (weapon / health / cash) ──────────────────────────────────
export function tickPickup(state, pk, dt) {
  pk.bobT = (pk.bobT || 0) + dt;
  const p = state.player;
  if (!p.dead && Math.hypot(p.x - pk.x, p.y - pk.y) < 50) {
    if (pk.kind === 'weapon') {
      if (!p.weapons.find(w => w.id === pk.weaponId)) {
        // Apply the player's weapon skin (female custom Saints carry
        // their own recolored art for every weapon).
        p.weapons.push({ ...WEAPONS[pk.weaponId], ...(p.weaponSkins && p.weaponSkins[pk.weaponId]) });
        pushLog(state, `${WEAPONS[pk.weaponId].name.toUpperCase()} ACQUIRED`);
      }
    } else if (pk.kind === 'health') {
      p.hp = Math.min(p.maxHp, p.hp + pk.amount);
      pushLog(state, `+${pk.amount} HP`);
    } else if (pk.kind === 'cash') {
      // Persist cash to localStorage so it survives across missions and
      // funds the clothing shop in the character creator.
      const current = parseInt(localStorage.getItem('sr_streetfight_cash'), 10) || 0;
      const total = current + pk.amount;
      try { localStorage.setItem('sr_streetfight_cash', String(total)); } catch {}
      p.cashEarned = (p.cashEarned || 0) + pk.amount;
      pushLog(state, `+$${pk.amount}`);
    }
    pk.dead = true;
  }
}
