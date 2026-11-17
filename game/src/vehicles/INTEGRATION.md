# Vehicles — Integration Notes (for the coordinator)

Vehicle Physics Specialist, recording 3 (`01a1eb19`). Files owned by this
partition: `game/src/vehicles/models.js`, `driving.js`, `traffic.js`,
`vehicles.js` (public API), `INTEGRATION.md` (this file), plus the vendored
`game/vendor/GLTFLoader.js` + `game/vendor/utils/{BufferGeometryUtils,
SkeletonUtils}.js` (three 0.187.0, copied verbatim from
`~/workspace/tmp-clones/three.js/examples/jsm/` — GLTFLoader needs both
utils; the Character Specialist may import the same files, do not duplicate).

## What was built

| File | Contents |
|---|---|
| `models.js` | `VEHICLE_TYPES` + `makeVehicle(type, color, policeCar)`: detailed procedural bodies per type — stepped hood/trunk panels, glasshouse with pillars + roof, chrome waistline, bumpers, grille, mirrors, exhaust; wheels = tyre + rim + hubcap + brake disc on steerable front pivots. Types: `sedan`, `suv`, `truck` (open bed + cab), `sports` (wing, splitter, dual exhaust), `taxi` (roof sign + checker band), `police` (light bar). `setBrakeLights` / `setHeadlights` (emissive), `attachHeadlightBeams` (2 real SpotLights, player car only), `applyDamage` / `repairVehicle`, `loadVehicleGLB` (local GLB only, remote URLs rejected). |
| `driving.js` | `driveVehicle(car, input, dt, env)`: engine torque curve, brake vs reverse, speed-sensitive steering (bicycle model), grip + handbrake drift, spring-damper suspension pitch/roll, damage degradation (top speed −42%, accel −50%, steering pull), collision bounce + damage. `updateVehicleVisuals` (wheel spin, front steer, lean, police blink, damage headlight flicker). `vehicleCameraParams` / `smoothCameraParams` (per-type distance/height + speed FOV kick). |
| `traffic.js` | `spawnTrafficCars` / `updateTrafficCars`: 18 mixed-type cars, right-hand lanes derived from the existing 36-unit grid via `nearestRoadCoord` (no new world.js exports), intersection slow-down + yield to cross traffic + 30% left/right turns, car-following spacing, overtake after 2.5 s blocked (opposite lane must be clear). |
| `vehicles.js` | Public API, v1 contract kept: `makeCar(color, policeCar, type='sedan')`, `animateCar`, `spawnTraffic`, `updateTraffic`, plus re-exports of everything above. `updatePolice` / `spawnPoliceCar` are **byte-identical to v1** (verified by diff) — police behaviour belongs to the AI Specialist. |

Vehicle tuning (`VEHICLE_TYPES`): sedan top 26 / accel 13; SUV 24 / 10.5;
pickup 21 / 8.5; sports 33 / 16; taxi = sedan; police 27 / 13.5.
Speeds are world units/second; effective top speed is ~92–95% of nominal
(engine curve vs drag).

## Wiring — main.js (coordinator pastes this; vehicles never edits main.js)

### 1. Import (replace the existing vehicles import)

```js
import {
  makeCar, animateCar, spawnTraffic, updateTraffic, updatePolice, spawnPoliceCar,
  driveVehicle, vehicleCameraParams, setHeadlights, attachHeadlightBeams, resetDriveState,
} from '../vehicles/vehicles.js';
```

### 2. Headlight beams for the player car (once, after `G.playerCar` is created)

```js
attachHeadlightBeams(G.playerCar);
setHeadlights(G.playerCar, true);
```

Headlight toggle key (if wanted) is a UI/coordinator decision — no key is
bound here. Traffic cars use emissive lenses only (no SpotLights: 18 cars ×
2 spotlights would be 36 extra lights).

### 3. Replace the car branch of `moveActor` (EXACT snippet)

Replace everything inside `if (G.currentCar) { ... }` up to (but not
including) `} else {` — i.e. from `const car = G.currentCar;` through the
`G.audio.setEngine(...)` line — with:

```js
    const car = G.currentCar;
    const result = driveVehicle(car, {
      forward: !!keys.KeyW,
      back: !!keys.KeyS,
      left: !!keys.KeyA,
      right: !!keys.KeyD,
      handbrake: !!keys.Space, // Space is jump on foot only, free in a car
    }, dt, {
      collides: (x, z, r) => collidesBuilding(buildings, x, z, r),
    });
    if (result.collided && result.impact > 3) {
      showToast('CRASH • VEHICLE ' + Math.round(car.userData.health) + '%');
    }
    playerYaw = car.rotation.y;
    G.audio.setEngine(
      Math.abs(car.userData.speed) / (car.userData.spec?.topSpeed || 25), true,
    );
```

