// Crew dialog box for SUNCOAST: HEATLINE.
// One clear job: a named crew member speaks in a bottom-centre box with an
// original CSS portrait (initials on a per-crew gradient — never a photo),
// triggered by stage changes and by wanted-level rises.
//
// The box is created by this module itself (it owns its DOM + CSS, injected
// once), so no other file has to be edited to load it: police.js imports
// this module for its side effect, which also installs window.SuncoastDialog.
//
// API (window.SuncoastDialog):
//   show({ name, role, portrait, text, ms }) — portrait is a crew key
//     ('rae' | 'marlo' | 'sable') or 1-2 initials; text is the spoken line.
//   showCrew(key, text, ms) — shorthand for a known crew member.
//   notifyStage(stage, line) — stage-change hook for the missions module:
//     shows the line given (or a built-in default) exactly once per stage.
//   hide() — dismiss the box immediately.
//   crew — the crew table (name / role / colours), read-only copy.

export const CREW = {
  rae: {
    key: 'rae', name: 'RAE', role: 'FIXER', initials: 'R',
    from: '#ff7a59', to: '#b34a2e',
    tagline: 'runs the jobs, holds the money',
  },
  marlo: {
    key: 'marlo', name: 'MARLO', role: 'DRIVER', initials: 'M',
    from: '#3ec6d8', to: '#1d5f8a',
    tagline: 'wheelman, getaway specialist',
  },
  sable: {
    key: 'sable', name: 'SABLE', role: 'LOOKOUT', initials: 'S',
    from: '#b388ff', to: '#5b3a9e',
    tagline: 'rooftops, radios, early warnings',
  },
};

// Built-in lines (original, written for this game). The missions module may
// pass its own per-stage line to notifyStage(); these defaults only fill
// the gap so the box still speaks even before that wiring lands.
const WANTED_LINES = {
  1: { crew: 'sable', text: 'One unit on your tail. Keep it clean — don\u2019t hand them a second.' },
  2: { crew: 'marlo', text: 'Two units now. Stay on the main roads, I can shake them there.' },
  3: { crew: 'rae', text: 'Three units and climbing. Break their line of sight — side streets, not avenues.' },
  4: { crew: 'sable', text: 'Four units, they\u2019re calling it in. Get off the main strip, now.' },
  5: { crew: 'rae', text: 'Full response. Five stars. Lose them or lose everything — your call.' },
};

const STAGE_LINES = [
  { crew: 'rae', text: 'First job, first rule: the marker is the meeting. Go.' },
  { crew: 'marlo', text: 'Cargo run. East two blocks — I\u2019ll have the car facing out.' },
  { crew: 'sable', text: 'Eyes on the south-west. The safehouse door is already open for you.' },
  { crew: 'rae', text: 'The yard\u2019s gone sour. Three of them stand between you and my money.' },
  { crew: 'marlo', text: 'Heat\u2019s on. Garage north — park it, kill the lights, breathe.' },
  { crew: 'sable', text: 'Overlook. Last stretch of road. Don\u2019t look back till you\u2019re there.' },
  { crew: 'marlo', text: 'Two jobs left on the board. Fuel\u2019s full, tires are warm — say the word.' },
  { crew: 'rae', text: 'Last one. Bring it home clean and we\u2019re done talking about this town.' },
];

const DEFAULT_MS = 5200;
const AUTO_COOLDOWN_MS = 5000;

let boxEl = null;
let portraitEl = null;
let nameEl = null;
let roleEl = null;
let textEl = null;
let hideTimer = 0;
let styleInjected = false;

// Auto-trigger bookkeeping: last wanted / stage the watcher has announced,
// plus a single pending line when the cooldown is still running.
let lastWantedSeen = 0;
let lastStageSeen = -1;
let lastAutoAt = 0;
let pendingAuto = null;

