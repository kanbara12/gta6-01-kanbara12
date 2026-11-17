// Characters for SUNCOAST: HEATLINE.
// One clear job: build and animate the people — the player, pedestrians and
// hostile crew. Arms and legs both swing (the prototype only swung legs), and
// pedestrians walk sidewalk loops and flee from gunfire.

import * as THREE from 'three';
import { WORLD, mulberry32 } from './config.js';
import { collidesBuilding } from './world.js';

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

/**
 * A low-poly person: torso, head, two legs, two arms. Arms pivot at the
 * shoulder (group per arm) so the walk swing looks right.
 */
export function createCharacter(color = 0x253b50) {
  const g = new THREE.Group();
  const torso = addBox(g, 0.82, 1.12, 0.48, mat(color), 0, 1.48, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), mat(0xc78f6b));
  head.position.y = 2.25; head.castShadow = true;
  g.add(head);
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = addBox(g, 0.28, 0.82, 0.3, mat(0x202b34), side * 0.22, 0.55, 0);
    legs.push(leg);
  }
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.55, 1.95, 0);
    const arm = addBox(pivot, 0.22, 0.82, 0.25, mat(color), 0, -0.42, 0);
    g.add(pivot);
    arms.push({ pivot, mesh: arm });
  }
  g.userData = { legs, arms, head, torso, walkPhase: 0 };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Walk cycle: legs and arms swing in opposition, torso bobs slightly. */
export function animateWalk(char, dt, speed01) {
  const u = char.userData;
  u.walkPhase += dt * (4 + speed01 * 9);
  const swing = 0.15 + speed01 * 0.55;
  const s = Math.sin(u.walkPhase);
  u.legs[0].rotation.x = s * swing;
  u.legs[1].rotation.x = -s * swing;
  u.arms[0].pivot.rotation.x = -s * swing * 0.8;
  u.arms[1].pivot.rotation.x = s * swing * 0.8;
  u.torso.position.y = 1.48 + Math.abs(Math.cos(u.walkPhase)) * 0.05 * speed01;
}

/** Idle stance: arms hang, legs straight. */
export function animateIdle(char) {
  const u = char.userData;
  u.legs[0].rotation.x *= 0.8;
  u.legs[1].rotation.x *= 0.8;
  u.arms[0].pivot.rotation.x *= 0.8;
  u.arms[1].pivot.rotation.x *= 0.8;
}

const PED_COLOURS = [0x8a5a3b, 0x3b6b8a, 0x6b8a3b, 0x8a3b5e, 0x4a4a6b, 0xb08a3b, 0x3b8a7a, 0x7a3b3b];

/** Spawn pedestrians on sidewalk loops around the city blocks. */
export function spawnPedestrians(scene, buildings, seed = 7) {
  const rng = mulberry32(seed);
  const peds = [];
  for (let i = 0; i < 14; i += 1) {
    const p = createCharacter(PED_COLOURS[i % PED_COLOURS.length]);
    // Sidewalk position: near a road, offset from its centre line.
    const roadX = (Math.floor(rng() * 9) - 4) * WORLD.grid;
    const roadZ = (Math.floor(rng() * 9) - 4) * WORLD.grid;
    const onVertical = rng() < 0.5;
    const x = onVertical ? roadX + 8.5 : (rng() * 2 - 1) * 140;
    const z = onVertical ? (rng() * 2 - 1) * 140 : roadZ + 8.5;
    p.position.set(x, 0, z);
    p.userData.isPed = true;
    p.userData.speed = 1.2 + rng() * 0.9;
    p.userData.axis = onVertical ? 'z' : 'x';
    p.userData.dir = rng() < 0.5 ? 1 : -1;
    p.userData.flee = 0; // seconds of fleeing left
    p.userData.fleeX = 0;
    p.userData.fleeZ = 0;
    scene.add(p);
    peds.push(p);
  }
  return peds;
}

/**
 * Pedestrian update: stroll along the sidewalk; on gunfire, run away from the
 * shot for a few seconds. Never walks through buildings or off the map.
 */
export function updatePedestrians(peds, buildings, dt, gunfire) {
  for (const p of peds) {
    const u = p.userData;
    if (gunfire) {
      u.flee = 3;
      u.fleeX = gunfire.x; u.fleeZ = gunfire.z;
    }
    let mx = 0;
    let mz = 0;
    let speed = u.speed;
    if (u.flee > 0) {
      u.flee -= dt;
      const dx = p.position.x - u.fleeX;
      const dz = p.position.z - u.fleeZ;
      const len = Math.hypot(dx, dz) || 1;
      mx = dx / len; mz = dz / len;
      speed = 5.2;
    } else if (u.axis === 'z') {
      mz = u.dir;
    } else {
      mx = u.dir;
    }
    const nx = THREE.MathUtils.clamp(p.position.x + mx * speed * dt, -WORLD.half, WORLD.half);
    const nz = THREE.MathUtils.clamp(p.position.z + mz * speed * dt, -WORLD.half, WORLD.half);
    if (!collidesBuilding(buildings, nx, p.position.z, 0.6)) p.position.x = nx;
    if (!collidesBuilding(buildings, p.position.x, nz, 0.6)) p.position.z = nz;
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

/** Spawn the hostile crew for the gang-zone mission stage. */
export function spawnEnemies(scene, gangZone, count = 5) {
  const enemies = [];
  const rng = mulberry32(99);
  for (let i = 0; i < count; i += 1) {
    const e = createCharacter(0x7c3030);
    e.position.set(gangZone.x + (rng() * 2 - 1) * 8, 0, gangZone.z + (rng() * 2 - 1) * 8);
    e.userData.health = 2;
    e.userData.alive = true;
    e.userData.isEnemy = true;
    scene.add(e);
    enemies.push(e);
  }
  return enemies;
}

/** Enemies chase the actor inside 18 units and deal melee damage under 4. */
export function updateEnemies(enemies, actorPos, dt, onMelee) {
  for (const e of enemies) {
    if (!e.userData.alive) continue;
    const d = e.position.distanceTo(actorPos);
    if (d < 18) {
      const dx = actorPos.x - e.position.x;
      const dz = actorPos.z - e.position.z;
      e.rotation.y = Math.atan2(dx, dz);
      if (d > 4) {
        e.position.x += (dx / d) * dt * 1.4;
        e.position.z += (dz / d) * dt * 1.4;
        animateWalk(e, dt, 0.4);
      } else {
        onMelee(dt);
        animateIdle(e);
      }
    } else {
      animateIdle(e);
    }
  }
}
