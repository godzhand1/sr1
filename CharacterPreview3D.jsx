// Character Creator — live 3D preview powered by the same SaintModel
// the 3D brawl uses.  Renders a single SR Saint into its own canvas,
// rotates them slowly so all sides are visible, and rebuilds when the
// `build` object changes.  Uses WebGL2 only (no WebGPU swap) because
// the WebGPU async init makes hot rebuilds laggy in the creator
// flow — the in-game scene still uses WebGPU.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { paletteFromBuild } from '../brawl3d/characterModel3d.js';
import { createSaintModelMeshy } from '../brawl3d/characterMeshy.js';

export default function CharacterPreview3D({ build, size = 280 }) {
  const mountRef = useRef(null);
  const apiRef = useRef(null);

  // ── one-time scene init ──
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
    renderer.setSize(size, size);
    renderer.domElement.style.imageRendering = 'pixelated';
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xccbbdd, 0x554436, 1.6));
    scene.add(new THREE.AmbientLight(0x6b627e, 0.7));
    const sun = new THREE.DirectionalLight(0xffbb77, 1.4);
    sun.position.set(2.5, 3, 1.8);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
    cam.position.set(0, 1.05, 3.2);
    cam.lookAt(0, 1.0, 0);

    // Initial model
    const palette = paletteFromBuild(build);
    let model = createSaintModelMeshy(palette, 'A', '');
    scene.add(model.group);
    model.setHpBar?.(false, 1);
    model.setTagVisible?.(false);
    apiRef.current = { renderer, scene, cam, model };

    let raf = 0; let yaw = -0.5; let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      yaw += dt * 0.35;
      const cur = apiRef.current;
      if (cur && cur.model) {
        cur.model.group.rotation.y = yaw;
        cur.model.animate(now / 1000, { moving: 0, firing: false, crouch: false, deadT: 0, pitch: 0 });
      }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      const cur = apiRef.current;
      if (cur) {
        if (cur.model) cur.model.dispose();
        cur.scene.clear();
        cur.renderer.dispose();
        if (cur.renderer.domElement.parentNode) cur.renderer.domElement.parentNode.removeChild(cur.renderer.domElement);
      }
      apiRef.current = null;
    };
  }, [size]);

  // ── rebuild when build changes ──
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

  return (
    <div
      ref={mountRef}
      data-testid="cc-preview-3d"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 50% 38%, rgba(160,120,200,0.18), rgba(0,0,0,0.65) 65%)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    />
  );
}
