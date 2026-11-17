// Pedestrian AI for SUNCOAST: HEATLINE.
// One clear job: how pedestrians walk the sidewalks and how they react to
// danger — gunfire, a car bearing down on them, a crime committed in front
// of them.
//
// DROP-IN REPLACEMENT for updatePedestrians in characters.js: the
// 4-argument call updatePedestrians(peds, buildings, dt, gunfire) behaves
// exactly as before (same userData fields, same D2 fixes). The 5th argument
// `opts` is optional and unlocks the new reactions; the coordinator passes
// it, old callers keep working.
//
// States (stored on ped.userData.state):
// - 'stroll'  sidewalk loop, turns at map edges / when blocked, picks a
//             new direction instead of pushing into a wall forever.
// - 'flee'    gunfire: run away from the shot for 3 s on a FIXED heading
//             (D2 fix — recomputing every frame makes peds oscillate
//             against a wall); wedged while fleeing, turn 90 degrees.
// - 'panic'   a car is about to hit them: same run-away, but away from the
//             car and faster to clear the lane.
// - 'cower'   gunfire very close (< 9 units): freeze in place 1.5 s, then
//             flee. Reads as shock before the run, and keeps peds from
//             sprinting straight through the shooter.
// - Witness: a fleeing ped who saw the shot can raise the alarm once per
//   incident (opts.onWitness, 12 s cooldown per ped). The coordinator
//   decides what that means (main.js: triggerWanted(1)); this module
//   never touches G.wanted itself.

import * as THREE from 'three';
import { WORLD } from '../core/config.js';
import { collidesBuilding } from '../world/world.js';
import { animateWalk, animateIdle } from '../characters/characters.js';
// No import cycle: characters.js does not import this module.

export const PED_FLEE_SECONDS = 3;
export const PED_COWER_RADIUS = 9;
export const PED_NEAR_MISS_RADIUS = 7;
export const PED_WITNESS_RADIUS = 30;
export const PED_WITNESS_COOLDOWN = 12;

/** Current behaviour state of a pedestrian ('stroll' | 'flee' | 'panic' | 'cower'). */
export function pedestrianState(ped) {
  return ped.userData.state || 'stroll';
}

/** Force a pedestrian to flee from a point (used by combat / missions hooks). */
export function setPedestrianPanic(ped, fromX, fromZ, seconds = PED_FLEE_SECONDS) {
  const u = ped.userData;
  const dx = ped.position.x - fromX;
  const dz = ped.position.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  u.fleeDX = dx / len;
  u.fleeDZ = dz / len;
  u.flee = seconds;
  u.state = 'panic';
  u.stateTimer = seconds;
}

function startFlee(ped, fromX, fromZ, seconds, state) {
  const u = ped.userData;
  const dx = ped.position.x - fromX;
  const dz = ped.position.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  u.fleeDX = dx / len;
  u.fleeDZ = dz / len;
  u.flee = seconds;
  u.state = state;
  u.stateTimer = seconds;
  u.pedStuck = 0;
}

/**
 * Pedestrian update: stroll along the sidewalk; on gunfire, run away from
 * the shot for a few seconds (cowering first if the shot is very close).
 * Never walks through buildings or off the map.
 *
 * @param {object[]} peds - characters from spawnPedestrians (characters.js)
 * @param {object[]} buildings - world building footprints
 * @param {number} dt - frame delta, seconds
 * @param {object|null} gunfire - {x, z} of the latest shot, or null
 * @param {object} [opts] - optional new reactions:
 *   opts.playerCar {position, speed} — near-miss panic when a fast car
 *     closes in; opts.onWitness(ped) — called once per ped per incident
 *     when a fleeing ped is within PED_WITNESS_RADIUS of the gunfire.
 */