function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = [
    '#crewDialog{position:absolute;left:50%;bottom:108px;transform:translateX(-50%) translateY(8px);',
    'width:min(520px,calc(100vw - 40px));display:flex;gap:12px;align-items:center;',
    'padding:12px 16px;opacity:0;visibility:hidden;transition:opacity .25s,transform .25s,visibility .25s;z-index:6}',
    '#crewDialog.show{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}',
    '#crewPortrait{flex:0 0 46px;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    'font-size:21px;font-weight:950;color:#fff;border:2px solid rgba(255,255,255,.55);',
    'box-shadow:0 0 0 3px rgba(102,229,255,.22),0 4px 14px rgba(0,0,0,.4);text-shadow:0 1px 3px rgba(0,0,0,.5)}',
    '#crewDialogText{min-width:0}',
    '#crewName{font-size:12px;font-weight:900;letter-spacing:1.5px;color:#fff}',
    '#crewName span{color:#66e5ff;font-size:9px;letter-spacing:2px;margin-left:7px}',
    '#crewLine{font-size:12.5px;line-height:1.45;color:#d8e9f2;margin-top:3px}',
    '@media(max-width:650px){#crewDialog{bottom:96px;padding:10px 12px}#crewPortrait{flex-basis:38px;width:38px;height:38px;font-size:17px}}',
  ].join('\n');
  document.head.appendChild(style);
}

function ensureBox() {
  if (boxEl) return boxEl;
  if (typeof document === 'undefined') return null;
  injectStyle();
  const host = document.getElementById('hud') || document.body;
  boxEl = document.createElement('div');
  boxEl.id = 'crewDialog';
  boxEl.className = 'panel';
  portraitEl = document.createElement('div');
  portraitEl.id = 'crewPortrait';
  const textWrap = document.createElement('div');
  textWrap.id = 'crewDialogText';
  nameEl = document.createElement('div');
  nameEl.id = 'crewName';
  roleEl = document.createElement('span');
  textEl = document.createElement('div');
  textEl.id = 'crewLine';
  nameEl.appendChild(document.createTextNode(''));
  nameEl.appendChild(roleEl);
  textWrap.appendChild(nameEl);
  textWrap.appendChild(textEl);
  boxEl.appendChild(portraitEl);
  boxEl.appendChild(textWrap);
  host.appendChild(boxEl);
  return boxEl;
}

/** Resolve a portrait spec to { initials, from, to }. */
function resolvePortrait(portrait) {
  if (typeof portrait === 'string') {
    const key = portrait.toLowerCase();
    if (CREW[key]) {
      const c = CREW[key];
      return { initials: c.initials, from: c.from, to: c.to };
    }
    const initials = portrait.trim().slice(0, 2).toUpperCase();
    if (initials) return { initials, from: '#3ec6d8', to: '#1d5f8a' };
  }
  return { initials: '?', from: '#3ec6d8', to: '#1d5f8a' };
}

/**
 * Show one dialog line. `opts`: { name, role, portrait, text, ms }.
 * portrait is a crew key or initials; role is a short caps label.
 * Returns true when the box was shown.
 */
export function show(opts = {}) {
  const text = String(opts.text || '').trim();
  if (!text) return false;
  ensureBox();
  if (!boxEl) return false;
  const name = String(opts.name || 'RAE').toUpperCase();
  const role = String(opts.role || '').toUpperCase();
  const look = resolvePortrait(opts.portrait || opts.crew || name.toLowerCase());
  portraitEl.textContent = look.initials;
  portraitEl.style.background = `linear-gradient(135deg, ${look.from}, ${look.to})`;
  nameEl.firstChild.textContent = name + ' ';
  roleEl.textContent = role;
  textEl.textContent = text;
  boxEl.classList.add('show');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, Math.max(1200, opts.ms || DEFAULT_MS));
  return true;
}

