// Missions and story for SUNCOAST: HEATLINE.
// One clear job: the 6-stage story contract chain — markers, objectives,
// rewards, fail/retry feedback — plus the driving leg and the heat-cooldown
// fallback (the prototype's stage 5 could stall forever when wanted never
// reached exactly 0).

import * as THREE from 'three';
import { clamp } from './config.js';

export const GANG_ZONE = new THREE.Vector3(72, 0, -72);

export const MISSION_POINTS = [
  new THREE.Vector3(0, 0, 0), // fixer
  new THREE.Vector3(36, 0, 0), // package pickup
  new THREE.Vector3(-36, 0, 36), // safehouse delivery
  GANG_ZONE.clone(), // crew yard
  new THREE.Vector3(0, 0, 72), // garage
  new THREE.Vector3(-72, 0, -72), // overlook (final run)
];

const TITLES = [
  'A Favor in the Heat',
  'Loose Cargo',
  'The Quiet Exit',
  'Street Sweep',
  'No Witnesses',
  'Last Light',
];

const OBJECTIVES = [
  'Meet the fixer at the glowing marker.',
  'Pick up the sealed package at the next marker.',
  'Deliver the package to the safehouse. Keep moving.',
  'Clear the hostile crew in the industrial yard.',
  'Reach the garage and lose the heat.',
  'Final run: reach the overlook.',
];

const REWARDS = [2500, 2500, 2500, 3500, 5000, 5000];

/** The glowing ring + light beam + floating core that marks the objective. */
export function createMissionMarker(scene) {
  const marker = new THREE.Group();
  scene.add(marker);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.16, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x63e6ff }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  marker.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.8, 6, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x55dfff, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 3;
  marker.add(beam);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.65),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  core.position.y = 1.1;
  marker.add(core);
  marker.userData = { ring, beam, core };
  return marker;
}

export function animateMarker(marker, dt) {
  marker.rotation.y += dt * 0.8;
  const core = marker.userData.core;
  core.rotation.y += dt * 1.5;
  core.rotation.x += dt * 0.5;
  core.position.y = 1.1 + Math.sin(performance.now() * 0.002) * 0.25;
}

function nearPoint(pos, p, r = 4) {
  return Math.hypot(pos.x - p.x, pos.z - p.z) < r;
}

/**
 * Advance the mission chain. `G` is the shared game state (see main.js):
 * missionIndex, kills, wanted, money, plus the callbacks the chain needs.
 * Returns nothing; toasts and HUD updates happen through G.showToast / G.updateMissionHud.
 */
export function updateMissions(G, dt) {
  const p = G.actorPosition();
  const i = G.missionIndex;
  if (i === 0 && nearPoint(p, MISSION_POINTS[0], 5)) {
    G.missionIndex = 1;
    G.showToast('FIXER: Take the package. No questions.');
  } else if (i === 1 && nearPoint(p, MISSION_POINTS[1], 5)) {
    G.missionIndex = 2;
    G.showToast('PACKAGE SECURED • Deliver it to the safehouse.');
  } else if (i === 2 && nearPoint(p, MISSION_POINTS[2], 6)) {
    completeMission(G);
  } else if (i === 3 && G.kills >= 3) {
    G.missionIndex = 4;
    G.wanted = Math.max(G.wanted, 2);
    G.heat = 60;
    G.showToast('YARD CLEARED • COPS ARE ON THE WAY');
  } else if (i === 4 && nearPoint(p, MISSION_POINTS[4], 6)) {
    // Stage 5: garage. Wanted 0 completes it at once; otherwise a 45 s
    // grace timer lets a player who is actively hiding finish the job
    // instead of stalling forever on heat that never fully cools.
    if (G.wanted === 0) {
      completeMission(G);
    } else {
      G.garageTimer = (G.garageTimer || 0) + dt;
      if (G.garageTimer > 45) {
        G.garageTimer = 0;
        G.wanted = 0;
        G.heat = 0;
        completeMission(G);
        G.showToast('HEAT DIED DOWN • JOB COMPLETE');
      }
    }
  } else if (i === 5 && nearPoint(p, MISSION_POINTS[5], 6)) {
    completeMission(G);
  }
  if (i === 3) {
    G.objectiveText = `Eliminate the hostile crew. ${Math.min(G.kills, 3)}/3 targets neutralized.`;
  } else if (i === 4) {
    const grace = G.garageTimer ? ` • hiding ${Math.ceil(45 - G.garageTimer)}s` : '';
    G.objectiveText = `Reach the garage and lose the police. Wanted level: ${G.wanted}/5.${grace}`;
  } else {
    G.objectiveText = OBJECTIVES[clamp(G.missionIndex, 0, 5)];
  }
  G.missionTitle = TITLES[clamp(G.missionIndex, 0, 5)];
}

export function completeMission(G) {
  const reward = REWARDS[clamp(G.missionIndex, 0, 5)];
  G.money += reward;
  G.showToast(`JOB COMPLETE • +$${reward.toLocaleString('en-US')}`);
  G.missionIndex += 1;
  G.kills = 0;
  G.garageTimer = 0;
  if (G.missionIndex >= MISSION_POINTS.length) {
    G.missionIndex = 0;
    G.showToast('STORY LOOP COMPLETE • NEW CONTRACT AVAILABLE');
  }
}

/** Move the marker to the current objective point. */
export function placeMarker(marker, missionIndex) {
  const p = MISSION_POINTS[clamp(missionIndex, 0, MISSION_POINTS.length - 1)];
  marker.position.set(p.x, 0, p.z);
}
