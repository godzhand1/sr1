// Team Gangsta Brawl — large 3D Saint preview with orbit camera.
//
// Built specifically for the 3D character creator (`Brawl3DCharacterCreator`).
// Camera can be orbited with:
//   • Mouse drag (left button)
//   • Gamepad right stick (any pad)
//   • Mouse wheel for zoom
//
// Same SaintModel and skinning pipeline as the in-game brawl, so what
// the player sees here is exactly what spawns in the match.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { paletteFromBuild } from './characterModel3d.js';
import { createSaintModelMeshy } from './characterMeshy.js';

const ORBIT_RADIUS_DEFAULT = 3.4;
const ORBIT_RADIUS_MIN = 1.6;
const ORBIT_RADIUS_MAX = 8.0;
const PITCH_MIN = -0.30;       // can look slightly down at the Saint
const PITCH_MAX =  0.85;       // up toward the ceiling

export default function Brawl3DCharacterPreview({ build, width = 480, height = 600, pose = 'idle' }) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);

  // Persist orbit state across rebuilds so changing an outfit doesn't
  // reset the camera angle the player just dialled in.
  const orbitRef = useRef({ yaw: -0.55, pitch: 0.18, radius: ORBIT_RADIUS_DEFAULT });
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });

  // ── one-time scene init ──
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xccbbdd, 0x554436, 1.6));
    scene.add(new THREE.AmbientLight(0x6b627e, 0.5));
    const sun = new THREE.DirectionalLight(0xffbb77, 1.5);
    sun.position.set(2.5, 3, 1.8);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x80a0ff, 0.6);
    rim.position.set(-2.5, 2.5, -2);
    scene.add(rim);

    // Ground disk so the Saint has a sense of footing.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.7 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    scene.add(ground);
    const groundRing = new THREE.Mesh(
      new THREE.RingGeometry(2.35, 2.45, 64),
      new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.45 })
    );
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = 0.002;
    scene.add(groundRing);

    const cam = new THREE.PerspectiveCamera(38, width / height, 0.05, 80);

    const palette = paletteFromBuild(build);
    const model = createSaintModelMeshy(palette, 'A', '');
    scene.add(model.group);
    // Hide the HP bar + team tag — this is a customization preview, not a
    // combat view.
    model.setHpBar?.(false, 1);
    model.setTagVisible?.(false);

    apiRef.current = { renderer, scene, cam, model, pose };

    // ── input handlers ──
    const dom = renderer.domElement;
    dom.style.touchAction = 'none';
    dom.style.cursor = 'grab';

    const onPointerDown = (e) => {
      dragRef.current.active = true;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      dom.style.cursor = 'grabbing';
      try { dom.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onPointerUp = (e) => {
      dragRef.current.active = false;
      dom.style.cursor = 'grab';
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onPointerMove = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      orbitRef.current.yaw -= dx * 0.008;
      orbitRef.current.pitch = clamp(orbitRef.current.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX);
    };
    const onWheel = (e) => {
      e.preventDefault();
      orbitRef.current.radius = clamp(
        orbitRef.current.radius + (e.deltaY || 0) * 0.0025,
        ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX
      );
    };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointerleave', onPointerUp);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    let last = performance.now();
    const center = new THREE.Vector3(0, 1.0, 0);

    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Gamepad right-stick orbit — axes[2] = X yaw, axes[3] = Y pitch.
      const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const p of pads) {
        if (!p) continue;
        const ax = p.axes[2] || 0;
        const ay = p.axes[3] || 0;
        if (Math.abs(ax) > 0.12 || Math.abs(ay) > 0.12) {
          orbitRef.current.yaw   -= ax * dt * 2.2;
          orbitRef.current.pitch = clamp(orbitRef.current.pitch + ay * dt * 1.6, PITCH_MIN, PITCH_MAX);
        }
        // Triggers / shoulders for zoom in / out.
        const lt = p.buttons[6]?.value || 0;
        const rt = p.buttons[7]?.value || 0;
        if (lt > 0.1 || rt > 0.1) {
          orbitRef.current.radius = clamp(
            orbitRef.current.radius + (lt - rt) * dt * 3.5,
            ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX
          );
        }
        break;
      }

      // Compute orbit camera position.
      const { yaw, pitch, radius } = orbitRef.current;
      const cy = Math.cos(pitch);
      cam.position.x = center.x + Math.sin(yaw) * cy * radius;
      cam.position.z = center.z + Math.cos(yaw) * cy * radius;
      cam.position.y = center.y + Math.sin(pitch) * radius;
      cam.lookAt(center);

      const cur = apiRef.current;
      if (cur && cur.model) {
        const animState = poseAnimationState(cur.pose);
        cur.model.animate(now / 1000, animState);
      }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointerleave', onPointerUp);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('wheel', onWheel);
      const cur = apiRef.current;
      if (cur) {
        if (cur.model) cur.model.dispose();
        cur.scene.clear();
        cur.renderer.dispose();
        if (cur.renderer.domElement.parentNode) cur.renderer.domElement.parentNode.removeChild(cur.renderer.domElement);
      }
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // ── rebuild model when the build changes ──
  useEffect(() => {
    const cur = apiRef.current;
    if (!cur) return;
    if (cur.model) { cur.scene.remove(cur.model.group); cur.model.dispose(); }
    const palette = paletteFromBuild(build);
    const model = createSaintModelMeshy(palette, 'A', '');
    cur.scene.add(model.group);
    model.setHpBar?.(false, 1);
    model.setTagVisible?.(false);
    cur.model = model;
  }, [build]);

  // ── apply pose changes (forwarded to animation state each frame) ──
  useEffect(() => {
    const cur = apiRef.current;
    if (cur) cur.pose = pose;
  }, [pose]);

  return (
    <div
      ref={mountRef}
      data-testid="brawl3d-cc-preview"
      style={{
        width,
        height,
        background: 'radial-gradient(circle at 50% 38%, rgba(160,120,200,0.20), rgba(0,0,0,0.85) 70%)',
        borderRadius: 10,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 8, left: 0, right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 10, letterSpacing: 1.5, fontWeight: 700,
          pointerEvents: 'none',
        }}
      >
        DRAG TO ORBIT · WHEEL TO ZOOM · STICK / TRIGGERS ON GAMEPAD
      </div>
    </div>
  );
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Translate pose IDs from the creator UI into animate() state.
function poseAnimationState(pose) {
  const base = { moving: 0, firing: false, crouch: false, deadT: 0, pitch: 0 };
  switch (pose) {
    case 'idle':         return base;
    case 'walk':         return { ...base, moving: 0.6 };
    case 'sprint':       return { ...base, moving: 1.0, sprinting: true };
    case 'crouch':       return { ...base, crouch: true };
    case 'fire':         return { ...base, firing: true };
    case 'crouch_fire':  return { ...base, firing: true, crouch: true };
    default:             return base;
  }
}
