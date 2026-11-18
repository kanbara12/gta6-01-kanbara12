// Vehicle driving controller for SUNCOAST: HEATLINE.
// One clear job: turn player input into believable car motion — engine
// torque curve, braking / reverse, speed-sensitive steering, grip + handbrake
// drift, spring-damper suspension (pitch on accel/brake, roll in turns),
// collision bounce + damage, and the camera parameters the chase cam uses.
//
// This module NEVER touches the DOM or the network and NEVER edits main.js:
// the coordinator wires it in with the exact snippet in INTEGRATION.md.
// Units: world units ≈ metres, speeds in units/second.

import * as THREE from 'three';
import { WORLD, clamp, lerp } from '../core/config.js';
import { setBrakeLights, applyDamage } from './models.js';

const DEFAULT_BOUNDS = { minX: -WORLD.half, maxX: 150, minZ: -WORLD.half, maxZ: WORLD.half };

function getDrive(car) {
  const u = car.userData;
  if (!u.drive) {
    u.drive = {
      steerAngle: 0, pitch: 0, roll: 0, pitchVel: 0, rollVel: 0,
      drift: 0, braking: false, reversing: false, lastAccel: 0,
      yawRate: 0, collided: false, impact: 0,
    };
  }
  return u.drive;
}

// ---------------------------------------------------------------- car-vs-car
// D-QA2: driveVehicle used to check buildings only, so the player car drove
// straight through stopped traffic. Cars are oriented rectangles in the XZ
// plane (length along the facing yaw, width across it); a circle test would
// false-positive on oncoming traffic in the next lane (lanes are 5.4 apart,
// two half-widths only ~2.2), so this is a small SAT test instead.

/** Footprint of a car at a proposed position: centre, yaw, half extents. */
function carRect(car, x, z) {
  const spec = (car.userData && car.userData.spec) || {};
  return {
    x, z, yaw: car.rotation.y,
    hl: (spec.length || 4.25) / 2,
    hw: (spec.width || 2.15) / 2,
  };
}

/** Separating-axis overlap test for two car footprints. */
function rectsOverlap(a, b) {
  const axes = [
    [Math.sin(a.yaw), Math.cos(a.yaw)],
    [Math.cos(a.yaw), -Math.sin(a.yaw)],
    [Math.sin(b.yaw), Math.cos(b.yaw)],
    [Math.cos(b.yaw), -Math.sin(b.yaw)],
  ];
  for (const [ax, az] of axes) {
    const pa = a.x * ax + a.z * az;
    const pb = b.x * ax + b.z * az;
    const ra = a.hl * Math.abs(Math.sin(a.yaw) * ax + Math.cos(a.yaw) * az)
      + a.hw * Math.abs(Math.cos(a.yaw) * ax - Math.sin(a.yaw) * az);
    const rb = b.hl * Math.abs(Math.sin(b.yaw) * ax + Math.cos(b.yaw) * az)
      + b.hw * Math.abs(Math.cos(b.yaw) * ax - Math.sin(b.yaw) * az);
    if (Math.abs(pa - pb) > ra + rb) return false;
  }
  return true;
}

/**
 * The other cars the driven car can hit. Prefer an explicit list
 * (env.collidesCars — traffic + police, passed by the caller); without one,
 * fall back to the driven car's scene siblings that are vehicles
 * (makeVehicle sets userData.spec). Characters, buildings and the mission
 * marker have no spec, so they never match. Traffic / police AI is untouched
 * by this — they still brake, yield and overtake on their own logic; this
 * only stops the *driven* car from passing through them.
 */
function otherCars(car, env) {
  if (Array.isArray(env.collidesCars)) {
    return env.collidesCars.filter((o) => o && o !== car);
  }
  const parent = car.parent;
  if (!parent || !parent.children) return [];
  return parent.children.filter((o) => o !== car && o.userData && o.userData.spec);
}

/**
 * Drive one car for one frame.
 *
 * @param {THREE.Group} car — a makeVehicle()/makeCar() group.
 * @param {object} input — { forward, back, left, right, handbrake } booleans
 *   (W/S/A/D + Space). `forward`/`back` may also be 0..1 magnitudes.
 * @param {number} dt — frame time, seconds (clamped to 0.05 inside).
 * @param {object} [env] — { collides(x, z, r): boolean, bounds,
 *   collidesCars?: Array<THREE.Group> }.
 *   Pass collidesBuilding bound to the world buildings; when omitted the car
 *   only respects the world bounds (traffic never needs it, the player does).
 *   collidesCars lists the traffic + police cars to collide with; when
 *   omitted, the driven car's scene siblings that are vehicles are used.
 * @returns {{ collided: boolean, impact: number, speed: number, braking: boolean }}
 */
