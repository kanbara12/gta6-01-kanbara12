// Graphics + audio settings for SUNCOAST: HEATLINE.
// One clear job: the quality presets and the persisted player settings
// (localStorage). The renderer (rendering.js), the HUD settings panel
// (index.html) and main.js all read from here, so a preset means the same
// thing everywhere. Changing quality never needs a page reload except for
// antialias, which WebGL fixes at context creation — that case is flagged
// to the player instead of silently ignored.

export const QUALITY_PRESETS = {
  low: {
    label: 'Low', pixelRatio: 1, shadowSize: 1024, antialias: false,
    particles: 0.35, rainMax: 450, shadows: true, vignette: false,
    shadowRange: 55,
  },
  medium: {
    label: 'Medium', pixelRatio: 1.25, shadowSize: 1024, antialias: true,
    particles: 0.65, rainMax: 800, shadows: true, vignette: true,
    shadowRange: 60,
  },
  high: {
    label: 'High', pixelRatio: 1.7, shadowSize: 2048, antialias: true,
    particles: 1, rainMax: 1200, shadows: true, vignette: true,
    shadowRange: 65,
  },
  ultra: {
    label: 'Ultra', pixelRatio: 2, shadowSize: 4096, antialias: true,
    particles: 1, rainMax: 1800, shadows: true, vignette: true,
    shadowRange: 75,
  },
};

export const QUALITY_NAMES = Object.keys(QUALITY_PRESETS);
export const TIME_NAMES = ['golden', 'noon', 'dusk', 'night'];

export const SETTINGS_KEY = 'suncoast-settings-v1';

export const DEFAULT_SETTINGS = {
  quality: 'high',
  master: 0.5,
  music: 0.6,
  sfx: 0.8,
  musicOn: true,
  timeOfDay: 'golden',
  rain: 0, // 0 = dry, 1 = heavy rain + wet roads
};

export function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const saved = JSON.parse(raw);
    for (const k of Object.keys(out)) {
      if (saved[k] === undefined) continue;
      if (k === 'quality' && !QUALITY_PRESETS[saved[k]]) continue;
      if (k === 'timeOfDay' && !TIME_NAMES.includes(saved[k])) continue;
      if (typeof saved[k] === 'number') out[k] = Math.max(0, Math.min(1, saved[k]));
      else out[k] = saved[k];
    }
  } catch { /* corrupt save: fall back to defaults */ }
  return out;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* storage full/blocked: settings just don't persist */ }
}

/** Preset object for a name, falling back to High for unknown names. */
export function presetFor(name) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
}

/** Apply the DOM side of a preset (vignette overlay). Renderer side lives in rendering.js. */
export function applyQualityToDom(preset) {
  document.body.classList.toggle('vignette-on', !!preset.vignette);
}
