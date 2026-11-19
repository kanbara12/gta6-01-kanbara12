// World constants for SUNCOAST: HEATLINE — owned by the World Environment
// specialist. Nothing here is read by core/config.js; these are world-only
// tunables so the district layout, clear zones and day/night keyframes can
// change without touching any other module.
//
// Coordinate frame (same as core/config.js WORLD):
//   roads run every 36 units, centred on multiples of 36; blocks are 36x36
//   with centres at (gx*36+18, gz*36+18), gx/gz in -4..3.
//   Coast / beach starts at x = 138, ocean at x = 152. Playable clamp x/z
//   is +/-163. The city must keep every building footprint inside its block
//   with its edge at most 11 units from the block centre: the road occupies
//   6.5 units either side of the road centreline and the sidewalk band sits
//   at 6.5..9 from it, so 18 - 11 = 7 units of clearance from the road
//   centreline keeps facades off the road AND off the sidewalk (pedestrians
//   walk at road-centre +/- 8.5).

export const BLOCK_EXTENT = 11; // max |offset| + half-size of any building, from block centre.
  // Geometry: the road occupies 6.5 units either side of its centreline and
  // the sidewalk band sits at 6.5..9 from it, so extent 11 keeps every
  // facade OFF the asphalt (0.5 clear of the road edge) and flush with the
  // sidewalk's outer edge, as in a real downtown. Pedestrians spawn and pick
  // waypoints through collidesBuilding checks, so they route around any
  // facade that covers part of the sidewalk band; the v1 code allowed
  // extent 15.6, which put facades ON the road itself.

// Points that must NEVER be covered by a building footprint (radius in
// world units). Values copied from the systems that use them:
//   missions.js MISSION_POINTS + GANG_ZONE, main.js player/car/crate spawns,
//   shots.js 'end'/'mission' staging positions, chase/play road positions.
export const CLEAR_POINTS = [
  { x: 0, z: 0, r: 8, why: 'player spawn (-5,0) + SMG crate (6,6)' },
  { x: 8.5, z: 8.5, r: 4, why: 'mission 0 fixer on the sidewalk corner' },
  { x: 36, z: 0, r: 8, why: 'mission 1 approach (intersection kept clear)' },
  { x: 44.5, z: 8.5, r: 4, why: 'mission 1 package pickup on the sidewalk corner' },
  { x: -36, z: 36, r: 8, why: 'mission 2 safehouse delivery' },
  { x: 72, z: -72, r: 12, why: 'mission 3 crew yard (GANG_ZONE) + enemy spawns +/-8' },
  { x: 0, z: 72, r: 8, why: 'mission 4 garage' },
  { x: -72, z: -72, r: 8, why: 'mission 5 overlook' },
  { x: -66, z: -64, r: 7, why: "shots.js 'end' player staging" },
  { x: 72, z: -56, r: 7, why: "shots.js 'mission' player staging" },
  { x: -36, z: 60, r: 7, why: "shots.js 'play' driving staging" },
  { x: 0, z: -20, r: 7, why: "shots.js 'chase' player car staging" },
  { x: 4, z: 2, r: 6, why: 'player car spawn' },
];

// District of a block (gx, gz). The east column (gx === 3) is the coast.
export function districtFor(gx, gz) {
  if (gx === 3) {
    if (gz <= -3) return 'port';
    if (gz >= 2) return 'marina';
    return 'waterfront';
  }
  if (gx === 2 && gz === -3) return 'yard'; // open crew yard, containers at edges only
  if (gx >= 0 && gx <= 1 && gz >= -3 && gz <= -1) return 'downtown';
  if (gx === 2 && gz === -2) return 'industrial';
  if ((gx === -2 && gz === -1) || (gx === 2 && gz === -1)) return 'garage';
  if ((gx === 2 && gz === 1) || (gx === -1 && gz === 3)) return 'gas';
  if (gx >= 0 && gx <= 1 && gz === 2) return 'nightlife';
  if (gx === -2 && gz === 0) return 'park'; // central park
  if ((gx === -3 && (gz === 2 || gz === -2)) || (gx === -2 && gz === 3)) return 'park';
  if (gx >= -1 && gx <= 2 && gz >= 0 && gz <= 1) return 'commercial';
  return 'residential';
}

// Facade palettes per district (original colours, sunset-coastal direction:
// warm stucco, terracotta, pastel art-deco, glass blue-green towers).
export const PALETTES = {
  downtown: [0x5d7d8c, 0x7d99a8, 0x4a6a7d, 0x8a9aa8, 0x6b7f8c, 0x3f5a6b],
  waterfront: [0x5d7d8c, 0x6b8a99, 0x4a6a7d, 0x7fa8b5],
  commercial: [0xe2725b, 0xf2a37c, 0xd97b6c, 0xf0d0a0, 0xc96f4a, 0x9a7bb8, 0x7a9a8a],
  residential: [0xf0d0a0, 0xe8b4a0, 0xf2a37c, 0xd9c9a0, 0xb8d0c0, 0xe2725b, 0xc9a0b8],
  nightlife: [0x2c2a4a, 0x3d2b6e, 0x4a2a4a, 0x6e2b4a, 0x2a3d4a],
  industrial: [0x8a7f70, 0x9a8a7a, 0x6b6f75, 0x7a6a5a, 0x5a6a72],
  port: [0x6b6f75, 0x7a6a5a, 0x5a6a72],
};

