// HUD and minimap for SUNCOAST: HEATLINE.
// One clear job: everything drawn over the 3D view — cash, clock, wanted,
// mission panel with timer + stage + next job, police response, radio,
// weapon slots, REP, health + armor, the round minimap and the driving
// cluster (big speedometer, gear, condition, nitro). Commercial layout,
// sunset-coastal direction: mission top-left, cash + wanted top-right,
// vitals bottom-left, minimap mid-left, speed bottom-right — dense,
// readable, never covering the road ahead, and the bottom-centre stays
// empty for the crew dialog box. Signatures used by main.js are frozen:
// updateHud(G), drawMinimap(G), showToast, tickToast, setHudVisible.
//
// Data rules (the HUD never invents gameplay facts):
// - Police panel ONLY from window.SuncoastPolice.getResponseUnits().
// - Radio ONLY from window.SuncoastRadio.nowPlaying().
// - Vehicle numbers from window.SuncoastVehicle when present, otherwise
//   derived from the driven car (type fallback names are the original
//   PALMERA / DUNEHAWK / TIDEHAULER / HEATLINE GT / SUNCAB / INTERCEPTOR).
// - REP comes from the cumulative takedown total, never from the per-stage
//   kill counter that resets to 0 when a job completes.
// - PERF is a debug readout: hidden on normal frames, shown only with
//   ?debug=1. The save key is untouched (suncoast_heatline_save); the
//   run-stats key below is separate and only ever adds counters.

import { clamp } from '../core/config.js';
import { MISSION_POINTS, GANG_ZONE, getMissionBrief } from '../missions/missions.js';

const $ = (id) => document.getElementById(id);

// PERF is debug-only: the row stays hidden unless ?debug=1.
const DEBUG_PERF = new URLSearchParams(location.search).get('debug') === '1';
if (DEBUG_PERF) document.body.classList.add('debug-perf');

const MISSION_TOTAL = 8;

/** Original vehicle names by type (fallback when no telemetry name). */
const VEHICLE_NAMES = {
  sedan: 'PALMERA', suv: 'DUNEHAWK', truck: 'TIDEHAULER',
  sports: 'HEATLINE GT', taxi: 'SUNCAB', police: 'INTERCEPTOR',
};

/** Four weapon slots, in key order. Ownership comes from the game. */
const SLOT_DEFS = [
  { id: 'pistol', key: '1', name: 'PISTOL' },
  { id: 'smg', key: '2', name: 'SMG' },
  { id: 'shotgun', key: '3', name: 'SHOTGUN' },
  { id: 'bat', key: '4', name: 'BAT' },
];

/** REP ranks: 10 points per takedown, cumulative across the whole run. */
const REP_LEVELS = [
  { min: 0, name: 'NOBODY' },
  { min: 100, name: 'SMALL TIME' },
  { min: 250, name: 'STREET NAME' },
  { min: 500, name: 'COAST HUSTLER' },
  { min: 1000, name: 'HEAT LEGEND' },
];
const REP_POINTS_PER_TAKEDOWN = 10;

/** Original street names, one avenue + one street per 36-unit road. */
const AVENUES = [
  [-144, 'WEST GATE AVE'], [-108, 'ANCHOR WAY'], [-72, 'PALM ROW'],
  [-36, 'SUNSET BLVD'], [0, 'HEATLINE AVE'], [36, 'BOARDWALK AVE'],
  [72, 'LAGOON DR'], [108, 'SANDPIPER LN'], [144, 'PIER RD'],
];
const STREETS = [
  [-144, 'NORTH GATE ST'], [-108, 'HARBOR ST'], [-72, 'PELICAN ST'],
  [-36, 'SUNCOAST WAY'], [0, 'MIDTOWN ST'], [36, 'PALM ST'],
  [72, 'BAYVIEW ST'], [108, 'SOUTH SHORE DR'], [144, 'DUNE ST'],
];

// ---------------------------------------------------------------- run stats
// Session counters the HUD observes (takedowns, cars taken, highest
// wanted, play time, clock). Persisted under its own key so a reload keeps
// REP — the save file itself is never touched here.
const RUNSTATS_KEY = 'suncoast_heatline_runstats_v1';

