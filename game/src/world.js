// World construction for SUNCOAST: HEATLINE.
// One clear job: build the static city — blocks, roads, parks, the coastline
// (beach, ocean, pier, waterfront district), sky and lights — and answer the
// collision / line-of-sight questions the actors need.
//
// Performance: building windows are ONE InstancedMesh (thousands of separate
// meshes in the prototype became a single draw call), and the shadow camera
// covers the whole city including the coast.

import * as THREE from 'three';
import { WORLD, COLOURS, seeded } from './config.js';

const buildingMats = [0xc8b59a, 0x8da3a7, 0xb2a39a, 0x687d88, 0xd0c8b2, 0x9dada6];

function mat(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addBox(parent, w, h, d, material, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makeTree(parent, x, z) {
  addBox(parent, 0.55, 3, 0.55, mat(0x735039), x, 1.5, z);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), mat(0x2d694d));
  crown.position.set(x, 4, z); crown.castShadow = true;
  parent.add(crown);
}

/** Gradient sky dome (cheap shader-free vertex-coloured sphere, BackSide). */
function makeSky(scene) {
  const geo = new THREE.SphereGeometry(420, 24, 12);
  const top = new THREE.Color(COLOURS.skyTop);
  const horizon = new THREE.Color(COLOURS.skyHorizon);
  const colours = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 420, 0, 1);
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    colours.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  }));
  scene.add(sky);
  // Low sun disc with a soft radial glow (canvas-generated, data-free),
  // so the edge fades out instead of cutting a hard white disc against
  // the waterfront towers (QA defect D7).
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,242,200,1)');
  grad.addColorStop(0.45, 'rgba(255,236,180,0.85)');
  grad.addColorStop(1, 'rgba(255,236,180,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 256, 256);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(16, 32),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(glowCanvas), transparent: true, fog: false, depthWrite: false,
    }),
  );
  sunDisc.position.set(-260, 150, -180);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);
}

/** Ocean plane + animated shore foam strip + sand beach + boardwalk + pier. */
function makeCoast(world) {
  // Sand beach: the strip between the last city block and the water.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(16, 360), mat(COLOURS.sand, 0.95));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(WORLD.coastX + 6, -0.05, 0);
  sand.receiveShadow = true;
  world.add(sand);
  // Boardwalk along the beach edge.
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(5, 330), mat(COLOURS.boardwalk, 0.9));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(WORLD.coastX - 3, 0.01, 0);
  walk.receiveShadow = true;
  world.add(walk);
  // Ocean: two-tone, gently animated by the main loop (see animateOcean).
  const oceanGeo = new THREE.PlaneGeometry(WORLD.oceanFar - WORLD.oceanX, 420, 24, 24);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: COLOURS.ocean, roughness: 0.25, metalness: 0.35,
    transparent: true, opacity: 0.94,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  // Base height 0.6 keeps even the wave troughs above the sand (-0.05) and
  // the grass ground (-0.16), so no green shows through the water.
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
  // End platform with a small kiosk hut.
  addBox(pier, 10, 0.5, 12, mat(0x7a5a3a, 0.9), 47, 0.9, 0);
  addBox(pier, 5, 3.4, 4.5, mat(0x2f788b, 0.7), 47, 2.6, 0);
  world.add(pier);
  // Beach umbrellas + towels for a lived-in shore.
  const umbrellaMat = mat(0xe2725b, 0.7);
  for (const [ux, uz] of [[146, -40], [143, 18], [147, 62], [144, -88], [146, 108]]) {
    addBox(world, 0.18, 2.6, 0.18, mat(0x6b5a48), ux, 1.3, uz, false);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8), umbrellaMat);
    canopy.position.set(ux, 3, uz); canopy.castShadow = true;
    world.add(canopy);
  }
  return ocean;
}

