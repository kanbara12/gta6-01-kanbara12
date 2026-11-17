// SUNCOAST: HEATLINE — entry point and game loop.
// One clear job: wire the modules together (world, characters, vehicles,
// missions, audio, input, HUD, save, shots) and run the simulation: movement,
// driving, combat, wanted heat, camera and the frame loop.
//
// This file is the game's own code, written in this session from the
// SUNCOAST: HEATLINE prototype's architecture. Original work: no Rockstar /
// GTA names, characters, art, music or map data anywhere in this game.

import * as THREE from 'three';
import { WORLD, clamp, parseQuery } from './config.js';
import { buildWorld, collidesBuilding, animateOcean } from './world.js';
import {
  createCharacter, animateWalk, animateIdle,
  spawnPedestrians, updatePedestrians, spawnEnemies, updateEnemies,
} from './characters.js';
import {
  makeCar, animateCar, spawnTraffic, updateTraffic, updatePolice, spawnPoliceCar,
} from './vehicles.js';
import {
  GANG_ZONE, MISSION_POINTS, createMissionMarker, animateMarker,
  updateMissions, placeMarker,
} from './missions.js';
import { AudioEngine } from './audio.js';
import { createInput } from './input.js';
import { showToast, tickToast, setHudVisible, updateHud, drawMinimap } from './hud.js';
import { saveGame, loadGame } from './save.js';
import { stageShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const query = parseQuery();

// ---------------------------------------------------------------- renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b7c8);
scene.fog = new THREE.Fog(0x9fc4cf, 105, 320);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 900);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
$('game').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xd9f5ff, 0x38404a, 2.0));
const sun = new THREE.DirectionalLight(0xffe1b2, 2.4);
sun.position.set(-65, 110, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -170;
sun.shadow.camera.right = 170;
sun.shadow.camera.top = 170;
sun.shadow.camera.bottom = -170;
scene.add(sun);
// Cool fill from the east so the shaded faces of the waterfront towers are
// readable instead of flat silhouettes.
const fill = new THREE.DirectionalLight(0xbfd9ff, 0.7);
fill.position.set(120, 60, -40);
scene.add(fill);

// ---------------------------------------------------------------- state
const { world, buildings, ocean } = buildWorld(scene);

const WEAPONS = {
  pistol: { id: 'pistol', name: 'Pistol', magSize: 12, fireRate: 0.28, damage: 1, bulletSpeed: 48 },
  smg: { id: 'smg', name: 'SMG', magSize: 30, fireRate: 0.09, damage: 1, bulletSpeed: 60 },
};

const G = {
  scene, camera, renderer, buildings, ocean,
  player: createCharacter(0x1c5267),
  playerCar: makeCar(0x1e8291),
  currentCar: null,
  traffic: [],
  police: [],
  enemies: [],
  peds: [],
  bullets: [],
  marker: null,
  audio: new AudioEngine(),
  input: null,
  health: 100,
  money: 1250,
  wanted: 0,
  heat: 0,
  kills: 0,
  missionIndex: 0,
  missionTitle: 'A Favor in the Heat',
  objectiveText: 'Find the fixer marked on your map.',
  garageTimer: 0,
  gameStarted: false,
  gameOver: false,
  shotMode: false,
  shotCamera: null,
  cameraSnapped: false,
  seed: query.seed,
  weapon: { ...WEAPONS.pistol, mag: 12, reserve: Infinity },
  hasSmg: false,
  lastShotAt: 0,
  policeSpawn: 0,
  gunfireEvent: null,
  fps: 0,
  showToast,
  actorPosition() { return (this.currentCar || this.player).position; },
  placeMarker() { placeMarker(this.marker, this.missionIndex); },
  selectWeapon(id, mag) {
    const def = WEAPONS[id] || WEAPONS.pistol;
    this.weapon = { ...def, mag: mag ?? def.magSize, reserve: id === 'smg' ? 120 : Infinity };
    if (id === 'smg') this.hasSmg = true;
  },
};

G.player.position.set(-5, 0, 0);
scene.add(G.player);
G.playerCar.position.set(4, 0, 2);
scene.add(G.playerCar);
G.traffic = spawnTraffic(scene);
G.enemies = spawnEnemies(scene, GANG_ZONE);
G.peds = spawnPedestrians(scene, buildings);
G.marker = createMissionMarker(scene);
placeMarker(G.marker, 0);

// SMG pickup crate beside the fixer.
const smgCrate = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 0.7, 1.1),
  new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x6b4d00, roughness: 0.4 }),
);
smgCrate.position.set(6, 0.35, 6);
smgCrate.castShadow = true;
scene.add(smgCrate);
let smgTaken = false;

