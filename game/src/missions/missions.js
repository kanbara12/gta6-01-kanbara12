// Missions and story for SUNCOAST: HEATLINE.
// One clear job: the 8-stage story contract chain — markers, objectives,
// rewards, fail/retry feedback — plus the driving leg and the heat-cooldown
// fallback (the prototype's stage 5 could stall forever when wanted never
// reached exactly 0).
//
// STRUCTURE (same points, titles, objectives, rewards, radii,
// transitions and loop-reset as before for stages 0-5, except the reward
// retune below; save.js persists missionIndex, so a save made by the old
// version still loads into the right stage):
//   0 meet the fixer · 1 pick up the package · 2 deliver to the safehouse
//   3 clear the hostile crew (3 kills) · 4 reach the garage + lose heat
//   5 final run to the overlook · 6 swap the case at the marina dock
//   7 north run to the lighthouse breakwater, then the chain loops with
//   a new contract.
//
// What this revision ADDS (no existing transition changed):
// - STAGES metadata: per-stage type, radius, hint and a crew line, exposed
//   via getMissionBrief(stage) and getMissionProgress(G) so the HUD can
//   show dense, useful feedback (stage x/8, distance to the marker, kills
//   remaining, par time vs elapsed) instead of a bare objective sentence.
// - Par timer per stage: STAGES[i].parTime is the target time in seconds;
//   getMissionProgress reports elapsed + overPar so the HUD can show the
//   pace. Going over par never fails the job — it only reads as slow.
// - Stage-change hook onStageStart(G, stage): announces the stage through
//   the crew dialog box (window.SuncoastDialog when the dialog system is
//   present, toast otherwise), so every hand-off is announced in-game.
//   Only three crew ever speak: Rae (FIXER), Marlo (DRIVER) and
//   Sable (LOOKOUT) — no other names are used anywhere in this file.
// - Economy retune: the eight rewards sum to $20,750 on a $1,250 start,
//   so cash lands near $17,000 after the fifth job and near $22,000 after
//   the eighth (before kill bonuses / street cash / drift payouts).
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
  // v4: the fixer waits on the sidewalk corner (8.5, 8.5), NOT in the
  // middle of the intersection — the old (0,0) point put the glowing
  // marker + the fixer on the zebra crossing, where traffic looked
  // about to run them over (frame 2). Trigger radius 5 still reaches
  // from the road edge (2 u away) and from the sidewalk.
  new THREE.Vector3(8.5, 0, 8.5), // fixer (sidewalk corner)
  // v4: same move for the package pickup — off the (36,0) intersection
  // centre onto its sidewalk corner (44.5, 8.5), same side as the fixer.
  new THREE.Vector3(44.5, 0, 8.5), // package pickup (sidewalk corner)
  new THREE.Vector3(-36, 0, 36), // safehouse delivery
  GANG_ZONE.clone(), // crew yard
  new THREE.Vector3(0, 0, 72), // garage
  new THREE.Vector3(-72, 0, -72), // overlook (final run)
  new THREE.Vector3(132, 0, 96), // marina dock (case swap)
  new THREE.Vector3(148, 0, -142), // lighthouse breakwater (north run)
];

export const MISSION_COUNT = MISSION_POINTS.length;

const TITLES = [
  'A Favor in the Heat',
  'Loose Cargo',
  'The Quiet Exit',
  'Street Sweep',
  'No Witnesses',
  'Last Light',
  'Saltwater Exchange',
  'Northlight Run',
];

const OBJECTIVES = [
  'Meet the fixer at the glowing marker.',
  'Pick up the sealed package at the next marker.',
  'Deliver the package to the safehouse. Keep moving.',
  'Clear the hostile crew in the industrial yard.',
  'Reach the garage and lose the heat.',
  'Final run: reach the overlook.',
  'Meet Marlo at the marina dock and swap the case.',
  'Run the north beach road to the lighthouse breakwater.',
];

// Rewards sum to $20,750: on the $1,250 start that lands near $17,000
// after the fifth job and near $22,000 after the eighth (before the
// $150-per-kill bonuses, street cash and drift payouts).
const REWARDS = [2500, 2500, 3000, 3500, 4250, 2000, 1500, 1500];

/**
 * Per-stage metadata. `type` drives the HUD verb; `radius` is the exact
 * trigger radius updateMissions uses; `hint` is the second line of the
 * briefing; `parTime` is the target time in seconds for the stage.
 * `speaker` / `name` / `role` / `line` is the crew line on stage start —
 * only Rae (FIXER), Marlo (DRIVER) and Sable (LOOKOUT) ever speak, and
 * `npc` (the "Name: line" form) is derived from them for the toast.
 */
