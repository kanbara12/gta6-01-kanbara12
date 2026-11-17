// World construction for SUNCOAST: HEATLINE — COMPLETE CINEMATIC OVERHAUL.
// One clear job: build the static city and answer the collision /
// line-of-sight questions the actors need.
//
// What this version builds (districts, see constants.js districtFor):
//   downtown financial district (glass skyline), residential streets,
//   commercial streets with awnings + neon, a neon nightlife district,
//   beach + coastal highway, marina + industrial port with docks and a
//   cargo ship, parks, alleys/backstreets, gas stations, parking garages,
//   harbour docks and a lighthouse. Roads carry baked asphalt markings,
//   sidewalks, zebra crosswalks, traffic lights and street furniture;
//   palms and trees are instanced. All textures are procedural canvas
//   textures (textures.js) — zero external requests, zero image files.
//
// Contracts preserved (main.js / vehicles / characters depend on them):
//   buildWorld(scene) -> { world, buildings, ocean }
//   collidesBuilding(buildings, x, z, r)
//   hasLineOfSight(buildings, ax, az, bx, bz)
//   nearestRoadCoord(v)
//   animateOcean(ocean, t)
//   buildings entries keep { x, z, hw, hd, h } (+ district/kind extras).
// New exports: setTimeOfDay(hour 0..24), setWet(amount 0..1).
//
// Placement rules (hard): every building footprint stays inside its block
// (|offset| + half-size <= BLOCK_EXTENT = 11, so facades never touch the
// road or the sidewalk band) and clear of CLEAR_POINTS (mission points,
// spawns, ?shot= staging). The crew-yard block stays open in the middle.

import * as THREE from 'three';
import { WORLD, COLOURS, seeded } from '../core/config.js';
import {
  BLOCK_EXTENT, CLEAR_POINTS, PALETTES, CONTAINER_COLOURS,
  NEON_SIGNS, DAY_KEYFRAMES, districtFor,
} from './constants.js';
import {
  facadeTexture, glassTexture, asphaltTexture, sidewalkTexture,
  sandTexture, boardwalkTexture, brickTexture, containerTexture,
  awningTexture, neonSignTexture, billboardTexture, zebraTexture,
  lighthouseTexture,
} from './textures.js';

// ------------------------------------------------------------------ state
// Module-level environment state, filled by buildWorld(). setTimeOfDay /
// setWet operate on it and no-op gracefully before the world exists.
const env = {
  scene: null,
  skyGeo: null,
  sunDisc: null,
  halo: null,
  moon: null,
  windowMat: null,
  lampMat: null,
  roadMat: null,
  sidewalkMat: null,
  oceanMat: null,
  puddleMat: null,
  rain: null,
  rainSpeeds: null,
  rainMat: null,
  sunLight: null,
  hemiLight: null,
  fillLight: null,
  lastRainT: -1,
  timeOfDay: 18.7,
  wet: 0,
};

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

/** True when a footprint (x,z,hw,hd) would cover a protected point. */
function blockedByClear(x, z, hw, hd) {
  for (const p of CLEAR_POINTS) {
    if (Math.abs(x - p.x) < hw + p.r && Math.abs(z - p.z) < hd + p.r) return true;
  }
  return false;
}

/** Clamp a block-local offset so |offset| + halfSize stays in the block. */
function inBlock(offset, half) {
  const max = BLOCK_EXTENT - half;
  return THREE.MathUtils.clamp(offset, -Math.max(max, 0), Math.max(max, 0));
}

// ------------------------------------------------------------------ sky
function paintSky(topHex, midHex, horizonHex) {
  const top = new THREE.Color(topHex);
  const mid = new THREE.Color(midHex);
  const horizon = new THREE.Color(horizonHex);
  const pos = env.skyGeo.attributes.position;
  const colours = [];
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 420, 0, 1);
    let c;
    if (t < 0.42) c = horizon.clone().lerp(mid, t / 0.42);
    else c = mid.clone().lerp(top, Math.pow((t - 0.42) / 0.58, 0.8));
    colours.push(c.r, c.g, c.b);
  }
  env.skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  env.skyGeo.attributes.color.needsUpdate = true;
}

function makeSky(scene) {
  env.skyGeo = new THREE.SphereGeometry(420, 24, 12);
  const sky = new THREE.Mesh(env.skyGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  }));
  scene.add(sky);
  paintSky(COLOURS.skyTop, COLOURS.skyMid, COLOURS.skyHorizon);

  // Low sun in the west with a soft radial glow and a wide halo, so the
  // glare sits inside the frame of the west-facing screenshot scenes.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,214,140,0.95)');
  grad.addColorStop(0.55, 'rgba(255,150,80,0.45)');
  grad.addColorStop(1, 'rgba(255,150,80,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  env.sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, fog: false, depthWrite: false }),
  );
  env.sunDisc.position.set(-320, 58, -60);
  env.sunDisc.lookAt(0, 40, 0);
  scene.add(env.sunDisc);
  env.halo = new THREE.Mesh(
    new THREE.CircleGeometry(70, 32),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.35, fog: false, depthWrite: false }),
  );
  env.halo.position.set(-322, 58, -60);
  env.halo.lookAt(0, 40, 0);
  scene.add(env.halo);
  // Pale moon for night hours (hidden at sunset/day, shown by setTimeOfDay).
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = 128;
  moonCanvas.height = 128;
  const mctx = moonCanvas.getContext('2d');
  const mg = mctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  mg.addColorStop(0, 'rgba(235,240,255,1)');
  mg.addColorStop(0.55, 'rgba(200,212,240,0.9)');
  mg.addColorStop(1, 'rgba(200,212,240,0)');
  mctx.fillStyle = mg;
  mctx.fillRect(0, 0, 128, 128);
  const moonTex = new THREE.CanvasTexture(moonCanvas);
  env.moon = new THREE.Mesh(
    new THREE.CircleGeometry(16, 32),
    new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false }),
  );
  env.moon.position.set(180, 150, -80);
  env.moon.lookAt(0, 40, 0);
  env.moon.visible = false;
  scene.add(env.moon);
}

// ------------------------------------------------------------------ ground
function makeGround(world) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), mat(COLOURS.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.16;
  ground.receiveShadow = true;
  world.add(ground);

  // Sidewalk strips along every road: 2.5 wide, just outside the asphalt.
  const swTex = sidewalkTexture();
  env.sidewalkMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.9 });
  const stripGeoV = new THREE.PlaneGeometry(2.5, 330);
  const stripGeoH = new THREE.PlaneGeometry(330, 2.5);
  for (let road = -144; road <= 144; road += WORLD.grid) {
    for (const side of [-1, 1]) {
      const v = new THREE.Mesh(stripGeoV, env.sidewalkMat);
      v.rotation.x = -Math.PI / 2;
      v.position.set(road + side * 7.75, 0.0, 0);
      v.receiveShadow = true;
      world.add(v);
      const h = new THREE.Mesh(stripGeoH, env.sidewalkMat);
      h.rotation.x = -Math.PI / 2;
      h.position.set(0, 0.001, road + side * 7.75);
      h.receiveShadow = true;
      world.add(h);
    }
  }
}

