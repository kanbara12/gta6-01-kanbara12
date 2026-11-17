// Rendering pipeline for SUNCOAST: HEATLINE.
// One clear job: everything that makes a frame look the way it does — the
// renderer, the sun/hemi/fill lights with a tight player-following shadow
// frustum, time-of-day grading, rain + wet roads, contact shadows, dust,
// ocean glint and the quality presets. No gameplay wiring lives here;
// main.js owns the loop and calls env.update(dt, focusPos) once per frame.
//
// What this deliberately does NOT do: no EffectComposer / post-processing
// chain. No composer addons are vendored (only three.module.min.js ships
// locally) and a composer pass would cost a full extra fullscreen pass on
// every frame. Colour grading is done with ACES tone mapping + exposure
// per time-of-day, plus a zero-cost CSS vignette (index.html).
//
// Reference direction only (Marisol Heat, judge 993.343): a sunset coastal
// city with a dense commercial HUD. Nothing from that entry was copied —
// no assets, code, text or names — only the direction: warm low sun,
// pink-orange haze, readable shaded faces, dense HUD.

import * as THREE from 'three';
import { TIME_PRESETS, COLOURS, clamp, lerp } from './config.js';
import { presetFor } from './settings.js';

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();

/** Preset name -> hour of day for the World sky dome (setTimeOfDay hook). */
export const TIME_HOURS = { golden: 17.4, noon: 12, dusk: 18.8, night: 22 };

