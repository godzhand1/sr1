// Streetfight engine — a 2.5D Streets-of-Rage / TMNT-style beat-em-up
// state machine.  Pure JS; the React layer just calls `tick(dt)` from a
// requestAnimationFrame loop and `render(ctx)` to paint the canvas.
//
// Coordinate system (Streets-of-Rage style 2.5D):
//   * x  → world horizontal position (camera scrolls this)
//   * y  → ground-plane depth (vertical screen offset from baseline)
//   * z  → jump height (drawn as additional upward offset)
//
// Entities live in `state.entities` keyed by id.  Mission segments
// declare spawn schedules in `state.mission.segments[idx].spawns`; the
// engine fires them as the camera crosses their `triggerX` threshold.
//
// Render order: bg parallax → ground → entities sorted by (y, z) → ui.
import { renderBackground, renderGround } from './background.js';
import { drawEntity, drawHud, drawBullet, drawPickup, drawCover, drawProp, drawRemotePlayer, drawNameTag } from './render.js';
import { tickPlayer, tickEnemy, tickNpc, tickBullet, tickPickup, tickProps } from './tickers.js';

export const WORLD = {
  groundTop:    260,   // furthest depth the player can walk
  groundBottom: 420,   // closest depth (near camera)
  gravity:      1400,  // px/s² for jumps (z)
  viewW:        960,   // logical viewport width (drawn-to width)
  viewH:        540,   // logical viewport height
};

let nextId = 1;
export const uid = () => nextId++;

export function makeInitialState(mission, character) {
  const player = {
    id: uid(),
    kind: 'player',
    character,
    facing: 1,
    x: 60, y: 360, z: 0, vz: 0,
    w: 64, h: 88,
    hp: 100, maxHp: 100,
    moveSpeed: 240,
    fireCooldown: 0,
    meleeCooldown: 0,
    inputs: { left:false, right:false, up:false, down:false, fire:false, melee:false, jump:false, interact:false, switchWeapon:false, crouch:false, reload:false },
    // Start the player with their character's full arsenal if defined,
    // otherwise just the starter weapon.  Custom Saints unlock all
    // five new AI-spritted weapons immediately so the wheel can show
    // them off; preset Saints keep their single-weapon discipline.
    weapons: character.startArsenal
      ? character.startArsenal.map(w => ({ ...w }))
      : [character.startWeapon],
    weaponIdx: character.startWeaponIdx != null ? character.startWeaponIdx : 0,
    chainStep: 0,                        // how many pistol shots before the next "ender" weapon
    squad: [],                           // ids of recruited NPCs following the player
    score: 0, kills: 0,
    // Flatten sprite refs from the character so the renderer can read
    // them off the entity directly (same shape as enemies).
    spriteBase:   character.spriteBase,
    spriteAttack: character.spriteAttack,
    spriteStep:   character.spriteStep,
    spriteBack:   character.spriteBack,
    spriteHit:    character.spriteHit,
    spriteSize:   character.spriteSize,
    poseSprites:  character.poseSprites,
    weaponSkins:  character.weaponSkins,
    widthScale:   character.widthScale,
  };
  return {
    mission,
    player,
    entities: { [player.id]: player },
    bullets: [],
    pickups: [],
    particles: [],                       // gore / bone / fx particles
    covers: [],                          // sideways concrete cover blocks
    props: [],                           // trashcans / barrels / canisters
    cameraX: 0,
    segIdx: 0,
    timeOfDay: mission.timeOfDayStart,   // 0..1 (0 = sunrise, 0.5 = noon, 0.75 = sunset, 0.95 = night)
    dayCycleRate: mission.dayCycleRate || 0,
    checkpoint: { segIdx: 0, x: 60 },
    paused: false,
    over: null,                          // null | 'win' | 'dead'
    floatingTexts: [],                   // damage popups
    promptNpcId: null,                   // currently-recruitable NPC nearby
    cleared: new Set(),                  // segment indexes already triggered
    log: [],                             // last few player-visible event lines
    // Notoriety (0-5 stars).  At 0, gangs are non-hostile and just loiter.
    // Each level adds another rival spawn wave and bumps aggression.  Rises
    // when the player damages neutral entities; decays slowly when the
    // player keeps their hands clean.
    notoriety: 0,
    notorietyAmbientT: 0,                // timer for ambient spawn at level 1+
  };
}

