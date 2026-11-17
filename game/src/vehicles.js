// Vehicles for SUNCOAST: HEATLINE.
// One clear job: cars — building them (spinning wheels, body lean in turns),
// ambient traffic with spacing / avoidance, and police pursuit with building
// collision avoidance and line-of-sight checks (the prototype's police drove
// straight through buildings).

import * as THREE from 'three';
import { WORLD, clamp, mulberry32 } from './config.js';
import { collidesBuilding, hasLineOfSight, nearestRoadCoord } from './world.js';

function mat(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(parent, w, h, d, material, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function makeCar(color = 0x2f788b, policeCar = false) {
  const g = new THREE.Group();
  const body = addBox(g, 2.15, 0.72, 4.25, mat(color, 0.48, 0.25), 0, 0.78, 0);
  addBox(g, 1.72, 0.72, 2.05, mat(0x1c2c36, 0.32, 0.1), 0, 1.48, -0.18);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x7ca5b2, metalness: 0.35, roughness: 0.2, transparent: true, opacity: 0.72,
  });
  addBox(g, 0.04, 0.58, 1.8, glass, 0, 1.49, 0.95, false);
  const tireMat = mat(0x15191c, 0.9);
  const rimMat = mat(0x9ba8aa, 0.3, 0.7);
  const wheels = [];
  for (const x of [-1.08, 1.08]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.25, 12), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.43, z);
      wheel.castShadow = true;
      g.add(wheel);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 10), rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(wheel.position);
      g.add(rim);
      wheels.push(wheel);
    }
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1c7 });
  for (const x of [-0.72, 0.72]) addBox(g, 0.28, 0.18, 0.08, headMat, x, 0.86, 2.14, false);
  let lightRed = null;
  let lightBlue = null;
  if (policeCar) {
    lightRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xff334f }),
    );
    lightRed.position.set(-0.32, 1.92, -0.1);
    g.add(lightRed);
    lightBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.24),
      new THREE.MeshBasicMaterial({ color: 0x32baff }),
    );
    lightBlue.position.set(0.32, 1.92, -0.1);
    g.add(lightBlue);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = {
    speed: 0, health: 100, policeCar, wheels, body,
    lightRed, lightBlue, lightPhase: 0, lean: 0,
  };
  return g;
}

/** Spin wheels with speed and lean the body into turns. */
export function animateCar(car, dt, turnInput = 0) {
  const u = car.userData;
  const spin = (u.speed * dt) / 0.43;
  for (const w of u.wheels) w.rotation.x += spin;
  const targetLean = THREE.MathUtils.clamp(-turnInput * Math.abs(u.speed) * 0.006, -0.09, 0.09);
  u.lean += (targetLean - u.lean) * Math.min(1, dt * 8);
  u.body.rotation.z = u.lean;
  if (u.policeCar) {
    u.lightPhase += dt;
    const on = Math.floor(u.lightPhase / 0.28) % 2 === 0;
    u.lightRed.material.color.setHex(on ? 0xff334f : 0x550000);
    u.lightBlue.material.color.setHex(on ? 0x0a2a44 : 0x32baff);
  }
}

const TRAFFIC_COLOURS = [0xc65b42, 0xd7b56c, 0x4f718a, 0x6f8e72, 0x343b48];

export function spawnTraffic(scene, seed = 21) {
  const rng = mulberry32(seed);
  const traffic = [];
  for (let i = 0; i < 18; i += 1) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = Math.round((rng() * 2 - 1) * 4) * WORLD.grid + (rng() < 0.5 ? -WORLD.lane : WORLD.lane);
    const c = makeCar(TRAFFIC_COLOURS[i % TRAFFIC_COLOURS.length]);
    if (axis === 'z') {
      c.position.set(lane, 0, (rng() * 2 - 1) * 155);
      c.rotation.y = dir > 0 ? 0 : Math.PI;
    } else {
      c.position.set((rng() * 2 - 1) * 155, 0, lane);
      c.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    Object.assign(c.userData, {
      axis, dir, lane, speed: 5 + rng() * 4, traffic: true, baseSpeed: 5 + rng() * 4,
    });
    c.userData.baseSpeed = c.userData.speed;
    scene.add(c);
    traffic.push(c);
  }
  return traffic;
}