// ------------------------------------------------------------------ roads
function makeRoads(world) {
  const asphalt = asphaltTexture();
  const asphaltH = asphalt.clone();
  asphaltH.rotation = Math.PI / 2;
  asphaltH.center.set(0.5, 0.5);
  asphaltH.needsUpdate = true;
  env.roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92 });
  const roadMatH = new THREE.MeshStandardMaterial({ map: asphaltH, roughness: 0.92 });
  env.roadMatH = roadMatH;
  const geoV = new THREE.PlaneGeometry(13, 330);
  const geoH = new THREE.PlaneGeometry(330, 13);
  for (let road = -144; road <= 144; road += WORLD.grid) {
    const vertical = new THREE.Mesh(geoV, env.roadMat);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(road, 0.005, 0);
    vertical.receiveShadow = true;
    world.add(vertical);
    const horizontal = new THREE.Mesh(geoH, roadMatH);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, 0.006, road);
    horizontal.receiveShadow = true;
    world.add(horizontal);
  }

  // Zebra crosswalks + stop lines at every intersection (one shared texture).
  const zebra = zebraTexture();
  const zebraMat = new THREE.MeshBasicMaterial({
    map: zebra, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const zebraGeo = new THREE.PlaneGeometry(12, 12);
  for (let x = -144; x <= 144; x += WORLD.grid) {
    for (let z = -144; z <= 144; z += WORLD.grid) {
      const c = new THREE.Mesh(zebraGeo, zebraMat);
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = (x + z) % 72 === 0 ? 0 : Math.PI / 2;
      c.position.set(x, 0.02, z);
      c.receiveShadow = true;
      world.add(c);
    }
  }
}

// ------------------------------------------------------------------ buildings
// ctx: { world, buildings, windowTransforms, dummy, treeSpots, palmSpots }

function addWindows(ctx, x, z, w, d, h, faces = 2, maxRows = 6) {
  if (ctx.windowTransforms.length > 6000) return;
  const rows = Math.min(maxRows, Math.floor(h / 3.6));
  const cols = Math.floor(w / 3.0);
  const colsD = Math.floor(d / 3.0);
  const { dummy } = ctx;
  const put = (px, py, pz, ry) => {
    dummy.position.set(px, py, pz);
    dummy.rotation.set(0, ry, 0);
    dummy.updateMatrix();
    ctx.windowTransforms.push(dummy.matrix.clone());
  };
  for (let row = 1; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const wx = -w / 2 + 1.4 + col * 3.0;
      put(x + wx, row * 3.0, z + d / 2 + 0.045, 0);
      if (faces === 4 || col % 2 === 0) put(x + wx, row * 3.0, z - d / 2 - 0.045, Math.PI);
    }
    if (faces === 4) {
      for (let col = 0; col < colsD; col += 1) {
        const wz = -d / 2 + 1.4 + col * 3.0;
        put(x + w / 2 + 0.045, row * 3.0, z + wz, Math.PI / 2);
        put(x - w / 2 - 0.045, row * 3.0, z + wz, -Math.PI / 2);
      }
    }
  }
}

function pushBuilding(ctx, x, z, w, d, h, district, kind) {
  ctx.buildings.push({
    x, z, hw: w / 2 + 0.6, hd: d / 2 + 0.6, h, district, kind,
  });
}

function pick(arr, s) {
  return arr[Math.floor(seeded(s) * arr.length) % arr.length];
}

function facadeMat(hex, seed) {
  const tex = facadeTexture(`#${hex.toString(16).padStart(6, '0')}`);
  tex.repeat.set(2, 2);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
}

function glassMat(seed) {
  const tex = glassTexture('#7fa8b5', '#3f5a6b');
  tex.repeat.set(2, 3);
  return new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.22, metalness: 0.5,
  });
}

/** Downtown / waterfront glass tower: slab + setback crown + rooftop plant. */
function buildTower(ctx, cx, cz, seed, district, hMin, hMax) {
  const w = 10 + seeded(seed + 1) * 4;
  const d = 10 + seeded(seed + 5) * 4;
  const h = hMin + seeded(seed + 3) * (hMax - hMin);
  const x = cx + inBlock((seeded(seed + 11) - 0.5) * 6, w / 2);
  const z = cz + inBlock((seeded(seed + 13) - 0.5) * 6, d / 2);
  if (blockedByClear(x, z, w / 2 + 0.6, d / 2 + 0.6)) {
    // Fallback: the tower would crowd a protected point (e.g. the crew-yard
    // approach). Fill the block with a low plaza pavilion on the first
    // corner that stays clear instead of leaving a hole in the skyline row.
    for (const [ox, oz] of [[-7, 7], [7, 7], [-7, -7], [7, -7]]) {
      const px = cx + ox;
      const pz = cz + oz;
      if (blockedByClear(px, pz, 3.6, 3.6)) continue;
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      ctx.world.add(g);
      addBox(g, 6, 4, 6, facadeMat(pick(PALETTES[district] || PALETTES.commercial, seed + 8), seed), 0, 2, 0);
      addBox(g, 6.3, 0.4, 6.3, mat(0x4d5960), 0, 4.2, 0, false);
      addWindows(ctx, px, pz, 6, 6, 4, 2, 2);
      pushBuilding(ctx, px, pz, 6, 6, 4, district, 'pavilion');
      return;
    }
    return;
  }
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.world.add(g);
  addBox(g, w, h, d, glassMat(seed), 0, h / 2, 0);
  // Setback crown + parapet + rooftop plant + antenna.
  addBox(g, w * 0.62, 3.5, d * 0.62, mat(0x2c3e46), 0, h + 1.75, 0, false);
  addBox(g, w + 0.25, 0.45, d + 0.25, mat(0x4d5960), 0, h + 0.2, 0, false);
  addBox(g, 2.2, 1.2, 2.2, mat(0x5a6a72), w * 0.2, h + 0.9, -d * 0.2, false);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.14, 7, 6), mat(0x3b4b52),
  );
  antenna.position.set(-w * 0.25, h + 5, d * 0.2);
  g.add(antenna);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4d4d }),
  );
  beacon.position.set(-w * 0.25, h + 8.6, d * 0.2);
  g.add(beacon);
  addWindows(ctx, x, z, w, d, h, 4, 9);
  pushBuilding(ctx, x, z, w, d, h, district, 'tower');
}

/** Shopfront: parapet, storefront glass, striped awning, optional neon. */
function buildShop(ctx, cx, cz, ox, oz, seed, district, neon) {
  const w = 6 + seeded(seed + 1) * 2;
  const d = 6 + seeded(seed + 5) * 2;
  const h = 6 + seeded(seed + 3) * 6;
  const x = cx + inBlock(ox, w / 2);
  const z = cz + inBlock(oz, d / 2);
  if (blockedByClear(x, z, w / 2 + 0.6, d / 2 + 0.6)) return null;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.world.add(g);
  const bodyHex = pick(PALETTES[district] || PALETTES.commercial, seed + 8);
  addBox(g, w, h, d, facadeMat(bodyHex, seed), 0, h / 2, 0);
  addBox(g, w + 0.25, 0.45, d + 0.25, mat(0x4d5960), 0, h + 0.2, 0, false);
  // Storefront glass band on the street-facing (+z) side.
  addBox(g, w * 0.8, 2.4, 0.12, new THREE.MeshStandardMaterial({
    color: 0x1c2f3a, roughness: 0.12, metalness: 0.6,
  }), 0, 1.5, d / 2 + 0.06, false);
  // Striped awning over the storefront.
  const awn = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.85, 1.7),
    new THREE.MeshStandardMaterial({
      map: awningTexture('#e2725b', '#f0d0a0'), side: THREE.DoubleSide, roughness: 0.8,
    }),
  );
  awn.position.set(0, 3.1, d / 2 + 0.85);
  awn.rotation.x = -0.55;
  g.add(awn);
  if (neon) {
    const sign = NEON_SIGNS[Math.floor(seeded(seed + 21) * NEON_SIGNS.length) % NEON_SIGNS.length];
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.3),
      new THREE.MeshBasicMaterial({ map: neonSignTexture(sign.text, sign.fg, sign.bg), toneMapped: false }),
    );
    signMesh.position.set(0, h - 1.6, d / 2 + 0.08);
    g.add(signMesh);
  }
  addWindows(ctx, x, z, w, d, h, 2, 4);
  pushBuilding(ctx, x, z, w, d, h, district, 'shop');
  return { x, z, w, d, h };
}

