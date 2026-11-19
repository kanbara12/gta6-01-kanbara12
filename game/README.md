# SUNCOAST: HEATLINE, gta6-01 entry

An original Three.js open-world action game. A genre-inspired independent game:
it does not use GTA assets, characters, logos, map data, or any other
proprietary content. All art, audio and code in this game are original.

## Build status

The v3 build passed independent QA on 18 Nov 2026 (agent 65948680): verdict
PASS WITH NOTED DEFECTS, 0 MAJOR, 6 MINOR (D-QA01 to D-QA06), with all 8
missions verified end-to-end. Fix round 1 (commit 248b239) addressed all six
defects; re-QA the same day (agent 5beb2120) confirmed 5/6 FIXED, with D-QA04
NOT FIXED and a new finding, N-REQA1. Fix round 2 (commit f75893e) addressed
D-QA04 and N-REQA1. A second re-QA on 19 Nov (agent 1f0bc720) passed: both
were confirmed FIXED, with no new defects and no regressions.

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
- Shift to sprint on foot, nitro boost while driving
- E to enter or exit a nearby vehicle (stealing a car raises your wanted level)
- Space to jump on foot, handbrake while driving (hold it in a turn to drift)
- Mouse to look around (click the game to lock the pointer)
- Left click to fire
- T to reload, R to cycle the radio station; 1 for pistol, 2 for SMG (find the gold SMG crate by the fixer), 3 for shotgun (find the red crate at the crew-yard edge), 4 for bat
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
- Cars to steal: taking a car raises the wanted level. Every class has its
  own name and handling (PALMERA sedan, DUNEHAWK SUV, TIDEHAULER pickup,
  SUNCAB taxi, INTERCEPTOR police cruiser), and the hero coupe, the HEATLINE GT,
  tops out near 162 KM/H in 5th gear (Shift nitro pushes it toward 176 KM/H).
  Traffic always carries at least one sports car, and the car you are driving
  is never fought by the traffic AI. Drifting and near-misses pay cash.
- Wanted level 0-5: police spawn, pursue with building collision avoidance
  and line-of-sight routing, ram the player, and cool off when you hide.
  At wanted 3 and above the police helicopter SKY-1 joins
  the chase, orbiting overhead with its searchlight on you at dusk and night.
- Combat: pistol (infinite reserve), SMG pickup, shotgun pickup (6 pellets
  per pull, 6 in the tube, 24 in reserve), and a bat for close work. Four
  weapon slots (keys 1-4) with ammo and reload, plus hostile crew NPCs in the
  industrial yard.
- Missions and story: an 8-stage contract chain (meet the fixer, pick up and
  deliver a package, clear the crew yard, lose the heat at the garage, final
  run to the overlook, swap the case at the marina dock, north run to the
  lighthouse breakwater) with a par time per stage, crew dialog from Rae
  (fixer), Marlo (driver) and Sable (lookout), and cash rewards that land
  near $17,000 after the fifth job and near $22,000 after the eighth; the
  chain loops with a new contract.
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

The four submitted screenshots are frames captured from the final build:
`1-downtown.jpg` (hero waterfront sunset, driving), `2-traffic.jpg`
(driving through traffic), `3-chase.jpg` (police pursuit at wanted level 3),
and `4-mission.jpg` (crew dialog with the mission marker, from live play).
The `end` scene is documented here as the fifth scene. The HUD is on in every
scene by default; add `&hud=0` to hide it in any scene.

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
  police light bar), traffic with spacing/avoidance (`updateTraffic`).
  Traffic always carries a sports car, and the car the player drives is
  taken out of the traffic AI for the frame. Police pursuit with building
  collision avoidance and line-of-sight routing (`updatePolice`,
  `spawnPoliceCar`). Driving (`driveVehicle`) adds nitro (Shift), drift and
  near-miss score events, and the `window.SuncoastVehicle` telemetry
  (speed KM/H, gear, condition, nitro, model name). The police helicopter
  (SKY-1, orbit + searchlight cone + ground pool, `window.SuncoastAir`)
  lives in `src/AI/helicopter.js`.
