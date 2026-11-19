// Safehouse for SUNCOAST: HEATLINE — World Environment (G-12).
// One clear job: make the mission-2 delivery point (-36, 36) a real place
// the player can use, and give the camera fix (main.js) one anchor to
// read from.
//
//   A painted ring marks the safehouse spot on the intersection, and a
//   SAFEHOUSE neon sign stands on its south-west corner. Press J here:
//   the player's car is patched back to 100% and the run is saved. Press
//   J anywhere else and it just saves (the repair is the safehouse
//   service, not a free garage).
//
// Wiring: buildSafehouse() is called from world.js (visuals only). The
// J key binds itself on the 'suncoast-ready' event main.js fires once
// the shared state G exists (window.__game) — this module never touches
// main.js. Saving reuses the save module's saveGame (localStorage).

import * as THREE from 'three';
import { neonSignTexture } from './textures.js';
import { saveGame } from '../save/save.js';

export const SAFEHOUSE_POS = { x: -36, z: 36 };
export const SAFEHOUSE_RADIUS = 12; // J repairs inside this ring
export const SAFEHOUSE_CAM_RADIUS = 18; // main.js camera tuck reads this

let safehouseSaves = 0;

/** Debug / QA handle: how many safehouse saves this session. */
export function safehouseSaveCount() { return safehouseSaves; }

/** Build the ground ring + corner sign. No building footprint: the spot
 *  is an intersection, and the sign stands on the sidewalk corner. */
export function buildSafehouse(world) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.7, 3.3, 32),
    new THREE.MeshBasicMaterial({
      color: 0x66e5ff, transparent: true, opacity: 0.7,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SAFEHOUSE_POS.x, 0.03, SAFEHOUSE_POS.z);
  world.add(ring);
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0x66e5ff, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(SAFEHOUSE_POS.x, 0.035, SAFEHOUSE_POS.z);
  world.add(inner);
  // Corner signpost on the south-west sidewalk corner (-44.5, 44.5):
  // 8.5 units off both road centrelines, clear of every facade.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3b4b52, roughness: 0.6, metalness: 0.4 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 3.6, 8), postMat);
  post.position.set(-44.5, 1.8, 44.5);
  post.castShadow = true;
  world.add(post);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 1.4),
    new THREE.MeshBasicMaterial({
      map: neonSignTexture('SAFEHOUSE', '#66e5ff', '#0a1a2a'), toneMapped: false,
    }),
  );
  sign.position.set(-44.5, 4.0, 44.5);
  sign.rotation.y = Math.PI * 0.75; // faces the intersection
  world.add(sign);
}

function trySafehouseSave() {
  const G = window.__game;
  if (!G || !G.gameStarted || G.gameOver) return;
  const p = G.actorPosition();
  const near = Math.hypot(p.x - SAFEHOUSE_POS.x, p.z - SAFEHOUSE_POS.z) <= SAFEHOUSE_RADIUS;
  if (near && G.playerCar && G.playerCar.userData) {
    const u = G.playerCar.userData;
    u.health = 100;
    u.damage = 0;
    u.damageSide = 1;
    if (u.body) u.body.rotation.z = 0;
    safehouseSaves += 1;
  }
  saveGame(G);
  if (near) G.showToast('SAFEHOUSE • CAR RESTORED • GAME SAVED');
  if (typeof G.updateHud === 'function') G.updateHud();
}

/** Bind the J key once the game state exists. Safe to call at import time. */
let safehouseBound = false;
export function bindSafehouseGameplay() {
  if (typeof window === 'undefined' || safehouseBound) return;
  safehouseBound = true;
  const bind = () => {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && !e.repeat) trySafehouseSave();
    });
  };
  if (window.__game) bind();
  else window.addEventListener('suncoast-ready', bind, { once: true });
}
