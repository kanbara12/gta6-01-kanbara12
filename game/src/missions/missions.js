// Missions and story for SUNCOAST: HEATLINE.
// One clear job: the 6-stage story contract chain — markers, objectives,
// rewards, fail/retry feedback — plus the driving leg and the heat-cooldown
// fallback (the prototype's stage 5 could stall forever when wanted never
// reached exactly 0).
//
// STRUCTURE (unchanged — same points, titles, objectives, rewards, radii,
// transitions and loop-reset as before; save.js persists missionIndex, so
// a save made by the old version still loads into the right stage):
//   0 meet the fixer · 1 pick up the package · 2 deliver to the safehouse
//   3 clear the hostile crew (3 kills) · 4 reach the garage + lose heat
//   5 final run to the overlook, then the chain loops with a new contract.
//
// What this revision ADDS (no existing transition changed):
// - STAGES metadata: per-stage type, radius, hint and an original fixer
//   line, exposed via getMissionBrief(stage) and getMissionProgress(G) so
//   the HUD can show dense, useful feedback (stage x/6, distance to the
//   marker, kills remaining) instead of a bare objective sentence.
// - Stage-change hook onStageStart(G, stage): toasts the fixer's line the
//   moment a stage begins, so every hand-off is announced in-game.
// - Combat encounter, stage 3: the first time the yard stage begins,
//   three extra crew members move in (spawned from the yard edges into
//   G.enemies). The 3-kill requirement itself is unchanged — the yard
//   simply cannot run dry if the player already thinned it.
// - Side activities: three street-cash stashes (updateSideActivities,
//   called from updateMissions) worth $250 each, respawning after 60 s —
//   a small loop for the gaps between contracts. Session-only by design:
//   they are not in save.js and are not meant to be.
// - Fail/retry feedback: dying (G.gameOver) keeps the current stage — the
//   contract waits for the player to load the save and try again; the
//   stage-4 garage grace timer (45 s of hiding) is unchanged.

import * as THREE from 'three';
import { clamp } from '../core/config.js';
import { createCharacter } from '../characters/characters.js';

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

/**
 * Per-stage metadata. `type` drives the HUD verb; `radius` is the exact
 * trigger radius updateMissions uses; `hint` is the second line of the
 * briefing; `npc` is the fixer's line on stage start (original dialogue).
 */
export const STAGES = [
  { type: 'meet', radius: 5, hint: 'On foot or by car — just get there.', npc: 'Rae: You came. Good. One package, no questions, and we both get paid.' },
  { type: 'pickup', radius: 5, hint: 'The package is sealed. Do not open it.', npc: 'Rae: The package is two blocks east. Grab it and do not stop for anyone.' },
  { type: 'deliver', radius: 6, hint: 'A straight drive. The cops are bored tonight — keep it that way.', npc: 'Rae: Safehouse, south-west side. Knock twice. They are expecting the seal, not you.' },
  { type: 'combat', radius: 6, hint: 'Three of them. The yard is theirs until it is not.', npc: 'Rae: The yard crew skimmed my cut. Clear them out and the street forgets your name.' },
  { type: 'evade', radius: 6, hint: 'Wanted 0 clears it at once. Otherwise hide in the garage for 45 s.', npc: 'Rae: You lit the whole city up. Garage, north side — sit quiet until the heat dies.' },
  { type: 'final', radius: 6, hint: 'One last drive. Sunset, overlook, done.', npc: 'Rae: Last run. Overlook at the north-west edge. After this, you are a ghost with money.' },
];

/** Briefing for one stage — title, objective, hint, fixer line, reward. */
export function getMissionBrief(stage) {
  const i = clamp(stage | 0, 0, 5);
  return {
    stage: i,
    title: TITLES[i],
    objective: OBJECTIVES[i],
    hint: STAGES[i].hint,
    npc: STAGES[i].npc,
    type: STAGES[i].type,
    radius: STAGES[i].radius,
    reward: REWARDS[i],
  };
}

/** Live progress snapshot for the HUD: stage x/6, distance, kills left. */
export function getMissionProgress(G) {
  const i = clamp(G.missionIndex | 0, 0, 5);
  const p = G.actorPosition();
  const target = MISSION_POINTS[i];
  return {
    stage: i,
    stageLabel: `${i + 1}/6`,
    title: TITLES[i],
    objective: G.objectiveText || OBJECTIVES[i],
    type: STAGES[i].type,
    reward: REWARDS[i],
    distanceToMarker: Math.round(Math.hypot(p.x - target.x, p.z - target.z)),
    killsNeeded: i === 3 ? 3 : 0,
    killsDone: i === 3 ? Math.min(G.kills || 0, 3) : 0,
    jobsCompleted: G.jobsCompleted || 0,
  };
}

/** Announce a stage the moment it begins (fixer line + objective). */
export function onStageStart(G, stage) {
  const brief = getMissionBrief(stage);
  G.showToast(`${brief.title.toUpperCase()} • ${brief.npc}`);
}

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