export function updatePedestrians(peds, buildings, dt, gunfire, opts = {}) {
  for (const p of peds) {
    const u = p.userData;
    if (u.state === undefined) u.state = 'stroll';
    if (u.stateTimer === undefined) u.stateTimer = 0;
    if (u.witnessCooldown === undefined) u.witnessCooldown = 0;
    if (u.strollStuck === undefined) u.strollStuck = 0;
    if (u.witnessCooldown > 0) u.witnessCooldown -= dt;

    if (gunfire) {
      const gdx = p.position.x - gunfire.x;
      const gdz = p.position.z - gunfire.z;
      const gdist = Math.hypot(gdx, gdz);
      if (gdist < PED_COWER_RADIUS && u.state !== 'flee' && u.state !== 'panic') {
        // Shock first: freeze, then run.
        u.state = 'cower';
        u.stateTimer = 1.5;
        u.flee = 0;
      } else if (u.state !== 'cower') {
        // Fix the flee direction at gunfire time: recomputing it every frame
        // from the current position makes a pedestrian sliding along a wall
        // oscillate in place instead of running clear. (D2 fix, kept.)
        startFlee(p, gunfire.x, gunfire.z, PED_FLEE_SECONDS, 'flee');
      }
      // Witness: saw the shot up close and is running — raise the alarm.
      if (opts.onWitness && gdist < PED_WITNESS_RADIUS && u.witnessCooldown <= 0) {
        u.witnessCooldown = PED_WITNESS_COOLDOWN;
        opts.onWitness(p);
      }
    }

    // Near-miss: a fast car closing in sends the ped running from the car.
    if (opts.playerCar && opts.playerCar.position && u.state !== 'cower') {
      const car = opts.playerCar;
      const speed = Math.abs(car.speed ?? car.userData?.speed ?? 0);
      const cdx = p.position.x - car.position.x;
      const cdz = p.position.z - car.position.z;
      const cdist = Math.hypot(cdx, cdz);
      if (speed > 8 && cdist < PED_NEAR_MISS_RADIUS && u.state !== 'panic') {
        startFlee(p, car.position.x, car.position.z, 2.5, 'panic');
      }
    }

    if (u.state === 'cower') {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        // Cower over: run from the last known danger (gunfire origin if we
        // have one, else straight away from where we face).
        const fx = u.fleeDX || 0;
        const fz = u.fleeDZ || 1;
        if (fx === 0 && fz === 1 && !gunfire) {
          u.fleeDX = Math.sin(p.rotation.y + Math.PI);
          u.fleeDZ = Math.cos(p.rotation.y + Math.PI);
        }
        u.flee = PED_FLEE_SECONDS;
        u.state = 'flee';
        u.stateTimer = PED_FLEE_SECONDS;
      }
      // Frozen: no movement, idle stance. Position bookkeeping still runs
      // so the stuck detectors below see zero movement, correctly, as 0.
      u.lastPX = p.position.x;
      u.lastPZ = p.position.z;
      animateIdle(p);
      continue;
    }

    let mx = 0;
    let mz = 0;
    let speed = u.speed;
    if (u.flee > 0) {
      u.flee -= dt;
      u.stateTimer = Math.max(0, u.stateTimer - dt);
      // Wedged while fleeing (D2 fix): if the pedestrian barely moves,
      // turn the flee direction 90 degrees so it runs along the wall
      // instead of pushing into it forever.
      const moved = Math.hypot(p.position.x - u.lastPX, p.position.z - u.lastPZ);
      if (moved < 0.02) {
        u.pedStuck += dt;
        if (u.pedStuck > 0.5) {
          const ndx = -u.fleeDZ;
          const ndz = u.fleeDX;
          u.fleeDX = ndx;
          u.fleeDZ = ndz;
          u.pedStuck = 0;
        }
      } else {
        u.pedStuck = 0;
      }
      mx = u.fleeDX; mz = u.fleeDZ;
      speed = u.state === 'panic' ? 6.0 : 5.2;
      if (u.flee <= 0) u.state = 'stroll';
    } else if (u.axis === 'z') {
      mz = u.dir;
      // Strolling into a wall: after ~1 s of no progress, pick a new
      // direction instead of marching in place.
      const moved = Math.hypot(p.position.x - u.lastPX, p.position.z - u.lastPZ);
      if (moved < 0.02) {
        u.strollStuck += dt;
        if (u.strollStuck > 1) {
          u.dir *= -1;
          u.strollStuck = 0;
        }
      } else {
        u.strollStuck = 0;
      }
    } else {
      mx = u.dir;
      const moved = Math.hypot(p.position.x - u.lastPX, p.position.z - u.lastPZ);
      if (moved < 0.02) {
        u.strollStuck += dt;
        if (u.strollStuck > 1) {
          u.dir *= -1;
          u.strollStuck = 0;
        }
      } else {
        u.strollStuck = 0;
      }
    }
    const nx = THREE.MathUtils.clamp(p.position.x + mx * speed * dt, -WORLD.half, WORLD.half);
    const nz = THREE.MathUtils.clamp(p.position.z + mz * speed * dt, -WORLD.half, WORLD.half);
    // Margin escape (same rule as police): a pedestrian already inside the
    // clearance ring may cross the ring to get out, just not into the core.
    const pedMargin = collidesBuilding(buildings, p.position.x, p.position.z, 0.6) ? 0 : 0.6;
    if (!collidesBuilding(buildings, nx, p.position.z, pedMargin)) p.position.x = nx;
    if (!collidesBuilding(buildings, p.position.x, nz, pedMargin)) p.position.z = nz;
    u.lastPX = p.position.x;
    u.lastPZ = p.position.z;
    // Turn around at the map edge or when blocked.
    if ((u.axis === 'z' && Math.abs(p.position.z) > 158) || (u.axis === 'x' && Math.abs(p.position.x) > 158)) {
      u.dir *= -1;
    }
    if (mx !== 0 || mz !== 0) {
      p.rotation.y = Math.atan2(mx, mz);
      animateWalk(p, dt, Math.min(1, speed / 6));
    } else {
      animateIdle(p);
    }
  }
}
