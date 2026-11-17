// Screenshot scenes for SUNCOAST: HEATLINE.
// One clear job: the ?shot= scenes the kit screenshots with. Each scene stages
// a genuine gameplay state — the same live simulation, just positioned and
// seeded deterministically — then the normal game loop runs it, so every
// screenshot is a real frame of the game, never a mockup.
//
// Scenes (5 prepared; the kit submits the best 4):
//   start   — hero open-world: the pier, the beach and the city skyline.
//   play    — driving through traffic on an avenue.
//   chase   — police pursuit at wanted level 3.
//   mission — on-foot combat at the crew yard, mission 3 in progress.
//   end     — the overlook after the final job, city and coast behind.
// Any other name behaves like start. ?seed= picks the deterministic stream.

import * as THREE from 'three';
import { mulberry32, clamp } from './config.js';
import { GANG_ZONE, MISSION_POINTS, placeMarker } from './missions.js';
import { spawnPoliceCar } from './vehicles.js';

function putPlayerOnFoot(G, x, z, yaw) {
  G.currentCar = null;
  G.player.visible = true;
  G.player.position.set(x, 0, z);
  G.player.rotation.y = yaw;
  G.input.cameraYaw = yaw;
}

function putPlayerInCar(G, x, z, rotY, speed) {
  G.currentCar = G.playerCar;
  G.player.visible = false;
  G.playerCar.position.set(x, 0, z);
  G.playerCar.rotation.y = rotY;
  G.playerCar.userData.speed = speed;
}

/** Stage the named scene on the shared state G and return its label. */
export function stageShot(name, G) {
  const rng = mulberry32(G.seed * 7919 + 13);
  G.shotMode = true;
  G.gameStarted = true;
  G.gameOver = false;
  G.shotCamera = null;
  document.getElementById('startCard').classList.add('hidden');

  if (name === 'play') {
    // Driving down the central avenue, traffic all around.
    putPlayerInCar(G, -36, 60, 0, 14);
    for (let i = 0; i < G.traffic.length; i += 1) {
      const c = G.traffic[i];
      const lane = (i % 2 === 0 ? -1 : 1) * 2.7;
      c.position.set(-36 + lane + (rng() - 0.5) * 1.5, 0, 20 + i * 14);
      c.rotation.y = 0;
      c.userData.dir = 1;
      c.userData.axis = 'z';
      c.userData.speed = 7 + rng() * 3;
      c.userData.baseSpeed = c.userData.speed;
    }
    G.missionIndex = 1;
    G.objectiveText = 'Pick up the sealed package at the next marker.';
    placeMarker(G.marker, G.missionIndex);
    G.cameraYawFixed = null;
    return 'play';
  }

  if (name === 'chase') {
    // Police pursuit: wanted 3, three units closing in on the player's car.
    putPlayerInCar(G, 0, -20, Math.PI, 16);
    G.wanted = 3;
    G.heat = 60;
    while (G.police.length < 3) {
      G.police.push(spawnPoliceCar(G.scene, G.actorPosition(), rng));
    }
    G.police[0].position.set(10, 0, -52);
    G.police[1].position.set(-12, 0, -58);
    G.police[2].position.set(2, 0, -78);
    for (const c of G.police) c.userData.speed = 10 + rng() * 3;
    G.missionIndex = 4;
    placeMarker(G.marker, G.missionIndex);
    return 'chase';
  }

  if (name === 'mission') {
    // On foot on the road north of the crew yard (x = 72 road), facing south
    // into the yard: the follow camera sits on the open road, never inside
    // a building, and the crew and the marker are in frame.
    putPlayerOnFoot(G, 72, -56, Math.PI);
    G.missionIndex = 3;
    G.kills = 2;
    for (const e of G.enemies) {
      if (!e.userData.alive) { e.userData.alive = true; e.visible = true; e.userData.health = 2; }
    }
    G.enemies[0].position.set(76, 0, -68);
    G.enemies[1].position.set(68, 0, -76);
    placeMarker(G.marker, G.missionIndex);
    return 'mission';
  }

  if (name === 'end') {
    // The overlook after the final job: story loop complete, city + coast view.
    putPlayerOnFoot(G, MISSION_POINTS[5].x + 6, MISSION_POINTS[5].z + 8, Math.atan2(-6, -8));
    G.missionIndex = 0;
    G.money = 12750;
    G.wanted = 0;
    G.showToast('STORY LOOP COMPLETE • NEW CONTRACT AVAILABLE');
    placeMarker(G.marker, G.missionIndex);
    // Fixed cinematic camera: behind the player at the overlook, looking
    // north-east across the city toward the coast.
    G.shotCamera = {
      pos: new THREE.Vector3(-84, 10, -84),
      look: new THREE.Vector3(20, 3, 10),
    };
    return 'end';
  }

  // start (default): hero shot from the pier looking back at the skyline.
  // Player stands on the beach facing west, into the city and the sunset.
  putPlayerOnFoot(G, 146, 6, -Math.PI / 2);
  G.missionIndex = 0;
  placeMarker(G.marker, G.missionIndex);
  G.shotCamera = {
    pos: new THREE.Vector3(172, 7, 12),
    look: new THREE.Vector3(100, 5, -2),
  };
  return 'start';
}

export const SHOT_NAMES = ['start', 'play', 'chase', 'mission', 'end'];
