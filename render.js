// Streetfight render helpers — paint entities, bullets, pickups, HUD,
// floating background, and the ground onto a single 2D canvas.  Sprite
// loading uses a simple URL → Image cache; missing sprites fall back to
// crude rectangles so missing-asset states never crash.

const _imgCache = new Map();
export function getImg(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const img = new Image();
  img.src = url;
  _imgCache.set(url, img);
  return img;
}

// ── Entity ────────────────────────────────────────────────────────────
export function drawEntity(ctx, state, e, assets) {
  if (e.dead) {
    // Death anim — quick tilt + fade.  Renders the gang's pawn_hit /
    // knight_dead sprite if available for thematic kills.
    const t = e.deathT;
    const alpha = Math.max(0, 1 - t / (e.deathDuration || 0.9));
    ctx.globalAlpha = alpha;
    drawPiece(ctx, state, e, e.deathSprite || e.spriteBase);
    ctx.globalAlpha = 1;
    return;
  }
  // Pick a sprite variant based on action state.
  let sprite = e.spriteBase;
  if (e.kind === 'player') {
    // Player sprite — show the equipped weapon's hold/fire art if it
    // ships its own art; otherwise show the customized pawn.  No walk-
    // cycle frame swap: source `pawn_step_left.png` and `pawn_step_right.png`
    // are visibly different variants (one has grey pants, the other
    // crops the white tank into the pants region) so any alternation
    // between them flashes the recolor into different colors and shapes.
    // The on-screen position update IS the walk; the breathing
    // animation in drawPiece supplies the subtle idle motion.
    const wpn = e.weapons && e.weapons[e.weaponIdx || 0];
    const recoiling = e.fireCooldown != null && wpn
      && e.fireCooldown > wpn.cooldown * 0.55;
    // Status pose overrides — eating / burping / hiding / leaning.
    // Priority: hiding > burping > eating > leaning > combat > idle.
    // Female custom Saints carry their own recolored pose set on
    // `e.poseSprites`; everyone else uses the shared male art.
    const ps = e.poseSprites || {};
    if (e.hideT != null) {
      sprite = ps.hide || '/streetfight/weapons/hide_trash.png';
    } else if (e.burpT && e.burpT > 0) {
      sprite = ps.burp || '/streetfight/weapons/burp.png';
    } else if (e.eating) {
      sprite = ps.eat || '/streetfight/weapons/eat_burger.png';
    } else if (e.inCover) {
      sprite = ps.lean || '/streetfight/weapons/lean_cover.png';
    } else {
      // Mid-melee — show the weapon's bash pose (or the fist punch for
      // bare-handed).  Each weapon has its own sprite_bash for the
      // LT-melee gun-as-club hits.
      const isBashing = e.meleeT != null;
      if (isBashing && wpn && wpn.sprite_bash) {
        sprite = wpn.sprite_bash;
      } else if (wpn && wpn.sprite_hold) {
        sprite = (e.inputs?.fire || recoiling) && wpn.sprite_fire
          ? wpn.sprite_fire
          : wpn.sprite_hold;
      } else if (wpn && wpn.useAttackPose) {
        sprite = e.spriteAttack || sprite;
      } else if (e.meleeT != null) {
        sprite = e.spriteAttack || sprite;
      } else if (e.inputs?.fire) {
        sprite = e.spriteAttack || sprite;
      }
    }
    // Note: no walk-cycle sprite swap.  Position changes on screen
    // are the locomotion read.
  } else if (e.kind === 'enemy') {
    // Same single-sprite rule for enemies — no flickering variant
    // walk cycle.  Only the attack pose breaks the idle.
    if (e.atkT != null && e.atkT > e.atkCooldown - 0.2) sprite = e.spriteAttack || sprite;
  } else if (e.kind === 'npc') {
    // NPCs (squad / bystanders) — single consistent sprite.
  }
  drawPiece(ctx, state, e, sprite);

  // Muzzle flash for the player when firing — small canvas-rendered
  // burst at the gun-hand height so the user can see they're shooting.
  // Replaces the inline AI-sprite muzzle on weapons whose `sprite_fire`
  // ships baked-in smoke that can't cleanly key out (AK-47).
  if (e.kind === 'player' && e.fireCooldown != null) {
    const wpn = e.weapons && e.weapons[e.weaponIdx || 0];
    if (wpn && wpn.cooldown && e.fireCooldown > wpn.cooldown * 0.55) {
      const sx = e.x - state.cameraX + (e.facing || 1) * 44;
      const sy = e.y - 56 - (e.z || 0);
      const grd = ctx.createRadialGradient(sx, sy, 2, sx, sy, 18);
      grd.addColorStop(0, 'rgba(255, 240, 120, 0.95)');
      grd.addColorStop(0.4, 'rgba(255, 180, 40, 0.7)');
      grd.addColorStop(1, 'rgba(255, 100, 0, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Muzzle flash for recruited NPCs while firing — small yellow burst
  // at the gun-hand height so it's obvious they're contributing.
  if (e.kind === 'npc' && e.recruited && e.muzzleT != null) {
    const sx = e.x - state.cameraX + (e.facing || 1) * 32;
    const sy = e.y - 48 - (e.z || 0);
    const grd = ctx.createRadialGradient(sx, sy, 2, sx, sy, 14);
    grd.addColorStop(0, 'rgba(255, 240, 120, 0.95)');
    grd.addColorStop(1, 'rgba(255, 140, 0, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.fill();
  }

  // Health bar over enemies' heads (not over player — bottom HUD handles that).
  if (e.kind === 'enemy' && e.hp < e.maxHp) {
    const sx = e.x - state.cameraX;
    const sy = e.y - 95 - (e.z || 0);
    ctx.fillStyle = '#222';
    ctx.fillRect(sx - 18, sy, 36, 4);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(sx - 18, sy, 36 * Math.max(0, e.hp / e.maxHp), 4);
  }

  // Squad-member badge.
  if (e.kind === 'npc' && e.recruited) {
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.fillText('★', e.x - state.cameraX - 16, e.y - 88 - (e.z || 0));
  }
}

function drawPiece(ctx, state, e, spriteUrl) {
  const sx = Math.round(e.x - state.cameraX);
  // y is "feet" on the ground plane; sprite is drawn above.
  const baseSize = e.spriteSize || 96;
  // Body-type horizontal scale (slim / average / big) — applies to the
  // whole sprite in every pose.
  const drawW = baseSize * (e.widthScale || 1);
  const drawH = baseSize;
  // Default jump-height (z) to 0 for entities that never jump (enemies,
  // NPCs).  Without this the subtraction yields NaN and Canvas silently
  // skips the drawImage call — which made enemies render-invisible.
  const z = e.z || 0;
  const sy = Math.round(e.y - drawH + 10 - z);
  if (!spriteUrl) {
    // Fallback box if the sprite hasn't been wired in yet.
    ctx.fillStyle = e.color || '#888';
    ctx.fillRect(sx - drawW / 2, sy, drawW, drawH);
    return;
  }
  const img = getImg(spriteUrl);
  if (!img.complete || img.naturalWidth === 0) {
    // Sprite still loading on this frame.  Skip rendering instead of
    // flashing a gray placeholder — the next frame will pick it up
    // once the browser finishes the decode.
    return;
  }
  // Idle breathing — when the entity isn't moving, attacking, or
  // knocked back, gently scale the sprite vertically with a slow sine
  // wave (each entity gets a per-id phase offset so they don't all
  // breathe in lock-step).  Active entities skip this so it doesn't
  // fight with walk-cycle / attack motion.
  let breathOffsetY = 0;
  let breathScaleY  = 1;
  const isActive = (e.inputs && (e.inputs.left || e.inputs.right || e.inputs.up || e.inputs.down || e.inputs.fire))
    || e.meleeT != null || e.knockback || (e.walkPhase != null && (e.x !== (e._lastX ?? e.x) || e.y !== (e._lastY ?? e.y)));
  if (!isActive && e.kind !== 'pickup' && !e.dead) {
    const phase = (e._breathPhase ??= Math.random() * Math.PI * 2);
    const t = performance.now() / 1000;
    const s = Math.sin(t * 2.2 + phase);
    breathOffsetY = s * 1.4;            // 1-2 px vertical sway
    breathScaleY  = 1 + s * 0.012;      // chest expand/contract ~1%
  }
  e._lastX = e.x; e._lastY = e.y;
  // Shadow ellipse on the ground.  Drawn under the sprite at the
  // "feet" position, accounting for the optional jump (z) offset.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, e.y, drawW * 0.32, drawW * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  // Sprite, optionally horizontally mirrored to face left.
  ctx.save();
  let finalSy = sy + breathOffsetY;
  let finalH  = drawH * breathScaleY;
  // Crouch / cover lean offsets — player only.  Crouched in cover
  // drops + tilts the sprite slightly toward the lean side.
  let leanX = 0, leanRot = 0;
  if (e.kind === 'player') {
    if (e.crouching && !e.inCover) {
      finalSy += drawH * 0.18;
      finalH  *= 0.85;
    }
    if (e.inCover) {
      // Auto-face the wall: player on LEFT side (coverSide=-1) faces
      // right (positive), player on RIGHT side faces left.  The lean
      // sprite is drawn facing right by default; the existing mirror
      // logic below flips it based on e.facing.  We override facing
      // here so the leaning visual always points INTO the wall.
      e.facing = e.coverSide < 0 ? 1 : -1;
      finalSy += 4;
    }
  }
  if (e.facing < 0) {
    ctx.translate(sx + leanX, 0);
    ctx.scale(-1, 1);
    if (leanRot) ctx.rotate(leanRot);
    ctx.drawImage(img, -drawW / 2, finalSy, drawW, finalH);
  } else {
    if (leanRot) {
      ctx.translate(sx + leanX, finalSy + finalH / 2);
      ctx.rotate(leanRot);
      ctx.drawImage(img, -drawW / 2, -finalH / 2, drawW, finalH);
    } else {
      ctx.drawImage(img, sx - drawW / 2 + leanX, finalSy, drawW, finalH);
    }
  }
  ctx.restore();
}

// ── Bullet ────────────────────────────────────────────────────────────
export function drawBullet(ctx, state, b) {
  const sx = b.x - state.cameraX;
  const sy = b.y - 30;
  if (b.sprite === 'rocket') {
    // Quick rocket: small gray pill with a flame tail behind it.
    const angle = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.fillStyle = '#ddd';
    ctx.fillRect(-14, -3, 28, 6);
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-26, -4);
    ctx.lineTo(-26, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }
  if (b.sprite === 'pellet') {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Default tracer.
  ctx.strokeStyle = b.fromEnemy ? '#f87171' : '#fde047';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx - b.vx * 0.012, sy - b.vy * 0.012);
  ctx.stroke();
}

// ── Pickup ────────────────────────────────────────────────────────────
export function drawPickup(ctx, state, pk, assets) {
  const sx = pk.x - state.cameraX;
  const sy = pk.y - 40 + Math.sin(pk.bobT * 4) * 4;
  // Cash drop — green coin with $ amount above.
  if (pk.kind === 'cash') {
    // Glow halo (more intense for bigger drops).
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 22);
    glow.addColorStop(0, 'rgba(74, 222, 128, 0.55)');
    glow.addColorStop(1, 'rgba(74, 222, 128, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
    // Coin body.
    ctx.fillStyle = '#16a34a';
    ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#052e16';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.stroke();
    // $ glyph.
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', sx, sy + 6);
    // Amount above coin.
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.fillStyle = '#fde047';
    ctx.fillText(`+${pk.amount}`, sx, sy - 18);
    ctx.textAlign = 'left';
    return;
  }
  ctx.fillStyle = pk.kind === 'health' ? '#ef4444' : '#22d3ee';
  ctx.beginPath();
  ctx.arc(sx, sy, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 16px Chivo, sans-serif';
  ctx.textAlign = 'center';
  const label = pk.kind === 'health' ? '+' : (pk.weaponId === 'shotgun' ? 'S' : pk.weaponId === 'smg' ? 'M' : 'R');
  ctx.fillText(label, sx, sy + 5);
  ctx.textAlign = 'left';
}

// ── Cover (Across-the-road Jersey Barriers) ────────────────────────
// The barrier's LONG axis runs from one side of the street to the
// other (Y goes INTO screen depth).  Its SHORT axis (thickness, on X)
// is the chunky face the player walks up to.  In the side-scroller
// view we see the FRONT face (close to camera) plus a foreshortened
// top-cap sloping back toward the far end of the barrier.
//
// Layout per cover on the ground:
//   c.x, c.y       — far-side (back) bottom-left.  Bottom-front is at
//                    (c.x, c.y + c.length).
//   c.length       — Y-axis depth (the long axis going across the road)
//   c.thickness    — X-axis chunkiness (typically 30 px)
//   c.height       — chest-height drawn UP from the ground plane
export function drawCover(ctx, state, c) {
  const x      = c.x - state.cameraX;
  const yFront = c.y + c.length;     // close-to-camera (low on screen)
  const yBack  = c.y;                // far-from-camera (high on screen)
  const isCrate = c.style === 'crate';
  ctx.save();

  // Drop shadow extending Y-wise (toward camera).
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse(x + c.thickness / 2, yFront + 4, c.thickness * 0.7 + 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + c.thickness / 2, yBack + 2, c.thickness * 0.6 + 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const pal = isCrate
    ? { side: '#7c4a1e', top: '#9a5e2a', edge: '#3d2208', highlight: '#b87838' }
    : { side: '#d2cfc8', top: '#e8e5dd', edge: '#5a5a55', highlight: '#f4f1e8' };

  const baseExtend = 4;   // base flare on X
  // Top of the wall at near (front) Y.
  const topYFront = yFront - c.height;
  const topYBack  = yBack  - c.height;
  // Step-in halfway up.
  const stepFront = yFront - c.height * 0.45;
  const stepBack  = yBack  - c.height * 0.45;

  // ── FRONT/SIDE FACE — what the player walks into. ───────────────
  // We draw the visible quad: the strip running from the BACK-bottom
  // to the FRONT-bottom on the ground, up to the chest-height top.
  // The face has a flared base on X (same Jersey profile).
  ctx.fillStyle = pal.side;
  ctx.beginPath();
  ctx.moveTo(x - baseExtend,                 yFront);
  ctx.lineTo(x + c.thickness + baseExtend,   yFront);
  ctx.lineTo(x + c.thickness + baseExtend,   yBack);
  ctx.lineTo(x - baseExtend,                 yBack);
  ctx.closePath();
  ctx.fill();
  // Top half of the side face — narrower (above step-in).
  ctx.beginPath();
  ctx.moveTo(x,                              stepFront);
  ctx.lineTo(x + c.thickness,                stepFront);
  ctx.lineTo(x + c.thickness,                topYFront);
  ctx.lineTo(x + c.thickness,                topYBack);
  ctx.lineTo(x,                              topYBack);
  ctx.lineTo(x,                              topYFront);
  ctx.closePath();
  ctx.fill();
  // Trapezoid filler between step-in and ground flare.
  ctx.beginPath();
  ctx.moveTo(x - baseExtend,                 yFront);
  ctx.lineTo(x + c.thickness + baseExtend,   yFront);
  ctx.lineTo(x + c.thickness,                stepFront);
  ctx.lineTo(x,                              stepFront);
  ctx.closePath();
  ctx.fill();

  // Highlight band along the upper face.
  ctx.fillStyle = pal.highlight;
  ctx.fillRect(x, topYFront + 3, c.thickness, 4);

  // ── TOP CAP — the chest-high surface, sloping from yFront to yBack. ─
  // This is the long thin top of the wall (X = thickness, Y = length).
  ctx.fillStyle = pal.top;
  ctx.beginPath();
  ctx.moveTo(x,                              topYFront);
  ctx.lineTo(x + c.thickness,                topYFront);
  ctx.lineTo(x + c.thickness,                topYBack);
  ctx.lineTo(x,                              topYBack);
  ctx.closePath();
  ctx.fill();

  // Edge outlines.
  ctx.strokeStyle = pal.edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Front face outline.
  ctx.moveTo(x - baseExtend,                 yFront);
  ctx.lineTo(x,                              stepFront);
  ctx.lineTo(x,                              topYFront);
  ctx.lineTo(x + c.thickness,                topYFront);
  ctx.lineTo(x + c.thickness,                stepFront);
  ctx.lineTo(x + c.thickness + baseExtend,   yFront);
  // Back face outline.
  ctx.moveTo(x - baseExtend,                 yBack);
  ctx.lineTo(x,                              stepBack);
  ctx.lineTo(x,                              topYBack);
  ctx.lineTo(x + c.thickness,                topYBack);
  ctx.lineTo(x + c.thickness,                stepBack);
  ctx.lineTo(x + c.thickness + baseExtend,   yBack);
  // Top-cap left/right edges.
  ctx.moveTo(x,             topYFront);
  ctx.lineTo(x,             topYBack);
  ctx.moveTo(x + c.thickness, topYFront);
  ctx.lineTo(x + c.thickness, topYBack);
  ctx.stroke();

  // Pre-cast segment seams every ~30 px on the top cap (across the depth).
  ctx.strokeStyle = 'rgba(60, 60, 55, 0.55)';
  ctx.lineWidth = 1;
  const segLen = 30;
  for (let yi = topYBack + segLen; yi < topYFront; yi += segLen) {
    ctx.beginPath();
    ctx.moveTo(x,             yi);
    ctx.lineTo(x + c.thickness, yi);
    ctx.stroke();
  }

  if (isCrate) {
    ctx.fillStyle = pal.edge;
    ctx.font = 'bold 8px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', x + c.thickness / 2, (topYFront + topYBack) / 2 + 2);
    ctx.textAlign = 'left';
  } else {
    // Bullet cracks across the front face.
    const chip = c.chipped || 0;
    if (chip > 0) {
      ctx.strokeStyle = `rgba(50, 50, 50, ${0.4 + chip * 0.6})`;
      ctx.lineWidth = 1;
      const seed = (c.x * 13.37) % 100;
      for (let i = 0; i < 2 + Math.floor(chip * 5); i++) {
        const cx = x + 4 + ((seed * (i + 1)) % (c.thickness - 8));
        const cy = topYFront + 4 + ((seed * (i + 2)) % (c.height - 10));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 4, cy + 3);
        ctx.lineTo(cx + 8, cy - 1);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

// ── Props (Trashcans / Barrels / Canisters) ────────────────────────
// Side-of-the-street obstacles.  Trashcans are hide-able; barrels +
// canisters explode when shot.
export function drawProp(ctx, state, prop) {
  const x = prop.x - state.cameraX;
  const y = prop.y;
  ctx.save();

  // Shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, prop.r + 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (prop.exploded && (prop.kind === 'barrel' || prop.kind === 'canister')) {
    // Smouldering metal skeleton — twisted dark rim sitting in the
    // fire patch the particle system is drawing on top.  Just a
    // charred disc on the ground.
    ctx.fillStyle = 'rgba(40, 35, 30, 0.85)';
    ctx.beginPath(); ctx.ellipse(x, y, prop.r + 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80, 60, 40, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, prop.r + 4, 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }

  if (prop.kind === 'trashcan') {
    // Steel rubbish bin — vertical cylinder w/ rim + dent + lid.
    const top = y - prop.height;
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(x - prop.r, top + 4, prop.r * 2, prop.height - 4);
    // Highlight stripe.
    ctx.fillStyle = '#6b6e72';
    ctx.fillRect(x - prop.r + 3, top + 6, 3, prop.height - 8);
    // Rim band.
    ctx.fillStyle = '#2a2c30';
    ctx.fillRect(x - prop.r, top + 4, prop.r * 2, 3);
    // Lid (when not hidden).
    ctx.fillStyle = '#3a3d42';
    ctx.beginPath(); ctx.ellipse(x, top, prop.r, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Handle.
    ctx.strokeStyle = '#1a1c20';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4, top - 2); ctx.lineTo(x + 4, top - 2);
    ctx.stroke();
  } else if (prop.kind === 'barrel') {
    // Industrial oil drum — rust-orange w/ horizontal bands.
    const top = y - prop.height;
    ctx.fillStyle = '#8c4a1e';
    ctx.fillRect(x - prop.r, top + 4, prop.r * 2, prop.height - 4);
    // Bands.
    ctx.fillStyle = '#5a2e0e';
    for (let bi = 0; bi < 3; bi++) {
      ctx.fillRect(x - prop.r, top + 8 + bi * (prop.height / 4), prop.r * 2, 3);
    }
    // Top rim.
    ctx.fillStyle = '#a85a25';
    ctx.beginPath(); ctx.ellipse(x, top + 4, prop.r, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Hazard stencil.
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 9px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OIL', x, top + prop.height / 2 + 3);
    ctx.textAlign = 'left';
    // HP damage cracks.
    if (prop.hp < prop.maxHp) {
      const wear = 1 - prop.hp / prop.maxHp;
      ctx.fillStyle = `rgba(20, 10, 5, ${wear * 0.7})`;
      ctx.fillRect(x - prop.r + 4, top + 14, 3, 8);
      if (wear > 0.5) ctx.fillRect(x + prop.r - 6, top + 22, 4, 6);
    }
  } else if (prop.kind === 'canister') {
    // Slimmer gas canister — red w/ white bands + skull stencil.
    const top = y - prop.height;
    ctx.fillStyle = '#c92830';
    ctx.fillRect(x - prop.r, top + 4, prop.r * 2, prop.height - 4);
    // White bands.
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(x - prop.r, top + 8, prop.r * 2, 3);
    ctx.fillRect(x - prop.r, top + prop.height - 8, prop.r * 2, 3);
    // Top valve.
    ctx.fillStyle = '#a01820';
    ctx.beginPath(); ctx.ellipse(x, top + 4, prop.r, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x - 2, top - 2, 4, 6);
    // Stencil.
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('☠', x, top + prop.height / 2 + 4);
    ctx.textAlign = 'left';
    // HP cracks.
    if (prop.hp < prop.maxHp) {
      const wear = 1 - prop.hp / prop.maxHp;
      ctx.fillStyle = `rgba(50, 10, 5, ${wear * 0.7})`;
      ctx.fillRect(x - prop.r + 3, top + 16, 2, 8);
    }
  }

  ctx.restore();
}

// ── Remote co-op Saints ───────────────────────────────────────────────
// Drawn from the interpolated snapshots the CoopClient maintains.  Each
// remote renders with their `[GANG] Username` tag + an HP bar above the
// head, per the co-op spec.
export function drawRemotePlayer(ctx, state, r) {
  const ent = {
    x: r.x, y: r.y, z: r.z || 0,
    facing: r.facing || 1,
    spriteSize: 96, w: 64,
    widthScale: (r.record && r.record.widthScale) || 1,
    kind: 'remote',
  };
  ctx.save();
  ctx.globalAlpha = r.dead ? 0.3 : 1;
  drawPiece(ctx, state, ent, r.sprite);
  ctx.restore();
  const sx = r.x - state.cameraX;
  const headY = r.y - 96 - (r.z || 0);
  if (!r.dead && r.hp != null && r.hp < (r.maxHp || 100)) {
    ctx.fillStyle = '#222';
    ctx.fillRect(sx - 18, headY + 6, 36, 4);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(sx - 18, headY + 6, 36 * Math.max(0, r.hp / (r.maxHp || 100)), 4);
  }
  drawNameTag(ctx, sx, headY, r.display, '#c4b5fd');
}

// Floating `[GANG] Username` tag with a dark pill behind it for
// readability over any background.
export function drawNameTag(ctx, sx, sy, label, color = '#fde047') {
  if (!label) return;
  ctx.save();
  ctx.font = 'bold 12px Chivo, sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(sx - tw / 2 - 5, sy - 12, tw + 10, 16);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(label, sx, sy);
  ctx.restore();
}

// ── HUD ───────────────────────────────────────────────────────────────
export function drawHud(ctx, state) {
  const p = state.player;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Top-right: health + sprint + current-weapon **dial**.  Half-circle
  // red HP arc on the outside, half-circle yellow SPRINT arc inside it,
  // and the active weapon glyph in the centre circle.
  drawHealthDial(ctx, p, w);

  // Bottom-left: gang-emblem notoriety meter.  Each level shows the
  // corresponding emblem of the gang currently chasing the player.
  drawGangEmblems(ctx, state);

  // Bottom-right weapon HUD is INTENTIONALLY OMITTED — the radial
  // weapon wheel (rendered in React in WeaponWheel.jsx) covers
  // weapon selection.  Keeps the gameplay screen clean.

  // Top-left: score / kills / cash / ToD.
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Chivo, sans-serif';
  ctx.fillText(`SCORE  ${p.score}`, 16, 24);
  ctx.fillText(`KILLS  ${p.kills}`, 140, 24);
  ctx.fillStyle = '#4ade80';
  ctx.fillText(`$  ${p.cashEarned || 0}`, 250, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(timeLabel(state.timeOfDay), 360, 24);

  // Mission segment indicator.
  const seg = state.mission.segments[state.segIdx];
  if (seg) {
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.fillStyle = '#fde047';
    ctx.fillText(`${state.mission.title} — ${seg.title}`, 16, 44);
  }

  // Co-op lobby status — top-center, only when connected.
  if (state.coop && state.coop.connected) {
    const lobbyName = state.coop.lobby ? state.coop.lobby.name : 'CO-OP';
    ctx.fillStyle = '#c4b5fd';
    ctx.font = 'bold 12px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${lobbyName} — ${state.coop.playerCount()}/12 SAINTS ONLINE`, w / 2, 44);
    ctx.textAlign = 'left';
  }

  // Recent action log — drawn under the top-right health U so it
  // doesn't overlap the HP readout.  The U lintel + pillars take ~85px;
  // start the log below that with extra padding.
  ctx.font = 'bold 12px Chivo, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i < state.log.length; i++) {
    const l = state.log[i];
    const alpha = Math.max(0, 1 - l.t / 4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fde047';
    ctx.fillText(l.msg, w - 16, 130 + i * 20);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  // Squad indicator under the health bar.
  if (p.squad.length) {
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.fillText(`★ SQUAD ${p.squad.length}`, 24, h - 6);
  }

  // Cover-status indicator — across-the-road Jersey barriers.
  if (p.inCover) {
    const label = p.crouching
      ? `LEAN ${p.coverSide < 0 ? '◀' : '▶'} — BLIND-FIRE ½ DMG`
      : `LEAN ${p.coverSide < 0 ? '◀' : '▶'} — PEEK-FIRE 0.7×`;
    const color = p.crouching ? '#22c55e' : '#fde047';
    ctx.fillStyle = color;
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, h - 24);
    ctx.textAlign = 'left';
  }

  if (state.over === 'win') drawCenterText(ctx, 'MISSION COMPLETE', '#22c55e');
  else if (state.over === 'dead') drawCenterText(ctx, 'BUSTED', '#ef4444');
  else if (state.paused) drawCenterText(ctx, 'PAUSED', '#fff');
}

function timeLabel(t) {
  if (t < 0.25) return '🌅 DAWN';
  if (t < 0.5)  return '☀ NOON';
  if (t < 0.7)  return '🌇 DUSK';
  if (t < 0.95) return '🌃 NIGHT';
  return '🌑 LATE NIGHT';
}
function drawCenterText(ctx, text, color) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h/2 - 60, w, 120);
  ctx.fillStyle = color;
  ctx.font = 'bold 56px Chivo, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w/2, h/2 + 18);
  ctx.textAlign = 'left';
}

// ── Top-right: health + sprint + weapon dial ──────────────────────────
// Layout (concentric, opening downward):
//   Outermost half-circle  → red, fills with HP (left → right)
//   Inner half-circle      → yellow, fills with sprint stamina
//   Centre solid circle    → glyph of the currently equipped weapon
//
// The half-circles span 180° from 9-o'clock (left) through 12 (top) to
// 3-o'clock (right), so the readout reads naturally as a "dial".
// Exported — the 3D brawl reuses this exact dial on its HUD overlay.
// Weapon-icon image cache — HTMLImageElements loaded lazily. Used by
// drawHealthDial to render the current gun's silhouette inside the
// dial's core so the HUD reads at a glance instead of showing a
// text label ("PISTOL"/"AK-47"/...).
const _WPN_ICON_PATHS = {
  bat:      '/icons/bat.png',
  pimpslap: '/icons/pimp_slap.png',
  pistol:   '/icons/pistol.png',
  tec9:     '/icons/tec9.png',
  shotgun:  '/icons/shotgun.png',
  ak47:     '/icons/ak47.png',
  rpg:      '/icons/rpg.png',
  pipebomb: '/icons/pipe_bomb.png',
};
const _wpnImgCache = new Map();
function _getWpnIcon(id) {
  const path = _WPN_ICON_PATHS[id];
  if (!path) return null;
  let img = _wpnImgCache.get(id);
  if (!img) {
    img = new Image();
    img.src = path;
    _wpnImgCache.set(id, img);
  }
  return (img.naturalWidth > 0) ? img : null;
}

export function drawHealthDial(ctx, p, w) {
  const ratio = Math.max(0, Math.min(1, p.hp / p.maxHp));
  const sprint = Math.max(0, Math.min(1, (p.sprint != null ? p.sprint / (p.sprintMax || 100) : 1)));
  const cx = w - 70;
  const cy = 78;
  const outerR = 56;
  const innerR = 40;
  const coreR  = 26;
  const startAng = Math.PI;            // 9 o'clock
  const endAng   = 2 * Math.PI;        // 3 o'clock

  // Backdrop half-circle — dark bevel behind the whole rig so it
  // sits crisp on any map. Xbox-360-era: dark base + inner highlight
  // + outer rim.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outerR + 5, startAng, endAng);
  ctx.lineTo(cx + outerR + 5, cy);
  ctx.lineTo(cx - outerR - 5, cy);
  ctx.closePath();
  const backdrop = ctx.createLinearGradient(cx, cy - outerR, cx, cy);
  backdrop.addColorStop(0, 'rgba(10,10,14,0.85)');
  backdrop.addColorStop(1, 'rgba(5,5,10,0.6)');
  ctx.fillStyle = backdrop;
  ctx.fill();
  ctx.restore();

  // HP track — layered strokes give it a beveled 360-era look:
  //   1. dark base groove
  //   2. gradient fill (deep red → bright red at low HP)
  //   3. thin white highlight along the outer edge
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineWidth = outerR - innerR;
  ctx.strokeStyle = 'rgba(40, 6, 6, 0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, (outerR + innerR) / 2, startAng, endAng);
  ctx.stroke();
  // Foreground fill — gradient goes green → yellow → red as HP drops.
  const hpGrad = ctx.createLinearGradient(cx - outerR, cy, cx + outerR, cy);
  const hpTop = ratio > 0.6 ? '#ff4d4d' : ratio > 0.25 ? '#fb923c' : '#f87171';
  const hpBot = ratio > 0.6 ? '#b91c1c' : ratio > 0.25 ? '#c2410c' : '#7f1d1d';
  hpGrad.addColorStop(0, hpBot);
  hpGrad.addColorStop(0.5, hpTop);
  hpGrad.addColorStop(1, hpBot);
  ctx.strokeStyle = hpGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, (outerR + innerR) / 2, startAng, startAng + Math.PI * ratio);
  ctx.stroke();
  // Highlight sheen — thin white arc along the outer edge of the
  // filled area for the "gloss" 360 UIs used.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.arc(cx, cy, outerR - 1, startAng, startAng + Math.PI * ratio);
  ctx.stroke();
  // Low-HP pulse — red glow ring appears when hp drops below 30%.
  if (ratio < 0.3) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + 0.4 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 3, startAng, endAng);
    ctx.stroke();
  }

  // Sprint track — same treatment but yellow.
  ctx.lineWidth = innerR - coreR;
  ctx.strokeStyle = 'rgba(60, 44, 6, 0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, (innerR + coreR) / 2, startAng, endAng);
  ctx.stroke();
  const spGrad = ctx.createLinearGradient(cx - innerR, cy, cx + innerR, cy);
  spGrad.addColorStop(0, '#a16207');
  spGrad.addColorStop(0.5, '#facc15');
  spGrad.addColorStop(1, '#a16207');
  ctx.strokeStyle = spGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, (innerR + coreR) / 2, startAng, startAng + Math.PI * sprint);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR - 2, startAng, startAng + Math.PI * sprint);
  ctx.stroke();
  ctx.restore();

  // Core disc — dark glass with a bright yellow rim.
  const coreGrad = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, coreR);
  coreGrad.addColorStop(0, 'rgba(30, 30, 45, 0.85)');
  coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.stroke();
  // Inner rim highlight
  ctx.strokeStyle = 'rgba(255,240,180,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, coreR - 3, 0, Math.PI * 2); ctx.stroke();

  const activeWpn = p.weapons && p.weapons[p.weaponIdx || 0];
  if (activeWpn) {
    const icon = _getWpnIcon(activeWpn.id);
    if (icon) {
      // Draw the weapon icon centered in the core. Sized to fit the
      // core disc with a small margin.
      const size = coreR * 1.5;
      ctx.drawImage(icon, cx - size / 2, cy - size / 2, size, size);
    } else {
      // Fist / unknown — no icon in the pack, keep the text.
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Chivo, sans-serif';
      ctx.textAlign = 'center';
      const label = activeWpn.name.toUpperCase().replace(/-/g, '').slice(0, 6);
      ctx.fillText(label, cx, cy + 4);
      ctx.textAlign = 'left';
    }
  }

  // HP readout under dial.
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 10px Chivo, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.max(0, Math.round(p.hp))}/${p.maxHp}`, cx, cy + 24);
  ctx.textAlign = 'left';

  // Ammo readout under HP — melee shows ∞, ranged shows mag/reserve,
  // and a reload bar overlays the dial while the player is reloading.
  // Format: "12/30" = 12 in mag, 30 rounds left in reserve. When the
  // reserve hits 0 the player can't reload anymore (no more ammo).
  if (activeWpn) {
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.textAlign = 'center';
    if (activeWpn.magSize == null) {
      ctx.fillStyle = '#fde047';
      ctx.fillText('∞', cx, cy + 42);
    } else {
      const cur = (p.ammo && p.ammo[activeWpn.id] != null) ? p.ammo[activeWpn.id] : activeWpn.magSize;
      const res = (p.reserve && p.reserve[activeWpn.id] != null) ? p.reserve[activeWpn.id] : 0;
      const lowAmmo = cur === 0 && res === 0;
      const reserveLow = res === 0 && cur > 0;
      ctx.fillStyle = lowAmmo ? '#f87171' : (reserveLow ? '#fb923c' : '#fde047');
      ctx.fillText(`${cur}/${res}`, cx, cy + 42);
    }
    ctx.textAlign = 'left';
  }

  // Reloading progress bar — only while p.reloadT > 0.  Drawn as a
  // thin yellow arc fading from start to finish on the inner sprint
  // track, OVER the existing dial.
  if (p.reloadT && p.reloadT > 0 && activeWpn && activeWpn.reloadTime) {
    const prog = 1 - p.reloadT / activeWpn.reloadTime;
    ctx.save();
    ctx.lineWidth = innerR - coreR;
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, (innerR + coreR) / 2, startAng, startAng + Math.PI * prog);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 9px Chivo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RELOADING…', cx, cy - 6);
    ctx.textAlign = 'left';
  }
}

// ── Bottom-left: gang-emblem notoriety meter ──────────────────────────
// One emblem per filled star.  Each emblem grows in size and intensity
// with the level — by ★5 it's a giant red WANTED-style badge.
function drawGangEmblems(ctx, state) {
  const h = ctx.canvas.height;
  const noto = state.notoriety || 0;
  const lvl = Math.floor(noto);
  const x0 = 22;
  const y0 = h - 90;
  ctx.save();

  ctx.font = 'bold 11px Chivo, sans-serif';
  ctx.fillStyle = '#fca5a5';
  ctx.fillText('NOTORIETY', x0, y0 - 8);

  // Draw 5 emblem slots; fill the first `lvl`, faintly outline the rest.
  for (let i = 0; i < 5; i++) {
    const cx = x0 + 18 + i * 36;
    const cy = y0 + 28;
    const filled = i < lvl;
    const isCurrent = !filled && i === lvl;
    drawCarnaleEmblem(ctx, cx, cy, i + 1, filled, isCurrent ? (noto - lvl) : 0);
  }
  // Banner at level 5.
  if (lvl >= 5) {
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 14px Chivo, sans-serif';
    ctx.fillText('WANTED — DEAD', x0, y0 + 64);
  } else if (lvl >= 3) {
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 11px Chivo, sans-serif';
    ctx.fillText('GANG WAR', x0, y0 + 64);
  }
  ctx.restore();
}

// Procedural Los Carnales emblem — a diamond shield with the Carnale
// "LC" sigil.  Scales up + glows brighter with notoriety level.
function drawCarnaleEmblem(ctx, cx, cy, level, filled, fillFrac) {
  // Size grows from r=12 at level 1 to r=22 at level 5.
  const r = 12 + level * 2;
  const fill = filled ? 1 : fillFrac;
  // Background shield (diamond).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = filled ? '#7f1d1d' : 'rgba(40, 8, 8, 0.55)';
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeStyle = filled ? '#fca5a5' : 'rgba(255, 165, 165, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.restore();

  if (fill > 0 && !filled) {
    // Partial fill — overlay an alpha-blended shield over the dim base.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = fill;
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }

  // "LC" sigil inside the diamond — only on filled emblems.
  if (filled) {
    ctx.fillStyle = '#fde047';
    ctx.font = `bold ${Math.round(r * 1.0)}px Chivo, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('LC', cx, cy + r * 0.35);
    ctx.textAlign = 'left';
  }
}

// (drawWeaponSlots removed — radial weapon wheel in WeaponWheel.jsx
// is the single source of truth for weapon selection / display.)
