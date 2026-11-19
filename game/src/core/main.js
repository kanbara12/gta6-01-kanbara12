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
import { SAFEHOUSE_POS, SAFEHOUSE_CAM_RADIUS } from '../world/safehouse.js';
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
import { resetDriveState, vehicleTelemetry } from '../vehicles/driving.js';
import { updatePolice, spawnPoliceCar } from '../AI/police.js';
import { createHelicopter, updateHelicopter, helicopterState } from '../AI/helicopter.js';
import {
  WEAPONS, RESERVE_AMMO,
  fire as fireModule,
  reloadWeapon as reloadWeaponModule,
  updateBullets as updateBulletsModule,
  getWeaponState,
} from '../combat/combat.js';
import {
  GANG_ZONE, MISSION_POINTS, createMissionMarker, animateMarker,
  updateMissions, placeMarker, onStageStart,
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
const { world, buildings, ocean, palmSpots } = buildWorld(scene);
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
  hasShotgun: false,
  hasBat: true,
  _shotgunReserve: 24,
  _shotgunMag: 6,
  _lastNitro01: 1,
  lastScore: null,
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
    // Cache the outgoing weapon's ammo so switching back restores it
    // instead of silently refilling (the slot display reads these caches).
    const cur = this.weapon;
    if (cur) {
      if (cur.id === 'smg') { this._smgReserve = cur.reserve; this._smgMag = cur.mag; }
      if (cur.id === 'shotgun') { this._shotgunReserve = cur.reserve; this._shotgunMag = cur.mag; }
    }
    const def = WEAPONS[id] || WEAPONS.pistol;
    let reserve = Infinity;
    if (id === 'smg') reserve = this._smgReserve ?? RESERVE_AMMO.smg;
    if (id === 'shotgun') reserve = this._shotgunReserve ?? RESERVE_AMMO.shotgun;
    const cachedMag = id === 'smg' ? this._smgMag : id === 'shotgun' ? this._shotgunMag : undefined;
    this.weapon = { ...def, mag: mag ?? cachedMag ?? def.magSize, reserve };
    if (id === 'smg') this.hasSmg = true;
    if (id === 'shotgun') this.hasShotgun = true;
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
G.heli = createHelicopter(scene);

// SMG pickup crate beside the fixer.
const smgCrate = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 0.7, 1.1),
  new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x6b4d00, roughness: 0.4 }),
);
smgCrate.position.set(6, 0.35, 6);
smgCrate.castShadow = true;
scene.add(smgCrate);
let smgTaken = false;

// Shotgun pickup crate at the crew-yard edge (found before the yard fight).
const shotgunCrate = new THREE.Mesh(
  new THREE.BoxGeometry(1.1, 0.7, 1.1),
  new THREE.MeshStandardMaterial({ color: 0xe85d3d, emissive: 0x5a1a00, roughness: 0.4 }),
);
shotgunCrate.position.set(58, 0.35, -58);
shotgunCrate.castShadow = true;
scene.add(shotgunCrate);
let shotgunTaken = false;

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
  if (code === 'KeyT' && !repeat) reloadWeapon();
  if (code === 'Digit1' && !repeat) { G.selectWeapon('pistol'); setWeapon(G.player, 'pistol'); updateHud(G); }
  if (code === 'Digit2' && !repeat && G.hasSmg) { G.selectWeapon('smg'); setWeapon(G.player, 'smg'); updateHud(G); }
  if (code === 'Digit3' && !repeat && G.hasShotgun) { G.selectWeapon('shotgun'); setWeapon(G.player, 'shotgun'); updateHud(G); }
  if (code === 'Digit4' && !repeat) { G.selectWeapon('bat'); setWeapon(G.player, 'bat'); updateHud(G); }
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
  // D-FQA02: onStageStart only fired on a stage CHANGE, so the stage-0
  // briefing ("You came. Good…") never showed on the first playthrough.
  // Announce stage 0 once, here at start; its toast replaces WELCOME.
  onStageStart(G, 0);
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
// call sites (onKey KeyT, input onFire, animate loop) unchanged, and add
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
      nitro: !!(keys.ShiftLeft || keys.ShiftRight), // Shift is sprint on foot, nitro in a car
    }, dt, {
      collides: (x, z, r) => collidesBuilding(buildings, x, z, r),
    });
    if (result.collided && result.impact > 3) {
      showToast('CRASH • VEHICLE ' + Math.round(car.userData.health) + '%');
    }
    // Score events: drift / near-miss payouts bank here (driving.js only
    // reports them; money + toast live here, next to the crash toast).
    if (result.events) {
      for (const ev of result.events) {
        G.money += ev.amount;
        G.lastScore = { label: ev.label, amount: ev.amount, at: Date.now() };
        showToast(`${ev.label} • +$${ev.amount}`);
      }
    }
    G._lastNitro01 = result.nitro01 ?? G._lastNitro01 ?? 1;
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
// True when a palm crown sits too close to the lens: crowns sit ~6.05 u up
// with fronds drooping to ~2.5 u and reaching ~3.2 u out from the trunk
// (v4: two rings of curved blades), so a trunk within ~3.5 u of the lens
// (XZ) at frond height puts a blade across the frame. Tested against the LENS position, not the lens-to-
// player segment: a palm standing 2.5 u beside the road is always ~2.5 u
// from the segment no matter how far the camera pulls in, so a segment
// test bottoms the camera out at the minimum distance and parks the lens
// inside the crown (seen in fix-verify R4). A palm beside the road is
// harmless once the lens itself is clear of it.
function palmNearLens(cam, spots) {
  if (cam.y < 1.8 || cam.y > 7.2) return false;
  for (let i = 0; i < spots.length; i += 1) {
    const [x, z] = spots[i];
    if (Math.hypot(x - cam.x, z - cam.z) < 3.5) return true;
  }
  return false;
}

