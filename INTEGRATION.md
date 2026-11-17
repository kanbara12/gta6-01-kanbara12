# INTEGRATION — GTA6-01 "SUNCOAST: HEATLINE" (kanbara12)

Coordinator-owned merge notes for the parallel-specialist overhaul.
Each specialist owns one section below; do not edit another specialist's
section. Vehicle branch notes live in `game/src/vehicles/INTEGRATION.md`.

## RENDERING & PERFORMANCE (Rendering Specialist)

### What shipped (files owned by this specialist)
- `game/src/core/rendering.js` (NEW) — renderer, lights, shadows, time-of-day,
  rain + wet roads, contact shadows, dust, ocean glint, quality presets.
- `game/src/core/settings.js` (NEW) — quality presets + persisted settings
  (`localStorage` key `suncoast-settings-v1`).
- `game/src/core/config.js` — added `TIME_PRESETS` (golden/noon/dusk/night)
  and `?quality= / ?time= / ?rain=` query params.
- `game/src/core/main.js` — ONLY the renderer/lights block (now delegates to
  `rendering.js`), the render hooks on `G`, and the per-frame `env.update`
  call. No gameplay wiring touched.
- `game/index.html` — commercial HUD restyle, settings panel, fullscreen,
  vignette overlay, import-map entry
  `three/addons/loaders/GLTFLoader.js -> ./vendor/GLTFLoader.js`.
- `game/src/UI/hud.js` — HUD redesign (health+armor, big speedometer,
  mission stage, district label, player heading arrow, pulsing marker).
  Frozen signatures kept: `updateHud(G) / drawMinimap(G) / showToast /
  tickToast / setHudVisible`. D8 kept: no auto pointer-lock on start.
- `game/src/UI/shots.js` — `stageShot(name, G)` kept; per-scene time of day
  (chase = dusk, rest = golden); start camera lowered to y 5.5.
- `game/src/audio/audio.js` — all old methods kept (`ensure, click,
  gunshot, chime, footstep, setEngine, setSiren, updateSiren, setMuted,
  muted`); added music/sfx buses, `setVolumes / setVolume`,
  `setMusicEnabled / startMusic / stopMusic` (original synth loop),
  `setRain` (rain bed + thunder), `horn`.

### Hooks other specialists must know
- `G.setQuality(name)` — Low/Medium/High/Ultra; live-applies pixel ratio,
  shadow size, particles, vignette. Antialias needs a reload (toast warns).
- `G.setTimeOfDay(name)` — `'golden' | 'noon' | 'dusk' | 'night'`.
  Drives sun/hemi/fill/fog/exposure in `rendering.js` AND the world sky dome
  via `env.worldSetTimeOfDay(hour)` (see below). Name→hour map:
  `golden 17.4, noon 12, dusk 18.8, night 22` (`TIME_HOURS`).
- `G.setWet(v)` / `G.setRain(v)` — 0..1. Rain visuals + rain audio always
  run from rendering/audio; road wetness prefers a World hook when present.
- `window.__game.renderEnv` — the env handle; `window.__game.settings` —
  the live settings object. `suncoast-ready` event fires on the first frame
  (settings panel listens for it).

### World hook contract (for the World Specialist / coordinator)
`main.js` binds these by **dynamic import** after `buildWorld`, so a
mid-rewrite `world.js` can never break the game load:
- `world.js` exports `setTimeOfDay(hour 0..24)` and `setWet(amount 0..1)`
  (per its header comment) → `main.js` stores them on
  `env.worldSetTimeOfDay / env.worldSetWet` and `env` calls them.
- If instead the hooks are attached to the group returned by `buildWorld`
  (`world.setTimeOfDay / world.setWet`), `env` honours those too
  (`env.world = world` is set in `main.js`).
- If NO world hook exists at call time, `env.setWet` falls back to a
  colour-matched road-material traversal (roughness ×(1−0.65·wet), colour
  ×(1−0.22·wet), originals snapshotted, idempotent). The fallback is
  SKIPPED whenever a world hook is present, so there is no double-darkening
  — but only if `world.setWet` snapshots original material values on its
  first call the same way.
