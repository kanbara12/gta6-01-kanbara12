// HUD and minimap for SUNCOAST: HEATLINE.
// One clear job: everything drawn over the 3D view — stats, wanted stars,
// mission panel, toasts, health + armor bars, the big speedometer and the
// 2D canvas minimap. Commercial layout, sunset-coastal direction:
// mission top-left, cash + wanted top-right, vitals bottom-left, minimap
// mid-left, speed bottom-right — dense, readable, never covering the road
// ahead. Signatures used by main.js are frozen: updateHud(G),
// drawMinimap(G), showToast, tickToast, setHudVisible.

import { clamp } from '../core/config.js';
import { MISSION_POINTS, GANG_ZONE } from '../missions/missions.js';

const $ = (id) => document.getElementById(id);

// Wall-clock deadline (performance.now, ms) for the visible toast.
// D-QA6: the old timer ran on game dt (clamped 0.04 s/frame), so a 3 s
// toast could stay up for minutes of wall time whenever frames were slow —
// and every new toast silently re-armed it. Wall time dismisses in ~3.5 s
// no matter the frame rate; tickToast() is still called every frame by
// main.js, it just checks the wall clock now instead of consuming dt.
let toastDeadline = 0;

// Last rendered wanted level (updateHud rebuilds the stars only on change).
let lastWanted = -1;

/** District name for a world position, shown under the minimap. */
export function districtFor(x, z) {
  if (x >= 138) return 'CORAL SHORE — BEACH';
  if (x >= 100) return 'WATERFRONT';
  if (Math.hypot(x - GANG_ZONE.x, z - GANG_ZONE.z) < 26) return 'CREW YARD';
  if (Math.abs(x) <= 36 && Math.abs(z) <= 36) return 'DOWNTOWN';
  if (z <= -108) return 'NORTHSIDE';
  if (z >= 108) return 'SOUTHSIDE';
  if (x <= -108) return 'WEST END';
  return 'SUNCOAST DISTRICT';
}

export function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastDeadline = performance.now() + 3500;
}

export function tickToast() {
  if (toastDeadline && performance.now() >= toastDeadline) {
    toastDeadline = 0;
    $('toast').classList.remove('show');
  }
}

export function setHudVisible(visible) {
  $('hud').classList.toggle('hidden', !visible);
}

export function updateHud(G) {
  const health = Math.max(0, Math.round(G.health));
  const armor = Math.max(0, Math.round(G.armor || 0));
  $('cash').textContent = '$ ' + G.money.toLocaleString('en-US');
  const kmh = G.currentCar ? Math.round(Math.abs(G.currentCar.userData.speed) * 5) : 0;
  $('speed').textContent = G.currentCar ? kmh + ' KM/H' : 'ON FOOT';
  $('weapon').textContent = `${G.weapon.name.toUpperCase()} ${G.weapon.mag}/${G.weapon.reserve === Infinity ? '∞' : G.weapon.reserve}`;
  // D-QA8: the old `.hot` class coloured the whole row red, so even the
  // empty stars read red. Only the filled stars go red (with the glow);
  // empty stars stay dim grey, so ★★★☆☆ reads at a glance. The row keeps
  // its `hot` class for the blink animation; the spans' own colours win
  // over the inherited row colour. Rebuilt only when the level changes.
  const wantedEl = $('wanted');
  if (G.wanted !== lastWanted) {
    lastWanted = G.wanted;
    wantedEl.textContent = '';
    if (G.wanted > 0) {
      const on = document.createElement('span');
      on.textContent = '★'.repeat(G.wanted);
      on.style.color = '#ff5268';
      on.style.textShadow = '0 0 12px rgba(255,82,104,.8)';
      wantedEl.appendChild(on);
    }
    const off = document.createElement('span');
    off.textContent = '☆'.repeat(5 - G.wanted);
    off.style.color = 'rgba(238,248,255,0.35)';
    off.style.textShadow = 'none';
    wantedEl.appendChild(off);
  }
  wantedEl.classList.toggle('hot', G.wanted > 0);
  $('healthText').textContent = health + '%';
  const healthFill = $('healthFill');
  healthFill.style.width = clamp(G.health, 0, 100) + '%';
  healthFill.classList.toggle('low', health <= 30);
  healthFill.classList.toggle('mid', health > 30 && health <= 60);
  $('armorText').textContent = armor + '%';
  $('armorFill').style.width = clamp(armor, 0, 100) + '%';
  $('armorRow').style.display = armor > 0 ? '' : 'none';
  $('vehicleHint').textContent = G.currentCar
    ? 'W/S accelerate • A/D steer • E exit'
    : 'E near a vehicle to take it • Click to fire';
  // Interaction prompt: contextual, next to the crosshair.
  const prompt = $('prompt');
  if (prompt) {
    if (!G.currentCar && G.gameStarted && !G.gameOver) {
      prompt.textContent = 'E — ENTER VEHICLE';
      prompt.classList.add('show');
    } else {
      prompt.classList.remove('show');
    }
  }
  $('crosshair').style.opacity = G.currentCar ? '0' : '.75';
  $('missionTitle').textContent = G.missionTitle;
  $('objective').textContent = G.objectiveText;
  $('missionStage').textContent = 'MISSION ' + (clamp(G.missionIndex, 0, 5) + 1) + '/6';
  $('audioBtn').textContent = G.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
  // Big speedometer, only while driving.
  const speedo = $('speedo');
  if (G.currentCar) {
    speedo.classList.remove('hidden');
    $('speedoNum').textContent = kmh;
    $('speedoVehicle').textContent = 'VENTO STRADA';
  } else {
    speedo.classList.add('hidden');
  }
  // District label under the minimap.
  const p = G.actorPosition();
  $('mapLabel').textContent = districtFor(p.x, p.z);
  // FPS readout (measured, never a claim).
  if (G.fps !== undefined) $('fps').textContent = G.fps + ' FPS';
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
  // Mission marker, gently pulsing so it reads at a glance.
  const mp = MISSION_POINTS[clamp(G.missionIndex, 0, MISSION_POINTS.length - 1)];
  const pulse = 4.5 + Math.sin(performance.now() / 280) * 1.6;
  ctx.fillStyle = 'rgba(255,209,102,0.35)';
  ctx.beginPath(); ctx.arc(mp.x * scale, mp.z * scale, pulse + 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(mp.x * scale, mp.z * scale, pulse, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff5268';
  for (const car of G.police) {
    ctx.beginPath(); ctx.arc(car.position.x * scale, car.position.z * scale, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Player arrow, rotated to the facing yaw.
  const yaw = G.currentCar ? G.currentCar.rotation.y : G.player.rotation.y;
  ctx.save();
  ctx.translate(p.x * scale, p.z * scale);
  // Canvas rotate() is clockwise on screen (y down); the arrow is drawn
  // pointing up (-z = north), so the facing rotation is PI - yaw.
  ctx.rotate(Math.PI - yaw);
  ctx.fillStyle = '#e4faff';
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  // North tick, fixed to the frame.
  ctx.fillStyle = '#9fb7c7';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', w / 2, 11);
}
