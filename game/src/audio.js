// Original WebAudio sound engine for SUNCOAST: HEATLINE.
// One clear job: every sound is synthesised live with oscillators and filtered
// noise — no audio files, no network. Silent until the player's first gesture
// (browser autoplay policy), toggleable with M / the SOUND button.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.ambientNodes = null;
    this.lastStep = 0;
  }

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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
    this.startEngine();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
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
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start();
    // Distant traffic swell: a slow LFO on the ambience gain.
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
    this.ambientNodes = { src, lfo };
  }

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
    this.engineGain.connect(this.master);
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
    src.connect(filter); filter.connect(g); g.connect(this.master);
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
      osc.connect(g); g.connect(this.master);
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
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
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
