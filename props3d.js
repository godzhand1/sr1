// Team Gangsta Brawl — realistic prop library.
//
// Replaces the placeholder cubes/crates that used to litter the arena
// with a mix of urban street props (dumpsters, mailboxes, phone
// booths, trash cans, newspaper boxes, generators) and arcade props
// (arcade cabinets, vending machines) — each built from a small group
// of primitive meshes so the silhouette reads as a real object at a
// glance.
//
// Every builder returns a THREE.Group positioned at (x, 0, z) with
// facing yaw `rot`. Registers a matching AABB collider in the passed
// colliders array so bullets and movement respect the prop.

import * as THREE from 'three';
import { pbr } from './pbrMaterials.js';

const L = (c) => pbr.plastic({ color: c, roughness: 0.6 });

// ── Dumpster ────────────────────────────────────────────────────────
// Big green skip — 2.2m wide, 1.4m tall, 1.4m deep.
export function makeDumpster({ x, z, rot = 0, colliders }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.4), L(0x2f5a3a));
  body.position.y = 0.6;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, 1.5), L(0x24402a));
  lid.position.y = 1.24;
  const front = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.08, 0.05), L(0x141a10));
  front.position.set(0, 0.85, 0.71);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.14, 0.02), L(0xdcc22a));
  stripe.position.set(0, 0.6, 0.72);
  // Wheels
  for (const wx of [-0.9, 0.9]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 8), L(0x111114));
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.14, 0.68);
    g.add(w);
  }
  body.castShadow = body.receiveShadow = true;
  g.add(body, lid, front, stripe);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 1.1, z0: z - 0.7, x1: x + 1.1, z1: z + 0.7, h: 1.3, climbable: true,
  });
  return g;
}

// ── Vending Machine ─────────────────────────────────────────────────
// 0.9 × 1.9 × 0.7, red or blue body with lit display strip.
export function makeVending({ x, z, rot = 0, colliders, color = 0xb91c1c }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.7), L(color));
  body.position.y = 0.95;
  const window = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.9),
    new THREE.MeshBasicMaterial({ color: 0x1a1d24, toneMapped: false }),
  );
  window.position.set(0, 1.25, 0.36);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false }),
  );
  glow.position.set(0, 1.72, 0.36);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.06), L(0x111114));
  slot.position.set(0, 0.35, 0.36);
  body.castShadow = body.receiveShadow = true;
  g.add(body, window, glow, slot);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.45, z0: z - 0.35, x1: x + 0.45, z1: z + 0.35, h: 1.9,
  });
  return g;
}

// ── Arcade Cabinet ──────────────────────────────────────────────────
// Retro upright: sloped screen, joystick + buttons panel, neon marquee.
export function makeArcade({ x, z, rot = 0, colliders, screenColor = 0xff2a8a }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.72), L(0x14141a));
  body.position.y = 0.85;
  // Marquee (top glowing strip)
  const marquee = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.28, 0.5),
    new THREE.MeshBasicMaterial({ color: screenColor, toneMapped: false }),
  );
  marquee.position.set(0, 1.62, 0.11);
  // Screen (slightly recessed)
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x101820, toneMapped: false }),
  );
  screen.position.set(0, 1.24, 0.35);
  screen.rotation.x = -0.12;
  const scanLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x60c0ff, toneMapped: false, transparent: true, opacity: 0.85 }),
  );
  scanLine.position.set(0, 1.28, 0.36);
  scanLine.rotation.x = -0.12;
  // Control panel (sloped)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.34), L(0x22222a));
  panel.position.set(0, 0.86, 0.32);
  panel.rotation.x = -0.35;
  // Joystick ball
  const joy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), L(0xd40000));
  joy.position.set(-0.16, 0.94, 0.30);
  // Buttons
  const btnMat = [0xffd033, 0x60c0ff, 0xff5aa0, 0x66e070];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), L(btnMat[i]));
    b.position.set(0.06 + i * 0.06, 0.92, 0.28);
    b.rotation.x = -0.35;
    g.add(b);
  }
  body.castShadow = body.receiveShadow = true;
  g.add(body, marquee, screen, scanLine, panel, joy);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.4, z0: z - 0.36, x1: x + 0.4, z1: z + 0.36, h: 1.75,
  });
  return g;
}

