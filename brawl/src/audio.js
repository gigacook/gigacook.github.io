// Everything sound-related: a tiny synthesized SFX engine (WebAudio
// oscillators/noise, no external SFX files needed) plus the looping match
// music track. Browsers block audio until a user gesture, so `unlock()`
// must be called from a click/keydown handler before anything will play.

let ctx = null;
let masterGain = null;
let noiseBuffer = null;
let muted = false;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

function getNoiseBuffer() {
  const c = getCtx();
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// One-shot oscillator with a simple attack/decay envelope and optional
// pitch slide. `at` is an offset in seconds from "now" (for chords/beeps).
function tone({ freq, duration, type = 'sine', gain = 0.25, slideTo, at = 0 }) {
  if (muted) return;
  const c = getCtx();
  const start = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + duration);

  const g = c.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(g);
  g.connect(masterGain);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Filtered noise burst — used for whooshes, impacts, and landings.
function noiseBurst({ duration, gain = 0.3, filterType = 'bandpass', freq = 1000, Q = 1, at = 0 }) {
  if (muted) return;
  const c = getCtx();
  const start = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, start);
  filter.Q.value = Q;

  const g = c.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  src.start(start);
  src.stop(start + duration + 0.02);
}

const ATTACK_PITCH = { shortRange: 1, longRange: 1.35, special: 0.65 };

export const sfx = {
  jump() {
    tone({ freq: 240, slideTo: 520, duration: 0.16, type: 'square', gain: 0.15 });
  },
  land() {
    noiseBurst({ duration: 0.12, gain: 0.25, filterType: 'lowpass', freq: 220 });
  },
  dash() {
    noiseBurst({ duration: 0.2, gain: 0.18, filterType: 'bandpass', freq: 900, Q: 0.6 });
  },
  swing(attackKey) {
    const p = ATTACK_PITCH[attackKey] || 1;
    noiseBurst({ duration: 0.14, gain: 0.22, filterType: 'bandpass', freq: 1400 * p, Q: 1.4 });
    tone({ freq: 300 * p, slideTo: 150 * p, duration: 0.12, type: 'sawtooth', gain: 0.06 });
  },
  hit(damage, comboCount) {
    const punch = Math.min(1.6, 0.7 + damage / 30);
    noiseBurst({ duration: 0.1 * punch, gain: 0.35, filterType: 'lowpass', freq: 500, Q: 0.8 });
    tone({ freq: 110 * punch, slideTo: 55, duration: 0.14, type: 'triangle', gain: 0.3 });
    if (comboCount > 1) {
      tone({
        freq: 500 + Math.min(comboCount, 10) * 60,
        duration: 0.08,
        type: 'square',
        gain: 0.1,
        at: 0.05,
      });
    }
  },
  hurt() {
    tone({ freq: 260, slideTo: 120, duration: 0.18, type: 'sawtooth', gain: 0.12 });
  },
  taunt() {
    tone({ freq: 700, duration: 0.09, type: 'square', gain: 0.1 });
    tone({ freq: 500, duration: 0.09, type: 'square', gain: 0.1, at: 0.11 });
    tone({ freq: 850, duration: 0.14, type: 'square', gain: 0.1, at: 0.22 });
  },
  uiSelect() {
    tone({ freq: 500, slideTo: 900, duration: 0.08, type: 'square', gain: 0.12 });
  },
  uiHover() {
    tone({ freq: 350, duration: 0.04, type: 'square', gain: 0.05 });
  },
  countdownBeep() {
    tone({ freq: 440, duration: 0.12, type: 'square', gain: 0.15 });
  },
  roundStart() {
    tone({ freq: 660, duration: 0.28, type: 'square', gain: 0.18 });
    tone({ freq: 880, duration: 0.3, type: 'square', gain: 0.18, at: 0.1 });
  },
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, duration: 0.3, type: 'square', gain: 0.16, at: i * 0.12 }));
  },
  defeat() {
    [392, 349, 294, 261].forEach((f, i) => tone({ freq: f, duration: 0.35, type: 'sawtooth', gain: 0.14, at: i * 0.14 }));
  },
};

// Background music: a small original, generic-sounding fighting-game-style
// loop, built the same way as every SFX above (Web Audio oscillators/noise
// through the shared masterGain) instead of an mp3 asset file — no
// copyrighted material, and mute/volume just work for free since it shares
// the SFX signal path.
//
// Standard lookahead step-sequencer: a setInterval polls a bit faster than
// playback and schedules any notes due in the next SCHEDULE_AHEAD_S seconds,
// using the AudioContext's own clock (not JS timer time) for sample-accurate
// timing. 128 BPM, 16 steps/bar, 4-bar loop with a simple i-VI-III-VII minor
// bass progression under a kick/snare/hihat beat and short "power chord"
// stabs for a riff-like top line.
const BPM = 128;
const STEP_DUR = 60 / BPM / 4; // seconds per 16th note
const BARS = 4;
const STEPS_PER_BAR = 16;
const SCHEDULE_AHEAD_S = 0.15;
const SCHEDULER_INTERVAL_MS = 25;
const BASS_NOTES = [110, 87.3, 130.8, 98]; // A2, F2, C3, G2

let musicTimer = null;
let nextNoteTime = 0;
let currentStep = 0;

function scheduleMusicStep(step, time) {
  const c = getCtx();
  const at = time - c.currentTime;
  const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
  const inBar = step % STEPS_PER_BAR;

  if (inBar === 0 || inBar === 8) {
    tone({ freq: 55, slideTo: 35, type: 'sine', duration: 0.12, gain: 0.28, at });
  }
  if (inBar === 4 || inBar === 12) {
    noiseBurst({ duration: 0.1, gain: 0.22, filterType: 'bandpass', freq: 1800, Q: 1.2, at });
  }
  if (inBar % 4 === 2) {
    noiseBurst({ duration: 0.03, gain: 0.08, filterType: 'highpass', freq: 7000, Q: 0.7, at });
  }
  if (inBar === 0) {
    tone({ freq: BASS_NOTES[bar], type: 'sawtooth', duration: 0.4, gain: 0.14, at });
  }
  if (inBar === 6 || inBar === 14) {
    tone({ freq: BASS_NOTES[bar] * 2, type: 'square', duration: 0.15, gain: 0.06, at });
    tone({ freq: BASS_NOTES[bar] * 3, type: 'square', duration: 0.15, gain: 0.06, at });
  }
}

function musicScheduler() {
  const c = getCtx();
  while (nextNoteTime < c.currentTime + SCHEDULE_AHEAD_S) {
    scheduleMusicStep(currentStep, nextNoteTime);
    nextNoteTime += STEP_DUR;
    currentStep = (currentStep + 1) % (STEPS_PER_BAR * BARS);
  }
}

export const music = {
  // Must be called from within a real user-gesture handler (e.g. a click)
  // so later programmatic scheduling isn't blocked by autoplay policy.
  unlock() {
    getCtx().resume();
  },
  play() {
    if (muted || musicTimer) return;
    nextNoteTime = getCtx().currentTime + 0.05;
    currentStep = 0;
    musicTimer = setInterval(musicScheduler, SCHEDULER_INTERVAL_MS);
  },
  stop() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  },
};

export function unlockAudio() {
  getCtx();
  music.unlock();
}

export function setMuted(next) {
  muted = next;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.55;
}

export function isMuted() {
  return muted;
}
