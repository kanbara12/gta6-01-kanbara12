// Police AI for SUNCOAST: HEATLINE.
// One clear job: pursuit + search behaviour for police cars, with
// building-aware collision and road-grid navigation.
//
// DROP-IN REPLACEMENT for the police functions in vehicles.js: the two
// exported signatures are IDENTICAL, so the coordinator swaps one import
// line in main.js and nothing else changes. All movement math below is
// carried over from vehicles.js, including the QA defect D1 anti-freeze
// logic (unstick reverse-out, axis-aligned road routing, margin-escape) —
// do not "simplify" those branches away; they are what keeps police cars
// from freezing wedged in a building corner or driving through a block.
//
// What this module ADDS on top of vehicles.js (same signatures):
// - Pursuit state machine per unit: PURSUE (sees the player, or recently
//   saw them) -> SEARCH (lost sight: drive to the last-seen point, then
//   sweep nearby intersections) -> cruising slow once the search goes
//   cold. The main loop's heat decay + despawn (updatePoliceSpawns in
//   main.js) stays authoritative for actually losing the heat; this module
//   only decides how the cars behave while the heat is on.
// - Wanted escalation table: top speed, search patience and unit cap per
//   wanted level 0-5 (exported as WANTED_CONFIG for the HUD / spawner).
// - Readouts for the coordinator: allPoliceLost(police) and
//   policePursuitState(car), so the HUD can say "SEARCHING" vs "PURSUE".
//
// G-02 (v3): named response units + live panel. Every spawned car gets an
// original Suncoast callsign (fish name + number, never reused in a
// session); getResponseUnits() exposes callsign + live distance + status
// for the panel and for tests, and window.SuncoastPolice publishes
// getResponseUnits / getWanted / setWanted / getSearchState. The HUD
// shell (index.html #policePanel) owns the panel markup; this module only
// fills it — if the shell is absent it builds a fallback panel instead.
// Statuses come from the real state machine: PURSUIT / RAMMING while the
// unit sees the player, SEARCH once it loses sight, ROADBLOCK while a
// unit holds an intersection ahead of the player (wanted 4+), SPOTLIGHT
// for the SKY-1 helicopter row when the air unit exists (G-01).
// setWanted is safe from the garage: setWanted(0) also zeroes the heat,
// so the spawner despawns the ground units on its next tick.

import { clamp } from '../core/config.js';
import { collidesBuilding, hasLineOfSight, nearestRoadCoord } from '../world/world.js';
import { makeCar, animateCar } from '../vehicles/vehicles.js';
import '../UI/dialog.js'; // side effect: crew dialog box + window.SuncoastDialog

/** Per wanted level: unit cap, top-speed bonus, sight-loss patience. */
export const WANTED_CONFIG = [
  { level: 0, maxUnits: 0, speedBonus: 0, loseAfter: 6, searchSeconds: 12 },
  { level: 1, maxUnits: 2, speedBonus: 1.5, loseAfter: 6, searchSeconds: 12 },
  { level: 2, maxUnits: 3, speedBonus: 3, loseAfter: 7, searchSeconds: 14 },
  { level: 3, maxUnits: 4, speedBonus: 4.5, loseAfter: 9, searchSeconds: 16 },
  { level: 4, maxUnits: 4, speedBonus: 6, loseAfter: 11, searchSeconds: 18 },
  { level: 5, maxUnits: 4, speedBonus: 7.5, loseAfter: 14, searchSeconds: 20 },
];

/** Wanted table lookup, clamped to level 0-5. */
export function wantedConfig(wanted) {
  return WANTED_CONFIG[clamp(Math.round(wanted) || 0, 0, 5)];
}

/** How many police cars the spawner should keep out at this wanted level. */
export function countPoliceForWanted(wanted) {
  return Math.min(1 + clamp(Math.round(wanted) || 0, 0, 5), 4);
}

// ------------------------------------------------------- G-02 callsigns
/** Original Suncoast unit callsigns: fish names + number. */
const FISH_NAMES = ['SNOOK', 'POMPANO', 'COBIA', 'MACKEREL', 'REDFISH', 'MULLET', 'BARRACUDA', 'FLOUNDER'];
const HELI_CALLSIGN = 'SKY-1';

