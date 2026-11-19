import { createRadio } from './radio.js';

// Original WebAudio sound engine for SUNCOAST: HEATLINE.
// One clear job: every sound is synthesised live with oscillators and filtered
// noise — no audio files, no network. Silent until the player's first gesture
// (browser autoplay policy), toggleable with M / the SOUND button.
//
// Buses: master -> destination; music and sfx buses feed master, so the
// settings panel can balance music against effects without touching mute.
// Music is an original synth loop (Am–F–C–G pads + bass + pentatonic plucks),
// written for this game — no licensed or sampled music anywhere.

const MUSIC_CHORDS = [
  { root: 110.00, notes: [220.00, 261.63, 329.63] }, // Am
  { root: 87.31, notes: [174.61, 220.00, 261.63] }, // F
  { root: 130.81, notes: [196.00, 246.94, 329.63] }, // C (voiced G-E-C)
  { root: 98.00, notes: [196.00, 246.94, 293.66] }, // G
];
const PENTA = [440.00, 523.25, 587.33, 659.25, 783.99, 880.00];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.muted = false;
    this.volumes = { master: 0.5, music: 0.6, sfx: 0.8 };
    this.musicOn = true;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.ambientNodes = null;
    this.rainNodes = null;
    this.rainLevel = 0;
    this.thunderTimer = 0;
    this.musicTimer = null;
    this.musicNextTime = 0;
    this.musicChord = 0;
    this.musicBeat = 0;
    this.melodyIdx = 2;
    this.lastStep = 0;
    this.lastHorn = 0;
    // Suncoast radio (radio.js): 3 original stations; the radio owns the
    // music loop once attached (see ensure / setMusicEnabled). The chip and
    // window.SuncoastRadio exist from construction, audio starts on attach.
    this.radio = createRadio(this);
    if (typeof window !== 'undefined') window.SuncoastRadio = this.radio;
  }

  /** SFX output bus (falls back to master before ensure()). */
  _out() { return this.sfxBus || this.master; }

  /** Create the context on first user gesture. Safe to call repeatedly. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music * 0.5;
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);
    this.startAmbient();
    this.startEngine();
    if (this.musicOn) this.startMusic();
    if (this.rainLevel > 0) this._startRainNodes();
    // Radio takes over the music loop once the context exists.
    if (this.radio) this.radio.attach();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volumes.master, this.ctx.currentTime, 0.05);
    }
  }

  /** Volume balance 0..1 per bus. Master 0 behaves like mute for output. */
  setVolumes(v) {
    if (!v) return;
    if (typeof v.master === 'number') this.volumes.master = Math.max(0, Math.min(1, v.master));
    if (typeof v.music === 'number') this.volumes.music = Math.max(0, Math.min(1, v.music));
    if (typeof v.sfx === 'number') this.volumes.sfx = Math.max(0, Math.min(1, v.sfx));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  setVolume(kind, value) {
    this.setVolumes({ [kind]: value });
  }

  /** Looping brown-noise city ambience through a low-pass filter. */
  startAmbient() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420;
    const gain = ctx.createGain(); gain.gain.value = 0.05;
    src.connect(filter); filter.connect(gain); gain.connect(this._out());
    src.start();
    // Distant traffic swell: a slow LFO on the ambience gain.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
    this.ambientNodes = { src, lfo };
    // Occasional distant horn so the street feels alive, not looped.
    const hornLoop = () => {
      if (this.ctx) {
        const now = performance.now();
        if (now - this.lastHorn > 12000) {
          this.lastHorn = now;
          if (Math.random() < 0.7) this.horn();
        }
        this._hornTimer = setTimeout(hornLoop, 12000 + Math.random() * 16000);
      }
    };
    this._hornTimer = setTimeout(hornLoop, 9000 + Math.random() * 8000);
  }

  /** Distant two-tone car horn, quiet on purpose. */
  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    [370, 466].forEach((freq) => {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.022, t0 + 0.05);
      g.gain.setValueAtTime(0.022, t0 + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      osc.connect(filter); filter.connect(g); g.connect(this._out());
      osc.start(t0); osc.stop(t0 + 0.6);
    });
  }

  // ---------------------------------------------------------- music
  /** Original synth loop: warm pads, sub bass, sparse pentatonic plucks. */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicNextTime = this.ctx.currentTime + 0.1;
    this.musicChord = 0;
    this.musicBeat = 0;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 200);
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }

  setMusicEnabled(on) {
    this.musicOn = !!on;
    if (!this.ctx) return;
    // Once the radio is attached it owns the music loop; the toggle drives it.
    if (this.radio && this.radio.attached) {
      this.radio.setEnabled(this.musicOn);
      return;
    }
    if (this.musicOn) this.startMusic();
    else this.stopMusic();
  }

  _scheduleMusic() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // Schedule ~0.6 s ahead, one 0.5 s beat per tick.
    while (this.musicNextTime < ctx.currentTime + 0.6) {
      const t = Math.max(this.musicNextTime, ctx.currentTime + 0.02);
      const chord = MUSIC_CHORDS[this.musicChord % MUSIC_CHORDS.length];
      if (this.musicBeat % 8 === 0) {
        // Pad: one soft triangle per chord tone, 4 s swell.
        for (const f of chord.notes) {
          const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.05, t + 0.9);
          g.gain.setValueAtTime(0.05, t + 2.6);
          g.gain.linearRampToValueAtTime(0.0001, t + 4.0);
          osc.connect(g); g.connect(this.musicBus);
          osc.start(t); osc.stop(t + 4.1);
        }
        // Sub bass on the root.
        const bass = ctx.createOscillator(); bass.type = 'sine'; bass.frequency.value = chord.root / 2;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.linearRampToValueAtTime(0.09, t + 0.3);
        bg.gain.linearRampToValueAtTime(0.0001, t + 3.8);
        bass.connect(bg); bg.connect(this.musicBus);
        bass.start(t); bass.stop(t + 3.9);
      }
      // Sparse pluck melody: random walk on the pentatonic, beats 2/4/6.
      if (this.musicBeat % 2 === 0 && Math.random() < 0.45) {
        this.melodyIdx = Math.max(0, Math.min(PENTA.length - 1,
          this.melodyIdx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2)));
        const osc = ctx.createOscillator(); osc.type = 'sine';
        osc.frequency.value = PENTA[this.melodyIdx];
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        osc.connect(g); g.connect(this.musicBus);
        osc.start(t); osc.stop(t + 0.75);
      }
      this.musicNextTime += 0.5;
      this.musicBeat += 1;
      if (this.musicBeat % 8 === 0) this.musicChord += 1;
    }
  }

  // ---------------------------------------------------------- weather
  /** Rain 0..1: filtered noise bed + occasional thunder above 0.5. */
  setRain(level) {
    this.rainLevel = Math.max(0, Math.min(1, level));
    if (!this.ctx) return;
    if (this.rainLevel > 0 && !this.rainNodes) this._startRainNodes();
    if (this.rainLevel <= 0 && this.rainNodes) this._stopRainNodes();
    if (this.rainNodes) {
      this.rainNodes.gain.gain.setTargetAtTime(
        this.rainLevel * 0.14, this.ctx.currentTime, 0.4,
      );
    }
  }

  _startRainNodes() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1400;
    const gain = ctx.createGain(); gain.gain.value = this.rainLevel * 0.14;
    src.connect(filter); filter.connect(gain); gain.connect(this._out());
    src.start();
    this.rainNodes = { src, gain };
    const thunderLoop = () => {
      if (!this.rainNodes) return;
      if (this.rainLevel > 0.5 && Math.random() < 0.6) this.thunder();
      this.thunderTimer = setTimeout(thunderLoop, 9000 + Math.random() * 11000);
    };
    this.thunderTimer = setTimeout(thunderLoop, 6000 + Math.random() * 6000);
  }

  _stopRainNodes() {
    try { this.rainNodes.src.stop(); } catch { /* already stopped */ }
    this.rainNodes = null;
    if (this.thunderTimer) { clearTimeout(this.thunderTimer); this.thunderTimer = 0; }
  }

  /** One low rumble: long filtered-noise burst, slow attack. */
  thunder() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 110;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    src.connect(filter); filter.connect(g); g.connect(this._out());
    src.start();
  }

  // ---------------------------------------------------------- engine / sfx
  /** Continuous engine hum; pitch and loudness follow the car's speed 0..1. */
  startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this._out());
    this.engineOsc.start();
  }

  setEngine(speed01, driving) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const target = driving ? 0.05 + speed01 * 0.075 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + speed01 * 118, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.1);
  }

  /** Short filtered noise burst, reused for footsteps and impacts. */
  noiseBurst({ duration = 0.08, frequency = 900, gain = 0.12, type = 'lowpass' }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(this._out());
    src.start();
  }

  footstep(running) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastStep < (running ? 240 : 340)) return;
    this.lastStep = now;
    this.noiseBurst({ duration: 0.07, frequency: 480, gain: 0.1 });
  }

  gunshot() {
    this.noiseBurst({ duration: 0.16, frequency: 2400, gain: 0.3, type: 'bandpass' });
    this.noiseBurst({ duration: 0.22, frequency: 160, gain: 0.28 });
  }

  /** Two sine notes, a pickup chime. */
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(g); g.connect(this._out());
      osc.start(t0); osc.stop(t0 + 0.4);
    });
  }

  click() {
    this.noiseBurst({ duration: 0.04, frequency: 1800, gain: 0.08, type: 'highpass' });
  }

  /** Two-tone police siren while any police unit is in pursuit. */
  setSiren(active) {
    if (!this.ctx) return;
    if (active && !this.sirenOsc) {
      const ctx = this.ctx;
      this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 720;
      this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0.045;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this._out());
      this.sirenOsc.start();
      this.sirenTimer = 0;
    } else if (!active && this.sirenOsc) {
      try { this.sirenOsc.stop(); } catch { /* already stopped */ }
      this.sirenOsc = null; this.sirenGain = null;
    }
  }

  updateSiren(dt) {
    if (!this.sirenOsc) return;
    this.sirenTimer += dt;
    const high = Math.floor(this.sirenTimer / 0.55) % 2 === 0;
    this.sirenOsc.frequency.setTargetAtTime(high ? 720 : 540, this.ctx.currentTime, 0.05);
  }
}