function loadRunStats() {
  const d = {
    takedowns: 0, carsTaken: 0, maxWanted: 0, playSeconds: 0,
    clockDay: 1, clockMin: 17 * 60 + 24, lastKills: null, lastCar: 0,
  };
  try {
    const raw = localStorage.getItem(RUNSTATS_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    for (const k of ['takedowns', 'carsTaken', 'maxWanted', 'playSeconds', 'clockDay', 'clockMin']) {
      if (typeof s[k] === 'number' && Number.isFinite(s[k])) d[k] = s[k];
    }
    if (s.lastKills === null || (typeof s.lastKills === 'number' && Number.isFinite(s.lastKills))) d.lastKills = s.lastKills;
    if (s.lastCar === 0 || s.lastCar === 1) d.lastCar = s.lastCar;
    d.clockDay = Math.max(1, Math.floor(d.clockDay));
    d.clockMin = clamp(d.clockMin, 0, 1439);
  } catch { /* corrupt stats: start fresh */ }
  return d;
}

const runStats = loadRunStats();
let statsDirty = false;
let lastFlush = 0;

function flushRunStats(force = false) {
  const now = performance.now();
  if (!force && (!statsDirty || now - lastFlush < 5000)) return;
  try { localStorage.setItem(RUNSTATS_KEY, JSON.stringify(runStats)); } catch { /* storage blocked */ }
  statsDirty = false;
  lastFlush = now;
}
addEventListener('beforeunload', () => flushRunStats(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) flushRunStats(true); });

/** Live copy of the run counters (pause menu + tests read this). */
export function getRunStats() { return { ...runStats }; }

// ---------------------------------------------------------------- clock
// One game-minute per real second while playing, starting DAY 1 17:24
// (golden hour). When the sky preset changes, the clock snaps to that
// preset's canonical hour — day +1 when it wraps past midnight.
const PRESET_HOURS = { golden: 17.4, dusk: 19.25, night: 22.5, noon: 12 };
let lastPreset = null;

function tickClock(G, dt) {
  runStats.playSeconds += dt;
  runStats.clockMin += dt;
  if (runStats.clockMin >= 1440) { runStats.clockMin -= 1440; runStats.clockDay += 1; }
  const preset = G.settings?.timeOfDay;
  if (preset && preset !== lastPreset) {
    const hour = PRESET_HOURS[preset];
    if (hour !== undefined) {
      if (hour < runStats.clockMin / 60) runStats.clockDay += 1;
      runStats.clockMin = hour * 60;
    }
    lastPreset = preset;
  }
}