// ---------------------------------------------------------------- input
let playerYaw = 0;
let verticalVelocity = 0;
let onGround = true;

function onKey(code, repeat) {
  if (code === 'KeyE' && !repeat && G.gameStarted) tryEnterExit();
  if (code === 'KeyP' && !repeat) saveGame(G);
  if (code === 'KeyL' && !repeat) loadGame(G);
  if (code === 'KeyH' && !repeat) setHudVisible(document.getElementById('hud').classList.contains('hidden'));
  if (code === 'KeyM' && !repeat) {
    G.audio.ensure();
    G.audio.setMuted(!G.audio.muted);
    updateHud(G);
  }
  if (code === 'KeyR' && !repeat) reloadWeapon();
  if (code === 'Digit1' && !repeat) { G.selectWeapon('pistol'); updateHud(G); }
  if (code === 'Digit2' && !repeat && G.hasSmg) { G.selectWeapon('smg'); updateHud(G); }
}

G.input = createInput(renderer.domElement, {
  isPlaying: () => G.gameStarted && !G.gameOver,
  onKey,
  onFire: () => fire(),
});

$('saveBtn').addEventListener('click', () => saveGame(G));
$('loadBtn').addEventListener('click', () => loadGame(G));
$('audioBtn').addEventListener('click', () => {
  G.audio.ensure();
  G.audio.setMuted(!G.audio.muted);
  updateHud(G);
});
$('startBtn').addEventListener('click', () => {
  G.audio.ensure();
  G.audio.click();
  $('startCard').classList.add('hidden');
  G.gameStarted = true;
  showToast('WELCOME TO SUNCOAST • FIND THE FIXER');
  G.input.lockPointer();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- combat
function reloadWeapon() {
  const w = G.weapon;
  if (w.mag === w.magSize) return;
  if (w.reserve === Infinity) {
    w.mag = w.magSize;
  } else {
    const need = w.magSize - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
  G.audio.click();
  updateHud(G);
}

const _tmpV = new THREE.Vector3();

function fire() {
  if (!G.gameStarted || G.gameOver) return;
  const now = performance.now();
  if (now - G.lastShotAt < G.weapon.fireRate * 1000) return;
  if (G.weapon.mag <= 0) {
    reloadWeapon();
    return;
  }
  G.lastShotAt = now;
  G.weapon.mag -= 1;
  const origin = G.actorPosition().clone();
  origin.y += G.currentCar ? 1.25 : 1.65;
  const aimYaw = G.currentCar ? G.currentCar.rotation.y : G.input.cameraYaw;
  const dir = new THREE.Vector3(Math.sin(aimYaw), 0, Math.cos(aimYaw));
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd36b }),
  );
  mesh.position.copy(origin).addScaledVector(dir, 1.2);
  scene.add(mesh);
  G.bullets.push({ mesh, dir, life: 1.7, speed: G.weapon.bulletSpeed, damage: G.weapon.damage });
  G.audio.ensure();
  G.audio.gunshot();
  G.gunfireEvent = { x: origin.x, z: origin.z };
  triggerWanted(1);
  updateHud(G);
}