export function spawn(state, entity) {
  const id = uid();
  entity.id = id;
  state.entities[id] = entity;
  return id;
}

// ── COVER ────────────────────────────────────────────────────────────
// Concrete Jersey barriers laid ACROSS the road — the LONG axis goes
// from one side of the street to the other (Y-axis on the ground
// plane = INTO the screen depth), and the SHORT axis is along the
// direction of travel (X-axis).  In side-scroller view this reads as
// a chunky vertical wall the player has to walk AROUND.
//
// The barrier covers MOST but not all of the road depth, leaving a
// gap at one end (front OR back) so the player must shift Y (W/S keys
// or up/down on the stick) to skirt past.
//
// Geometry on the ground plane:
//   x, y        — back-of-barrier corner at the deepest Y the barrier
//                 extends to (away from camera).  Bottom-front edge is
//                 at (x, y + length).
//   length      — Y-axis depth (the LONG axis running across the road,
//                 typically 60-100 px — leaves a 20-40 px skirt gap).
//   thickness   — X-axis thickness (~30 px — chunky enough to read
//                 as a barrier face on screen).
//   height      — visual chest-height (~38 px).
//   gapAt       — 'front' (gap at near-Y side) or 'back' — purely
//                 documentation; the actual skirt gap is the space
//                 between the barrier and the road edges in mission1.
export function spawnCover(state, x, y, length = 80, thickness = 32, opts = {}) {
  if (!state.covers) state.covers = [];
  state.covers.push({
    x, y,
    length, thickness,
    height: opts.height || 38,
    chipped: 0,
    style: opts.style || 'concrete',
    gapAt: opts.gapAt || 'front',
  });
}

// ── PROPS ────────────────────────────────────────────────────────────
// Street props: trash cans (hide-inside-able), oil drums (solid +
// explodes after taking damage → leaves a fire patch), gas canisters
// (smaller barrels w/ red bands, same explode-on-damage behavior, big
// blast radius).  All props have collision so the player can't walk
// through them.
//
// Shape: each prop is {x, y, r (radius, ground-plane), height, hp,
//   kind, exploded, fireT, hideOccupant}.  `kind` ∈ {'trashcan',
//   'barrel', 'canister'}.
export function spawnProp(state, kind, x, y) {
  if (!state.props) state.props = [];
  const base = { trashcan: { r: 16, height: 32, hp: 1e9 },
                 barrel:   { r: 18, height: 42, hp: 30 },
                 canister: { r: 14, height: 36, hp: 22 } }[kind] || {};
  state.props.push({
    kind, x, y, r: base.r, height: base.height,
    hp: base.hp, maxHp: base.hp,
    exploded: false,
    fireT: 0,                       // burning-particles timer post-explosion
    hideOccupant: null,             // entity id currently hidden inside
  });
}

// Shared bullet-spawn helper so weapons + ticker AI don't need to depend
// on each other in a circular fashion.
export function spawnBullet(state, src, dst, opts) {
  const dx = dst.x - src.x;
  const dy = dst.y - src.y;
  const inv = 1 / (Math.hypot(dx, dy) || 1);
  // Muzzle offset uses the shooter's facing so bullets spawn at the
  // gun barrel (front of the character) rather than out the back.
  const facing = src.facing != null ? src.facing : 1;
  // Blind-fire over a lengthwise Jersey barrier: ANY shot while
  // `inCover` arcs over.  The player can't peek the long side — they
  // either commit to the lean (½ damage, safer) or stand up (full
  // damage, exposed).
  const blindFire = src.inCover;
  const bullet = {
    x: src.x + facing * ((src.w || 40) / 2 + 6),
    y: src.y - (blindFire ? 50 : 30) - (src.z || 0),
    vx: dx * inv * opts.speed,
    vy: dy * inv * opts.speed - (blindFire ? 180 : 0),    // tiny upward kick
    damage: opts.damage,
    fromEnemy: !!opts.fromEnemy,
    sprite: opts.sprite || 'pistol',
    radius: opts.radius || 6,
    lifetime: 2.2,
    t: 0,
    dead: false,
    sourceId: src.id,
    aboveCover: blindFire,            // arcs OVER walls
  };
  state.bullets.push(bullet);
  // Co-op: relay the local player's shots so other clients render the
  // tracer (visual-only on their side — damage flows via 'hit' relays).
  if (state.coop && state.coop.connected && src.kind === 'player') {
    state.coop.sendShot(bullet);
  }
}