export function clockText() {
  const h = Math.floor(runStats.clockMin / 60);
  const m = Math.floor(runStats.clockMin % 60);
  return `DAY ${runStats.clockDay} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtMMSS(s) {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- districts
/** District name for a world position, shown under the minimap. */
export function districtFor(x, z) {
  if (x >= 138) return 'PIER BEACH';
  if (x >= 100) return 'WATERFRONT';
  if (Math.hypot(x - GANG_ZONE.x, z - GANG_ZONE.z) < 26) return 'CREW YARD';
  if (Math.abs(x) <= 36 && Math.abs(z) <= 36) return 'DOWNTOWN';
  if (z <= -108) return 'NORTHSIDE';
  if (z >= 108) return 'SOUTHSIDE';
  if (x <= -108) return 'WEST END';
  return 'SUNCOAST DISTRICT';
}

function nearestName(list, v) {
  let best = list[0];
  for (const e of list) if (Math.abs(v - e[0]) < Math.abs(v - best[0])) best = e;
  return best[1];
}

/** Nearest cross streets for a world position ("HEATLINE AVE × MIDTOWN ST"). */
export function streetFor(x, z) {
  return `${nearestName(AVENUES, x)} × ${nearestName(STREETS, z)}`;
}

// ---------------------------------------------------------------- toast
// Wall-clock deadline (performance.now, ms) for the visible toast.
// D-QA6: the old timer ran on game dt (clamped 0.04 s/frame), so a 3 s
// toast could stay up for minutes of wall time whenever frames were slow —
// and every new toast silently re-armed it. Wall time dismisses in ~3.5 s
// no matter the frame rate; tickToast() is still called every frame by
// main.js, it just checks the wall clock now instead of consuming dt.
let toastDeadline = 0;

// Last rendered wanted level (updateHud rebuilds the stars only on change).
let lastWanted = -1;
let lastUpdate = 0;
let lastStage = null;
let stageElapsed = 0;
let lastSlotSig = '';
let lastPoliceSig = '';
let lastRadioText = null;
const lastAmmo = {};

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

// ---------------------------------------------------------------- police API
// The response panel reads ONLY window.SuncoastPolice.getResponseUnits().
// Anything else (pill fallback, search zone) reads the live AI state.
function policeUnits() {
  try {
    const fn = window.SuncoastPolice?.getResponseUnits;
    if (typeof fn !== 'function') return null;
    const u = fn.call(window.SuncoastPolice);
    return Array.isArray(u) ? u : null;
  } catch { return null; }
}

function normUnit(u) {
  if (!u || typeof u !== 'object') return null;
  const name = String(u.callsign ?? u.name ?? u.id ?? 'UNIT').toUpperCase().slice(0, 14);
  const dist = u.distanceM ?? u.distance ?? u.dist ?? u.range ?? u.meters ?? null;
  const raw = String(u.status ?? u.state ?? u.mode ?? 'PURSUIT').toUpperCase();
  const status = raw.includes('SEARCH') ? 'SEARCH'
    : raw.includes('SPOT') ? 'SPOTLIGHT'
    : raw.includes('RAM') ? 'RAMMING'
    : raw.includes('ROADBLOCK') ? 'ROADBLOCK'
    : raw.includes('BOX') ? 'BOXING IN'
    : raw.includes('PURS') ? 'PURSUIT' : raw;
  return {
    name,
    dist: (typeof dist === 'number' && Number.isFinite(dist)) ? Math.round(dist) : null,
    status,
  };
}

// The police search readout: { searching, unitsInSearch, roadblock,
// totalUnits, lastSeen: {x, z} | null }. Used for the pill and the
// minimap search zone; the live AI modes are the fallback.
function searchState() {
  try {
    const fn = window.SuncoastPolice?.getSearchState;
    if (typeof fn !== 'function') return null;
    const s = fn.call(window.SuncoastPolice);
    return (s && typeof s === 'object') ? s : null;
  } catch { return null; }
}

function policePillState(G, units) {
  if ((G.wanted | 0) <= 0) return { text: '—', cls: '' };
  const list = units ?? [];
  if (list.some((u) => /PURSUIT|RAMMING|SPOTLIGHT|SEARCHLIGHT/.test(u.status))) {
    return { text: 'IN SIGHT', cls: 'sight' };
  }
  if (list.some((u) => u.status === 'SEARCH')) return { text: 'SEARCHING', cls: 'searching' };
  if (searchState()?.searching) return { text: 'SEARCHING', cls: 'searching' };
  // No usable API rows: fall back to the live pursuit state machine.
  if (G.police && G.police.length) {
    if (G.police.some((c) => c.userData?.mode === 'pursue')) return { text: 'IN SIGHT', cls: 'sight' };
    if (G.police.some((c) => c.userData?.mode === 'search')) return { text: 'SEARCHING', cls: 'searching' };
  }
  return { text: 'SEARCHING', cls: 'searching' };
}

// TRACE: police heat as a 0-100 readout (heat tops out near 60). The API
// wins when it offers its own number.
function tracePct(G) {
  try {
    const t = window.SuncoastPolice?.getTrace?.();
    if (typeof t === 'number' && Number.isFinite(t)) return clamp(Math.round(t), 0, 100);
  } catch { /* fall through to the heat readout */ }
  const heat = typeof G.heat === 'number' ? G.heat : 0;
  return clamp(Math.round((heat / 60) * 100), 0, 100);
}

function renderPolicePanel(G, units) {
  const panel = $('policePanel');
  const show = (G.wanted | 0) > 0 && units && units.length > 0;
  panel.classList.toggle('hidden', !show);
  if (!show) { lastPoliceSig = ''; return; }
  const rows = units.slice(0, 5).map(normUnit).filter(Boolean);
  const sig = rows.map((r) => `${r.name}|${r.dist}|${r.status}`).join(';') + `#${units.length}`;
  if (sig === lastPoliceSig) return;
  lastPoliceSig = sig;
  $('policeHeader').textContent = `SUNCOAST POLICE RESPONSE — ${units.length} UNIT${units.length === 1 ? '' : 'S'}`;
  const wrap = $('policeRows');
  wrap.textContent = '';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'pp-row';
    const name = document.createElement('span');
    name.className = 'pp-name';
    name.textContent = r.name;
    const dist = document.createElement('span');
    dist.className = 'pp-dist';
    dist.textContent = r.dist === null ? '— m' : `${r.dist} m`;
    const st = document.createElement('span');
    st.className = 'pp-status' + (r.status === 'SEARCH' ? ' search' : r.status === 'SPOTLIGHT' ? ' spot' : '');
    st.textContent = r.status;
    row.append(name, dist, st);
    wrap.appendChild(row);
  }
  if (units.length > 5) {
    const more = document.createElement('div');
    more.className = 'pp-more';
    more.textContent = `+${units.length - 5} more units in the search zone`;
    wrap.appendChild(more);
  }
}