export function buildWorld(scene) {
  const world = new THREE.Group();
  scene.add(world);
  makeSky(scene);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), mat(COLOURS.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.16;
  ground.receiveShadow = true;
  world.add(ground);

  const buildings = [];
  const windowTransforms = [];
  const windowGeo = new THREE.BoxGeometry(0.82, 1.05, 0.07);
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x8fd8e7, emissive: 0x183d4a, roughness: 0.28, metalness: 0.2,
  });

  const roadMat = mat(COLOURS.road);
  const lineMat = mat(0xe8d7a5);
  const dummy = new THREE.Object3D();

  for (let gx = -4; gx <= 3; gx += 1) {
    for (let gz = -4; gz <= 3; gz += 1) {
      const cx = gx * WORLD.grid + 18;
      const cz = gz * WORLD.grid + 18;
      if (Math.abs(cx) > 150 || Math.abs(cz) > 150) continue;
      // The east column (gx === 3) is the waterfront district: no inland blocks,
      // the beach and ocean take over past x = 138.
      if (gx === 3) continue;
      const park = (Math.abs(gx) === 3 && Math.abs(gz) === 2) || (gx === -2 && gz === 3);
      if (park) {
        const patch = new THREE.Mesh(new THREE.PlaneGeometry(21, 21), mat(COLOURS.grass));
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(cx, 0, cz);
        patch.receiveShadow = true;
        world.add(patch);
        for (let t = 0; t < 9; t += 1) {
          makeTree(world, cx + (seeded(gx * 31 + gz * 7 + t) - 0.5) * 16, cz + (seeded(gx * 17 + gz * 13 + t * 3) - 0.5) * 16);
        }
        continue;
      }
      const seed = (gx + 5) * 19 + (gz + 5) * 31;
      const count = 1 + Math.floor(seeded(seed) * 2);
      for (let i = 0; i < count; i += 1) {
        const w = 7 + seeded(seed + i + 1) * 5;
        const d = 7 + seeded(seed + i + 5) * 5;
        const tall = seeded(seed + i + 2) > 0.72;
        const h = 10 + seeded(seed + i + 3) * (tall ? 34 : 17);
        const ox = (seeded(seed + i + 11) - 0.5) * 18;
        const oz = (seeded(seed + i + 13) - 0.5) * 18;
        const x = cx + ox;
        const z = cz + oz;
        const building = new THREE.Group();
        building.position.set(x, 0, z);
        world.add(building);
        const bodyMat = mat(buildingMats[Math.floor(seeded(seed + i + 8) * buildingMats.length)]);
        addBox(building, w, h, d, bodyMat, 0, h / 2, 0);
        addBox(building, w + 0.25, 0.45, d + 0.25, mat(0x4d5960), 0, h + 0.2, 0, false);
        // Windows as instanced transforms (one draw call for the whole city).
        const rows = Math.min(6, Math.floor(h / 3.6));
        const cols = Math.floor(w / 3.0);
        for (let row = 1; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const wx = -w / 2 + 1.4 + col * 3.0;
            const wy = row * 3.0;
            dummy.position.set(x + wx, wy, z + d / 2 + 0.045);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            windowTransforms.push(dummy.matrix.clone());
            if (col % 2 === 0) {
              dummy.position.set(x + wx, wy, z - d / 2 - 0.045);
              dummy.rotation.set(0, Math.PI, 0);
              dummy.updateMatrix();
              windowTransforms.push(dummy.matrix.clone());
            }
          }
        }
        buildings.push({ x, z, hw: w / 2 + 0.6, hd: d / 2 + 0.6, h });
      }
    }
  }

  // Waterfront district: taller glass towers along the beach (x ~ 108..132).
  for (let i = 0; i < 5; i += 1) {
    const z = -108 + i * 54;
    const w = 12 + seeded(900 + i) * 4;
    const d = 12 + seeded(910 + i) * 4;
    const h = 34 + seeded(920 + i) * 26;
    const x = 118 + seeded(930 + i) * 10;
    const tower = new THREE.Group();
    tower.position.set(x, 0, z);
    world.add(tower);
    addBox(tower, w, h, d, new THREE.MeshStandardMaterial({
      color: 0x5d7d8c, roughness: 0.18, metalness: 0.55,
    }), 0, h / 2, 0);
    addBox(tower, w + 0.3, 0.6, d + 0.3, mat(0x2c3e46), 0, h + 0.3, 0, false);
    const rows = Math.min(9, Math.floor(h / 3.6));
    const cols = Math.floor(w / 3.0);
    for (let row = 1; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const wx = -w / 2 + 1.4 + col * 3.0;
        dummy.position.set(x + wx, row * 3.0, z + d / 2 + 0.045);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        windowTransforms.push(dummy.matrix.clone());
      }
    }
    buildings.push({ x, z, hw: w / 2 + 0.6, hd: d / 2 + 0.6, h });
  }

  // One InstancedMesh for every window in the city.
  const windows = new THREE.InstancedMesh(windowGeo, windowMat, windowTransforms.length);
  windowTransforms.forEach((m, i) => windows.setMatrixAt(i, m));
  windows.instanceMatrix.needsUpdate = true;
  windows.receiveShadow = false;
  world.add(windows);

  // Roads: vertical + horizontal avenues every 36 units.
  for (let road = -144; road <= 144; road += WORLD.grid) {
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(13, 330), roadMat);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(road, 0.005, 0);
    vertical.receiveShadow = true;
    world.add(vertical);
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(330, 13), roadMat);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, 0.006, road);
    horizontal.receiveShadow = true;
    world.add(horizontal);
    for (let n = -4; n <= 4; n += 1) {
      addBox(world, 0.18, 0.025, 2.4, lineMat, road, 0.03, n * 36 + 17, false);
      addBox(world, 2.4, 0.025, 0.18, lineMat, n * 36 + 17, 0.03, road, false);
    }
  }

  // Street lamps at every intersection corner.
  for (let x = -144; x <= 144; x += WORLD.grid) {
    for (let z = -144; z <= 144; z += WORLD.grid) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = x + sx * 8.2;
          const lz = z + sz * 8.2;
          addBox(world, 0.22, 5, 0.22, mat(0x3b4b52), lx, 2.5, lz, false);
          const lamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.42, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffe6a5 }),
          );
          lamp.position.set(lx, 5.1, lz);
          world.add(lamp);
        }
      }
    }
  }

  const ocean = makeCoast(world);
  return { world, buildings, ocean };
}

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

/** Gentle ocean swell: displace the water plane's vertices with a travelling sine. */
export function animateOcean(ocean, time) {
  const pos = ocean.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.08 + time * 0.9) * 0.2 + Math.cos(y * 0.06 + time * 0.6) * 0.15);
  }
  pos.needsUpdate = true;
  ocean.geometry.computeVertexNormals();
}