export function despawn(state, id) {
  delete state.entities[id];
  // Also unlink from squad if needed.
  const squadIdx = state.player.squad.indexOf(id);
  if (squadIdx >= 0) state.player.squad.splice(squadIdx, 1);
}

export function pushLog(state, msg) {
  state.log.push({ msg, t: 0 });
  if (state.log.length > 4) state.log.shift();
}

// Damage helper — returns true if target was killed.
export function damage(state, target, amount, sourceId) {
  if (!target || target.hp <= 0) return false;
  // Eating cancels the moment you take fire — character stands up.
  if (target.eating) { target.eating = false; target.eatT = 0; }
  target.hp -= amount;
  state.floatingTexts.push({
    x: target.x + target.w / 2,
    y: target.y - 10,
    t: 0, lifetime: 0.5,
    text: String(Math.round(amount)),
    color: target.kind === 'player' ? '#ff4040' : '#ffd700',
  });
  // Notoriety bookkeeping — hitting a non-hostile gang member or a
  // bystander tells the city you started something.  Once hostile they
  // count as fair combat and stop adding heat.
  const src = sourceId ? state.entities[sourceId] : null;
  const fromPlayer = src && src.kind === 'player';
  if (fromPlayer) {
    if (target.kind === 'enemy' && !target.hostile) {
      bumpNotoriety(state, 0.6, `${target.name || 'a Carnale'} called for backup`);
      // Mark THIS enemy hostile right away (you swung first).
      target.hostile = true;
    } else if (target.kind === 'npc' && !target.recruited) {
      bumpNotoriety(state, 1.0, `civilians are calling the cops`);
    }
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    target.deathT = 0;
    if (target.kind !== 'player') {
      state.player.score += target.scoreValue || 25;
      state.player.kills += 1;
      // Cash drops — every enemy spits out a wad based on archetype.
      const drop = target.cashDrop ?? defaultCashDrop(target.archetype);
      if (drop > 0) {
        state.pickups.push({
          kind: 'cash',
          amount: drop,
          x: target.x + (Math.random() - 0.5) * 30,
          y: target.y,
          bobT: 0,
          dead: false,
        });
      }
      // Killing a civilian / non-hostile NPC = serious heat.
      if (fromPlayer && target.kind === 'npc' && !target.recruited) {
        bumpNotoriety(state, 1.5, 'civilian casualty');
      }
    }
    return true;
  }
  return false;
}

// Notoriety helpers ────────────────────────────────────────────────────
// Saints Row-style 0-5 star rating.  Rises when the player hits neutrals,
// decays slowly while they keep their hands clean.
export function bumpNotoriety(state, amount, reason) {
  const before = Math.floor(state.notoriety);
  state.notoriety = Math.min(5, (state.notoriety || 0) + amount);
  const after = Math.floor(state.notoriety);
  if (after > before) {
    pushLog(state, `NOTORIETY ★${after}  —  ${reason || 'heat rising'}`);
    // Flip *all* currently-spawned gang members to hostile when a new
    // star lights up — the whole neighborhood gets the message.
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'enemy' && !e.hostile) e.hostile = true;
    }
  }
}