/**
 * Traffic with spacing: a car brakes when the car ahead in its lane (or the
 * player's car) is close, and never overlaps the player. Wraps at the edges.
 */
export function updateTraffic(traffic, playerCar, dt) {
  for (const c of traffic) {
    const u = c.userData;
    // Look ahead along the lane for the nearest vehicle.
    let nearest = Infinity;
    const aheadX = Math.sin(c.rotation.y);
    const aheadZ = Math.cos(c.rotation.y);
    for (const other of traffic) {
      if (other === c) continue;
      const dx = other.position.x - c.position.x;
      const dz = other.position.z - c.position.z;
      const along = dx * aheadX + dz * aheadZ;
      const side = Math.abs(dx * aheadZ - dz * aheadX);
      if (along > 0 && along < 12 && side < 2.2) nearest = Math.min(nearest, along);
    }
    if (playerCar) {
      const dx = playerCar.position.x - c.position.x;
      const dz = playerCar.position.z - c.position.z;
      const along = dx * aheadX + dz * aheadZ;
      const side = Math.abs(dx * aheadZ - dz * aheadX);
      if (along > 0 && along < 12 && side < 2.4) nearest = Math.min(nearest, along);
    }
    const target = nearest < 12 ? Math.max(0, (nearest - 4) * 0.9) : u.baseSpeed;
    u.speed += (target - u.speed) * Math.min(1, dt * 2.5);
    if (u.axis === 'z') {
      c.position.z += u.dir * u.speed * dt;
      if (c.position.z > 165) c.position.z = -165;
      if (c.position.z < -165) c.position.z = 165;
    } else {
      c.position.x += u.dir * u.speed * dt;
      if (c.position.x > 165) c.position.x = -165;
      if (c.position.x < -165) c.position.x = 165;
    }
    animateCar(c, dt, 0);
  }
}

/**
 * Police pursuit with building collision avoidance and line of sight.
 *
 * Steering target: the player when line of sight is clear, otherwise the
 * nearest road intersection on the way to the player's last seen position —
 * so a police car routes around blocks on the road grid instead of driving
 * through buildings. Movement itself is also building-clamped with a slide.
 */
export function updatePolice(police, buildings, actorPos, wanted, dt, onRam) {
  for (const c of police) {
    const dx = actorPos.x - c.position.x;
    const dz = actorPos.z - c.position.z;
    const dist = Math.hypot(dx, dz);
    let tx = actorPos.x;
    let tz = actorPos.z;
    const seesPlayer = hasLineOfSight(buildings, c.position.x, c.position.z, actorPos.x, actorPos.z);
    if (!seesPlayer) {
      // Route via the road grid: head for the intersection nearest the player
      // that is also nearest to this car, one leg at a time.
      tx = nearestRoadCoord(actorPos.x);
      tz = nearestRoadCoord(actorPos.z);
      const carRoadX = nearestRoadCoord(c.position.x);
      const carRoadZ = nearestRoadCoord(c.position.z);
      if (Math.abs(tx - carRoadX) > Math.abs(tz - carRoadZ)) {
        tz = carRoadZ;
      } else {
        tx = carRoadX;
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
    if (!collidesBuilding(buildings, nx, c.position.z, 1.6)) c.position.x = nx;
    else c.userData.speed *= 0.6;
    if (!collidesBuilding(buildings, c.position.x, nz, 1.6)) c.position.z = nz;
    else c.userData.speed *= 0.6;
    c.position.x = clamp(c.position.x, -163, 150);
    c.position.z = clamp(c.position.z, -163, 163);
    animateCar(c, dt, Math.sign(delta));
    if (dist < 4.2 && seesPlayer) onRam(dt);
  }
}

/** Spawn one police car at a random bearing, 48 units from the actor. */
export function spawnPoliceCar(scene, actorPos, rng) {
  const c = makeCar(0x172d49, true);
  const angle = rng() * Math.PI * 2;
  c.position.set(
    clamp(actorPos.x + Math.cos(angle) * 48, -150, 150),
    0,
    clamp(actorPos.z + Math.sin(angle) * 48, -150, 150),
  );
  c.userData.speed = 0;
  scene.add(c);
  return c;
}
