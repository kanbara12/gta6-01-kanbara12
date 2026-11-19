// Hidden stashes for SUNCOAST: HEATLINE — World Environment (G-12).
// One clear job: five cash stashes hidden in plain sight across the city.
//
//   Walk (or drive) within ~3.5 units and the stash is collected: +$300,
//   a toast, and the bag + its light beam disappear for the rest of the
//   run. Spots are all on foot-reachable ground — a park lawn, two
//   sidewalk corners, the boardwalk, and a downtown kerb — and every one
//   was checked clear of building footprints (the sidewalk spots sit
//   8.5 units off both road centrelines, outside the 7-unit facade line).
//
// Wiring: buildStashes() is called from world.js (visuals only). The
// per-frame bob + collect check runs in world's ticker; it reads the
// shared state through window.__game (set by main.js on the first frame)
// and no-ops until the game has started.

import * as THREE from 'three';

export const STASH_SPOTS = [
  { x: -48, z: 24, note: 'park lawn by the pond' },
  { x: 44.5, z: -27.5, note: 'sidewalk corner, downtown' },
  { x: -99.5, z: 99.5, note: 'sidewalk corner, south-west' },
  { x: 137.2, z: -60, note: 'boardwalk, north beach' },
  { x: 8.5, z: -99.5, note: 'kerb, north avenue' },
];
export const STASH_VALUE = 300;
export const STASH_RADIUS = 3.5;

let collectedCount = 0;

/** Debug / QA handle: how many stashes this session. */
export function stashes() { return collectedCount; }
export function stashTotal() { return STASH_SPOTS.length; }

/** Build the five stash props. Returns the animation/collect state. */
export function buildStashes(world) {
  const bagMat = new THREE.MeshStandardMaterial({
    color: 0x2f4a3a, roughness: 0.7, emissive: 0x1a2f1a, emissiveIntensity: 0.6,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd166, roughness: 0.35, metalness: 0.5,
    emissive: 0x6b4d00, emissiveIntensity: 0.9,
  });
  const beamGeo = new THREE.CylinderGeometry(0.55, 0.85, 3.4, 10, 1, true);
  const list = [];
  for (const spot of STASH_SPOTS) {
    // Beam material is per-stash: the pulse phase differs per stash.
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);
    world.add(g);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 0.75), bagMat);
    bag.position.y = 0.32;
    bag.castShadow = true;
    g.add(bag);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.78), goldMat);
    clasp.position.y = 0.62;
    g.add(clasp);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 2.0;
    g.add(beam);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe6a5 }),
    );
    glow.position.y = 1.15;
    g.add(glow);
    list.push({ group: g, beam, glow, x: spot.x, z: spot.z, taken: false, phase: Math.random() * 6 });
  }
  return { list };
}

/** Per-frame: bob + spin the markers, collect on proximity. */
export function updateStashes(state, dt, t) {
  if (!state) return;
  const G = typeof window !== 'undefined' ? window.__game : null;
  const playing = !!(G && G.gameStarted && !G.gameOver);
  const ax = playing ? G.actorPosition().x : 0;
  const az = playing ? G.actorPosition().z : 0;
  for (const s of state.list) {
    if (s.taken) continue;
    s.group.position.y = 0.05 + Math.sin(t * 1.8 + s.phase) * 0.07;
    s.group.rotation.y += dt * 0.5;
    s.beam.material.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2.4 + s.phase));
    if (!playing) continue;
    if (Math.hypot(ax - s.x, az - s.z) < STASH_RADIUS) {
      s.taken = true;
      s.group.visible = false;
      collectedCount += 1;
      G.money += STASH_VALUE;
      G.showToast(`STASH FOUND • +$${STASH_VALUE}`);
      if (typeof G.updateHud === 'function') G.updateHud();
    }
  }
}
