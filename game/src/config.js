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
  skyTop: 0x2f7fb8,
  skyHorizon: 0xf7c98b,
  fog: 0x9fc4cf,
  ocean: 0x1d6f8f,
  oceanDeep: 0x0e4a68,
  sand: 0xd9c08a,
  boardwalk: 0x8a6a4a,
  road: 0x27343c,
  sidewalk: 0x9a9a8b,
  grass: 0x47765b,
  gold: 0xffd166,
  cyan: 0x66e5ff,
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

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

/** Parse ?shot= and ?seed= / ?hud= from the page URL. */
export function parseQuery() {
  const q = new URLSearchParams(location.search);
  const shot = (q.get('shot') || '').toLowerCase();
  const seed = Number.parseInt(q.get('seed') || '1', 10) || 1;
  const hud = q.get('hud');
  return { shot, seed, hud, hideHud: hud === '0' || shot !== '' };
}
