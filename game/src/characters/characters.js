// Characters for SUNCOAST: HEATLINE.
// One clear job: build and animate the people — the player, pedestrians and
// hostile crew — as proper rigged 3D characters.
//
// The final character is the rigged GLB in ../../assets/characters/citizen.glb
// (original Blender build, see build_character.py: 19-bone armature, skinned
// mesh, AnimationMixer clips idle/walk/run/sprint/jump/aim/shoot/reload/
// enter_car/exit_car). createCharacter() returns a Group synchronously with a
// simple procedural stand-in that is swapped for the rigged model the moment
// the local GLB finishes loading, so the game never blocks on the asset and
// the stand-in is never the final look. All animation goes through the mixer
// once the rig is installed; before that the stand-in uses the same pose
// code paths (legs/arms swing) so behaviour is identical either way.
//
// Contract (kept): createCharacter(color) -> Group; animateWalk(char, dt,
// factor); animateIdle(char); spawnPedestrians(scene, buildings);
// updatePedestrians(peds, buildings, dt, gunfireEvent[, traffic]);
// spawnEnemies(scene, GANG_ZONE); updateEnemies(enemies, playerPos, dt,
// onMelee). Player scale ~1.8 units, origin at the feet — never changed:
// movement and collision in main.js depend on it.

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { WORLD, mulberry32 } from '../core/config.js';
import { collidesBuilding, nearestRoadCoord } from '../world/world.js';

export const CHARACTER_CLIPS = [
  'idle', 'walk', 'run', 'sprint', 'jump',
  'aim', 'shoot', 'reload', 'enter_car', 'exit_car',
];

const RIG_URL = new URL('../../assets/characters/citizen.glb', import.meta.url).href;

let rigPromise = null;
/** Load the shared rigged character GLB (local file, no network). */
export function loadCharacterRig() {
  if (!rigPromise) {
    rigPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(RIG_URL, resolve, undefined, reject);
    }).catch((err) => {
      console.warn('[characters] rig GLB failed to load, keeping stand-in:', err);
      rigPromise = null;
      return null;
    });
  }
  return rigPromise;
}

// ---------------------------------------------------------------- stand-in
// Transient only: shown for the frames between createCharacter() and the
// async GLB load finishing. Same pivots / scale as the rig so the swap is
// invisible in position; capsule limbs instead of boxes.

function mat(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addLimb(parent, r, len, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 10), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function createCharacter(color = 0x253b50) {
  const g = new THREE.Group();
  const jacket = mat(color);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.12, 10), jacket);
  torso.position.y = 1.48;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), mat(0xc78f6b));
  head.position.y = 2.25;
  head.castShadow = true;
  g.add(head);
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 0.96, 0);
    addLimb(pivot, 0.15, 0.85, mat(0x202b34), 0, -0.42, 0);
    g.add(pivot);
    legs.push(pivot);
  }
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.55, 1.95, 0);
    addLimb(pivot, 0.11, 0.82, jacket, 0, -0.42, 0);
    g.add(pivot);
    arms.push({ pivot, mesh: pivot.children[0] });
  }
  g.userData = {
    legs, arms, head, torso, walkPhase: 0,
    tint: color, rig: null, mixer: null, actions: null,
    rigClip: 'idle', rigBase: 'idle', rigOneShot: null, aiming: false,
    weapon: 'pistol', pistolNodes: [], smgNodes: [], vehicleAnim: null,
  };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  installRig(g);
  return g;
}

/** Swap the stand-in for the rigged GLB clone (per-instance materials). */
function installRig(char) {
  loadCharacterRig().then((gltf) => {
    if (!gltf || char.userData.rig) return;
    const rig = cloneSkinned(gltf.scene);
    rig.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Per-instance tint: clone materials once and recolour the jacket so the
    // player, pedestrians and crew can share one GLB with distinct looks.
    const tint = new THREE.Color(char.userData.tint);
    rig.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const single = !Array.isArray(o.material);
      const mats = single ? [o.material] : o.material;
      const cloned = mats.map((m) => {
        const c = m.clone();
        if (m.name === 'Jacket') c.color.copy(tint);
        return c;
      });
      o.material = single ? cloned[0] : cloned;
    });
    const pistolNodes = [];
    const smgNodes = [];
    rig.traverse((o) => {
      if (o.name.startsWith('Pistol')) pistolNodes.push(o);
      if (o.name.startsWith('Smg')) smgNodes.push(o);
    });
    for (const n of smgNodes) n.visible = false; // pistol is the default weapon
    // Remove the stand-in, keep the Group (position/rotation/visible untouched).
    for (const child of [...char.children]) char.remove(child);
    char.add(rig);
    const mixer = new THREE.AnimationMixer(rig);
    const actions = {};
    for (const clip of gltf.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }
    Object.assign(char.userData, {
      rig, mixer, actions, pistolNodes, smgNodes,
    });
    setRigClip(char, char.userData.aiming ? 'aim' : 'idle', 0);
  });
}