/** Spawn counter: names cycle SNOOK-10..99, then POMPANO-10..99, ... —
// a callsign is never reused inside one session. */
let spawnCounter = 0;

/** Next original Suncoast callsign from the pool, never reused in a session. */
function nextCallsign() {
  const name = `${FISH_NAMES[Math.floor(spawnCounter / 90) % FISH_NAMES.length]}-${10 + (spawnCounter % 90)}`;
  spawnCounter += 1;
  return name;
}
/** Last police array + actor position seen by updatePolice (panel/API reads). */
let lastPolice = [];
let lastActorPos = null;

/** Callsign stored on a spawned car (or 'UNKNOWN' for a foreign object). */
export function unitCallsign(car) {
  return (car && car.userData && car.userData.callsign) || 'UNKNOWN';
}

/**
 * Display status for one ground unit, from its real state:
 * ROADBLOCK while holding an intersection, SEARCH once it lost sight,
 * RAMMING while closing in with sight, PURSUIT otherwise.
 */
export function unitStatus(car, dist, seesPlayer) {
  const mode = car && car.userData ? car.userData.mode : 'pursue';
  if (mode === 'roadblock') return 'ROADBLOCK';
  if (mode === 'search') return 'SEARCH';
  if (mode === 'pursue' && dist < 7 && seesPlayer) return 'RAMMING';
  return 'PURSUIT';
}

/**
 * The air unit row (G-01 helicopter). Preferred source is the helicopter
 * module's own read-out (window.SuncoastAir): null while the unit is not
 * on station, so no bogus row appears while it is parked. Fallback reads
 * the game object directly, but only when the unit is visible + active.
 */
function heliUnit() {
  const air = typeof window !== 'undefined' ? window.SuncoastAir : null;
  if (air && typeof air === 'object' && air.callsign) {
    return {
      callsign: air.callsign,
      distanceM: Math.round(air.distanceM || 0),
      status: air.status || 'SPOTLIGHT',
      kind: 'air',
    };
  }
  const g = typeof window !== 'undefined' ? window.__game : null;
  if (!g) return null;
  const h = g.helicopter || g.heli || g.airUnit;
  if (!h || !h.position || h.visible === false) return null;
  if (h.userData && h.userData.state && h.userData.state !== 'active') return null;
  const p = lastActorPos || (typeof g.actorPosition === 'function' ? g.actorPosition() : null);
  const dist = p ? Math.hypot(p.x - h.position.x, p.z - h.position.z) : 0;
  return { callsign: HELI_CALLSIGN, distanceM: Math.round(dist), status: 'SPOTLIGHT', kind: 'air' };
}

/**
 * Live response list, nearest first: { callsign, distanceM, status, kind }.
 * kind is 'ground' for cars, 'air' for the helicopter row.
 */
export function getResponseUnits() {
  const units = [];
  for (const c of lastPolice) {
    // A car that arrived without a callsign (foreign object, or staged
    // through the old v1 spawner) gets one from the same pool, stored on
    // the car so it stays stable and is never reused — the panel never
    // shows UNKNOWN.
    if (!c.userData || !c.userData.callsign) {
      if (!c.userData) c.userData = {};
      c.userData.callsign = nextCallsign();
    }
    const dist = lastActorPos
      ? Math.hypot(lastActorPos.x - c.position.x, lastActorPos.z - c.position.z)
      : 0;
    units.push({
      callsign: unitCallsign(c),
      distanceM: Math.round(dist),
      status: unitStatus(c, dist, !!c.userData.seesPlayer),
      kind: 'ground',
    });
  }
  const heli = heliUnit();
  if (heli) units.push(heli);
  units.sort((a, b) => a.distanceM - b.distanceM);
  return units;
}

/** Live wanted level (0 when the game object is not up yet). */
export function getWanted() {
  const g = typeof window !== 'undefined' ? window.__game : null;
  return g ? (g.wanted | 0) : 0;
}

/**
 * Set the wanted level (0-5, clamped). Safe to call from the garage:
 * setWanted(0) also zeroes the heat, so the spawner despawns the ground
 * units on its next tick instead of leaving a stale chase running.
 * Returns the level actually set (0 when the game is not up yet).
 */
