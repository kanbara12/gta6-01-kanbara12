// Boardwalk landmark + crowd for SUNCOAST: HEATLINE — World Environment.
// One clear job: the coastal landmark the waterfront was missing (G-18) and
// the people who make the boardwalk feel walked, not painted on.
//
//   Suncoast Starwheel — an original ferris wheel on its own timber deck
//   east of the coastal road (x ~149..167, z ~-72..-56, south of the pier):
//   pink neon rim + cyan inner ring, eight gondolas that stay upright as
//   the wheel turns, an A-frame stand, a big STARWHEEL neon sign facing
//   the boardwalk and a TICKETS kiosk on the deck corner.
//   Boardwalk walkers — eight simple strollers who pace the boardwalk
//   (x ~135.5, z -138..138) and turn at the ends, so the strip reads as
//   a promenade at any hour.
//
// Everything here is built from primitives + procedural canvas textures
// (textures.js) — no external assets, no copied landmark. The wheel deck
// is a solid footprint (players / traffic route around it); the wheel
// itself hangs above head height. update() is called by world's per-frame
// ticker (world.js), never by main.js — this module owns no game state.

import * as THREE from 'three';
import { neonSignTexture } from './textures.js';

// Deck footprint (also the collision entry pushed into `buildings`).
export const STARWHEEL = {
  x: 158, z: -64, hubY: 14.5, radius: 11,
  deck: { x0: 149, x1: 167, z0: -72, z1: -56 },
};

const WALKER_COLOURS = [0x8a5a3b, 0x3b6b8a, 0x6b8a3b, 0x8a3b5e, 0x4a4a6b, 0xb08a3b, 0x3b8a7a, 0xc65a3a];

function mat(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(parent, w, h, d, material, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** One boardwalk stroller: torso + head + swinging limb pivots. */
function makeWalker(color) {
  const g = new THREE.Group();
  const jacket = mat(color);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.12, 10), jacket);
  torso.position.y = 1.48;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), mat(0xc78f6b));
  head.position.y = 2.25;
  head.castShadow = true;
  g.add(head);
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 0.96, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 0.3), mat(0x202b34));
    limb.position.y = -0.42;
    limb.castShadow = true;
    pivot.add(limb);
    g.add(pivot);
    legs.push(pivot);
  }
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.55, 1.95, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.82, 0.22), jacket);
    limb.position.y = -0.42;
    limb.castShadow = true;
    pivot.add(limb);
    g.add(pivot);
    arms.push(pivot);
  }
  return { group: g, legs, arms, phase: Math.random() * Math.PI * 2 };
}

/**
 * Build the Starwheel, its deck + kiosk, and the boardwalk walkers.
 * `world` is the scene group, `buildings` the collision list.
 * Returns the animation state for updateBoardwalk().
 */