// ---------------------------------------------------------------- mixer
function setRigClip(char, name, fade = 0.18) {
  const u = char.userData;
  if (!u.mixer || !u.actions || !u.actions[name]) return false;
  if (u.rigClip === name && u.actions[name].isRunning()) return true;
  const next = u.actions[name];
  const prev = u.actions[u.rigClip];
  next.reset();
  next.setLoop(THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = false;
  next.timeScale = 1;
  next.play();
  if (prev && prev !== next && prev.isRunning()) next.crossFadeFrom(prev, fade, false);
  u.rigClip = name;
  return true;
}

/** One-shot clip (jump/shoot/reload/enter/exit): plays once, then returns. */
function playOneShot(char, name, fade = 0.12) {
  const u = char.userData;
  if (!u.mixer || !u.actions || !u.actions[name]) return false;
  const action = u.actions[name];
  const prev = u.actions[u.rigClip];
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.timeScale = 1;
  action.play();
  if (prev && prev !== action && prev.isRunning()) action.crossFadeFrom(prev, fade, false);
  u.rigClip = name;
  u.rigOneShot = { name, elapsed: 0, dur: action.getClip().duration };
  return true;
}

/** Advance the mixer, one-shot return and vehicle tween. Call every frame. */
export function updateCharacterAnims(char, dt) {
  const u = char.userData;
  if (u.mixer) {
    u.mixer.update(dt);
    if (u.rigOneShot) {
      u.rigOneShot.elapsed += dt;
      if (u.rigOneShot.elapsed >= u.rigOneShot.dur) {
        u.rigOneShot = null;
        setRigClip(char, u.aiming ? 'aim' : u.rigBase, 0.15);
      }
    }
  }
  const va = u.vehicleAnim;
  if (va) {
    va.t += dt;
    const k = Math.min(1, va.t / va.dur);
    const s = k * k * (3 - 2 * k); // smoothstep
    char.position.lerpVectors(va.from, va.to, s);
    char.rotation.y = va.yaw;
    if (k >= 1) {
      u.vehicleAnim = null;
      if (va.onDone) va.onDone();
    }
  }
}

function pickLocomotionClip(speed01) {
  if (speed01 >= 0.9) return 'sprint';
  if (speed01 >= 0.6) return 'run';
  if (speed01 > 0.05) return 'walk';
  return 'idle';
}

/** Walk cycle: legs and arms swing in opposition, torso bobs slightly. */
export function animateWalk(char, dt, speed01) {
  const u = char.userData;
  if (u.mixer) {
    updateCharacterAnims(char, dt);
    if (!u.rigOneShot) {
      const clip = u.aiming ? 'aim' : pickLocomotionClip(speed01);
      u.rigBase = clip === 'aim' ? u.rigBase : clip;
      if (setRigClip(char, clip, 0.15) && u.actions[clip]) {
        u.actions[clip].timeScale = 0.8 + speed01 * 0.6;
      }
    }
    return;
  }
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
  if (u.mixer) {
    updateCharacterAnims(char, 1 / 60);
    if (!u.rigOneShot) {
      const clip = u.aiming ? 'aim' : 'idle';
      u.rigBase = 'idle';
      setRigClip(char, clip, 0.2);
    }
    return;
  }
  u.legs[0].rotation.x *= 0.8;
  u.legs[1].rotation.x *= 0.8;
  u.arms[0].pivot.rotation.x *= 0.8;
  u.arms[1].pivot.rotation.x *= 0.8;
}

// ---------------------------------------------------------------- weapons
/** Show the pistol or the SMG in the right hand ('pistol' | 'smg'). */
export function setWeapon(char, id) {
  const u = char.userData;
  u.weapon = id === 'smg' ? 'smg' : 'pistol';
  const showSmg = u.weapon === 'smg';
  for (const n of u.pistolNodes) n.visible = !showSmg;
  for (const n of u.smgNodes) n.visible = showSmg;
}

/** Hold the two-hand aim stance until setAiming(char, false). */
export function setAiming(char, aiming) {
  char.userData.aiming = !!aiming;
  if (char.userData.mixer && !char.userData.rigOneShot) {
    setRigClip(char, aiming ? 'aim' : char.userData.rigBase, 0.12);
  }
}

/** Fire pose (recoil kick); falls back to the aim stance afterwards. */
export function playShoot(char) {
  if (!playOneShot(char, 'shoot', 0.08)) {
    // Stand-in has no shoot pose: a quick arm raise reads as the shot.
    animateWalk(char, 0.05, 0.2);
  }
}

/** Reload pose (mag swap, both hands to the chest). */
export function playReload(char) {
  playOneShot(char, 'reload', 0.12);
}

/** Jump pose (crouch -> takeoff -> tuck -> land). Position stays with main.js. */
export function playJump(char) {
  playOneShot(char, 'jump', 0.1);
}

/** Melee swing (reuses the arm-raise shoot clip as a swing). */
export function playMelee(char) {
  playOneShot(char, 'shoot', 0.08);
}

function doorSpot(car, side, dist) {
  const rot = car.rotation.y;
  return new THREE.Vector3(
    car.position.x + Math.cos(rot) * dist * side,
    0,
    car.position.z - Math.sin(rot) * dist * side,
  );
}

/**
 * Vehicle entry animation. HOOK for the coordinator: main.js currently hides
 * the player the instant E is pressed (tryEnterExit) — wire this in first:
 * keep the player visible, call playEnterVehicle(player, car, onDone), and
 * hide the player / set G.currentCar only inside onDone. The clip steps the
 * character to the door, ducks and slides in over ~1 s.
 */
export function playEnterVehicle(char, car, onDone) {
  const u = char.userData;
  const to = doorSpot(car, 1, 1.6);
  u.vehicleAnim = {
    t: 0, dur: 1.0, from: char.position.clone(), to, yaw: car.rotation.y, onDone,
  };
  playOneShot(char, 'enter_car', 0.12);
}

/**
 * Vehicle exit animation. Same wiring note as entry: call this BEFORE
 * main.js moves the player out, and let onDone do the final placement (the
 * tween already ends at the clear side spot, 2.3 units from the car).
 */
export function playExitVehicle(char, car, onDone) {
  const u = char.userData;
  const to = doorSpot(car, 1, 2.3);
  u.vehicleAnim = {
    t: 0, dur: 1.0, from: char.position.clone(), to, yaw: car.rotation.y, onDone,
  };
  playOneShot(char, 'exit_car', 0.12);
}

// ---------------------------------------------------------------- pedestrians
const PED_COLOURS = [0x8a5a3b, 0x3b6b8a, 0x6b8a3b, 0x8a3b5e, 0x4a4a6b, 0xb08a3b, 0x3b8a7a, 0x7a3b3b];

/** Pick a new sidewalk waypoint: a road intersection, offset to the kerb. */
function pickPedTarget(p, buildings, rng) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roadX = (Math.floor(rng() * 9) - 4) * WORLD.grid;
    const roadZ = (Math.floor(rng() * 9) - 4) * WORLD.grid;
    const onVertical = rng() < 0.5;
    const x = onVertical ? roadX + 8.5 : (rng() * 2 - 1) * 140;
    const z = onVertical ? (rng() * 2 - 1) * 140 : roadZ + 8.5;
    if (!collidesBuilding(buildings, x, z, 2.5)) return { x, z };
  }
  return { x: nearestRoadCoord(p.position.x), z: nearestRoadCoord(p.position.z) };
}