- `src/missions.js`: 8-stage contract chain, glowing marker, rewards,
  fail/retry toasts, par time per stage, crew dialog (Rae / Marlo / Sable),
  and the garage grace timer (stage 5 completes after 45 s of hiding even
  if heat never reaches exactly 0).
- `src/audio.js`: `AudioEngine`: all sounds synthesised with WebAudio
  (engine hum, footsteps, gunshots, two-tone siren, chimes, ambient city
  noise). No audio files. Silent until the first user gesture.
- `src/input.js`: keyboard state, pointer-lock mouse look, click-to-fire.
- `src/hud.js`: HUD text updates, toasts, and the 2D canvas minimap.
- `src/save.js`: localStorage save/load, including the driven car so loading
  while driving restores the car; the 8-stage chain (mission 0-7) and the
  shotgun's ownership + reserve survive a save/load round-trip.
- `src/shots.js`: `stageShot(name, G)`: the five `?shot=` scenes.
- `src/main.js`: bootstrap, renderer/lights, the frame loop, on-foot and
  driving movement, weapons (pistol + SMG + shotgun pickups, bat), bullets,
  wanted heat and police spawning, camera, and the test hooks (`window.__fps`,
  `window.__ready`, `window.SuncoastAir`, `window.SuncoastVehicle`,
  `window.SuncoastWeapons`).
- `vendor/three.module.min.js`: Three.js 0.187.0, minified build from the
  official release (see `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`).

## Known limitations (honest list)

- A save brings back the player, the player's car, money, health, wanted
  level and mission progress. Traffic cars, police units and pedestrians
  are not part of the save. They are re-seeded fresh on load.
- Pedestrians keep to fixed sidewalk loops. They scatter when shots are
  fired, but they do not plan routes through the city.
- Police chase along the road grid. A unit pinned against a building
  corner backs out and picks a new route (unstick), and every police and
  pedestrian spawn point is checked clear of buildings first.
- Palm fronds still read as spikes from closer than about 6u: the cones
  poke out of the crown like a spiky ball. From normal gameplay distance
  the crowns read as round blobs.
- After a teleport to the safehouse, the third-person camera can end up
  behind a barrier, hiding the player and covering half the frame. This
  was seen during staged teleporting; walking into the safehouse normally
  may not trigger it.
- 60 FPS on a desktop machine is unverified. Headless test runs cannot
  measure real frame rate.
- Sound quality is unverified. Tests only confirmed the sounds play
  without errors and the audio context runs.
- Only the sedan and the sports coupe have actually been driven in
  testing. The coupe (HEATLINE GT) was driven headless to 151 KM/H in
  5th gear, nitro to 170 KM/H, with a drift payout (+$100) and a
  near-miss payout (+$250) observed. SUV, taxi and truck handling is
  untested beyond their spec numbers.
- All 8 mission stages were played end to end headless (r14): economy
  $17,450 after stage 4 and $22,450 after stage 8, and the chain loops
  back to stage 0. Stage 3 was cleared by 3 pistol kills; stage 4 by its
  45 s grace timer at the garage.
- The police helicopter (SKY-1) circles at 58 m out and 18 m up, which
  keeps it inside the chase camera's frame over open ground; over
  downtown it can slice through a tower edge on its orbit (towers run
  30-64 tall). Its searchlight cone + ground pool and the
  SPOTLIGHT/SEARCHLIGHT statuses were observed at dusk.
- Shotgun and bat use the pistol's hand prop: the character model only
  has pistol/SMG weapon art, so the shotgun and bat read correctly in
  the HUD and the weapon slots but not in the hand.
- The police SEARCH state was not observed. Every unit stayed in pursue
  mode during testing.
- The full automatic day/night cycle was not watched end to end; the four
  time presets work. Rain and wet roads were not re-tested visually in the
  re-QA round.
- The ocean is a vertex-animated plane.

## Licenses

- This game's own code and art: MIT (see `../LICENSE`).
- Three.js 0.187.0: MIT, copyright (c) 2010-2025 three.js authors. See
  `THIRD-PARTY-NOTICES.md` and `vendor/LICENSE-threejs.txt`.
