// Police helicopter (callsign SKY-1) for SUNCOAST: HEATLINE.
// One clear job: the air unit that joins the chase once the heat is high
// enough — it circles the player, keeps its searchlight cone on them, and
// leaves when the heat dies down. All geometry is procedural (boxes,
// cylinders, cones); no external assets, no network, no real SpotLight
// (the cone + ground pool are additive meshes, so the unit costs no extra
// dynamic light in the forward renderer).
//
// Contract with main.js (see the hook block in the frame loop):
//   G.heli = createHelicopter(scene)        // once, at boot
//   updateHelicopter(G, dt)                 // every frame while playing
//   helicopterState(G)                      // -> {callsign, distanceM, status} | null
//   window.SuncoastAir = helicopterState(G) // the HUD / panel read-out
// The police response panel reads the same state object (callsign SKY-1,
// live distance in metres, status SPOTLIGHT at dusk/night and
// SEARCHLIGHT by day).

import * as THREE from 'three';

export const HELI_CALLSIGN = 'SKY-1';
export const HELI_MIN_WANTED = 3;

// Orbit, sized from the chase camera instead of guessed. The PALMERA
// sedan chases with the lens 4.8 u up and 9.0 u back, aimed at a point
// 1.2 u up — so the lens looks down atan(3.6 / 9.0), about 22°. At
// wanted >= 3 the v4 pursuit framing pulls the lens to ~12.2 u back /
// ~5.4 u up, looks at 1.8 u up and widens the FOV by 5 (top edge near
// +21° above the horizon), so the orbit below fits whole in the frame:
//   far side (in front of the player): atan(8.6 / 58.2) ≈ 8°
//   abeam (to the player's side):     atan(8.6 / 46)   ≈ 11°
//   rotor top, worst wobble abeam:    atan(11.7 / 46)  ≈ 14°
// all inside the +21° top edge. The old orbit (58 m / 18 m) put the
// rotor top near the old +13° edge and it clipped out of the frame
// (frame 3). The unit is also scaled 1.25x so it reads as a helicopter
// instead of a speck. Over downtown the orbit can cross a tower edge
// (towers run 30–64 tall); the unit is small and fast-moving, so the
// pass-through is brief, and the beam + pool stay readable throughout.
const ORBIT_RADIUS = 46;
const ORBIT_HEIGHT = 14;
const ORBIT_SPEED = 0.14; // rad/s around the player
const LEAVE_SECONDS = 3.5;
const CONE_HEIGHT = 30;
const CONE_RADIUS = 6.5;

