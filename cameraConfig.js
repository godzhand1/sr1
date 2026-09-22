// render/cameraConfig.js — third-person camera presets.
//  HIGH  : camera sits ABOVE the player, almost centred behind them; the
//          crosshair is dead-centre and floats above the head (pivot 0.55 m
//          over the head), body fills the lower-centre of the frame.
//  GEARS : tight over-the-right-shoulder, body on the left, ~80° horizontal.
//  SR1   : the wider classic rig.
// `pivotUp` is metres above the head for the look-through point; `shoulder`
// is the lateral offset (right of aim) — 0 = perfectly centred.
export const CAMERA_PRESETS = {
  high:  { label: 'HIGH (centered)', fov: 52, fovAim: 44, dist: 3.2, distAim: 2.4, shoulder: 0.22, shoulderAim: 0.18, pivotUp: 0.55 },
  gears: { label: 'GEARS (close)',   fov: 50, fovAim: 43, dist: 2.6, distAim: 1.9, shoulder: 0.7,  shoulderAim: 0.55, pivotUp: -0.2 },
  sr1:   { label: 'SR1 classic',     fov: 72, fovAim: 72, dist: 3.6, distAim: 3.2, shoulder: 0.85, shoulderAim: 0.45, pivotUp: 0.30 },
};
export const DEFAULT_CAMERA = 'high';

// Video-settings blob → live camera numbers (distance / fov / height sliders override the preset).
export function resolveCamera(v = {}) {
  const p = CAMERA_PRESETS[v.camera] || CAMERA_PRESETS[DEFAULT_CAMERA];
  const dist = Number.isFinite(v.camDist) ? v.camDist : p.dist;
  const fov = Number.isFinite(v.fov) ? v.fov : p.fov;
  const pivotUp = Number.isFinite(v.camUp) ? v.camUp : p.pivotUp;
  return { ...p, dist, distAim: Math.max(1.4, dist - (p.dist - p.distAim)), fov, fovAim: Math.max(30, fov - (p.fov - p.fovAim)), pivotUp };
}
