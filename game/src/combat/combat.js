// Combat for SUNCOAST: HEATLINE.
// One clear job: shooting — fire, reload, and bullet flight with hit
// detection — callable from main.js with the same G state shape.
//
// DROP-IN REPLACEMENT for the combat section of main.js (see
// INTEGRATION.md for the exact swap). WEAPONS and the G.weapon shape are
// unchanged (pistol/smg, magSize, fireRate, damage, bulletSpeed; mag and
// reserve on the instance), so saves, HUD and weapon switching keep
// working untouched.
//
// What this module ADDS on top of main.js:
// - Swept-segment hit detection: a bullet is tested as the segment from
//   its previous position to its new one against each enemy's hit sphere,
//   so a fast SMG round (60 u/s) can no longer tunnel through a target
//   between frames. The old per-frame point test is kept as a fallback
//   inside the same segment test (zero-length segment = point).
// - Building-blocked bullets: a round that enters a building footprint
//   dies there instead of flying through walls and hitting someone on the
//   far side. Uses collidesBuilding from world.js (G.buildings).
// - Spread + bloom + recoil: each shot adds a small random cone
//   (pistol tighter than SMG) that grows with sustained fire and decays
//   when the player stops; G.recoil holds the current kick for the
//   camera/HUD to read (it decays in updateBullets; it does not move the
//   camera by itself — main.js owns the camera).
// - Timed reload: R starts a real reload (pistol 0.9 s, SMG 1.4 s) during
//   which fire() is blocked; the reload completes inside updateBullets,
//   which main.js already calls every frame. Reserve rules are identical
//   to before (pistol reserve Infinity, SMG reserve 120). Firing on an
//   empty magazine still auto-starts a reload.
// - Hit feedback: a live hit sets e.userData.stagger = 0.3 s (read by a
//   future enemies pass; characters.js currently ignores it — honest
//   note, not a silent behaviour change) and a kill still pays +$150,
//   increments G.kills, toasts and chimes exactly as before.
//
// G contract (everything already exists on main.js's G, plus two hook
// fields the coordinator adds — see INTEGRATION.md):
//   G.scene, G.buildings, G.enemies, G.bullets, G.weapon, G.lastShotAt,
//   G.currentCar, G.input.cameraYaw, G.actorPosition(), G.audio,
//   G.showToast, G.triggerWanted(n), G.updateHud(), G.gameStarted,
//   G.gameOver, G.money, G.kills, G.reloading, G.reloadTimer,
//   G.recoil, G._bloom (last three are owned by this module).

import * as THREE from 'three';
import { collidesBuilding } from '../world/world.js';

/** Weapon definitions — identical values to main.js. Do not retune here. */
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'Pistol', magSize: 12, fireRate: 0.28, damage: 1, bulletSpeed: 48 },
  smg: { id: 'smg', name: 'SMG', magSize: 30, fireRate: 0.09, damage: 1, bulletSpeed: 60 },
};

/** Seconds a reload takes, per weapon id. */
export const RELOAD_TIME = { pistol: 0.9, smg: 1.4 };

/** Base spread (radians) per weapon id; bloom adds up to BLOOM_MAX. */
export const SPREAD = { pistol: 0.015, smg: 0.03 };
export const BLOOM_PER_SHOT = { pistol: 0.006, smg: 0.009 };
export const BLOOM_MAX = 0.06;
export const BLOOM_DECAY_PER_SECOND = 0.05;
export const RECOIL_PER_SHOT = { pistol: 0.011, smg: 0.006 };

export const BULLET_LIFE = 1.7;
export const BULLET_MAX_RANGE = 400;
export const ENEMY_HIT_RADIUS = 1.1;

function notifyHud(G, hooks) {
  if (typeof G.updateHud === 'function') G.updateHud();
  else if (hooks && typeof hooks.onHud === 'function') hooks.onHud();
}

function notifyWanted(G, hooks, n) {
  if (typeof G.triggerWanted === 'function') G.triggerWanted(n);
  else if (hooks && typeof hooks.onWanted === 'function') hooks.onWanted(n);
}

/**
 * Fire one round. Returns true when a round left the barrel.
 * Guards: game not started / over, reloading, fire-rate gate, empty mag
 * (auto-starts a reload, returns false). Mirrors main.js fire() exactly
 * for origin, aim, tracer mesh, gunfire event and wanted heat.
 */