// ---------------------------------------------------------------- radio
// The radio row reads ONLY window.SuncoastRadio.nowPlaying().
function radioNow() {
  try {
    const np = window.SuncoastRadio?.nowPlaying;
    if (typeof np !== 'function') return null;
    const r = np.call(window.SuncoastRadio);
    if (!r) return null;
    if (typeof r === 'string') return { head: r, tail: '' };
    if (typeof r === 'object') {
      const station = r.station ?? r.name ?? '';
      const freq = r.freq ?? r.frequency ?? '';
      const track = r.track ?? r.title ?? '';
      const artist = r.artist ?? '';
      const genre = r.genre ?? r.style ?? '';
      const head = [station, freq].filter(Boolean).join(' ');
      // Same line the radio module writes on the title screen, so the
      // text never visibly changes hands between title and gameplay.
      const tail = [track ? `“${track}”` : '', artist].filter(Boolean).join(' — ')
        + (genre ? ` · ${genre}` : '');
      const text = [head, tail].filter(Boolean).join(' — ');
      return text ? { head, tail } : null;
    }
    return null;
  } catch { return null; }
}

function renderRadio() {
  const panel = $('radioPanel');
  const now = radioNow();
  const text = now ? [now.head, now.tail].filter(Boolean).join(' — ') : null;
  if (!text) {
    panel.classList.add('hidden');
    lastRadioText = null;
    return;
  }
  panel.classList.remove('hidden');
  if (text === lastRadioText) return;
  lastRadioText = text;
  const el = $('radioText');
  el.textContent = '';
  const b = document.createElement('b');
  b.textContent = now.head;
  el.appendChild(b);
  if (now.tail) el.appendChild(document.createTextNode(` — ${now.tail}`));
}