// D-QA04 (round 2): the round-1 guard only moved `desired`; the real
// camera lerps toward it, so while driving the actual lens lagged behind
// and sat inside a crown even though `desired` was clear. This guard
// runs on the ACTUAL lens position after the lerp, and pushes it
// sideways — radially away from the nearest trunk — instead of pulling
// it along the chase axis, which cannot clear a palm standing beside
// the road. It also runs on `desired` first, so the lerp target itself
// is clear and the two do not fight. Clearance 3.7 u (guard threshold
// 3.5 u + margin); total push capped at 6 u so the framing stays a
// chase shot.
function pushLensClearOfPalms(pos, spots) {
  if (!Array.isArray(spots) || !spots.length) return;
  if (pos.y < 1.8 || pos.y > 7.2) return;
  let pushed = 0;
  for (let i = 0; i < 24 && pushed < 6; i += 1) {
    let nx = 0;
    let nz = 0;
    let nd = Infinity;
    for (let j = 0; j < spots.length; j += 1) {
      const d = Math.hypot(spots[j][0] - pos.x, spots[j][1] - pos.z);
      if (d < nd) { nd = d; nx = spots[j][0]; nz = spots[j][1]; }
    }
    if (nd >= 3.7) return;
    let dx = pos.x - nx;
    let dz = pos.z - nz;
    if (nd < 0.001) { dx = 1; dz = 0; } else { dx /= nd; dz /= nd; }
    const step = Math.min(3.7 - nd + 0.2, 6 - pushed);
    pos.x += dx * step;
    pos.z += dz * step;
    pushed += step;
  }
}

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
  // G-20 (v3, N-QA2): on foot near the safehouse the old 7.2 u / 4.1 u
  // camera sat behind the shop awning — the striped awning filled half
  // the frame and hid the player. Tuck the camera in closer, higher,
  // and looking down more steeply, on foot only: at 4.4 u back and
  // 6.6 u up the lens clears the awning line (awnings top out ~3.9 u)
  // and looks over it at the player. A pull-in guard walks the camera
  // toward the player while its position is inside a building
  // footprint, so a facade can never sit between lens and player here.
  const inSafehouse = !G.currentCar
    && Math.hypot(p.x - SAFEHOUSE_POS.x, p.z - SAFEHOUSE_POS.z) < SAFEHOUSE_CAM_RADIUS;
  let distance = params.distance;
  let height = params.height;
  let lookHeight = params.lookHeight;
  // v4 (chase framing): at wanted >= 3 the helicopter is on station and
  // police ram from directly behind — the old tight chase lens let a
  // tailing unit sit exactly between lens and player car and hide it
  // (frame 3: PALMERA invisible, SKY-1 clipped at the top edge). Pull
  // the lens back and to the side (3/4 view, so a tailing unit can no
  // longer hide the player car), lift the look point and widen the FOV
  // so the helicopter fits whole in the frame. Height rises only a
  // little: a higher lens aims further down and would push the heli
  // back out of the top edge. The palm guard below still runs on the
  // offset target and on the actual lens.
  const pursuit = !!G.currentCar && (G.wanted || 0) >= 3;
  if (pursuit) {
    distance += 3.0;
    height += 0.5;
    lookHeight += 0.6;
  }
  if (inSafehouse) {
    distance = 4.4;
    height = 6.6;
    lookHeight = 0.9;
  }
  const desired = new THREE.Vector3(
    p.x - Math.sin(yaw) * distance,
    p.y + height,
    p.z - Math.cos(yaw) * distance,
  );
  if (inSafehouse) {
    const dirX = p.x - desired.x;
    const dirZ = p.z - desired.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    let d = distance;
    while (d > 2.2 && collidesBuilding(buildings, desired.x, desired.z, 0.5)) {
      d -= 0.5;
      desired.set(p.x - (dirX / len) * d, p.y + height, p.z - (dirZ / len) * d);
    }
  }
  // D-QA04: palm-crown pull-in. On the beach road the chase camera sits
  // at frond height (~5 u) and a crown right by the lens fills the frame
  // with a diagonal frond. Walk the camera toward the player (same
  // pattern as the safehouse guard above) until the lens is clear of
  // every crown — never closer than 3 u, so the framing stays a chase
  // shot instead of a close-up.
  if (Array.isArray(palmSpots) && palmSpots.length && !inSafehouse) {
    let d = distance;
    while (d > 3 && palmNearLens(desired, palmSpots)) {
      d -= 0.5;
      desired.set(p.x - Math.sin(yaw) * d, p.y + height, p.z - Math.cos(yaw) * d);
    }
    // Round 2: the pull-in above only clears the target; push the
    // target sideways too, so the lerp is not fighting a target that
    // sits inside a crown beside the road.
    pushLensClearOfPalms(desired, palmSpots);
  }
  // v4 pursuit 3/4 offset (applied AFTER the palm pull-in above, which
  // rebuilds `desired` from the chase axis): shift the lens to the side
  // of the chase direction, so a police unit ramming from directly
  // behind the player can no longer sit exactly on the lens-player
  // line and hide the player car. The actual-lens palm guard below
  // still runs after the lerp, so the offset lens stays clear of crowns.
  if (pursuit && !inSafehouse) {
    desired.x += -Math.cos(yaw) * 3.4;
    desired.z += Math.sin(yaw) * 3.4;
  }
  if (!G.cameraSnapped) {
    // Snap on the first frame: no opening swoop from the origin, and a
    // ?shot= screenshot is framed exactly as staged, even at low frame rates.
    camera.position.copy(desired);
    G.cameraSnapped = true;
  } else {
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  }
  // Round 2: guard the ACTUAL lens, not just the target — after the
  // lerp the camera can still lag inside a crown while driving.
  if (Array.isArray(palmSpots) && palmSpots.length && !inSafehouse) {
    pushLensClearOfPalms(camera.position, palmSpots);
  }
  camera.lookAt(new THREE.Vector3(p.x, p.y + lookHeight, p.z));
  const fovTarget = params.fov + (pursuit ? 5 : 0);
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------- shot mode
if (query.shot) {
  stageShot(query.shot, G);
  // Every staged scene ships with the full HUD (hide it only with
  // &hud=0): the hero frame is a gameplay frame, not a clean wallpaper.
  setHudVisible(query.hud !== '0');
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
    // Specialist-3 live read-outs (heli + vehicle + weapons) for the HUD,
    // the police panel and the test harness. Cheap plain objects, rebuilt
    // every frame so the HUD never reads a stale snapshot.
    updateHelicopter(G, dt);
    window.SuncoastAir = helicopterState(G);
    window.SuncoastVehicle = G.currentCar
      ? vehicleTelemetry(G.currentCar)
      : { speedKmh: 0, gear: 0, condition: Math.round(G.playerCar.userData.health), nitro01: G._lastNitro01 ?? 1, name: 'ON FOOT' };
    window.SuncoastWeapons = getWeaponState(G);
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
      showToast('SMG ACQUIRED • PRESS 2 TO EQUIP, T TO RELOAD');
    }
    // Shotgun pickup.
    if (!shotgunTaken && G.player.visible && G.player.position.distanceTo(shotgunCrate.position) < 3) {
      shotgunTaken = true;
      scene.remove(shotgunCrate);
      G.hasShotgun = true;
      G._shotgunReserve = 24;
      G._shotgunMag = 6;
      G.selectWeapon('shotgun');
      setWeapon(G.player, 'shotgun');
      G.audio.chime();
      showToast('SHOTGUN ACQUIRED • PRESS 3 TO EQUIP, T TO RELOAD');
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
    // The helicopter also ticks here, so a staged ?shot=chase frame (which
    // sets wanted 3 without starting the game) still shows SKY-1 on
    // station; at wanted 0 this is a no-op.
    updateHelicopter(G, dt);
    window.SuncoastAir = helicopterState(G);
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
    window.__camera = camera; // test hook: framing measurements (see updateCamera)
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