- Known gap: the sky dome + moon live in `world.js` (`paintSky`). Until the
  world hooks exist, `setTimeOfDay` changes lights/fog/exposure only; the
  sky gradient stays sunset. That is the documented split, not a bug.

### Verification status (18 Nov, Rendering Specialist)
- Real game loads with 0 console errors, 0 failed requests, 0 external
  requests (Playwright + SwiftShader, 1920×1080). Night end-state exact
  (sun 0.55 / #9db8ff, fog #1a2436 60–220, exposure 1.05); golden restores
  exactly (2.4 / 1.08). `?shot=chase` dusk applies instantly (sun 1.9,
  fog #d96a72, exposure 1.12, mix 1, zero frames driven).
- Settings panel verified live + persisted (`localStorage`): quality
  medium, time dusk, rain 0.5 all round-trip; HUD buttons topmost/clickable
  (D8 intact); `document.fullscreenEnabled` true.
- **FPS: NOT verified on desktop.** Headless SwiftShader throttles rAF to
  ~1 Hz in this VM, so no rAF FPS number is meaningful here; manual
  render timing in SwiftShader (fixture, stub world) was ~431 ms/frame at
  High — a software-renderer number, not a desktop claim. Desktop 60 FPS
  still needs a real-browser check by QA/coordinator.
- Earlier blocker RESOLVED during this session: `world.js` was mid-rewrite
  with zero exports (~03:30 WIB) and now exports all 7 functions including
  `setTimeOfDay(hour)` / `setWet(amount)`; the dynamic-import binding in
  `main.js` picks them up (verified bound in the fixture; real-game sky
  follows the same call path).
- Minor tuning note (from the real chase-dusk screenshot): at dusk the
  asphalt reads near-black; hemi 1.3 may want a small lift if QA finds
  roads unreadable at dusk. Not changed blindly.

### Deliberately NOT done
- No EffectComposer / post-processing chain: no composer addons are vendored
  (only `three.module.min.js` ships) and a composer pass costs a fullscreen
  pass per frame. Grading = ACES + per-time exposure + CSS vignette.
- No SSAO: same reason (no post chain, software renderer would crawl).
- `G.armor` is 0 until an armor pickup ships (HUD shows 0%); no gameplay
  invented.

## COORDINATOR MERGE NOTES (integration, recording 3)

### Pedestrians — AI reactions merged into characters.js (NOT a literal import swap)
`AI/pedestrians.js` was written against the pre-rewrite `characters.js`
(spawn data with `u.axis` / `u.dir`); the Character Specialist then rewrote
spawn + update to waypoint wandering (no `axis` / `dir` fields). A literal
swap of the `updatePedestrians` import to `AI/pedestrians.js` would read
`u.dir === undefined` and drive every ped position to NaN. So the AI
reactions (cower < 9 u, near-miss panic < 7 u at speed > 8, witness alarm
< 30 u / 12 s cooldown) were merged INTO `characters.js:updatePedestrians`
(signature extended with a 6th `opts` param `{ playerCar, onWitness }`;
the 5th `traffic` param is unchanged), keeping waypoint wandering +
car dodge. `AI/pedestrians.js` stays in the tree as reference, unimported.

### Vehicles — resetDriveState import source
`vehicles.js` does not re-export `resetDriveState` (it lives in
`vehicles/driving.js`); `main.js` imports it from `driving.js` directly.
The Vehicle INTEGRATION.md import line naming it under vehicles.js is
not followed for that one name.

### Day/night cycle
Automatic advance through the presets (golden → dusk → night → noon),
one phase per 240 s of play, in `main.js` (`TIME_CYCLE_SECONDS`). Paused
on the start screen and in `?shot=` mode; advances FROM the current
preset, so a manual settings-panel choice is respected as the new phase.