Notes: `driveVehicle` already calls `updateVehicleVisuals` + brake lights,
so the old `animateCar(car, dt, turn)` line is deleted, not kept. Damage from
a crash reduces `car.userData.health` and degrades handling until repaired
(no repair hook exists yet — see Gaps). `driveVehicle` clamps to the world
bounds (x −163..150, z ±163) itself.

### 4. Camera transition (hook in `updateCamera`)

Replace the `distance` / `height` computation with per-vehicle params:

```js
  const p = G.actorPosition();
  const yaw = G.currentCar ? G.currentCar.rotation.y : G.input.cameraYaw;
  const params = G.currentCar
    ? vehicleCameraParams(G.currentCar)
    : { distance: 7.2, height: 4.1, fov: 68, lookHeight: 1.6 };
  const distance = params.distance;
  const height = params.height;
  // ... desired/lerp as before, then:
  camera.lookAt(new THREE.Vector3(p.x, p.y + params.lookHeight, p.z));
  if (Math.abs(camera.fov - params.fov) > 0.05) {
    camera.fov += (params.fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
```

The `if (G.shotCamera) { ... }` branch is untouched — `?shot=` framing wins.
`smoothCameraParams(prev, target, dt)` is available if the coordinator
prefers an explicit smoothed param object instead of the inline FOV lerp.

### 5. Theft — NO CHANGE NEEDED

`tryEnterExit()` is untouched and already works with the new cars: it scans
`[G.playerCar, ...G.traffic]`, and every traffic car is a `makeVehicle`
group with the same `.position` / `.rotation.y` / `userData.speed|health`
contract. Recommended one-line addition on entry (avoids a stale steering
angle swerving the freshly stolen car):

```js
    G.currentCar = nearest;
    resetDriveState(nearest); // add this line
```

Damage and `userData.type` persist on the stolen car — stealing a sports car
feels faster than stealing a truck, by design.

### 6. Traffic call — recommended one-word change

Current: `updateTraffic(G.traffic, G.playerCar, dt)` — traffic avoids the
*parked* player car only. Change to:

```js
updateTraffic(G.traffic, G.currentCar || G.playerCar, dt);
```

so traffic also brakes for the car the player is currently driving.

## Verification (harness in /tmp, not in game/)

`node --check` clean on all 7 files (3 modules + vehicles.js + 3 vendored).
Harness `/tmp/veh-test/harness.mjs` (Node ESM, three resolved from the
vendored build via a loader hook; world.js imports resolve to the real
`game/src/world/world.js` now that its rewrite restores
`nearestRoadCoord`/`collidesBuilding` — an earlier run used a
HEAD-semantics stub in `/tmp/veh-test/world-stub.mjs` while the rewrite was
mid-flight, same results): **37 checks, 0 failures, 6 consecutive runs**,
plus 4 debug runs with 0 overlap events. Results: sedan 0→24.7 u/s in 5 s
(top 26), sports 31.1, truck 19.5; brake kills speed in <0.9 s, reverse to
−10.7; steering yaw +2.96 rad in 2 s; crash at 10.9 impact → bounce −2.4,
health 88, damage 0.12; 50% damage → top speed 19.5 vs 24.7 clean; traffic
200 s simulated: lane adherence worst 0.375, 0 NaN, 0 out-of-bounds, 0
in-lane overlaps <3 u, 18/18 cars moving. All vehicle sources grepped for
network calls: none (the only `https://` strings are comments inside the
vendored GLTFLoader). `game/` is 3.1 MiB / 38 files — inside kit limits
(48 MiB / 993 files).

Traffic hardening history (kept here so the next reader knows why the code
looks defensive): the gap clamp alone was not enough — a car mid-lane-change
sits 2.7 off its lane centre, outside the 2.4 look-ahead window, so a
returning overtaker could land on a queue unseen (fixed: side window 3.0 +
home-lane-ahead check on return + lateral motion gated on the lane being
clear + separation pass that holds the follower back and makes a head-on
overtaker retreat). Each fix was driven by a reproduced overlap in the
harness, not by inspection.

## Gaps / honest limitations

- No repair mechanic yet: damage is permanent until `repairVehicle(car)` is
  called — no garage / pickup wires it up (save specialist or coordinator).
- No engine/skid audio hooks: `driveVehicle` returns `{ collided, impact,
  speed, braking }` but there is no crash/skid sound call inside it (audio
  is another specialist's partition).
- No GLB art yet: `loadVehicleGLB` exists and is tested for URL rejection,
  but no `.glb` file ships in `game/assets/vehicles/` — procedural models
  are the shipped art. A GLB would also need its wheel pivots named/tagged
  (the loader returns an empty `wheels` list, so spin/steer visuals would
  not apply to it without a follow-up).
- Traffic never leaves the road grid by construction; it also never enters
  the beach/pier area (roads end at x = 144, the car clamp is x ≤ 150).
- Headlight beams are SpotLights without shadows (cheap by design) and are
  only attached to the player car.