export function fire(G, hooks = {}) {
  if (!G.gameStarted || G.gameOver) return false;
  if (G.reloading) return false;
  const now = performance.now();
  if (now - (G.lastShotAt || 0) < G.weapon.fireRate * 1000) return false;
  if (G.weapon.mag <= 0) {
    reloadWeapon(G, hooks);
    return false;
  }
  G.lastShotAt = now;
  G.weapon.mag -= 1;
  const origin = G.actorPosition().clone();
  origin.y += G.currentCar ? 1.25 : 1.65;
  const aimYaw = G.currentCar ? G.currentCar.rotation.y : G.input.cameraYaw;
  // Spread: base cone + accumulated bloom from sustained fire.
  const bloom = Math.min(G._bloom || 0, BLOOM_MAX);
  const spread = (SPREAD[G.weapon.id] ?? 0.02) + bloom;
  const yaw = aimYaw + (Math.random() * 2 - 1) * spread;
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  G._bloom = Math.min((G._bloom || 0) + (BLOOM_PER_SHOT[G.weapon.id] ?? 0.006), BLOOM_MAX);
  G.recoil = (G.recoil || 0) + (RECOIL_PER_SHOT[G.weapon.id] ?? 0.008);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd36b }),
  );
  mesh.position.copy(origin).addScaledVector(dir, 1.2);
  G.scene.add(mesh);
  G.bullets.push({
    mesh, dir, life: BULLET_LIFE, speed: G.weapon.bulletSpeed,
    damage: G.weapon.damage, prev: mesh.position.clone(),
  });
  G.audio.ensure();
  G.audio.gunshot();
  G.gunfireEvent = { x: origin.x, z: origin.z };
  notifyWanted(G, hooks, 1);
  notifyHud(G, hooks);
  return true;
}

/**
 * Start a timed reload. Returns false when there is nothing to reload
 * (magazine full, already reloading, or SMG reserve empty). The reload
 * completes inside updateBullets(); the reserve bookkeeping is identical
 * to the old instant reload.
 */
export function reloadWeapon(G, hooks = {}) {
  const w = G.weapon;
  if (!w || w.mag === w.magSize) return false;
  if (G.reloading) return false;
  if (w.reserve !== Infinity && w.reserve <= 0) return false;
  G.reloading = true;
  G.reloadTimer = RELOAD_TIME[w.id] ?? 1.0;
  if (G.audio) G.audio.click();
  notifyHud(G, hooks);
  return true;
}

/** Apply a finished reload to the magazine / reserve. Shared by updateBullets. */
export function completeReload(G) {
  const w = G.weapon;
  if (w.reserve === Infinity) {
    w.mag = w.magSize;
  } else {
    const need = w.magSize - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
  G.reloading = false;
  G.reloadTimer = 0;
}

/**
 * Segment-sphere test: does the segment a->b pass within `radius` of
 * `center`? Pure function, exported for the harness. A zero-length
 * segment degrades to the old point-distance test.
 */
export function segmentHitsSphere(a, b, center, radius) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lenSq > 0) {
    t = ((center.x - a.x) * abx + (center.y - a.y) * aby + (center.z - a.z) * abz) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  const cz = a.z + abz * t;
  const dx = center.x - cx;
  const dy = center.y - cy;
  const dz = center.z - cz;
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

const _tmpV = new THREE.Vector3();

/**
 * Advance all bullets one frame: flight, building block, swept hit
 * detection against live enemies, expiry. Also completes a pending timed
 * reload and decays bloom / recoil. Call every frame (main.js already does).
 */
export function updateBullets(G, dt) {
  if (G.reloading) {
    G.reloadTimer = (G.reloadTimer || 0) - dt;
    if (G.reloadTimer <= 0) {
      completeReload(G);
      notifyHud(G);
    }
  }
  if (G._bloom) G._bloom = Math.max(0, G._bloom - BLOOM_DECAY_PER_SECOND * dt);
  if (G.recoil) G.recoil *= Math.pow(0.02, dt); // fast exponential decay

  for (let i = G.bullets.length - 1; i >= 0; i -= 1) {
    const b = G.bullets[i];
    b.life -= dt;
    b.prev.copy(b.mesh.position);
    b.mesh.position.addScaledVector(b.dir, b.speed * dt);
    let hit = false;
    // Building block: a round that enters a footprint dies there.
    if (G.buildings && collidesBuilding(G.buildings, b.mesh.position.x, b.mesh.position.z, 0.2)) {
      hit = true;
    } else {
      for (const e of G.enemies) {
        if (!e.userData.alive) continue;
        _tmpV.copy(e.position);
        _tmpV.y += 1;
        if (segmentHitsSphere(b.prev, b.mesh.position, _tmpV, ENEMY_HIT_RADIUS)) {
          e.userData.health -= b.damage;
          e.userData.stagger = 0.3; // read by a future enemies pass
          hit = true;
          if (e.userData.health <= 0) {
            e.userData.alive = false;
            e.visible = false;
            G.kills += 1;
            G.money += 150;
            G.showToast('TARGET DOWN • +$150');
            G.audio.chime();
          }
          break;
        }
      }
    }
    if (hit || b.life <= 0 || b.mesh.position.length() > BULLET_MAX_RANGE) {
      if (G.scene) G.scene.remove(b.mesh);
      else if (typeof b.mesh.removeFromParent === 'function') b.mesh.removeFromParent();
      G.bullets.splice(i, 1);
    }
  }
}