function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build the renderer. Antialias is fixed at context creation. */
export function createRenderer(settings) {
  const preset = presetFor(settings.quality);
  const renderer = new THREE.WebGLRenderer({
    antialias: preset.antialias, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, preset.pixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  return renderer;
}

/**
 * Create the environment (lights + weather + contact shadows + particles).
 * `world` is the object returned by buildWorld (only used for the optional
 * setWet hook — see INTEGRATION.md). Returns the env handle main.js drives.
 */
export function createEnvironment(scene, renderer, settings, world) {
  const preset = presetFor(settings.quality);
  const time = TIME_PRESETS[settings.timeOfDay] || TIME_PRESETS.golden;

  scene.background = new THREE.Color(time.bg);
  scene.fog = new THREE.Fog(time.fog, time.fogNear, time.fogFar);
  renderer.toneMappingExposure = time.exposure;

  const hemi = new THREE.HemisphereLight(time.hemiSky, time.hemiGround, time.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(time.sun, time.sunIntensity);
  sun.position.set(time.sunPos[0], time.sunPos[1], time.sunPos[2]);
  sun.castShadow = preset.shadows;
  sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
  sun.shadow.camera.left = -preset.shadowRange;
  sun.shadow.camera.right = preset.shadowRange;
  sun.shadow.camera.top = preset.shadowRange;
  sun.shadow.camera.bottom = -preset.shadowRange;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);
  scene.add(sun.target);

  // Cool fill from the east so the shaded faces of the waterfront towers
  // stay readable instead of flat silhouettes.
  const fill = new THREE.DirectionalLight(0xbfd9ff, 0.7);
  fill.position.set(120, 60, -40);
  scene.add(fill);

  // ---- contact shadows: one hero blob under the actor + a small pool for
  // the nearest traffic/police cars. Cheap (one shared texture, no extra
  // shadow pass) and it grounds cars that sit outside the sun frustum.
  const blobTex = makeBlobTexture();
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTex, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const heroBlob = new THREE.Mesh(blobGeo, blobMat);
  heroBlob.position.y = 0.03;
  heroBlob.renderOrder = 1;
  scene.add(heroBlob);
  const poolBlobs = [];
  for (let i = 0; i < 6; i += 1) {
    const m = new THREE.Mesh(blobGeo, blobMat.clone());
    m.material.opacity = 0.32;
    m.position.y = 0.03;
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    poolBlobs.push(m);
  }

  // ---- rain: one Points cloud, recycled in a box around the camera focus.
  const RAIN_MAX = 1800;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_MAX * 3);
  const rainVel = new Float32Array(RAIN_MAX);
  for (let i = 0; i < RAIN_MAX; i += 1) {
    rainPos[i * 3] = (Math.random() - 0.5) * 70;
    rainPos[i * 3 + 1] = Math.random() * 32;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    rainVel[i] = 24 + Math.random() * 10;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xa8c8e8, size: 0.14, transparent: true, opacity: 0.5,
    sizeAttenuation: true, depthWrite: false,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);

  // ---- dust puffs behind a fast car: pooled Points, dead slots park at y=-100.
  const DUST_MAX = 120;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_MAX * 3);
  const dustLife = new Float32Array(DUST_MAX);
  for (let i = 0; i < DUST_MAX; i += 1) dustPos[i * 3 + 1] = -100;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xcbb59a, size: 0.9, transparent: true, opacity: 0.32,
    sizeAttenuation: true, depthWrite: false,
  }));
  dust.frustumCulled = false;
  scene.add(dust);
  let dustCursor = 0;
  let dustTimer = 0;

  // ---- wet-road bookkeeping: road materials are collected lazily on the
  // first setWet call (by colour match against COLOURS.road) and restored
  // exactly when the road dries. If the World specialist ships a
  // world.setWet hook, main.js prefers it and this path is never used.
  let roadMats = null;

  const env = {
    scene, renderer, sun, hemi, fill, rain, dust,
    sunDir: new THREE.Vector3(time.sunPos[0], time.sunPos[1], time.sunPos[2]).normalize(),
    timeOfDay: settings.timeOfDay,
    timeMix: 1, // 1 = fully at the target preset; <1 = still transitioning
    timeFrom: null,
    timeTo: time,
    wet: settings.rain || 0,
    rainLevel: settings.rain || 0,
    quality: settings.quality,
    particleScale: preset.particles,
    world: world || null,
    // World hooks, bound by main.js via dynamic import when world.js
    // exports them (see INTEGRATION.md). Group methods on `world` are
    // honoured too; either path drives the sky dome / road wetness.
    worldSetTimeOfDay: null,
    worldSetWet: null,

    /** Switch time of day. The transition lerps over ~1.5 s in update().
     *  `instant` skips the lerp: used by ?shot= staging so a screenshot
     *  captures the finished light no matter when the kit grabs the frame. */
    setTimeOfDay(name, instant = false) {
      const next = TIME_PRESETS[name];
      if (!next || name === this.timeOfDay) return;
      this.timeFrom = snapshotTime(this);
      this.timeTo = next;
      this.timeOfDay = name;
      this.timeMix = instant ? 1 : 0;
      if (instant) applyTimeLerp(this, this.timeFrom, this.timeTo, 1);
      // Sky dome + moon live in world.js: drive them with the same call.
      if (typeof this.worldSetTimeOfDay === 'function') {
        this.worldSetTimeOfDay(TIME_HOURS[name]);
      } else if (this.world && typeof this.world.setTimeOfDay === 'function') {
        this.world.setTimeOfDay(TIME_HOURS[name]);
      }
    },

    /** 0 = dry, 1 = soaked. Drives rain visuals + wet-road materials. */
    setWet(v) {
      const wet = clamp(v, 0, 1);
      this.wet = wet;
      this.rainLevel = wet;
      this.setRainLevel(wet);
      if (this.worldSetWet) {
        this.worldSetWet(wet);
        return;
      }
      if (this.world && typeof this.world.setWet === 'function') {
        this.world.setWet(wet);
        return;
      }
      if (!roadMats) {
        roadMats = [];
        this.scene.traverse((o) => {
          if (!o.isMesh || !o.material || !o.material.color) return;
          if (o.material.color.getHex() === COLOURS.road && !roadMats.includes(o.material)) {
            roadMats.push({
              mat: o.material,
              roughness: o.material.roughness,
              color: o.material.color.clone(),
            });
          }
        });
      }
      for (const r of roadMats) {
        r.mat.roughness = r.roughness * (1 - 0.65 * wet);
        r.mat.color.copy(r.color).multiplyScalar(1 - 0.22 * wet);
        r.mat.needsUpdate = false; // colour/roughness only: no recompile
      }
    },

    /** Rain intensity 0..1 (visual only; audio rain is wired in main.js). */
    setRainLevel(v) {
      this.rainLevel = clamp(v, 0, 1);
      const presetNow = presetFor(this.quality);
      const count = Math.floor(presetNow.rainMax * this.rainLevel * this.particleScale);
      rain.visible = count > 0;
      rainGeo.setDrawRange(0, count);
      rainMat.opacity = 0.3 + 0.25 * this.rainLevel;
    },

    /** Apply a quality preset live (pixel ratio, shadows, particles). */
    setQuality(name, onNote) {
      const next = presetFor(name);
      const prev = presetFor(this.quality);
      this.quality = name;
      this.particleScale = next.particles;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, next.pixelRatio));
      this.sun.castShadow = next.shadows;
      this.renderer.shadowMap.enabled = next.shadows;
      if (next.shadowSize !== prev.shadowSize) {
        this.sun.shadow.mapSize.set(next.shadowSize, next.shadowSize);
        if (this.sun.shadow.map) {
          this.sun.shadow.map.dispose();
          this.sun.shadow.map = null;
        }
      }
      const r = next.shadowRange;
      const cam = this.sun.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.updateProjectionMatrix();
      this.setRainLevel(this.rainLevel);
      document.body.classList.toggle('vignette-on', !!next.vignette);
      if (next.antialias !== prev.antialias && onNote) {
        onNote('ANTIALIAS APPLIES AFTER RELOAD');
      }
    },

    /** Per-frame: shadow frustum follows the actor, time-of-day lerp, rain/dust. */
    update(dt, focus, G) {
      // Sun + tight shadow frustum follow the actor (was a static ±170 box
      // covering the whole city: most texels wasted, acne on near geometry).
      this.sun.position.set(
        focus.x + this.sunDir.x * 190, focus.y + this.sunDir.y * 190, focus.z + this.sunDir.z * 190,
      );
      this.sun.target.position.set(focus.x, 0, focus.z);
      this.sun.target.updateMatrixWorld();

      if (this.timeMix < 1 && this.timeFrom) {
        this.timeMix = Math.min(1, this.timeMix + dt / 1.5);
        applyTimeLerp(this, this.timeFrom, this.timeTo, this.timeMix);
      }

      // Rain falls in a box centred on the focus; drops wrap to the top.
      if (this.rain.visible) {
        const pos = rainGeo.attributes.position.array;
        const count = rainGeo.drawRange.count;
        for (let i = 0; i < count; i += 1) {
          pos[i * 3 + 1] -= rainVel[i] * dt;
          pos[i * 3] -= 3.5 * dt; // wind slant
          if (pos[i * 3 + 1] < 0) {
            pos[i * 3 + 1] = 26 + Math.random() * 6;
            pos[i * 3] = focus.x + (Math.random() - 0.5) * 70;
            pos[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 70;
          }
        }
        rainGeo.attributes.position.needsUpdate = true;
        rain.position.set(0, 0, 0);
      }

      // Hero contact shadow under the actor; pool blobs under nearest cars.
      const actor = G && G.currentCar ? G.currentCar : (G && G.player);
      if (actor) {
        heroBlob.visible = true;
        heroBlob.position.set(actor.position.x, 0.03, actor.position.z);
        const s = G.currentCar ? 5.2 : 2.2;
        heroBlob.scale.set(s, 1, s * 0.8);
      } else {
        heroBlob.visible = false;
      }
      if (G && G.traffic) {
        const cars = [...G.traffic, ...(G.police || [])]
          .filter((c) => c.position.distanceToSquared(focus) < 90 * 90)
          .sort((a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus))
          .slice(0, poolBlobs.length);
        poolBlobs.forEach((m, i) => {
          const c = cars[i];
          if (!c || (actor && c === actor)) { m.visible = false; return; }
          m.visible = true;
          m.position.set(c.position.x, 0.03, c.position.z);
          m.scale.set(5.2, 1, 4.2);
        });
      }

      // Dust behind a fast car.
      if (G && G.currentCar && Math.abs(G.currentCar.userData.speed || 0) > 9) {
        dustTimer -= dt;
        if (dustTimer <= 0) {
          dustTimer = 0.05;
          const c = G.currentCar;
          const bx = c.position.x - Math.sin(c.rotation.y) * 1.8;
          const bz = c.position.z - Math.cos(c.rotation.y) * 1.8;
          for (let k = 0; k < 2; k += 1) {
            const i = dustCursor;
            dustCursor = (dustCursor + 1) % DUST_MAX;
            dustPos[i * 3] = bx + (Math.random() - 0.5) * 1.2;
            dustPos[i * 3 + 1] = 0.25 + Math.random() * 0.3;
            dustPos[i * 3 + 2] = bz + (Math.random() - 0.5) * 1.2;
            dustLife[i] = 0.6;
          }
        }
      }
      let dustAlive = false;
      for (let i = 0; i < DUST_MAX; i += 1) {
        if (dustLife[i] > 0) {
          dustAlive = true;
          dustLife[i] -= dt;
          dustPos[i * 3 + 1] += dt * 0.7;
          if (dustLife[i] <= 0) dustPos[i * 3 + 1] = -100;
        }
      }
      if (dustAlive) dustGeo.attributes.position.needsUpdate = true;
    },

    /** Ocean sun-glint per time of day (roughness + colour). No-op without ocean. */
    updateOcean(ocean) {
      if (!ocean || !ocean.material) return;
      const t = this.timeTo;
      ocean.material.roughness = lerp(ocean.material.roughness, t.oceanRoughness, 0.05);
      _c1.set(t.ocean);
      ocean.material.color.lerp(_c1, 0.05);
      ocean.material.metalness = t.oceanMetalness;
    },
  };

  // Initial wet state (rain from a saved setting or ?rain=).
  if (env.wet > 0) env.setWet(env.wet);
  return env;
}

