// Detailed vehicle models for SUNCOAST: HEATLINE.
// One clear job: build every drivable vehicle type as a detailed procedural
// Group (bodywork, cabin glass, wheels + rims, bumpers, grille, mirrors,
// lights) — all local geometry, zero external assets, zero network requests.
// GLB files, when the art pass supplies them, load through the vendored
// GLTFLoader (game/vendor/GLTFLoader.js, three 0.187.0) via loadVehicleGLB()
// and are then wrapped with the same userData contract.
//
// Visual direction (reference only, nothing copied): sunset coastal city,
// dense HUD, warm paint + chrome + glass — so every type gets a warm
// two-tone paint, chrome trim and dark glass, not flat single-colour boxes.

import * as THREE from 'three';
import { clamp } from '../core/config.js';

/** Per-type tuning. Units are world units / seconds (1 unit ≈ 1 m). */
export const VEHICLE_TYPES = {
  sedan: {
    label: 'Sedan', topSpeed: 26, accel: 13, brake: 28, reverseTop: 11,
    steerMax: 0.55, wheelbase: 2.7, length: 4.25, width: 2.15, height: 1.9,
    grip: 1.0, camDist: 9.0, camHeight: 4.8,
  },
  suv: {
    label: 'SUV', topSpeed: 24, accel: 10.5, brake: 26, reverseTop: 10,
    steerMax: 0.5, wheelbase: 2.9, length: 4.6, width: 2.25, height: 2.15,
    grip: 0.95, camDist: 9.6, camHeight: 5.2,
  },
  truck: {
    label: 'Pickup', topSpeed: 21, accel: 8.5, brake: 24, reverseTop: 9,
    steerMax: 0.46, wheelbase: 3.4, length: 5.4, width: 2.2, height: 2.1,
    grip: 0.9, camDist: 10.4, camHeight: 5.6,
  },
  sports: {
    label: 'Sports', topSpeed: 33, accel: 16, brake: 32, reverseTop: 12,
    steerMax: 0.5, wheelbase: 2.6, length: 4.1, width: 2.1, height: 1.55,
    grip: 1.15, camDist: 9.8, camHeight: 4.4,
  },
  taxi: {
    label: 'Taxi', topSpeed: 26, accel: 13, brake: 28, reverseTop: 11,
    steerMax: 0.55, wheelbase: 2.7, length: 4.25, width: 2.15, height: 1.95,
    grip: 1.0, camDist: 9.0, camHeight: 4.8,
  },
  police: {
    label: 'Police', topSpeed: 27, accel: 13.5, brake: 30, reverseTop: 11,
    steerMax: 0.55, wheelbase: 2.7, length: 4.25, width: 2.15, height: 1.95,
    grip: 1.05, camDist: 9.0, camHeight: 4.8,
  },
};

export const VEHICLE_TYPE_NAMES = Object.keys(VEHICLE_TYPES);

function paint(color, roughness = 0.42, metalness = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function trim(color = 0x22282c, roughness = 0.55, metalness = 0.4) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function chrome() {
  return new THREE.MeshStandardMaterial({ color: 0xc8d2d6, roughness: 0.18, metalness: 0.9 });
}
function glassMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x274b5c, metalness: 0.45, roughness: 0.12,
    transparent: true, opacity: 0.78,
  });
}

function addBox(parent, w, h, d, material, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** One wheel: tyre + rim + hubcap + brake disc, spinning around local X. */
function makeWheel(radius, width) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 18),
    new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.92 }),
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 10),
    new THREE.MeshStandardMaterial({ color: 0xaeb9bd, roughness: 0.28, metalness: 0.75 }),
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width + 0.04, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: 0.4, metalness: 0.6 }),
  );
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, 0.03, 12),
    new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.35, metalness: 0.8 }),
  );
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -width / 2 - 0.01;
  g.add(disc);
  return g;
}

/**
 * Headlight + taillight lenses.
 * headMat / brakeMat are emissive materials kept in userData so driving.js
 * and animateCar() can switch them (brake glow, headlight on/off, damage
 * flicker) without rebuilding the car.
 */