// ---------------------------------------------------------------- side activities
/** Street-cash stash positions (session-only, not saved). */
export const SIDE_CASH_POINTS = [
  new THREE.Vector3(24, 0, -24),
  new THREE.Vector3(-24, 0, 60),
  new THREE.Vector3(60, 0, 36),
];
export const SIDE_CASH_REWARD = 250;
export const SIDE_CASH_RESPAWN = 60;

function ensureSideCash(G) {
  if (!G.sideCash) {
    G.sideCash = SIDE_CASH_POINTS.map((p) => ({ pos: p, taken: false, timer: 0 }));
  }
  return G.sideCash;
}

/**
 * Street-cash loop: walk/drive within 3 units of an untaken stash to
 * collect $250; it respawns after 60 s. Called from updateMissions so
 * the coordinator needs no extra wiring.
 */
export function updateSideActivities(G, dt) {
  const stashes = ensureSideCash(G);
  const p = G.actorPosition();
  for (const s of stashes) {
    if (s.taken) {
      s.timer -= dt;
      if (s.timer <= 0) { s.taken = false; s.timer = 0; }
      continue;
    }
    if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 3) {
      s.taken = true;
      s.timer = SIDE_CASH_RESPAWN;
      G.money += SIDE_CASH_REWARD;
      G.showToast(`STREET CASH • +$${SIDE_CASH_REWARD}`);
    }
  }
}

// ---------------------------------------------------------------- combat encounter
/** Stage 3, first entry only: three extra crew move in from the yard edges. */
function reinforceYard(G) {
  if (!G.scene || !G.enemies || G._stage3Reinforced) return;
  G._stage3Reinforced = true;
  const offsets = [[-14, -10], [14, -12], [0, 14]];
  for (const [ox, oz] of offsets) {
    const e = createCharacter(0x7c3030);
    e.position.set(GANG_ZONE.x + ox, 0, GANG_ZONE.z + oz);
    e.userData.health = 2;
    e.userData.alive = true;
    e.userData.isEnemy = true;
    G.scene.add(e);
    G.enemies.push(e);
  }
  G.showToast('MORE CREW MOVING IN • HOLD THE YARD');
}

/**
 * Advance the mission chain. `G` is the shared game state (see main.js):
 * missionIndex, kills, wanted, money, plus the callbacks the chain needs.
 * Returns nothing; toasts and HUD updates happen through G.showToast / G.updateMissionHud.
 * Stage transitions are the original ones; only the feedback around them
 * (stage-start lines, distance in the objective text) is new.
 */
export function updateMissions(G, dt) {
  const p = G.actorPosition();
  const i = G.missionIndex;
  // Stage-change hook: announce the new stage once, on entry.
  if (G._lastStage === undefined) G._lastStage = i;
  if (G._lastStage !== i) {
    G._lastStage = i;
    if (i >= 0 && i < MISSION_POINTS.length) onStageStart(G, i);
  }
  if (i === 3) reinforceYard(G);
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
  // Objective feedback: travel stages show live distance to the marker;
  // combat / evade stages keep their counters (unchanged wording).
  const dist = Math.round(Math.hypot(p.x - MISSION_POINTS[clamp(i, 0, 5)].x, p.z - MISSION_POINTS[clamp(i, 0, 5)].z));
  if (i === 3) {
    G.objectiveText = `Eliminate the hostile crew. ${Math.min(G.kills, 3)}/3 targets neutralized.`;
  } else if (i === 4) {
    const grace = G.garageTimer ? ` • hiding ${Math.ceil(45 - G.garageTimer)}s` : '';
    G.objectiveText = `Reach the garage and lose the police. Wanted level: ${G.wanted}/5.${grace}`;
  } else {
    G.objectiveText = `${OBJECTIVES[clamp(G.missionIndex, 0, 5)]} (${dist}m)`;
  }
  G.missionTitle = TITLES[clamp(G.missionIndex, 0, 5)];
  updateSideActivities(G, dt);
}

export function completeMission(G) {
  const reward = REWARDS[clamp(G.missionIndex, 0, 5)];
  G.money += reward;
  G.jobsCompleted = (G.jobsCompleted || 0) + 1;
  G.showToast(`JOB COMPLETE • +$${reward.toLocaleString('en-US')}`);
  G.missionIndex += 1;
  G.kills = 0;
  G.garageTimer = 0;
  if (G.missionIndex >= MISSION_POINTS.length) {
    G.missionIndex = 0;
    G._stage3Reinforced = false;
    G.showToast('STORY LOOP COMPLETE • NEW CONTRACT AVAILABLE');
  }
}

/** Move the marker to the current objective point. */
export function placeMarker(marker, missionIndex) {
  const p = MISSION_POINTS[clamp(missionIndex, 0, MISSION_POINTS.length - 1)];
  marker.position.set(p.x, 0, p.z);
}
