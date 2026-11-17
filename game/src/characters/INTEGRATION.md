# Characters — integration notes (coordinator / main.js wiring)

## What this module owns

- `game/src/characters/characters.js` — all people logic + the rig loader.
- `game/src/characters/build_character.py` — Blender 4.5.9 build script for the
  rigged character. Re-run it to rebuild the GLB:
  `~/workspace/tools/blender/blender -b --python game/src/characters/build_character.py`
- `game/assets/characters/citizen.glb` (764 KB) — ONE rigged character, reused
  for player / pedestrians / enemies. 19-bone armature (`hips, spine, chest,
  neck, head, shoulder/upperArm/forearm/hand .L/.R, thigh/shin/foot .L/.R`),
  skinned mesh, 10 AnimationMixer clips:
  `idle, walk, run, sprint, jump, aim, shoot, reload, enter_car, exit_car`.
  Height ~1.80, origin at the feet, faces +Z in three.js. All original art.
- `game/vendor/GLTFLoader.js` + `game/vendor/utils/{BufferGeometryUtils,
  SkeletonUtils}.js` — vendored from three.js 0.187.0 (same version as
  `vendor/three.module.min.js`). Only the two relative import paths inside
  `GLTFLoader.js` were changed (`../utils/` -> `./utils/`). The import map
  already maps `three`, so the loader resolves with no other change.

## Contract (unchanged — main.js needs no edit for locomotion)

`createCharacter(color)`, `animateWalk(char, dt, factor)`,
`animateIdle(char)`, `spawnPedestrians(scene, buildings)`,
`updatePedestrians(peds, buildings, dt, gunfireEvent[, traffic])`,
`spawnEnemies(scene, GANG_ZONE)`, `updateEnemies(enemies, playerPos, dt,
onMelee)`. Player scale/origin conventions are unchanged.

How it works: `createCharacter` returns the Group synchronously with a
transient capsule-limb stand-in and starts the local GLB load; when the load
finishes the stand-in is swapped for a `SkeletonUtils.clone` of the rig
(per-instance materials, jacket tinted to the `color` argument). `animateWalk`
picks `walk` / `run` / `sprint` from the speed factor (main.js passes 0.55 for
walk, 1 for sprint) and crossfades; `animateIdle` crossfades to `idle`.
The mixer is advanced inside `animateWalk` / `animateIdle` /
`updateCharacterAnims`, so no frame-loop change is needed for locomotion.
If the GLB ever fails to load, the stand-in keeps working (console warning).

## New exports — wire these in main.js (coordinator)

| Export | When to call | Notes |
|---|---|---|
| `setWeapon(char, 'pistol' \| 'smg')` | `Digit1` / `Digit2` handlers, SMG pickup | Toggles Pistol*/Smg* nodes in the right hand. Pistol is default. |
| `setAiming(char, bool)` | While the fire button is held / pointer locked and on foot | Holds the two-hand `aim` stance; locomotion clips resume after. |
| `playShoot(char)` | Inside `fire()` (on-foot branch only) | One-shot recoil; returns to aim/idle automatically. |
| `playReload(char)` | Inside `reloadWeapon()` | One-shot 1.2 s mag swap. |
| `playJump(char)` | When `Space` triggers a jump (`onGround` branch) | One-shot; vertical position still owned by main.js. |
| `playMelee(char)` | Used internally by `updateEnemies` (throttled 0.9 s) | Arm-swing attack pose. |
| `playEnterVehicle(char, car, onDone)` | Inside `tryEnterExit()` enter branch | See below. |
| `playExitVehicle(char, car, onDone)` | Inside `tryEnterExit()` exit branch | See below. |
| `updateCharacterAnims(char, dt)` | Frame loop for the player when not walking/idling (e.g. while a vehicle tween runs) | Advances mixer + vehicle tween + one-shot return. |
| `loadCharacterRig()` | Optional preload at boot | Resolves to the shared glTF; cached. |
| `CHARACTER_CLIPS` | — | The 10 clip names. |

## Vehicle entry/exit — the one wiring change main.js needs

`main.js` currently hides the player the instant `E` is pressed, so an entry
animation would never be visible. Wire it like this:

```js
// ENTER (inside tryEnterExit, enter branch):
G.player.visible = true;            // keep visible during the animation
playEnterVehicle(G.player, nearest, () => {
  G.currentCar = nearest;
  G.player.visible = false;
  showToast('VEHICLE TAKEN • POLICE ALERT');
  triggerWanted(1);
});
// and call updateCharacterAnims(G.player, dt) in the frame loop while
// G.player.userData.vehicleAnim is set (or always — it is a no-op otherwise).

// EXIT: call playExitVehicle(G.player, G.currentCar, () => {
//   G.currentCar = null; G.player.visible = true; showToast('ON FOOT');
// }) BEFORE the current immediate repositioning code, and delete the
// immediate repositioning — the tween ends at the clear side spot (2.3 u).
```

The tween moves the character to the car door over the 1 s clip; `onDone`
fires exactly once at the end. If `onDone` is omitted the tween still runs.

## Pedestrians — what changed

- Waypoint wandering: each pedestrian walks between sidewalk waypoints
  (road intersections offset to the kerb) instead of fixed axis loops, with a
  per-pedestrian deterministic RNG stream (`mulberry32(seed*100+i+1)`), so
  `?shot=` scenes stay reproducible. Blocked pedestrians retarget instead of
  pushing a wall.
- Gunfire reaction kept (3 s flee, fixed flee direction, 90° turn when wedged).
- Car dodge (new): `updatePedestrians(..., gunfire, traffic)` — pass
  `G.traffic` as the 5th argument and pedestrians sidestep perpendicular to a
  car that is closing in within 5 units. The parameter is optional; without
  it the dodge step is skipped and everything else works.

## Enemies

Chase (run clip) inside 18 units, melee swing (`playMelee`, throttled 0.9 s)
under 4 units, idle otherwise. `userData.health` / `userData.alive` unchanged.

## Verification

Harness in `/tmp/harness/` (not in `game/`): loads the GLB in headless
Chromium, plays every clip through `AnimationMixer`, exercises the full API
with fake buildings/traffic, and asserts 0 external requests. See the
character specialist's report for the results.