function addLights(g, spec, halfW, frontZ, rearZ, bodyY) {
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8, emissive: 0xffe9a8, emissiveIntensity: 0.25, roughness: 0.3,
  });
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x7a1010, emissive: 0xff2a1a, emissiveIntensity: 0.25, roughness: 0.3,
  });
  for (const x of [-halfW + 0.28, halfW - 0.28]) {
    addBox(g, 0.42, 0.2, 0.08, headMat, x, bodyY + 0.08, frontZ + 0.02, false);
    addBox(g, 0.42, 0.18, 0.08, brakeMat, x, bodyY + 0.08, rearZ - 0.02, false);
  }
  // Front grille + bumper strip, rear bumper.
  addBox(g, halfW * 1.1, 0.16, 0.1, trim(0x1b2024, 0.5, 0.5), 0, bodyY - 0.12, frontZ + 0.01, false);
  addBox(g, spec.width - 0.1, 0.22, 0.14, chrome(), 0, bodyY - 0.28, frontZ + 0.02, false);
  addBox(g, spec.width - 0.1, 0.22, 0.14, chrome(), 0, bodyY - 0.28, rearZ - 0.02, false);
  return { headMat, brakeMat };
}

function addMirrors(g, halfW, cabinY) {
  for (const s of [-1, 1]) {
    addBox(g, 0.1, 0.16, 0.3, trim(0x1b2024), s * (halfW + 0.06), cabinY - 0.15, 0.75, false);
  }
}

function addExhaust(g, spec, side = 1) {
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a9296, roughness: 0.3, metalness: 0.85 }),
  );
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(side * (spec.width / 2 - 0.5), 0.32, -spec.length / 2 - 0.05);
  g.add(pipe);
}

/**
 * Build the detailed body for one type. Returns { group, parts } where parts
 * holds the meshes the driving/visual code needs (body, cabin, wheels,
 * frontWheels, headMat, brakeMat, lightRed, lightBlue).
 */
