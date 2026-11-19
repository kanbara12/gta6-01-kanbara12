// Title screen + pause menu for SUNCOAST: HEATLINE.
// One clear job: the two overlays that are not the in-game HUD — the
// title card (logo, New Game / Continue / Controls) and the pause menu
// (story progress, run stats, save / load / settings / sound /
// fullscreen). The pause menu freezes the simulation by parking the
// game in its game-over branch (G.gameOver = true with our own _paused
// flag); resuming clears both. A real bust (health 0, gameOver without
// _paused) never opens the menu. Save / load / sound / settings /
// fullscreen buttons keep their original ids, so main.js and the
// settings wiring in index.html keep working unchanged — the buttons
// simply live in the pause menu now instead of on the gameplay frame.

import { SAVE_KEY } from '../save/save.js';
import { getRunStats } from './hud.js';

const $ = (id) => document.getElementById(id);
const game = () => window.__game || null;

// ---------------------------------------------------------------- title
/** Continue is only offered when a save actually exists. */
function refreshContinue() {
  const btn = $('continueBtn');
  if (!btn) return;
  let has = false;
  try { has = !!localStorage.getItem(SAVE_KEY); } catch { /* storage blocked */ }
  btn.disabled = !has;
}

$('controlsBtn')?.addEventListener('click', () => {
  $('titleControls')?.classList.toggle('hidden');
});

$('continueBtn')?.addEventListener('click', () => {
  // Load first (main.js's load handler), then start (main.js's start
  // handler hides the card and sets gameStarted). The order matters:
  // loading after start would drop the player back to the spawn point
  // on the next placeMarker call.
  $('loadBtn')?.click();
  $('startBtn')?.click();
});

refreshContinue();

// ---------------------------------------------------------------- pause
function refreshPauseStats(G) {
  const st = getRunStats();
  const stage = Math.min(7, Math.max(0, G.missionIndex | 0)) + 1;
  const jobs = G.jobsCompleted || 0;
  // 8 jobs of 8 stages = a finished story; progress counts stage steps.
  const done = Math.min(64, jobs * 8 + (G.missionIndex | 0));
  const pct = Math.min(100, Math.round((done / 64) * 100));
  $('pauseProgressText').innerHTML = `STORY PROGRESS — <b>${pct}%</b>`;
  $('pauseProgressFill').style.width = `${pct}%`;
  $('pauseMission').textContent = `MISSION ${stage}/8 — ${G.missionTitle}`;
  $('pauseMoney').textContent = `$${G.money.toLocaleString('en-US')}`;
  $('pauseDay').textContent = `DAY ${st.clockDay}`;
  $('pauseJobs').textContent = String(jobs);
  $('pauseTakedowns').textContent = String(st.takedowns);
  $('pauseMaxWanted').textContent = '★'.repeat(st.maxWanted) + '☆'.repeat(5 - st.maxWanted);
  $('pauseCars').textContent = String(st.carsTaken);
}

export function openPause() {
  const G = game();
  if (!G || !G.gameStarted) return false;
  if (G.gameOver && !G._paused) return false; // a real bust, not a pause
  if (G._paused) return true;
  G._paused = true;
  G.gameOver = true; // freezes the simulation branch of the main loop
  $('settingsPanel')?.classList.add('hidden');
  refreshPauseStats(G);
  $('pauseMenu')?.classList.remove('hidden');
  return true;
}

export function closePause() {
  const G = game();
  if (!G || !G._paused) return false;
  G._paused = false;
  G.gameOver = false;
  $('pauseMenu')?.classList.add('hidden');
  return true;
}

export function isPaused() {
  const G = game();
  return !!G && !!G._paused;
}

$('pauseBtn')?.addEventListener('click', () => openPause());
$('resumeBtn')?.addEventListener('click', () => closePause());
$('quitBtn')?.addEventListener('click', () => location.reload());

// ESC owns the pause toggle (the settings panel closes first when open;
// the inline settings script no longer handles Escape).
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat) return;
  const settings = $('settingsPanel');
  if (settings && !settings.classList.contains('hidden')) {
    settings.classList.add('hidden');
    return;
  }
  const G = game();
  if (!G || !G.gameStarted) return;
  if (G._paused) closePause();
  else openPause();
});
