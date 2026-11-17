// Police AI for SUNCOAST: HEATLINE.
// One clear job: pursuit + search behaviour for police cars, with
// building-aware collision and road-grid navigation.
//
// DROP-IN REPLACEMENT for the police functions in vehicles.js: the two
// exported signatures are IDENTICAL, so the coordinator swaps one import
// line in main.js and nothing else changes. All movement math below is
// carried over from vehicles.js, including the QA defect D1 anti-freeze
// logic (unstick reverse-out, axis-aligned road routing, margin-escape) —
// do not "simplify" those branches away; they are what keeps police cars
// from freezing wedged in a building corner or driving through a block.
//
// What this module ADDS on top of vehicles.js (same signatures):
// - Pursuit state machine per unit: PURSUE (sees the player, or recently
//   saw them) -> SEARCH (lost sight: drive to the last-seen point, then
//   sweep nearby intersections) -> cruising slow once the search goes
//   cold. The main loop's heat decay + despawn (updatePoliceSpawns in
//   main.js) stays authoritative for actually losing the heat; this module
//   only decides how the cars behave while the heat is on.
// - Wanted escalation table: top speed, search patience and unit cap per
//   wanted level 0-5 (exported as WANTED_CONFIG for the HUD / spawner).
// - Readouts for the coordinator: allPoliceLost(police) and
//   policePursuitState(car), so the HUD can say "SEARCHING" vs "PURSUE".
//
// Visual direction (from the #1 reference entry, studied, not copied):
// sunset-coastal chase readability — police stay on the roads and in
// line of sight, so the chase reads as a street pursuit, never as cars
// clipping through the waterfront towers.

import { clamp } from '../core/config.js';
import { collidesBuilding, hasLineOfSight, nearestRoadCoord } from '../world/world.js';
import { makeCar, animateCar } from '../vehicles/vehicles.js';

/** Per wanted level: unit cap, top-speed bonus, sight-loss patience. */
export const WANTED_CONFIG = [
  { level: 0, maxUnits: 0, speedBonus: 0, loseAfter: 6, searchSeconds: 12 },
  { level: 1, maxUnits: 2, speedBonus: 1.5, loseAfter: 6, searchSeconds: 12 },
  { level: 2, maxUnits: 3, speedBonus: 3, loseAfter: 7, searchSeconds: 14 },
  { level: 3, maxUnits: 4, speedBonus: 4.5, loseAfter: 9, searchSeconds: 16 },
  { level: 4, maxUnits: 4, speedBonus: 6, loseAfter: 11, searchSeconds: 18 },
  { level: 5, maxUnits: 4, speedBonus: 7.5, loseAfter: 14, searchSeconds: 20 },
];

/** Wanted table lookup, clamped to level 0-5. */
export function wantedConfig(wanted) {
  return WANTED_CONFIG[clamp(Math.round(wanted) || 0, 0, 5)];
}

/** How many police cars the spawner should keep out at this wanted level. */
export function countPoliceForWanted(wanted) {
  return Math.min(1 + clamp(Math.round(wanted) || 0, 0, 5), 4);
}

/** 'pursue' | 'search' — the unit's current behaviour (for HUD / tests). */
export function policePursuitState(car) {
  return car.userData.mode || 'pursue';
}

/**
 * True when every police car has lost sight of the player for longer than
 * its wanted level allows — i.e. the player is, as far as the police know,
 * gone. The main loop still decides the actual wanted decay; this is only
 * the AI's own read-out (HUD "YOU LOST THEM" hint, tests).
 */
export function allPoliceLost(police) {
  if (!police || police.length === 0) return true;
  return police.every((c) => {
    const u = c.userData;
    return u.mode === 'search' && (u.lostTimer || 0) > (u.loseAfter || 6);
  });
}