export function buildVehicleModel(type = 'sedan', color = 0x2f788b, policeCar = false) {
  const spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan;
  const g = new THREE.Group();
  const bodyMat = paint(color);
  const glass = glassMat();
  const L = spec.length;
  const W = spec.width;
  const halfW = W / 2;
  const wheelR = type === 'truck' ? 0.48 : type === 'sports' ? 0.38 : 0.43;
  const wheelZ = type === 'truck' ? 1.75 : L / 2 - 0.78;
  const bodyY = wheelR + 0.36;
  const frontZ = L / 2;
  const rearZ = -L / 2;

  // --- lower body + hood / trunk shaping (stepped boxes read as panels) ---
  addBox(g, W, 0.62, L, bodyMat, 0, bodyY, 0);
  // Hood: lower, slightly narrower slab at the front.
  addBox(g, W - 0.16, 0.3, L * 0.26, bodyMat, 0, bodyY + 0.32, frontZ - L * 0.13);
  // Trunk deck at the rear.
  addBox(g, W - 0.16, 0.26, L * 0.2, bodyMat, 0, bodyY + 0.3, rearZ + L * 0.1);
  // Side skirts + chrome waistline trim.
  for (const s of [-1, 1]) {
    addBox(g, 0.08, 0.18, L * 0.62, trim(0x1b2024, 0.5, 0.5), s * (halfW + 0.01), bodyY - 0.22, -0.1, false);
    addBox(g, 0.05, 0.06, L * 0.8, chrome(), s * (halfW + 0.02), bodyY + 0.28, 0, false);
  }

  // --- cabin: glasshouse with pillars, roof panel ---
  let cabinY = bodyY + 0.62;
  let cabin;
  if (type === 'truck') {
    // Cab only; the bed is open behind it.
    cabin = addBox(g, W - 0.3, 0.85, 1.5, glass, 0, bodyY + 0.72, frontZ - 1.35);
    addBox(g, W - 0.24, 0.12, 1.55, bodyMat, 0, bodyY + 1.2, frontZ - 1.35);
    // Bed: floor + three walls + tailgate.
    addBox(g, W - 0.12, 0.1, L * 0.42, trim(0x2a3138, 0.8), 0, bodyY + 0.32, rearZ + L * 0.21);
    for (const s of [-1, 1]) addBox(g, 0.1, 0.55, L * 0.42, bodyMat, s * (halfW - 0.05), bodyY + 0.62, rearZ + L * 0.21);
    addBox(g, W - 0.12, 0.55, 0.1, bodyMat, 0, bodyY + 0.62, rearZ + 0.05);
    cabinY = bodyY + 0.72;
  } else {
    const cabinLen = type === 'sports' ? 1.7 : type === 'suv' ? 2.5 : 2.05;
    const cabinH = type === 'sports' ? 0.55 : type === 'suv' ? 0.85 : 0.72;
    const cabinZ = type === 'suv' ? -0.15 : -0.18;
    cabin = addBox(g, W - 0.42, cabinH, cabinLen, glass, 0, bodyY + 0.55 + cabinH / 2 - 0.12, cabinZ);
    // Roof panel + pillars (A/C) so the glass reads as windows, not a slab.
    addBox(g, W - 0.36, 0.1, cabinLen + 0.1, bodyMat, 0, bodyY + 0.55 + cabinH - 0.08, cabinZ);
    for (const s of [-1, 1]) {
      addBox(g, 0.09, cabinH, 0.12, bodyMat, s * (halfW - 0.24), bodyY + 0.55 + cabinH / 2 - 0.12, cabinZ + cabinLen / 2 - 0.06, false);
      addBox(g, 0.09, cabinH, 0.12, bodyMat, s * (halfW - 0.24), bodyY + 0.55 + cabinH / 2 - 0.12, cabinZ - cabinLen / 2 + 0.06, false);
    }
    cabinY = bodyY + 0.55 + cabinH / 2 - 0.12;
  }

  // --- type extras ---
  if (type === 'sports') {
    // Rear wing + front splitter + dual exhaust.
    addBox(g, W - 0.3, 0.07, 0.45, trim(0x14181c, 0.4, 0.6), 0, bodyY + 0.72, rearZ + 0.12);
    for (const s of [-1, 1]) addBox(g, 0.08, 0.3, 0.08, trim(0x14181c), s * (halfW - 0.35), bodyY + 0.55, rearZ + 0.12, false);
    addBox(g, W - 0.1, 0.1, 0.3, trim(0x14181c, 0.4, 0.6), 0, bodyY - 0.3, frontZ + 0.05, false);
    addExhaust(g, spec, -1);
    addExhaust(g, spec, 1);
  } else if (type === 'suv') {
    // Roof rails + spare-wheel hint on the tailgate.
    for (const s of [-1, 1]) addBox(g, 0.09, 0.09, L * 0.42, trim(0x2a3138, 0.5, 0.6), s * (halfW - 0.35), bodyY + 1.48, -0.2, false);
    const spare = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.18, 14),
      new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.92 }),
    );
    spare.rotation.x = Math.PI / 2;
    spare.position.set(0, bodyY + 0.35, rearZ - 0.1);
    g.add(spare);
    addExhaust(g, spec, 1);
  } else {
    addExhaust(g, spec, 1);
  }

  if (type === 'taxi') {
    // Roof sign + checker band + yellow livery is set by the caller colour;
    // the sign is the identifier, the band the taxi read at distance.
    addBox(g, 0.95, 0.3, 0.42, new THREE.MeshStandardMaterial({
      color: 0xffe9a8, emissive: 0xffc44d, emissiveIntensity: 0.55, roughness: 0.4,
    }), 0, cabinY + 0.55, -0.1, false);
    for (const s of [-1, 1]) {
      addBox(g, 0.06, 0.14, L * 0.5, trim(0x14181c, 0.6), s * (halfW + 0.01), bodyY + 0.05, 0, false);
    }
  }

  // --- wheels: steerable fronts, driven rears ---
  const wheels = [];
  const frontWheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (halfW - 0.02), wheelR, sz * wheelZ);
      const wheel = makeWheel(wheelR, 0.26);
      pivot.add(wheel);
      g.add(pivot);
      wheels.push({ pivot, wheel, front: sz > 0 });
      if (sz > 0) frontWheels.push(pivot);
    }
  }

  const { headMat, brakeMat } = addLights(g, spec, halfW, frontZ, rearZ, bodyY);
  addMirrors(g, halfW, cabinY);

  // --- police light bar (only when policeCar) ---
  let lightRed = null;
  let lightBlue = null;
  if (policeCar || type === 'police') {
    lightRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.16, 0.26),
      new THREE.MeshBasicMaterial({ color: 0xff334f }),
    );
    lightRed.position.set(-0.34, cabinY + 0.62, -0.1);
    g.add(lightRed);
    lightBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.16, 0.26),
      new THREE.MeshBasicMaterial({ color: 0x32baff }),
    );
    lightBlue.position.set(0.34, cabinY + 0.62, -0.1);
    g.add(lightBlue);
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return {
    group: g,
    parts: {
      body: g.children.find((c) => c.isMesh) || g, cabin, wheels, frontWheels,
      headMat, brakeMat, lightRed, lightBlue, lightPhase: 0, lean: 0,
      bodyY, wheelR, spec,
    },
  };
}

/**
 * makeVehicle(type, color) -> Group with the v1 contract:
 * .position / .rotation.y, userData { speed, health } — plus type, spec,
 * wheels, lights and a drive state slot (filled lazily by driving.js).
 */
