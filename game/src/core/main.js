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
import { createRenderer, createEnvironment } from './rendering.js';
import { loadSettings, saveSettings, applyQualityToDom, presetFor } from './settings.js';
import { buildWorld, collidesBuilding, animateOcean } from '../world/world.js';
import {
  createCharacter, animateWalk, animateIdle,
  spawnPedestrians, updatePedestrians, spawnEnemies, updateEnemies,
  setWeapon, setAiming, playShoot, playReload, playJump,
  playEnterVehicle, playExitVehicle, updateCharacterAnims,
} from '../characters/characters.js';
import {
  makeCar, spawnTraffic, updateTraffic,
  driveVehicle, vehicleCameraParams, setHeadlights, attachHeadlightBeams,
} from '../vehicles/vehicles.js';
import { resetDriveState } from '../vehicles/driving.js';
import { updatePolice, spawnPoliceCar } from '../AI/police.js';
import {
  WEAPONS,
  fire as fireModule,
  reloadWeapon as reloadWeaponModule,
  updateBullets as updateBulletsModule,
} from '../combat/combat.js';
import {
  GANG_ZONE, MISSION_POINTS, createMissionMarker, animateMarker,
  updateMissions, placeMarker,
} from '../missions/missions.js';
import { AudioEngine } from '../audio/audio.js';
import { createInput } from './input.js';
import { showToast, tickToast, setHudVisible, updateHud, drawMinimap } from '../UI/hud.js';
import { saveGame, loadGame } from '../save/save.js';
import { stageShot } from '../UI/shots.js';

const $ = (id) => document.getElementById(id);
const query = parseQuery();

// Settings (persisted) + URL overrides for testing (?quality= ?time= ?rain=).
// The query wins for this session only; it is never written to localStorage.
const settings = loadSettings();
if (query.quality && presetFor(query.quality)) settings.quality = query.quality;
if (query.time) settings.timeOfDay = query.time;
if (query.rain) settings.rain = query.rain;

// ---------------------------------------------------------------- renderer
// (rendering.js owns the renderer, lights, shadows, time-of-day, rain and
// contact shadows; main.js only wires the environment into the loop.)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 900);
const renderer = createRenderer(settings);
$('game').appendChild(renderer.domElement);
const env = createEnvironment(scene, renderer, settings, null);
applyQualityToDom(presetFor(settings.quality));

// ---------------------------------------------------------------- state
const { world, buildings, ocean } = buildWorld(scene);
env.world = world; // lets env.setWet prefer a world.setWet hook if one ships
// World time/weather hooks (World Specialist): if world.js exports
// setTimeOfDay(hour)/setWet(amount), bind them so one call drives both
// the sky dome (world) and the lights/fog (rendering). Dynamic import so
// a mid-rewrite world.js can never break the game load; missing hooks
// simply leave the rendering-side behaviour in place.
import('../world/world.js').then((w) => {
  if (typeof w.setTimeOfDay === 'function') env.worldSetTimeOfDay = w.setTimeOfDay;
  if (typeof w.setWet === 'function') env.worldSetWet = w.setWet;
}).catch(() => { /* world hooks unavailable: rendering fallback stands */ });

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
  reloading: false,
  reloadTimer: 0,
  recoil: 0,
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

// ---- combat hooks (combat.js calls main.js-owned state through G).
// triggerWanted is a function declaration below (hoisted), updateHud is
// imported above, so these assignments are valid here.
G.triggerWanted = (n) => triggerWanted(n);
G.updateHud = () => updateHud(G);

// ---- rendering hooks (rendering.js + settings.js). Used by the settings
// panel (index.html), the ?shot= scenes (shots.js) and the test harness.
// Defined before the shot-mode block so stageShot can call setTimeOfDay.
G.settings = settings;
G.renderEnv = env;
G.armor = 0; // no armor pickup ships yet; HUD shows 0% until one does
G.frameMs = 0;
G.setQuality = (name) => {
  settings.quality = name;
  saveSettings(settings);
  env.setQuality(name, (msg) => showToast(msg));
};
G.setTimeOfDay = (name, instant = false) => {
  settings.timeOfDay = name;
  saveSettings(settings);
  env.setTimeOfDay(name, instant);
};
G.setWet = (v) => {
  settings.rain = v;
  saveSettings(settings);
  env.setWet(v);
  G.audio.setRain(v);
};
G.setRain = G.setWet;
// Audio volumes from the persisted settings (stored until ensure() builds
// the context on the first user gesture).
G.audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
G.audio.setMusicEnabled(settings.musicOn);
if (settings.rain > 0) G.setWet(settings.rain); // rain visuals + wet roads + rain audio