function initPoliceState(c, actorPos) {
  const u = c.userData;
  if (u.stuckTimer === undefined) {
    u.stuckTimer = 0; u.unstick = 0; u.unstickDir = 1;
    u.lastPX = c.position.x; u.lastPZ = c.position.z;
  }
  // Search-state fields (new; default to "just saw the player here").
  if (u.mode === undefined) {
    u.mode = 'pursue';
    u.lastSeenX = actorPos.x; u.lastSeenZ = actorPos.z;
    u.lostTimer = 0; u.searchTimer = 0;
    u.searchTX = actorPos.x; u.searchTZ = actorPos.z;
    u.searchLeg = 0;
    u.loseAfter = 6; u.searchSeconds = 12;
  }
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
 *
 * Search behaviour (new): once line of sight is lost for `loseAfter`
 * seconds the unit switches to SEARCH — it drives to the last-seen point,
 * then sweeps the neighbouring intersections (one road leg at a time, same
 * axis-aligned routing as pursuit) for `searchSeconds`. If it still has no
 * sight after that, it drops to a slow cruise around the last-seen area
 * until the main loop's heat decay removes it.
 */
export function updatePolice(police, buildings, actorPos, wanted, dt, onRam) {
  const cfg = wantedConfig(wanted);
  for (const c of police) {
    const u = c.userData;
    initPoliceState(c, actorPos);
    u.loseAfter = cfg.loseAfter;
    u.searchSeconds = cfg.searchSeconds;
    const dx = actorPos.x - c.position.x;
    const dz = actorPos.z - c.position.z;
    const dist = Math.hypot(dx, dz);
    const moved = Math.hypot(c.position.x - u.lastPX, c.position.z - u.lastPZ);
    u.lastPX = c.position.x; u.lastPZ = c.position.z;

    // --- sight / state machine (new; movement below is unchanged D1) ---
    const seesPlayer = hasLineOfSight(buildings, c.position.x, c.position.z, actorPos.x, actorPos.z);
    if (seesPlayer) {
      u.mode = 'pursue';
      u.lostTimer = 0; u.searchTimer = 0;
      u.lastSeenX = actorPos.x; u.lastSeenZ = actorPos.z;
    } else {
      u.lostTimer += dt;
      if (u.mode === 'pursue' && u.lostTimer > u.loseAfter) {
        u.mode = 'search';
        u.searchTimer = 0;
        u.searchLeg = 0;
        u.searchTX = nearestRoadCoord(u.lastSeenX);
        u.searchTZ = nearestRoadCoord(u.lastSeenZ);
      } else if (u.mode === 'search') {
        u.searchTimer += dt;
      }
    }

    // --- D1 unstick branch: VERBATIM logic from vehicles.js. ---
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

    // --- steering target (D1 routing, generalised to a goal point) ---
    // Pursuit goal: the player. Search goal: last-seen point, then the
    // neighbouring intersections, one leg at a time.
    let goalX = actorPos.x;
    let goalZ = actorPos.z;
    if (u.mode === 'search') {
      const atSearchTarget = Math.hypot(u.searchTX - c.position.x, u.searchTZ - c.position.z) < 6;
      if (atSearchTarget) {
        // Pick the next neighbouring intersection to sweep: alternate
        // legs around the last-seen point so the car covers the block
        // instead of circling one corner.
        u.searchLeg += 1;
        const leg = u.searchLeg % 4;
        const baseX = nearestRoadCoord(u.lastSeenX);
        const baseZ = nearestRoadCoord(u.lastSeenZ);
        u.searchTX = leg === 0 ? baseX + 36 : leg === 1 ? baseX : leg === 2 ? baseX - 36 : baseX;
        u.searchTZ = leg === 0 ? baseZ : leg === 1 ? baseZ + 36 : leg === 2 ? baseZ : baseZ - 36;
      }
      goalX = u.searchTX;
      goalZ = u.searchTZ;
    }
    let tx = goalX;
    let tz = goalZ;
    if (!seesPlayer || u.mode === 'search') {
      // Route via the road grid: head for the intersection nearest the goal
      // that is also nearest to this car, one leg at a time — axis-aligned,
      // staying on the road the car is already nearest to first, so the car
      // never cuts diagonally across a block corner.
      tx = nearestRoadCoord(goalX);
      tz = nearestRoadCoord(goalZ);
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
    // Top speed: pursuit keeps the vehicles.js cap (12 + wanted * 1.5);
    // a cold search cruises slower so a lost player can actually slip away.
    const topSpeed = u.mode === 'search' && u.searchTimer > u.searchSeconds
      ? 6
      : 12 + wanted * 1.5;
    c.userData.speed = clamp(c.userData.speed + dt * 10, 0, topSpeed);
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
    if (u.mode === 'pursue' && dist < 4.2 && seesPlayer) onRam(dt);
  }
}

/**
 * Spawn one police car at a random bearing, 48 units from the actor.
 * The spawn point is validated clear of buildings (margin 2.2, above the
 * 1.6 collision radius); after 8 blocked tries it falls back to the
 * nearest road intersection, which is always clear of buildings.
 * Identical to vehicles.js spawnPoliceCar, plus the search-state fields.
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
  c.userData.mode = 'pursue';
  c.userData.lastSeenX = actorPos.x;
  c.userData.lastSeenZ = actorPos.z;
  c.userData.lostTimer = 0;
  c.userData.searchTimer = 0;
  scene.add(c);
  return c;
}