export function buildBoardwalk(world, buildings) {
  const wood = mat(0x7a5a3a, 0.9);
  const woodDark = mat(0x5a4230, 0.9);
  const steel = mat(0x2c3e46, 0.6, 0.4);

  // ---- timber deck over the sand / water edge + posts down to the shore.
  const deck = new THREE.Group();
  deck.position.set(STARWHEEL.x, 0, STARWHEEL.z);
  world.add(deck);
  addBox(deck, 18, 0.7, 16, wood, 0, 0.85, 0);
  addBox(deck, 18.4, 0.25, 16.4, woodDark, 0, 0.4, 0, false);
  for (const [px, pz] of [[-8, -7], [8, -7], [-8, 7], [8, 7], [0, -7], [0, 7]]) {
    addBox(deck, 0.5, 1.6, 0.5, woodDark, px, 0, pz, false);
  }
  // Low rail along the deck's west edge so it reads as a platform, not a slab.
  addBox(deck, 0.18, 0.9, 16, woodDark, -8.9, 1.6, 0, false);
  buildings.push({
    x: STARWHEEL.x, z: STARWHEEL.z, hw: 9.6, hd: 8.6, h: 2.2,
    district: 'waterfront', kind: 'starwheel-deck',
  });

  // ---- A-frame stand: two slanted leg pairs in the wheel plane (Y-Z),
  // one on each side of the axle (x offsets), joined by crossbars.
  const stand = new THREE.Group();
  stand.position.set(STARWHEEL.x, 0, STARWHEEL.z);
  world.add(stand);
  for (const xo of [-1.6, 1.6]) {
    for (const zs of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 16.5, 0.7), steel);
      leg.position.set(xo, 7.4, zs * 2.9);
      leg.rotation.x = -zs * 0.36;
      leg.castShadow = true;
      stand.add(leg);
    }
    addBox(stand, 0.5, 0.5, 7.5, steel, xo, 4.2, 0, false);
  }
  addBox(stand, 4.4, 0.6, 0.6, steel, 0, STARWHEEL.hubY, 0, false);

  // ---- the wheel itself: pink neon rim + cyan inner ring + 8 spokes,
  // turning slowly around the X axle. Gondolas hang from rim pivots and
  // are counter-rotated every frame so they stay upright.
  const wheel = new THREE.Group();
  wheel.position.set(STARWHEEL.x, STARWHEEL.hubY, STARWHEEL.z);
  world.add(wheel);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xff4d8d });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(STARWHEEL.radius, 0.3, 8, 48), rimMat);
  rim.rotation.y = Math.PI / 2; // torus XY plane -> YZ plane (faces the boardwalk)
  wheel.add(rim);
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(7.2, 0.18, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0x33e0ff }),
  );
  inner.rotation.y = Math.PI / 2;
  wheel.add(inner);
  const spokeMat = mat(0x2c3e46, 0.6, 0.4);
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, STARWHEEL.radius * 2 - 0.6, 0.32), spokeMat);
    spoke.position.set(0, 0, 0);
    spoke.rotation.x = a;
    spoke.castShadow = true;
    wheel.add(spoke);
  }
  // Hub + axle.
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5.2, 10), steel);
  axle.rotation.z = Math.PI / 2;
  axle.castShadow = true;
  wheel.add(axle);
  const hubCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  hubCap.position.set(-2.7, 0, 0);
  wheel.add(hubCap);
  const hubCap2 = hubCap.clone();
  hubCap2.position.set(2.7, 0, 0);
  wheel.add(hubCap2);
  // Gondolas: bright cabins on rim pivots.
  const gondolaColours = [0xff4d8d, 0x33e0ff, 0xffc44d, 0xa7f36c, 0xff6b4a, 0x9a7bb8, 0xf0f0e8, 0xff8a5e];
  const gondolas = [];
  for (let k = 0; k < 8; k += 1) {
    const a = (k * Math.PI) / 4;
    const pivot = new THREE.Group();
    pivot.position.set(0, Math.cos(a) * 10.1, Math.sin(a) * 10.1);
    wheel.add(pivot);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), steel);
    hanger.position.y = 0.4;
    pivot.add(hanger);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1.3, 1.3),
      mat(gondolaColours[k % gondolaColours.length], 0.55, 0.15),
    );
    cabin.position.y = -0.6;
    cabin.castShadow = true;
    pivot.add(cabin);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.22, 1.5),
      mat(0x2c3438, 0.6),
    );
    roof.position.y = 0.15;
    pivot.add(roof);
    gondolas.push(pivot);
  }

  // ---- STARWHEEL neon sign on the deck's west edge, facing the boardwalk.
  const signMat = new THREE.MeshBasicMaterial({
    map: neonSignTexture('STARWHEEL', '#ff4d8d', '#1c0f2a'), toneMapped: false,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.4), signMat);
  sign.position.set(STARWHEEL.x - 8.9, 6.8, STARWHEEL.z);
  sign.rotation.y = -Math.PI / 2;
  world.add(sign);
  for (const sz of [-4.5, 4.5]) addBox(world, 0.3, 6.8, 0.3, steel, STARWHEEL.x - 8.9, 3.4, STARWHEEL.z + sz, false);

  // ---- TICKETS kiosk on the deck's north-west corner + its neon sign.
  const kiosk = new THREE.Group();
  kiosk.position.set(STARWHEEL.x - 6.4, 1.2, STARWHEEL.z + 5.6);
  world.add(kiosk);
  addBox(kiosk, 3.6, 3.0, 3.0, mat(0x2f788b, 0.7), 0, 1.5, 0);
  const kioskRoof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.4, 4), mat(0xc65a3a, 0.9));
  kioskRoof.position.y = 3.7;
  kioskRoof.rotation.y = Math.PI / 4;
  kioskRoof.castShadow = true;
  kiosk.add(kioskRoof);
  addBox(kiosk, 2.2, 1.4, 0.12, new THREE.MeshStandardMaterial({
    color: 0x1c2f3a, roughness: 0.12, metalness: 0.6,
  }), 0, 1.5, 1.56, false);
  const ticketMat = new THREE.MeshBasicMaterial({
    map: neonSignTexture('TICKETS', '#ffd166', '#14100a'), toneMapped: false,
  });
  const ticketSign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), ticketMat);
  ticketSign.position.set(STARWHEEL.x - 8.35, 4.6, STARWHEEL.z + 5.6);
  ticketSign.rotation.y = -Math.PI / 2;
  world.add(ticketSign);

  // ---- festoon bulbs along the deck's west rail (warm points at dusk).
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe6a5 });
  const bulbGeo = new THREE.SphereGeometry(0.2, 8, 6);
  for (let i = 0; i < 6; i += 1) {
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(STARWHEEL.x - 8.9, 2.9, STARWHEEL.z - 6.4 + i * 2.56);
    world.add(bulb);
  }

  // ---- boardwalk walkers: eight strollers pacing the strip.
  const walkers = [];
  for (let i = 0; i < 8; i += 1) {
    const w = makeWalker(WALKER_COLOURS[i % WALKER_COLOURS.length]);
    w.group.position.set(134.2 + (i % 3) * 1.4, 0, -126 + i * 36 + (i % 2) * 9);
    w.dir = i % 2 === 0 ? 1 : -1;
    w.speed = 1.2 + (i % 4) * 0.18;
    w.group.rotation.y = w.dir > 0 ? 0 : Math.PI;
    world.add(w.group);
    walkers.push(w);
  }

  return { wheel, gondolas, signMats: [signMat, ticketMat], walkers };
}

/** Per-frame: slow wheel turn (cabins stay upright), walker pace, neon pulse. */
export function updateBoardwalk(state, dt, t) {
  if (!state) return;
  state.wheel.rotation.x += dt * 0.14; // one turn in ~45 s
  for (const g of state.gondolas) g.rotation.x = -state.wheel.rotation.x;
  const pulse = 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.2));
  for (const m of state.signMats) m.color.setScalar(pulse);
  for (const w of state.walkers) {
    w.phase += dt * 5.2;
    const swing = Math.sin(w.phase) * 0.5;
    w.legs[0].rotation.x = swing;
    w.legs[1].rotation.x = -swing;
    w.arms[0].rotation.x = -swing * 0.8;
    w.arms[1].rotation.x = swing * 0.8;
    w.group.position.y = Math.abs(Math.cos(w.phase)) * 0.05;
    w.group.position.z += w.dir * w.speed * dt;
    if (w.group.position.z > 138) { w.dir = -1; w.group.rotation.y = Math.PI; }
    if (w.group.position.z < -138) { w.dir = 1; w.group.rotation.y = 0; }
  }
}