function tickNotoriety(state, dt) {
  // Decay: lose 1 full star per ~25s of clean play.
  if (state.notoriety > 0) {
    state.notoriety = Math.max(0, state.notoriety - dt * 0.04);
  }
  // Ambient gang spawns at notoriety 1+ — the higher the star count,
  // the faster fresh hostiles roll in to chase you down.
  const lvl = Math.floor(state.notoriety);
  if (lvl >= 1) {
    state.notorietyAmbientT = (state.notorietyAmbientT || 0) + dt;
    // 8s base, halved per star → noto 1: 8s, 2: 6s, 3: 4s, 4: 3s, 5: 2s.
    const interval = Math.max(2, 8 - lvl * 1.4);
    if (state.notorietyAmbientT >= interval) {
      state.notorietyAmbientT = 0;
      spawnAmbientHostile(state, lvl);
    }
  } else {
    state.notorietyAmbientT = 0;
  }
}

// Spawn an ambient hostile at the right edge of the camera, scaled to
// notoriety level.  At low stars it's a single pawn; at noto 4-5 it's a
// queen or rook squad.
function spawnAmbientHostile(state, lvl) {
  const camX = state.cameraX;
  const spawnX = camX + WORLD.viewW + 60;   // just off-screen right
  const baseY = 360 + (Math.random() - 0.5) * 50;
  // Re-use mission1 makers via dynamic import would be cleaner — instead
  // we shape a minimal hostile-pawn here from the LC sprites so the
  // engine has no mission coupling.
  const LC = '/pieces/LC';
  const mk = {
    kind: 'enemy', archetype: 'pawn', name: 'LC Patrol',
    x: spawnX, y: baseY, w: 60, h: 84,
    hp: 25 + 10 * lvl, maxHp: 25 + 10 * lvl,
    moveSpeed: 120 + 8 * lvl,
    minRange: 220,
    atkCooldown: Math.max(0.6, 1.4 - lvl * 0.15),
    scoreValue: 20 + 6 * lvl,
    spriteSize: 88,
    facing: -1,
    hostile: true,
    spriteBase:   `${LC}/pawn.png`,
    spriteAttack: `${LC}/pawn_attack.png`,
    spriteStep:   { left: `${LC}/pawn_step_left.png`, right: `${LC}/pawn_step_right.png` },
    deathSprite:  `${LC}/pawn_hit.png`,
  };
  // Heavier hostile every 3rd ambient wave at noto 3+.
  if (lvl >= 3 && Math.random() < 0.5) {
    mk.archetype = 'queen';
    mk.name = 'LC Sicaria';
    mk.hp = 80; mk.maxHp = 80;
    mk.atkCooldown = 1.0;
    mk.minRange = 250;
    mk.scoreValue = 120;
    mk.spriteBase   = `${LC}/queen.png`;
    mk.spriteAttack = `${LC}/queen_attack.png`;
    mk.deathSprite  = `${LC}/queen.png`;
  }
  if (lvl >= 4) {
    // Spawn a duo at level 4+.
    spawn(state, { ...mk, x: spawnX + 60, y: baseY + 25 });
  }
  spawn(state, mk);
}

function defaultCashDrop(archetype) {
  switch (archetype) {
    case 'pawn':   return 15 + Math.floor(Math.random() * 10);
    case 'bishop': return 30 + Math.floor(Math.random() * 15);
    case 'queen':  return 80 + Math.floor(Math.random() * 30);
    case 'rook':   return 120 + Math.floor(Math.random() * 50);
    default:       return 20;
  }
}

