// Team Gangsta Brawl — input.
// Keyboard: WASD/arrows move · mouse or J/Z fire · K kick ·
// R reload · Space jump (costs 10% sprint) · X climb/vault fence · C crouch ·
// Alt = WALK (slow, quiet) · Left Shift / Q = SPRINT ·
// H hold = eat cheeseburger · F = gun-melee (armed) / hold = block (fists) ·
// hold B/Tab = weapon wheel · 1-7 slots · V scoreboard.
// Gamepad: left stick move · right stick aim · RT fire / right punch ·
// LT left punch (fists) or gun-melee (armed) · LB kick + hold = WALK ·
// RB sprint · A reload · X climb/vault/jump · B hold = weapon wheel ·
// dpad-down hold = eat · LT+RT hold = block (fists) · Back = scoreboard ·
// dpad-left = 90s dance taunt · dpad-right = flick 'em off ·
// dpad-up = DX suck-it (keyboard: T / G / Y).
// User-tunable controller settings persisted to localStorage. Read by
// the pause-menu Controller tab and re-applied via the `sr:controller-
// settings` window event. Defaults mirror the values that ship out of
// the box (right-stick base rates 2.4 X / 1.7 Y, rumble ON, tap-toggle
// crouch ON — matching mainstream console shooters).
const CTRL_STORAGE_KEY = 'brawl3d_controller_v1';
const CTRL_DEFAULTS = { sensX: 1.0, sensY: 1.0, vibration: true, crouchToggle: true };
export function loadControllerSettings() {
  try {
    const raw = localStorage.getItem(CTRL_STORAGE_KEY);
    if (!raw) return { ...CTRL_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      sensX: Number.isFinite(parsed.sensX) ? Math.max(0.1, Math.min(3.0, parsed.sensX)) : CTRL_DEFAULTS.sensX,
      sensY: Number.isFinite(parsed.sensY) ? Math.max(0.1, Math.min(3.0, parsed.sensY)) : CTRL_DEFAULTS.sensY,
      vibration: parsed.vibration !== false,       // default true
      crouchToggle: parsed.crouchToggle !== false, // default true
    };
  } catch {
    return { ...CTRL_DEFAULTS };
  }
}
export function saveControllerSettings(next) {
  try {
    localStorage.setItem(CTRL_STORAGE_KEY, JSON.stringify(next));
  } catch { /* quota / private mode */ }
  window.dispatchEvent(new CustomEvent('sr:controller-settings', { detail: next }));
}