function mat(color, roughness = 0.55, metalness = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/**
 * Radial white->transparent gradient (128x128). Used as the pool's map:
 * the disc is bright under the beam and fades to nothing at the rim, so
 * no hard edge reads as a dark ring on the road. Local canvas texture —
 * no external asset, no network.
 */
function radialFadeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Vertical alpha gradient for the beam (4x256). ConeGeometry UVs run
 * v=1 at the apex (lamp) to v=0 at the base rim (ground); with the
 * canvas flipped (flipY), the top row is v=1. Alpha is 1 at the lamp,
 * ramping to 0 exactly at the base rim, so the beam dissolves into the
 * pool instead of ending in a bright hard ring on the asphalt.
 */
function beamFadeTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

function addBox(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * Build the helicopter group (hidden until first activation) and add it
 * to the scene. userData carries the rotor groups, the light cone + pool,
 * and the little state machine: 'inactive' | 'active' | 'leaving'.
 */
export function createHelicopter(scene) {
  const g = new THREE.Group();
  const navy = mat(0x172d49, 0.45, 0.5);
  const white = mat(0xe8eef2, 0.4, 0.3);
  const glass = new THREE.MeshStandardMaterial({
    color: 0x274b5c, metalness: 0.45, roughness: 0.12,
    transparent: true, opacity: 0.8,
  });
  const dark = mat(0x14181b, 0.85, 0.1);

  // Fuselage: navy body + white cheatline + glass nose.
  addBox(g, 2.3, 1.5, 4.4, navy, 0, 0, 0);
  addBox(g, 2.34, 0.34, 4.42, white, 0, -0.1, 0);
  addBox(g, 2.0, 1.0, 1.1, glass, 0, 0.25, 2.0);
  // Belly lamp housing (the searchlight source).
  addBox(g, 0.7, 0.3, 0.7, dark, 0, -0.9, 0.9);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2c8 }),
  );
  lamp.position.set(0, -1.05, 0.9);
  g.add(lamp);

  // Tail boom + fin + tail rotor (spins around the boom axis).
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 5.2, 8), navy);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.25, -4.6);
  boom.castShadow = true;
  g.add(boom);
  addBox(g, 0.14, 1.5, 1.1, navy, 0, 0.9, -7.0);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.45, 0.5, -7.0);
  const tailBladeMat = dark;
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.7, 0.12), tailBladeMat);
    b.position.y = s * 0.85;
    tailRotor.add(b);
  }
  g.add(tailRotor);

  // Main rotor: mast + two long blades, spinning around Y.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 8), dark);
  mast.position.set(0, 1.1, 0);
  g.add(mast);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.55, 0);
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 4.6), dark);
    blade.position.z = s * 2.3;
    rotor.add(blade);
  }
  g.add(rotor);

  // Skids.
  for (const s of [-1, 1]) {
    addBox(g, 0.12, 0.12, 3.6, dark, s * 1.05, -1.25, 0);
    addBox(g, 0.1, 0.7, 0.1, dark, s * 1.05, -0.9, 1.1);
    addBox(g, 0.1, 0.7, 0.1, dark, s * 1.05, -0.9, -1.1);
  }

  // v4: 1.25x scale so SKY-1 reads as a helicopter at orbit distance
  // instead of a speck (frame 3). The cone + pool are scene-level, not
  // children of g, so they are unaffected.
  g.scale.setScalar(1.25);

  // Searchlight cone: apex up (+Y), base down. Additive, no depth write,
  // so it reads as light in the air without hiding the street behind it.
  // Re-aimed every frame (apex at the belly lamp, base on the player).
  // v4: both the cone and the ground pool fade to transparent at their
  // edges (gradient alpha) — the old hard-edged pool disc + cone rim
  // read as a sharp DARK RING across the road at dusk (frame 3): the
  // bright disc ended abruptly against dark asphalt, and the contrast
  // at the hard rim looked like a black band. A soft falloff removes
  // the ring without dimming the beam itself.
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c8, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    alphaMap: beamFadeTexture(),
  });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 20, 1, true), coneMat);
  cone.visible = false;
  scene.add(cone);

  // Light pool on the ground under the beam (radial falloff, no hard rim).
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    map: radialFadeTexture(),
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 26), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06;
  pool.visible = false;
  scene.add(pool);

  g.userData = {
    state: 'inactive', angle: 0, fade: 0, leaveT: 0,
    rotor, tailRotor, cone, coneMat, pool, poolMat, lamp,
  };
  g.visible = false;
  scene.add(g);
  return g;
}

