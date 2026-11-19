// Lane-aware traffic AI for SUNCOAST: HEATLINE.
// One clear job: ambient cars that drive like traffic, not like bumper cars —
// right-hand lanes derived from the existing 36-unit road grid (via
// nearestRoadCoord, no new world.js exports), intersection slow-down / yield
// / turns, car-following spacing, and overtaking a long-blocked lane.
//
// Lane rule (right-hand traffic): on a road running along Z, a car heading
// +Z sits at roadX + lane, heading -Z at roadX - lane; on a road along X, a
// car heading +X sits at roadZ - lane, heading -X at roadZ + lane.
// (Facing +Z, your right hand is +X; facing +X, your right hand is -Z.)

import { WORLD, clamp, mulberry32 } from '../core/config.js';
import { nearestRoadCoord } from '../world/world.js';
import { makeVehicle } from './models.js';

const TRAFFIC_COLOURS = [0xc65b42, 0xd7b56c, 0x4f718a, 0x6f8e72, 0x343b48, 0xb03a5b];
const TRAFFIC_TYPES = ['sedan', 'sedan', 'sedan', 'suv', 'suv', 'taxi', 'taxi', 'truck', 'sports', 'sedan'];

/** Lane offset (signed) for a road axis + heading. Right-hand traffic. */
export function laneOffset(axis, dir) {
  if (axis === 'z') return dir * WORLD.lane; // heading ±Z: right side is ±X
  return -dir * WORLD.lane; // heading ±X: right side is ∓Z
}