export function setWanted(n) {
  const g = typeof window !== 'undefined' ? window.__game : null;
  if (!g) return 0;
  const v = clamp(Math.round(n) || 0, 0, 5);
  g.wanted = v;
  if (v === 0) g.heat = 0;
  return v;
}

/**
 * Search-state snapshot: is anyone still hunting, how many, is a
 * roadblock holding, and the last-seen point the search is sweeping.
 */
export function getSearchState() {
  const searching = lastPolice.filter((c) => c.userData.mode === 'search').length;
  const roadblock = lastPolice.some((c) => c.userData.mode === 'roadblock');
  const seen = lastPolice.find((c) => c.userData.lastSeenX !== undefined);
  return {
    searching: searching > 0,
    unitsInSearch: searching,
    roadblock,
    totalUnits: lastPolice.length,
    lastSeen: seen ? { x: seen.userData.lastSeenX, z: seen.userData.lastSeenZ } : null,
  };
}

// ------------------------------------------------------- G-02 live panel
// The HUD shell (index.html #policePanel > #policeHeader + #policeRows)
// owns the panel's markup and position; this module only FILLS it, using
// the shell's own row classes (pp-row / pp-name / pp-dist / pp-status)
// plus an inline pill colour per status. If the shell is absent (a bare
// v2 tree), a fallback panel with the same ids is built instead, and only
// then is the minimap slid down to make room.
const PANEL_MAX_ROWS = 6;
const PILL_STYLE = {
  RAMMING: { color: '#ff8ba0', bg: 'rgba(255,82,104,.25)', border: 'rgba(255,82,104,.55)' },
  PURSUIT: { color: '#66e5ff', bg: 'rgba(102,229,255,.16)', border: 'rgba(102,229,255,.4)' },
  SEARCH: { color: '#ffd166', bg: 'rgba(255,209,102,.16)', border: 'rgba(255,209,102,.4)' },
  ROADBLOCK: { color: '#ff9d7a', bg: 'rgba(255,122,89,.2)', border: 'rgba(255,122,89,.5)' },
  SPOTLIGHT: { color: '#c9a6ff', bg: 'rgba(179,136,255,.2)', border: 'rgba(179,136,255,.5)' },
  SEARCHLIGHT: { color: '#c9a6ff', bg: 'rgba(179,136,255,.2)', border: 'rgba(179,136,255,.5)' },
};
let panelEl = null;
let panelHeaderEl = null;
let panelRowsEl = null;
let panelSig = '';
let panelRowEls = [];

/** Fallback-only CSS (shell absent): same ids/classes the shell defines. */
function injectPanelStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('policePanelStyle')) return;
  const style = document.createElement('style');
  style.id = 'policePanelStyle';
  style.textContent = [
    '#policePanel{position:absolute;left:22px;top:236px;width:min(300px,calc(100vw - 44px));padding:11px 13px;z-index:4}',
    '#policePanel.hidden{display:none}',
    '#policeHeader{font-size:9px;letter-spacing:2px;color:#ff8ba0;font-weight:850}',
    '#policeRows{height:138px;overflow:hidden}',
    '.pp-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;margin-top:7px;color:#e6f2f8}',
    '.pp-row .pp-name{font-weight:800;letter-spacing:.5px}',
    '.pp-row .pp-dist{color:#9fb7c7;font-variant-numeric:tabular-nums}',
    '.pp-status{padding:1px 7px;border-radius:20px;font-size:9px;font-weight:850;letter-spacing:1px;background:rgba(102,229,255,.16);color:#66e5ff;white-space:nowrap}',
    '@media(max-width:650px){#policePanel{left:10px;top:210px;width:210px;padding:8px 10px}}',
  ].join('\n');
  document.head.appendChild(style);
}