export const STAGES = [
  { type: 'meet', radius: 5, hint: 'On foot or by car — just get there.', parTime: 60, speaker: 'rae', name: 'Rae', role: 'FIXER', line: 'You came. Good. One package, no questions, and we both get paid.' },
  { type: 'pickup', radius: 5, hint: 'The package is sealed. Do not open it.', parTime: 90, speaker: 'rae', name: 'Rae', role: 'FIXER', line: 'The package is two blocks east. Grab it and do not stop for anyone.' },
  { type: 'deliver', radius: 6, hint: 'A straight drive. The cops are bored tonight — keep it that way.', parTime: 120, speaker: 'sable', name: 'Sable', role: 'LOOKOUT', line: 'Safehouse road is clear from my roof. Move before the patrol turns the corner.' },
  { type: 'combat', radius: 6, hint: 'Three of them. The yard is theirs until it is not.', parTime: 180, speaker: 'marlo', name: 'Marlo', role: 'DRIVER', line: 'The yard crew skimmed our cut. I keep the engine running — you handle the yard.' },
  { type: 'evade', radius: 6, hint: 'Wanted 0 clears it at once. Otherwise hide in the garage for 45 s.', parTime: 150, speaker: 'sable', name: 'Sable', role: 'LOOKOUT', line: 'Heat is on you. Garage, north side — sit quiet and I will tell you when the street is clear.' },
  { type: 'final', radius: 6, hint: 'One last drive. Sunset, overlook, done.', parTime: 120, speaker: 'rae', name: 'Rae', role: 'FIXER', line: 'Last run. Overlook at the north-west edge. After this, you are a ghost with money.' },
  { type: 'meet', radius: 6, hint: 'Case for case. Do not open it, do not count it.', parTime: 150, speaker: 'marlo', name: 'Marlo', role: 'DRIVER', line: 'Marina dock, by the finger piers. Case for case — swap it and go, no detours.' },
  { type: 'final', radius: 6, hint: 'North beach road, all the way to the lighthouse. The tail will follow.', parTime: 180, speaker: 'sable', name: 'Sable', role: 'LOOKOUT', line: 'North beach road to the lighthouse. I will watch the tail — you just drive.' },
];

/** Briefing for one stage — title, objective, hint, crew line, reward, par time. */
export function getMissionBrief(stage) {
  const i = clamp(stage | 0, 0, MISSION_COUNT - 1);
  const s = STAGES[i];
  return {
    stage: i,
    title: TITLES[i],
    objective: OBJECTIVES[i],
    hint: s.hint,
    npc: `${s.name}: ${s.line}`,
    dialog: { name: s.name, role: s.role, portrait: s.speaker, text: s.line },
    type: s.type,
    radius: s.radius,
    reward: REWARDS[i],
    parTime: s.parTime,
  };
}

/** Live progress snapshot for the HUD: stage x/8, distance, kills left, par pace. */
export function getMissionProgress(G) {
  const i = clamp(G.missionIndex | 0, 0, MISSION_COUNT - 1);
  const p = G.actorPosition();
  const target = MISSION_POINTS[i];
  const elapsed = Math.round(G._stageElapsed || 0);
  return {
    stage: i,
    stageLabel: `${i + 1}/${MISSION_COUNT}`,
    title: TITLES[i],
    objective: G.objectiveText || OBJECTIVES[i],
    type: STAGES[i].type,
    reward: REWARDS[i],
    distanceToMarker: Math.round(Math.hypot(p.x - target.x, p.z - target.z)),
    killsNeeded: i === 3 ? 3 : 0,
    killsDone: i === 3 ? Math.min(G.kills || 0, 3) : 0,
    jobsCompleted: G.jobsCompleted || 0,
    parTime: STAGES[i].parTime,
    elapsed,
    overPar: elapsed > STAGES[i].parTime,
  };
}

/**
 * Announce a stage the moment it begins: the crew line goes through the
 * dialog box when the dialog system is present (window.SuncoastDialog,
 * owned by the dialog pass) and the toast always fires as the fallback,
 * so a stage hand-off is never silent. The final run (stage 7) also
 * lights the city up — wanted 3 means the helicopter joins the chase.
 */