/** Detached house: stucco box + pyramid roof + chimney + porch. */
function buildHouse(ctx, cx, cz, ox, oz, seed) {
  const w = 6.5 + seeded(seed + 1) * 2.5;
  const d = 6.5 + seeded(seed + 5) * 2.5;
  const h = 4.5 + seeded(seed + 3) * 1.8;
  const x = cx + inBlock(ox, w / 2);
  const z = cz + inBlock(oz, d / 2);
  if (blockedByClear(x, z, w / 2 + 0.6, d / 2 + 0.6)) return;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.world.add(g);
  const bodyHex = pick(PALETTES.residential, seed + 8);
  addBox(g, w, h, d, facadeMat(bodyHex, seed), 0, h / 2, 0);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.6 + seeded(seed + 7) * 1.2, 4),
    mat(pick([0xb85c3a, 0x7a4a3a, 0x4a5a6a, 0x8a6a4a], seed + 9), 0.9),
  );
  roof.position.y = h + 1.3 + seeded(seed + 7) * 0.6;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);
  addBox(g, 0.9, 1.6, 0.9, mat(0x8a5a4a), w * 0.28, h + 1.4, -d * 0.2, false);
  addBox(g, w * 0.5, 0.25, 1.6, mat(0xa8907c), 0, 0.12, d / 2 + 0.8, false);
  addWindows(ctx, x, z, w, d, h, 2, 2);
  pushBuilding(ctx, x, z, w, d, h + 2.5, 'residential', 'house');
  // Yard tree.
  ctx.treeSpots.push([x + (seeded(seed + 31) - 0.5) * 14, z + (seeded(seed + 33) - 0.5) * 14]);
}

/** Warehouse: brick box, big loading door, roof slab, container stacks. */
function buildWarehouse(ctx, cx, cz, seed) {
  const w = 14 + seeded(seed + 1) * 4;
  const d = 10 + seeded(seed + 5) * 4;
  const h = 7 + seeded(seed + 3) * 2.5;
  const x = cx + inBlock((seeded(seed + 11) - 0.5) * 5, w / 2);
  const z = cz + inBlock((seeded(seed + 13) - 0.5) * 5, d / 2);
  if (blockedByClear(x, z, w / 2 + 0.6, d / 2 + 0.6)) {
    // Fallback: the warehouse would crowd the crew-yard approach. Keep the
    // block industrial with container stacks on its far (east) side instead.
    buildContainerStack(ctx, cx + 7, cz - 8, seed + 40, 2);
    buildContainerStack(ctx, cx + 7, cz + 8, seed + 50, 2);
    return;
  }
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.world.add(g);
  const tex = brickTexture(`#${pick(PALETTES.industrial, seed + 8).toString(16).padStart(6, '0')}`);
  addBox(g, w, h, d, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0, h / 2, 0);
  addBox(g, w + 0.3, 0.5, d + 0.3, mat(0x3b4b52), 0, h + 0.25, 0, false);
  addBox(g, 4.5, 4.2, 0.15, mat(0x2c3438, 0.6, 0.4), -w * 0.2, 2.1, d / 2 + 0.08, false);
  addBox(g, 1.4, 2.6, 0.15, mat(0x4a5a62), w * 0.3, 1.3, d / 2 + 0.08, false);
  pushBuilding(ctx, x, z, w, d, h, 'industrial', 'warehouse');
  // Container stack beside the warehouse (solid, separate footprint).
  buildContainerStack(ctx, cx + 7, cz - 8, seed + 40, 2);
}

/** Shipping-container stack (2-3 high). Solid footprint for collision. */
function buildContainerStack(ctx, x, z, seed, levels = 2) {
  const w = 6.2;
  const d = 2.6;
  const h = 2.6 * levels;
  if (blockedByClear(x, z, w / 2 + 0.6, d / 2 + 0.6)) return;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  ctx.world.add(g);
  for (let i = 0; i < levels; i += 1) {
    const col = CONTAINER_COLOURS[Math.floor(seeded(seed + i * 7) * CONTAINER_COLOURS.length) % CONTAINER_COLOURS.length];
    const tex = containerTexture(`#${col.toString(16).padStart(6, '0')}`);
    addBox(g, w, 2.5, d, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.3 }),
      (seeded(seed + i) - 0.5) * 0.4, 1.3 + i * 2.6, 0);
  }
  pushBuilding(ctx, x, z, w, d, h, 'industrial', 'containers');
}

/** 3-deck open parking garage (solid footprint) with prop cars on top. */
function buildGarage(ctx, cx, cz, seed) {
  const s = 20;
  const h = 11.5;
  if (blockedByClear(cx, cz, s / 2 + 0.6, s / 2 + 0.6)) return;
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  ctx.world.add(g);
  const deckMat = mat(0x8a8a86, 0.95);
  const colMat = mat(0x6b6f75);
  for (let level = 0; level < 3; level += 1) {
    const y = 0.3 + level * 4.1;
    addBox(g, s, 0.5, s, deckMat, 0, y, 0);
    if (level < 2) {
      // Edge barrier on the open sides.
      addBox(g, s, 0.9, 0.3, colMat, 0, y + 0.7, -s / 2 + 0.15, false);
      addBox(g, s, 0.9, 0.3, colMat, 0, y + 0.7, s / 2 - 0.15, false);
    }
  }
  for (const px of [-9, 0, 9]) {
    for (const pz of [-9, 9]) addBox(g, 0.6, h, 0.6, colMat, px, h / 2, pz, false);
  }
  // Ramp wedge + rooftop prop cars.
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 12), deckMat);
  ramp.position.set(-6, 2.2, 0);
  ramp.rotation.x = 0.32;
  ramp.castShadow = true;
  g.add(ramp);
  for (let i = 0; i < 3; i += 1) {
    const carCol = pick([0xc65a3a, 0x3a6ab5, 0xd9c9a0], seed + i);
    addBox(g, 4.2, 1.1, 1.9, mat(carCol, 0.4, 0.4), -6 + i * 6, 9.3, -5 + (i % 2) * 9, false);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.5),
    new THREE.MeshBasicMaterial({ map: neonSignTexture('PARKING', '#33e0ff', '#0a1a2a'), toneMapped: false }),
  );
  sign.position.set(0, 10.6, s / 2 + 0.08);
  g.add(sign);
  pushBuilding(ctx, cx, cz, s, s, h, 'commercial', 'garage');
}

/** Gas station: canopy on poles, pumps, kiosk, price pylon. */
function buildGasStation(ctx, cx, cz, seed) {
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    mat(0x9a9a94, 0.95),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(cx, 0.005, cz);
  pad.receiveShadow = true;
  ctx.world.add(pad);
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  ctx.world.add(g);
  // Canopy.
  addBox(g, 15, 0.5, 10, mat(0xd9d9d2, 0.6), 0, 5.4, -2);
  addBox(g, 15.4, 0.3, 10.4, mat(0xc65a3a), 0, 5.1, -2, false);
  for (const px of [-6.5, 6.5]) {
    for (const pz of [-6, 2]) addBox(g, 0.4, 5.2, 0.4, mat(0x8a8a86), px, 2.6, pz, false);
  }
  // Pumps (two islands).
  for (const px of [-3.5, 3.5]) {
    for (const pz of [-3.5, -0.5]) {
      addBox(g, 0.9, 1.5, 0.6, mat(0xd9d9d2, 0.5), px, 0.75, pz, false);
      addBox(g, 0.95, 0.3, 0.65, mat(0xc65a3a, 0.5), px, 1.6, pz, false);
    }
  }
  // Kiosk (the only solid footprint — canopy poles are thin enough to miss).
  addBox(g, 5.5, 3.6, 4.5, facadeMat(pick(PALETTES.commercial, seed + 4), seed), 6, 1.8, 7);
  pushBuilding(ctx, cx + 6, cz + 7, 5.5, 4.5, 3.6, 'commercial', 'gas-kiosk');
  // Price pylon at the lot corner.
  addBox(g, 0.8, 8, 0.8, mat(0x3b4b52), -11, 4, 11, false);
  const pylon = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2.2),
    new THREE.MeshBasicMaterial({ map: neonSignTexture('GAS • 24H', '#ff6b4a', '#14100a'), toneMapped: false }),
  );
  pylon.position.set(-11, 8.6, 11);
  pylon.rotation.y = Math.PI / 4;
  g.add(pylon);
}