export class Input3D {
  constructor() {
    this.yaw = Math.PI / 4;
    this.pitch = -0.08;
    this.assist = 1;            // gamepad stick slowdown while hovering an enemy
    this.keys = {};
    this.mouseFire = false;
    this.locked = false;
    this.wheelHeld = false;
    this._slotRequest = -1;
    this._kickEdge = false;
    this._punchLEdge = false;
    this._gunMeleeEdge = false;
    this._jumpEdge = false;
    this._climbEdge = false;
    this._sprintTapEdge = false;
    this._lightsEdge = false;      // R3 / KeyL — toggle vehicle emergency lights
    this._tauntEdge = 0;
    this._interactEdge = false;
    // Controller-settings state (see loadControllerSettings above).
    // `_crouchLatched` holds the latched crouch bool when the toggle
    // mode is on. `_crouchPrev` edges keyboard/L3 crouch input so we
    // only flip on the rising press.
    this._ctrl = loadControllerSettings();
    this._crouchLatched = false;
    this._crouchPrev = false;
    // Ring-buffer of the most recent gamepads seen — used by rumble()
    // to keep pinging the correct pad without having to look it up
    // every call.
    this._lastPad = null;
    this._onCtrlChange = (e) => {
      const next = e?.detail;
      if (!next) return;
      this._ctrl = { ...this._ctrl, ...next };
      // When switching FROM toggle mode → hold mode, clear the latched
      // crouch so the player stands up cleanly (otherwise they'd stay
      // crouched with no button held).
      if (!this._ctrl.crouchToggle) this._crouchLatched = false;
    };
    window.addEventListener('sr:controller-settings', this._onCtrlChange);
    // MK-style FLYING KICK — track double-tap W (keyboard) and
    // double-tap LB (gamepad kick) OR double-tap left-stick forward.
    // `_lastWTapT` records the most recent KeyW keydown; a second
    // tap within DOUBLE_TAP_WINDOW_S latches `_flyKickEdge`. The
    // gamepad equivalents live in the poll() gamepad-merge block.
    this._lastWTapT = -999;
    this._lastLBTapT = -999;
    this._lastStickFwdT = -999;
    this._flyKickEdge = false;
    this._gpPrev = {};
    this._onKeyDown = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 7) this._slotRequest = n - 1;
      }
      if (e.code === 'KeyK') this._kickEdge = true;
      if (e.code === 'KeyX') this._climbEdge = true;
      if (e.code === 'KeyL') this._lightsEdge = true;         // toggle vehicle emergency lights
      if (e.code === 'KeyL') this._punchLEdge = true;
      if (e.code === 'KeyF') this._gunMeleeEdge = true;
      if (e.code === 'Space') { this._jumpEdge = true; this._climbEdge = true; }
      if (e.code === 'KeyQ') this._sprintTapEdge = true;
      if (e.code === 'KeyT') this._tauntEdge = 'dance';
      if (e.code === 'KeyG') this._tauntEdge = 'flick';
      if (e.code === 'KeyY') this._tauntEdge = 'suckit';
      if (e.code === 'KeyE') this._interactEdge = true;
      // Double-tap W detection — if two W-keydowns land within
      // 0.30s, latch the flying-kick edge so the next `kick` press
      // launches the special. Uses performance.now() for a monotonic
      // clock that survives frame stalls.
      if (e.code === 'KeyW') {
        const now = performance.now() / 1000;
        if (now - this._lastWTapT < 0.30) this._flyKickEdge = true;
        this._lastWTapT = now;
      }
    };
    this._onKeyUp = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch -= e.movementY * 0.0023;
      this.pitch = Math.max(-1.2, Math.min(1.1, this.pitch));
    };
    this._onMouseDown = (e) => { if (e.button === 0 && this.locked) this.mouseFire = true; };
    this._onMouseUp = (e) => { if (e.button === 0) this.mouseFire = false; };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement != null;
      if (!this.locked) this.mouseFire = false;
    };
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('sr:controller-settings', this._onCtrlChange);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  // Poll once per frame.
  poll(dt) {
    const k = this.keys;
    let fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    let strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let jump = this._jumpEdge; this._jumpEdge = false;
    let climb = this._climbEdge; this._climbEdge = false;
    let lightsToggle = this._lightsEdge; this._lightsEdge = false;
    let crouch = !!k.KeyC;
    let walkHeld = !!k.AltLeft || !!k.AltRight;
    let fire = this.mouseFire || !!k.KeyJ || !!k.KeyZ;
    let reload = !!k.KeyR;
    let wheel = !!k.KeyB || !!k.Tab;
    let scoreboard = !!k.KeyV;
    let eat = !!k.KeyH;
    let block = !!k.KeyF;
    let sprintHeld = !!k.KeyQ || !!k.ShiftLeft || !!k.ShiftRight;
    let sprintTap = this._sprintTapEdge; this._sprintTapEdge = false;
    let kick = this._kickEdge; this._kickEdge = false;
    let gunMelee = this._gunMeleeEdge; this._gunMeleeEdge = false;
    let flyKick = this._flyKickEdge; this._flyKickEdge = false;
    let taunt = this._tauntEdge; this._tauntEdge = 0;
    let punchL = this._punchLEdge; this._punchLEdge = false;
    let lt = false;
    // Vehicle/general extras.
    let interact = this._interactEdge; this._interactEdge = false;
    let camLeftHeld  = !!k.KeyQ;          // hold to snap car cam left
    let camRightHeld = !!k.KeyE;          // hold to snap car cam right (E doubles as interact via edge above)
    let dpadDownHeld = !!k.ArrowDown;     // burger-heal trigger (must be held WHEN entering car)
    let sharpTurnHeld = !!k.ShiftLeft || !!k.ShiftRight;
    // Dedicated drive buttons — KEYBOARD: W/S (independent of left-
    // stick Y). GAMEPAD: A (button 0) accelerates, X (button 2)
    // reverses. Left-stick Y is intentionally NOT a throttle.
    let driveAccel   = !!k.KeyW;
    let driveReverse = !!k.KeyS;
    // Steering — KEYBOARD A/D, GAMEPAD left-stick X OR D-pad left/right.
    // Left-stick X tilts the front tires; A/X buttons handle the gas
    // and the reverse independently, so the car only MOVES when those
    // are pressed — the stick alone just aims the wheels.
    let driveSteer   = (k.KeyA ? -1 : 0) + (k.KeyD ? 1 : 0);

    // Gamepad merge — also feeds the MK-style flying-kick double-tap
    // detector. Two acceptable double-tap paths on controller:
    //   • Left-stick FORWARD (ly < -0.75) two rising edges within 0.30s
    //   • LB button (kick) two edges within 0.30s
    // Either path latches `_flyKickEdge` so the engine trigger works
    // identically to the keyboard's double-tap-W path.
    const nowT = performance.now() / 1000;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this._lastPad = p;   // cache for rumble()
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      const rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
      if (Math.abs(ly) > 0) fwd = -ly;
      if (Math.abs(lx) > 0) strafe = lx;
      // Analog stick magnitude → WALK modifier. Partial deflection
      // (< 55% tilt) reads as "walk slow" for stealth / precision.
      // Anything past 55% is a JOG (default). Sprint modifier (RB)
      // overrides walk regardless of stick magnitude.
      const stickMag = Math.hypot(lx, ly);
      if (stickMag > 0.05 && stickMag < 0.55) walkHeld = true;
      // Stick-forward rising-edge tracker (fires when ly crosses from
      // near-neutral into the deep-forward zone — mimics a "tap" of
      // W rather than the stick simply being HELD forward).
      const stickFwdDeep = ly < -0.75;
      if (stickFwdDeep && !this._gpPrev.fwdDeep) {
        if (nowT - this._lastStickFwdT < 0.30) this._flyKickEdge = true;
        this._lastStickFwdT = nowT;
      }
      this.yaw -= rx * 2.4 * dt * this.assist * this._ctrl.sensX;
      this.pitch -= ry * 1.7 * dt * this.assist * this._ctrl.sensY;
      this.pitch = Math.max(-1.2, Math.min(1.1, this.pitch));
      const rt = !!(p.buttons[7]?.pressed || p.buttons[7]?.value > 0.4);
      const ltb = !!(p.buttons[6]?.pressed || p.buttons[6]?.value > 0.4);
      const lb = !!p.buttons[4]?.pressed;
      const rb = !!p.buttons[5]?.pressed;
      if (rt) fire = true;
      if (ltb) lt = true;
      if (ltb && !this._gpPrev.lt) punchL = true;          // edge → left punch (fists)
      if (lb && !this._gpPrev.lb) {
        kick = true;                                        // LB edge → kick
        // Double-tap LB detector — a rapid pair of kick edges fires
        // the flying-kick special (the natural gamepad equivalent to
        // double-tap-W on keyboard).
        if (nowT - this._lastLBTapT < 0.30) this._flyKickEdge = true;
        this._lastLBTapT = nowT;
      }
      if (rb) sprintHeld = true;                           // RB hold → sprint
      if (rb && !this._gpPrev.rb) sprintTap = true;        // RB tap → economic sprint
      if (p.buttons[0]?.pressed) reload = true;            // A → reload
      if (p.buttons[2]?.pressed && !this._gpPrev.x) { climb = true; jump = true; }   // X edge → climb / vault / jump
      if (p.buttons[1]?.pressed) wheel = true;             // B hold → weapon wheel
      if (p.buttons[8]?.pressed) scoreboard = true;        // Back → scoreboard
      if (p.buttons[13]?.pressed) eat = true;              // dpad-down hold → eat
      if (p.buttons[10]?.pressed) crouch = true;           // L3 (stick click) hold → crouch
      // R3 (right stick click, button 11) — edge → toggle emergency
      // lights on the Quota (special-variant police cruiser). Also
      // works on any future vehicle that reads `cmd.lightsToggle`.
      if (p.buttons[11]?.pressed && !this._gpPrev.r3) this._lightsEdge = true;
      if (p.buttons[14]?.pressed && !this._gpPrev.dl) taunt = 'dance';    // dpad-left → 90s dance
      if (p.buttons[15]?.pressed && !this._gpPrev.dr) taunt = 'flick';    // dpad-right → flick 'em off
      if (p.buttons[12]?.pressed && !this._gpPrev.du) taunt = 'suckit';   // dpad-up → DX suck it
      if (p.buttons[3]?.pressed && !this._gpPrev.y) interact = true;      // Y edge → enter/exit car
      if (lb) camLeftHeld = true;
      if (rb) camRightHeld = true;
      if (ltb) sharpTurnHeld = true;
      if (p.buttons[13]?.pressed) dpadDownHeld = true;
      if (p.buttons[0]?.pressed) driveAccel = true;     // A → drive forward
      if (p.buttons[2]?.pressed) driveReverse = true;   // X → reverse
      if (p.buttons[14]?.pressed) driveSteer = -1;      // DPad-left → steer left
      if (p.buttons[15]?.pressed) driveSteer =  1;      // DPad-right → steer right
      // Left-stick X aims the tires. Falls through to driveSteer ONLY
      // if no D-pad / keyboard input is overriding (so digital wins
      // when the player is using them together).
      if (driveSteer === 0 && Math.abs(lx) > 0) driveSteer = lx;
      this._gpPrev = {
        lt: ltb, lb, rb, x: !!p.buttons[2]?.pressed,
        dl: !!p.buttons[14]?.pressed, dr: !!p.buttons[15]?.pressed, du: !!p.buttons[12]?.pressed,
        y: !!p.buttons[3]?.pressed,
        r3: !!p.buttons[11]?.pressed,
        fwdDeep: (dz(p.axes[1] || 0) < -0.75),
      };
    }

    this.wheelHeld = wheel;
    const slotRequest = this._slotRequest;
    this._slotRequest = -1;

    // ── Crouch toggle mode (console-shooter style) ───────────
    // When `crouchToggle` is ON (default), a rising edge on any
    // crouch input (KeyC / Shift / Ctrl / L3) flips a latched
    // bool — press once to crouch, press again to stand up.
    // When OFF, crouch is a raw hold (legacy behavior).
    if (this._ctrl.crouchToggle) {
      if (crouch && !this._crouchPrev) this._crouchLatched = !this._crouchLatched;
      this._crouchPrev = crouch;
      crouch = this._crouchLatched;
    } else {
      this._crouchPrev = crouch;
      // Keep the latched value in sync so the very first press after
      // switching modes doesn't jump into an unexpected state.
      this._crouchLatched = crouch;
    }

    return {
      fwd, strafe, jump, climb, crouch, fire, reload, eat, block, lt,
      sprintHeld, sprintTap, walkHeld, kick, punchL, gunMelee, taunt, flyKick,
      wheel, scoreboard, slotRequest,
      interact, camLeftHeld, camRightHeld, dpadDownHeld, sharpTurnHeld,
      driveAccel, driveReverse, driveSteer, lightsToggle,
      yaw: this.yaw, pitch: this.pitch,
    };
  }

  // ── Gamepad rumble ───────────────────────────────────────
  // Fires a dual-rumble pulse on the most recently seen connected
  // gamepad. No-ops silently when vibration is disabled by the user
  // or when the browser/pad doesn't expose vibrationActuator.
  //   strength ∈ [0..1]  → intensity of both motors
  //   ms                 → duration in milliseconds
  // Split ratio biases the strong motor slightly for a satisfying
  // "thud" on hits without over-buzzing.
  rumble(strength = 0.6, ms = 120) {
    if (!this._ctrl.vibration) return;
    const p = this._lastPad;
    if (!p) return;
    // Re-fetch the live pad object from the API — the cached snapshot
    // is a copy and its actuator ref stays valid but calling on the
    // fresh handle is safer across browsers.
    const live = navigator.getGamepads ? navigator.getGamepads()[p.index] : null;
    const pad = live || p;
    const act = pad?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    const s = Math.max(0, Math.min(1, strength));
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(20, Math.min(1000, ms | 0)),
        weakMagnitude: s * 0.85,
        strongMagnitude: s,
      });
    } catch { /* browser rejected effect — ignore */ }
  }
}