/** Shorthand: a known crew member speaks one line. */
export function showCrew(key, text, ms) {
  const c = CREW[String(key || '').toLowerCase()];
  if (!c) return show({ name: key, text, ms });
  return show({ name: c.name, role: c.role, portrait: c.key, text, ms });
}

/** Dismiss the box immediately. */
export function hide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
  if (boxEl) boxEl.classList.remove('show');
}

/**
 * Stage-change hook (called by the missions module, or by the watcher
 * below when it sees the stage move). `line` may be a plain string or a
 * { name, role, portrait, text, ms } object; without it the built-in
 * default for that stage speaks. Shows at most once per stage value.
 */
export function notifyStage(stage, line) {
  const i = Math.max(0, Math.min(STAGE_LINES.length - 1, stage | 0));
  if (lastStageSeen === i) return false;
  lastStageSeen = i;
  if (typeof line === 'string' && line.trim()) {
    const def = STAGE_LINES[i];
    return showCrew(def.crew, line);
  }
  if (line && typeof line === 'object' && line.text) return show(line);
  const def = STAGE_LINES[i];
  return showCrew(def.crew, def.text);
}

/** Wanted-rise hook: the crew reacts when the heat goes up a level. */
export function notifyWanted(level) {
  const n = Math.max(0, Math.min(5, level | 0));
  if (n <= 0 || n === lastWantedSeen) return false;
  lastWantedSeen = n;
  const line = WANTED_LINES[n];
  if (!line) return false;
  return showCrew(line.crew, line.text);
}

// ------------------------------------------------------- auto watcher
// The dialog owns its triggers: once the game object exists it polls the
// live wanted level and mission index (cheap, 2 reads per 400 ms) and
// speaks on a rise / a stage change. notifyStage / notifyWanted share the
// same last-seen guards, so a manual call and the watcher can never
// double-announce the same event. A 5 s cooldown keeps auto lines from
// stacking; a line that arrives mid-cooldown waits in a single slot.
function maybeAuto(fn) {
  const now = performance.now();
  if (now - lastAutoAt < AUTO_COOLDOWN_MS) {
    pendingAuto = fn;
    return;
  }
  lastAutoAt = now;
  fn();
}

function watchTick() {
  const g = typeof window !== 'undefined' ? window.__game : null;
  if (!g) return;
  if (pendingAuto && performance.now() - lastAutoAt >= AUTO_COOLDOWN_MS) {
    const fn = pendingAuto;
    pendingAuto = null;
    lastAutoAt = performance.now();
    fn();
  }
  if (!g.gameStarted || g.gameOver) return;
  const wanted = g.wanted | 0;
  if (wanted > lastWantedSeen) {
    lastWantedSeen = wanted; // guard set here; notifyWanted re-checks anyway
    const line = WANTED_LINES[wanted];
    if (line) maybeAuto(() => showCrew(line.crew, line.text));
  } else if (wanted < lastWantedSeen) {
    // Heat fell (garage / cooldown): re-arm so the next rise speaks again.
    lastWantedSeen = wanted;
  }
  const stage = g.missionIndex | 0;
  if (lastStageSeen === -1) { lastStageSeen = stage; return; }
  if (stage !== lastStageSeen) {
    lastStageSeen = stage;
    const def = STAGE_LINES[Math.max(0, Math.min(STAGE_LINES.length - 1, stage))];
    if (def) maybeAuto(() => showCrew(def.crew, def.text));
  }
}

function startWatcher() {
  if (typeof window === 'undefined') return;
  if (window.__game) setInterval(watchTick, 400);
  else window.addEventListener('suncoast-ready', () => setInterval(watchTick, 400), { once: true });
}

if (typeof document !== 'undefined') ensureBox();
if (typeof window !== 'undefined') startWatcher();

if (typeof window !== 'undefined') {
  window.SuncoastDialog = {
    show,
    showCrew,
    hide,
    notifyStage,
    notifyWanted,
    crew: JSON.parse(JSON.stringify(CREW)),
  };
}
