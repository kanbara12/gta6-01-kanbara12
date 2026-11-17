// Input for SUNCOAST: HEATLINE.
// One clear job: keyboard state, pointer-lock mouse look, and the click-to-fire
// / click-to-lock rules. No game logic lives here — main.js reads the state.

import { clamp } from './config.js';

export function createInput(canvas, callbacks) {
  const keys = {};
  let cameraYaw = 0;
  let cameraPitch = 0.24;

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    callbacks.onKey(e.code, e.repeat);
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  canvas.addEventListener('click', () => {
    if (callbacks.isPlaying() && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      cameraYaw -= e.movementX * 0.0024;
      cameraPitch = clamp(cameraPitch - e.movementY * 0.0015, -0.1, 0.8);
    }
  });
  addEventListener('mousedown', (e) => {
    if (e.button === 0 && callbacks.isPlaying() && document.pointerLockElement === canvas) {
      callbacks.onFire();
    }
  });
  addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    keys,
    get cameraYaw() { return cameraYaw; },
    set cameraYaw(v) { cameraYaw = v; },
    get cameraPitch() { return cameraPitch; },
    lockPointer() { canvas.requestPointerLock?.(); },
  };
}
