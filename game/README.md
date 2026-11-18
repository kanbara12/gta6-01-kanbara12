# SUNCOAST: HEATLINE, gta6-01 entry

An original Three.js open-world action game. A genre-inspired independent game:
it does not use GTA assets, characters, logos, map data, or any other
proprietary content. All art, audio and code in this game are original.

## Build status

The entry went through a full overhaul in five areas (world environment,
character and animation, vehicle physics, AI and gameplay, rendering and
performance), followed by two rounds of defect fixes and an independent
re-QA on 18 Nov 2026. The re-QA passed: all 9 defects from the first QA
round (D-QA1 to D-QA9) were confirmed fixed, and all 14 regression areas
passed, with 2 minor observations left open (see Known limitations).

## Run

1. Serve this folder with any static HTTP server, for example:
   - `node ../serve.ts` (from the repository root), then open
     `http://localhost:8080`
   - or `python3 -m http.server 8000` inside `game/`
2. Open the URL in a modern desktop browser (Chrome recommended).
3. Click **ENTER THE CITY** and play. No internet connection is needed at any
   point: Three.js is vendored under `vendor/` and every sound is synthesised
   live with WebAudio, so the game makes zero network requests.

## Controls

- WASD to walk or drive
- Shift to sprint
- E to enter or exit a nearby vehicle (stealing a car raises your wanted level)
- Space to jump
- Mouse to look around (click the game to lock the pointer)
- Left click to fire
- R to reload; 1 for pistol, 2 for SMG (find the gold SMG crate by the fixer)
- P to save, L to load, H to hide or show the HUD, M to mute or unmute sound
- SAVE GAME and LOAD SAVE buttons are also in the HUD.

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
- Combat: pistol (infinite reserve) plus SMG pickup, ammo and reload, hostile
  crew NPCs in the industrial yard.
- Missions and story: a 6-stage contract chain (meet the fixer, pick up and
  deliver a package, clear the crew yard, lose the heat at the garage, final
  run to the overlook) with cash rewards; the chain loops with a new contract.
- HUD: cash, speed, weapon/ammo, wanted stars, health, mission panel, toasts,
  2D minimap (roads, buildings, beach, ocean, mission marker, police, player).
- Start screen, local save/load (localStorage), WebAudio sound: engine hum,
  footsteps, gunshots, sirens, pickup chimes, ambient city noise.
- Time-of-day presets with a slow automatic cycle, and rain with wet roads
  (settings panel, or `?time=` and `?rain=` in the URL).

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

The four submitted screenshots are frames from the independent re-QA
session, not the staged `?shot=` scenes: `1-downtown.jpg` (hero open-world),
`2-traffic.jpg` (driving through traffic), `3-chase.jpg` (police pursuit at
wanted level 3), and `4-mission.jpg` (the mission marker, on foot). The
`end` scene is documented here as the fifth scene. Add `&hud=0` to hide the
HUD in any scene (the `start` scene hides it by default).

## Technical source outline

Architecture: plain ES modules, no build step, no framework beyond Three.js.
The shared game state `G` (see `src/main.js`) is passed to each system; every
system owns one file and one job.

- `index.html`: page, HUD markup and CSS, import map (`three` ->
  `./vendor/three.module.min.js`), loads `src/main.js`.
- `src/config.js`: world constants (grid, coast, colours), `clamp`/`lerp`,
  deterministic PRNG (`mulberry32`, `seeded`) and URL query parsing.
- `src/world.js`: static city: blocks, roads, parks, lamps, waterfront
  towers, beach/boardwalk/pier, ocean, gradient sky dome, sun. Building
  windows are a single `InstancedMesh` (one draw call). Exports
  `collidesBuilding`, `hasLineOfSight`, `nearestRoadCoord`, `animateOcean`.
- `src/characters.js`: people: `createCharacter` (torso/head/arms/legs with
  shoulder pivots), walk/idle animation, pedestrians (sidewalk loops, flee
  from gunfire), hostile crew (`spawnEnemies`, `updateEnemies`).
- `src/vehicles.js`: cars: `makeCar` (spinning wheels, body lean, flashing
  police light bar), traffic with spacing/avoidance (`updateTraffic`),
  police pursuit with building collision avoidance and line-of-sight
  routing (`updatePolice`, `spawnPoliceCar`).
- `src/missions.js`: 6-stage contract chain, glowing marker, rewards,
  fail/retry toasts, and the garage grace timer (stage 5 completes after 45 s
  of hiding even if heat never reaches exactly 0).
- `src/audio.js`: `AudioEngine`: all sounds synthesised with WebAudio
  (engine hum, footsteps, gunshots, two-tone siren, chimes, ambient city
  noise). No audio files. Silent until the first user gesture.
- `src/input.js`: keyboard state, pointer-lock mouse look, click-to-fire.
- `src/hud.js`: HUD text updates, toasts, and the 2D canvas minimap.
- `src/save.js`: localStorage save/load, including the driven car so loading
  while driving restores the car.
- `src/shots.js`: `stageShot(name, G)`: the five `?shot=` scenes.
- `src/main.js`: bootstrap, renderer/lights, the frame loop, on-foot and
  driving movement, weapons (pistol + SMG pickup), bullets, wanted heat and
  police spawning, camera, and the test hooks (`window.__fps`, `window.__ready`).
- `vendor/three.module.min.js`: Three.js 0.187.0, minified build from the
  official release (see `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`).

## Known limitations (honest list)

- Save/load restores the player, the player's car, money, health, wanted and
  mission. Traffic, police and pedestrian positions are re-seeded, not saved.
- Pedestrians walk fixed sidewalk loops; they react to gunfire but have no
  full pathfinding.
- Police route around blocks via the road grid; a unit that gets wedged in
  a building corner reverses out and re-routes (unstick), and police and
  pedestrian spawn points are validated clear of buildings.
- Palm fronds read as spikes from closer than about 6u: the cones stick out
  of the crown like a spiky ball. From normal gameplay distance the crowns
  read as round blobs.
- After a teleport to the safehouse, the third-person camera can end up
  behind a barrier, hiding the player and covering half the frame. This was
  seen during staged teleporting; walking into the safehouse normally may
  not trigger it.
- 60 FPS on a desktop machine is unverified. Headless test runs cannot
  measure real frame rate.
- Sound quality is unverified. Tests only confirmed the sounds play without
  errors and the audio context runs.
- Only the sedan was driven in testing. SUV, taxi and truck handling is
  untested beyond their spec numbers.
- Mission stages 3 to 5 were not played end to end. The chain was verified
  up to stage 3 starting (stage 2 finished, +$2,500, jobs 0 to 1); stages 3,
  4 and 5 were checked by reading the code only.
- The police SEARCH state was not observed. Every unit stayed in pursue
  mode during testing.
- The full automatic day/night cycle was not watched end to end; the four
  time presets work. Rain and wet roads were not re-tested visually in the
  re-QA round.
- The ocean is a vertex-animated plane, not a shader water simulation.

## Licenses

- This game's own code and art: MIT (see `../LICENSE`).
- Three.js 0.187.0: MIT, copyright (c) 2010-2025 three.js authors. See
  `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`.