export function makeVehicle(type = 'sedan', color = 0x2f788b, policeCar = false) {
  const spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan;
  const { group: g, parts } = buildVehicleModel(type, color, policeCar);
  g.userData = {
    speed: 0, health: 100, type, spec, policeCar: policeCar || type === 'police',
    wheels: parts.wheels.map((w) => w.wheel),
    wheelPivots: parts.wheels.map((w) => w.pivot),
    frontWheels: parts.frontWheels,
    body: parts.body, cabin: parts.cabin,
    headMat: parts.headMat, brakeMat: parts.brakeMat,
    lightRed: parts.lightRed, lightBlue: parts.lightBlue,
    lightPhase: 0, lean: 0, pitch: 0, damage: 0, damageSide: 1,
    headlightsOn: false, brakeOn: false, beams: null, drive: null,
  };
  return g;
}

/** Brake-light glow on/off (emissive; cheap, no extra lights). */
export function setBrakeLights(car, on) {
  const u = car.userData;
  if (!u.brakeMat) return;
  u.brakeOn = !!on;
  u.brakeMat.emissiveIntensity = on ? 2.6 : 0.25;
  u.brakeMat.color.setHex(on ? 0xff2a1a : 0x7a1010);
}

/** Headlight lenses on/off; also toggles real beam SpotLights if attached. */
export function setHeadlights(car, on) {
  const u = car.userData;
  if (!u.headMat) return;
  u.headlightsOn = !!on;
  u.headMat.emissiveIntensity = on ? 2.4 : 0.25;
  if (u.beams) for (const b of u.beams) b.visible = !!on;
}

/**
 * Attach two real SpotLight beams (player car only — one per car would cost
 * a shadow-less spotlight pair per traffic car; traffic uses emissive lenses).
 * Call once after the car is added to the scene; beams follow the car because
 * they are children of it. Returns the lights.
 */
export function attachHeadlightBeams(car) {
  const u = car.userData;
  if (u.beams) return u.beams;
  const spec = u.spec || VEHICLE_TYPES.sedan;
  const beams = [];
  for (const s of [-1, 1]) {
    const spot = new THREE.SpotLight(0xffe9a8, 60, 42, 0.42, 0.55, 1.4);
    spot.position.set(s * (spec.width / 2 - 0.35), 0.95, spec.length / 2 - 0.1);
    const target = new THREE.Object3D();
    target.position.set(s * 0.6, 0, 14);
    car.add(target);
    spot.target = target;
    spot.visible = !!u.headlightsOn;
    car.add(spot);
    beams.push(spot);
  }
  u.beams = beams;
  return beams;
}

/** Damage: health + handling degrade (driving.js reads userData.damage). */
export function applyDamage(car, amount, side = 1) {
  const u = car.userData;
  if (!u || typeof u.health !== 'number') return 0;
  const dmg = clamp(amount, 0, 100);
  u.health = clamp(u.health - dmg, 0, 100);
  u.damage = clamp(1 - u.health / 100, 0, 1);
  u.damageSide = side >= 0 ? 1 : -1;
  // Visual: a hard hit kinks the body — permanent slight list + one dim lamp.
  if (u.body) u.body.rotation.z = u.damage * 0.05 * u.damageSide;
  return u.health;
}

export function repairVehicle(car) {
  const u = car.userData;
  if (!u) return;
  u.health = 100; u.damage = 0; u.damageSide = 1;
  if (u.body) u.body.rotation.z = 0;
  if (u.headMat) u.headMat.emissiveIntensity = u.headlightsOn ? 2.4 : 0.25;
}

/**
 * Load a local GLB (game/assets/vehicles/…) and wrap it with the same
 * userData contract. GLBs are optional art upgrades — the procedural models
 * above are the default, so a missing file never breaks the game.
 * `path` must be a same-origin relative URL (never http(s)://).
 */
export async function loadVehicleGLB(path, type = 'sedan') {
  if (/^https?:\/\//i.test(path)) throw new Error('loadVehicleGLB: remote URLs are forbidden: ' + path);
  const { GLTFLoader } = await import('../../vendor/GLTFLoader.js');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(path);
  const g = gltf.scene;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan;
  g.userData = {
    speed: 0, health: 100, type, spec, policeCar: false,
    wheels: [], wheelPivots: [], frontWheels: [],
    body: g, cabin: null, headMat: null, brakeMat: null,
    lightRed: null, lightBlue: null, lightPhase: 0, lean: 0, pitch: 0,
    damage: 0, damageSide: 1, headlightsOn: false, brakeOn: false,
    beams: null, drive: null, glb: true,
  };
  return g;
}