export function onStageStart(G, stage) {
  const brief = getMissionBrief(stage);
  G.showToast(`${brief.title.toUpperCase()} • ${brief.npc}`);
  const dlg = (typeof window !== 'undefined') ? window.SuncoastDialog : null;
  if (dlg && typeof dlg.show === 'function') {
    dlg.show({ ...brief.dialog, ms: 5200 });
  }
  if (stage === MISSION_COUNT - 1) {
    G.wanted = Math.max(G.wanted || 0, 3);
    G.heat = 60;
  }
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
  // D-QA7: the old beam was a wide cone (r 0.12 -> 0.8) that read as a
  // white wedge cutting the frame. Slim uniform shaft, fainter, no depth
  // write so it never hides the street behind it.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 6, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x55dfff, transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 3;
  marker.add(beam);
  // D-QA7: the old core read as a plain yellow box. Elongated octahedron
  // (a diamond, not a cube) + a thin tilted halo ring spinning around it.
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.62),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  core.scale.set(1, 1.45, 1);
  core.position.y = 1.1;
  marker.add(core);
  const coreRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.045, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }),
  );
  coreRing.position.y = 1.1;
  coreRing.rotation.x = Math.PI / 3;
  marker.add(coreRing);
  marker.userData = { ring, beam, core, coreRing };
  return marker;
}

export function animateMarker(marker, dt) {
  marker.rotation.y += dt * 0.8;
  const core = marker.userData.core;
  core.rotation.y += dt * 1.5;
  core.rotation.x += dt * 0.5;
  core.position.y = 1.1 + Math.sin(performance.now() * 0.002) * 0.25;
  const coreRing = marker.userData.coreRing;
  if (coreRing) {
    coreRing.rotation.z += dt * 1.2;
    coreRing.position.y = core.position.y;
  }
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
  // Stage timer: runs while a stage is live, reset on every hand-off.
  G._stageElapsed = (G._stageElapsed || 0) + dt;
  // Stage-change hook: announce the new stage once, on entry.
  if (G._lastStage === undefined) G._lastStage = i;
  if (G._lastStage !== i) {
    G._lastStage = i;
    G._stageElapsed = 0;
    if (i >= 0 && i < MISSION_POINTS.length) onStageStart(G, i);
    // D-QA1: the 3D marker must follow the stage. It used to move only on
    // init / load / stageShot, so from stage 1 on it pointed at the wrong
    // place while the HUD + minimap were already correct.
    if (G.marker) placeMarker(G.marker, i);
  }
  if (i === 3) reinforceYard(G);
  if (i === 0 && nearPoint(p, MISSION_POINTS[0], 5)) {
    payStageReward(G, 0);
    G.missionIndex = 1;
    G.showToast('FIXER: Take the package. No questions.');
  } else if (i === 1 && nearPoint(p, MISSION_POINTS[1], 5)) {
    payStageReward(G, 1);
    G.missionIndex = 2;
    G.showToast('PACKAGE SECURED • Deliver it to the safehouse.');
  } else if (i === 2 && nearPoint(p, MISSION_POINTS[2], 6)) {
    completeMission(G);
  } else if (i === 3 && G.kills >= 3) {
    payStageReward(G, 3);
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
  } else if (i === 6 && nearPoint(p, MISSION_POINTS[6], 6)) {
    completeMission(G);
  } else if (i === 7 && nearPoint(p, MISSION_POINTS[7], 6)) {
    completeMission(G);
  }
  // Objective feedback: travel stages show live distance to the marker;
  // combat / evade stages keep their counters (unchanged wording).
  const dist = Math.round(Math.hypot(p.x - MISSION_POINTS[clamp(i, 0, MISSION_COUNT - 1)].x, p.z - MISSION_POINTS[clamp(i, 0, MISSION_COUNT - 1)].z));
  if (i === 3) {
    G.objectiveText = `Eliminate the hostile crew. ${Math.min(G.kills, 3)}/3 targets neutralized.`;
  } else if (i === 4) {
    const grace = G.garageTimer ? ` • hiding ${Math.ceil(45 - G.garageTimer)}s` : '';
    G.objectiveText = `Reach the garage and lose the police. Wanted level: ${G.wanted}/5.${grace}`;
  } else {
    G.objectiveText = `${OBJECTIVES[clamp(G.missionIndex, 0, MISSION_COUNT - 1)]} (${dist}m)`;
  }
  G.missionTitle = TITLES[clamp(G.missionIndex, 0, MISSION_COUNT - 1)];
  updateSideActivities(G, dt);
}

/**
 * Pay a stage's reward when the stage is LEFT (advance or completion).
 * Stages 0, 1 and 3 leave by advancing, not by completing — without this
 * their rewards would never be paid and the chain would only ever pay
 * five of its eight rewards. completeMission() keeps paying its own
 * reward for the stages that complete; this is only for the advances.
 */
function payStageReward(G, i) {
  const reward = REWARDS[clamp(i, 0, MISSION_COUNT - 1)];
  G.money += reward;
  G.showToast(`STAGE PAY • +$${reward.toLocaleString('en-US')}`);
}

export function completeMission(G) {
  const reward = REWARDS[clamp(G.missionIndex, 0, MISSION_COUNT - 1)];
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
