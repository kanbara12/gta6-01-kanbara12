// HUD and minimap for SUNCOAST: HEATLINE.
// One clear job: everything drawn over the 3D view — stats, wanted stars,
// mission panel, toasts, health bar and the 2D canvas minimap.

import { clamp } from './config.js';
import { MISSION_POINTS } from './missions.js';

const $ = (id) => document.getElementById(id);

let toastTimer = 0;

export function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = 3.0;
}

export function tickToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
}

export function setHudVisible(visible) {
  $('hud').classList.toggle('hidden', !visible);
}

export function updateHud(G) {
  $('cash').textContent = '$ ' + G.money.toLocaleString('en-US');
  $('speed').textContent = G.currentCar
    ? Math.round(Math.abs(G.currentCar.userData.speed) * 5) + ' KM/H'
    : 'ON FOOT';
  $('weapon').textContent = `${G.weapon.name.toUpperCase()} ${G.weapon.mag}/${G.weapon.reserve === Infinity ? '∞' : G.weapon.reserve}`;
  $('wanted').textContent = '★'.repeat(G.wanted) + '☆'.repeat(5 - G.wanted);
  $('healthText').textContent = Math.max(0, Math.round(G.health)) + '%';
  $('healthFill').style.width = clamp(G.health, 0, 100) + '%';
  $('vehicleHint').textContent = G.currentCar
    ? 'W/S accelerate • A/D steer • E exit'
    : 'E near a vehicle to take it • Click to fire';
  $('crosshair').style.opacity = G.currentCar ? '0' : '.75';
  $('missionTitle').textContent = G.missionTitle;
  $('objective').textContent = G.objectiveText;
  $('audioBtn').textContent = G.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
}

/** 2D top-down minimap: roads, buildings, beach, mission marker, police, player. */
export function drawMinimap(G) {
  const c = $('minimap');
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#142632';
  ctx.fillRect(0, 0, w, h);
  const p = G.actorPosition();
  const scale = 0.42;
  ctx.save();
  ctx.translate(w / 2 - p.x * scale, h / 2 - p.z * scale);
  // Ocean on the east edge.
  ctx.fillStyle = '#1d6f8f';
  ctx.fillRect(152 * scale, -220 * scale, 120 * scale, 440 * scale);
  // Sand strip.
  ctx.fillStyle = '#d9c08a';
  ctx.fillRect(138 * scale, -220 * scale, 14 * scale, 440 * scale);
  ctx.strokeStyle = '#526b76';
  ctx.lineWidth = 5;
  for (let n = -180; n <= 180; n += 36) {
    ctx.beginPath(); ctx.moveTo(n * scale, -220 * scale); ctx.lineTo(n * scale, 220 * scale); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-220 * scale, n * scale); ctx.lineTo(220 * scale, n * scale); ctx.stroke();
  }
  ctx.fillStyle = '#d9c69a';
  for (const b of G.buildings) {
    ctx.fillRect((b.x - b.hw) * scale, (b.z - b.hd) * scale, b.hw * 2 * scale, b.hd * 2 * scale);
  }
  const mp = MISSION_POINTS[clamp(G.missionIndex, 0, MISSION_POINTS.length - 1)];
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(mp.x * scale, mp.z * scale, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff5268';
  for (const car of G.police) {
    ctx.beginPath(); ctx.arc(car.position.x * scale, car.position.z * scale, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#e4faff';
  ctx.beginPath(); ctx.arc(p.x * scale, p.z * scale, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