export function tick(state, dt) {
  if (state.paused || state.over) return;

  // Hit-stop / finisher slow-mo — when a Negan-style bat finisher fires,
  // we briefly pause the whole world (~100ms) for impact emphasis.
  if (state.hitStopT && state.hitStopT > 0) {
    state.hitStopT -= dt;
    return;
  }

  // Particle system tick (gore, bone, generic).
  if (state.particles && state.particles.length) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vy += 720 * dt;            // gravity for splatter arc
      p.vx *= 0.96;                // air drag
    }
    state.particles = state.particles.filter(p => p.life > 0);
  }

  // Day/night drift forward over the mission.
  if (state.dayCycleRate) {
    state.timeOfDay = (state.timeOfDay + state.dayCycleRate * dt) % 1;
  }

  // Notoriety decay + ambient spawns.
  tickNotoriety(state, dt);

  // Co-op events — friendly-fire hits on us, remote tracers, and
  // drop-in/drop-out toasts relayed by the Stilwater room.
  if (state.coop) {
    for (const ev of state.coop.drainEvents()) {
      if (ev.type === 'hit') {
        damage(state, state.player, ev.damage, null);
        pushLog(state, `SHOT BY ${ev.from}`);
      } else if (ev.type === 'shot') {
        state.bullets.push({
          x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy,
          sprite: ev.sprite || 'pistol', radius: ev.radius || 6,
          damage: 0, fromEnemy: false, remoteVisual: true,
          lifetime: 2.2, t: 0, dead: false, sourceId: null,
        });
      } else if (ev.type === 'join') {
        pushLog(state, `${ev.display} DROPPED IN`);
      } else if (ev.type === 'leave') {
        pushLog(state, `${ev.display} DROPPED OUT`);
      } else if (ev.type === 'host') {
        pushLog(state, `${ev.display} IS NOW HOST`);
      } else if (ev.type === 'room_full') {
        pushLog(state, 'CO-OP ROOM FULL (12/12) — SOLO MODE');
      }
    }
  }

  // Camera follows the player with a soft right-bias so on-coming
  // enemies are visible.
  const desiredCam = Math.max(0, state.player.x - 280);
  state.cameraX += (desiredCam - state.cameraX) * Math.min(1, dt * 4);
  // Clamp the camera to the segment's wall when active.
  const seg = state.mission.segments[state.segIdx];
  if (seg) {
    state.cameraX = Math.max(seg.cameraMinX || 0, Math.min(state.cameraX, seg.cameraMaxX));
    state.player.x = Math.max(state.cameraX + 20, state.player.x);
    if (seg.wallX != null) {
      state.player.x = Math.min(state.player.x, seg.wallX - 30);
    }
  }

  // Fire segment spawn triggers based on the camera position.
  if (seg) {
    for (const sp of seg.spawns) {
      if (sp._fired) continue;
      if (state.cameraX + WORLD.viewW * 0.6 >= sp.triggerX) {
        sp._fired = true;
        sp.go(state);
        if (sp.banner) pushLog(state, sp.banner);
      }
    }
    // Segment cleared once all spawned non-pickup enemies are dead AND
    // the camera has scrolled past `cameraMaxX`.  Advance to next seg
    // (or trigger mission win if no more segments).
    const someEnemiesAlive = Object.values(state.entities).some(
      e => e.kind === 'enemy' && !e.dead
    );
    if (!someEnemiesAlive && state.cameraX >= seg.cameraMaxX - 1 && seg.wallX == null) {
      state.cleared.add(state.segIdx);
      state.checkpoint = { segIdx: state.segIdx + 1, x: state.player.x };
      pushLog(state, '✓ CHECKPOINT');
      state.segIdx += 1;
      if (state.segIdx >= state.mission.segments.length) {
        state.over = 'win';
      }
    }
    // Boss segments use wallX — clear by killing all enemies, then drop
    // the wall.
    if (seg.wallX != null && !someEnemiesAlive) {
      seg.wallX = null;
      pushLog(state, '✓ AREA CLEAR');
    }
  }

  // Tick all entities.  Iterate over a snapshot since handlers may
  // spawn/despawn during the loop.
  for (const id of Object.keys(state.entities)) {
    const e = state.entities[id];
    if (!e) continue;
    if (e.dead) {
      e.deathT += dt;
      if (e.deathT > (e.deathDuration || 0.9)) despawn(state, e.id);
      continue;
    }
    if (e.kind === 'player') tickPlayer(state, e, dt);
    else if (e.kind === 'enemy') tickEnemy(state, e, dt);
    else if (e.kind === 'npc') tickNpc(state, e, dt);
  }
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    tickBullet(state, b, dt);
    if (b.dead) state.bullets.splice(i, 1);
  }
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    tickPickup(state, state.pickups[i], dt);
    if (state.pickups[i].dead) state.pickups.splice(i, 1);
  }

  // Props (trashcans/barrels/canisters) — handles fire damage tick
  // post-explosion + spawns smouldering fire particles.
  tickProps(state, dt);

  // Floating damage text TTL.
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    state.floatingTexts[i].t += dt;
    if (state.floatingTexts[i].t > state.floatingTexts[i].lifetime) {
      state.floatingTexts.splice(i, 1);
    }
  }
  for (const l of state.log) l.t += dt;
  state.log = state.log.filter(l => l.t < 4);

  // Player death → mission over (caller restarts at checkpoint).
  if (state.player.dead && !state.over) {
    state.over = 'dead';
  }
}

