// Vehicles for SUNCOAST: HEATLINE.
// One clear job: the public vehicle API — building cars, driving visuals,
// ambient traffic, and police pursuit. The detailed work lives in the
// sibling modules: models.js (detailed bodies per type + lights + damage),
// driving.js (the player driving controller), traffic.js (lane-aware AI).
// This file keeps the v1 contract intact:
//   makeCar(color, policeCar) -> Group (.position/.rotation.y, userData
//   { speed, health }); animateCar(car, dt, turn); spawnTraffic(scene);
//   updateTraffic(traffic, playerCar, dt); updatePolice(...);
//   spawnPoliceCar(scene, actorPos, rng, buildings).
// Police pursuit behaviour is owned by the AI specialist — updatePolice and
// spawnPoliceCar below are unchanged from v1; do not edit them here.

import { clamp } from '../core/config.js';
import { collidesBuilding, hasLineOfSight, nearestRoadCoord } from '../world/world.js';
import {
  makeVehicle, setBrakeLights, setHeadlights, attachHeadlightBeams,
  applyDamage, repairVehicle, loadVehicleGLB, VEHICLE_TYPES,
} from './models.js';
import { driveVehicle, updateVehicleVisuals, vehicleCameraParams, smoothCameraParams } from './driving.js';
import { spawnTrafficCars, updateTrafficCars, laneOffset } from './traffic.js';

export {
  makeVehicle, setBrakeLights, setHeadlights, attachHeadlightBeams,
  applyDamage, repairVehicle, loadVehicleGLB, VEHICLE_TYPES,
  driveVehicle, vehicleCameraParams, smoothCameraParams,
  spawnTrafficCars, updateTrafficCars, laneOffset,
};

/**
 * makeCar(color, policeCar, type) -> detailed Group.
 * Default type is 'sedan' (the v1 look, rebuilt with bodywork, glasshouse,
 * wheels + rims, bumpers, mirrors and working lights). The player car in
 * main.js keeps calling makeCar(0x1e8291) unchanged.
 */
export function makeCar(color = 0x2f788b, policeCar = false, type = 'sedan') {
  const carType = policeCar ? 'police' : type;
  return makeVehicle(carType, color, policeCar);
}

/** Spin wheels, steer the fronts, lean the body, blink the light bar. */
export function animateCar(car, dt, turnInput = 0) {
  updateVehicleVisuals(car, dt, turnInput);
}

/** Ambient traffic: 18 cars of mixed types on the road grid. */
export function spawnTraffic(scene, seed = 21) {
  return spawnTrafficCars(scene, seed);
}

/** Lane-aware traffic update (spacing, intersections, yield, turns, overtake). */
export function updateTraffic(traffic, playerCar, dt) {
  updateTrafficCars(traffic, playerCar, dt);
}

/**
 * Police pursuit with building collision avoidance and line of sight.
 *
 * Steering target: the player when line of sight is clear, otherwise the
 * nearest road intersection on the way to the player's last seen position —
 * so a police car routes around blocks on the road grid instead of driving
 * through buildings. Movement itself is also building-clamped with a slide.
 *
 * Anti-freeze (QA defect D1): a unit wedged into a building corner ends up
 * with both move axes blocked and its speed damped to ~0 while steering at
 * the same target every frame — a permanent freeze. Each unit therefore
 * tracks its real displacement: barely moving for 0.8 s while the player is
 * far away triggers a 1.4 s reverse-out with a turn, then it re-engages.
 * The cycle repeats if it wedges again, so a freeze can never be permanent.
 */