/** Park: lawn, pond, paths, benches, trees. */
function buildPark(ctx, cx, cz, seed, central) {
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    mat(central ? 0x3d6a42 : 0x4d7a52, 0.95),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(cx, 0.002, cz);
  patch.receiveShadow = true;
  ctx.world.add(patch);
  // Pond (central park only).
  if (central) {
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x2f6a8a, roughness: 0.12, metalness: 0.3 }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.4, 1, 1);
    pond.position.set(cx - 3, 0.02, cz + 2);
    pond.receiveShadow = true;
    ctx.world.add(pond);
    // Fountain basin + column.
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.7, 16), mat(0xb8b0a0, 0.9),
    );
    basin.position.set(cx + 6, 0.35, cz - 5);
    basin.castShadow = true;
    ctx.world.add(basin);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x66c2e0, roughness: 0.1, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx + 6, 0.72, cz - 5);
    ctx.world.add(water);
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 1.6, 8), mat(0xb8b0a0),
    );
    col.position.set(cx + 6, 1.4, cz - 5);
    ctx.world.add(col);
  }
  // Crossing paths.
  const pathMat = env.sidewalkMat;
  for (const horizontal of [true, false]) {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(horizontal ? 22 : 2.5, horizontal ? 2.5 : 22), pathMat,
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(cx, 0.01, cz);
    path.receiveShadow = true;
    ctx.world.add(path);
  }
  // Trees + benches.
  for (let t = 0; t < 8; t += 1) {
    ctx.treeSpots.push([
      cx + (seeded(seed + t * 3) - 0.5) * 24,
      cz + (seeded(seed + t * 5 + 1) - 0.5) * 24,
    ]);
  }
  for (let b = 0; b < 3; b += 1) {
    const bx = cx - 8 + b * 8;
    const bz = cz + 8;
    addBox(ctx.world, 2.2, 0.12, 0.7, mat(0x7a5a3a), bx, 0.55, bz, false);
    addBox(ctx.world, 2.2, 0.7, 0.12, mat(0x7a5a3a), bx, 0.9, bz - 0.32, false);
  }
}

/** Crew yard (mission 3): open concrete pad, fence with gate, containers
 *  and crates only at the edges — the middle stays clear for the fight. */
function buildYard(ctx, cx, cz, seed) {
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22), mat(0x8a8a86, 0.95),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(cx, 0.005, cz);
  pad.receiveShadow = true;
  ctx.world.add(pad);
  // Perimeter fence (low, with a gate gap on the west side facing the roads).
  // Fences sit at +/-11 from the block centre: off the asphalt (road edge
  // is 6.5 from its centreline = 11.5 from the block centre).
  const fenceMat = mat(0x5a6a72, 0.7, 0.4);
  const fence = (w, d, x, z) => addBox(ctx.world, w, 2.2, d, fenceMat, x, 1.1, z, false);
  fence(22, 0.3, cx, cz - 11);
  fence(22, 0.3, cx, cz + 11);
  fence(0.3, 8, cx + 11, cz - 7);
  fence(0.3, 8, cx + 11, cz + 7);
  fence(0.3, 8, cx - 11, cz - 7);
  fence(0.3, 8, cx - 11, cz + 7);
  // Containers + crates at the east/north edges only.
  buildContainerStack(ctx, cx + 7, cz - 9, seed + 10, 2);
  buildContainerStack(ctx, cx + 7, cz + 9, seed + 20, 3);
  for (const [ox, oz] of [[-8, -9], [-8, 9], [2, -10]]) {
    addBox(ctx.world, 1.6, 1.6, 1.6, mat(0x7a5a3a, 0.9), cx + ox, 0.8, cz + oz);
    addBox(ctx.world, 1.2, 1.2, 1.2, mat(0x8a6a4a, 0.9), cx + ox + 0.4, 2.2, cz + oz + 0.3, false);
  }
  // Barrels.
  for (let i = 0; i < 4; i += 1) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.3, 10),
      mat(pick([0x3a6ab5, 0xc65a3a, 0x2f7a4a], seed + i), 0.6, 0.3),
    );
    barrel.position.set(cx - 9 + (i % 2) * 1.4, 0.65, cz - 3 + Math.floor(i / 2) * 1.4);
    barrel.castShadow = true;
    ctx.world.add(barrel);
  }
}

