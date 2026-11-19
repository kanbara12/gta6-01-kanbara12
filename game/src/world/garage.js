// Repaint bay for SUNCOAST: HEATLINE — World Environment (G-12).
// One clear job: the "lose the heat by changing the paint" garage.
//
//   The bay sits on the mission-4 garage point (0, 72): a painted box on
//   the asphalt, two striped posts and a SPRAY SHOP neon sign on the kerb.
//   Drive your car into the box and press G: $150, the paint changes to a
//   new colour, the body is patched up, and the wanted level drops to 0 —
//   a fresh coat means the patrols are looking for a different car.
//
// Wiring: buildRepaintBay() is called from world.js (visuals only). The
// gameplay binds itself on the 'suncoast-ready' event main.js fires once
// the shared state G exists (window.__game) — this module never touches
// main.js. Police clearing goes through window.SuncoastPolice.setWanted
// when that API exists (another specialist owns it); otherwise it falls
// back to clearing G.wanted / G.heat directly, which the main loop's own
// police spawner already honours (wanted 0 despawns the units).

import * as THREE from 'three';
import { neonSignTexture } from './textures.js';

export const REPAINT_BAY = { x: 0, z: 72, r: 10, cost: 150 };

// Fresh-coat palette: original colours, none of them the player car's teal.
const PAINTS = [0xc23b4e, 0x2f6fb5, 0xe8a13a, 0x3fae7a, 0x8a4fd0, 0xe8e4da, 0x2b2b30];

let repaintCount = 0;

/** Debug / QA handle: how many repaints this session. */
export function repaints() { return repaintCount; }

/** Build the bay visuals: road box, striped posts, SPRAY SHOP neon. */
export function buildRepaintBay(world) {
  // Painted box on the asphalt (flat, just above the road so it never
  // z-fights the zebra crossings at the intersection).
  const boxMat = new THREE.MeshBasicMaterial({
    color: 0xffc44d, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const boxGeo = new THREE.PlaneGeometry(7, 9);
  const outline = new THREE.Mesh(boxGeo, boxMat);
  outline.rotation.x = -Math.PI / 2;
  outline.position.set(REPAINT_BAY.x, 0.03, REPAINT_BAY.z);
  world.add(outline);
  // Striped posts at the two kerb-side corners of the box.
  const postMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d2, roughness: 0.6 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc65a3a, roughness: 0.6 });
  for (const [px, pz] of [[-4.6, 67.5], [4.6, 67.5]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.6, 8), postMat);
    post.position.set(px, 1.3, pz);
    post.castShadow = true;
    world.add(post);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 8), stripeMat);
    band.position.set(px, 2.2, pz);
    world.add(band);
  }
  // SPRAY SHOP neon on the kerb, facing the bay (readable from the car).
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({
      map: neonSignTexture('SPRAY SHOP', '#33e0ff', '#0a1a2a'), toneMapped: false,
    }),
  );
  sign.position.set(REPAINT_BAY.x, 3.4, REPAINT_BAY.z - 6.2);
  // Plane front faces +z already: the sign looks south, into the bay.
  world.add(sign);
  for (const sx of [-2.8, 2.8]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), postMat);
    pole.position.set(REPAINT_BAY.x + sx, 1.7, REPAINT_BAY.z - 6.2);
    world.add(pole);
  }
}

function clearWanted(G) {
  const police = window.SuncoastPolice;
  if (police && typeof police.setWanted === 'function') {
    try { police.setWanted(0); } catch { /* fall through to the direct clear */ }
  }
  G.wanted = 0;
  G.heat = 0;
}

function tryRepaint() {
  const G = window.__game;
  if (!G || !G.gameStarted || G.gameOver) return;
  const car = G.currentCar;
  if (!car) return; // repaint needs the car you are driving
  const p = car.position;
  const d = Math.hypot(p.x - REPAINT_BAY.x, p.z - REPAINT_BAY.z);
  if (d > REPAINT_BAY.r) return; // only inside the painted box
  if (G.money < REPAINT_BAY.cost) {
    G.showToast('REPAINT NEEDS $150 • EARN MORE FIRST');
    return;
  }
  const body = car.userData && car.userData.body;
  const now = body && body.material && body.material.color
    ? body.material.color.getHex() : 0;
  let next = PAINTS[repaintCount % PAINTS.length];
  if (next === now) next = PAINTS[(repaintCount + 1) % PAINTS.length];
  G.money -= REPAINT_BAY.cost;
  if (body && body.material && body.material.color) body.material.color.setHex(next);
  // A fresh coat comes with the dents knocked out.
  if (car.userData) {
    car.userData.health = 100;
    car.userData.damage = 0;
    car.userData.damageSide = 1;
    if (body) body.rotation.z = 0;
  }
  clearWanted(G);
  repaintCount += 1;
  G.showToast('FRESH PAINT • $150 • POLICE LOST YOUR TRAIL');
  if (typeof G.updateHud === 'function') G.updateHud();
}

/** Bind the G key once the game state exists. Safe to call at import time. */
let garageBound = false;
export function bindGarageGameplay() {
  if (typeof window === 'undefined' || garageBound) return;
  garageBound = true;
  const bind = () => {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat) tryRepaint();
    });
  };
  if (window.__game) bind();
  else window.addEventListener('suncoast-ready', bind, { once: true });
}