// ── Phone Booth ─────────────────────────────────────────────────────
// Red steel frame + tinted glass panels + top sign, ~1 × 2.4m.
export function makePhoneBooth({ x, z, rot = 0, colliders }) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.9), L(0xa01c1c));
  frame.position.y = 1.05;
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 1.9, 0.78),
    new THREE.MeshBasicMaterial({ color: 0x0a1420, toneMapped: false, transparent: true, opacity: 0.72 }),
  );
  inner.position.y = 1.05;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.28, 0.92),
    new THREE.MeshBasicMaterial({ color: 0xf0e070, toneMapped: false }),
  );
  sign.position.y = 2.24;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.98), L(0x681010));
  roof.position.y = 2.42;
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.1), L(0x101014));
  phone.position.set(-0.22, 1.35, 0.34);
  frame.castShadow = frame.receiveShadow = true;
  g.add(frame, inner, sign, roof, phone);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.5, z0: z - 0.5, x1: x + 0.5, z1: z + 0.5, h: 2.5,
  });
  return g;
}

// ── Mailbox (USPS blue) ─────────────────────────────────────────────
export function makeMailbox({ x, z, rot = 0, colliders }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.5), L(0x1e3f80));
  body.position.y = 0.55;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.62, 12, 1, false, 0, Math.PI), L(0x1e3f80));
  top.rotation.z = Math.PI / 2;
  top.position.set(0, 0.97, 0);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), L(0x0a1220));
  slot.position.set(0, 0.85, 0.26);
  // Legs
  for (const lx of [-0.24, 0.24]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.04), L(0x141a24));
    leg.position.set(lx, 0.075, 0);
    g.add(leg);
  }
  body.castShadow = body.receiveShadow = true;
  g.add(body, top, slot);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.32, z0: z - 0.28, x1: x + 0.32, z1: z + 0.28, h: 1.15,
  });
  return g;
}

// ── Trash Can (metal cylinder w/ lid) ───────────────────────────────
export function makeTrashCan({ x, z, colliders }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12), L(0x4a4a54));
  body.position.y = 0.45;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12), L(0x2a2a34));
  lid.position.y = 0.93;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 6, 16), L(0x1a1a20));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.9;
  body.castShadow = body.receiveShadow = true;
  g.add(body, lid, rim);
  g.position.set(x, 0, z);
  colliders.push({
    x0: x - 0.35, z0: z - 0.35, x1: x + 0.35, z1: z + 0.35, h: 0.95,
  });
  return g;
}

// ── Generator / Junction Box ────────────────────────────────────────
export function makeGenerator({ x, z, rot = 0, colliders }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.7), L(0xffe040));
  body.position.y = 0.5;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.1, 0.72), L(0x141014));
  stripe.position.y = 0.9;
  const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.1, 0.72), L(0x141014));
  stripe2.position.y = 0.14;
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.02), L(0x1e1e24));
  vent.position.set(0, 0.5, 0.36);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), L(0xf0f0f0));
  dial.rotation.x = Math.PI / 2;
  dial.position.set(-0.35, 0.65, 0.36);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), L(0x2a2a2e));
  pipe.position.set(0.42, 1.3, 0);
  body.castShadow = body.receiveShadow = true;
  g.add(body, stripe, stripe2, vent, dial, pipe);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.6, z0: z - 0.35, x1: x + 0.6, z1: z + 0.35, h: 1.0,
  });
  return g;
}