export function driveVehicle(car, input, dt, env = {}) {
  const u = car.userData;
  const spec = u.spec;
  const d = getDrive(car);
  dt = clamp(dt, 0, 0.05);

  const throttle = input.forward ? 1 : 0;
  const wantReverse = !!input.back;
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const handbrake = !!input.handbrake;

  // --- damage degrades the car: slower, weaker, pulls to one side ---
  const dmg = u.damage || 0;
  const topSpeed = spec.topSpeed * (1 - 0.42 * dmg);
  const accel = spec.accel * (1 - 0.5 * dmg);
  const grip = spec.grip * (1 - 0.3 * dmg);
  const steerPull = dmg * 0.1 * (u.damageSide || 1); // rad/s bias while moving

  let speed = u.speed || 0;
  const movingFwd = speed > 0.4;
  const movingBack = speed < -0.4;

  // --- longitudinal: engine curve, brake, reverse, drag ---
  let longitudinalAccel = 0;
  d.braking = false;
  d.reversing = false;
  if (throttle) {
    // Engine torque falls off as speed approaches the top (quadratic curve
    // so the car still creeps up to ~95% of its nominal top speed).
    const ratio = clamp(speed / topSpeed, 0, 1);
    longitudinalAccel += accel * (1 - ratio * ratio);
  }
  if (wantReverse) {
    if (movingFwd) {
      longitudinalAccel -= spec.brake; // S while rolling forward = brake
      d.braking = true;
    } else {
      const rRatio = clamp(-speed / spec.reverseTop, 0, 1);
      longitudinalAccel -= accel * 0.8 * (1 - rRatio * rRatio);
      d.reversing = true;
    }
  }
  // Rolling resistance + aerodynamic drag (keeps the top speed honest).
  longitudinalAccel -= speed * 0.02 + Math.sign(speed) * 0.0008 * speed * speed;
  // Handbrake: heavy rear lock-up, bleeds speed fast.
  if (handbrake && Math.abs(speed) > 1) longitudinalAccel -= Math.sign(speed) * 7;
  speed += longitudinalAccel * dt;
  speed = clamp(speed, -spec.reverseTop, topSpeed);
  if (!throttle && !wantReverse && Math.abs(speed) < 0.25) speed = 0; // settle
  d.lastAccel = longitudinalAccel;

  // --- steering: angle target shrinks with speed, then yaw from bicycle model ---
  const steerMax = spec.steerMax / (1 + Math.abs(speed) * 0.045);
  const steerTarget = steerInput * steerMax;
  const steerRate = 6.5; // rad/s of steering-wheel travel
  d.steerAngle += clamp(steerTarget - d.steerAngle, -steerRate * dt, steerRate * dt);
  let yawRate = (speed / spec.wheelbase) * Math.tan(d.steerAngle) * grip;
  if (handbrake && Math.abs(speed) > 4) yawRate *= 1.7; // tail steps out
  yawRate = clamp(yawRate, -2.6, 2.6);
  d.yawRate = yawRate;
  car.rotation.y += (yawRate + steerPull * Math.sign(speed || 1) * (Math.abs(speed) > 1 ? 1 : 0)) * dt;

  // --- suspension: pitch (dive/squat) + roll, spring-damper toward target ---
  const pitchTarget = clamp(-longitudinalAccel * 0.012, -0.055, 0.07);
  const rollTarget = clamp(-yawRate * Math.abs(speed) * 0.006, -0.1, 0.1)
    + (handbrake ? steerInput * 0.05 : 0);
  const k = 42, c = 11; // spring stiffness / damping
  d.pitchVel += ((pitchTarget - d.pitch) * k - d.pitchVel * c) * dt;
  d.pitch += d.pitchVel * dt;
  d.rollVel += ((rollTarget - d.roll) * k - d.rollVel * c) * dt;
  d.roll += d.rollVel * dt;
  d.drift = lerp(d.drift, handbrake && Math.abs(speed) > 4 ? steerInput * 0.12 : 0, Math.min(1, dt * 5));

  // --- integrate position + collision (bounce + damage on impact) ---
  const dx = Math.sin(car.rotation.y) * speed * dt;
  const dz = Math.cos(car.rotation.y) * speed * dt;
  const bounds = env.bounds || DEFAULT_BOUNDS;
  const nx = clamp(car.position.x + dx, bounds.minX, bounds.maxX);
  const nz = clamp(car.position.z + dz, bounds.minZ, bounds.maxZ);
  const collides = env.collides || null;
  let collided = false;
  let impact = 0;
  // Car-vs-car, checked at the proposed position (D-QA2). Only a *new*
  // overlap blocks: a car already overlapping (a police ram while parked,
  // a traffic car that pulled alongside) must be able to separate, or the
  // player could wedge stuck with no escape.
  const others = otherCars(car, env);
  const myNow = carRect(car, car.position.x, car.position.z);
  const myNext = carRect(car, nx, nz);
  const hitsCar = others.some((o) => {
    const ob = carRect(o, o.position.x, o.position.z);
    return !rectsOverlap(myNow, ob) && rectsOverlap(myNext, ob);
  });
  if (collides && collides(nx, nz, 1.6)) {
    impact = Math.abs(speed);
    collided = true;
    speed *= -0.22; // bounce off the wall
    if (impact > 3) applyDamage(car, Math.min(28, impact * 1.1), Math.sign(dx + dz) || 1);
    // Stay put this frame: the next frame drives away from the wall.
  } else if (hitsCar) {
    impact = Math.abs(speed);
    collided = true;
    speed *= -0.22; // bounce off the other car, same as a wall
    if (impact > 3) applyDamage(car, Math.min(12, impact * 0.8), Math.sign(dx + dz) || 1);
    // Stay put this frame; the other car is untouched (its own AI owns it).
  } else {
    car.position.x = nx;
    car.position.z = nz;
  }
  u.speed = speed;
  d.collided = collided;
  d.impact = impact;

  // --- visuals: wheels, steer, body lean, brake lights ---
  updateVehicleVisuals(car, dt, steerInput);
  setBrakeLights(car, d.braking || (handbrake && Math.abs(speed) > 1));
  return { collided, impact, speed, braking: d.braking };
}

