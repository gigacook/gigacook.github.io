import { network } from './network.js';

const MOVE_LEFT_KEYS = ['a', 'arrowleft'];
const MOVE_RIGHT_KEYS = ['d', 'arrowright'];
const JUMP_KEYS = ['w', 'arrowup', ' '];
const DUCK_KEYS = ['s', 'arrowdown'];
const SPRINT_KEYS = ['shift'];
const HELD_KEYS = [...MOVE_LEFT_KEYS, ...MOVE_RIGHT_KEYS, ...DUCK_KEYS, ...SPRINT_KEYS];
const TAUNT_COOLDOWN_MS = 1500;

// Secret moves, typed fast in order. None of these letters collide with the
// bound movement/attack keys above, so they can be sniffed without stealing
// any existing input.
const SEQUENCES = {
  goon: ['g', 'o', 'o', 'n'],
  snoop: ['4', '2', '0'],
  free: ['f', 'r', 'e', 'e'],
  ssj: ['s', 's', 'j'],
  piss: ['p', 'i', 's', 's'],
  horse: ['h', 'o', 'r', 's', 'e'],
  mcdonalds: ['m', 'c', 'd', 'o', 'n', 'a', 'l', 'd', 's'],
  nineeleven: ['9', '1', '1'],
};
const SEQUENCE_KEYS = new Set(Object.values(SEQUENCES).flat());
// Longer words get proportionally longer to type — a flat window would make
// "mcdonalds" almost impossible while leaving "ssj" trivially loose.
const sequenceWindowMs = (len) => 400 + 180 * len;
const SEQUENCE_BUFFER_MAX = Math.max(...Object.values(SEQUENCES).map((s) => s.length)) + 2;

export function initInput() {
  const pressed = new Set();
  let currentDir = 0;
  let duckActive = false;
  let sprintActive = false;
  let lastTauntAt = 0;
  let sequenceBuffer = []; // [{ key, t }], most recent last

  // Checks whether the tail of the buffer just completed a secret sequence.
  function checkSequences(key, now) {
    sequenceBuffer.push({ key, t: now });
    if (sequenceBuffer.length > SEQUENCE_BUFFER_MAX) sequenceBuffer.shift();

    // Longest first, so "piss" can't shadow a longer word ending the same way.
    const byLength = Object.entries(SEQUENCES).sort((a, b) => b[1].length - a[1].length);
    for (const [name, seq] of byLength) {
      if (sequenceBuffer.length < seq.length) continue;
      const tail = sequenceBuffer.slice(-seq.length);
      if (!tail.every((entry, i) => entry.key === seq[i])) continue;
      if (now - tail[0].t > sequenceWindowMs(seq.length)) continue;
      sequenceBuffer = []; // don't let one match bleed into the next
      network.secretMove(name);
      return;
    }
  }

  function updateMoveDir() {
    let dir = 0;
    if (MOVE_LEFT_KEYS.some((k) => pressed.has(k))) dir -= 1;
    if (MOVE_RIGHT_KEYS.some((k) => pressed.has(k))) dir += 1;
    if (dir !== currentDir) {
      currentDir = dir;
      network.move(dir);
    }
  }

  function updateDuck() {
    const active = DUCK_KEYS.some((k) => pressed.has(k));
    if (active !== duckActive) {
      duckActive = active;
      network.duck(active);
    }
  }

  function updateSprint() {
    const active = SPRINT_KEYS.some((k) => pressed.has(k));
    if (active !== sprintActive) {
      sprintActive = active;
      network.sprint(active);
    }
  }

  function updateHeld() {
    updateMoveDir();
    updateDuck();
    updateSprint();
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    // Secret sequences are sniffed before anything else, because several of
    // them (ssj, piss, horse, mcdonalds) contain movement keys like s/a/d
    // that would otherwise be swallowed by the held-key branch below.
    if (!e.repeat && SEQUENCE_KEYS.has(key)) checkSequences(key, performance.now());

    if (HELD_KEYS.includes(key)) {
      e.preventDefault();
      if (!pressed.has(key)) {
        pressed.add(key);
        updateHeld();
      }
      return;
    }

    if (e.repeat) return; // ignore OS key-repeat for one-shot actions

    if (JUMP_KEYS.includes(key)) {
      e.preventDefault();
      network.jump();
    } else if (key === 'j') {
      // Down + J while airborne is resolved server-side as a ground smash
      // instead of the normal short-range swing — see match.js startAttack.
      network.attack('shortRange');
    } else if (key === 'k') {
      network.attack('longRange');
    } else if (key === 'l') {
      network.attack('special');
    } else if (key === 't') {
      const now = performance.now();
      if (now - lastTauntAt >= TAUNT_COOLDOWN_MS) {
        lastTauntAt = now;
        network.taunt();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (pressed.has(key)) {
      pressed.delete(key);
      updateHeld();
    }
  });

  window.addEventListener('blur', () => {
    pressed.clear();
    if (currentDir !== 0) {
      currentDir = 0;
      network.move(0);
    }
    if (duckActive) {
      duckActive = false;
      network.duck(false);
    }
    if (sprintActive) {
      sprintActive = false;
      network.sprint(false);
    }
  });
}