// ------------------------------------------------------------------ coast
/** Ocean plane + animated shore foam + sand beach + boardwalk + pier. */
function makeCoast(world, ctx) {
  // Sand beach: the strip between the last city block and the water.
  const sandTex = sandTexture();
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 360),
    new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(WORLD.coastX + 6, -0.05, 0);
  sand.receiveShadow = true;
  world.add(sand);
  // Dunes: low flattened mounds along the back of the beach.
  const duneMat = mat(0xe8c48a, 0.95);
  for (let i = 0; i < 10; i += 1) {
    const dz = -150 + i * 32 + seeded(500 + i) * 10;
    if (Math.abs(dz) < 10) continue; // keep the pier approach clear
    const dune = new THREE.Mesh(new THREE.SphereGeometry(3.5 + seeded(510 + i) * 2, 10, 8), duneMat);
    dune.scale.set(1, 0.28, 1.6);
    dune.position.set(140 + seeded(520 + i) * 3, 0.1, dz);
    dune.receiveShadow = true;
    world.add(dune);
  }
  // Boardwalk along the beach edge.
  const walkTex = boardwalkTexture();
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 330),
    new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.9 }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(WORLD.coastX - 3, 0.01, 0);
  walk.receiveShadow = true;
  world.add(walk);
  // Ocean: two-tone, gently animated by the main loop (see animateOcean).
  const oceanGeo = new THREE.PlaneGeometry(WORLD.oceanFar - WORLD.oceanX, 420, 24, 24);
  env.oceanMat = new THREE.MeshStandardMaterial({
    color: COLOURS.ocean, roughness: 0.25, metalness: 0.35,
    transparent: true, opacity: 0.94,
  });
  const ocean = new THREE.Mesh(oceanGeo, env.oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set((WORLD.oceanX + WORLD.oceanFar) / 2, 0.6, 0);
  ocean.receiveShadow = true;
  world.add(ocean);
  // Pier: wooden deck on posts reaching into the ocean at z = 0.
  const pier = new THREE.Group();
  pier.position.set(WORLD.oceanX + 4, 0, 0);
  addBox(pier, 46, 0.5, 7, mat(0x7a5a3a, 0.9), 23, 0.9, 0);
  for (let x = 2; x <= 44; x += 6) {
    for (const z of [-3, 3]) addBox(pier, 0.5, 1.6, 0.5, mat(0x5a4230), x, 0, z, false);
  }
  for (const x of [8, 20, 32, 42]) {
    addBox(pier, 0.22, 4.5, 0.22, mat(0x3b4b52), x, 3, -3.2, false);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe6a5 }),
    );
    lamp.position.set(x, 5.4, -3.2);
    pier.add(lamp);
  }
  // End platform with a small kiosk hut + bait-shop neon.
  addBox(pier, 10, 0.5, 12, mat(0x7a5a3a, 0.9), 47, 0.9, 0);
  addBox(pier, 5, 3.4, 4.5, mat(0x2f788b, 0.7), 47, 2.6, 0);
  const pierSign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.05),
    new THREE.MeshBasicMaterial({ map: neonSignTexture('PIER 9', '#ffd166', '#101a2a'), toneMapped: false }),
  );
  pierSign.position.set(47, 4.6, 2.3);
  pier.add(pierSign);
  world.add(pier);
  // Beach umbrellas + towels for a lived-in shore.
  const umbrellaMat = mat(0xe2725b, 0.7);
  for (const [ux, uz] of [[146, -40], [143, 18], [147, 62], [144, -88], [146, 108], [145, -120], [147, 132], [144, -58]]) {
    addBox(world, 0.18, 2.6, 0.18, mat(0x6b5a48), ux, 1.3, uz, false);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8), umbrellaMat);
    canopy.position.set(ux, 3, uz);
    canopy.castShadow = true;
    world.add(canopy);
  }
  // Lifeguard tower + volleyball net.
  const lg = new THREE.Group();
  lg.position.set(146, 0, 40);
  world.add(lg);
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    addBox(lg, 0.25, 3.4, 0.25, mat(0x8a8a86), lx, 1.7, lz, false);
  }
  addBox(lg, 3.4, 0.4, 3.4, mat(0xd9d9d2), 0, 3.6, 0, false);
  addBox(lg, 3.0, 1.6, 2.6, mat(0xf0f0e8, 0.7), 0, 4.6, 0);
  addBox(lg, 3.4, 0.3, 3.4, mat(0xc65a3a), 0, 5.5, 0, false);
  const netPoleMat = mat(0x8a8a86);
  for (const nz of [-4, 4]) addBox(world, 0.18, 2.6, 0.18, netPoleMat, 145, 1.3, -20 + nz, false);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xf0f0e8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  net.position.set(145, 2.0, -20);
  world.add(net);

  makeMarina(world, ctx);
  makePort(world, ctx);
  makeLighthouse(world);
  return ocean;
}

/** Marina (south-east coast): beach-club huts, finger docks, moored boats. */
function makeMarina(world, ctx) {
  for (const [cz, hutZ] of [[90, 84], [126, 132]]) {
    // Beach-club hut (solid footprint, inside the marina block).
    const hut = new THREE.Group();
    hut.position.set(122, 0, hutZ);
    world.add(hut);
    addBox(hut, 7, 3.4, 6, facadeMat(pick([0xf0d0a0, 0x7a9a8a], cz), cz), 0, 1.7, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.2, 4), mat(0x2f7a4a, 0.9));
    roof.position.y = 4.5;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    hut.add(roof);
    ctx.buildings.push({ x: 122, z: hutZ, hw: 4.1, hd: 3.6, h: 5.6, district: 'marina', kind: 'beach-hut' });
    // Two finger docks reaching into the ocean.
    for (const dz of [-6, 6]) {
      const dock = new THREE.Group();
      dock.position.set(152, 0, cz + dz);
      world.add(dock);
      addBox(dock, 26, 0.4, 3, mat(0x7a5a3a, 0.9), 13, 0.9, 0);
      for (let x = 3; x <= 24; x += 7) {
        for (const z of [-1.2, 1.2]) addBox(dock, 0.4, 1.4, 0.4, mat(0x5a4230), x, 0.1, z, false);
      }
      // Moored sailboat alongside the dock.
      makeBoat(world, 162 + (dz > 0 ? 4 : -2), cz + dz + 4.5, seeded(cz + dz) * Math.PI);
    }
  }
}

/** Simple sailboat: hull + cabin + mast + triangular sail. */
function makeBoat(world, x, z, yaw) {
  const boat = new THREE.Group();
  boat.position.set(x, 0.7, z);
  boat.rotation.y = yaw;
  world.add(boat);
  addBox(boat, 6.5, 1.1, 2.2, mat(0xf0f0e8, 0.5), 0, 0.4, 0);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 4), mat(0xf0f0e8, 0.5));
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(4.3, 0.4, 0);
  bow.scale.set(1, 1, 2);
  boat.add(bow);
  addBox(boat, 2.4, 1.0, 1.6, mat(0x2f788b, 0.6), -0.6, 1.4, 0, false);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), mat(0x5a4230));
  mast.position.set(0.4, 4.6, 0);
  boat.add(mast);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, 5.6);
  shape.lineTo(3.4, 0.4);
  shape.closePath();
  const sail = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: 0xf8f4e8, side: THREE.DoubleSide, roughness: 0.85 }),
  );
  sail.position.set(0.55, 1.8, 0);
  boat.add(sail);
}

/** Industrial port (north-east coast): container yard, cranes, docks, ship. */
function makePort(world, ctx) {
  for (const cz of [-90, -126]) {
    // Container stacks inside the port blocks (solid footprints).
    buildContainerStack(ctx, 120, cz - 6, cz + 3, 3);
    buildContainerStack(ctx, 120, cz + 7, cz + 13, 2);
    buildContainerStack(ctx, 132, cz + 1, cz + 23, 2);
    // Concrete dock reaching into the ocean.
    const dock = new THREE.Mesh(new THREE.BoxGeometry(44, 1.0, 10), mat(0x8a8a86, 0.95));
    dock.position.set(172, 0.4, cz);
    dock.receiveShadow = true;
    dock.castShadow = true;
    world.add(dock);
    // Gantry crane straddling the dock root.
    const crane = new THREE.Group();
    crane.position.set(150, 0, cz);
    world.add(crane);
    const craneMat = mat(0xd9a03a, 0.6, 0.3);
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      addBox(crane, 0.8, 17, 0.8, craneMat, lx, 8.5, lz, false);
    }
    addBox(crane, 12, 1.2, 10, craneMat, 0, 17.5, 0, false);
    addBox(crane, 26, 1.0, 1.6, craneMat, 14, 17.5, 0, false); // jib over the water
    addBox(crane, 0.25, 7, 0.25, mat(0x3b4b52), 24, 13.5, 0, false); // cable
    addBox(crane, 2.2, 1.4, 2.2, mat(0x2c3438), 24, 9.4, 0, false); // hook block
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), mat(0x2c3438, 0.5));
    cab.position.set(-2, 16, 0);
    crane.add(cab);
  }
  // Moored cargo ship between the two docks (in the ocean, unreachable).
  const ship = new THREE.Group();
  ship.position.set(208, 0.4, -108);
  world.add(ship);
  addBox(ship, 44, 4.5, 11, mat(0x2c3438, 0.5, 0.4), 0, 2.2, 0);
  addBox(ship, 44, 1.2, 11.4, mat(0xc65a3a, 0.6), 0, 4.9, 0, false);
  for (let i = 0; i < 4; i += 1) {
    const col = CONTAINER_COLOURS[i % CONTAINER_COLOURS.length];
    const tex = containerTexture(`#${col.toString(16).padStart(6, '0')}`);
    addBox(ship, 6, 2.5, 5, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }),
      -15 + i * 7.5, 6.8, -2.4, false);
    addBox(ship, 6, 2.5, 5, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }),
      -15 + i * 7.5, 6.8, 2.4, false);
  }
  addBox(ship, 6, 7, 8, mat(0xd9d9d2, 0.6), 19, 9, 0, false); // bridge tower
}