/**
 * Per-frame visuals for any car (player, traffic, police): wheel spin +
 * front-wheel steering, body pitch/roll from the drive state, police light
 * bar blink, headlight flicker when heavily damaged. Kept separate from
 * driveVehicle() so traffic/police (which don't use the controller) share it.
 */
export function updateVehicleVisuals(car, dt, turnInput = 0) {
  const u = car.userData;
  const d = u.drive || { steerAngle: 0, pitch: 0, roll: 0 };
  const spin = ((u.speed || 0) * dt) / 0.43;
  if (u.wheelPivots) {
    for (const p of u.wheelPivots) {
      const wheel = p.children[0];
      if (wheel) wheel.rotation.x += spin;
    }
    // Front wheels steer with the controller angle (or the passed turn input
    // for cars driven by the old animateCar path).
    const steerVis = u.drive ? d.steerAngle : turnInput * 0.4;
    for (const p of u.frontWheels || []) p.rotation.y = steerVis;
  } else if (u.wheels) {
    // v1 shape: bare wheel meshes, no pivots.
    for (const w of u.wheels) w.rotation.x += spin;
  }
  // Body lean: roll from the suspension state, pitch from accel/brake.
  const targetLean = u.drive
    ? d.roll
    : clamp(-turnInput * Math.abs(u.speed || 0) * 0.006, -0.09, 0.09);
  u.lean = lerp(u.lean || 0, targetLean, Math.min(1, dt * 8));
  if (u.body && u.body !== car) {
    // Lean + the permanent damage kink (applyDamage sets the kink angle;
    // it is re-applied here every frame so lean never erases it).
    u.body.rotation.z = u.lean + (u.damage || 0) * 0.05 * (u.damageSide || 1);
    u.body.rotation.x = u.drive ? d.pitch : 0;
  }
  // Police light bar.
  if (u.policeCar && u.lightRed && u.lightBlue) {
    u.lightPhase = (u.lightPhase || 0) + dt;
    const on = Math.floor(u.lightPhase / 0.28) % 2 === 0;
    u.lightRed.material.color.setHex(on ? 0xff334f : 0x550000);
    u.lightBlue.material.color.setHex(on ? 0x0a2a44 : 0x32baff);
  }
  // Heavy damage: the surviving headlight flickers.
  if ((u.damage || 0) > 0.55 && u.headMat && u.headlightsOn) {
    u.headMat.emissiveIntensity = Math.random() < 0.12 ? 0.3 : 2.4;
  }
}

/**
 * Chase-camera parameters for the driven car. Distance/height come from the
 * vehicle type (trucks sit the camera higher and further back); FOV widens
 * with speed for a sense of velocity. The coordinator lerps the live camera
 * toward these values — see INTEGRATION.md for the exact wiring.
 */
export function vehicleCameraParams(car) {
  const u = car.userData;
  const spec = u.spec || { camDist: 9, camHeight: 4.8, topSpeed: 26 };
  const speedRatio = clamp(Math.abs(u.speed || 0) / spec.topSpeed, 0, 1);
  return {
    distance: spec.camDist + speedRatio * 1.6,
    height: spec.camHeight + speedRatio * 0.5,
    fov: 68 + speedRatio * 9,
    lookHeight: 1.2,
  };
}

/** Smooth-step a camera param set toward a target (call every frame). */
export function smoothCameraParams(prev, target, dt) {
  const t = 1 - Math.pow(0.0015, dt);
  return {
    distance: lerp(prev.distance, target.distance, t),
    height: lerp(prev.height, target.height, t),
    fov: lerp(prev.fov, target.fov, t),
    lookHeight: lerp(prev.lookHeight, target.lookHeight, t),
  };
}

/** Reset a car's drive state (used on enter/exit and on repair). */
export function resetDriveState(car) {
  if (car.userData) car.userData.drive = null;
}