function headingYaw(axis, dir) {
  if (axis === 'z') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/** Shortest-arc lerp between two yaws. */
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

function pickType(rng) {
  return TRAFFIC_TYPES[Math.floor(rng() * TRAFFIC_TYPES.length)];
}

/**
 * Spawn ambient traffic on the road grid. Each car carries its lane state in
 * userData: { axis, dir, lane (road centre coord), offset, speed, baseSpeed,
 * traffic: true, turning, yieldUntil, blockedTimer, overtake }.
 */
export function spawnTrafficCars(scene, seed = 21) {
  const rng = mulberry32(seed);
  const traffic = [];
  for (let i = 0; i < 18; i += 1) {
    // The hero coupe must always be stealable: car 0 is always a sports
    // car, so traffic can never roll with zero sports cars (the random
    // draw alone left a ~15% chance of none at all).
    const type = i === 0 ? 'sports' : pickType(rng);
    const axis = rng() < 0.5 ? 'x' : 'z';
    const dir = rng() < 0.5 ? 1 : -1;
    const road = (Math.floor(rng() * 9) - 4) * WORLD.grid; // -144..144
    const offset = laneOffset(axis, dir);
    const colour = type === 'taxi' ? 0xf2c230 : TRAFFIC_COLOURS[i % TRAFFIC_COLOURS.length];
    const c = makeVehicle(type, colour);
    if (axis === 'z') {
      c.position.set(road + offset, 0, (rng() * 2 - 1) * 155);
    } else {
      c.position.set((rng() * 2 - 1) * 155, 0, road + offset);
    }
    c.rotation.y = headingYaw(axis, dir);
    const base = 5 + rng() * 4;
    Object.assign(c.userData, {
      axis, dir, lane: road, offset, speed: base, traffic: true, baseSpeed: base,
      turning: null, yieldUntil: 0, blockedTimer: 0, overtake: null,
      overtakeTimer: 0, turnCooldown: 4 + rng() * 6, waitTimer: 0,
    });
    scene.add(c);
    traffic.push(c);
  }
  return traffic;
}

/** Distance from a point to the nearest intersection centre (both coords on-grid). */
function intersectionAhead(c, axis) {
  const along = axis === 'z' ? c.position.z : c.position.x;
  const inter = nearestRoadCoord(along);
  return { inter, dist: Math.abs(along - inter), approaching: (along - inter) * c.userData.dir < 0 };
}

function carAtIntersection(x, z, radius = 14) {
  return (other) => {
    const dx = other.position.x - x;
    const dz = other.position.z - z;
    return dx * dx + dz * dz < radius * radius;
  };
}

/** Look-ahead: distance to the nearest vehicle ahead in the same lane. */
function nearestAhead(c, traffic, playerCar) {
  const aheadX = Math.sin(c.rotation.y);
  const aheadZ = Math.cos(c.rotation.y);
  let nearest = Infinity;
  const consider = (other) => {
    const dx = other.position.x - c.position.x;
    const dz = other.position.z - c.position.z;
    const along = dx * aheadX + dz * aheadZ;
    const side = Math.abs(dx * aheadZ - dz * aheadX);
    // Side window 3.0 (not 2.4): a car mid-lane-change sits up to 2.7 off
    // its lane centre, and the follower must still see it as "ahead" —
    // otherwise the returning car drifts into the queue unseen.
    if (along > 0 && along < 14 && side < 3.0) nearest = Math.min(nearest, along);
  };
  for (const other of traffic) if (other !== c) consider(other);
  if (playerCar) consider(playerCar);
  return nearest;
}

/**
 * Update all traffic cars. Lane following: each car snaps its perpendicular
 * coordinate onto its lane (road centre + offset) and only ever travels along
 * the road axis, so cars never cut across blocks. At intersections a car may
 * turn (changing axis/dir/lane), must slow down, and yields to cross traffic.
 */
export function updateTrafficCars(traffic, playerCar, dt) {
  for (const c of traffic) {
    const u = c.userData;
    u.turnCooldown = Math.max(0, (u.turnCooldown || 0) - dt);

    // --- turning: interpolate yaw + position across the corner ---
    if (u.turning) {
      const t = u.turning;
      t.t += dt / t.dur;
      const k = clamp(t.t, 0, 1);
      c.rotation.y = lerpAngle(t.fromYaw, t.toYaw, k);
      const fx = Math.sin(c.rotation.y);
      const fz = Math.cos(c.rotation.y);
      c.position.x += fx * u.speed * dt;
      c.position.z += fz * u.speed * dt;
      if (k >= 1) {
        u.axis = t.axis; u.dir = t.dir; u.lane = t.lane; u.offset = t.offset;
        c.rotation.y = t.toYaw;
        // Snap the perpendicular coordinate exactly onto the new lane.
        if (u.axis === 'z') c.position.x = u.lane + u.offset;
        else c.position.z = u.lane + u.offset;
        u.turning = null;
        u.turnCooldown = 5 + Math.random() * 5;
      }
      continue;
    }

    const axis = u.axis;
    const alongCoord = axis === 'z' ? c.position.z : c.position.x;
    const perpCoord = axis === 'z' ? c.position.x : c.position.z;
    const road = nearestRoadCoord(perpCoord);
    // Stay glued to the lane: road centre (from the grid) + our offset.
    const laneTarget = road + u.offset;
    const laneNow = axis === 'z' ? c.position.x : c.position.z;
    const laneFixed = laneNow + (laneTarget - laneNow) * Math.min(1, dt * 8);
    if (axis === 'z') c.position.x = laneFixed;
    else c.position.z = laneFixed;
    u.lane = road;

    // --- target speed: car-following, intersections, yield ---
    let target = u.baseSpeed;
    const ahead = nearestAhead(c, traffic, playerCar);
    if (ahead < 14) target = Math.min(target, Math.max(0, (ahead - 4.5) * 0.9));

    const { inter, dist, approaching } = intersectionAhead(c, axis);
    const atInter = dist < 7 && Math.abs(perpCoord - nearestRoadCoord(perpCoord)) < 7;
    if (approaching && dist < 12) target = Math.min(target, u.baseSpeed * 0.65); // slow for the junction
    if (atInter) {
      // Yield: cross traffic (or the player) inside the intersection wins.
      const cross = (o) => o !== c && o.userData && o.userData.axis !== axis
        && carAtIntersection(inter, nearestRoadCoord(perpCoord), 15)(o);
      const blocked = traffic.some(cross) || (playerCar && cross(playerCar));
      if (blocked) {
        u.waitTimer = (u.waitTimer || 0) + dt;
        if (u.waitTimer < 4) target = 0; // wait, then creep through
        else target = Math.min(target, u.baseSpeed * 0.4);
      } else {
        u.waitTimer = 0;
      }
      // Turn decision, once per intersection: 30% turn left/right.
      // Only when rolling — a stopped car must not rotate in place — and
      // only into a clear destination lane: never cut in front of a car
      // that is about to drive through the lane we are turning into.
      if (u.turnCooldown <= 0 && dist < 5 && approaching && u.speed > 2) {
        const r = Math.random();
        if (r < 0.3) {
          const turnLeft = r < 0.15;
          const newAxis = axis === 'z' ? 'x' : 'z';
          // Left turn from heading H: new heading = H rotated +90° (CCW in
          // yaw terms is -90° because yaw grows clockwise when viewed from
          // above in three.js). Verified against headingYaw() below.
          let newDir;
          if (axis === 'z') newDir = turnLeft ? (u.dir > 0 ? -1 : 1) : (u.dir > 0 ? 1 : -1);
          else newDir = turnLeft ? (u.dir > 0 ? 1 : -1) : (u.dir > 0 ? -1 : 1);
          const newLane = nearestRoadCoord(axis === 'z' ? c.position.z : c.position.x);
          const newOffset = laneOffset(newAxis, newDir);
          const destPerp = newLane + newOffset;
          const myAlongNew = axis === 'z' ? c.position.x : c.position.z;
          const destBlocked = traffic.some((o) => {
            if (o === c || !o.userData || o.userData.axis !== newAxis) return false;
            const oPerp = newAxis === 'z' ? o.position.x : o.position.z;
            const oAlong = newAxis === 'z' ? o.position.z : o.position.x;
            const rel = (oAlong - myAlongNew) * newDir;
            return Math.abs(oPerp - destPerp) < 2.4 && rel > -14 && rel < 8;
          });
          if (destBlocked) {
            u.turnCooldown = 6; // straight through this time
          } else {
            const toYaw = headingYaw(newAxis, newDir);
            u.turning = {
              fromYaw: c.rotation.y, toYaw, axis: newAxis, dir: newDir,
              lane: newLane, offset: newOffset, t: 0, dur: 0.55,
            };
          }
        } else {
          u.turnCooldown = 6; // straight through: don't re-roll this junction
        }
      }
    }

    // --- overtaking: blocked for >2.5 s and the other lane is clear ---
    // The opposite lane must be clear BOTH ahead and of oncoming cars: an
    // oncoming car 20 units away closes the gap in ~1.5 s, faster than the
    // ~2 s the lane change takes.
    if (ahead < 7 && target < u.baseSpeed * 0.4) {
      u.blockedTimer = (u.blockedTimer || 0) + dt;
    } else {
      u.blockedTimer = 0;
    }
    if (!u.overtake && u.blockedTimer > 2.5) {
      const otherLanePerp = road - u.offset; // opposite lane centre
      const clear = !traffic.some((o) => {
        if (o === c) return false;
        const dx = o.position.x - c.position.x;
        const dz = o.position.z - c.position.z;
        const along = axis === 'z' ? dz * u.dir : dx * u.dir;
        const perp = axis === 'z' ? o.position.x : o.position.z;
        // Ahead in the opposite lane, or oncoming toward us in it.
        if (Math.abs(perp - otherLanePerp) < 2.4 && along > -26 && along < 16) return true;
        // Another car already overtaking on this same road segment: one
        // overtake at a time, or the two end up side by side mid-change.
        if (o.userData.overtake && o.userData.axis === axis
          && Math.abs(nearestRoadCoord(perp) - road) < 1
          && along > -26 && along < 16) return true;
        return false;
      });
      if (clear) u.overtake = { timer: 0, phase: 'out' };
    }
    if (u.overtake) {
      u.overtake.timer += dt;
      // Lane changes move at a fixed 3 units/s (linear, not exponential):
      // the perpendicular snap (dt*8 below) tracks it with <0.4 lag.
      // CRITICAL: lateral motion is gated on the lane being clear — the
      // forward gap clamp can stop the car (speed 0) while the offset
      // keeps lerping, which used to drift a stopped car sideways into the
      // car ahead of it (head-on standoff, both clamped at gap ~1.3).
      const step = 3 * dt;
      const home = laneOffset(axis, u.dir);
      const away = -home;
      const homeClearAhead = !traffic.some((o) => {
        if (o === c) return false;
        const dx = o.position.x - c.position.x;
        const dz = o.position.z - c.position.z;
        const along = axis === 'z' ? dz * u.dir : dx * u.dir;
        const perp = axis === 'z' ? o.position.x : o.position.z;
        return along > 0 && along < 10 && Math.abs(perp - (road + home)) < 2.4;
      });
      if (u.overtake.phase === 'out') {
        if (ahead > 4) u.offset += clamp(away - u.offset, -step, step);
        target = u.baseSpeed * 1.15; // pull past
        // Only swing back once the passed car is clearly behind us in the
        // home lane — otherwise we drift back into the car we just passed —
        // AND the home lane ahead is clear (no queue we would land on top of).
        const homeClearBehind = !traffic.some((o) => {
          if (o === c) return false;
          const dx = o.position.x - c.position.x;
          const dz = o.position.z - c.position.z;
          const along = axis === 'z' ? dz * u.dir : dx * u.dir;
          const perp = axis === 'z' ? o.position.x : o.position.z;
          return along < -1 && along > -8 && Math.abs(perp - (road + home)) < 2.4;
        });
        if (u.overtake.timer > 2 && ahead > 12 && homeClearBehind && homeClearAhead) u.overtake.phase = 'back';
        // Give up after 8 s — but still only into a clear home lane ahead
        // (the separation pass below is the last resort, not the plan).
        if (u.overtake.timer > 8 && homeClearAhead) u.overtake.phase = 'back';
        if (u.overtake.timer > 12) u.overtake.phase = 'back'; // safety valve
      } else {
        if (homeClearAhead) u.offset += clamp(home - u.offset, -step, step);
        if (Math.abs(u.offset - home) < 0.05) {
          u.offset = home;
          u.overtake = null;
          u.blockedTimer = 0;
        }
      }
    }

    // --- integrate ---
    u.speed += (target - u.speed) * Math.min(1, dt * 2.5);
    // Hard gap clamp: whatever the approach law says, never close the gap
    // to the car ahead below ~3.2 units. This is the invariant that stops
    // rear-end overlaps when a leader brakes suddenly or a car cuts in
    // from a side street — the follower's speed is capped by the gap
    // itself, so the gap cannot close below the floor in one step.
    if (ahead < 6) u.speed = Math.min(u.speed, Math.max(0, (ahead - 3.2) * 2));
    if (axis === 'z') {
      c.position.z += u.dir * u.speed * dt;
      if (c.position.z > 165) c.position.z = -165;
      if (c.position.z < -165) c.position.z = 165;
    } else {
      c.position.x += u.dir * u.speed * dt;
      if (c.position.x > 165) c.position.x = -165;
      if (c.position.x < -165) c.position.x = 165;
    }
    // Keep the visual yaw exact while not turning (turns set it themselves).
    c.rotation.y = headingYaw(axis, u.dir);
  }

  // --- separation pass: a car can enter a lane laterally (overtake return,
  // turn snap) at a gap below the 3.2 floor the look-ahead clamp enforces
  // for straight-line following. Restore the floor by holding the follower
  // back along its own axis — never move the leader, never touch a car
  // mid-turn (its arc owns its position until the turn completes).
  for (let i = 0; i < traffic.length; i++) {
    for (let j = 0; j < traffic.length; j++) {
      if (i === j) continue;
      const a = traffic[i];
      const b = traffic[j];
      const ua = a.userData;
      const ub = b.userData;
      if (ua.turning || ub.turning || ua.axis !== ub.axis) continue;
      const perpA = ua.axis === 'z' ? a.position.x : a.position.z;
      const perpB = ub.axis === 'z' ? b.position.x : b.position.z;
      if (Math.abs(perpA - perpB) > 2.5) continue;
      const alongA = ua.axis === 'z' ? a.position.z : a.position.x;
      const alongB = ub.axis === 'z' ? b.position.z : b.position.x;
      // b is ahead of a when b sits further along a's heading.
      const gap = (alongB - alongA) * ua.dir;
      if (gap > 0 && gap < 3.2 && ua.dir === ub.dir) {
        const push = 3.2 - gap;
        if (ua.axis === 'z') a.position.z -= ua.dir * push;
        else a.position.x -= ua.dir * push;
        ua.speed = Math.min(ua.speed, 0);
      }
      // Head-on (opposite headings, same lane): the overtaker is the
      // intruder — it entered the oncoming lane, so it retreats: push it
      // back along its own heading, cancel the overtake and send it home.
      // Without this the gap clamp stops both cars and neither can move.
      if (gap > 0 && gap < 3.2 && ua.dir !== ub.dir && ua.overtake) {
        const push = 3.2 - gap;
        if (ua.axis === 'z') a.position.z -= ua.dir * push;
        else a.position.x -= ua.dir * push;
        ua.speed = Math.min(ua.speed, 0);
        ua.overtake = { timer: 99, phase: 'back' };
      }
    }
  }
}

// Re-exported for the harness / coordinator: lane derivation used by the AI.
export { nearestRoadCoord };
