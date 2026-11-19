// Save / load for SUNCOAST: HEATLINE.
// One clear job: persist the run to localStorage and restore it. The save now
// also records whether the player was driving and which car, so loading while
// driving no longer drops the player on foot (a prototype gap).

import { clamp } from '../core/config.js';

export const SAVE_KEY = 'suncoast_heatline_save';

export function saveGame(G) {
  const inCar = G.currentCar !== null;
  const data = {
    x: G.player.position.x,
    z: G.player.position.z,
    carX: G.playerCar.position.x,
    carZ: G.playerCar.position.z,
    carRot: G.playerCar.rotation.y,
    driving: inCar,
    drivingCar: inCar ? (G.currentCar === G.playerCar ? 'player' : 'traffic') : null,
    drivingX: inCar ? G.currentCar.position.x : 0,
    drivingZ: inCar ? G.currentCar.position.z : 0,
    drivingRot: inCar ? G.currentCar.rotation.y : 0,
    money: G.money,
    health: G.health,
    wanted: G.wanted,
    missionIndex: G.missionIndex,
    kills: G.kills,
    weapon: G.weapon.id,
    ammoMag: G.weapon.mag,
    // v3: the 8-stage chain (0..7) + the shotgun's reserve, so a save made
    // on stage 6-7 or with a half-spent shotgun loads back exactly.
    hasShotgun: !!G.hasShotgun,
    shotgunReserve: G._shotgunReserve ?? 24,
    shotgunMag: G._shotgunMag ?? 6,
    // v3 fix (D-QA05): the SMG's ownership + ammo, and the bat flag, so a
    // save made while the pistol is out still loads the SMG back. The live
    // weapon's mag/reserve win when the SMG is the active weapon.
    hasSmg: !!G.hasSmg,
    smgReserve: G.weapon.id === 'smg' ? G.weapon.reserve : (G._smgReserve ?? 120),
    smgMag: G.weapon.id === 'smg' ? G.weapon.mag : (G._smgMag ?? 30),
    hasBat: !!G.hasBat,
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  G.showToast('GAME SAVED LOCALLY');
}

export function loadGame(G) {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) { G.showToast('NO SAVE FILE FOUND'); return false; }
  try {
    const d = JSON.parse(raw);
    G.player.position.set(d.x ?? -5, 0, d.z ?? 0);
    G.playerCar.position.set(d.carX ?? 4, 0, d.carZ ?? 2);
    G.playerCar.rotation.y = d.carRot ?? 0;
    G.money = d.money ?? 1250;
    G.health = d.health ?? 100;
    G.wanted = d.wanted ?? 0;
    G.missionIndex = clamp(d.missionIndex ?? 0, 0, 7);
    G.kills = d.kills ?? 0;
    // Shotgun ownership + reserve restore before the weapon is selected,
    // so a saved shotgun comes back with its real ammo, not a fresh 24 —
    // and a save that never had the shotgun cannot smuggle one in.
    G.hasShotgun = !!d.hasShotgun;
    G._shotgunReserve = d.shotgunReserve ?? 24;
    G._shotgunMag = d.shotgunMag ?? 6;
    if (d.weapon === 'shotgun' && !G.hasShotgun) d.weapon = 'pistol';
    // SMG ownership + ammo restore before the weapon is selected, mirroring
    // the shotgun above — a saved SMG comes back even when the pistol was
    // the active weapon at save time, and an old save without the flag
    // cannot smuggle an SMG in.
    G.hasSmg = !!d.hasSmg;
    G._smgReserve = d.smgReserve ?? 120;
    G._smgMag = d.smgMag ?? 30;
    G.hasBat = d.hasBat !== undefined ? !!d.hasBat : true;
    if (d.weapon === 'smg' && !G.hasSmg) d.weapon = 'pistol';
    if (d.weapon) G.selectWeapon(d.weapon, d.ammoMag);
    if (d.driving && d.drivingCar === 'player') {
      G.currentCar = G.playerCar;
      G.player.visible = false;
    } else if (d.driving && d.drivingCar === 'traffic') {
      // Re-enter the nearest traffic car to the saved driving position.
      let nearest = null;
      let best = Infinity;
      for (const c of G.traffic) {
        const dist = Math.hypot(c.position.x - (d.drivingX ?? 0), c.position.z - (d.drivingZ ?? 0));
        if (dist < best) { best = dist; nearest = c; }
      }
      if (nearest) {
        G.currentCar = nearest;
        G.player.visible = false;
      }
    }
    G.placeMarker();
    G.showToast('SAVE RESTORED');
    return true;
  } catch {
    G.showToast('SAVE FILE COULD NOT BE READ');
    return false;
  }
}