export function updatePolice(police, buildings, actorPos, wanted, dt, onRam) {
  for (const c of police) {
    const u = c.userData;
    const dx = actorPos.x - c.position.x;
    const dz = actorPos.z - c.position.z;
    const dist = Math.hypot(dx, dz);
    if (u.stuckTimer === undefined) {
      u.stuckTimer = 0; u.unstick = 0; u.unstickDir = 1;
      u.lastPX = c.position.x; u.lastPZ = c.position.z;
    }
    const moved = Math.hypot(c.position.x - u.lastPX, c.position.z - u.lastPZ);
    u.lastPX = c.position.x; u.lastPZ = c.position.z;
    if (u.unstick > 0) {
      // Back out of the corner while turning, then re-engage.
      // Ring escape: a unit sitting inside the 1.6 clearance ring cannot
      // move at all under the normal margin check (every nearby step still
      // collides), so while unsticking it only has to stay out of the
      // building core itself (radius 0) — the clearance ring is free to
      // cross on the way out.
      u.unstick -= dt;
      u.speed = -7;
      c.rotation.y += u.unstickDir * 2.2 * dt;
      const escapeMargin = collidesBuilding(buildings, c.position.x, c.position.z, 1.6) ? 0 : 1.6;
      const nx = c.position.x + Math.sin(c.rotation.y) * u.speed * dt;
      const nz = c.position.z + Math.cos(c.rotation.y) * u.speed * dt;
      if (!collidesBuilding(buildings, nx, c.position.z, escapeMargin)) c.position.x = nx;
      if (!collidesBuilding(buildings, c.position.x, nz, escapeMargin)) c.position.z = nz;
      c.position.x = clamp(c.position.x, -163, 150);
      c.position.z = clamp(c.position.z, -163, 163);
      if (u.unstick <= 0) { u.stuckTimer = 0; u.speed = 0; }
      animateCar(c, dt, u.unstickDir);
      continue;
    }
    if (moved < 0.05 && dist > 8) {
      u.stuckTimer += dt;
      if (u.stuckTimer > 0.8) {
        u.unstick = 1.4;
        u.unstickDir = (((c.position.x * 7 + c.position.z * 13) % 2) + 2) % 2 < 1 ? 1 : -1;
      }
    } else {
      u.stuckTimer = Math.max(0, u.stuckTimer - dt * 2);
    }
    let tx = actorPos.x;
    let tz = actorPos.z;
    const seesPlayer = hasLineOfSight(buildings, c.position.x, c.position.z, actorPos.x, actorPos.z);
    if (!seesPlayer) {
      // Route via the road grid: head for the intersection nearest the player
      // that is also nearest to this car, one leg at a time — axis-aligned,
      // staying on the road the car is already nearest to first, so the car
      // never cuts diagonally across a block corner.
      tx = nearestRoadCoord(actorPos.x);
      tz = nearestRoadCoord(actorPos.z);
      const carRoadX = nearestRoadCoord(c.position.x);
      const carRoadZ = nearestRoadCoord(c.position.z);
      if (Math.abs(c.position.x - carRoadX) <= Math.abs(c.position.z - carRoadZ)) {
        tx = carRoadX; // first leg: along the car's vertical road
      } else {
        tz = carRoadZ; // first leg: along the car's horizontal road
      }
    }
    const tdx = tx - c.position.x;
    const tdz = tz - c.position.z;
    const target = Math.atan2(tdx, tdz);
    let delta = ((target - c.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    c.rotation.y += clamp(delta, -2.4 * dt, 2.4 * dt);
    c.userData.speed = clamp(c.userData.speed + dt * 10, 0, 12 + wanted * 1.5);
    const nx = c.position.x + Math.sin(c.rotation.y) * c.userData.speed * dt;
    const nz = c.position.z + Math.cos(c.rotation.y) * c.userData.speed * dt;
    // Building avoidance: slide along the blocked axis, never pass through.
    // Ring escape (same rule as the unstick branch): a unit already inside
    // the clearance ring may cross the ring to get out, it just must not
    // enter the building core itself.
    const margin = collidesBuilding(buildings, c.position.x, c.position.z, 1.6) ? 0 : 1.6;
    if (!collidesBuilding(buildings, nx, c.position.z, margin)) c.position.x = nx;
    else c.userData.speed *= 0.6;
    if (!collidesBuilding(buildings, c.position.x, nz, margin)) c.position.z = nz;
    else c.userData.speed *= 0.6;
    c.position.x = clamp(c.position.x, -163, 150);
    c.position.z = clamp(c.position.z, -163, 163);
    animateCar(c, dt, Math.sign(delta));
    if (dist < 4.2 && seesPlayer) onRam(dt);
  }
}

/**
 * Spawn one police car at a random bearing, 48 units from the actor.
 * The spawn point is validated clear of buildings (margin 2.2, above the
 * 1.6 collision radius); after 8 blocked tries it falls back to the
 * nearest road intersection, which is always clear of buildings.
 */
export function spawnPoliceCar(scene, actorPos, rng, buildings = null) {
  const c = makeCar(0x172d49, true);
  let x = 0;
  let z = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    x = clamp(actorPos.x + Math.cos(angle) * 48, -150, 150);
    z = clamp(actorPos.z + Math.sin(angle) * 48, -150, 150);
    if (!buildings || !collidesBuilding(buildings, x, z, 2.2)) break;
    if (attempt === 7) {
      x = nearestRoadCoord(x);
      z = nearestRoadCoord(z);
    }
  }
  c.position.set(x, 0, z);
  c.userData.speed = 0;
  scene.add(c);
  return c;
}
