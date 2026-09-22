// Team Gangsta Brawl — visual sync layer.  Keeps Three.js meshes in
// step with the engine's pure data: actor models, tracers, rocket
// projectiles, impact flashes, ragdolls.
import * as THREE from 'three';
import { createSaintModel, paletteFromBuild, randomBotPalette, gunProp } from './characterModel3d.js';
import { WEAPONS3D } from './weapons3d.js';
import { createSaintModelMeshy } from './characterMeshy.js';
import { Ragdoll } from './ragdoll.js';
import { fetchAllOverrides, getOverride, applyTuneToRig, derivePoseId } from './poseOverrides.js';
import { preloadPipeBomb, clonePipeBombMesh } from './pipeBombModel.js';
import { wallFacesNearBlast, normalFromDir } from './render/surfaces.js';
import { playSurfaceHitAt, playShellClatterAt } from '../streetfight/sounds.js';
import { topAt } from './engine3d.js';

// ──────────────────────────────────────────────────────────────────
// CHARACTER RIG MODE
// ──────────────────────────────────────────────────────────────────
// AAA replacement: swap the rigid OBJ character (with layered clothing
// / hair / glasses / facial hair overlays) for a properly-rigged
// Meshy AI Dynamic Warrior GLB (24-joint humanoid, PBR skin material).
// All clothing is DISABLED in this mode — the mesh is authored with
// its own outfit painted directly onto the SkinnedMesh material.
// Toggle by setting window.__brawl3dMeshy = false before the first
// character spawn (defaults to true in this build).
const USE_MESHY = (typeof window === 'undefined' || window.__brawl3dMeshy !== false);
const createChar = USE_MESHY ? createSaintModelMeshy : createSaintModel;

const MAX_TRACER_VERTS = 256;

// Weapon-id lookup — engine tracks weapon via numeric slot index but
// the pose overrides key by string id. The array order must match
// weapons3d.js WEAPONS3D.
const WPN_IDS = ['fist','bat','pimpslap','pistol','tec9','shotgun','ak47','rpg','pipebomb'];

// Apply the saved pose override (if any) for `f` on top of animate().
// This is split into two calls — pre() BEFORE animate() and post()
// AFTER — because the standard `animate()` in characterModel3d LERPS
// gun.rotation / gunMount.position toward hardcoded per-weapon
// targets every frame. If the previous frame's override is still
// applied when animate() runs, animate's LERP silently pulls the
// override AWAY (converging over frames toward the clean baseline),
// so weapon poses tuned in the PoseLab drift out of place mid-match.
//
// Correct order per frame:
//   1. pre  — undo last frame's override so animate() sees the clean
//      baseline it expects.
//   2. animate() runs on the clean baseline.
//   3. post — apply this frame's override on top of the freshly-
//      computed clean values.
function applyPoseOverridePre(rec, api) {
  const rig = api.getRig?.();
  if (!rig) return;
  if (rec.__lastPoseTune) {
    // Undo everything EXCEPT crouchDepth — `drive()` unconditionally
    // clobbers `group.position.y` at the top of every actor frame
    // (`g.position.set(actor.x, actor.y, actor.z)`), so the crouch
    // drop from the previous frame has already been zeroed out.
    // Subtracting it again would push the Saint UP by that amount,
    // producing the "crouch character floats in the air with AK47"
    // bug — the net position across undo→animate→apply canceled to
    // exactly `actor.y` regardless of the saved crouchDepth value.
    // Zero it before the undo pass so the depth flows through
    // apply-only, matching what drive() already implicitly resets.
    //
    // ALSO strip the `gun*` fields from the undo when the weapon
    // mesh has changed since we applied the tune (setWeapon() swaps
    // the mesh mid-frame). `rig.gun` now points at a FRESH mesh
    // that never had the previous tune applied — undoing on it
    // would bake a negative pistol/shotgun/etc. offset into the
    // new weapon and desync every future frame. The old mesh has
    // already been disposed by setWeapon(), so no cleanup is
    // needed there either.
    const gunMeshChanged = rig.gun !== rec.__lastGunMesh;
    const tuneWithoutDepth = gunMeshChanged
      ? { ...rec.__lastPoseTune,
          crouchDepth: 0,
          gunPX: 0, gunPY: 0, gunPZ: 0,
          gunRX: 0, gunRY: 0, gunRZ: 0,
          gripDepth: 0 }
      : { ...rec.__lastPoseTune, crouchDepth: 0 };
    applyTuneToRig(rig, tuneWithoutDepth, -1);
    rec.__lastPoseTune = null;
    rec.__lastGunMesh = null;
  }
}

function applyPoseOverridePost(rec, api, f, wpnIdx) {
  const rig = api.getRig?.();
  if (!rig) return;
  const pose = derivePoseId(f);
  const wpnId = WPN_IDS[wpnIdx | 0] || 'pistol';
  const tune = getOverride(pose, wpnId);
  if (tune) {
    applyTuneToRig(rig, tune, +1);
    rec.__lastPoseTune = tune;
    // Track WHICH weapon mesh we applied to — the pre-undo pass
    // next frame will skip `gun*` fields if this mesh has been
    // swapped out in the meantime (see applyPoseOverridePre).
    rec.__lastGunMesh = rig.gun;
    // Re-solve the arm IK on top of the tuned gun offsets so the
    // hands stay glued to the grip / foregrip.
    if (api.postPose) api.postPose();
  }
  // AUTO FOOT-PLANT — after all pose overrides + animate() have
  // laid down the frame, measure the LOWEST foot bone's world Y and
  // shift the group so that foot lands at world Y = actor.y. This
  // makes any leg pose (crouch, kneel, deep squat, PoseLab-tuned
  // knee bend) automatically ground-plant without the user having
  // to hand-tune `crouchDepth` per (pose, weapon) combo.
  //
  // Only runs on GROUNDED, non-ragdoll actors — mid-air or dead
  // characters shouldn't have their feet snapped to the ground.
  const g = rig.body;
  if (!g || rec.ragdoll) return;
  const actor = rec.__actor;
  if (!actor) return;
  // Only auto-plant on GROUNDED actors — mid-air (jumping/falling)
  // characters shouldn't have their feet snapped down. `onGround`
  // defaults to true when the source doesn't provide it (bots).
  const onGround = actor.onGround === undefined ? true : !!actor.onGround;
  if (!onGround) return;
  const targetY = (actor.y || 0);
  const lowestFoot = rig.getLowestFootY?.();
  if (Number.isFinite(lowestFoot)) {
    // The foot's current world Y should equal targetY for it to be
    // touching the ground. Shift the group by the difference.
    const drop = lowestFoot - targetY;
    if (Math.abs(drop) > 0.005) g.position.y -= drop;
  }
}

