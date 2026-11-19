// Suncoast radio for SUNCOAST: HEATLINE.
// One clear job: 2-3 original stations, each with a fictional track and a
// distinct live-synth loop (own tempo, chord set, waveform, bass pattern) —
// no audio files, no network, everything through the AudioEngine's music
// bus so mute / volume / the music toggle keep working.
//
// Wiring: audio.js creates one radio via createRadio(engine) and calls
// attach() once the AudioContext exists; attach() stops the engine's
// generic music loop and the station loop takes over. Cycling still works
// before the first user gesture — the chip and nowPlaying() update, and
// the sound starts on the next ensure().
// Key: R cycles stations (the reload binding moves to T elsewhere).
// Clicking the on-screen panel cycles too. The HUD shell (index.html
// #radioPanel > #radioText) owns the panel markup when it exists — this
// module only fills it; a fallback chip is built only on a bare v2 tree.
//
// API (window.SuncoastRadio):
//   stations — [{ name, freq, genre, track, artist }] (public info)
//   nowPlaying() — the current station's public info
//   cycle() — next station, returns nowPlaying()
//   setStation(i) — jump to a station index, returns nowPlaying()
//   attached — true once hooked into a live AudioContext

// Chord voicings: { root, notes } in Hz. Progressions are per-station so
// each loop has its own harmonic colour.
const STATIONS = [
  {
    id: 'shoreline', name: 'SHORELINE', freq: '96.7', genre: 'SUNSET SYNTH',
    track: 'Sunset Meridian', artist: 'The Salt Airs',
    bpm: 96, padWave: 'sawtooth', padGain: 0.028,
    bassWave: 'sawtooth', bassGain: 0.075, bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    pluckWave: 'sine', pluckGain: 0.05, pluckChance: 0.5,
    scale: [440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    chords: [
      { root: 146.83, notes: [293.66, 349.23, 440.00] }, // Dm
      { root: 116.54, notes: [233.08, 293.66, 349.23] }, // Bb
      { root: 130.81, notes: [196.00, 246.94, 329.63] }, // C
      { root: 87.31, notes: [174.61, 220.00, 261.63] }, // F
    ],
  },
  {
    id: 'pier', name: 'PIER', freq: '102.5', genre: 'SURF LO-FI',
    track: 'Ferry Lights', artist: 'Copper Gulls',
    bpm: 72, padWave: 'triangle', padGain: 0.05,
    bassWave: 'sine', bassGain: 0.09, bassSteps: [0, 7, 8, 15],
    pluckWave: 'triangle', pluckGain: 0.045, pluckChance: 0.35,
    scale: [329.63, 392.00, 440.00, 493.88, 587.33, 659.25],
    chords: [
      { root: 82.41, notes: [164.81, 196.00, 246.94] }, // Em
      { root: 130.81, notes: [196.00, 246.94, 329.63] }, // C
      { root: 98.00, notes: [196.00, 246.94, 293.66] }, // G
      { root: 146.83, notes: [293.66, 369.99, 440.00] }, // D
    ],
  },
  {
    id: 'dune', name: 'DUNE', freq: '89.9', genre: 'DESERT FUNK',
    track: 'Low Gear Heart', artist: 'Marlowe Keys',
    bpm: 116, padWave: 'square', padGain: 0.014,
    bassWave: 'square', bassGain: 0.05, bassSteps: [0, 3, 6, 8, 11, 14],
    pluckWave: 'sawtooth', pluckGain: 0.03, pluckChance: 0.6,
    scale: [440.00, 523.25, 587.33, 622.25, 698.46, 880.00],
    chords: [
      { root: 110.00, notes: [220.00, 261.63, 329.63] }, // Am
      { root: 98.00, notes: [196.00, 246.94, 293.66] }, // G
      { root: 87.31, notes: [174.61, 220.00, 261.63] }, // F
      { root: 82.41, notes: [164.81, 207.65, 246.94] }, // E
    ],
  },
];

const STEPS_PER_BAR = 16;

export function createRadio(audio) {
  let index = 0;
  let attached = false;
  let timer = null;
  let step = 0;
  let chordIdx = 0;
  let nextTime = 0;
  let melodyIdx = 2;
  let chipEl = null;
  let chipStationEl = null;
  let chipTrackEl = null;
  let radioTextEl = null; // HUD shell (#radioPanel > #radioText), when present
  let styleInjected = false;

  function station() { return STATIONS[index]; }

  function publicInfo(i) {
    const s = STATIONS[i];
    return { station: s.name, freq: s.freq, genre: s.genre, track: s.track, artist: s.artist };
  }

  function injectStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = [
      '#radioChip{position:absolute;right:20px;top:178px;width:264px;padding:10px 13px;cursor:pointer;pointer-events:auto;z-index:5}',
      '#radioChip .eyebrow{font-size:9px;letter-spacing:2px;color:#66e5ff;font-weight:800}',
      '#radioChip .eyebrow span{float:right;color:#9fb7c7}',
      '#radioStation{font-weight:850;font-size:14px;margin-top:4px}',
      '#radioStation b{color:#ffd166}',
      '#radioTrack{font-size:11px;color:#b8cbd7;margin-top:2px}',
      '#radioChip:hover{border-color:#66e5ff}',
      '@media(max-width:650px){#radioChip{right:10px;top:150px;width:200px;padding:8px 10px}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function ensureChip() {
    if (chipEl) return chipEl;
    // Adopt the HUD shell (#radioPanel > #radioText) when it exists: one
    // panel only, no second chip. Otherwise build a fallback chip.
    const shell = typeof document !== 'undefined' ? document.getElementById('radioPanel') : null;
    const shellText = typeof document !== 'undefined' ? document.getElementById('radioText') : null;
    if (shell && shellText) {
      chipEl = shell;
      radioTextEl = shellText;
      chipEl.style.pointerEvents = 'auto';
      chipEl.style.cursor = 'pointer';
      chipEl.title = 'Click or press R to change station';
      chipEl.addEventListener('click', () => cycle());
      chipEl.classList.remove('hidden');
      updateChip();
      return chipEl;
    }
    injectStyle();
    const host = document.getElementById('hud') || document.body;
    chipEl = document.createElement('div');
    chipEl.id = 'radioChip';
    chipEl.className = 'panel';
    chipEl.title = 'Click or press R to change station';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'RADIO ';
    const hint = document.createElement('span');
    hint.textContent = 'R — CHANGE';
    eyebrow.appendChild(hint);
    chipStationEl = document.createElement('div');
    chipStationEl.id = 'radioStation';
    chipTrackEl = document.createElement('div');
    chipTrackEl.id = 'radioTrack';
    chipEl.appendChild(eyebrow);
    chipEl.appendChild(chipStationEl);
    chipEl.appendChild(chipTrackEl);
    chipEl.addEventListener('click', () => cycle());
    host.appendChild(chipEl);
    updateChip();
    return chipEl;
  }

  function updateChip() {
    const s = station();
    if (radioTextEl) {
      radioTextEl.textContent = '';
      const b = document.createElement('b');
      b.textContent = `${s.name} ${s.freq}`;
      radioTextEl.appendChild(b);
      radioTextEl.appendChild(document.createTextNode(
        ` — \u201c${s.track}\u201d — ${s.artist} · ${s.genre}`));
      return;
    }
    if (!chipEl) return;
    chipStationEl.innerHTML = '';
    const name = document.createElement('span');
    name.textContent = s.name + ' ';
    const freq = document.createElement('b');
    freq.textContent = s.freq;
    chipStationEl.appendChild(name);
    chipStationEl.appendChild(freq);
    chipTrackEl.textContent = `\u201c${s.track}\u201d — ${s.artist} · ${s.genre}`;
  }

  /** Where notes go: the engine's music bus (mute/volume keep working). */
  function bus() {
    if (!audio || !audio.ctx) return null;
    return audio.musicBus || audio.master || null;
  }

  function note(freq, t, dur, wave, gainValue) {
    const out = bus();
    if (!out || !audio.ctx) return;
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainValue, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function scheduleStep(t) {
    const s = station();
    const inBar = step % STEPS_PER_BAR;
    const chord = s.chords[chordIdx % s.chords.length];
    if (inBar === 0) {
      // Pad: one soft voice per chord tone, swelling over the bar.
      const barDur = (60 / s.bpm) * 4;
      for (const f of chord.notes) note(f, t, barDur, s.padWave, s.padGain);
      // Sub bass on the root, under the pad.
      note(chord.root / 2, t, barDur * 0.9, 'sine', 0.06);
    }
    if (s.bassSteps.includes(inBar)) {
      note(chord.root, t, 0.22, s.bassWave, s.bassGain);
    }
    if (inBar % 2 === 0 && Math.random() < s.pluckChance) {
      melodyIdx = Math.max(0, Math.min(s.scale.length - 1,
        melodyIdx + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2)));
      note(s.scale[melodyIdx], t, 0.5, s.pluckWave, s.pluckGain);
    }
    if (inBar === STEPS_PER_BAR - 1) chordIdx += 1;
  }

  function tick() {
    if (!audio || !audio.ctx) return;
    const s = station();
    const stepDur = 60 / s.bpm / 4; // 16th notes
    while (nextTime < audio.ctx.currentTime + 0.5) {
      const t = Math.max(nextTime, audio.ctx.currentTime + 0.02);
      scheduleStep(t);
      nextTime += stepDur;
      step += 1;
    }
  }

  function startLoop() {
    if (timer || !audio || !audio.ctx) return;
    step = 0;
    chordIdx = 0;
    melodyIdx = 2;
    nextTime = audio.ctx.currentTime + 0.08;
    timer = setInterval(tick, 120);
  }

  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function restartLoop() {
    if (!timer) return;
    stopLoop();
    startLoop();
  }

  /** Hook into a live AudioContext; the station loop replaces the engine's generic music loop. */
  function attach() {
    if (!audio || !audio.ctx) return false;
    if (attached) return true;
    attached = true;
    if (typeof audio.stopMusic === 'function') audio.stopMusic();
    if (audio.musicOn !== false) startLoop();
    ensureChip();
    return true;
  }

  /** Follow the engine's music toggle. */
  function setEnabled(on) {
    if (!attached) return;
    if (on) startLoop();
    else stopLoop();
  }

  function nowPlaying() { return publicInfo(index); }

  function cycle() {
    index = (index + 1) % STATIONS.length;
    restartLoop();
    updateChip();
    return nowPlaying();
  }

  function setStation(i) {
    const n = Math.max(0, Math.min(STATIONS.length - 1, i | 0));
    index = n;
    restartLoop();
    updateChip();
    return nowPlaying();
  }

  ensureChip();

  // R cycles stations (reload moves to T elsewhere). Only while playing,
  // so the key stays free on the start screen and in menus.
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyR' || e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const g = window.__game;
      if (g && (!g.gameStarted || g.gameOver)) return;
      cycle();
    });
  }

  return {
    stations: STATIONS.map((s, i) => publicInfo(i)),
    nowPlaying,
    cycle,
    setStation,
    attach,
    setEnabled,
    get attached() { return attached; },
    get index() { return index; },
  };
}