/** Spawn pedestrians on sidewalk loops around the city blocks. */
export function spawnPedestrians(scene, buildings, seed = 7) {
  const rng = mulberry32(seed);
  const peds = [];
  for (let i = 0; i < 14; i += 1) {
    const p = createCharacter(PED_COLOURS[i % PED_COLOURS.length]);
    // Sidewalk position: near a road, offset from its centre line.
    // Validated clear of buildings (margin 2.5, well above the 0.6 walk
    // radius) so no pedestrian spawns wedged against a wall (QA defect D2);
    // after 10 blocked tries fall back to the nearest road intersection,
    // which is always clear of buildings.
    let x = 0;
    let z = 0;
    let onVertical = true;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const roadX = (Math.floor(rng() * 9) - 4) * WORLD.grid;
      const roadZ = (Math.floor(rng() * 9) - 4) * WORLD.grid;
      onVertical = rng() < 0.5;
      x = onVertical ? roadX + 8.5 : (rng() * 2 - 1) * 140;
      z = onVertical ? (rng() * 2 - 1) * 140 : roadZ + 8.5;
      if (!collidesBuilding(buildings, x, z, 2.5)) break;
      if (attempt === 9) {
        x = nearestRoadCoord(x);
        z = nearestRoadCoord(z);
      }
    }
    p.position.set(x, 0, z);
    p.userData.isPed = true;
    p.userData.speed = 1.2 + rng() * 0.9;
    p.userData.rng = mulberry32(seed * 100 + i + 1); // per-ped stream (deterministic)
    p.userData.target = null; // waypoint, picked on the first update
    p.userData.flee = 0; // seconds of fleeing left
    p.userData.fleeDX = 0; // fixed flee direction (set at gunfire time)
    p.userData.fleeDZ = 0;
    p.userData.pedStuck = 0; // seconds barely moving while fleeing
    p.userData.lastPX = x;
    p.userData.lastPZ = z;
    p.userData.dodge = 0; // seconds of sidestepping a car left
    p.userData.dodgeDX = 0;
    p.userData.dodgeDZ = 0;
    scene.add(p);
    peds.push(p);
  }
  return peds;
}