export class View3D {
  constructor(scene, { vfx = null } = {}) {
    // Blender-textured VFX (muzzle flashes, explosions, RPG trail). When
    // present it replaces the canvas-sprite flash / orange-sphere blast.
    this.vfx = vfx;
    this.scene = scene;
    this.models = new Map();           // actorId -> {api, wpn, ragdoll, dt}
    this._lastT = 0;
    // Preload pose overrides once — non-blocking. Every character
    // built from now on applies the saved delta for its live pose
    // after animate() runs. Fires and forgets; retries never happen
    // (the module caches internally).
    fetchAllOverrides();
    // ── Bullet-tracer pool ──
    // Previously: a single LineSegments drawing the entire ax→bx line
    // as a solid beam every frame → "line laser" look. Replaced with
    // a moving 1.4m streak that travels along the shot line, plus a
    // muzzle-flash billboard at the origin and an impact spark burst
    // at the terminus. Way more realistic for a 2000s-era shooter.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACER_VERTS * 3), 3));
    // Vertex colors let per-tracer alpha fade cleanly (LineSegments
    // materials don't support per-vertex opacity without vertexColors).
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRACER_VERTS * 3), 3));
    this.tracerLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);

    // ── Muzzle-flash pool (billboards at the shot origin) ──
    // Additive-blended orange sprite drawn on a shared canvas texture.
    // Shows for the first ~60ms of each tracer's life.
    const flashCanvas = document.createElement('canvas'); flashCanvas.width = 128; flashCanvas.height = 128;
    {
      const g = flashCanvas.getContext('2d');
      // Bright yellow core → orange → transparent radial gradient.
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0.00, 'rgba(255, 255, 220, 1)');
      grad.addColorStop(0.25, 'rgba(255, 200, 80, 0.9)');
      grad.addColorStop(0.55, 'rgba(255, 120, 30, 0.55)');
      grad.addColorStop(1.00, 'rgba(255,  40,  0, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    const flashTex = new THREE.CanvasTexture(flashCanvas);
    flashTex.colorSpace = THREE.SRGBColorSpace;
    this._flashTex = flashTex;
    this.muzzleFlashPool = [];
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, transparent: true,
      }));
      sp.visible = false;
      scene.add(sp);
      this.muzzleFlashPool.push({ sp, t: 0, seed: 0 });
    }

    // ── Impact spark pool ──
    // Small additive sphere at the hit point, plus a burst of tiny
    // billboards flying outward for a puff of dust/sparks. Gives
    // hitscan hits a satisfying visual kick beyond the old sphere.
    this.impactPool = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.visible = false;
      scene.add(m);
      this.impactPool.push(m);
    }
    // Impact-spark billboards — 6 tiny sparks per hit, pooled.
    this.sparkPool = [];
    for (let i = 0; i < 72; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, color: 0xffdd88,
      }));
      sp.visible = false;
      sp.scale.set(0.14, 0.14, 1);
      scene.add(sp);
      this.sparkPool.push({ sp, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, kind: 'wall' });
    }

    // ── BLOOD DROPLET DECALS ─────────────────────────────────
    // Persistent circular dark-red splats on the ground where
    // actors have been hit or are bleeding out. Rendered as flat
    // PlaneGeometry disks (not sprites — sprites are always facing
    // camera, decals should stay flat). Pool of 64 slots; oldest
    // gets recycled when saturated.
    const bloodCanvas = document.createElement('canvas');
    bloodCanvas.width = 128; bloodCanvas.height = 128;
    {
      const g = bloodCanvas.getContext('2d');
      // Irregular splat — deep red inner, softer edges. Blends into
      // dirt/concrete without looking painted.
      const grad = g.createRadialGradient(64, 64, 6, 64, 64, 60);
      grad.addColorStop(0.00, 'rgba(120, 8, 8, 1)');
      grad.addColorStop(0.55, 'rgba(80, 4, 4, 0.85)');
      grad.addColorStop(1.00, 'rgba(60, 0, 0, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      // Scatter a few darker drops around the center for irregularity.
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 25 + Math.random() * 30;
        const dx = 64 + Math.cos(a) * r;
        const dy = 64 + Math.sin(a) * r;
        const rr = 3 + Math.random() * 5;
        const gg = g.createRadialGradient(dx, dy, 0, dx, dy, rr);
        gg.addColorStop(0, 'rgba(70,4,4,0.85)');
        gg.addColorStop(1, 'rgba(60,0,0,0)');
        g.fillStyle = gg;
        g.fillRect(dx - rr, dy - rr, rr * 2, rr * 2);
      }
    }
    const bloodTex = new THREE.CanvasTexture(bloodCanvas);
    bloodTex.colorSpace = THREE.SRGBColorSpace;
    this.bloodPool = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.6),
        new THREE.MeshBasicMaterial({
          map: bloodTex, transparent: true, opacity: 0,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;                              // just above ground plane
      m.visible = false;
      scene.add(m);
      this.bloodPool.push({ m, life: 0, maxLife: 8 });
    }
    this._bloodCursor = 0;

    // ── SHELL CASINGS ────────────────────────────────────────
    // A small yellow-brass cylinder ejects sideways from the weapon
    // on each hitscan fire (pistol/tec9/ak47). Arcs down under
    // gravity, tumbles, fades. Pool of 32 slots recycled LRU.
    const shellGeom = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 6);
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xd4b060, metalness: 0.7, roughness: 0.35, emissive: 0x2a1e08,
    });
    this.shellPool = [];
    for (let i = 0; i < 32; i++) {
      const m = new THREE.Mesh(shellGeom, shellMat.clone());
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.shellPool.push({ m, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, life: 0 });
    }
    this._shellCursor = 0;

    // ── MUZZLE SMOKE PUFFS ───────────────────────────────────
    // Grey wisp that lingers ~350ms after the flash, especially
    // for shotgun and RPG. Additive-multiply blended so it darkens
    // the flash while it dissipates.
    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = 64; smokeCanvas.height = 64;
    {
      const g = smokeCanvas.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 3, 32, 32, 30);
      grad.addColorStop(0.0, 'rgba(230,225,220,0.85)');
      grad.addColorStop(0.6, 'rgba(120,115,110,0.35)');
      grad.addColorStop(1.0, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    const smokeTex = new THREE.CanvasTexture(smokeCanvas);
    smokeTex.colorSpace = THREE.SRGBColorSpace;
    this.smokePool = [];
    for (let i = 0; i < 20; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.NormalBlending,
      }));
      sp.visible = false;
      scene.add(sp);
      this.smokePool.push({ sp, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.6 });
    }
    // Set of tracer identity hashes we've already seen so muzzle flash
    // fires exactly ONCE per shot (subsequent frames advance the
    // streak but don't retrigger the flash).
    this._seenTracers = new Set();

    // Rocket pool. Each entry is a Group; may contain either the
    // procedural rocket cylinder + flame OR a cloned pipe-bomb GLB
    // + spark trail sprites (see `_rocketMesh`).
    this.rocketPool = [];
    // Kick off the pipe bomb GLB fetch as early as possible — even
    // before the first bomb is thrown — so it's in-cache by the time
    // a player uses one. The template is 30MB but fetches in ~1-2s
    // over a broadband link. During the fetch, in-flight bombs
    // render with the procedural cylinder fallback (still readable).
    preloadPipeBomb();
    // Pre-build the rocket pool so its trail Points / body materials
    // compile during the pre-match warm-up instead of on the first shot.
    for (let i = 0; i < 3; i++) this._rocketMesh(i, 'rpg').visible = false;
    // The pipe-bomb GLB rides along in the (hidden) rocket pool as soon as
    // its template lands, so its materials compile at warm-up — not on
    // the first throw.
    preloadPipeBomb().then(() => { if (!this._disposed && this.rocketPool[0]) this._rocketMesh(0, 'pipebomb'); }).catch(() => {});
    // ── Arsenal ─ one hidden copy of EVERY weapon model (procedural
    // placeholders now, SR OBJ swaps as they load). The warm-up reveals
    // the group and draws it once, so equipping any weapon mid-fight
    // never compiles a shader.
    this.arsenal = new THREE.Group();
    this.arsenal.name = 'prewarmArsenal';
    this.arsenal.visible = false;
    this.arsenal.position.y = -500;
    for (const w of WEAPONS3D) {
      try { const p = gunProp(w.id); if (p) { p.name = `arsenal_${w.id}`; this.arsenal.add(p); } } catch { /* melee ids have no prop */ }
    }
    scene.add(this.arsenal);
    // Melee impact ring pool — pre-seed two so the material compiles at
    // warm-up (the sync loop grows it lazily on demand).
    this._meleeRingPool = [];
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.32, 24),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.renderOrder = 3; ring.visible = false;
      this.scene.add(ring);
      this._meleeRingPool.push(ring);
    }
  }

  _model(id, build, team, label, botSeed) {
    let rec = this.models.get(id);
    if (rec && rec.team === team && rec.label === label) return rec;
    if (rec) {
      this.scene.remove(rec.api.group);
      if (rec.teamArrow) { rec.api.group.remove(rec.teamArrow); }
      rec.api.dispose();
    }
    const palette = build ? paletteFromBuild(build) : randomBotPalette(botSeed || 1);
    const api = createChar(palette, team, label);
    this.scene.add(api.group);
    rec = { api, team, label, teamArrow: null };
    this.models.set(id, rec);
    return rec;
  }

  // Lazily attach the "teammate" downward-arrow sprite above the
  // saint's head. TWO textures — green for players who came from
  // your source lobby (partied up with you), team-color for random
  // matched teammates. Both are shared across every instance so
  // we're not allocating a canvas per player.
  _ensureTeamArrow(rec, variant) {
    // Rebuild if the variant changed (green ↔ team color).
    if (rec.teamArrow && rec._arrowVariant === variant) return rec.teamArrow;
    if (rec.teamArrow) {
      rec.api.group.remove(rec.teamArrow);
      rec.teamArrow = null;
    }
    if (!View3D._arrowTexCache) View3D._arrowTexCache = new Map();
    const cache = View3D._arrowTexCache;
    // Variant → color hex (canvas fill).
    const fill =
        variant === 'party' ? '#22e37a'       // green — my crew
      : variant === 'teamA' ? '#a78bfa'       // Saints purple
      : variant === 'teamB' ? '#38bdf8'       // Rollerz sky
      :                       '#22e37a';
    let tex = cache.get(variant);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      g.beginPath();
      g.moveTo(16, 28); g.lineTo(112, 28); g.lineTo(64, 108); g.closePath();
      g.fillStyle = fill;
      g.strokeStyle = '#052617';
      g.lineWidth = 12;
      g.stroke();
      g.fill();
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      cache.set(variant, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, depthTest: false, transparent: true,
    }));
    sp.scale.set(0.38, 0.38, 1);
    sp.position.y = 2.85;
    sp.renderOrder = 1000;
    rec.api.group.add(sp);
    rec.teamArrow = sp;
    rec._arrowVariant = variant;
    return sp;
  }

  _rocketMesh(i, wpnId) {
    if (!this.rocketPool[i]) {
      const g = new THREE.Group();
      // Default procedural rocket — used for RPG rounds AND as the
      // pipe-bomb fallback while the GLB is still fetching.
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
      body.rotation.x = Math.PI / 2;
      body.name = '_proceduralBody';
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xff8020 }));
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -0.5;
      flame.name = '_proceduralFlame';
      g.add(body, flame);
      // Spark trail — 6 emissive orange points. We reuse THREE.Points
      // rather than dozens of tiny meshes so the trail stays cheap
      // even with many bombs in flight. `positions` is written per
      // frame in the render loop.
      const sparkGeom = new THREE.BufferGeometry();
      const positions = new Float32Array(6 * 3);
      sparkGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const sparkMat = new THREE.PointsMaterial({
        color: 0xffb040,
        size: 0.14,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const sparks = new THREE.Points(sparkGeom, sparkMat);
      sparks.name = '_sparkTrail';
      sparks.visible = false;
      g.add(sparks);
      // (Pop light lives in VfxSystem.pulse — a per-rocket PointLight
      // would change the scene's light count → shader recompile.)
      this.scene.add(g);
      this.rocketPool[i] = g;
    }
    const g = this.rocketPool[i];
    // Lazy swap-in of the GLB pipe-bomb mesh once the template is
    // loaded. We keep the procedural body around as a fallback but
    // hide it once the GLB is attached.
    if (wpnId === 'pipebomb' && !g.userData.pipeBombLoaded) {
      const glb = clonePipeBombMesh();
      if (glb) {
        glb.name = '_pipeBombGLB';
        g.add(glb);
        // Hide the placeholder body + flame (retain them in the
        // hierarchy so we don't allocate on toggle).
        const body = g.getObjectByName('_proceduralBody');
        const flame = g.getObjectByName('_proceduralFlame');
        if (body) body.visible = false;
        if (flame) flame.visible = false;
        g.userData.pipeBombLoaded = true;
      }
    }
    // Restore procedural visibility if this pool slot is reused for
    // a non-pipe-bomb weapon (RPG round after a pipe bomb).
    if (wpnId !== 'pipebomb' && g.userData.pipeBombLoaded) {
      const body = g.getObjectByName('_proceduralBody');
      const flame = g.getObjectByName('_proceduralFlame');
      if (body) body.visible = true;
      if (flame) flame.visible = true;
      const glb = g.getObjectByName('_pipeBombGLB');
      if (glb) glb.visible = false;
    } else if (wpnId === 'pipebomb') {
      const glb = g.getObjectByName('_pipeBombGLB');
      if (glb) glb.visible = true;
    }
    return g;
  }

  // Muzzle flash — pop a billboard at the shot origin, slightly
  // offset forward along the bullet direction so it sits at the tip
  // of the barrel rather than inside the character's hand. Adds
  // random rotation seed so consecutive shots don't produce a static
  // frozen shape. Scale + color adapt per weapon so a shotgun blast
  // reads massive-orange while a pistol crack reads small-white.
  _spawnMuzzleFlash(x, y, z, ux, uy, uz, wpn) {
    if (this.vfx && this.vfx.ready) {
      // Photo-real per-weapon flash + smoke + light pop (render/vfx.js).
      this.vfx.muzzleFlash(x, y, z, ux, uy, uz, wpn);
      if (wpn === 'pistol' || wpn === 'tec9' || wpn === 'ak47_auto' || wpn === 'ak47' || wpn === 'shotgun') {
        this._spawnShell(x, y, z, ux, uy, uz, wpn);
      }
      return;
    }
    const slot = this.muzzleFlashPool.find(s => !s.sp.visible)
      || this.muzzleFlashPool[Math.floor(Math.random() * this.muzzleFlashPool.length)];
    slot.sp.position.set(x + ux * 0.2, y + uy * 0.2, z + uz * 0.2);
    slot.sp.material.rotation = Math.random() * Math.PI;
    slot.seed = Math.random() * 6.28;
    // Per-weapon dimensions + color. Default (pistol/tec9) is the
    // small crisp flash we've always had.
    let s = 0.6, life = 0.06, tint = 0xffffff, smoke = 0;
    if (wpn === 'shotgun') { s = 1.35; life = 0.09; tint = 0xffb050; smoke = 0.9; }
    else if (wpn === 'ak47_auto' || wpn === 'ak47') { s = 0.85; life = 0.05; tint = 0xfff090; smoke = 0.2; }
    else if (wpn === 'rpg') { s = 1.9; life = 0.15; tint = 0xff8030; smoke = 1.5; }
    else if (wpn === 'tec9') { s = 0.55; life = 0.045; tint = 0xffffcc; smoke = 0.1; }
    else if (wpn === 'pistol') { s = 0.55; life = 0.05; tint = 0xffffee; smoke = 0.1; }
    slot.sp.scale.set(s, s, 1);
    slot.sp.material.opacity = 1.0;
    slot.sp.material.color.setHex(tint);
    slot.sp.visible = true;
    slot.t = life;
    slot.life0 = life;
    // Puff smoke for heavier weapons — layered directly on top of the
    // flash origin; drifts up + fades.
    if (smoke > 0.01) this._spawnSmokePuff(x + ux * 0.3, y + uy * 0.3, z + uz * 0.3, smoke);
    // Shell casing — pistol, tec9, ak47 eject brass. Shotgun ejects a
    // slightly bigger red shell (colored per-weapon). RPG doesn't
    // eject (it's a rocket tube).
    if (wpn === 'pistol' || wpn === 'tec9' || wpn === 'ak47_auto' || wpn === 'ak47' || wpn === 'shotgun') {
      this._spawnShell(x, y, z, ux, uy, uz, wpn);
    }
  }

  // Grey smoke puff — used by heavier weapons. Drifts up while
  // fading. `strength` scales initial opacity + size.
  _spawnSmokePuff(x, y, z, strength) {
    const slot = this.smokePool.find(s => !s.sp.visible) || this.smokePool[this._shellCursor % this.smokePool.length];
    slot.x = x; slot.y = y; slot.z = z;
    slot.vx = (Math.random() - 0.5) * 0.4;
    slot.vy = 0.7 + Math.random() * 0.4;
    slot.vz = (Math.random() - 0.5) * 0.4;
    slot.life = 0.35 + strength * 0.25;
    slot.maxLife = slot.life;
    slot.strength = strength;
    slot.sp.position.set(x, y, z);
    slot.sp.scale.set(0.4 + strength * 0.5, 0.4 + strength * 0.5, 1);
    slot.sp.material.opacity = Math.min(0.9, 0.55 + strength * 0.3);
    slot.sp.visible = true;
  }

  // Eject a shell casing from the ejection port. Direction is a
  // right-and-back offset from the shot direction so it looks like
  // it flew out of the gun body, not the barrel.
  _spawnShell(x, y, z, ux, uy, uz, wpn) {
    const slot = this.shellPool[this._shellCursor % this.shellPool.length];
    this._shellCursor++;
    // Right-of-barrel eject direction: cross the shot direction with
    // world up so the shell flies laterally.
    const rightX =  uz, rightY = 0, rightZ = -ux;
    const sp = 2.4 + Math.random() * 1.4;
    slot.x = x + rightX * 0.12 + uy * 0.05;
    slot.y = y + 0.02;
    slot.z = z + rightZ * 0.12;
    slot.vx = rightX * sp + (Math.random() - 0.5) * 0.4;
    slot.vy = 1.6 + Math.random() * 0.6;
    slot.vz = rightZ * sp + (Math.random() - 0.5) * 0.4;
    slot.wx = (Math.random() - 0.5) * 30;
    slot.wy = (Math.random() - 0.5) * 30;
    slot.wz = (Math.random() - 0.5) * 30;
    slot.life = 1.4;
    slot.kind = wpn === 'shotgun' ? 'hull' : 'brass';
    // Shotgun shells are red plastic + slightly larger.
    if (wpn === 'shotgun') {
      slot.m.material.color.setHex(0xa02020);
      slot.m.scale.set(1.35, 1.6, 1.35);
    } else {
      slot.m.material.color.setHex(0xd4b060);
      slot.m.scale.set(1, 1, 1);
    }
    slot.m.position.set(slot.x, slot.y, slot.z);
    slot.m.visible = true;
  }

  // Impact spark burst — variable count + color based on `kind`:
  //   • flesh     — red-crimson spray (blood particles). Bigger
  //                 count if `big` (shotgun/headshot/rpg direct).
  //   • wall      — orange sparks + gray dust
  //   • explosion — huge orange debris burst
  // Also spawns a ground blood decal on flesh hits.
  // Facade scorching: every vertical collider face inside the blast
  // radius gets a scorch + cracks decal sized by proximity (the ground
  // scorch comes from vfx.explosion). Thin faces (poles) are skipped so
  // a 3 m mark never floats off a lamp post.
  _blastScorchWalls(engine, im) {
    if (!this.vfx || !engine || !Array.isArray(engine.colliders)) return;
    const radius = (im.wpn === 'pipebomb' ? 4.0 : 4.5) * 0.95;
    const faces = wallFacesNearBlast(engine.colliders, im.x, im.y, im.z, radius, 3);
    for (const f of faces) {
      if (f.w != null && f.w < 0.9) continue;
      const k = 1 - f.dist / radius;
      let size = 1.8 + 3.2 * k;
      if (f.w != null) size = Math.min(size, f.w * 0.95);
      if (f.h != null) size = Math.min(size, f.h * 1.1);
      // ground-level blasts: lift the mark so it reads on the wall, not half under the kerb
      const yLo = f.yLo != null ? f.yLo : 0, yHi = f.yHi != null ? f.yHi : yLo + (f.h != null ? f.h : 3);
      const cy = Math.max(yLo + 0.15, Math.min(yHi - 0.15, Math.max(f.y, yLo + size * 0.35)));
      this.vfx.wallScorch(f.x, cy, f.z, f.nx, f.ny, f.nz, size, { cracks: f.surf === 'concrete' });
    }
  }

  _spawnSparkBurst(x, y, z, big, kind = 'wall') {
    let count, colorHex, upBias;
    if (kind === 'flesh') {
      count = big ? 22 : 12;
      colorHex = 0xc02020;                              // arterial crimson
      upBias = 0.6;
    } else if (kind === 'explosion') {
      count = 24;
      colorHex = 0xff8020;
      upBias = 1.0;
    } else {
      count = big ? 12 : 6;
      colorHex = 0xffdd88;
      upBias = 0.9;
    }
    let taken = 0;
    for (const s of this.sparkPool) {
      if (s.sp.visible) continue;
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * 0.9 + 0.1;
      const speed = big ? 4.5 + Math.random() * 3 : 2.5 + Math.random() * 2;
      s.x = x; s.y = y; s.z = z; s.kind = kind;
      s.vx = Math.cos(a) * Math.cos(el) * speed;
      s.vy = Math.sin(el) * speed * upBias;
      s.vz = Math.sin(a) * Math.cos(el) * speed;
      s.life = kind === 'flesh' ? 0.5 + Math.random() * 0.25 : 0.28 + Math.random() * 0.12;
      const sz = kind === 'flesh' ? (big ? 0.16 : 0.10) : (big ? 0.22 : 0.14);
      s.sp.scale.set(sz, sz, 1);
      s.sp.material.opacity = 1;
      s.sp.material.color.setHex(colorHex);
      s.sp.position.set(x, y, z);
      s.sp.visible = true;
      if (++taken >= count) break;
    }
    // Flesh hit — drop a persistent blood decal near the ground below
    // the hit point so a killed player leaves a legible smear.
    if (kind === 'flesh') {
      this._spawnBloodDecal(x, z, big ? 1.3 : 0.85);
    }
  }

  // Ground blood splat — flat disk at (x, 0.02, z). Linger ~8s.
  // `scale` sets the visual size (bigger for shotgun/headshot).
  _spawnBloodDecal(x, z, scale = 1) {
    const slot = this.bloodPool[this._bloodCursor % this.bloodPool.length];
    this._bloodCursor++;
    slot.m.position.set(x + (Math.random() - 0.5) * 0.25, 0.02, z + (Math.random() - 0.5) * 0.25);
    slot.m.rotation.z = Math.random() * Math.PI * 2;
    const sz = 0.6 * scale * (0.85 + Math.random() * 0.4);
    slot.m.scale.set(sz / 0.6, sz / 0.6, 1);
    slot.m.material.opacity = 0.9;
    slot.m.visible = true;
    slot.life = 8;
    slot.maxLife = 8;
  }

  // Called once per frame.
  sync(engine, t) {
    const seen = new Set();
    const dt = Math.min(0.05, Math.max(0, t - (this._lastT || t - 0.016)));
    this._lastT = t;
    const colliders = engine.arena ? engine.arena.colliders : engine.colliders;
    const half = engine.half;

    // Per-actor ragdoll driver — overrides position/rotation from
    // engine data while the actor is dead.  We feed it the engine's
    // yaw on the very first frame of death (= impulse direction) and
    // then let the verlet integrator carry the body down. Actors can
    // also carry a `deathImpulse` (weapon-flavoured knockback: pimp
    // slap fling, shotgun blowback, AK-headshot balloon) that
    // overrides the default fall-backward behavior, plus a queue of
    // `pendingRagdollImpulses` for post-death corpse abuse (slap /
    // kick a body).
    const drive = (rec, actor, posX, posY, posZ, yaw) => {
      const isDead = !!actor.dead;
      const g = rec.api.group;
      // Ground velocity in the character's facing frame (m/s) — the
      // Compton gait is distance-driven so it needs real speed and
      // a strafe/back-pedal direction, not just a 0..1 `moving`.
      // Free-running (not aim-holding) the body is already turning to
      // face the velocity, so the gait is pure forward — the transient
      // side component while the yaw catches up must NOT flip the legs
      // into the strafe gallop (that read as a waddle). Aim-hold keeps
      // the true 8-way strafe frame. Smoothing is frame-rate independent.
      {
        let vx, vz;
        if (typeof actor.velX === 'number' && actor === engine.me) { vx = actor.velX; vz = actor.velZ; }
        else if (rec._lp && dt > 1e-4) { vx = (posX - rec._lp.x) / dt; vz = (posZ - rec._lp.z) / dt; }
        else { vx = 0; vz = 0; }
        rec._lp = rec._lp || { x: 0, z: 0 };
        rec._lp.x = posX; rec._lp.z = posZ;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const speed = Math.hypot(vx, vz);
        const strafeFrame = actor !== engine.me || (actor.aimHoldT || 0) > 0 || !!actor.inCar;
        const tF = strafeFrame ? (vx * fx + vz * fz) : speed;
        const tS = strafeFrame ? (vx * rx + vz * rz) : 0;
        const k = 1 - Math.exp(-dt * (actor === engine.me ? 30 : 12));
        rec.vF = (rec.vF || 0) + (tF - (rec.vF || 0)) * k;
        rec.vS = (rec.vS || 0) + (tS - (rec.vS || 0)) * k;
      }
      if (isDead) {
        if (!rec.ragdoll) {
          const seed = ((actor.id || 'a').charCodeAt(0) || 1) * 7919 + ((actor.id || 'a').length || 1);
          rec.ragdoll = new Ragdoll(seed);
          rec.ragdollPos = { x: posX, y: posY, z: posZ };
          const imp = actor.deathImpulse;
          if (imp) {
            rec.ragdoll.startImpulse(imp);
          } else {
            rec.ragdoll.start(yaw, 1);
          }
        }
        // Drain any queued corpse-abuse impulses (slap/kick a body).
        if (actor.pendingRagdollImpulses && actor.pendingRagdollImpulses.length) {
          for (const imp of actor.pendingRagdollImpulses) {
            rec.ragdoll.applyImpulse(imp);
          }
          actor.pendingRagdollImpulses.length = 0;
        }
        rec.ragdoll.step(dt, rec.ragdollPos, colliders, half);
        g.position.set(rec.ragdollPos.x, rec.ragdollPos.y, rec.ragdollPos.z);
        g.rotation.order = 'YXZ';
        g.rotation.y = yaw;
        rec.ragdoll.apply(g);
        return true;
      } else {
        if (rec.ragdoll) { rec.ragdoll = null; rec.ragdollPos = null; g.rotation.set(0, 0, 0); g.rotation.order = 'XYZ'; }
        g.position.set(posX, posY, posZ);
        g.rotation.y = yaw;
        return false;
      }
    };

    // Me (visible in third person).  Never show the local player's own
    // name/tag — it's your own character, you know who you are, and the
    // extra sprite just clutters the third-person view. The nametag is
    // still constructed so the character rig geometry doesn't change,
    // but we pass an empty label and pin visibility to false.
    const me = engine.me;
    const myId = me.id || 'me';
    seen.add(myId);
    {
      const rec = this._model(myId, me.build, me.team, '');
      // Hide the local model when riding in a car — the camera is in
      // chase mode and we don't want our Saint clipping through the
      // roof. EXCEPTION: dirt bikes are open — keep the player
      // visible on the seat.
      let inBike = false;
      let inCarNonBike = false;
      let bikeRef = null;
      let carRef = null;
      if (me.inCar) {
        const v = engine.vehicles && engine.vehicles.find(x => x.id === me.inCar.id);
        if (v && v.kind === 'dirtbike') { inBike = true; bikeRef = v; }
        else if (v) { inCarNonBike = true; carRef = v; }
      }
      // iter193 — driver is now visible sitting in the seat for ALL
      // vehicle kinds (was: hidden inside cars, visible on bikes).
      rec.api.group.visible = true;
      // On a bike the visible body should face the BIKE's forward,
      // not the aim direction (arms still animate off the aim path).
      // The pc_body rig ships authored with its FRONT along -Z (so a
      // stock rotation.y=0 shows the back of the head — matches the
      // 3rd-person chase camera looking at the player from behind).
      // Bike GLB after cloneDirtBikeMesh() faces +Z. So we add π to
      // the render yaw so the character sits FACING the bike's
      // handlebars, not its rear fender.
      // Also apply the bike's roll (lean) + pitch (wheelie) to the
      // player group so it looks glued to the tank.
      let renderYaw = me.yaw;
      if (inBike && bikeRef) renderYaw = bikeRef.yaw + Math.PI;
      else if (inCarNonBike && carRef) renderYaw = carRef.yaw + Math.PI;
      const isDead = drive(rec, me, me.x, me.y, me.z, renderYaw);
      if (inBike && bikeRef && rec.api.group) {
        // Rider lean matches the bike lean but only 70% (rider always
        // stands up a bit more upright than the frame). Wheelie tips
        // the rider back with the frame.
        rec.api.group.rotation.z = (bikeRef.leanAngle || 0) * 0.7;
        rec.api.group.rotation.x = -(bikeRef.wheelieT || 0) * (Math.PI / 180) * 45;
      } else if (rec.api.group) {
        rec.api.group.rotation.z = 0;
        rec.api.group.rotation.x = 0;
      }
      rec.api.setWeapon(engine.weapon().id);
      rec.api.setTagVisible(false);
      rec.api.setHpBar(false, 1);
      const _fLocal = {
        moving: isDead ? 0 : me.moving,
        mvFwd: isDead ? 0 : rec.vF, mvSide: isDead ? 0 : rec.vS,
        turnRate: isDead ? 0 : (me.yawRate || 0),
        firing: !isDead && (me.firing || me.meleeT > 0),
        crouch: me.crouch,
        deadT: isDead ? me.deadT : 0,
        // Live ragdoll state (limb flails, head lag, impact shock,
        // impulse direction) — mesh reads this in the dead-branch
        // to add per-bone motion on top of the group-level tumble.
        rag: (isDead && rec.ragdoll) ? rec.ragdoll : null,
        pitch: me.aimHoldT > 0 ? me.pitch : 0,
        eating: me.eating,
        blocking: me.blocking,
        blockSway: me.blockSway,
        kick: me.kickT > 0,
        punchL: me.punchLT > 0,
        taunt: me.tauntT > 0 ? me.taunt : null,
        sprint: me.sprinting,
        walking: !!me.walking,
        speedTier: me.speedTier | 0,
        vaulting: me._vaultT > 0 ? Math.min(1, 1 - me._vaultT / (me._vaultDur || 1)) : 0,
        knocked: me.knockDownT > 0 ? me.knockDownT : 0,
        gunMelee: me.gunMeleeT > 0,
        jump: !me.onGround,
        reloadT: me.reloadT,
        hasPimpSlap: !!me.hasPimpSlap,
        slapSpinT: me.slapSpinT || 0,
        slapSpinDir: me.slapSpinDir || 1,
        // Liu-Kang style variant IDs for the character rig to select
        // the matching animation curve (jab / cross / hook / uppercut
        // for punches; front / roundhouse / axe for kicks).
        punchVariant: me.lastPunchVariant | 0,
        kickVariant: me.lastKickVariant | 0,
        // LIU-KANG FLYING KICK — engine timer > 0 means the char is
        // mid-special; the animation code overrides the leg pose with
        // a fully-extended horizontal kick + backward-swept trailing leg.
        // Cover-hug state — outward normal (radians) of the jersey
        // barrier the player is currently pressed against, or null.
        // derivePoseId reads this to pick one of the 4 cardinal
        // cover-hug pose slots (N/E/S/W) so the PoseLab can author
        // a hugging pose per direction.
        hugCoverDir: me.hugCoverDir,
        flyKickT: me.flyKickT || 0,
        // iter193 — sitting-in-car flag. When the local player is in
        // a non-bike vehicle (car), animate the legs as SEATED (hips
        // flexed 90°, knees bent 90°) and arms on the wheel instead
        // of the standing walk/idle cycle.
        sitting: inCarNonBike,
      };
      applyPoseOverridePre(rec, rec.api);
      rec.api.animate(t, _fLocal);
      rec.__actor = me;
      applyPoseOverridePost(rec, rec.api, _fLocal, me.wpnIdx);
    }

    // Remote players.
    if (engine.coop) {
      for (const rp of engine.coop.frame(performance.now())) {
        seen.add(rp.id);
        const s = rp.s;
        // `rp.display` is already wrapped as "[TAG] Nickname" by the
        // backend `_resolve_display`, so don't prefix the gang tag
        // again — that produced the "[SR] [SR] Name" double-tag bug.
        const displayName = rp.display || 'SAINT';
        const rec = this._model(rp.id, rp.build, rp.team, displayName, 5);
        // Death-impulse hydration: the coop feed carries `di` (deathImpulse)
        // on the state packet the frame someone dies. We latch it onto `rp`
        // so subsequent frames keep the ragdoll config even after `s.di`
        // clears. Same treatment for post-death corpse kicks (`ri` queue).
        if (s.di && !rp._diApplied) {
          rp.deathImpulse = s.di;
          rp._diApplied = true;
        }
        if (!s.dead) { rp.deathImpulse = null; rp._diApplied = false; rp.pendingRagdollImpulses = null; }
        if (s.ri && s.ri.length) {
          rp.pendingRagdollImpulses = rp.pendingRagdollImpulses || [];
          rp.pendingRagdollImpulses.push(...s.ri);
        }
        const actor = {
          id: rp.id,
          dead: !!s.dead,
          deadT: 1,
          deathImpulse: rp.deathImpulse,
          pendingRagdollImpulses: rp.pendingRagdollImpulses,
        };
        const isDead = drive(rec, actor, s.x || 0, s.y || 0, s.z || 0, s.yaw || 0);
        rec.api.setWeapon(s.wpn || 'pistol');
        // Enemy names + red HP bars only reveal under your crosshair.
        const foe = (rp.team || s.team) !== engine.me.team;
        const hov = engine.aimStickyId === rp.id;
        rec.api.setTagVisible(!isDead && (!foe || hov));
        rec.api.setHpBar(hov && !isDead, (s.hp != null ? s.hp : 100) / 100);
        // Teammate arrow — green if we came in from the same source
        // lobby (partied up), otherwise the team color for a random
        // matched teammate. Foes get no marker.
        const mySource = engine.coop ? engine.coop.sourceLobbyId : null;
        const sameParty = mySource && rp.sourceLobbyId && rp.sourceLobbyId === mySource;
        const variant = sameParty ? 'party' : (engine.me.team === 'A' ? 'teamA' : 'teamB');
        const arrow = this._ensureTeamArrow(rec, variant);
        arrow.visible = !foe && !isDead;
        const _fRemote = {
          moving: isDead ? 0 : (s.moving || 0),
          mvFwd: isDead ? 0 : rec.vF, mvSide: isDead ? 0 : rec.vS,
          firing: !isDead && !!s.firing,
          crouch: !!s.crouch,
          deadT: isDead ? 1 : 0,
          rag: (isDead && rec.ragdoll) ? rec.ragdoll : null,
          pitch: s.pitch || 0,
          eating: !!s.eat,
          blocking: !!s.blk,
          kick: !!s.kick,
          punchL: !!s.pl,
          taunt: s.tnt || null,
          sprint: !!s.spr,
          walking: !!s.wlk,
          speedTier: s.st | 0,
          vaulting: +s.vlt || 0,
          knocked: +s.kd || 0,
          gunMelee: !!s.gm,
          jump: !!s.jmp,
          reloadT: s.rl,
          hasPimpSlap: !!s.ps,
        };
        applyPoseOverridePre(rec, rec.api);
        rec.api.animate(t, _fRemote);
        rec.__actor = { y: s.y || 0, onGround: !s.jmp };
        applyPoseOverridePost(rec, rec.api, _fRemote, s.wIdx | 0);
      }
    }

    // Bots (authority-simmed or host-mirrored).
    const bots = engine.isAuthority ? engine.bots.values() : engine.remoteBots.values();
    for (const b of bots) {
      seen.add(b.id);
      const rec = this._model(b.id, b.build || null, b.team, `[BOT] ${b.name}`, parseInt(b.id.slice(4), 10) * 31 + 7);
      const isDead = drive(rec, b, b.x, b.y || 0, b.z, b.yaw);
      rec.api.setWeapon(b.wpn || 'pistol');
      const foe = b.team !== engine.me.team;
      const hov = engine.aimStickyId === b.id;
      rec.api.setTagVisible(!isDead && (!foe || hov));
      rec.api.setHpBar(hov && !isDead, (b.hp != null ? b.hp : 100) / 100);
      // Bots are always "random matched teammates" — use the team
      // color arrow, never the green party variant.
      const botVariant = engine.me.team === 'A' ? 'teamA' : 'teamB';
      const arrow = this._ensureTeamArrow(rec, botVariant);
      arrow.visible = !foe && !isDead;
      const _fBot = {
        moving: isDead ? 0 : (b.moving || 0),
        mvFwd: isDead ? 0 : rec.vF, mvSide: isDead ? 0 : rec.vS,
        firing: !isDead && !!b.firing,
        crouch: false,
        deadT: isDead ? Math.max(0.4, b.deadT || 0.4) : 0,
        rag: (isDead && rec.ragdoll) ? rec.ragdoll : null,
        pitch: 0,
        hasPimpSlap: !!b.hasPimpSlap,
      };
      const _bWpnIdx = WPN_IDS.indexOf(b.wpn || 'pistol');
      applyPoseOverridePre(rec, rec.api);
      rec.api.animate(t, _fBot);
      rec.__actor = b;
      applyPoseOverridePost(rec, rec.api, _fBot, _bWpnIdx >= 0 ? _bWpnIdx : 3);
    }

    // Drop models for gone actors.
    for (const [id, rec] of [...this.models.entries()]) {
      if (!seen.has(id)) {
        this.scene.remove(rec.api.group);
        rec.api.dispose();
        this.models.delete(id);
      }
    }

    // ── Tracers as moving streaks (not full-length beams) ──
    // For each active tracer, compute the progress along the shot
    // line and render a short 1.4m streak trailing the "bullet head".
    // Vertex colors fade the streak's alpha from bright (head) to
    // faint (tail), and drop to zero as the tracer dies. Muzzle flash
    // is fired ONCE per shot on the first frame it appears.
    const TRACER_LIFE = 0.09;               // matches engine push
    const STREAK_LEN = 1.4;                 // world units
    const pos = this.tracerLines.geometry.attributes.position;
    const col = this.tracerLines.geometry.attributes.color;
    let v = 0;
    const activeTracerIds = new Set();
    for (const tr of engine.tracers) {
      if (v + 2 > MAX_TRACER_VERTS) break;
      // Stable identity — engine tracers don't have ids, so hash the
      // origin coords rounded to the mm. Two shots from the exact
      // same origin within 90ms are so rare we're fine.
      const key = `${tr.ax.toFixed(2)}|${tr.ay.toFixed(2)}|${tr.az.toFixed(2)}|${tr.bx.toFixed(2)}|${tr.bz.toFixed(2)}`;
      activeTracerIds.add(key);
      const p = 1 - Math.max(0, Math.min(1, tr.t / TRACER_LIFE));
      const dx = tr.bx - tr.ax, dy = tr.by - tr.ay, dz = tr.bz - tr.az;
      const total = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / total, uy = dy / total, uz = dz / total;
      // Head position advances along the line as t → 0.
      const dist = Math.min(total, total * p + 0.1);
      const hx = tr.ax + ux * dist;
      const hy = tr.ay + uy * dist;
      const hz = tr.az + uz * dist;
      const tailLen = Math.min(STREAK_LEN, dist);
      const tx = hx - ux * tailLen;
      const ty = hy - uy * tailLen;
      const tz = hz - uz * tailLen;
      pos.setXYZ(v, tx, ty, tz);
      // Weapon-tinted tracer. AK-47 hot yellow, pistol/tec9 cyan-white,
      // shotgun red-orange (rare — shotgun tracer only when a
      // pellet was aimed). Defaults to warm yellow.
      let tR = 0.9, tG = 0.55, tB = 0.15;    // tail (dimmer)
      let hR = 1.0, hG = 0.95, hB = 0.55;    // head (brighter)
      const w = tr.wpn;
      if (w === 'ak47_auto' || w === 'ak47') {
        tR = 1.0; tG = 0.85; tB = 0.20;
        hR = 1.0; hG = 1.0;  hB = 0.75;
      } else if (w === 'pistol' || w === 'tec9') {
        tR = 0.85; tG = 0.95; tB = 1.0;
        hR = 1.0;  hG = 1.0;  hB = 1.0;
      } else if (w === 'shotgun') {
        tR = 1.0;  tG = 0.45; tB = 0.20;
        hR = 1.0;  hG = 0.75; hB = 0.35;
      }
      col.setXYZ(v, tR, tG, tB);
      v++;
      pos.setXYZ(v, hx, hy, hz);
      col.setXYZ(v, hR, hG, hB);
      v++;
      // Fire muzzle flash on the FIRST frame we see this shot.
      if (!this._seenTracers.has(key)) {
        this._seenTracers.add(key);
        this._spawnMuzzleFlash(tr.ax, tr.ay, tr.az, ux, uy, uz, tr.wpn);
      }
    }
    // Purge stale seen-set entries so it doesn't grow unbounded.
    if (this._seenTracers.size > 512) {
      for (const k of this._seenTracers) {
        if (!activeTracerIds.has(k)) this._seenTracers.delete(k);
      }
    }
    this.tracerLines.geometry.setDrawRange(0, v);
    pos.needsUpdate = true;
    col.needsUpdate = true;

    // ── Muzzle flash update (fade + rotate) ──
    for (const slot of this.muzzleFlashPool) {
      if (!slot.sp.visible) continue;
      slot.t -= dt;
      if (slot.t <= 0) { slot.sp.visible = false; continue; }
      const life = slot.t / 0.06;
      const s = 0.55 + (1 - life) * 0.15;
      slot.sp.scale.set(s, s, 1);
      slot.sp.material.opacity = life;
      slot.sp.material.rotation = slot.seed * (1 - life) * 6;
    }

    // ── Impact spark update ──
    // Blood particles have a longer arc (heavier, lower gravity) so
    // they linger in the air momentarily.  Fade rate matches life.
    for (const s of this.sparkPool) {
      if (!s.sp.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sp.visible = false; continue; }
      const grav = s.kind === 'flesh' ? 5 : 8;
      s.vy -= grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      // Blood droplets that fall below ground level stick — leaves
      // a tiny decal on the ground for lingering realism.
      if (s.kind === 'flesh' && s.y <= 0.05) {
        s.sp.visible = false;
        // Tiny secondary decal at landing spot for realism.
        this._spawnBloodDecal(s.x, s.z, 0.35);
        continue;
      }
      s.sp.position.set(s.x, s.y, s.z);
      const denom = s.kind === 'flesh' ? 0.75 : 0.35;
      s.sp.material.opacity = Math.max(0, s.life / denom);
    }

    // ── Shell casing integration ──
    for (const s of this.shellPool) {
      if (!s.m.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.vy -= 20 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      // Floor bounce (with attenuation) — the floor is whatever the
      // casing is over (road, kerb, slab), not a flat y=0.
      const floorY = (topAt(engine.colliders || [], s.x, s.z, s.y + 0.5) || 0) + 0.02;
      if (s.y <= floorY) {
        s.y = floorY;
        if (s.vy < -0.5) {
          // brass tinkle on every real bounce, quieter as it settles
          playShellClatterAt(s.x, s.y, s.z, Math.min(1, -s.vy / 5), s.kind || 'brass');
          s.vy = -s.vy * 0.32;
          s.vx *= 0.55; s.vz *= 0.55;
          s.wx *= 0.4; s.wy *= 0.4; s.wz *= 0.4;
        } else {
          s.vy = 0; s.vx *= 0.6; s.vz *= 0.6;
        }
      }
      s.m.position.set(s.x, s.y, s.z);
      s.m.rotation.set(
        s.m.rotation.x + s.wx * dt,
        s.m.rotation.y + s.wy * dt,
        s.m.rotation.z + s.wz * dt
      );
      // Last 0.3s fades out so the pool recycles cleanly.
      if (s.life < 0.3) {
        // meshes don't have per-object opacity — scale down instead.
        const k = s.life / 0.3;
        s.m.scale.setScalar((s.m.material.color.getHex() === 0xa02020 ? 1.35 : 1) * k);
      }
    }

    // ── Muzzle smoke update ──
    for (const p of this.smokePool) {
      if (!p.sp.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      p.vx *= 0.98; p.vy *= 0.99; p.vz *= 0.98;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.sp.position.set(p.x, p.y, p.z);
      const k = p.life / p.maxLife;
      p.sp.material.opacity = k * 0.85;
      const sz = (0.4 + (p.strength || 0.5) * 0.5) + (1 - k) * 0.6;
      p.sp.scale.set(sz, sz, 1);
    }

    // ── Blood decal fade ──
    // Splats persist ~8s then slowly fade so the ground isn't a
    // permanent bloodbath. Actual removal happens when opacity <= 0.02.
    for (const b of this.bloodPool) {
      if (!b.m.visible) continue;
      b.life -= dt;
      if (b.life <= 0) { b.m.visible = false; b.m.material.opacity = 0; continue; }
      const fadeK = b.life / b.maxLife;
      b.m.material.opacity = fadeK * 0.9;
    }

    // ── BLEED TRAIL ──────────────────────────────────────────
    // Actors below ~30% HP dribble blood on the ground while
    // moving. `_bleedTimers` keeps a per-actor countdown so drips
    // aren't spawned every frame — just every ~0.4s of walking.
    if (!this._bleedTimers) this._bleedTimers = new Map();
    const bleedActors = [
      { id: myId, x: me.x, z: me.z, moving: me.moving || 0, hpFrac: (me.hp || 0) / (me.hpMax || 100), dead: !!me.dead },
    ];
    for (const [bid, b] of engine.bots) {
      bleedActors.push({ id: bid, x: b.x, z: b.z, moving: b.moving || 0, hpFrac: (b.hp || 0) / 100, dead: !!b.dead });
    }
    if (engine.coop) {
      for (const rp of engine.coop.frame(performance.now())) {
        const s = rp.state;
        if (!s) continue;
        bleedActors.push({ id: rp.id, x: s.x, z: s.z, moving: s.moving || 0, hpFrac: (s.hp || 0) / 100, dead: !!s.dead });
      }
    }
    for (const a of bleedActors) {
      const wasBleeding = a.hpFrac < 0.32;
      let bt = this._bleedTimers.get(a.id);
      if (!wasBleeding || a.dead) {
        // Purge stale timer entries once actor recovers or dies —
        // saves a Map lookup on subsequent frames and lets a
        // respawned actor start bleeding from the correct HP again.
        if (bt) this._bleedTimers.delete(a.id);
        continue;
      }
      if (!bt) { bt = { t: 0.15 + Math.random() * 0.3, lastX: a.x, lastZ: a.z }; this._bleedTimers.set(a.id, bt); }
      // Only drip while actually moving. `_dist` reads how far the
      // actor travelled since last drip — > 0.7m OR > 0.4s cadence.
      const _dist = Math.hypot(a.x - bt.lastX, a.z - bt.lastZ);
      bt.t -= dt;
      if (bt.t <= 0 || _dist > 0.7) {
        // Smaller decal than a bullet hit — reads as a drip, not a splat.
        // Below 15% HP the drips get thicker.
        const scale = a.hpFrac < 0.15 ? 0.55 : 0.35;
        this._spawnBloodDecal(a.x, a.z, scale);
        bt.t = 0.45 + Math.random() * 0.35;
        bt.lastX = a.x; bt.lastZ = a.z;
      }
    }

    // Impacts — fire a spark burst the first time an impact is seen.
    if (!this._seenImpacts) this._seenImpacts = new WeakSet();
    const vfxReady = !!(this.vfx && this.vfx.ready);
    for (let i = 0; i < this.impactPool.length; i++) {
      const m = this.impactPool[i];
      const im = engine.impacts[i];
      if (!im) { m.visible = false; continue; }
      const T = im.big ? 0.6 : 0.25;
      const k = 1 - im.t / T;
      const blastVfx = vfxReady && im.kind === 'explosion';
      // Bullet strikes on the world (wall/prop/car/ground, incl. remote
      // tracers and lob landings) → per-surface hit; flesh keeps blood.
      const surfVfx = vfxReady && !blastVfx && im.kind !== 'flesh';
      // With the Blender flipbook explosion / surface hits the old orange
      // sphere is hidden; the textured effects replace it.
      m.visible = !(blastVfx || surfVfx);
      m.position.set(im.x, im.y, im.z);
      const s = (im.big ? 3.6 : 0.35) * (0.3 + k * 0.7);
      m.scale.set(s, s, s);
      m.material.opacity = 0.85 * (1 - k);
      if (!this._seenImpacts.has(im)) {
        this._seenImpacts.add(im);
        if (blastVfx) {
          this.vfx.explosion(im.x, im.y, im.z, { wpn: im.wpn, scale: im.wpn === 'pipebomb' ? 1.05 : 1 });
          this._blastScorchWalls(engine, im);
        } else if (surfVfx) {
          const surf = im.surf || 'concrete';
          const n = im.nx != null ? im : (im.dx != null ? normalFromDir(im.dx, im.dy, im.dz) : { nx: 0, ny: 1, nz: 0 });
          this.vfx.surfaceHit(im.x, im.y, im.z, n.nx, n.ny, n.nz, surf, { big: !!im.big });
          playSurfaceHitAt(surf, im.x, im.y, im.z);
        } else {
          this._spawnSparkBurst(im.x, im.y, im.z, !!im.big, im.kind || 'wall');
        }
      }
    }

    // ── KUNG-FU MELEE IMPACT VFX ─────────────────────────────
    // Each entry in engine.meleeImpacts (populated on a landed
    // punch/kick/slap) spawns:
    //   • a bright yellow ring that scales up + fades (0.30s life)
    //   • a spark burst  — reusing the bullet-impact particle system
    //     for consistent look; `big=true` for combo hits ≥ 3.
    if (!this._seenMeleeImpacts) this._seenMeleeImpacts = new WeakSet();
    if (!this._meleeRingPool) this._meleeRingPool = [];
    let ringIdx = 0;
    for (const im of engine.meleeImpacts) {
      const ageT = engine.t - im.t;
      const life = im.big ? 0.42 : 0.30;
      if (ageT > life) continue;
      const k = ageT / life;                              // 0 → 1
      // Lazily grow a ring-mesh pool.
      let ring = this._meleeRingPool[ringIdx];
      if (!ring) {
        const ringGeo = new THREE.RingGeometry(0.18, 0.32, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ring = new THREE.Mesh(ringGeo, ringMat);
        ring.renderOrder = 3;
        this.scene.add(ring);
        this._meleeRingPool[ringIdx] = ring;
      }
      ring.visible = true;
      ring.position.set(im.x, im.y, im.z);
      ring.lookAt(engine.me.x, im.y + 0.2, engine.me.z);   // face the camera-ish
      const scl = (im.big ? 5.0 : 2.5) * (0.35 + k * 0.9);
      ring.scale.setScalar(scl);
      ring.material.opacity = 0.85 * (1 - k);
      ring.material.color.setHex(im.big ? 0xf87171 : 0xfacc15);   // red for finisher
      // Spark burst on first sight.
      if (!this._seenMeleeImpacts.has(im)) {
        this._seenMeleeImpacts.add(im);
        try { this._spawnSparkBurst(im.x, im.y, im.z, !!im.big); } catch { /* noop */ }
      }
      ringIdx += 1;
    }
    // Hide any rings that weren't used this frame.
    for (let i = ringIdx; i < this._meleeRingPool.length; i++) {
      if (this._meleeRingPool[i]) this._meleeRingPool[i].visible = false;
    }

    // Rockets — includes pipe bombs. Pipe bombs get the GLB mesh
    // once loaded, spin during flight, and emit a trail of sparks
    // per bounce. RPG rounds keep the original cylinder+flame.
    for (let i = 0; i < this.rocketPool.length; i++) {
      if (this.rocketPool[i]) this.rocketPool[i].visible = false;
    }
    engine.rockets.forEach((r, i) => {
      const m = this._rocketMesh(i, r.wpnId);
      m.visible = true;
      m.position.set(r.x, r.y, r.z);
      if (r.wpnId === 'pipebomb') {
        // Tumbling rotation while airborne — feels like a real
        // thrown pipe. `_tumbleY` is stashed on the rocket itself so
        // rotation is stable across pool slot reuse.
        r._tumbleY = (r._tumbleY || 0) + dt * (2.4 + 0.15 * Math.hypot(r.vx, r.vz));
        r._tumbleX = (r._tumbleX || 0) + dt * (1.8 + 0.12 * Math.hypot(r.vx, r.vz));
        m.rotation.set(r._tumbleX, r._tumbleY, 0);
        // Spark trail — write 6 points behind the bomb along its
        // recent motion. Older ring positions decay via opacity below.
        const sp = m.getObjectByName('_sparkTrail');
        if (sp) {
          const attr = sp.geometry.getAttribute('position');
          const arr = attr.array;
          // Push new position at head; shift the rest back to simulate
          // a decaying trail. Cheap ring-buffer pattern.
          for (let k = arr.length - 3; k >= 3; k -= 3) {
            arr[k]     = arr[k - 3];
            arr[k + 1] = arr[k - 2];
            arr[k + 2] = arr[k - 1];
          }
          // Slight per-point jitter so the trail reads as sparks not a line.
          arr[0] = r.x + (Math.random() - 0.5) * 0.06;
          arr[1] = r.y + (Math.random() - 0.5) * 0.06 + 0.05;
          arr[2] = r.z + (Math.random() - 0.5) * 0.06;
          attr.needsUpdate = true;
          // Trail brighter mid-flight (moving fast); dim when settled.
          const spd = Math.hypot(r.vx, r.vy, r.vz);
          sp.visible = spd > 0.2 || (r._sparkPop || 0) > 0.05;
          if (sp.material) sp.material.opacity = Math.min(1, 0.35 + 0.55 * (spd / 12) + (r._sparkPop || 0) * 0.9);
        }
        // Pop light — flashes on bounce impact (engine sets _sparkPop
        // when the bomb hits a wall/ground). Multiplies with fuse
        // urgency so the last 0.6s pulses REGARDLESS of motion.
        if (this.vfx) {
          const fuseUrgency = r.t < 0.6 ? (0.6 - r.t) / 0.6 : 0;
          const flicker = 0.6 + 0.4 * Math.sin(performance.now() * 0.03);
          const pop = (r._sparkPop || 0) * 3.5 + fuseUrgency * 2.2 * flicker;
          if (pop > 0.05) this.vfx.pulse(r.x, r.y + 0.2, r.z, pop, fuseUrgency > 0.5 ? 0xff5030 : 0xffb040);
        }
      } else {
        m.lookAt(r.x + r.vx, r.y + r.vy, r.z + r.vz);
        if (this.vfx) this.vfx.rocketTrail(r.x, r.y, r.z, r.vx, r.vy, r.vz, dt);
      }
    });

    // World pickups — different visuals per type:
    //   • RPG world spawn (ephemeral=false): pulsing yellow ring + beacon
    //   • Dropped weapon (ephemeral=true): the actual gun OBJ lying on
    //     the ground, animating a short fall from hand height to floor.
    if (engine.pickups) {
      this._pickupMeshes ||= new Map();
      // Sweep meshes for pickups that no longer exist (e.g. expired drops).
      const liveIds = new Set(engine.pickups.map(p => p.id));
      for (const [id, g] of Array.from(this._pickupMeshes.entries())) {
        if (!liveIds.has(id)) {
          this.scene.remove(g);
          g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
          this._pickupMeshes.delete(id);
        }
      }
      for (const p of engine.pickups) {
        let g = this._pickupMeshes.get(p.id);
        if (!g) {
          g = new THREE.Group();
          // PIMP SLAP pickup — always a glowing purple pimp hat on the
          // ground (NOT the brass knuckles). The hat IS the visual
          // marker per user spec: "on the ground its a purple glowing
          // hat you pick it up, it shows up on your head and you have
          // the brass knuckles".
          if (p.wpn === 'pimpslap') {
            this._installPimpHatPickup(g, /* ephemeral */ !!p.ephemeral);
            // Purple glow ring under the hat.
            const glow = new THREE.Mesh(
              new THREE.RingGeometry(0.45, 0.65, 28),
              new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
            );
            glow.rotation.x = -Math.PI / 2;
            glow.position.y = -0.5;
            g.add(glow);
            g.userData.pimp = true;
          } else if (p.ephemeral) {
            // Dropped weapon — load the actual OBJ and lay it flat.
            const placeholder = new THREE.Mesh(
              new THREE.BoxGeometry(0.6, 0.1, 0.18),
              new THREE.MeshLambertMaterial({ color: 0x222222 })
            );
            placeholder.userData.placeholder = true;
            g.add(placeholder);
            this._installDroppedGunMesh(g, p.wpn, /* standing */ false);
            // Initial fall: spawn at hand height, gravitates to floor.
            g.userData.fallY = 1.05;
            g.userData.fallVY = 0;
          } else {
            // World pickup — the actual gun standing upright, slowly
            // rotating around its vertical axis. A faint yellow glow
            // ring underneath marks the spot from a distance.
            const placeholder = new THREE.Mesh(
              new THREE.BoxGeometry(0.5, 0.25, 0.18),
              new THREE.MeshLambertMaterial({ color: 0x6b6e76 })
            );
            placeholder.userData.placeholder = true;
            g.add(placeholder);
            this._installDroppedGunMesh(g, p.wpn, /* standing */ true);
            const glow = new THREE.Mesh(
              new THREE.RingGeometry(0.45, 0.6, 24),
              new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
            );
            glow.rotation.x = -Math.PI / 2;
            glow.position.y = -0.5;
            g.add(glow);
          }
          this.scene.add(g);
          this._pickupMeshes.set(p.id, g);
        }
        g.visible = !!p.available;
        if (p.available) {
          if (g.userData.pimp) {
            // Pimp hat hovers + slowly spins; bigger bob for visibility.
            g.position.set(p.x, (p.y || 0.8) + Math.sin(t * 2.3) * 0.10, p.z);
            g.rotation.y = t * 1.2;
          } else if (p.ephemeral) {
            // Falling-from-hand animation: simple gravity until grounded.
            const ud = g.userData;
            if ((ud.fallY ?? 0) > 0.12) {
              ud.fallVY = (ud.fallVY || 0) - 6.0 * dt;
              ud.fallY = Math.max(0.12, (ud.fallY || 0) + ud.fallVY * dt);
            }
            g.position.set(p.x, ud.fallY ?? 0.12, p.z);
            // Slow horizontal spin — the OBJ's long-X axis is already
            // horizontal after loadWeapon's normalisation, so the gun
            // sits flat on the ground naturally.
            g.rotation.y = t * 0.6;
          } else {
            // World pickup — stand the gun upright, bob it up/down,
            // spin it slowly. Arena-shooter classic.
            g.position.set(p.x, (p.y || 0.8) + Math.sin(t * 2) * 0.08, p.z);
            g.rotation.y = t * 1.4;
          }
        }
      }
    }
  }

  // Replace the placeholder cube inside a dropped-weapon group with
  // the actual weapon OBJ once it loads. Material + per-weapon target
  // length match the in-hand `gunProp()` so dropped weapons look IDENTICAL
  // to what the killer was carrying a moment ago.
  _installDroppedGunMesh(group, weaponId, standing = false) {
    Promise.all([
      import('./characterModel3d.js'),
      import('./objAssets.js'),
    ]).then(([{ WEAPON_OBJ_FILE, WEAPON_TARGET_LEN }, { loadWeapon }]) => {
      const objFile = WEAPON_OBJ_FILE[weaponId];
      if (!objFile) return;
      loadWeapon(objFile).then((geo) => {
        const mat = new THREE.MeshPhongMaterial({ color: 0x6b6e76, shininess: 60, specular: 0x404048 });
        const mesh = new THREE.Mesh(geo, mat);
        const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
        const len = Math.max((bb && (bb.max.x - bb.min.x)) || 0.5, 0.001);
        const targetLen = WEAPON_TARGET_LEN[weaponId] || 0.7;
        const s = targetLen / len;
        mesh.scale.set(s, s, s);
        // For world pickups, rotate the gun so its long axis points
        // STRAIGHT UP — it stands upright in the air like a classic
        // arena-shooter weapon pickup (Quake / Halo). Dropped weapons
        // keep the OBJ's default horizontal pose so they lie flat.
        if (standing) {
          mesh.rotation.z = Math.PI / 2;
        }
        for (const c of [...group.children]) {
          if (c.userData.placeholder) {
            group.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose();
          }
        }
        group.add(mesh);
      }).catch(() => { /* swallow — placeholder stays */ });
    }).catch(() => { /* swallow */ });
  }

  // PIMP-SLAP pickup visual — the purple pimp hat OBJ sitting on the
  // ground. Both world spawns and ephemeral on-death drops use the
  // SAME visual (hat) per user spec: "the hat is also what the pickup
  // weapon looks like before inventoried".
  _installPimpHatPickup(group /* , ephemeral */) {
    import('./objAssets.js').then(({ loadWeapon }) => {
      loadWeapon('pimphat.obj').then((geo) => {
        const mat = new THREE.MeshPhongMaterial({
          color: 0x8b3df0,
          emissive: 0x4a17a0,
          emissiveIntensity: 0.6,
          shininess: 40,
          specular: 0x4a1e8f,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const bb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
        const len = Math.max((bb && (bb.max.x - bb.min.x)) || 0.5, 0.001);
        const s = 0.65 / len;
        mesh.scale.set(s, s, s);
        mesh.rotation.set(0, Math.PI / 2, 0);
        group.add(mesh);
      }).catch(() => { /* swallow — glow ring is enough */ });
    }).catch(() => { /* swallow */ });
  }

  dispose() {
    this._disposed = true;
    if (this.arsenal) {
      this.scene.remove(this.arsenal);
      this.arsenal.traverse(o => { if (o.geometry && !o.geometry.__shared) o.geometry.dispose(); });
      this.arsenal = null;
    }
    for (const rec of this.models.values()) {
      this.scene.remove(rec.api.group);
      rec.api.dispose();
    }
    this.models.clear();
    this.scene.remove(this.tracerLines);
    this.tracerLines.geometry.dispose();
    this.tracerLines.material.dispose();
    for (const m of this.impactPool) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const g of this.rocketPool) {
      if (!g) continue;
      this.scene.remove(g);
      g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    if (this._pickupMeshes) {
      for (const g of this._pickupMeshes.values()) {
        this.scene.remove(g);
        g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      }
      this._pickupMeshes.clear();
    }
  }
}
