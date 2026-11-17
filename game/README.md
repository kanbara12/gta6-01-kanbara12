# SUNCOAST: HEATLINE — gta6-01 entry

An original Three.js open-world action game. A genre-inspired independent game:
it does not use GTA assets, characters, logos, map data, or any other
proprietary content. All art, audio and code in this game are original.

## Run

1. Serve this folder with any static HTTP server, for example:
   - `node ../serve.ts` (from the repository root), then open
     `http://localhost:8080`
   - or `python3 -m http.server 8000` inside `game/`
2. Open the URL in a modern desktop browser (Chrome recommended).
3. Click **ENTER THE CITY** and play. No internet connection is needed at any
   point: Three.js is vendored under `vendor/` and every sound is synthesised
   live with WebAudio — the game makes zero network requests.

## Controls

- WASD: walk / drive
- Shift: sprint
- E: enter or exit a nearby vehicle (stealing a car raises your wanted level)
- Space: jump
- Mouse: look around (click the game to lock the pointer)
- Left click: fire
- R: reload — 1: pistol, 2: SMG (find the gold SMG crate by the fixer)
- P: save — L: load — H: hide/show HUD — M: mute/unmute sound
- SAVE GAME / LOAD SAVE buttons are also in the HUD.

## What is in the game

- A procedural coastal city: 8x8 blocks, roads, parks, street lamps, a
  waterfront district of glass towers, a sand beach, a boardwalk, a pier and
  an animated ocean.
- On foot and by car: third-person movement, sprint, jump, arcade driving
  with steering, damage and building collision.
- Traffic (18 cars) with spacing and avoidance, and 14 pedestrians who stroll
  the sidewalks and flee from gunfire.
- Cars to steal: taking a car raises the wanted level.
- Wanted level 0–5: police spawn, pursue with building collision avoidance
  and line-of-sight routing, ram the player, and cool off when you hide.
- Combat: pistol (infinite reserve) + SMG pickup, ammo and reload, hostile
  crew NPCs in the industrial yard.
- Missions and story: a 6-stage contract chain (meet the fixer, pick up and
  deliver a package, clear the crew yard, lose the heat at the garage, final
  run to the overlook) with cash rewards; the chain loops with a new contract.
- HUD: cash, speed, weapon/ammo, wanted stars, health, mission panel, toasts,
  2D minimap (roads, buildings, beach, ocean, mission marker, police, player).
- Start screen, local save/load (localStorage), WebAudio sound: engine hum,
  footsteps, gunshots, sirens, pickup chimes, ambient city noise.

## Screenshot scenes (`?shot=`)

The game stages five deterministic scenes from the live simulation
(`?seed=` picks the stream; the default is `seed=1`). Screenshots are real
frames of the game running in a browser.

| Scene | URL | What it shows |
|---|---|---|
| start | `?shot=start&seed=1` | Hero open-world: pier, beach, ocean, city skyline |
| play | `?shot=play&seed=1` | Driving through traffic on the central avenue |
| chase | `?shot=chase&seed=1` | Police pursuit at wanted level 3 |
| mission | `?shot=mission&seed=1` | On-foot combat at the crew yard (mission 3) |
| end | `?shot=end&seed=1` | The overlook after the final job |

The submitted screenshots are the best four (start, play, chase, mission);
`end` is documented here as the fifth scene. Add `&hud=0` to hide the HUD in
any scene (the `start` scene hides it by default).

## Technical source outline

Architecture: plain ES modules, no build step, no framework beyond Three.js.
The shared game state `G` (see `src/main.js`) is passed to each system; every
system owns one file and one job.

- `index.html` — page, HUD markup and CSS, import map (`three` ->
  `./vendor/three.module.min.js`), loads `src/main.js`.
- `src/config.js` — world constants (grid, coast, colours), `clamp`/`lerp`,
  deterministic PRNG (`mulberry32`, `seeded`) and URL query parsing.
- `src/world.js` — static city: blocks, roads, parks, lamps, waterfront
  towers, beach/boardwalk/pier, ocean, gradient sky dome, sun. Building
  windows are a single `InstancedMesh` (one draw call). Exports
  `collidesBuilding`, `hasLineOfSight`, `nearestRoadCoord`, `animateOcean`.
- `src/characters.js` — people: `createCharacter` (torso/head/arms/legs with
  shoulder pivots), walk/idle animation, pedestrians (sidewalk loops, flee
  from gunfire), hostile crew (`spawnEnemies`, `updateEnemies`).
- `src/vehicles.js` — cars: `makeCar` (spinning wheels, body lean, flashing
  police light bar), traffic with spacing/avoidance (`updateTraffic`),
  police pursuit with building collision avoidance and line-of-sight
  routing (`updatePolice`, `spawnPoliceCar`).
- `src/missions.js` — 6-stage contract chain, glowing marker, rewards,
  fail/retry toasts, and the garage grace timer (stage 5 completes after 45 s
  of hiding even if heat never reaches exactly 0).
- `src/audio.js` — `AudioEngine`: all sounds synthesised with WebAudio
  (engine hum, footsteps, gunshots, two-tone siren, chimes, ambient city
  noise). No audio files. Silent until the first user gesture.
- `src/input.js` — keyboard state, pointer-lock mouse look, click-to-fire.
- `src/hud.js` — HUD text updates, toasts, and the 2D canvas minimap.
- `src/save.js` — localStorage save/load, including the driven car so loading
  while driving restores the car.
- `src/shots.js` — `stageShot(name, G)`: the five `?shot=` scenes.
- `src/main.js` — bootstrap, renderer/lights, the frame loop, on-foot and
  driving movement, weapons (pistol + SMG pickup), bullets, wanted heat and
  police spawning, camera, and the test hooks (`window.__fps`, `window.__ready`).
- `vendor/three.module.min.js` — Three.js 0.187.0, minified build from the
  official release (see `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`).

## Known limitations (honest list)

- Save/load restores the player, the player's car, money, health, wanted and
  mission — traffic, police and pedestrian positions are re-seeded, not saved.
- Pedestrians walk fixed sidewalk loops; they react to gunfire but have no
  full pathfinding.
- Police route around blocks via the road grid; in rare corner cases a unit
  can hesitate at a building corner before finding the road again.
- No day/night cycle or weather; the game is set at golden hour.
- The ocean is a vertex-animated plane, not a shader water simulation.

## Licenses

- This game's own code and art: MIT (see `../LICENSE`).
- Three.js 0.187.0: MIT, copyright (c) 2010-2025 three.js authors — see
  `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`.