export const CONTAINER_COLOURS = [0xc65a3a, 0x2f7a4a, 0x3a6ab5, 0xd9a03a, 0x7a4a8a, 0x4a8a7a];

// Neon sign texts (original copy — generic businesses, no reference to any
// other entry). Rendered on procedural canvas textures in textures.js.
export const NEON_SIGNS = [
  { text: 'SUNSET HOTEL', fg: '#ff4d8d', bg: '#1c0f2a' },
  { text: 'PALM CLUB', fg: '#33e0ff', bg: '#0a1a2a' },
  { text: 'REEF CASINO', fg: '#ffc44d', bg: '#2a0f1c' },
  { text: 'SUNSET COVE', fg: '#ff4d8d', bg: '#1c0f2a' },
  { text: 'NEON BAR', fg: '#ff4d8d', bg: '#120a24' },
  { text: 'TACO STAND', fg: '#a7f36c', bg: '#1a2a0f' },
  { text: 'MARINA', fg: '#33e0ff', bg: '#0a2030' },
  { text: 'PIER 9', fg: '#ffd166', bg: '#101a2a' },
  { text: 'GAS • 24H', fg: '#ff6b4a', bg: '#14100a' },
];

// Day/night keyframes. `hour` is 0..24. Colours are hex; sunI/hemiI are
// light intensities; lampGlow 0..1 drives street-lamp + window emissive;
// sunPos is [x, y] in the sky dome (z fixed at -60, west-facing sunset side).
// D-QA4 (Nov 2026): true-night keyframes (0 / 22 / 24) used to run at
// sunI 0.25 / hemiI 0.3, which left facades near-black — only lit windows
// read. They now run at sunI 0.55 / hemiI 0.6 (pre-dawn 0.45 / 0.5): facades
// stay readable while the night mood, lamp glow and window emissive are
// untouched. G-09 (v3, Nov 2026): the sunset keyframes (16 / 18.7 / 20)
// run warmer + pinker than v2 — deeper violet zenith, hot-pink mid band,
// coral-pink horizon — so the default dusk frame reads as a pink-purple
// sunset instead of flat orange. Noon / night keyframes are unchanged.
// The default game state is the sunset keyframe (hour 18.7) so the shipped
// look is unchanged unless the coordinator calls setTimeOfDay().
export const DAY_KEYFRAMES = [
  { hour: 0, top: 0x0a0e27, mid: 0x1b2340, horizon: 0x2c2a4a, fog: 0x141a2e, sun: 0x8fa8ff, sunI: 0.55, hemiI: 0.6, lampGlow: 1, sunPos: [140, 120] },
  { hour: 5, top: 0x141a3d, mid: 0x2c2a55, horizon: 0x4a3a5e, fog: 0x1c2036, sun: 0x8fa8ff, sunI: 0.45, hemiI: 0.5, lampGlow: 1, sunPos: [160, 90] },
  { hour: 6.5, top: 0x4a3a7a, mid: 0xd96a6a, horizon: 0xffb36b, fog: 0xd98a7a, sun: 0xffc27a, sunI: 1.4, hemiI: 0.9, lampGlow: 0.55, sunPos: [300, 42] },
  { hour: 9, top: 0x3f6fb5, mid: 0x7fb2d9, horizon: 0xf2c98a, fog: 0xbccfd8, sun: 0xfff2cf, sunI: 2.6, hemiI: 1.6, lampGlow: 0, sunPos: [190, 210] },
  { hour: 12, top: 0x2f6fc2, mid: 0x79b5e0, horizon: 0xcfe8ef, fog: 0xc3d9e2, sun: 0xffffff, sunI: 2.8, hemiI: 1.8, lampGlow: 0, sunPos: [0, 300] },
  { hour: 16, top: 0x35548f, mid: 0xb05a8a, horizon: 0xff9e5e, fog: 0xd99a7a, sun: 0xffc98a, sunI: 2.4, hemiI: 1.5, lampGlow: 0.1, sunPos: [-190, 210] },
  { hour: 18.7, top: 0x2e1a5e, mid: 0xd14f83, horizon: 0xff8a5e, fog: 0xe57a68, sun: 0xffc98a, sunI: 2.4, hemiI: 2.0, lampGlow: 0.45, sunPos: [-320, 58] },
  { hour: 20, top: 0x241a4d, mid: 0x93396e, horizon: 0xe85a62, fog: 0x7a4258, sun: 0xff9a6a, sunI: 0.9, hemiI: 0.7, lampGlow: 0.9, sunPos: [-330, 30] },
  { hour: 22, top: 0x0a0e27, mid: 0x1b2340, horizon: 0x2c2a4a, fog: 0x141a2e, sun: 0x8fa8ff, sunI: 0.55, hemiI: 0.6, lampGlow: 1, sunPos: [140, 120] },
  { hour: 24, top: 0x0a0e27, mid: 0x1b2340, horizon: 0x2c2a4a, fog: 0x141a2e, sun: 0x8fa8ff, sunI: 0.55, hemiI: 0.6, lampGlow: 1, sunPos: [140, 120] },
];