// Reaction radii (same values as AI/pedestrians.js — the cower / panic /
// witness reactions below are that module's behaviour, merged here; see
// the coordinator note in the root INTEGRATION.md for why the literal
// import swap was not applied).
const PED_COWER_RADIUS = 9;
const PED_NEAR_MISS_RADIUS = 7;
const PED_WITNESS_RADIUS = 30;
const PED_WITNESS_COOLDOWN = 12;

/** Current behaviour state of a pedestrian ('stroll' | 'flee' | 'panic' | 'cower'). */
export function pedestrianState(ped) {
  return ped.userData.state || 'stroll';
}

/**
 * Pedestrian update: wander between sidewalk waypoints; on gunfire, run away
 * from the shot for a few seconds (freezing first if the shot is very
 * close); when a car bears down on them, sidestep out of its path — and run
 * clear when the player's own car is about to hit them. A fleeing ped who
 * saw the shot can raise the alarm (opts.onWitness, once per ped per 12 s).
 * Never walks through buildings or off the map.
 * `traffic` is optional (main.js may pass G.traffic); without it the dodge
 * step is skipped. `opts` is optional: { playerCar, onWitness }.
 */
export function updatePedestrians(peds, buildings, dt, gunfire, traffic = [], opts = {}) {
  for (const p of peds) {
    const u = p.userData;
    if (u.state === undefined) u.state = 'stroll';
    if (u.stateTimer === undefined) u.stateTimer = 0;
    if (u.witnessCooldown === undefined) u.witnessCooldown = 0;
    if (u.witnessCooldown > 0) u.witnessCooldown -= dt;

    if (gunfire) {
      const gdx = p.position.x - gunfire.x;
      const gdz = p.position.z - gunfire.z;
      const gdist = Math.hypot(gdx, gdz);
      // Witness: saw the shot up close and is running — raise the alarm.
      if (opts.onWitness && gdist < PED_WITNESS_RADIUS && u.witnessCooldown <= 0) {
        u.witnessCooldown = PED_WITNESS_COOLDOWN;
        opts.onWitness(p);
      }
      if (gdist < PED_COWER_RADIUS && u.state !== 'flee' && u.state !== 'panic') {
        // Shock first: freeze, then run. Fix the flee direction now so the
        // run after the freeze heads away from the shot.
        const len = gdist || 1;
        u.fleeDX = gdx / len;
        u.fleeDZ = gdz / len;
        u.state = 'cower';
        u.stateTimer = 1.5;
        u.flee = 0;
      } else if (u.state !== 'cower') {
        u.flee = 3;
        // Fix the flee direction at gunfire time: recomputing it every frame
        // from the current position makes a pedestrian sliding along a wall
        // oscillate in place instead of running clear.
        const len = gdist || 1;
        u.fleeDX = gdx / len;
        u.fleeDZ = gdz / len;
        u.state = 'flee';
        u.stateTimer = 3;
      }
    }

    // Near-miss: the player's fast car closing in sends the ped running.
    if (opts.playerCar && opts.playerCar.position && u.state !== 'cower') {
      const car = opts.playerCar;
      const speed = Math.abs(car.speed ?? car.userData?.speed ?? 0);
      const cdx = p.position.x - car.position.x;
      const cdz = p.position.z - car.position.z;
      const cdist = Math.hypot(cdx, cdz);
      if (speed > 8 && cdist < PED_NEAR_MISS_RADIUS && u.state !== 'panic') {
        const len = cdist || 1;
        u.fleeDX = cdx / len;
        u.fleeDZ = cdz / len;
        u.flee = 2.5;
        u.state = 'panic';
        u.stateTimer = 2.5;
      }
    }

    if (u.state === 'cower') {
      u.stateTimer -= dt;
      if (u.stateTimer <= 0) {
        // Cower over: run from the shot (direction fixed at cower start).
        u.flee = 3;
        u.state = 'flee';
        u.stateTimer = 3;
      } else {
        // Still frozen: no movement, idle stance.
        u.lastPX = p.position.x;
        u.lastPZ = p.position.z;
        animateIdle(p);
        continue;
      }
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
    } else {
      // Car dodge: a car closing in on the pedestrian triggers a sidestep.
      if (u.dodge > 0) {
        u.dodge -= dt;
        mx = u.dodgeDX; mz = u.dodgeDZ;
        speed = 4.5;
      } else if (traffic.length) {
        for (const c of traffic) {
          const cs = c.userData && c.userData.speed ? Math.abs(c.userData.speed) : 0;
          if (cs < 1) continue;
          const dx = p.position.x - c.position.x;
          const dz = p.position.z - c.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 5 || d < 0.01) continue;
          // Is the car heading at the pedestrian? (dot of the car's
          // heading with the car->pedestrian direction; > 0 = closing in.)
          const hx = Math.sin(c.rotation.y) * Math.sign(c.userData.speed);
          const hz = Math.cos(c.rotation.y) * Math.sign(c.userData.speed);
          const closing = (dx / d) * hx + (dz / d) * hz;
          if (closing > 0.5) {
            // Sidestep perpendicular to the car's heading, away from the road.
            const px = -hz;
            const pz = hx;
            const side = (dx * px + dz * pz) >= 0 ? 1 : -1;
            u.dodge = 0.9;
            u.dodgeDX = px * side;
            u.dodgeDZ = pz * side;
            mx = u.dodgeDX; mz = u.dodgeDZ;
            speed = 4.5;
            break;
          }
        }
      }
      // Waypoint wandering (only when neither fleeing nor dodging).
      if (mx === 0 && mz === 0) {
        if (!u.target) u.target = pickPedTarget(p, buildings, u.rng);
        const tx = u.target.x - p.position.x;
        const tz = u.target.z - p.position.z;
        const td = Math.hypot(tx, tz);
        if (td < 1.5) {
          u.target = pickPedTarget(p, buildings, u.rng);
        } else {
          mx = tx / td;
          mz = tz / td;
        }
      }
    }
    const prevX = p.position.x;
    const prevZ = p.position.z;
    const nx = THREE.MathUtils.clamp(p.position.x + mx * speed * dt, -WORLD.half, WORLD.half);
    const nz = THREE.MathUtils.clamp(p.position.z + mz * speed * dt, -WORLD.half, WORLD.half);
    // Margin escape (same rule as police): a pedestrian already inside the
    // clearance ring may cross the ring to get out, just not into the core.
    const pedMargin = collidesBuilding(buildings, p.position.x, p.position.z, 0.6) ? 0 : 0.6;
    if (!collidesBuilding(buildings, nx, p.position.z, pedMargin)) p.position.x = nx;
    if (!collidesBuilding(buildings, p.position.x, nz, pedMargin)) p.position.z = nz;
    u.lastPX = p.position.x;
    u.lastPZ = p.position.z;
    // Blocked while wandering (not fleeing): retarget instead of pushing a wall.
    if (u.flee <= 0 && u.dodge <= 0 && u.target && mx !== 0 && mz !== 0) {
      const moved = Math.hypot(p.position.x - prevX, p.position.z - prevZ);
      if (moved < 0.01) u.target = pickPedTarget(p, buildings, u.rng);
    }
    if (mx !== 0 || mz !== 0) {
      p.rotation.y = Math.atan2(mx, mz);
      animateWalk(p, dt, Math.min(1, speed / 6));
    } else {
      animateIdle(p);
    }
  }
}

// ---------------------------------------------------------------- enemies
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
    e.userData.meleeCd = 0;
    scene.add(e);
    enemies.push(e);
  }
  return enemies;
}

/** Enemies chase the actor inside 18 units and deal melee damage under 4. */
export function updateEnemies(enemies, actorPos, dt, onMelee) {
  for (const e of enemies) {
    if (!e.userData.alive) continue;
    const u = e.userData;
    u.meleeCd = Math.max(0, (u.meleeCd || 0) - dt);
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
        if (u.meleeCd <= 0) {
          playMelee(e);
          u.meleeCd = 0.9;
        }
        onMelee(dt);
        updateCharacterAnims(e, dt); // keep the swing clip advancing
      }
    } else {
      animateIdle(e);
    }
  }
}
