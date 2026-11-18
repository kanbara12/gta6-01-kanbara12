// Shared constants and deterministic random helpers for SUNCOAST: HEATLINE.
// One clear job: every tunable number and every seedable random source lives here,
// so the world, the traffic and the ?shot= scenes all agree on the same numbers.

export const WORLD = {
  grid: 36, // city block pitch in world units
  blocks: 4, // blocks from -4..3 on each axis
  half: 163, // playable clamp on x/z (city edge)
  coastX: 138, // where the beach starts (east edge)
  oceanX: 152, // where the water plane starts
  oceanFar: 300, // where the water plane ends
  roadHalf: 6.5, // half width of a road
  lane: 2.7, // traffic lane offset from a road centre
};

export const COLOURS = {
  skyTop: 0x3d2b6e, // deep violet zenith at sunset
  skyMid: 0xc65a7a, // pink-magenta band above the horizon
  skyHorizon: 0xff9e57, // vivid sunset orange
  fog: 0xe08a6d, // warm haze
  ocean: 0x27617f,
  oceanDeep: 0x14384f,
  sand: 0xf0c98f,
  boardwalk: 0x9a6f4a,
  road: 0x3a3238, // warm charcoal asphalt
  sidewalk: 0xa8907c,
  grass: 0x4d7a52,
  gold: 0xffd166,
  cyan: 0x66e5ff,
  palmTrunk: 0x7a5230,
  palmLeaf: 0x2f7a4a,
  neonPink: 0xff4d8d,
  neonCyan: 0x33e0ff,
  neonGold: 0xffc44d,
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Time-of-day presets (rendering.js). `golden` reproduces the shipped look
 * exactly (sun -65,110,45, fog 105–320, exposure 1.08); the others are
 * the day/night cycle. sunPos is the sun offset direction from the actor;
 * the shadow frustum follows the actor, so the values stay small and tight.
 */
export const TIME_PRESETS = {
  golden: {
    label: 'Golden Hour', sun: 0xffe1b2, sunIntensity: 2.4, sunPos: [-65, 110, 45],
    hemiSky: 0xd9f5ff, hemiGround: 0x38404a, hemiIntensity: 2.0, fillIntensity: 0.7,
    fog: 0x9fc4cf, fogNear: 105, fogFar: 320, exposure: 1.08, bg: 0x87b7c8,
    ocean: 0x27617f, oceanRoughness: 0.25, oceanMetalness: 0.35,
  },
  noon: {
    label: 'Midday', sun: 0xfff3d6, sunIntensity: 3.0, sunPos: [-20, 160, 30],
    hemiSky: 0xbfe8ff, hemiGround: 0x4a5248, hemiIntensity: 2.2, fillIntensity: 0.9,
    fog: 0xa8c8d4, fogNear: 130, fogFar: 380, exposure: 1.0, bg: 0x8fc3d9,
    ocean: 0x2a6d8a, oceanRoughness: 0.18, oceanMetalness: 0.3,
  },
  dusk: {
    label: 'Dusk', sun: 0xff8a4d, sunIntensity: 1.9, sunPos: [-110, 42, 20],
    hemiSky: 0x8a6a9e, hemiGround: 0x2e2438, hemiIntensity: 1.3, fillIntensity: 0.45,
    fog: 0xd96a72, fogNear: 80, fogFar: 260, exposure: 1.12, bg: 0x5a3a5e,
    ocean: 0x1d4258, oceanRoughness: 0.12, oceanMetalness: 0.6,
  },
  night: {
    label: 'Night', sun: 0x9db8ff, sunIntensity: 0.55, sunPos: [40, 120, -60],
    hemiSky: 0x2a3550, hemiGround: 0x0e1218, hemiIntensity: 0.8, fillIntensity: 0.3,
    fog: 0x1a2436, fogNear: 60, fogFar: 220, exposure: 1.05, bg: 0x0b1626,
    ocean: 0x0e2838, oceanRoughness: 0.15, oceanMetalness: 0.55,
  },
};

/** mulberry32: small deterministic PRNG. Same seed -> same stream, every run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 hash of an integer, for per-block variation without state. */
export function seeded(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Parse ?shot= and ?seed= / ?hud= / ?quality= / ?time= / ?rain= from the page URL. */
export function parseQuery() {
  const q = new URLSearchParams(location.search);
  const shot = (q.get('shot') || '').toLowerCase();
  const seed = Number.parseInt(q.get('seed') || '1', 10) || 1;
  const hud = q.get('hud');
  const quality = (q.get('quality') || '').toLowerCase();
  const time = (q.get('time') || '').toLowerCase();
  const rain = Math.max(0, Math.min(1, Number.parseFloat(q.get('rain') || '0') || 0));
  return { shot, seed, hud, hideHud: hud === '0' || shot !== '', quality, time, rain };
}
