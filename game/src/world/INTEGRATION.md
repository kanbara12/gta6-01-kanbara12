# World — INTEGRATION.md (World Environment Specialist)

## Files (this partition only)

- `game/src/world/world.js` — city builder + API contract + environment controls.
- `game/src/world/constants.js` — district layout, clear points, palettes, day/night keyframes.
- `game/src/world/textures.js` — procedural canvas textures (runtime-generated, no files).
- `game/assets/world/README.md` — texture manifest (no binary assets).

## API contract — DO NOT BREAK

`world.js` exports (signatures identical to v1; imported by `core/main.js`,
`vehicles/vehicles.js`, `vehicles/traffic.js`, `characters/characters.js`,
`AI/police.js`, `AI/pedestrians.js`, `combat/combat.js`):

```js
buildWorld(scene) -> { world, buildings, ocean }
collidesBuilding(buildings, x, z, r = 0.8) -> boolean
hasLineOfSight(buildings, ax, az, bx, bz) -> boolean
nearestRoadCoord(v) -> number
animateOcean(ocean, t) -> void   // also advances rain when visible
setTimeOfDay(hour) -> void       // NEW
setWet(amount) -> void           // NEW
```

`buildings` entries keep `{ x, z, hw, hd, h }` and add `{ district, kind }`.

## New exports — how the coordinator wires them in main.js

### `setTimeOfDay(hour)` — hour in 0..24, e.g. `setTimeOfDay(12)`

Interpolates between the `DAY_KEYFRAMES` in `constants.js` and drives:
sky gradient, sun-disc / moon position + visibility, `scene.fog`
(color/near/far), `scene.background`, and the scene lights that `main.js`
already created (discovered by `buildWorld` via `scene.traverse`: the
shadow-casting `DirectionalLight` = sun, `HemisphereLight`, the other
`DirectionalLight` = fill). Also drives lamp-glow colour, window emissive
and ocean colour.

- Default state is sunset (hour 18.7) — the shipped look is unchanged
  unless the coordinator calls this.
- Safe to call before `buildWorld` (no-op). No per-frame call needed; call
  it when the time changes (e.g. once per in-game hour, or from a
  `?time=` query param if the coordinator adds one).
- Suggested wiring (coordinator's call, NOT done here — `main.js` is
  outside this partition): keep a `G.timeOfDay` (default 18.7), advance it
  slowly in the loop, call `setTimeOfDay(G.timeOfDay)` when it changes by
  ≥ 0.05 h. Do NOT call it every frame — it repaints the sky vertex
  colours each call.

### `setWet(amount)` — amount in 0..1, e.g. `setWet(0.8)`

- Roads + sidewalks: roughness down, colour darkened (wet asphalt).
- Ocean: roughness down. Puddles (14 pre-placed road puddles) fade in.
- Rain: a 900-point `THREE.Points` system fades in above 0.25 and falls —
  it is advanced inside the existing per-frame `animateOcean(ocean, t)`
  call, so **no extra loop hook is needed in `main.js`**.
- Suggested wiring: `setWet(0)` on start, `setWet(0.7–1)` during a rain
  event / mission, back to `0` after. Safe before `buildWorld` (no-op).

## Placement guarantees (verified in the harness, see below)

- Every building footprint stays inside its block:
  `|offset| + half-size ≤ 11` from the block centre, so no facade touches
  the asphalt (road edge is 6.5 from the road centreline).
- No building covers any `CLEAR_POINTS` entry (all 6 mission points,
  GANG_ZONE + enemy spawns, player/car/crate spawns, `?shot=` staging for
  `start/play/chase/mission/end`). The crew-yard block is open in the
  middle; containers/crates sit only at its edges.
- Known limitation (honest): facades may sit flush with the sidewalk's
  outer edge (extent 11 = 7 units from the road centreline, inside the
  6.5–9 sidewalk band). Pedestrians spawn and pick waypoints through
  `collidesBuilding` checks, so they route around; v1 was worse (extent
  up to 15.6 put facades ON the road). Thin props with no collision entry:
  gas-canopy poles, port-crane legs, billboard poles, marina docks/boats,
  pier, lighthouse rocks — cars/peds can pass through them; acceptable
  for thin poles, noted here so nobody "fixes" it by adding phantom
  footprints without checking the shot staging.

## Districts (see `districtFor(gx, gz)` in constants.js)

Downtown glass skyline (towers 30–64) · waterfront towers · commercial
streets (paired shops + back alley with dumpster/crates) · nightlife
(neon-signed clubs) · residential (stucco houses, pyramid roofs, yards) ·
industrial warehouses · open crew yard · 2 parking garages (3 decks) ·
2 gas stations (canopy, pumps, kiosk, price pylon) · 4 parks (central park
has pond + fountain) · beach + boardwalk + pier + dunes + lifeguard tower ·
marina (beach clubs, finger docks, sailboats) · industrial port (container
yard, 2 gantry cranes, docks, moored cargo ship, lighthouse).

## Textures

All procedural canvas textures (`textures.js`): facades, glass, asphalt
(with baked centre dashes + edge lines), sidewalk, sand, boardwalk, brick,
container ribs, awnings, neon signs, billboards, zebra crosswalks,
lighthouse bands. Zero image files, zero network requests.