/** Dusk or night: the beam reads as a real spotlight. Day: a faint search beam. */
function isDark(G) {
  const t = (G.settings && G.settings.timeOfDay) || 'golden';
  return t === 'dusk' || t === 'night';
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _mid = new THREE.Vector3();

/**
 * Advance the helicopter one frame. Spawns (fading in) the first frame
 * wanted reaches 3, circles the player 18 m up on a 58 m radius, keeps
 * the cone on the player's ground position, and climbs away + fades out
 * when wanted drops below 3 (re-engaging instantly if the heat comes
 * back mid-exit). Never throws when G.heli is missing — a game without
 * the hook still runs.
 */
export function updateHelicopter(G, dt) {
  const heli = G.heli;
  if (!heli) return;
  const u = heli.userData;
  const wanted = G.wanted || 0;
  const p = G.actorPosition();
  const dark = isDark(G);

  if (u.state === 'inactive' && wanted >= HELI_MIN_WANTED) {
    // Spawn above the player, on the orbit circle, facing them.
    u.angle = Math.atan2(p.x - heli.position.x, p.z - heli.position.z);
    u.state = 'active';
    u.fade = 0;
    heli.position.set(p.x + Math.sin(u.angle) * ORBIT_RADIUS, ORBIT_HEIGHT, p.z + Math.cos(u.angle) * ORBIT_RADIUS);
    heli.visible = true;
  }

  if (u.state === 'active') {
    if (wanted < HELI_MIN_WANTED) {
      u.state = 'leaving';
      u.leaveT = 0;
    } else {
      u.fade = Math.min(1, u.fade + dt * 1.2);
      u.angle += dt * ORBIT_SPEED;
      const wobble = Math.sin(performance.now() * 0.0006) * 1.2;
      const tx = p.x + Math.sin(u.angle) * ORBIT_RADIUS;
      const tz = p.z + Math.cos(u.angle) * ORBIT_RADIUS;
      const ty = ORBIT_HEIGHT + wobble;
      // Ease toward the orbit point (never a snap, even after a teleport).
      const k = Math.min(1, dt * 2.2);
      heli.position.x += (tx - heli.position.x) * k;
      heli.position.y += (ty - heli.position.y) * k;
      heli.position.z += (tz - heli.position.z) * k;
      heli.lookAt(p.x, p.y + 1, p.z);
    }
  }

  if (u.state === 'leaving') {
    if (wanted >= HELI_MIN_WANTED) {
      u.state = 'active'; // heat came back: stay on station
    } else {
      u.leaveT += dt;
      u.fade = Math.max(0, u.fade - dt * 0.8);
      heli.position.y += dt * 14; // climb away
      heli.position.x += Math.sin(u.angle) * dt * 10;
      heli.position.z += Math.cos(u.angle) * dt * 10;
      if (u.leaveT >= LEAVE_SECONDS || u.fade <= 0) {
        u.state = 'inactive';
        heli.visible = false;
        u.cone.visible = false;
        u.pool.visible = false;
      }
    }
  }

  // Rotors always spin while the unit is out.
  if (heli.visible) {
    u.rotor.rotation.y += dt * 22;
    u.tailRotor.rotation.x += dt * 30;
  }

  // --- searchlight: apex at the belly lamp, base on the player's ground ---
  const showBeam = heli.visible && u.state !== 'inactive' && u.fade > 0.02;
  u.cone.visible = showBeam;
  u.pool.visible = showBeam;
  if (showBeam) {
    _target.set(p.x, 0, p.z);
    _dir.copy(heli.position).sub(_target);
    const len = _dir.length();
    _dir.normalize();
    // Cone local +Y points from base to apex: align it with heli->target.
    u.cone.quaternion.setFromUnitVectors(_up, _dir);
    _mid.copy(heli.position).add(_target).multiplyScalar(0.5);
    u.cone.position.copy(_mid);
    const s = len / CONE_HEIGHT;
    u.cone.scale.set(s, s, s);
    u.coneMat.opacity = (dark ? 0.42 : 0.16) * u.fade;
    u.pool.position.set(p.x, 0.06, p.z);
    u.poolMat.opacity = (dark ? 0.38 : 0.12) * u.fade;
    // The pool follows the player, not the orbit point — the beam is ON them.
    const poolScale = 0.8 + Math.min(0.5, len / 120);
    u.pool.scale.set(poolScale, poolScale, 1);
  }
}

/**
 * Panel read-out: null when the unit is not on station, otherwise the
 * callsign, the live horizontal distance in metres and the beam status.
 * This is what window.SuncoastAir carries every frame. One label only
 * (the callsign) — the panel renders a single row per unit, so a second
 * unit label would have nowhere to go.
 */
export function helicopterState(G) {
  const heli = G.heli;
  if (!heli || !heli.visible || heli.userData.state !== 'active') return null;
  const p = G.actorPosition();
  return {
    callsign: HELI_CALLSIGN,
    distanceM: Math.round(Math.hypot(heli.position.x - p.x, heli.position.z - p.z)),
    status: isDark(G) ? 'SPOTLIGHT' : 'SEARCHLIGHT',
  };
}