// ---------------------------------------------------------------- vehicles
// Telemetry wins when present; otherwise derive from the driven car.
function vehicleInfo(G) {
  const car = G.currentCar || null;
  const t = (typeof window !== 'undefined' && window.SuncoastVehicle && typeof window.SuncoastVehicle === 'object')
    ? window.SuncoastVehicle : null;
  const speed = car ? Math.abs(car.userData.speed || 0) : 0;
  const top = (car?.userData?.spec?.topSpeed) || 26;
  const out = { driving: !!car, name: 'PALMERA', kmh: 0, gear: 'G1', condition: 100, nitro: null };
  if (car) {
    out.name = (t?.name && String(t.name)) || VEHICLE_NAMES[car.userData?.type] || 'PALMERA';
    out.kmh = (t && Number.isFinite(t.speedKmh)) ? Math.round(t.speedKmh) : Math.round(speed * 5);
    out.condition = (t && Number.isFinite(t.condition))
      ? clamp(Math.round(t.condition), 0, 100)
      : clamp(Math.round(car.userData.health ?? 100), 0, 100);
    const nitroRaw = (t && Number.isFinite(t.nitro01)) ? t.nitro01
      : (Number.isFinite(car.userData.nitro) ? car.userData.nitro : null);
    if (nitroRaw !== null && nitroRaw !== undefined) {
      out.nitro = nitroRaw > 1 ? clamp(Math.round(nitroRaw), 0, 100) : clamp(Math.round(nitroRaw * 100), 0, 100);
    }
    const g = t?.gear;
    if (typeof g === 'number' && Number.isFinite(g)) {
      out.gear = g <= 0 ? 'N' : `G${clamp(Math.round(g), 1, 6)}`;
    } else if (typeof g === 'string' && g) {
      const up = g.toUpperCase();
      out.gear = /^[GRN]\d?$/.test(up) ? up : /^\d$/.test(up) ? `G${up}` : up;
    } else if (speed < -0.5) {
      out.gear = 'R';
    } else if (speed < 1) {
      out.gear = 'G1';
    } else {
      out.gear = `G${1 + Math.min(4, Math.floor((speed / top) * 5))}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- weapons
// The slot rows carry the truth: each row has an `owned` flag, so an
// unowned SMG/shotgun reads LOCKED instead of showing its full mag.
// list() is NOT used here on purpose — it answers "which weapons exist",
// not "which does the player own" (see combat.js getWeaponState).
function ownedWeapons(G) {
  try {
    const slots = window.SuncoastWeapons?.slots;
    if (Array.isArray(slots)) {
      const s = new Set();
      for (const row of slots) {
        if (row && row.owned) s.add(String(row.id ?? row.name));
      }
      if (s.size) return s;
    }
  } catch { /* fall through to the G flags */ }
  const s = new Set(['pistol']);
  if (G.hasSmg) s.add('smg');
  if (G.hasShotgun) s.add('shotgun');
  if (G.hasBat) s.add('bat');
  if (G.weapon?.id) s.add(G.weapon.id);
  return s;
}

function activeWeaponId(G) {
  try {
    const a = window.SuncoastWeapons?.active;
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object') return a.id ?? a.name ?? null;
  } catch { /* fall through to G.weapon */ }
  return G.weapon?.id ?? 'pistol';
}

function fmtAmmo(mag, reserve) {
  if (mag === undefined || mag === null) return null;
  const res = (reserve === Infinity || reserve === undefined || reserve === null) ? '∞' : reserve;
  return `${mag}/${res}`;
}

function apiAmmo(id) {
  try {
    const s = window.SuncoastWeapons?.slots;
    if (Array.isArray(s)) {
      const row = s.find((r) => r && (r.id === id || r.name === id));
      if (row) return fmtAmmo(row.mag, row.reserve);
    } else if (s && typeof s === 'object' && s[id] && typeof s[id] === 'object') {
      return fmtAmmo(s[id].mag, s[id].reserve);
    }
  } catch { /* ignore */ }
  return null;
}

function renderSlots(G) {
  const owned = ownedWeapons(G);
  const activeId = activeWeaponId(G);
  const parts = SLOT_DEFS.map((d) => {
    const isOwned = owned.has(d.id);
    let ammo;
    if (!isOwned) {
      ammo = 'LOCKED';
    } else if (d.id === activeId && G.weapon && G.weapon.id === d.id) {
      // The live weapon's ammo belongs to this slot only when the live
      // weapon really is this slot: SuncoastWeapons refreshes one step
      // before the pickup in main.js's loop, so on the pickup frame the
      // stale active id is still 'pistol' while G.weapon is already the
      // SMG — without the id check the SMG's 30/120 was cached as the
      // pistol's lastAmmo and stuck there (D-QA01 cousin, found by F5).
      ammo = fmtAmmo(G.weapon.mag, G.weapon.reserve) ?? '—';
      lastAmmo[d.id] = ammo;
    } else {
      // Live slot row first (refreshed every frame, switch-back caches
      // kept true by selectWeapon); lastAmmo is only the no-API fallback.
      ammo = apiAmmo(d.id) ?? lastAmmo[d.id] ?? '—';
    }
    return `${d.id}|${isOwned ? 1 : 0}|${d.id === activeId ? 1 : 0}|${ammo}`;
  });
  const sig = parts.join(';');
  if (sig === lastSlotSig) return;
  lastSlotSig = sig;
  const wrap = $('slots');
  wrap.textContent = '';
  SLOT_DEFS.forEach((d, i) => {
    const [id, ownedFlag, activeFlag, ammo] = parts[i].split('|');
    const el = document.createElement('div');
    el.className = 'slot' + (activeFlag === '1' ? ' active' : '') + (ownedFlag === '0' ? ' locked' : '');
    const key = document.createElement('div');
    key.className = 'slotKey';
    key.textContent = d.key;
    const name = document.createElement('div');
    name.className = 'slotName';
    name.textContent = d.name;
    const am = document.createElement('div');
    am.className = 'slotAmmo';
    am.textContent = ammo;
    el.append(key, name, am);
    wrap.appendChild(el);
  });
}

// ---------------------------------------------------------------- REP
function repFor(points) {
  let level = 0;
  for (let i = 0; i < REP_LEVELS.length; i += 1) {
    if (points >= REP_LEVELS[i].min) level = i;
  }
  const cur = REP_LEVELS[level];
  const next = REP_LEVELS[level + 1];
  return {
    level: level + 1,
    name: cur.name,
    into: next ? points - cur.min : points,
    span: next ? next.min - cur.min : 0,
    maxed: !next,
  };
}

// ---------------------------------------------------------------- main HUD
export function updateHud(G) {
  const now = performance.now();
  const dt = lastUpdate ? Math.min((now - lastUpdate) / 1000, 0.5) : 0;
  lastUpdate = now;

  // --- run counters observed from live state (never from the per-stage
  // counter alone: G.kills resets to 0 when a job completes, so the
  // accumulator below is what REP is built on).
  const kills = G.kills | 0;
  if (runStats.lastKills === null) {
    runStats.takedowns += Math.max(0, kills);
    runStats.lastKills = kills;
    statsDirty = true;
  } else if (kills > runStats.lastKills) {
    runStats.takedowns += kills - runStats.lastKills;
    runStats.lastKills = kills;
    statsDirty = true;
  } else if (kills < runStats.lastKills) {
    runStats.lastKills = kills;
    statsDirty = true;
  }
  const inCar = G.currentCar ? 1 : 0;
  if (inCar && !runStats.lastCar) { runStats.carsTaken += 1; statsDirty = true; }
  runStats.lastCar = inCar;
  if ((G.wanted | 0) > runStats.maxWanted) { runStats.maxWanted = G.wanted | 0; statsDirty = true; }

  tickClock(G, dt);
  const stage = clamp(G.missionIndex | 0, 0, MISSION_TOTAL - 1);
  if (lastStage === null || lastStage !== stage) { lastStage = stage; stageElapsed = 0; }
  else stageElapsed += dt;

  // --- top-right stats ---
  $('cash').textContent = '$ ' + G.money.toLocaleString('en-US');
  $('clock').textContent = clockText();
  const veh = vehicleInfo(G);
  $('speed').textContent = veh.driving ? `${veh.kmh} KM/H · ${veh.gear}` : 'ON FOOT';
  $('weapon').textContent = `${G.weapon.name.toUpperCase()} ${fmtAmmo(G.weapon.mag, G.weapon.reserve) ?? ''}`.trim();
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
  const units = policeUnits();
  const pill = policePillState(G, units);
  const pillEl = $('policePill');
  if (pillEl.textContent !== pill.text) pillEl.textContent = pill.text;
  pillEl.className = pill.cls;
  pillEl.id = 'policePill';
  $('traceText').textContent = `${tracePct(G)}%`;
  if (G.fps !== undefined) $('fps').textContent = `${G.fps} FPS`;

  // --- mission panel: title, objective, timer, STAGE x/8, NEXT ---
  $('missionTitle').textContent = G.missionTitle;
  $('objective').textContent = G.objectiveText;
  $('missionStage').textContent = `MISSION ${stage + 1}/${MISSION_TOTAL}`;
  $('stageLabel').textContent = `STAGE ${stage + 1}/${MISSION_TOTAL}`;
  $('missionTimer').textContent = fmtMMSS(stageElapsed);
  $('stageFill').style.width = `${((stage + 1) / MISSION_TOTAL) * 100}%`;
  const nextIdx = stage + 1;
  $('nextMission').textContent = nextIdx >= MISSION_POINTS.length
    ? 'NEXT — NEW CONTRACT'
    : `NEXT ▸ ${getMissionBrief(nextIdx).title}`;

  // --- police + radio panels (contract sources only) ---
  renderPolicePanel(G, units);
  renderRadio();

  // --- vitals + REP ---
  const health = Math.max(0, Math.round(G.health));
  const armor = Math.max(0, Math.round(G.armor || 0));
  $('healthText').textContent = `${health}%`;
  const healthFill = $('healthFill');
  healthFill.style.width = `${clamp(G.health, 0, 100)}%`;
  healthFill.classList.toggle('low', health <= 30);
  healthFill.classList.toggle('mid', health > 30 && health <= 60);
  $('armorText').textContent = `${armor}%`;
  $('armorFill').style.width = `${clamp(armor, 0, 100)}%`;
  $('armorRow').style.display = armor > 0 ? '' : 'none';
  const rep = repFor(runStats.takedowns * REP_POINTS_PER_TAKEDOWN);
  $('repText').textContent = `REP ${rep.level} — ${rep.name}`;
  $('repValue').textContent = rep.maxed ? `${rep.into} · MAX` : `${rep.into} / ${rep.span}`;
  $('repFill').style.width = rep.maxed ? '100%' : `${rep.span ? (rep.into / rep.span) * 100 : 0}%`;

  // --- weapon slots ---
  renderSlots(G);

  // --- hints, prompt, crosshair ---
  $('vehicleHint').textContent = G.currentCar
    ? 'W/S accelerate • A/D steer • E exit'
    : 'E near a vehicle to take it • Click to fire';
  const prompt = $('prompt');
  if (prompt) {
    // Show the enter-vehicle prompt only when E would actually work:
    // a car within the 4.4 u entry reach (same radius as the E handler
    // in main.js). On foot in open ground the prompt stays hidden.
    let nearVehicle = false;
    if (!G.currentCar && G.gameStarted && !G.gameOver && G.player) {
      const px = G.player.position.x;
      const pz = G.player.position.z;
      const cars = [];
      if (G.playerCar) cars.push(G.playerCar);
      if (Array.isArray(G.traffic)) cars.push(...G.traffic);
      for (const c of cars) {
        if (c && c.position && Math.hypot(c.position.x - px, c.position.z - pz) < 4.4) {
          nearVehicle = true;
          break;
        }
      }
    }
    if (nearVehicle) {
      prompt.textContent = 'E — ENTER VEHICLE';
      prompt.classList.add('show');
    } else {
      prompt.classList.remove('show');
    }
  }
  $('crosshair').style.opacity = G.currentCar ? '0' : '.75';
  $('audioBtn').textContent = G.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';

  // --- driving cluster: big speedometer, gear, name, condition, nitro ---
  const speedo = $('speedo');
  if (veh.driving) {
    speedo.classList.remove('hidden');
    $('speedoNum').textContent = veh.kmh;
    $('speedoGear').textContent = veh.gear;
    $('speedoVehicle').textContent = veh.name;
    const condFill = $('condFill');
    condFill.style.width = `${veh.condition}%`;
    condFill.classList.toggle('low', veh.condition <= 30);
    condFill.classList.toggle('mid', veh.condition > 30 && veh.condition <= 60);
    $('condText').textContent = `${veh.condition}%`;
    const nitroRow = $('nitroRow');
    if (veh.nitro === null) {
      nitroRow.classList.add('dim');
      $('nitroFill').style.width = '0%';
      $('nitroText').textContent = '—';
    } else {
      nitroRow.classList.remove('dim');
      $('nitroFill').style.width = `${veh.nitro}%`;
      $('nitroText').textContent = `${veh.nitro}%`;
    }
  } else {
    speedo.classList.add('hidden');
  }

  // --- district + street under the minimap ---
  const p = G.actorPosition();
  $('mapLabel').textContent = districtFor(p.x, p.z);
  $('mapStreet').textContent = streetFor(p.x, p.z);

  flushRunStats();
}

/** 2D top-down minimap: roads, buildings, beach, mission marker, police,
 *  search zone, player. Clipped to a circle — never a square debug map. */
export function drawMinimap(G) {
  const c = $('minimap');
  if (!c) return;
  const ctx = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
  ctx.clip();
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
  // Search zone: where the police last saw the player, while they search.
  // The API's last-seen point wins; the live AI state is the fallback.
  const ss = searchState();
  let zoneX = null;
  let zoneZ = null;
  if (ss?.searching && ss.lastSeen && Number.isFinite(ss.lastSeen.x) && Number.isFinite(ss.lastSeen.z)) {
    zoneX = ss.lastSeen.x * scale;
    zoneZ = ss.lastSeen.z * scale;
  } else {
    const searching = (G.police || []).filter((car) => car.userData?.mode === 'search');
    if (searching.length) {
      const u = searching[0].userData;
      zoneX = (u.lastSeenX ?? p.x) * scale;
      zoneZ = (u.lastSeenZ ?? p.z) * scale;
    }
  }
  if (zoneX !== null) {
    ctx.strokeStyle = 'rgba(255,209,102,0.95)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(zoneX, zoneZ, 30 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
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
  ctx.restore();
  // North tick, fixed to the frame.
  ctx.fillStyle = '#9fb7c7';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', w / 2, 11);
}