function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    let hit = false;
    for (const e of G.enemies) {
      if (!e.userData.alive) continue;
      _tmpV.copy(e.position);
      _tmpV.y += 1;
      if (b.mesh.position.distanceTo(_tmpV) < 1.1) {
        e.userData.health -= b.damage;
        hit = true;
        if (e.userData.health <= 0) {
          e.userData.alive = false;
          e.visible = false;
          G.kills += 1;
          G.money += 150;
          showToast('TARGET DOWN • +$150');
          G.audio.chime();
        }
        break;
      }
    }
    if (hit || b.life <= 0 || b.mesh.position.length() > 400) {
      scene.remove(b.mesh);
      G.bullets.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- vehicles
function tryEnterExit() {
  if (G.currentCar) {
    // Step out on the side that is not inside a building.
    const rot = G.currentCar.rotation.y;
    for (const side of [1, -1]) {
      const px = G.currentCar.position.x + Math.cos(rot) * 2.3 * side;
      const pz = G.currentCar.position.z - Math.sin(rot) * 2.3 * side;
      if (!collidesBuilding(buildings, px, pz, 0.65)) {
        G.player.position.set(px, 0, pz);
        G.player.visible = true;
        G.currentCar = null;
        showToast('ON FOOT');
        return;
      }
    }
    // Both sides blocked: exit at the rear instead.
    G.player.position.set(
      G.currentCar.position.x - Math.sin(rot) * 3,
      0,
      G.currentCar.position.z - Math.cos(rot) * 3,
    );
    G.player.visible = true;
    G.currentCar = null;
    showToast('ON FOOT');
    return;
  }
  let nearest = null;
  let dist = 4.4;
  for (const c of [G.playerCar, ...G.traffic]) {
    const d = c.position.distanceTo(G.player.position);
    if (d < dist) { dist = d; nearest = c; }
  }
  if (nearest) {
    G.currentCar = nearest;
    G.player.visible = false;
    showToast('VEHICLE TAKEN • POLICE ALERT');
    triggerWanted(1);
  } else {
    showToast('NO VEHICLE IN REACH');
  }
}

function triggerWanted(n = 1) {
  G.wanted = clamp(G.wanted + n, 0, 5);
  G.heat = 42;
  showToast('POLICE RESPONSE INCREASED • WANTED ' + G.wanted);
}

function moveActor(dt) {
  const keys = G.input.keys;
  if (G.currentCar) {
    const car = G.currentCar;
    const u = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    car.userData.speed += ((keys.KeyW ? 17 : 0) - (keys.KeyS ? 23 : 0) - car.userData.speed * 1.5) * dt;
    car.userData.speed = clamp(car.userData.speed, -11, 25);
    const turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    car.rotation.y += turn * dt * (1.65 + Math.abs(car.userData.speed) * 0.045) * Math.sign(car.userData.speed || 1);
    const dx = Math.sin(car.rotation.y) * car.userData.speed * dt;
    const dz = Math.cos(car.rotation.y) * car.userData.speed * dt;
    // East edge stops at the beach (x = 150): cars never drive into the ocean.
    const nx = clamp(car.position.x + dx, -WORLD.half, 150);
    const nz = clamp(car.position.z + dz, -WORLD.half, WORLD.half);
    if (!collidesBuilding(buildings, nx, nz, 1.6)) {
      car.position.x = nx;
      car.position.z = nz;
    } else {
      car.userData.speed *= -0.22;
      car.userData.health -= Math.abs(car.userData.speed) * 0.8;
    }
    playerYaw = car.rotation.y;
    animateCar(car, dt, turn);
    G.audio.setEngine(Math.abs(car.userData.speed) / 25, true);
  } else {
    const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const sprinting = keys.ShiftLeft || keys.ShiftRight;
    const speed = sprinting ? 10 : 6.2;
    const yaw = G.input.cameraYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let vx = fx * forward + rx * side;
    let vz = fz * forward + rz * side;
    const len = Math.hypot(vx, vz) || 1;
    vx /= len;
    vz /= len;
    const moving = forward !== 0 || side !== 0;
    // On foot the east edge is the beach (x = 151.5): the player can walk the
    // sand but never wades into the ocean; the pier is scenery.
    const nx = clamp(G.player.position.x + vx * speed * dt, -WORLD.half, 151.5);
    const nz = clamp(G.player.position.z + vz * speed * dt, -WORLD.half, WORLD.half);
    if (!collidesBuilding(buildings, nx, G.player.position.z, 0.65)) G.player.position.x = nx;
    if (!collidesBuilding(buildings, G.player.position.x, nz, 0.65)) G.player.position.z = nz;
    if (moving) {
      playerYaw = Math.atan2(vx, vz);
      G.player.rotation.y = playerYaw;
      animateWalk(G.player, dt, sprinting ? 1 : 0.55);
      G.audio.footstep(sprinting);
    } else {
      animateIdle(G.player);
    }
    if (keys.Space && onGround) { verticalVelocity = 7; onGround = false; }
    verticalVelocity -= 19 * dt;
    G.player.position.y += verticalVelocity * dt;
    if (G.player.position.y <= 0) { G.player.position.y = 0; verticalVelocity = 0; onGround = true; }
    G.audio.setEngine(0, false);
  }
}

// ---------------------------------------------------------------- police
function updatePoliceSpawns(dt) {
  const p = G.actorPosition();
  if (G.wanted > 0) {
    G.policeSpawn -= dt;
    if (G.police.length < Math.min(1 + G.wanted, 4) && G.policeSpawn <= 0) {
      G.police.push(spawnPoliceCar(scene, p, Math.random, buildings));
      G.policeSpawn = 4.5;
    }
  } else {
    for (let i = G.police.length - 1; i >= 0; i -= 1) {
      scene.remove(G.police[i]);
      G.police.splice(i, 1);
    }
  }
  updatePolice(G.police, buildings, p, G.wanted, dt, (ramDt) => {
    G.health -= ramDt * (G.currentCar ? 3.5 : 7);
    if (G.currentCar) G.currentCar.userData.health -= ramDt * 5;
  });
  if (G.wanted > 0) {
    G.heat -= dt;
    if (G.heat <= 0 && G.police.every((c) => c.position.distanceTo(p) > 35)) {
      G.wanted = Math.max(0, G.wanted - 1);
      G.heat = 18;
      showToast(G.wanted ? 'HEAT COOLING • KEEP HIDING' : 'YOU LOST THE POLICE');
    }
  }
  G.audio.setSiren(G.police.length > 0);
  G.audio.updateSiren(dt);
}

// ---------------------------------------------------------------- camera
function updateCamera(dt) {
  if (G.shotCamera) {
    if (!G.cameraSnapped) {
      camera.position.copy(G.shotCamera.pos);
      G.cameraSnapped = true;
    }
    camera.lookAt(G.shotCamera.look);
    return;
  }
  const p = G.actorPosition();
  const yaw = G.currentCar ? G.currentCar.rotation.y : G.input.cameraYaw;
  const distance = G.currentCar ? 9 : 7.2;
  const height = G.currentCar ? 4.8 : 4.1;
  const desired = new THREE.Vector3(
    p.x - Math.sin(yaw) * distance,
    p.y + height,
    p.z - Math.cos(yaw) * distance,
  );
  if (!G.cameraSnapped) {
    // Snap on the first frame: no opening swoop from the origin, and a
    // ?shot= screenshot is framed exactly as staged, even at low frame rates.
    camera.position.copy(desired);
    G.cameraSnapped = true;
  } else {
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  }
  camera.lookAt(new THREE.Vector3(p.x, p.y + (G.currentCar ? 1.2 : 1.6), p.z));
}

// ---------------------------------------------------------------- shot mode
if (query.shot) {
  const staged = stageShot(query.shot, G);
  setHudVisible(staged !== 'start' && query.hud !== '0');
} else if (query.hideHud) {
  setHudVisible(false);
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;
let fpsTime = 0;
let firstFrame = true;
let totalFrames = 0;

function animate(now) {
  requestAnimationFrame(animate);
  totalFrames += 1;
  const dt = Math.min((now - last) / 1000, 0.04);
  last = now;
  fpsAccum += dt;
  fpsFrames += 1;
  fpsTime += dt;
  if (fpsTime >= 1) {
    G.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }

  if (G.gameStarted && !G.gameOver) {
    moveActor(dt);
    updateTraffic(G.traffic, G.playerCar, dt);
    updatePoliceSpawns(dt);
    updateEnemies(G.enemies, G.actorPosition(), dt, (meleeDt) => { G.health -= meleeDt * 3; });
    updatePedestrians(G.peds, buildings, dt, G.gunfireEvent);
    G.gunfireEvent = null;
    updateBullets(dt);
    updateMissions(G, dt);
    updateCamera(dt);
    animateMarker(G.marker, dt);
    animateOcean(ocean, now / 1000);
    // SMG pickup.
    if (!smgTaken && G.player.visible && G.player.position.distanceTo(smgCrate.position) < 3) {
      smgTaken = true;
      scene.remove(smgCrate);
      G.selectWeapon('smg');
      G.audio.chime();
      showToast('SMG ACQUIRED • PRESS 2 TO EQUIP, R TO RELOAD');
    }
    if (G.health <= 0) {
      G.health = 0;
      G.gameOver = true;
      showToast('BUSTED • PRESS L TO LOAD YOUR LAST SAVE');
    }
    tickToast(dt);
    updateHud(G);
    drawMinimap(G);
  } else if (!G.gameStarted) {
    // Start screen: keep the minimap live behind the card instead of a
    // blank dark canvas.
    drawMinimap(G);
    camera.position.set(0, 13, 23);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    window.__ready = true;
    window.__game = G;
  }
}
requestAnimationFrame(animate);

// Test hooks (used by the local playtest harness only; harmless in the game).
window.__fps = () => G.fps;
window.__frames = () => totalFrames;
window.addEventListener('error', (e) => {
  window.__errors = window.__errors || [];
  window.__errors.push(String(e.message));
});