function snapshotTime(env) {
  return {
    sun: env.sun.color.clone(),
    sunDir: env.sunDir.clone(),
    sunIntensity: env.sun.intensity,
    hemiSky: env.hemi.color.clone(),
    hemiGround: env.hemi.groundColor.clone(),
    hemiIntensity: env.hemi.intensity,
    fillIntensity: env.fill.intensity,
    fog: env.scene.fog ? env.scene.fog.color.clone() : new THREE.Color(0),
    fogNear: env.scene.fog ? env.scene.fog.near : 105,
    fogFar: env.scene.fog ? env.scene.fog.far : 320,
    exposure: env.renderer.toneMappingExposure,
    bg: env.scene.background ? env.scene.background.clone() : new THREE.Color(0),
  };
}

function applyTimeLerp(env, from, to, t) {
  const e = t * t * (3 - 2 * t); // smoothstep
  env.sun.color.lerpColors(from.sun, _c1.set(to.sun), e);
  env.sun.intensity = lerp(from.sunIntensity, to.sunIntensity, e);
  env.sunDir.lerpVectors(from.sunDir, _v.set(to.sunPos[0], to.sunPos[1], to.sunPos[2]).normalize(), e);
  env.hemi.color.lerpColors(from.hemiSky, _c2.set(to.hemiSky), e);
  env.hemi.groundColor.lerpColors(from.hemiGround, _c2.set(to.hemiGround), e);
  env.hemi.intensity = lerp(from.hemiIntensity, to.hemiIntensity, e);
  env.fill.intensity = lerp(from.fillIntensity, to.fillIntensity, e);
  if (env.scene.fog) {
    env.scene.fog.color.lerpColors(from.fog, _c1.set(to.fog), e);
    env.scene.fog.near = lerp(from.fogNear, to.fogNear, e);
    env.scene.fog.far = lerp(from.fogFar, to.fogFar, e);
  }
  env.renderer.toneMappingExposure = lerp(from.exposure, to.exposure, e);
  if (env.scene.background && env.scene.background.isColor) {
    env.scene.background.lerpColors(from.bg, _c1.set(to.bg), e);
  }
}
