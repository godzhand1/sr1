// Team Gangsta Brawl — circular minimap (bottom-left).  SR1-style:
// rotates with the camera so "up" is where you're looking, shows the
// building footprints of the current arena, your own arrow at the
// center and TEAMMATES as dots.  Enemies never show — no wallhacks.
export function drawMinimap(ctx, engine, yaw, H) {
  const R = 84;                         // radius in px
  const cx = R + 16, cy = H - R - 16;   // bottom-left corner
  const scale = R / 46;                 // shows ±46 world units around you
  const me = engine.me;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Asphalt-dark base.
  ctx.fillStyle = 'rgba(12, 10, 16, 0.78)';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Rotate so camera-forward is up.
  ctx.translate(cx, cy);
  ctx.rotate(yaw);

  // Building footprints (tall colliders only — skip crates/cars/hedges).
  ctx.fillStyle = 'rgba(168, 164, 178, 0.5)';
  for (const c of engine.colliders) {
    if (c.h < 3) continue;
    const x = (c.x0 - me.x) * scale, z = (c.z0 - me.z) * scale;
    const w = (c.x1 - c.x0) * scale, d = (c.z1 - c.z0) * scale;
    if (x > R + 20 || z > R + 20 || x + w < -R - 20 || z + d < -R - 20) continue;
    ctx.fillRect(x, z, w, d);
  }

  // ── KOTH hill marker ────────────────────────────────────────────
  // Draw a bright ring at the hill's world position, tinted by the
  // current controller (purple/sky/yellow-contested/gray). Pulses
  // radius when contested so it grabs the eye during a fight.
  if (engine.gameMode === 'koth' && engine.hill) {
    const h = engine.hill;
    const hx = (h.x - me.x) * scale;
    const hz = (h.z - me.z) * scale;
    // Only render if within (or close to) the minimap radius.
    if (hx * hx + hz * hz < (R + 40) * (R + 40)) {
      const hillR = Math.max(6, h.radius * scale);
      const now = performance.now();
      const contested = !!h.contested;
      const controller = h.controller;
      const hex = contested ? '#facc15'
        : controller === 'A' ? '#a78bfa'
        : controller === 'B' ? '#38bdf8'
        : '#a1a1aa';
      const pulse = contested ? 1 + Math.sin(now / 130) * 0.15 : 1;
      // Filled translucent disc for capture zone.
      ctx.beginPath();
      ctx.arc(hx, hz, hillR * pulse, 0, Math.PI * 2);
      ctx.fillStyle = hex + '33';                 // ~20% alpha
      ctx.fill();
      // Bright ring outline.
      ctx.beginPath();
      ctx.arc(hx, hz, hillR * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = hex;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Crown icon in the center — three little triangles so it
      // reads at any zoom level.
      ctx.save();
      ctx.translate(hx, hz);
      ctx.fillStyle = hex;
      const cr = Math.min(6, hillR * 0.45);
      ctx.beginPath();
      ctx.moveTo(-cr, cr * 0.35);
      ctx.lineTo(-cr, -cr * 0.15);
      ctx.lineTo(-cr * 0.5, cr * 0.15);
      ctx.lineTo(0, -cr * 0.55);
      ctx.lineTo(cr * 0.5, cr * 0.15);
      ctx.lineTo(cr, -cr * 0.15);
      ctx.lineTo(cr, cr * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Teammates — dots in your team color.  Enemies are NOT drawn.
  const teamHex = me.team === 'A' ? '#c4b5fd' : '#7dd3fc';
  ctx.fillStyle = teamHex;
  const dot = (x, z) => {
    const dx = (x - me.x) * scale, dz = (z - me.z) * scale;
    if (dx * dx + dz * dz > R * R) return;
    ctx.beginPath();
    ctx.arc(dx, dz, 3.2, 0, Math.PI * 2);
    ctx.fill();
  };
  if (engine.coop) {
    for (const rp of engine.coop.remotes.values()) {
      const s = rp.latest;
      if (!s || s.dead || (rp.team || s.team) !== me.team) continue;
      dot(s.x || 0, s.z || 0);
    }
  }
  const bots = engine.isAuthority ? engine.bots.values() : engine.remoteBots.values();
  for (const b of bots) {
    if (b.dead || b.team !== me.team) continue;
    dot(b.x, b.z);
  }

  ctx.restore();

  // Self — white arrow at center, always pointing screen-up.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(yaw - me.yaw);            // show body facing relative to the camera
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.4, 5);
  ctx.lineTo(0, 2.4);
  ctx.lineTo(-4.4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Ring border.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
}