// ── Newspaper Box ───────────────────────────────────────────────────
export function makeNewsBox({ x, z, rot = 0, colliders, color = 0x2a2a34 }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), L(color));
  body.position.y = 0.6;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xf0f0e8, toneMapped: false }),
  );
  glass.position.set(0, 0.85, 0.21);
  const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.04), L(0x141416));
  leg1.position.set(-0.2, 0.075, 0);
  const leg2 = leg1.clone(); leg2.position.x = 0.2;
  body.castShadow = body.receiveShadow = true;
  g.add(body, glass, leg1, leg2);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  colliders.push({
    x0: x - 0.28, z0: z - 0.25, x1: x + 0.28, z1: z + 0.25, h: 1.15,
  });
  return g;
}

// ── Parked Car (low-poly Saints Row-ish sedan silhouette) ───────────
// Boxy body, roof, wheels, headlights. Solid collider so players can
// use it as cover.
export function makeParkedCar({ x, z, rot = 0, colliders, bodyCol = 0x263a5a, roofCol = 0x1a1c22 }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.9, 1.9), L(bodyCol));
  body.position.y = 0.55;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.7), L(roofCol));
  roof.position.set(-0.1, 1.35, 0);
  // Windows (dark tinted)
  const winMat = new THREE.MeshBasicMaterial({ color: 0x0a1420, toneMapped: false, transparent: true, opacity: 0.85 });
  const winF = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), winMat);
  winF.position.set(1.15, 1.35, 0);
  winF.rotation.y = Math.PI / 2;
  const winR = winF.clone();
  winR.position.set(-1.4, 1.35, 0);
  winR.rotation.y = -Math.PI / 2;
  // Head/tail lights
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false });
  const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
  const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.32), hlMat);
  hlL.position.set(2.22, 0.55, -0.6);
  const hlR = hlL.clone(); hlR.position.z = 0.6;
  const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.32), tlMat);
  tlL.position.set(-2.22, 0.55, -0.6);
  const tlR = tlL.clone(); tlR.position.z = 0.6;
  // Wheels
  const wheelMat = L(0x0a0a0e);
  for (const wx of [-1.4, 1.5]) {
    for (const wz of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12), wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.32, wz);
      g.add(w);
    }
  }
  body.castShadow = body.receiveShadow = true;
  roof.castShadow = roof.receiveShadow = true;
  g.add(body, roof, winF, winR, hlL, hlR, tlL, tlR);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  // Rotate-aware collider. For 90° / 270° swap X/Z half-extents.
  const halfW = 2.2, halfD = 0.95;
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const cx0 = halfW * c + halfD * s;
  const cz0 = halfW * s + halfD * c;
  colliders.push({
    x0: x - cx0, z0: z - cz0, x1: x + cx0, z1: z + cz0, h: 1.7, climbable: true,
  });
  return g;
}

// ── Sandbag Stack ───────────────────────────────────────────────────
// Row of sandbags used as low cover. Colliders per bag not needed
// since the row is a single low wall.
export function makeSandbags({ x, z, rot = 0, colliders, len = 3 }) {
  const g = new THREE.Group();
  const bagW = 0.7, bagH = 0.28, bagD = 0.4;
  for (let row = 0; row < 2; row++) {
    const rowOffset = row * (bagW / 2);
    for (let i = 0; i < len; i++) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(bagW - 0.05, bagH, bagD), L(row === 0 ? 0x8a7148 : 0x76603e));
      bag.position.set(-((len - 1) * bagW) / 2 + i * bagW + rowOffset, 0.14 + row * bagH, 0);
      bag.castShadow = bag.receiveShadow = true;
      g.add(bag);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const wallLen = len * bagW;
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  colliders.push({
    x0: x - (wallLen / 2) * c - (bagD / 2) * s,
    z0: z - (wallLen / 2) * s - (bagD / 2) * c,
    x1: x + (wallLen / 2) * c + (bagD / 2) * s,
    z1: z + (wallLen / 2) * s + (bagD / 2) * c,
    h: 0.56, climbable: true,
  });
  return g;
}