/** Striped lighthouse on the northern breakwater. */
function makeLighthouse(world) {
  const rocks = mat(0x6b6f75, 0.95);
  for (let i = 0; i < 7; i += 1) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + seeded(700 + i), 0), rocks);
    rock.position.set(154 + (seeded(710 + i) - 0.5) * 6, 0.4, -146 + i * 2.4);
    rock.castShadow = true;
    world.add(rock);
  }
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.8, 13, 12),
    new THREE.MeshStandardMaterial({ map: lighthouseTexture(), roughness: 0.8 }),
  );
  tower.position.set(156, 6.5, -142);
  tower.castShadow = true;
  world.add(tower);
  addBox(world, 4.6, 1.0, 4.6, mat(0x2c3438), 156, 13.5, -142, false);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6a5 }),
  );
  lamp.position.set(156, 15.2, -142);
  world.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.0, 2.0, 12), mat(0x2c3438, 0.7));
  cap.position.set(156, 17.2, -142);
  world.add(cap);
}

// ------------------------------------------------------------------ vegetation
function makeVegetation(world, ctx) {
  // Palms: beach row, boardwalk edge, marina + park accents.
  for (let z = -148; z <= 148; z += 20) {
    if (Math.abs(z) < 12) continue; // pier approach
    ctx.palmSpots.push([140, z]);
    if (Math.abs(z) > 30) ctx.palmSpots.push([133.5, z + 10]);
  }
  for (let i = 0; i < 6; i += 1) ctx.palmSpots.push([128, 78 + i * 12]);
  for (let i = 0; i < 4; i += 1) ctx.palmSpots.push([128, -78 - i * 12]);

  const dummy = new THREE.Object3D();
  // Palm trunks (instanced) — slight lean, deterministic.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 5.4, 6);
  const trunkMat = mat(0x7a5230, 0.95);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, ctx.palmSpots.length);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 1);
  const crownMat = mat(0x2f7a4a, 0.9);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, ctx.palmSpots.length);
  ctx.palmSpots.forEach(([x, z], i) => {
    const lean = (seeded(800 + i) - 0.5) * 0.14;
    dummy.position.set(x, 2.7, z);
    dummy.rotation.set(lean, seeded(810 + i) * Math.PI, lean * 0.6);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + lean * 8, 5.9, z);
    dummy.rotation.set(0, seeded(820 + i) * Math.PI, 0);
    dummy.scale.set(1, 0.42, 1);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  world.add(trunks);
  world.add(crowns);

  // Broadleaf trees (instanced trunks + crowns) from parks / yards / streets.
  const treeGeo = new THREE.BoxGeometry(0.5, 2.8, 0.5);
  const treeTrunkMat = mat(0x735039, 0.95);
  const treeTrunks = new THREE.InstancedMesh(treeGeo, treeTrunkMat, Math.max(ctx.treeSpots.length, 1));
  const treeCrownGeo = new THREE.IcosahedronGeometry(2.1, 1);
  const treeCrownMat = mat(0x2d694d, 0.9);
  const treeCrowns = new THREE.InstancedMesh(treeCrownGeo, treeCrownMat, Math.max(ctx.treeSpots.length, 1));
  ctx.treeSpots.forEach(([x, z], i) => {
    const s = 0.85 + seeded(900 + i) * 0.5;
    dummy.position.set(x, 1.4 * s, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    treeTrunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, (2.8 + 1.6) * s, z);
    dummy.scale.set(s, s * 0.9, s);
    dummy.updateMatrix();
    treeCrowns.setMatrixAt(i, dummy.matrix);
  });
  treeTrunks.castShadow = true;
  treeCrowns.castShadow = true;
  treeTrunks.instanceMatrix.needsUpdate = true;
  treeCrowns.instanceMatrix.needsUpdate = true;
  world.add(treeTrunks);
  world.add(treeCrowns);
}

// ------------------------------------------------------------------ street furniture
function makeStreetFurniture(world) {
  const dummy = new THREE.Object3D();
  // Street lamps at every intersection corner (instanced: 2 draw calls).
  const lampPositions = [];
  for (let x = -144; x <= 144; x += WORLD.grid) {
    for (let z = -144; z <= 144; z += WORLD.grid) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) lampPositions.push([x + sx * 8.2, z + sz * 8.2]);
      }
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.14, 5, 6);
  const poles = new THREE.InstancedMesh(poleGeo, mat(0x3b4b52), lampPositions.length);
  env.lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a5 });
  const globeGeo = new THREE.SphereGeometry(0.42, 8, 6);
  const globes = new THREE.InstancedMesh(globeGeo, env.lampMat, lampPositions.length);
  lampPositions.forEach(([x, z], i) => {
    dummy.position.set(x, 2.5, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 5.1, z);
    dummy.updateMatrix();
    globes.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  globes.instanceMatrix.needsUpdate = true;
  world.add(poles);
  world.add(globes);

  // Traffic lights at the 12 busiest intersections (downtown / commercial).
  const poleMat = mat(0x2c3438, 0.6, 0.4);
  const headMat = mat(0x1c2126, 0.5, 0.4);
  const redMat = new THREE.MeshBasicMaterial({ color: 0x7a1c1c });
  const amberMat = new THREE.MeshBasicMaterial({ color: 0x7a5c1c });
  const greenMat = new THREE.MeshBasicMaterial({ color: 0x2fd47a });
  const dotGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const intersections = [];
  for (const x of [-72, 0, 72]) {
    for (const z of [-72, 0, 72, 36]) intersections.push([x, z]);
  }
  for (const [ix, iz] of intersections) {
    const g = new THREE.Group();
    g.position.set(ix + 8.2, 0, iz - 8.2);
    world.add(g);
    addBox(g, 0.28, 5.6, 0.28, poleMat, 0, 2.8, 0, false);
    addBox(g, 3.2, 0.28, 0.28, poleMat, -1.5, 5.5, 0, false);
    addBox(g, 0.7, 1.9, 0.6, headMat, -2.9, 5.0, 0, false);
    for (const [dy, m] of [[0.62, redMat], [0, amberMat], [-0.62, greenMat]]) {
      const dot = new THREE.Mesh(dotGeo, m);
      dot.position.set(-2.9, 5.0 + dy, 0.32);
      g.add(dot);
    }
  }

  // Hydrants, bins, benches, bus stops, stop signs.
  const hydrantMat = mat(0xc63a2e, 0.6);
  const binMat = mat(0x2f4a3a, 0.8);
  for (let i = 0; i < 10; i += 1) {
    const hx = -126 + i * 28;
    const hz = (i % 2 === 0 ? -1 : 1) * 108;
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.9, 8), hydrantMat);
    hyd.position.set(hx, 0.45, hz + 8.6);
    hyd.castShadow = true;
    world.add(hyd);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 1.0, 8), binMat);
    bin.position.set(hx + 14, 0.5, -hz - 8.6);
    bin.castShadow = true;
    world.add(bin);
  }
  // Bus stops on the central avenues.
  for (const [bx, bz, ry] of [[-36, 8.6, 0], [36, -8.6, Math.PI], [8.6, -36, Math.PI / 2], [-8.6, 72, -Math.PI / 2]]) {
    const stop = new THREE.Group();
    stop.position.set(bx, 0, bz);
    stop.rotation.y = ry;
    world.add(stop);
    addBox(stop, 0.18, 3.0, 0.18, poleMat, 1.4, 1.5, 0, false);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.9),
      new THREE.MeshBasicMaterial({ map: neonSignTexture('BUS', '#33e0ff', '#0a1a2a'), toneMapped: false }),
    );
    sign.position.set(1.4, 3.1, 0);
    stop.add(sign);
    addBox(stop, 2.2, 0.12, 0.7, mat(0x7a5a3a), 0, 0.55, 0.6, false);
  }
  // Stop signs (red octagons) at 8 minor intersections.
  const stopGeo = new THREE.CircleGeometry(0.55, 8);
  const stopMat = new THREE.MeshBasicMaterial({ color: 0xc63a2e, side: THREE.DoubleSide });
  for (const [sx, sz] of [[-108, -36], [-36, -108], [108, 36], [36, 108], [-108, 108], [108, -108], [-36, 144], [144, -36]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), poleMat);
    post.position.set(sx + 7.6, 1.3, sz + 7.6);
    world.add(post);
    const oct = new THREE.Mesh(stopGeo, stopMat);
    oct.position.set(sx + 7.6, 2.9, sz + 7.6);
    oct.rotation.y = Math.PI / 4;
    world.add(oct);
  }
  // Rooftop / pylon billboards (original copy) at four residential block
  // centres — clear of roads, mission points and ?shot= staging.
  const billboards = [
    { lines: ['SUNCOAST', 'HEATLINE'], bg: '#1c0f2a', fg: '#ff4d8d', x: -126, z: -90 },
    { lines: ['VISIT', 'CORAL SHORE'], bg: '#0a2030', fg: '#33e0ff', x: 90, z: 126 },
    { lines: ['PALM COLA', 'ICE COLD'], bg: '#2a0f1c', fg: '#ffc44d', x: -126, z: 126 },
    { lines: ['DRIVE THE', 'COAST'], bg: '#101a2a', fg: '#a7f36c', x: 54, z: 126 },
  ];
  for (const b of billboards) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = Math.PI / 4;
    world.add(g);
    addBox(g, 0.5, 8, 0.5, poleMat, -3, 4, 0, false);
    addBox(g, 0.5, 8, 0.5, poleMat, 3, 4, 0, false);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 4.5),
      new THREE.MeshBasicMaterial({ map: billboardTexture(b.lines, b.bg, b.fg) }),
    );
    board.position.set(0, 10, 0);
    g.add(board);
  }
}