export function render(ctx, state, assets) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  renderBackground(ctx, state, assets);
  renderGround(ctx, state, assets);

  // Sort entities by y so further-away pieces render behind closer ones.
  // Remote co-op Saints are merged into the same depth sort so they
  // correctly occlude / get occluded by local entities.
  const remotes = state.coop && state.coop.connected
    ? state.coop.getRemotes(performance.now())
    : [];
  const sorted = [
    ...Object.values(state.entities),
    ...remotes.map(r => ({ __remote: r, y: r.y, z: r.z })),
  ].sort((a, b) => (a.y + (a.z || 0) * 0.001) - (b.y + (b.z || 0) * 0.001));
  for (const e of sorted) {
    if (e.__remote) drawRemotePlayer(ctx, state, e.__remote);
    else drawEntity(ctx, state, e, assets);
  }

  // Local player's own [GANG] Username tag — only meaningful in co-op.
  if (state.coop && state.coop.connected && state.coop.display) {
    const p = state.player;
    drawNameTag(
      ctx,
      p.x - state.cameraX,
      p.y - 100 - (p.z || 0),
      state.coop.display,
      '#fde047'
    );
  }

  // Cover blocks render BETWEEN entities and bullets so the player
  // sprite can pop in front of the block when standing tall, but
  // bullets visibly stop on the front face.
  if (state.covers) {
    for (const c of state.covers) drawCover(ctx, state, c);
  }
  // Props (trashcans / barrels / canisters) — drawn ON the ground
  // plane, can occlude the player's feet when standing behind them.
  if (state.props) {
    for (const prop of state.props) drawProp(ctx, state, prop);
  }

  for (const b of state.bullets) drawBullet(ctx, state, b);
  for (const p of state.pickups) drawPickup(ctx, state, p, assets);

  // Particles (gore / bone / generic) — drawn over entities so they
  // sit on top of the victim mid-splatter.
  if (state.particles && state.particles.length) {
    for (const p of state.particles) {
      const a = Math.max(0, Math.min(1, p.life / (p.maxLife || 1)));
      const color = (p.color || 'rgba(220,32,32,%a)').replace('%a', a.toFixed(2));
      ctx.fillStyle = color;
      const x = p.x - state.cameraX, y = p.y;
      const r = (p.size || 3) * (0.6 + a * 0.4);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Hit-stop flash — bright white pulse for 1 frame on the moment a
  // finisher lands.  Reads as "BAM!" without a screen-shake library.
  if (state.hitStopT && state.hitStopT > 0.05) {
    const intensity = (state.hitStopT - 0.05) / 0.05;
    ctx.save();
    ctx.fillStyle = `rgba(255, 240, 200, ${0.35 * Math.max(0, intensity)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  // Floating numbers + recruit prompt last so they sit on top.
  for (const f of state.floatingTexts) {
    const a = Math.max(0, 1 - f.t / f.lifetime);
    ctx.fillStyle = f.color;
    ctx.globalAlpha = a;
    ctx.font = 'bold 18px Chivo, sans-serif';
    ctx.fillText(f.text, f.x - state.cameraX, f.y - f.t * 30);
    ctx.globalAlpha = 1;
  }

  if (state.promptNpcId && state.entities[state.promptNpcId]) {
    const n = state.entities[state.promptNpcId];
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('[E] GANG UP', n.x - state.cameraX + n.w / 2, n.y - 30);
    ctx.textAlign = 'left';
  }

  drawHud(ctx, state);
}