function createPolicePanel() {
  if (panelEl || typeof document === 'undefined') return panelEl;
  const shell = document.getElementById('policePanel');
  const shellHeader = document.getElementById('policeHeader');
  const shellRows = document.getElementById('policeRows');
  if (shell && shellHeader && shellRows) {
    panelEl = shell;
    panelHeaderEl = shellHeader;
    panelRowsEl = shellRows;
    return panelEl;
  }
  injectPanelStyle();
  const host = document.getElementById('hud') || document.body;
  panelEl = document.createElement('div');
  panelEl.id = 'policePanel';
  panelEl.className = 'panel';
  panelHeaderEl = document.createElement('div');
  panelHeaderEl.id = 'policeHeader';
  panelHeaderEl.textContent = 'SUNCOAST POLICE RESPONSE — 0 UNITS';
  panelRowsEl = document.createElement('div');
  panelRowsEl.id = 'policeRows';
  panelEl.appendChild(panelHeaderEl);
  panelEl.appendChild(panelRowsEl);
  host.appendChild(panelEl);
  // Fallback only: the rows box has a fixed height, so the panel height is
  // constant from creation — slide the v2 minimap below it once (desktop).
  const map = document.getElementById('minimapWrap');
  if (map && window.innerWidth > 650) {
    map.style.top = (panelEl.offsetTop + panelEl.offsetHeight + 12) + 'px';
  }
  return panelEl;
}

/** Rebuild the panel rows when the unit set changes; distances every frame. */
function refreshPolicePanel() {
  if (typeof document === 'undefined') return;
  if (!panelEl) createPolicePanel();
  if (!panelEl) return;
  const units = getResponseUnits();
  const wanted = getWanted();
  const show = wanted > 0 || units.length > 0;
  panelEl.classList.toggle('hidden', !show);
  if (!show) return;
  panelHeaderEl.textContent = `SUNCOAST POLICE RESPONSE — ${units.length} UNIT${units.length === 1 ? '' : 'S'}`;
  const sig = units.map((u) => `${u.callsign}:${u.status}`).join('|');
  if (sig !== panelSig) {
    panelSig = sig;
    panelRowsEl.textContent = '';
    panelRowEls = [];
    const noteRow = (text) => {
      const row = document.createElement('div');
      row.className = 'pp-row';
      const name = document.createElement('span');
      name.className = 'pp-name';
      name.textContent = text;
      row.appendChild(name);
      panelRowsEl.appendChild(row);
    };
    if (units.length === 0) noteRow('RESPONDING — UNITS EN ROUTE');
    for (const u of units.slice(0, PANEL_MAX_ROWS)) {
      const row = document.createElement('div');
      row.className = 'pp-row';
      const call = document.createElement('span');
      call.className = 'pp-name';
      call.textContent = u.callsign;
      const dist = document.createElement('span');
      dist.className = 'pp-dist';
      const pill = document.createElement('span');
      pill.className = 'pp-status';
      pill.textContent = u.status;
      const st = PILL_STYLE[u.status];
      if (st) {
        pill.style.color = st.color;
        pill.style.background = st.bg;
        pill.style.borderColor = st.border;
      }
      row.appendChild(call);
      row.appendChild(dist);
      row.appendChild(pill);
      panelRowsEl.appendChild(row);
      panelRowEls.push({ dist });
    }
    if (units.length > PANEL_MAX_ROWS) {
      noteRow(`+${units.length - PANEL_MAX_ROWS} MORE UNITS IN THE SEARCH ZONE`);
    }
  }
  const shown = units.slice(0, PANEL_MAX_ROWS);
  panelRowEls.forEach((r, i) => {
    if (shown[i]) r.dist.textContent = `${shown[i].distanceM} m`;
  });
}

/** 'pursue' | 'search' — the unit's current behaviour (for HUD / tests). */
export function policePursuitState(car) {
  return car.userData.mode || 'pursue';
}

/**
 * True when every police car has lost sight of the player for longer than
 * its wanted level allows — i.e. the player is, as far as the police know,
 * gone. The main loop still decides the actual wanted decay; this is only
 * the AI's own read-out (HUD "YOU LOST THEM" hint, tests).
 */
export function allPoliceLost(police) {
  if (!police || police.length === 0) return true;
  return police.every((c) => {
    const u = c.userData;
    return u.mode === 'search' && (u.lostTimer || 0) > (u.loseAfter || 6);
  });
}