// ------------------------------------------------------------------ rain / puddles
function makeRain(world) {
  const count = 900;
  const positions = new Float32Array(count * 3);
  env.rainSpeeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 340;
    positions[i * 3 + 1] = Math.random() * 70;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 340;
    env.rainSpeeds[i] = 28 + Math.random() * 14;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  env.rainMat = new THREE.PointsMaterial({
    color: 0xbfd9ff, size: 0.5, transparent: true, opacity: 0, depthWrite: false,
  });
  env.rain = new THREE.Points(geo, env.rainMat);
  env.rain.visible = false;
  world.add(env.rain);

  // Puddles on the roads (visible only when wet).
  env.puddleMat = new THREE.MeshStandardMaterial({
    color: 0x1c2836, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0,
  });
  const puddleGeo = new THREE.CircleGeometry(2.2, 20);
  const spots = [
    [0, 18], [36, -54], [-72, 54], [72, 18], [-36, -90], [108, -36],
    [0, -108], [-108, 0], [72, 90], [-72, -18], [36, 108], [-36, 36],
    [108, 72], [-108, -72],
  ];
  for (const [px, pz] of spots) {
    const p = new THREE.Mesh(puddleGeo, env.puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(1, 0.6, 1);
    p.position.set(px, 0.02, pz);
    world.add(p);
  }
}

// ------------------------------------------------------------------ build
export function buildWorld(scene) {
  env.scene = scene;
  // Discover the lights main.js already added (sun / hemisphere / fill) so
  // setTimeOfDay() can drive them. Absent lights are tolerated (harness).
  scene.traverse((o) => {
    if (o.isDirectionalLight && o.castShadow && !env.sunLight) env.sunLight = o;
    else if (o.isDirectionalLight && !env.fillLight) env.fillLight = o;
    else if (o.isHemisphereLight && !env.hemiLight) env.hemiLight = o;
  });

  const world = new THREE.Group();
  scene.add(world);
  makeSky(scene);
  makeGround(world);
  makeRoads(world);

  const buildings = [];
  const windowTransforms = [];
  const dummy = new THREE.Object3D();
  const ctx = {
    world, buildings, windowTransforms, dummy, treeSpots: [], palmSpots: [],
  };

  for (let gx = -4; gx <= 3; gx += 1) {
    for (let gz = -4; gz <= 3; gz += 1) {
      const cx = gx * WORLD.grid + 18;
      const cz = gz * WORLD.grid + 18;
      if (Math.abs(cx) > 150 || Math.abs(cz) > 150) continue;
      const district = districtFor(gx, gz);
      const seed = (gx + 5) * 19 + (gz + 5) * 31;
      if (district === 'downtown') {
        buildTower(ctx, cx, cz, seed, 'downtown', 30, 64);
        ctx.treeSpots.push([cx - 13, cz + 13], [cx + 13, cz - 13]);
      } else if (district === 'waterfront') {
        buildTower(ctx, cx, cz, seed, 'waterfront', 34, 60);
      } else if (district === 'commercial') {
        // Two shopfronts flanking a back alley (dumpster / crates / AC).
        const oz = (seeded(seed + 41) - 0.5) * 5;
        const s1 = buildShop(ctx, cx, cz, -7, oz, seed, 'commercial', seeded(seed + 51) > 0.45);
        const s2 = buildShop(ctx, cx, cz, 7, -oz, seed + 60, 'commercial', seeded(seed + 71) > 0.55);
        if (s1 && s2) {
          addBox(world, 1.8, 1.3, 1.1, mat(0x2f4a3a, 0.8), cx, 0.65, cz + oz * 0.4, false);
          addBox(world, 1.2, 1.2, 1.2, mat(0x7a5a3a, 0.9), cx - 1, 0.6, cz + oz * 0.4 + 2.2);
          addBox(world, 1.0, 0.8, 1.0, mat(0x8a6a4a, 0.9), cx + 1.2, 0.4, cz + oz * 0.4 - 2);
        }
        ctx.treeSpots.push([cx + 13, cz + 13]);
      } else if (district === 'nightlife') {
        buildShop(ctx, cx, cz, -6.5, 0, seed, 'nightlife', true);
        buildShop(ctx, cx, cz, 6.5, 2, seed + 60, 'nightlife', true);
        // Marquee strip over the main club entrance.
        const mq = new THREE.Mesh(
          new THREE.PlaneGeometry(7, 1.1),
          new THREE.MeshBasicMaterial({ map: neonSignTexture('PALM CLUB', '#33e0ff', '#0a1a2a'), toneMapped: false }),
        );
        mq.position.set(cx - 6.5, 4.4, cz + 6.2);
        world.add(mq);
      } else if (district === 'residential') {
        buildHouse(ctx, cx, cz, -6, -5, seed);
        buildHouse(ctx, cx, cz, 6, 5, seed + 50);
        ctx.treeSpots.push([cx, cz - 12]);
      } else if (district === 'industrial') {
        buildWarehouse(ctx, cx, cz, seed);
      } else if (district === 'yard') {
        buildYard(ctx, cx, cz, seed);
      } else if (district === 'garage') {
        buildGarage(ctx, cx, cz, seed);
      } else if (district === 'gas') {
        buildGasStation(ctx, cx, cz, seed);
      } else if (district === 'park') {
        buildPark(ctx, cx, cz, seed, gx === -2 && gz === 0);
      }
      // 'port' and 'marina' blocks are built by makeCoast() (docks, cranes,
      // container yard, beach clubs) — nothing to do here.
    }
  }

  // One InstancedMesh for every window in the city.
  env.windowMat = new THREE.MeshStandardMaterial({
    color: 0x8fd8e7, emissive: 0x183d4a, roughness: 0.28, metalness: 0.2,
  });
  const windowGeo = new THREE.BoxGeometry(0.82, 1.05, 0.07);
  const windows = new THREE.InstancedMesh(windowGeo, env.windowMat, Math.max(windowTransforms.length, 1));
  windowTransforms.forEach((m, i) => windows.setMatrixAt(i, m));
  windows.instanceMatrix.needsUpdate = true;
  windows.receiveShadow = false;
  world.add(windows);

  const ocean = makeCoast(world, ctx);
  makeVegetation(world, ctx);
  makeStreetFurniture(world);
  makeRain(world);

  return { world, buildings, ocean };
}

// ------------------------------------------------------------------ API contract
// These three helpers are the public contract: main.js, vehicles.js and
// the AI/police module import them from this file. Signatures unchanged
// from the v1 world.js — do not rename, reorder or drop them.

/** True when the point (x, z) with radius r is inside any building footprint. */
export function collidesBuilding(buildings, x, z, r = 0.8) {
  for (const b of buildings) {
    if (Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r) return true;
  }
  return false;
}

/** True when no building blocks the straight line between a and b (2D, sampled). */
export function hasLineOfSight(buildings, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 2));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (collidesBuilding(buildings, ax + dx * t, az + dz * t, 0.4)) return false;
  }
  return true;
}