G.player.position.set(-5, 0, 0);scene.add(G.player);
G.playerCar.position.set(4, 0, 2);
scene.add(G.playerCar);
attachHeadlightBeams(G.playerCar);
setHeadlights(G.playerCar, true);
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
  if (code === 'Digit1' && !repeat) { G.selectWeapon('pistol'); setWeapon(G.player, 'pistol'); updateHud(G); }
  if (code === 'Digit2' && !repeat && G.hasSmg) { G.selectWeapon('smg'); setWeapon(G.player, 'smg'); updateHud(G); }
}

G.input = createInput(renderer.domElement, {
  isPlaying: () => G.gameStarted && !G.gameOver,
  onKey,
  onFire: () => fire(),
});

// Aim stance follows the HELD fire button (not pointer lock alone — the
// walk/run clips must keep playing while the player moves). input.js only
// reports the click, not the hold, so the hold state lives here.
let firing = false;
let aiming = false;
addEventListener('mousedown', (e) => { if (e.button === 0) firing = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
addEventListener('blur', () => { firing = false; });

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
  // NOTE (D8 fix): do NOT auto-lock the pointer here. While pointer lock is
  // active the browser retargets every mouse event to the canvas, so the HUD
  // buttons (SAVE GAME / LOAD SAVE / SOUND) become unclickable and each click
  // fires the weapon instead. Pointer lock happens only when the player
  // clicks the canvas (see input.js), so the HUD stays usable after start.
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- combat
// Shooting lives in src/combat/combat.js; these wrappers keep the existing
// call sites (onKey KeyR, input onFire, animate loop) unchanged, and add
// the character animation hooks (shoot/reload poses, on foot only).
function reloadWeapon() {
  if (reloadWeaponModule(G)) playReload(G.player);
}

function fire() {
  if (fireModule(G) && !G.currentCar) playShoot(G.player);
}

function updateBullets(dt) { updateBulletsModule(G, dt); }

// ---------------------------------------------------------------- vehicles
function tryEnterExit() {
  // A vehicle tween owns the player for ~1 s; ignore E until it finishes.
  if (G.player.userData.vehicleAnim) return;
  if (G.currentCar) {
    const car = G.currentCar;
    playExitVehicle(G.player, car, () => {
      // The tween ends at the side spot (2.3 u). If that spot landed
      // inside a building (side 1 can be blocked), fall back to the
      // other side, then the rear — the same spots v1 used.
      const rot = car.rotation.y;
      let px = G.player.position.x;
      let pz = G.player.position.z;
      if (collidesBuilding(buildings, px, pz, 0.65)) {
        const altX = car.position.x - Math.cos(rot) * 2.3;
        const altZ = car.position.z + Math.sin(rot) * 2.3;
        if (!collidesBuilding(buildings, altX, altZ, 0.65)) {
          px = altX; pz = altZ;
        } else {
          px = car.position.x - Math.sin(rot) * 3;
          pz = car.position.z - Math.cos(rot) * 3;
        }
        G.player.position.set(px, 0, pz);
      }
      G.player.visible = true;
      G.currentCar = null;
      showToast('ON FOOT');
    });
    return;
  }
  let nearest = null;
  let dist = 4.4;
  for (const c of [G.playerCar, ...G.traffic]) {
    const d = c.position.distanceTo(G.player.position);
    if (d < dist) { dist = d; nearest = c; }
  }
  if (nearest) {
    // Keep the player visible during the entry animation; the car is
    // taken only when the tween finishes (onDone).
    G.player.visible = true;
    playEnterVehicle(G.player, nearest, () => {
      G.currentCar = nearest;
      resetDriveState(nearest);
      G.player.visible = false;
      showToast('VEHICLE TAKEN • POLICE ALERT');
      triggerWanted(1);
    });
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
  // A vehicle entry/exit tween owns the player for ~1 s; input must not
  // fight it (the tween is advanced by updateCharacterAnims in the loop).
  if (G.player.userData.vehicleAnim) return;
  if (G.currentCar) {
    const car = G.currentCar;
    const result = driveVehicle(car, {
      forward: !!keys.KeyW,
      back: !!keys.KeyS,
      left: !!keys.KeyA,
      right: !!keys.KeyD,
      handbrake: !!keys.Space, // Space is jump on foot only, free in a car
    }, dt, {
      collides: (x, z, r) => collidesBuilding(buildings, x, z, r),
    });
    if (result.collided && result.impact > 3) {
      showToast('CRASH • VEHICLE ' + Math.round(car.userData.health) + '%');
    }
    playerYaw = car.rotation.y;
    G.audio.setEngine(
      Math.abs(car.userData.speed) / (car.userData.spec?.topSpeed || 25), true,
    );
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
    if (keys.Space && onGround) { verticalVelocity = 7; onGround = false; playJump(G.player); }
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
  const params = G.currentCar
    ? vehicleCameraParams(G.currentCar)
    : { distance: 7.2, height: 4.1, fov: 68, lookHeight: 1.6 };
  const distance = params.distance;
  const height = params.height;
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
  camera.lookAt(new THREE.Vector3(p.x, p.y + params.lookHeight, p.z));
  if (Math.abs(camera.fov - params.fov) > 0.05) {
    camera.fov += (params.fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- shot mode
if (query.shot) {
  const staged = stageShot(query.shot, G);
  setHudVisible(staged !== 'start' && query.hud !== '0');
} else if (query.hideHud) {
  setHudVisible(false);
}

// ---- day/night cycle: slow automatic advance through the time presets
// (golden -> dusk -> night -> noon -> golden), one phase per 240 s of
// play. The cycle always advances FROM the current preset, so a manual
// choice in the settings panel (or ?time=) is respected as the new phase.
// Paused on the start screen (gameStarted false) and in ?shot= mode.
const TIME_CYCLE = ['golden', 'dusk', 'night', 'noon'];
const TIME_CYCLE_SECONDS = 240;
let timeCycleTimer = 0;

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
  G.frameMs = G.frameMs ? G.frameMs * 0.95 + dt * 1000 * 0.05 : dt * 1000;

  if (G.gameStarted && !G.gameOver) {
    moveActor(dt);
    // Rig mixer: advanced here ONLY when moveActor did not already do it
    // (animateWalk/animateIdle advance it on foot). In a car, or during a
    // vehicle tween, nobody else advances it — without this the rig would
    // freeze mid-pose and the tween would never run.
    if (G.currentCar || G.player.userData.vehicleAnim) updateCharacterAnims(G.player, dt);
    // Aim stance follows the held fire button while on foot and locked.
    const wantAim = firing && !G.currentCar && document.pointerLockElement === renderer.domElement;
    if (wantAim !== aiming) { aiming = wantAim; setAiming(G.player, aiming); }
    updateTraffic(G.traffic, G.currentCar || G.playerCar, dt);
    updatePoliceSpawns(dt);
    updateEnemies(G.enemies, G.actorPosition(), dt, (meleeDt) => { G.health -= meleeDt * 3; });
    updatePedestrians(G.peds, buildings, dt, G.gunfireEvent, G.traffic, {
      playerCar: G.currentCar,
      onWitness: () => triggerWanted(1),
    });
    G.gunfireEvent = null;
    updateBullets(dt);
    updateMissions(G, dt);
    updateCamera(dt);
    // Day/night cycle (see TIME_CYCLE below): slow automatic advance
    // through the time presets, paused in ?shot= mode.
    if (!G.shotMode) {
      timeCycleTimer += dt;
      if (timeCycleTimer >= TIME_CYCLE_SECONDS) {
        timeCycleTimer = 0;
        const cur = TIME_CYCLE.indexOf(settings.timeOfDay);
        G.setTimeOfDay(TIME_CYCLE[(cur + 1) % TIME_CYCLE.length]);
      }
    }
    animateMarker(G.marker, dt);
    animateOcean(ocean, now / 1000);
    // SMG pickup.
    if (!smgTaken && G.player.visible && G.player.position.distanceTo(smgCrate.position) < 3) {
      smgTaken = true;
      scene.remove(smgCrate);
      G.selectWeapon('smg');
      setWeapon(G.player, 'smg');
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
  // Rendering environment: shadow frustum follows the actor, time-of-day
  // transition, rain, contact shadows, dust, ocean glint.
  env.update(dt, G.actorPosition(), G);
  env.updateOcean(ocean);
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    window.__ready = true;
    window.__game = G;
    window.dispatchEvent(new Event('suncoast-ready'));
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