function initPoliceState(c, actorPos) {
  const u = c.userData;
  if (u.stuckTimer === undefined) {
    u.stuckTimer = 0; u.unstick = 0; u.unstickDir = 1;
    u.lastPX = c.position.x; u.lastPZ = c.position.z;
  }
  // Search-state fields (new; default to "just saw the player here").
  if (u.mode === undefined) {
    u.mode = 'pursue';
    u.lastSeenX = actorPos.x; u.lastSeenZ = actorPos.z;
    u.lostTimer = 0; u.searchTimer = 0;
    u.searchTX = actorPos.x; u.searchTZ = actorPos.z;
    u.searchLeg = 0;
    u.loseAfter = 6; u.searchSeconds = 12;
  }
  // Roadblock fields (G-02): assigned intersection + whether it holds there.
  if (u.roadblockTX === undefined) {
    u.roadblockTX = actorPos.x; u.roadblockTZ = actorPos.z; u.holding = false;
  }
}

/**
 * Police pursuit with building collision avoidance and line of sight.
 *
 * Steering target: the player when line of sight is clear, otherwise the
 * nearest road intersection on the way to the player's last seen position —
 * so a police car routes around blocks on the road grid instead of driving
 * through buildings. Movement itself is also building-clamped with a slide.
 *
 * Anti-freeze (QA defect D1): a unit wedged into a building corner ends up
 * with both move axes blocked and its speed damped to ~0 while steering at
 * the same target every frame — a permanent freeze. Each unit therefore
 * tracks its real displacement: barely moving for 0.8 s while the player is
 * far away triggers a 1.4 s reverse-out with a turn, then it re-engages.
 * The cycle repeats if it wedges again, so a freeze can never be permanent.
 *
 * Search behaviour (new): once line of sight is lost for `loseAfter`
 * seconds the unit switches to SEARCH — it drives to the last-seen point,
 * then sweeps the neighbouring intersections (one road leg at a time, same
 * axis-aligned routing as pursuit) for `searchSeconds`. If it still has no
 * sight after that, it drops to a slow cruise around the last-seen area
 * until the main loop's heat decay removes it.
 */