/** Nearest road centre coordinate (roads run every 36 units, centred on multiples). */
export function nearestRoadCoord(v) {
  return Math.round(v / WORLD.grid) * WORLD.grid;
}

/** Gentle ocean swell + falling rain (when wet). Called every frame by main.js. */
export function animateOcean(ocean, time) {
  const pos = ocean.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.08 + time * 0.9) * 0.2 + Math.cos(y * 0.06 + time * 0.6) * 0.15);
  }
  pos.needsUpdate = true;
  ocean.geometry.computeVertexNormals();

  // Rain falls only while setWet() has it visible; time comes from the same
  // per-frame call, so no extra loop hook is needed in main.js.
  const dt = env.lastRainT < 0 ? 0 : THREE.MathUtils.clamp(time - env.lastRainT, 0, 0.1);
  env.lastRainT = time;
  if (env.rain && env.rain.visible && dt > 0) {
    const rp = env.rain.geometry.attributes.position;
    for (let i = 0; i < rp.count; i += 1) {
      let y = rp.getY(i) - env.rainSpeeds[i] * dt;
      if (y < 0) y = 65 + Math.random() * 5;
      rp.setY(i, y);
    }
    rp.needsUpdate = true;
  }
}

/**
 * Set the time of day (hour 0..24). Interpolates between the DAY_KEYFRAMES
 * in constants.js: sky gradient, sun-disc/moon position, fog, the scene's
 * sun/hemi/fill lights (discovered in buildWorld), lamp glow and window
 * emissive. Default state is sunset (18.7) — the shipped look is unchanged
 * unless the coordinator calls this. Safe to call before buildWorld (no-op).
 */
export function setTimeOfDay(hour) {
  if (!env.skyGeo) return;
  const h = ((hour % 24) + 24) % 24;
  env.timeOfDay = h;
  let a = DAY_KEYFRAMES[0];
  let b = DAY_KEYFRAMES[DAY_KEYFRAMES.length - 1];
  for (let i = 0; i < DAY_KEYFRAMES.length - 1; i += 1) {
    if (h >= DAY_KEYFRAMES[i].hour && h <= DAY_KEYFRAMES[i + 1].hour) {
      a = DAY_KEYFRAMES[i];
      b = DAY_KEYFRAMES[i + 1];
      break;
    }
  }
  const t = THREE.MathUtils.clamp((h - a.hour) / Math.max(b.hour - a.hour, 0.001), 0, 1);
  const lerp = (u, v) => u + (v - u) * t;
  const lerpColor = (u, v) => new THREE.Color(u).lerp(new THREE.Color(v), t);
  const top = lerpColor(a.top, b.top);
  const mid = lerpColor(a.mid, b.mid);
  const horizon = lerpColor(a.horizon, b.horizon);
  const fogC = lerpColor(a.fog, b.fog);
  const sunC = lerpColor(a.sun, b.sun);
  const sunI = lerp(a.sunI, b.sunI);
  const hemiI = lerp(a.hemiI, b.hemiI);
  const lampGlow = lerp(a.lampGlow, b.lampGlow);
  const sx = lerp(a.sunPos[0], b.sunPos[0]);
  const sy = lerp(a.sunPos[1], b.sunPos[1]);

  paintSky(top.getHex(), mid.getHex(), horizon.getHex());
  const isDay = h >= 6 && h <= 19.5;
  env.sunDisc.visible = isDay;
  env.halo.visible = isDay;
  env.sunDisc.position.set(sx, sy, -60);
  env.sunDisc.lookAt(0, 40, 0);
  env.halo.position.set(sx * 1.01, sy, -60);
  env.halo.lookAt(0, 40, 0);
  env.moon.visible = !isDay;

  if (env.scene) {
    if (env.scene.fog) {
      env.scene.fog.color.copy(fogC);
      env.scene.fog.near = 105 - lampGlow * 25;
      env.scene.fog.far = 320 - lampGlow * 40;
    }
    if (env.scene.background && env.scene.background.isColor) {
      env.scene.background.copy(horizon);
    }
  }
  if (env.sunLight) {
    env.sunLight.color.copy(sunC);
    env.sunLight.intensity = sunI;
    env.sunLight.position.set(sx * 0.4, Math.max(sy * 0.45, 40) + 20, 45);
  }
  if (env.hemiLight) env.hemiLight.intensity = hemiI;
  if (env.fillLight) env.fillLight.intensity = hemiI * 0.35;
  if (env.lampMat) env.lampMat.color.copy(new THREE.Color(0x554833).lerp(new THREE.Color(0xffe6a5), lampGlow));
  if (env.windowMat) {
    env.windowMat.emissive.copy(new THREE.Color(0x183d4a).lerp(new THREE.Color(0xffc27a), lampGlow));
    env.windowMat.emissiveIntensity = 0.5 + lampGlow * 2.0;
  }
  if (env.oceanMat) {
    env.oceanMat.color.copy(
      new THREE.Color(0x10283d).lerp(new THREE.Color(COLOURS.ocean), THREE.MathUtils.clamp(sunI / 2.8, 0.15, 1)),
    );
  }
}

/**
 * Set wetness (0 = dry, 1 = soaked). Darkens + glosses the roads and
 * sidewalks, glosses the ocean, fades in the road puddles and starts the
 * rain (visible above 0.25). Safe to call before buildWorld (no-op).
 */
export function setWet(amount) {
  const a = THREE.MathUtils.clamp(amount, 0, 1);
  env.wet = a;
  if (env.roadMat) {
    env.roadMat.roughness = 0.92 - 0.7 * a;
    env.roadMat.color.setScalar(1 - 0.45 * a);
  }
  if (env.roadMatH) {
    env.roadMatH.roughness = 0.92 - 0.7 * a;
    env.roadMatH.color.setScalar(1 - 0.45 * a);
  }
  if (env.sidewalkMat) env.sidewalkMat.roughness = 0.9 - 0.5 * a;
  if (env.oceanMat) env.oceanMat.roughness = 0.25 - 0.13 * a;
  if (env.puddleMat) env.puddleMat.opacity = a * 0.6;
  if (env.rainMat) {
    env.rainMat.opacity = a > 0.25 ? (a - 0.25) * 0.9 : 0;
    if (env.rain) env.rain.visible = env.rainMat.opacity > 0;
  }
}