export function updatePolice(police, buildings, actorPos, wanted, dt, onRam) {
  const cfg = wantedConfig(wanted);
  lastPolice = police;
  lastActorPos = { x: actorPos.x, z: actorPos.z };
  // At most one roadblock unit at a time (assigned below, first blind unit).
  const anyRoadblock = police.some((c) => c.userData.mode === 'roadblock');
  let assignedRoadblock = anyRoadblock;
  for (const c of police) {
    const u = c.userData;
    initPoliceState(c, actorPos);
    u.loseAfter = cfg.loseAfter;
    u.searchSeconds = cfg.searchSeconds;
    const dx = actorPos.x - c.position.x;
    const dz = actorPos.z - c.position.z;
    const dist = Math.hypot(dx, dz);
    const moved = Math.hypot(c.position.x - u.lastPX, c.position.z - u.lastPZ);
    u.lastPX = c.position.x; u.lastPZ = c.position.z;

    // --- sight / state machine (new; movement below is unchanged D1) ---
    const seesPlayer = hasLineOfSight(buildings, c.position.x, c.position.z, actorPos.x, actorPos.z);
    u.seesPlayer = seesPlayer;
    if (u.mode === 'roadblock') {
      // Holding a roadblock: re-engage the moment the player is seen or
      // comes close; stand down to SEARCH if the heat drops below 4.
      if (wanted < 4) { u.mode = 'search'; u.searchTimer = 0; u.holding = false; }
      else if (seesPlayer || dist < 25) {
        u.mode = 'pursue'; u.lostTimer = 0; u.searchTimer = 0; u.holding = false;
      }
    } else if (seesPlayer) {
      u.mode = 'pursue';
      u.lostTimer = 0; u.searchTimer = 0;
      u.lastSeenX = actorPos.x; u.lastSeenZ = actorPos.z;
    } else {
      u.lostTimer += dt;
      if (u.mode === 'pursue' && u.lostTimer > u.loseAfter) {
        u.mode = 'search';
        u.searchTimer = 0;
        u.searchLeg = 0;
        u.searchTX = nearestRoadCoord(u.lastSeenX);
        u.searchTZ = nearestRoadCoord(u.lastSeenZ);
      } else if (u.mode === 'search') {
        u.searchTimer += dt;
      }
      // Roadblock assignment (G-02): at wanted 4+, the first blind unit
      // that already lost the player — or is far away and blind — stops
      // sweeping and holds the road ahead of the player instead: the
      // intersection 36 units past the player on the unit-to-player line.
      if (wanted >= 4 && !assignedRoadblock && (u.mode === 'search' || dist > 60)) {
        const inv = 1 / (dist || 1);
        u.roadblockTX = nearestRoadCoord(actorPos.x + dx * inv * 36);
        u.roadblockTZ = nearestRoadCoord(actorPos.z + dz * inv * 36);
        u.mode = 'roadblock';
        u.holding = false;
        assignedRoadblock = true;
      }
    }
    // Arrived at the assigned intersection: hold position, face the player.
    const atRoadblock = u.mode === 'roadblock'
      && Math.hypot(u.roadblockTX - c.position.x, u.roadblockTZ - c.position.z) < 6;

    // --- D1 unstick branch: VERBATIM logic from vehicles.js. ---
    if (u.unstick > 0) {
      // Back out of the corner while turning, then re-engage.
      // Ring escape: a unit sitting inside the 1.6 clearance ring cannot
      // move at all under the normal margin check (every nearby step still
      // collides), so while unsticking it only has to stay out of the
      // building core itself (radius 0) — the clearance ring is free to
      // cross on the way out.
      u.unstick -= dt;
      u.speed = -7;
      c.rotation.y += u.unstickDir * 2.2 * dt;
      const escapeMargin = collidesBuilding(buildings, c.position.x, c.position.z, 1.6) ? 0 : 1.6;
      const nx = c.position.x + Math.sin(c.rotation.y) * u.speed * dt;
      const nz = c.position.z + Math.cos(c.rotation.y) * u.speed * dt;
      if (!collidesBuilding(buildings, nx, c.position.z, escapeMargin)) c.position.x = nx;
      if (!collidesBuilding(buildings, c.position.x, nz, escapeMargin)) c.position.z = nz;
      c.position.x = clamp(c.position.x, -163, 150);
      c.position.z = clamp(c.position.z, -163, 163);
      if (u.unstick <= 0) { u.stuckTimer = 0; u.speed = 0; }
      animateCar(c, dt, u.unstickDir);
      continue;
    }
    if (moved < 0.05 && dist > 8 && !atRoadblock) {
      u.stuckTimer += dt;
      if (u.stuckTimer > 0.8) {
        u.unstick = 1.4;
        u.unstickDir = (((c.position.x * 7 + c.position.z * 13) % 2) + 2) % 2 < 1 ? 1 : -1;
      }
    } else {
      u.stuckTimer = Math.max(0, u.stuckTimer - dt * 2);
    }

    // --- roadblock hold: stopped on purpose, not frozen (D1 guard above
    // already skips the stuck detector while holding). Face the player.
    if (atRoadblock) {
      u.holding = true;
      u.speed = 0;
      const face = Math.atan2(actorPos.x - c.position.x, actorPos.z - c.position.z);
      const fd = ((face - c.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.rotation.y += clamp(fd, -2.4 * dt, 2.4 * dt);
      animateCar(c, dt, 0);
      continue;
    }
    u.holding = false;

    // --- steering target (D1 routing, generalised to a goal point) ---
    // Pursuit goal: the player. Search goal: last-seen point, then the
    // neighbouring intersections, one leg at a time. Roadblock goal: the
    // assigned intersection ahead of the player.
    let goalX = actorPos.x;
    let goalZ = actorPos.z;
    if (u.mode === 'roadblock') {
      goalX = u.roadblockTX;
      goalZ = u.roadblockTZ;
    } else if (u.mode === 'search') {
      const atSearchTarget = Math.hypot(u.searchTX - c.position.x, u.searchTZ - c.position.z) < 6;
      if (atSearchTarget) {
        // Pick the next neighbouring intersection to sweep: alternate
        // legs around the last-seen point so the car covers the block
        // instead of circling one corner.
        u.searchLeg += 1;
        const leg = u.searchLeg % 4;
        const baseX = nearestRoadCoord(u.lastSeenX);
        const baseZ = nearestRoadCoord(u.lastSeenZ);
        u.searchTX = leg === 0 ? baseX + 36 : leg === 1 ? baseX : leg === 2 ? baseX - 36 : baseX;
        u.searchTZ = leg === 0 ? baseZ : leg === 1 ? baseZ + 36 : leg === 2 ? baseZ : baseZ - 36;
      }
      goalX = u.searchTX;
      goalZ = u.searchTZ;
    }
    let tx = goalX;
    let tz = goalZ;
    if (!seesPlayer || u.mode === 'search' || u.mode === 'roadblock') {
      // Route via the road grid: head for the intersection nearest the goal
      // that is also nearest to this car, one leg at a time — axis-aligned,
      // staying on the road the car is already nearest to first, so the car
      // never cuts diagonally across a block corner.
      tx = nearestRoadCoord(goalX);
      tz = nearestRoadCoord(goalZ);
      const carRoadX = nearestRoadCoord(c.position.x);
      const carRoadZ = nearestRoadCoord(c.position.z);
      if (Math.abs(c.position.x - carRoadX) <= Math.abs(c.position.z - carRoadZ)) {
        tx = carRoadX; // first leg: along the car's vertical road
      } else {
        tz = carRoadZ; // first leg: along the car's horizontal road
      }
    }
    const tdx = tx - c.position.x;
    const tdz = tz - c.position.z;
    const target = Math.atan2(tdx, tdz);
    let delta = ((target - c.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    c.rotation.y += clamp(delta, -2.4 * dt, 2.4 * dt);
    // Top speed: pursuit keeps the vehicles.js cap (12 + wanted * 1.5);
    // a cold search cruises slower so a lost player can actually slip away.
    const topSpeed = u.mode === 'search' && u.searchTimer > u.searchSeconds
      ? 6
      : 12 + wanted * 1.5;
    c.userData.speed = clamp(c.userData.speed + dt * 10, 0, topSpeed);
    const nx = c.position.x + Math.sin(c.rotation.y) * c.userData.speed * dt;
    const nz = c.position.z + Math.cos(c.rotation.y) * c.userData.speed * dt;
    // Building avoidance: slide along the blocked axis, never pass through.
    // Ring escape (same rule as the unstick branch): a unit already inside
    // the clearance ring may cross the ring to get out, it just must not
    // enter the building core itself.
    const margin = collidesBuilding(buildings, c.position.x, c.position.z, 1.6) ? 0 : 1.6;
    if (!collidesBuilding(buildings, nx, c.position.z, margin)) c.position.x = nx;
    else c.userData.speed *= 0.6;
    if (!collidesBuilding(buildings, c.position.x, nz, margin)) c.position.z = nz;
    else c.userData.speed *= 0.6;
    c.position.x = clamp(c.position.x, -163, 150);
    c.position.z = clamp(c.position.z, -163, 163);
    animateCar(c, dt, Math.sign(delta));
    if (u.mode === 'pursue' && dist < 4.2 && seesPlayer) onRam(dt);
  }
  refreshPolicePanel();
}

/**
 * Spawn one police car at a random bearing, 48 units from the actor.
 * The spawn point is validated clear of buildings (margin 2.2, above the
 * 1.6 collision radius); after 8 blocked tries it falls back to the
 * nearest road intersection, which is always clear of buildings.
 * Identical to vehicles.js spawnPoliceCar, plus the search-state fields.
 */
export function spawnPoliceCar(scene, actorPos, rng, buildings = null) {
  const c = makeCar(0x172d49, true);
  let x = 0;
  let z = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const angle = rng() * Math.PI * 2;
    x = clamp(actorPos.x + Math.cos(angle) * 48, -150, 150);
    z = clamp(actorPos.z + Math.sin(angle) * 48, -150, 150);
    if (!buildings || !collidesBuilding(buildings, x, z, 2.2)) break;
    if (attempt === 7) {
      x = nearestRoadCoord(x);
      z = nearestRoadCoord(z);
    }
  }
  c.position.set(x, 0, z);
  c.userData.speed = 0;
  c.userData.mode = 'pursue';
  c.userData.callsign = nextCallsign();
  c.userData.lastSeenX = actorPos.x;
  c.userData.lastSeenZ = actorPos.z;
  c.userData.lostTimer = 0;
  c.userData.searchTimer = 0;
  scene.add(c);
  return c;
}

// Public API for the HUD, tests and the garage (setWanted(0) to clear heat).
if (typeof window !== 'undefined') {
  window.SuncoastPolice = {
    getResponseUnits,
    getWanted,
    setWanted,
    getSearchState,
  };
}
