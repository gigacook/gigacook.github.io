// Procedural canvas renderer. No spritesheets, no asset pipeline — every
// fighter is drawn from rotated primitives ("limbs") each frame, posed by
// simple hand-picked keyframe angles per animation state. This keeps the
// whole visual layer as plain, easily-tweakable JS instead of an external
// art pipeline.

import { getCharacter } from '../shared/characters.js';
import { getStageLayout } from '../shared/stage.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  GROUND_Y,
  PLAYER_HEIGHT,
  TICK_MS,
  CHARACTER_SCALE,
} from '../shared/constants.js';
import { sfx, music } from './audio.js';

// ---------------------------------------------------------------- themes --

const THEMES = {
  // Warrior rides a wheelchair and swings an aubergine; `metal` is the chair frame.
  warrior: { skin: '#e8b58c', primary: '#b23a2e', secondary: '#7a2620', metal: '#b8bcc8', accent: '#7d3fa0' },
  // Archer is a clown: white suit, red accents, yellow banana "bow".
  archer: { skin: '#f2e4d4', primary: '#f4f1ea', secondary: '#d83a3a', metal: '#ffd93d', accent: '#3ec9f0' },
  // Mage is a very large man in a pink baby dress with an oversized pink hat.
  mage: { skin: '#f0c2a0', primary: '#ff9ec7', secondary: '#e0559a', metal: '#ffb3d9', accent: '#ff6fb5' },
  // Rogue is a soot-blackened gremlin with a gold chain and a backwards cap.
  rogue: { skin: '#5a5048', primary: '#3a3630', secondary: '#2a2620', metal: '#ffd700', accent: '#ff2d55' },
};
const OUTLINE = '#1a1015';

// How much of the arena the camera pulls back to show. <1 zooms out, framing
// the stage smaller inside the canvas with a margin around it. 1 = old behaviour.
const WORLD_ZOOM = 0.85;

// -------------------------------------------------------------- geometry --

const LEG_LEN = 24;
const TORSO_LEN = 26;
const HEAD_R = 9;
const ARM_LEN = 20;
const SHOULDER_Y = -(LEG_LEN + TORSO_LEN);
const HIP_Y = -LEG_LEN;
const HEAD_Y = SHOULDER_Y - HEAD_R - 2;

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function limb(ctx, pivotX, pivotY, len, w, angle, color, weaponDraw) {
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -w / 2, 0, w, len, w * 0.4);
  ctx.fill();
  ctx.stroke();
  if (weaponDraw) {
    ctx.translate(0, len);
    weaponDraw(ctx);
  }
  ctx.restore();
}

// The warrior's sword, replaced by a large aubergine. Same call signature and
// roughly the same silhouette length as weaponSword so every attack pose,
// hitbox and reach still reads correctly.
function weaponAubergine(ctx) {
  // Deliberately about twice the size a real weapon would be — an
  // appropriately-sized aubergine is not funny.
  // Double size, and pushed out in front of the fighter so a weapon this
  // ridiculous doesn't sit on top of his own head.
  ctx.translate(7, 0);
  ctx.scale(2, 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;

  ctx.fillStyle = '#7d3fa0';
  ctx.beginPath();
  ctx.ellipse(3, -20, 5.5, 14, 0.06, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // glossy highlight
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(1.5, -24, 1.6, 5, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // green calyx + stem at the grip end
  ctx.fillStyle = '#3f8f3a';
  ctx.beginPath();
  ctx.ellipse(3, -7, 4, 3.2, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#2f6f2a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(3, -6);
  ctx.lineTo(3, 1);
  ctx.stroke();
}

// The archer's bow, replaced by a banana. Kept at the same ~20px arc radius so
// the draw/aim poses line up with where arrows actually spawn.
function weaponBanana(ctx) {
  // Same reasoning as the aubergine — comically oversized on purpose.
  ctx.scale(2, 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;

  // curved body
  ctx.fillStyle = '#ffd93d';
  ctx.beginPath();
  ctx.moveTo(-2, -24);
  ctx.quadraticCurveTo(20, -6, -2, 12);
  ctx.quadraticCurveTo(8, -6, -2, -24);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // browned tips
  ctx.fillStyle = '#6b4a2b';
  ctx.beginPath();
  ctx.arc(-2, -24, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-2, 12, 2, 0, Math.PI * 2);
  ctx.fill();

  // the "string" — still there, still absurd
  ctx.strokeStyle = 'rgba(230,230,220,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, -24);
  ctx.lineTo(-2, 12);
  ctx.stroke();
}

// Pink wand for the mage. `glow` still drives the orb size so a charged
// special reads as brighter, exactly as before.
function weaponStaff(ctx, theme, glow) {
  ctx.strokeStyle = '#f7d6e8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(0, -34);
  ctx.stroke();
  const r = 5 + glow * 4;
  const grad = ctx.createRadialGradient(0, -36, 0, 0, -36, r * 2.2);
  grad.addColorStop(0, theme.accent);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, -36, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(0, -36, r, 0, Math.PI * 2);
  ctx.fill();
}

function weaponDagger(ctx, theme) {
  ctx.fillStyle = theme.metal;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, -2, -2, 4, 5, 1); // hilt
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#dcdce4';
  roundRectPath(ctx, -1.5, -18, 3, 16, 1);
  ctx.fill(); ctx.stroke();
}

// ------------------------------------------------------------- costumes --

// The warrior's legs are replaced wholesale by a wheelchair. Drawn in the same
// local space the leg limbs occupied (origin at the hips, +y downward toward
// the feet), so the rest of the rig — torso, arms, knockdown rotation — needs
// no special-casing. `spin` is driven by the existing walk cycle.
function drawWheelchair(ctx, theme, spin) {
  const wheelR = 15;
  const wheelY = -wheelR + 2; // sits so the tyre bottom lands on the feet line
  ctx.strokeStyle = OUTLINE;

  // seat + backrest frame
  ctx.fillStyle = theme.secondary;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -12, HIP_Y - 2, 24, 7, 2); // seat pan
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = theme.metal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-11, HIP_Y);   // backrest post
  ctx.lineTo(-11, HIP_Y - 16);
  ctx.moveTo(10, HIP_Y + 4); // front leg rail down to the footplate
  ctx.lineTo(14, wheelY + 8);
  ctx.stroke();

  // small front castor
  ctx.fillStyle = '#2a2a30';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(15, wheelY + 11, 4, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // big drive wheel — tyre, hub, and spokes that rotate with `spin`
  ctx.fillStyle = 'rgba(30,28,34,0.9)';
  ctx.beginPath();
  ctx.arc(0, wheelY, wheelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1015';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.translate(0, wheelY);
  ctx.rotate(spin);
  ctx.strokeStyle = theme.metal;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (wheelR - 3), Math.sin(a) * (wheelR - 3));
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = theme.metal;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, wheelY, 3.5, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

// Clown extras for the archer: polka dots, ruff, red nose, huge shoes.
function drawClownRuff(ctx) {
  const colors = ['#e64a4a', '#f0a33c', '#f3e04a', '#4fbf5a', '#4a8ce6', '#9b5ae6'];
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  for (let i = 0; i < colors.length; i++) {
    const a = -Math.PI * 0.85 + (i / (colors.length - 1)) * Math.PI * 0.7;
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.moveTo(0, SHOULDER_Y + 2);
    ctx.lineTo(Math.cos(a) * 15, SHOULDER_Y + 2 + Math.sin(a) * 15);
    ctx.lineTo(Math.cos(a + 0.45) * 15, SHOULDER_Y + 2 + Math.sin(a + 0.45) * 15);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

function drawClownDots(ctx) {
  ctx.fillStyle = '#d83a3a';
  for (const [dx, dy] of [[-6, 6], [5, 3], [-2, 14], [7, 16], [-8, 20]]) {
    ctx.beginPath();
    ctx.arc(dx, SHOULDER_Y + dy, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Oversized shoe at the end of a leg posed at `angle` — mirrors the pivot math
// limb() uses so the shoe lands exactly on the foot.
function drawClownShoe(ctx, pivotX, angle) {
  ctx.save();
  ctx.translate(pivotX, HIP_Y);
  ctx.rotate(angle);
  ctx.translate(0, LEG_LEN);
  ctx.rotate(-angle); // keep the shoe flat regardless of leg swing
  ctx.fillStyle = '#d83a3a';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(4, 1, 11, 4.5, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Rogue's gold chain — a huge sagging loop of links across the chest. Drawn
// over the arms (not under the torso) so the twin daggers can't bury it.
function drawGoldChain(ctx) {
  ctx.fillStyle = '#ffd700';
  ctx.strokeStyle = '#8a6a00';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const x = -15 + t * 30;
    const y = SHOULDER_Y + 4 + Math.sin(t * Math.PI) * 20;
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  // absurd chunky pendant at the bottom of the sag
  ctx.fillStyle = '#ffe45c';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, -7, SHOULDER_Y + 22, 14, 13, 3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff6b0';
  roundRectPath(ctx, -4, SHOULDER_Y + 25, 8, 7, 2);
  ctx.fill();
}

// -------------------------------------------------------- idle antics --

// After a couple of seconds of standing still, each fighter starts doing
// something stupid. Drawn in the fighter's own local space (origin at the
// feet, -y upward), cycling on a per-character loop.
const IDLE_ANTIC_AFTER_MS = 2000;

// Rogue: an absurdly large silver pistol with a magazine several times the
// length of the gun, which he spins, admires, and occasionally fires.
function drawDeagle(ctx, phase, firing) {
  ctx.save();
  // Raised so the ridiculous magazine hangs to about the feet rather than
  // clipping through the floor.
  ctx.translate(12, SHOULDER_Y - 24);
  ctx.rotate(Math.sin(phase * 2) * 0.9); // twirling
  ctx.scale(1.3, 1.3);

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;

  // absurd magazine, hanging way below the grip
  ctx.fillStyle = '#3a3a44';
  roundRectPath(ctx, -3, 4, 8, 66, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c8a53a';
  for (let i = 0; i < 9; i++) {
    roundRectPath(ctx, -1.5, 8 + i * 7, 5, 5, 1);
    ctx.fill();
  }

  // slide + barrel
  ctx.fillStyle = '#d8dce4';
  roundRectPath(ctx, -6, -10, 44, 12, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#9aa2b0';
  roundRectPath(ctx, -8, 0, 14, 10, 2); // grip block
  ctx.fill();
  ctx.stroke();

  // muzzle flash
  if (firing) {
    const g = ctx.createRadialGradient(42, -4, 0, 42, -4, 26);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.4, '#ffc23a');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(42, -4, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Mage: reclines in a gaming chair at a PC, or scratches his belly and
// attracts flies, or lies down and snores. Cycles between the three.
function drawGamingSetup(ctx, phase) {
  ctx.save();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;

  // chair back, leaned all the way over
  ctx.save();
  ctx.translate(-14, HIP_Y + 4);
  ctx.rotate(-0.9);
  ctx.fillStyle = '#1e1e26';
  roundRectPath(ctx, -8, -54, 18, 58, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c8102e';
  roundRectPath(ctx, -5, -48, 4, 44, 2);
  ctx.fill();
  ctx.restore();

  // desk + monitor
  ctx.fillStyle = '#4a3a2e';
  roundRectPath(ctx, 16, HIP_Y - 6, 42, 5, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#12121a';
  roundRectPath(ctx, 24, HIP_Y - 40, 30, 32, 3);
  ctx.fill();
  ctx.stroke();
  // screen glow, flickering with "gameplay"
  ctx.fillStyle = `rgba(120,200,255,${0.5 + Math.sin(phase * 9) * 0.3})`;
  roundRectPath(ctx, 27, HIP_Y - 37, 24, 26, 2);
  ctx.fill();
  ctx.restore();
}

function drawBellyFlies(ctx, phase) {
  ctx.fillStyle = '#2f4a1e';
  for (let i = 0; i < 5; i++) {
    const a = phase * 3 + i * 1.7;
    const fx = Math.cos(a) * (16 + i * 4);
    const fy = SHOULDER_Y + 16 + Math.sin(a * 1.7) * 12;
    ctx.beginPath();
    ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnoreZ(ctx, phase) {
  ctx.save();
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 3; i++) {
    const t = (phase * 0.5 + i / 3) % 1;
    ctx.globalAlpha = 1 - t;
    ctx.fillText('z', 12 + t * 22, SHOULDER_Y - t * 40);
  }
  ctx.restore();
}

// Warrior: pops a wheelie and polishes the aubergine on his sleeve.
function drawWheelie(ctx, phase) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const a = phase * 4 + i * 2;
    ctx.beginPath();
    ctx.arc(-24 - i * 8, -6, 4 + Math.sin(a) * 2, 0, Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------- animation keyframes --

const ATTACK_POSE = {
  shortRange: { startup: -0.9, active: 1.25, recovery: 0.25, lean: { startup: -0.1, active: 0.3, recovery: 0.05 } },
  longRange: { startup: -1.1, active: 0.75, recovery: 0.15, lean: { startup: -0.06, active: 0.12, recovery: 0.02 } },
  special: { startup: -1.4, active: 1.5, recovery: 0.35, lean: { startup: -0.2, active: 0.4, recovery: 0.08 } },
};

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// -------------------------------------------------------------- trackers --

const trackers = new Map(); // playerId -> per-player animation memory

function trackerFor(id) {
  if (!trackers.has(id)) {
    trackers.set(id, {
      animKey: 'idle',
      lastX: null,
      lastJumpY: 0,
      walkCycle: 0,
      phase: null,
      phaseStart: 0,
      idleStart: performance.now(),
      tumbling: false,
      airCycle: 0,
      lastStepPhase: null,
    });
  }
  return trackers.get(id);
}

// --------------------------------------------------------------- effects --

let particles = [];
let popups = [];
let shakeMag = 0;
let lastDrawTime = null;

function spawnParticles(x, y, count, color, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (opts.speed || 90) * (0.4 + Math.random() * 0.8);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (opts.upBias || 40),
      life: opts.life || 0.4,
      maxLife: opts.life || 0.4,
      size: opts.size || 3,
      color,
      gravity: opts.gravity ?? 260,
    });
  }
}

function spawnPopup(x, y, text, color) {
  popups.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}

function triggerShake(amount) {
  shakeMag = Math.min(14, shakeMag + amount);
}

function updateEffects(dt) {
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  popups = popups.filter((p) => p.life > 0);
  for (const p of popups) {
    p.y -= 26 * dt;
    p.life -= dt;
  }
  shakeMag *= Math.max(0, 1 - 6 * dt);
  if (shakeMag < 0.05) shakeMag = 0;
}

function drawEffects(ctx) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px "Courier New", monospace';
  for (const p of popups) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

// ----------------------------------------------------------------- state --

let prevState = null;
let currState = null;
let arrivalTime = 0;
let localId = null;
const tauntBubbles = new Map(); // playerId -> { text, until }

export function setLocalId(id) {
  localId = id;
}

// Purely cosmetic cameo triggered by the 4,2,0 secret move. The root it
// represents is already applied server-side — nothing here is collidable.
let snoopRoll = null; // { startedAt, dir }

// Expanding shockwave rings, used to punctuate the goon burst.
let shockwaves = []; // { x, y, startedAt, durMs, maxR, color }

export function spawnShockwave(x, y, { durMs = 550, maxR = 420, color = '200,235,255' } = {}) {
  shockwaves.push({ x, y, startedAt: performance.now(), durMs, maxR, color });
}

function drawShockwaves(ctx, now) {
  shockwaves = shockwaves.filter((w) => now - w.startedAt < w.durMs);
  for (const w of shockwaves) {
    const t = (now - w.startedAt) / w.durMs;
    const r = w.maxR * easeOut(t);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = `rgba(${w.color},1)`;
    ctx.lineWidth = 10 * (1 - t) + 1.5;
    ctx.beginPath();
    ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function showGoonBurst(casterId) {
  const caster = currState?.players.find((p) => p.id === casterId);
  if (!caster) return;
  const y = GROUND_Y - caster.jumpY - PLAYER_HEIGHT / 2;
  spawnShockwave(caster.x, y, { durMs: 620, maxR: 480 });
  spawnShockwave(caster.x, y, { durMs: 900, maxR: 620, color: '150,210,255' });
  triggerShake(22);
  spawnParticles(caster.x, y, 40, 'rgba(210,240,255,0.9)', {
    speed: 420, life: 0.8, size: 5, gravity: 200,
  });
}

// One-off cosmetic set-pieces. Each is a timestamped record the draw loop
// interprets; none of them are collidable — the mechanics all live server-side.
let ssjCharge = null; // { id, startedAt, durMs }
let pissStream = null; // { casterId, targetId, startedAt }
let mcdonalds = null; // { casterId, targetId, startedAt }
let horseRider = null; // { casterId, startedAt }

export function showSsjCharge(casterId) {
  ssjCharge = { id: casterId, startedAt: performance.now(), durMs: 10000 };
  triggerShake(10);
}

export function showPissStream({ casterId, targetId }) {
  pissStream = { casterId, targetId, startedAt: performance.now() };
}

export function showMcdonalds({ casterId, targetId }) {
  mcdonalds = { casterId, targetId, startedAt: performance.now() };
}

export function showHorse(casterId) {
  horseRider = { casterId, startedAt: performance.now() };
}

export function showFreeShout(casterId, stacks) {
  const p = currState?.players.find((pl) => pl.id === casterId);
  if (!p) return;
  const y = GROUND_Y - p.jumpY - PLAYER_HEIGHT;
  triggerShake(8 + stacks * 6);
  spawnShockwave(p.x, y, { durMs: 500, maxR: 200 + stacks * 120, color: '255,240,150' });
  spawnPopup(p.x, y - 30, `x${stacks} BIG`, '#ffe45c');
}

const playerById = (id) => currState?.players.find((p) => p.id === id);

// Dragon Ball style charge: lightning arcs, rising debris, growing glow.
function drawSsjCharge(ctx, now) {
  if (!ssjCharge) return;
  const t = (now - ssjCharge.startedAt) / ssjCharge.durMs;
  if (t >= 1) {
    ssjCharge = null;
    return;
  }
  const p = playerById(ssjCharge.id);
  if (!p) return;

  const cx = p.x;
  const cy = GROUND_Y - p.jumpY - PLAYER_HEIGHT * 0.5;
  const intensity = 0.25 + t * 0.75;

  // ground column of golden light, widening as the charge builds
  const col = ctx.createLinearGradient(0, GROUND_Y - p.jumpY, 0, GROUND_Y - p.jumpY - 460 * intensity);
  col.addColorStop(0, `rgba(255,215,80,${0.5 * intensity})`);
  col.addColorStop(1, 'rgba(255,215,80,0)');
  ctx.fillStyle = col;
  ctx.fillRect(cx - 70 * intensity, GROUND_Y - p.jumpY - 460 * intensity, 140 * intensity, 460 * intensity);

  // crackling lightning arcs
  ctx.strokeStyle = `rgba(180,230,255,${0.6 + 0.4 * intensity})`;
  ctx.lineWidth = 2 + intensity * 2;
  const bolts = 3 + Math.floor(intensity * 5);
  for (let i = 0; i < bolts; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 120 * intensity;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let bx = cx;
    let by = cy;
    for (let seg = 0; seg < 4; seg++) {
      bx += (Math.cos(a) * r) / 4 + (Math.random() - 0.5) * 34;
      by += (Math.sin(a) * r) / 4 + (Math.random() - 0.5) * 34;
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  // debris sucked upward
  if (Math.random() < 0.6) {
    spawnParticles(cx + (Math.random() - 0.5) * 240, GROUND_Y - p.jumpY, 1, 'rgba(220,190,120,0.9)', {
      speed: 40, life: 0.9, size: 3 + intensity * 3, upBias: 260 * intensity, gravity: -160,
    });
  }
  if (Math.random() < 0.25) triggerShake(3 + intensity * 9);
}

// A stream of piss, and the target noisily regretting it.
function drawPissStream(ctx, now) {
  if (!pissStream) return;
  const elapsed = now - pissStream.startedAt;
  if (elapsed > 2600) {
    pissStream = null;
    return;
  }
  const caster = playerById(pissStream.casterId);
  const target = playerById(pissStream.targetId);
  if (!caster || !target) return;

  const dir = Math.sign(target.x - caster.x) || 1;
  const x0 = caster.x + dir * 22;
  const y0 = GROUND_Y - caster.jumpY - PLAYER_HEIGHT * 0.45;

  // arcing stream
  ctx.strokeStyle = 'rgba(240,225,90,0.85)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const midX = (x0 + target.x) / 2;
  ctx.quadraticCurveTo(midX, y0 - 70, target.x, GROUND_Y - target.jumpY - PLAYER_HEIGHT * 0.4);
  ctx.stroke();
  ctx.lineCap = 'butt';

  spawnParticles(x0 + dir * 30, y0 - 10, 2, 'rgba(245,232,110,0.9)', {
    speed: 220, life: 0.5, size: 3, gravity: 420,
  });
  // splashback at the target
  spawnParticles(target.x, GROUND_Y - target.jumpY - 20, 2, 'rgba(230,215,80,0.8)', {
    speed: 120, life: 0.6, size: 3, upBias: 40, gravity: 380,
  });
}

// Bile, continuously, for as long as the debuff lasts.
function drawPuking(ctx, player, now) {
  if (!(player.effects?.pissedMs > 0)) return;
  if (Math.random() > 0.5) return;
  const dir = player.facing || 1;
  spawnParticles(
    player.x + dir * 24,
    GROUND_Y - player.jumpY - PLAYER_HEIGHT * 0.62,
    2,
    'rgba(120,180,60,0.9)',
    { speed: 190, life: 0.8, size: 5, upBias: 10, gravity: 520 }
  );
}

// Golden-arches UFO that beams the target with a milkshake.
function drawMcdonalds(ctx, now) {
  if (!mcdonalds) return;
  const elapsed = now - mcdonalds.startedAt;
  const DUR = 4200;
  if (elapsed > DUR) {
    mcdonalds = null;
    return;
  }
  const target = playerById(mcdonalds.targetId);
  if (!target) return;

  const t = elapsed / DUR;
  // fly in, hover and beam, fly out
  const approach = Math.min(1, t / 0.25);
  const shipX = target.x;
  const shipY = -80 + 200 * easeOut(approach);

  // beam while hovering
  if (t > 0.25 && t < 0.85) {
    const beamW = 90;
    const grad = ctx.createLinearGradient(0, shipY, 0, GROUND_Y - target.jumpY);
    grad.addColorStop(0, 'rgba(255,230,240,0.75)');
    grad.addColorStop(1, 'rgba(255,170,210,0.25)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(shipX - 30, shipY + 20);
    ctx.lineTo(shipX + 30, shipY + 20);
    ctx.lineTo(shipX + beamW, GROUND_Y - target.jumpY);
    ctx.lineTo(shipX - beamW, GROUND_Y - target.jumpY);
    ctx.closePath();
    ctx.fill();

    spawnParticles(shipX + (Math.random() - 0.5) * 120, GROUND_Y - target.jumpY - 30, 2, 'rgba(255,200,230,0.95)', {
      speed: 90, life: 0.8, size: 5, upBias: -60, gravity: 300,
    });
  }

  // saucer
  ctx.save();
  ctx.translate(shipX, shipY);
  ctx.fillStyle = '#c8102e';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 82, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(190,225,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, -14, 40, 22, 0, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  // the golden arches, unmistakable
  ctx.strokeStyle = '#ffc72c';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, -6);
  ctx.quadraticCurveTo(-10, -34, 0, -6);
  ctx.quadraticCurveTo(10, -34, 20, -6);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.restore();
}

// The stallion, rendered under whoever is riding it.
function drawHorse(ctx, player, now) {
  if (!(player.effects?.horseMs > 0)) return;
  const dir = player.facing || 1;
  const bottom = GROUND_Y - player.jumpY;
  const gallop = Math.sin(now / 70) * 4;

  ctx.save();
  ctx.translate(player.x, bottom);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#f4f1ea';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;

  roundRectPath(ctx, -58, -74, 116, 44, 18); // barrel
  ctx.fill();
  ctx.stroke();

  // neck + head
  ctx.beginPath();
  ctx.moveTo(38, -66);
  ctx.lineTo(74, -122);
  ctx.lineTo(96, -112);
  ctx.lineTo(60, -54);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, 74, -132, 34, 22, 8);
  ctx.fill();
  ctx.stroke();

  // legs
  for (const [lx, phase] of [[-42, 0], [-24, 1], [30, 1], [48, 0]]) {
    ctx.save();
    ctx.translate(lx, -34);
    ctx.rotate((phase ? gallop : -gallop) * 0.05);
    roundRectPath(ctx, -6, 0, 12, 36, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // tail + mane
  ctx.fillStyle = '#e8e2d4';
  ctx.beginPath();
  ctx.moveTo(-56, -70);
  ctx.quadraticCurveTo(-92, -56 + gallop, -78, -18);
  ctx.quadraticCurveTo(-62, -46, -52, -52);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (Math.random() < 0.4) {
    spawnParticles(player.x - dir * 40, bottom, 1, 'rgba(200,190,170,0.6)', {
      speed: 70, life: 0.4, size: 3, upBias: 20, gravity: 200,
    });
  }
}

export function showPlaneIncoming() {
  triggerShake(6);
}

export function showStarRage() {
  triggerShake(26);
  spawnShockwave(ARENA_WIDTH / 2, GROUND_Y - 220, { durMs: 700, maxR: 700, color: '120,190,255' });
}

export function showSnoopRoll(casterId) {
  const caster = currState?.players.find((p) => p.id === casterId);
  const target = currState?.players.find((p) => p.id !== casterId);
  // roll toward whoever is getting rooted
  const dir = target && caster ? (target.x >= caster.x ? 1 : -1) : 1;
  snoopRoll = { startedAt: performance.now(), dir };
}

const SNOOP_ROLL_MS = 1800;

function drawSnoopRoll(ctx, now) {
  if (!snoopRoll) return;
  const t = (now - snoopRoll.startedAt) / SNOOP_ROLL_MS;
  if (t >= 1) {
    snoopRoll = null;
    return;
  }

  const dir = snoopRoll.dir;
  const x = dir > 0 ? -120 + t * (ARENA_WIDTH + 240) : ARENA_WIDTH + 120 - t * (ARENA_WIDTH + 240);
  const y = GROUND_Y - 26;

  // smoke trail, thickening behind him
  for (let i = 0; i < 3; i++) {
    spawnParticles(x - dir * (14 + i * 12), y - 6 - i * 4, 1, 'rgba(150,190,150,0.5)', {
      speed: 18, life: 1.1, size: 7 + i * 2, upBias: 14, gravity: -12,
    });
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);

  // low-rider silhouette: long body, two wheels, a lean
  ctx.fillStyle = '#2b2b33';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -34, -14, 68, 18, 6);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, -16, -26, 30, 14, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#12121a';
  for (const wx of [-20, 20]) {
    ctx.beginPath();
    ctx.arc(wx, 5, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // a head, braids, and the obligatory shades
  ctx.fillStyle = '#6b4a34';
  ctx.beginPath();
  ctx.arc(4, -32, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#141018';
  roundRectPath(ctx, -1, -35, 11, 4, 1.5);
  ctx.fill();
  ctx.fillStyle = '#241a14';
  for (const by of [-38, -33, -28]) {
    ctx.beginPath();
    ctx.arc(-6, by, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function showTaunt(playerId, message) {
  tauntBubbles.set(playerId, { text: message, until: performance.now() + 2500 });
  sfx.taunt();
}

export function ingestState(state) {
  const prevPhase = currState?.phase;

  // A bomb that vanished while its target's health hit 0 detonated on them —
  // anything else (fuse ran out, missed) is a dud and gets no fireworks.
  if (currState?.bombs?.length) {
    for (const old of currState.bombs) {
      if (state.bombs?.some((b) => b.id === old.id)) continue;
      const target = state.players?.find((p) => p.id === old.targetId);
      if (!target || target.health > 0) continue;
      triggerBombFlash();
      triggerShake(26);
      sfx.hit(9, 1);
      spawnParticles(old.x, GROUND_Y - old.jumpY, 60, '#ffb43a', {
        speed: 320, life: 0.9, size: 5, gravity: 240,
      });
      spawnParticles(old.x, GROUND_Y - old.jumpY, 30, '#4a4a54', {
        speed: 180, life: 1.3, size: 7, upBias: 60, gravity: -30,
      });
      spawnPopup(old.x, GROUND_Y - old.jumpY - 40, 'BOOM', '#ffd23f');
    }
  }
  if (state.players && currState?.players) {
    for (let i = 0; i < state.players.length; i++) {
      const now = state.players[i];
      const old = currState.players.find((p) => p.id === now.id);
      if (!old) continue;

      // Idle antics with real consequences announce themselves via a
      // timestamp that changes on the tick they fire.
      if (now.lastFartAt && now.lastFartAt !== old.lastFartAt) {
        triggerShake(14);
        sfx.hit(3, 1);
        spawnParticles(now.x, GROUND_Y - now.jumpY - 26, 26, 'rgba(150,200,90,0.65)', {
          speed: 150, life: 1.5, size: 9, upBias: 30, gravity: -40,
        });
        spawnPopup(now.x, GROUND_Y - now.jumpY - 90, 'BRAAAP', '#9ad14a');
      }
      if (now.lastMisfireAt && now.lastMisfireAt !== old.lastMisfireAt) {
        triggerShake(30);
        sfx.hit(9, 1);
        trackerFor(now.id).misfireFlashUntil = performance.now() + 260;
        spawnParticles(now.x + (now.facing || 1) * 60, GROUND_Y - now.jumpY - 80, 30, '#ffd23f', {
          speed: 380, life: 0.7, size: 5, gravity: 160,
        });
        spawnPopup(now.x, GROUND_Y - now.jumpY - 120, 'OOPS', '#ffe45c');
      }

      if (old.grounded && !now.grounded) {
        sfx.jump();
        spawnParticles(now.x, GROUND_Y, 6, '#cfc6b8', { speed: 60, life: 0.3, size: 2, upBias: 10 });
      }
      if (!old.grounded && now.grounded) {
        sfx.land();
        spawnParticles(now.x, GROUND_Y, 8, '#cfc6b8', { speed: 70, life: 0.35, size: 2, upBias: 20 });
        trackerFor(now.id).squashUntil = performance.now() + 140;
      }
      const oldPhase = old.attack?.phase;
      const newPhase = now.attack?.phase;
      if (oldPhase !== 'active' && newPhase === 'active') {
        sfx.swing(now.attack.key);
        if (now.attack.key === 'special') {
          const theme = THEMES[now.characterId] || THEMES.warrior;
          const cf = now.attack.chargeFraction || 0;
          spawnParticles(now.x + now.facing * 20, GROUND_Y - PLAYER_HEIGHT / 2, Math.round(8 + 14 * cf), theme.accent, {
            speed: 100 + 90 * cf, life: 0.5, size: 3,
          });
          if (cf >= 1) triggerShake(5);
        } else if (now.attack.key === 'spinKick') {
          spawnParticles(now.x, GROUND_Y - PLAYER_HEIGHT / 2, 12, '#ffd23f', { speed: 150, life: 0.35, size: 2 });
        } else if (now.attack.key === 'throw') {
          const opponent = state.players.find((p) => p.id !== now.id);
          if (opponent?.grabbedBy === now.id) {
            sfx.hit(4, 1);
            spawnParticles(opponent.x, GROUND_Y - PLAYER_HEIGHT / 2, 8, '#ff5fa2', { speed: 90, life: 0.3, size: 2 });
          }
        } else if (now.attack.key === 'launcherKick') {
          spawnParticles(now.x + now.facing * 16, GROUND_Y - PLAYER_HEIGHT / 2, 10, '#7ee7ff', { speed: 130, life: 0.4, size: 3, upBias: 60 });
        }
      }
      if (old.attack?.key === 'groundSmash' && oldPhase === 'falling' && newPhase === 'recovery') {
        sfx.land();
        triggerShake(10);
        spawnParticles(now.x, GROUND_Y - now.jumpY, 16, '#cfc6b8', { speed: 130, life: 0.4, size: 3, upBias: 20 });
      }

      if (now.score > old.score) {
        const opponent = state.players.find((p) => p.id !== now.id);
        const oldOpponent = currState.players.find((p) => p.id === opponent?.id);
        const damage = oldOpponent ? Math.max(1, oldOpponent.health - opponent.health) : 8;
        sfx.hit(damage, now.comboCount);
        sfx.hurt();
        if (opponent) {
          triggerShake(4 + Math.min(10, damage / 3));
          if (now.attack?.key === 'throw' || now.attack?.key === 'launcherKick') triggerShake(6);
          spawnParticles(opponent.x, GROUND_Y - PLAYER_HEIGHT / 2, 10, '#fff', { speed: 160, life: 0.35, size: 3 });
          spawnPopup(opponent.x, GROUND_Y - PLAYER_HEIGHT - 10, `+${now.lastHitPoints}`, '#ffd23f');
          if (now.comboCount > 1) {
            spawnPopup(now.x, GROUND_Y - PLAYER_HEIGHT - 26, `${now.comboCount} HIT COMBO`, '#ff5fa2');
          }
        }
      }
    }
  }

  if (prevPhase && prevPhase !== state.phase) {
    if (state.phase === 'playing') {
      sfx.roundStart();
      music.play();
    } else if (state.phase === 'over') {
      music.stop();
      const iWon = state.winnerId === localId;
      const draw = state.winnerId === null;
      if (draw) { /* no fanfare either way */ }
      else if (iWon) sfx.victory();
      else sfx.defeat();
    }
  }

  prevState = currState;
  currState = state;
  arrivalTime = performance.now();
}

function interpolatedPlayers() {
  if (!currState) return [];
  if (!prevState) return currState.players;
  const t = Math.min(1, (performance.now() - arrivalTime) / TICK_MS);
  return currState.players.map((now) => {
    const old = prevState.players.find((p) => p.id === now.id);
    if (!old) return now;
    return {
      ...now,
      x: old.x + (now.x - old.x) * t,
      jumpY: old.jumpY + (now.jumpY - old.jumpY) * t,
    };
  });
}

function interpolatedProjectiles() {
  if (!currState) return [];
  if (!prevState) return currState.projectiles;
  const t = Math.min(1, (performance.now() - arrivalTime) / TICK_MS);
  return currState.projectiles.map((now) => {
    const old = prevState.projectiles.find((p) => p.id === now.id);
    if (!old) return now;
    return { ...now, x: old.x + (now.x - old.x) * t, y: old.y + (now.y - old.y) * t };
  });
}

// ------------------------------------------------------------- background --

let stageVideo = null;
(async function tryLoadStageVideo() {
  try {
    const head = await fetch('/assets/video/stage-bg.mp4', { method: 'HEAD' });
    if (!head.ok) return;
  } catch {
    return;
  }
  const el = document.createElement('video');
  el.src = '/assets/video/stage-bg.mp4';
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.addEventListener('loadeddata', () => {
    stageVideo = el;
    el.play().catch(() => {});
  }, { once: true });
  el.load();
})();

const FULL_FLOOR = [{ id: 'floor', x1: -Infinity, x2: Infinity, height: 0 }];

// Per-stage backdrops, drawn in coarse blocks so they read as chunky pixel art
// rather than smooth vector shapes. Each only paints the sky region above
// GROUND_Y — the void, floor segments and platforms are drawn on top of this by
// drawBackground/drawPlatforms and must stay untouched.

const PX = 8; // background "pixel" size — everything snaps to this grid

// Shopfront signage. Comic Sans, badly kerned, over-promising.
function sign(ctx, x, y, text, sub, color = '#ffe45c') {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 30px "Comic Sans MS", "Chalkboard SE", cursive';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  if (sub) {
    ctx.font = 'bold 18px "Comic Sans MS", "Chalkboard SE", cursive';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(sub, x, y + 26);
    ctx.fillStyle = '#fff3d0';
    ctx.fillText(sub, x, y + 26);
  }

  ctx.restore();
}

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  const sx = Math.round(x / PX) * PX;
  const sy = Math.round(y / PX) * PX;
  ctx.fillRect(sx, sy, Math.max(PX, Math.round(w / PX) * PX), Math.max(PX, Math.round(h / PX) * PX));
}

function skyWash(ctx, top, bottom) {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, ARENA_WIDTH, GROUND_Y);
}

// A flicker value that mostly sits at 1 and occasionally stutters — cheap
// "dying fluorescent tube" without tracking any state.
function flicker(now, seed) {
  const n = Math.sin((now / 90 + seed) * 12.9898) * 43758.5453;
  return (n - Math.floor(n)) > 0.08 ? 1 : 0.35;
}

function drawDefaultBg(ctx) {
  skyWash(ctx, '#1a1030', '#3a2456');
  for (const [x, w, h] of [[83, 96, 164], [303, 69, 123], [715, 124, 191], [963, 76, 136]]) {
    px(ctx, x, GROUND_Y - h, w, h, 'rgba(90,60,120,0.4)');
  }
}

// twin-ledges — a petrol station forecourt at 3am
function drawGasStationBg(ctx, now) {
  skyWash(ctx, '#0b1226', '#1d2a44');

  // low city smear on the horizon
  for (const [x, w, h] of [[0, 140, 60], [180, 90, 44], [330, 60, 78], [880, 120, 52], [1020, 80, 70]]) {
    px(ctx, x, GROUND_Y - h, w, h, '#141c30');
  }

  // canopy posts + roof slab
  px(ctx, 250, GROUND_Y - 210, 24, 210, '#3a4152');
  px(ctx, 800, GROUND_Y - 210, 24, 210, '#3a4152');
  px(ctx, 220, GROUND_Y - 240, 630, 32, '#4a5364');
  px(ctx, 220, GROUND_Y - 212, 630, 8, '#2a3040');

  // the sick yellow-green light pooling under the canopy
  ctx.save();
  ctx.globalAlpha = 0.16 * flicker(now, 1);
  const pool = ctx.createLinearGradient(0, GROUND_Y - 208, 0, GROUND_Y);
  pool.addColorStop(0, '#e8f0a0');
  pool.addColorStop(1, 'rgba(232,240,160,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(220, GROUND_Y - 208, 630, 208);
  ctx.restore();

  // pumps
  for (const bx of [380, 640]) {
    px(ctx, bx, GROUND_Y - 96, 40, 96, '#8a3030');
    px(ctx, bx + 8, GROUND_Y - 86, 24, 28, '#c8d8b0');
    px(ctx, bx + 34, GROUND_Y - 60, 8, 40, '#2a2a30');
  }

  // sign on a pole — "GAS", one letter dead
  px(ctx, 900, GROUND_Y - 300, 14, 300, '#3a4152');
  px(ctx, 850, GROUND_Y - 340, 120, 60, '#1a2438');
  ctx.save();
  ctx.globalAlpha = flicker(now, 2);
  px(ctx, 866, GROUND_Y - 326, 24, 32, '#ffe45c');
  ctx.restore();
  px(ctx, 898, GROUND_Y - 326, 24, 32, '#4a4a3a');
  ctx.save();
  ctx.globalAlpha = flicker(now, 5);
  px(ctx, 930, GROUND_Y - 326, 24, 32, '#ffe45c');
  ctx.restore();

  sign(ctx, 535, GROUND_Y - 268, 'MOHAMMEDS BENSIN', '50% acetonbankat');
}

// three-tier — a kebab shop front at closing time
function drawKebabShopBg(ctx, now) {
  skyWash(ctx, '#140d1e', '#2a1c2e');

  // shopfront block
  px(ctx, 140, GROUND_Y - 300, 820, 300, '#2e2028');
  // warm interior glow through the window
  const warm = ctx.createLinearGradient(0, GROUND_Y - 250, 0, GROUND_Y);
  warm.addColorStop(0, 'rgba(255,180,90,0.30)');
  warm.addColorStop(1, 'rgba(255,180,90,0.05)');
  ctx.fillStyle = warm;
  ctx.fillRect(180, GROUND_Y - 250, 740, 250);

  // window frame
  px(ctx, 180, GROUND_Y - 250, 740, 12, '#4a3628');
  for (let x = 180; x < 920; x += 120) px(ctx, x, GROUND_Y - 250, 10, 250, '#4a3628');

  // the spit — a fat cone of meat, slowly turning (width oscillates)
  const turn = 1 + Math.sin(now / 900) * 0.25;
  const spitX = 520;
  px(ctx, spitX - 4, GROUND_Y - 240, 10, 240, '#5a5a62');
  ctx.fillStyle = '#8a4a22';
  ctx.strokeStyle = '#2a1408';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(spitX, GROUND_Y - 226);
  ctx.lineTo(spitX + 34 * turn, GROUND_Y - 110);
  ctx.lineTo(spitX - 34 * turn, GROUND_Y - 110);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  px(ctx, spitX - 30 * turn, GROUND_Y - 150, 60 * turn, 10, '#a35a28');

  // striped awning
  for (let i = 0, x = 140; x < 960; i++, x += 46) {
    px(ctx, x, GROUND_Y - 320, 46, 30, i % 2 ? '#d43a3a' : '#f0f0e8');
  }

  // neon sign
  ctx.save();
  ctx.globalAlpha = flicker(now, 3);
  ctx.shadowColor = '#ff3a7a';
  ctx.shadowBlur = 14;
  px(ctx, 420, GROUND_Y - 380, 260, 16, '#ff3a7a');
  px(ctx, 420, GROUND_Y - 348, 180, 12, '#3affd0');
  ctx.restore();

  sign(ctx, 550, GROUND_Y - 412, 'AHMEDS KEBAB', '10% nöt, 90% vem bryr sig?', '#ff8ab0');
}

// sky-temple — a concrete parking garage
function drawParkingGarageBg(ctx, now) {
  skyWash(ctx, '#1c1c20', '#33333a');

  // receding pillars, darker as they go back
  for (let d = 3; d >= 0; d--) {
    const inset = d * 90;
    const shade = ['#4a4a52', '#3e3e46', '#33333a', '#2a2a30'][d];
    for (let x = inset; x < ARENA_WIDTH - inset; x += 260) {
      px(ctx, x, GROUND_Y - 340 + d * 26, 46 - d * 6, 340 - d * 26, shade);
    }
    px(ctx, inset, GROUND_Y - 350 + d * 26, ARENA_WIDTH - inset * 2, 14, shade);
  }

  // fluorescent tubes, two of them struggling
  for (let i = 0; i < 4; i++) {
    const x = 90 + i * 250;
    ctx.save();
    ctx.globalAlpha = i % 2 ? flicker(now, i) : 1;
    px(ctx, x, GROUND_Y - 396, 130, 10, '#dff2ff');
    const spill = ctx.createLinearGradient(0, GROUND_Y - 386, 0, GROUND_Y - 200);
    spill.addColorStop(0, 'rgba(200,230,255,0.22)');
    spill.addColorStop(1, 'rgba(200,230,255,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(x - 30, GROUND_Y - 386, 190, 186);
    ctx.restore();
  }

  // oil stains + a lone hazard stripe
  for (const [x, w] of [[210, 90], [560, 130], [860, 70]]) {
    px(ctx, x, GROUND_Y - 26, w, 18, 'rgba(10,8,14,0.55)');
  }
  for (let x = 0; x < ARENA_WIDTH; x += 60) {
    px(ctx, x, GROUND_Y - 60, 30, 8, 'rgba(230,190,40,0.35)');
  }

  sign(ctx, 550, 90, 'LEVEL 4 PARKING', 'CAR AT OWN RISK — NO REFUND', '#ffd23f');
}

// the-abyss — a 24h laundromat
function drawLaundromatBg(ctx, now) {
  skyWash(ctx, '#0e1a22', '#16303a');

  // tiled back wall
  for (let y = 0; y < GROUND_Y; y += 40) {
    for (let x = 0; x < ARENA_WIDTH; x += 40) {
      const t = ((x / 40 + y / 40) % 2) === 0;
      px(ctx, x, y, 40, 40, t ? '#1b3a46' : '#183340');
    }
  }

  // Bank of washers. Kept muted rather than clean-white — a bright bank blows
  // out the fighters standing in front of it.
  px(ctx, 60, GROUND_Y - 230, 980, 230, '#7e8b91');
  px(ctx, 60, GROUND_Y - 230, 980, 12, '#5d686d');
  for (let i = 0; i < 7; i++) {
    const cx = 130 + i * 130;
    px(ctx, cx - 54, GROUND_Y - 200, 108, 170, '#96a3a8');
    // door
    ctx.fillStyle = '#5a6f79';
    ctx.strokeStyle = '#41535b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, GROUND_Y - 120, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // a couple of them are running — tumbling laundry
    if (i % 3 === 0) {
      const a = now / 400 + i;
      ctx.fillStyle = 'rgba(240,240,230,0.75)';
      for (let k = 0; k < 3; k++) {
        const ka = a + (k / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ka) * 16, GROUND_Y - 120 + Math.sin(ka) * 16, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    px(ctx, cx - 30, GROUND_Y - 190, 60, 10, '#6f7d83');
  }

  // cold overhead strip lighting
  ctx.save();
  ctx.globalAlpha = flicker(now, 7);
  px(ctx, 0, 40, ARENA_WIDTH, 12, '#eaf6ff');
  const spill = ctx.createLinearGradient(0, 52, 0, 300);
  spill.addColorStop(0, 'rgba(200,235,255,0.18)');
  spill.addColorStop(1, 'rgba(200,235,255,0)');
  ctx.fillStyle = spill;
  ctx.fillRect(0, 52, ARENA_WIDTH, 248);
  ctx.restore();

  sign(ctx, 550, 150, 'SPIN CITY LAUNDRY', '50 KRONER WASH NOW!!!', '#8fe8ff');
}

const STAGE_BG = {
  'twin-ledges': drawGasStationBg,
  'three-tier': drawKebabShopBg,
  'sky-temple': drawParkingGarageBg,
  'the-abyss': drawLaundromatBg,
};

// Ground/platform surfacing per stage. The original purple stone reads as
// fantasy masonry and fights every one of the backdrops above, so each stage
// gets a surface that matches its location.
const STAGE_SURFACE = {
  'twin-ledges': { top: '#3a3a42', bottom: '#1e1e24', edge: '#6a6a76' },   // forecourt asphalt
  'three-tier': { top: '#4a3a30', bottom: '#241a14', edge: '#7a6250' },    // greasy pavement
  'sky-temple': { top: '#54545c', bottom: '#2a2a30', edge: '#82828e' },    // concrete deck
  'the-abyss': { top: '#5e6a70', bottom: '#2c363c', edge: '#93a2a8' },     // scuffed lino
};
const DEFAULT_SURFACE = { top: '#4a2f66', bottom: '#241634', edge: '#8a6ab0' };

function surfaceFor() {
  return STAGE_SURFACE[currState?.stageId] || DEFAULT_SURFACE;
}

function drawBackground(ctx) {
  if (stageVideo && stageVideo.readyState >= 2) {
    const vw = stageVideo.videoWidth, vh = stageVideo.videoHeight;
    const scale = Math.max(ARENA_WIDTH / vw, ARENA_HEIGHT / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(stageVideo, (ARENA_WIDTH - dw) / 2, (ARENA_HEIGHT - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(10,5,20,0.35)';
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  } else {
    (STAGE_BG[currState?.stageId] || drawDefaultBg)(ctx, performance.now());
  }

  const floor = currState?.stageId ? getStageLayout(currState.stageId).floor : FULL_FLOOR;

  // Void behind everything, so any gap in the floor reads as a bottomless pit.
  const void_ = ctx.createLinearGradient(0, GROUND_Y, 0, ARENA_HEIGHT);
  void_.addColorStop(0, '#0c0714');
  void_.addColorStop(1, '#000000');
  ctx.fillStyle = void_;
  ctx.fillRect(0, GROUND_Y, ARENA_WIDTH, ARENA_HEIGHT - GROUND_Y);

  const surface = surfaceFor();
  const ground = ctx.createLinearGradient(0, GROUND_Y, 0, ARENA_HEIGHT);
  ground.addColorStop(0, surface.top);
  ground.addColorStop(1, surface.bottom);

  for (const seg of floor) {
    const x1 = Math.max(0, seg.x1);
    const x2 = Math.min(ARENA_WIDTH, seg.x2);
    if (x2 <= x1) continue;

    ctx.fillStyle = ground;
    ctx.fillRect(x1, GROUND_Y, x2 - x1, ARENA_HEIGHT - GROUND_Y);

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let x = Math.ceil(x1 / 40) * 40; x < x2; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 4);
      ctx.lineTo(x, ARENA_HEIGHT);
      ctx.stroke();
    }

    ctx.strokeStyle = surface.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, GROUND_Y);
    ctx.lineTo(x2, GROUND_Y);
    ctx.stroke();
  }

  drawPlatforms(ctx);
}

function drawPlatforms(ctx) {
  const stageId = currState?.stageId;
  if (!stageId) return;
  const thickness = 14;
  // Read positions off the network state, not the static layout — cowardly
  // platforms move. Fall back to the layout before the first state arrives.
  const platforms = currState.platforms || getStageLayout(stageId).platforms;
  for (const p of platforms) {
    const topY = GROUND_Y - p.height;
    const w = p.x2 - p.x1;

    const surface = surfaceFor();
    const grad = ctx.createLinearGradient(0, topY, 0, topY + thickness);
    grad.addColorStop(0, surface.edge);
    grad.addColorStop(1, surface.top);
    ctx.fillStyle = grad;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    roundRectPath(ctx, p.x1, topY, w, thickness, 4);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x1 + 3, topY + 2);
    ctx.lineTo(p.x2 - 3, topY + 2);
    ctx.stroke();
  }
}

// --------------------------------------------------------------- fighter --

function pickAnimKey(player, tracker, matchOver, iWon) {
  if (matchOver) return iWon ? 'victory' : 'defeat';
  const bubble = tauntBubbles.get(player.id);
  if (bubble && bubble.until > performance.now()) return 'taunt';
  if (player.grabbedBy) return 'grabbed';
  if (player.attack) return player.attack.key;

  // A hit that leaves you airborne (a launcher kick, or knockback off a
  // ledge) tumbles until you land, rather than snapping back to a plain
  // jump pose the instant hitstun ends.
  if (player.grounded) tracker.tumbling = false;
  else if (player.hurt) tracker.tumbling = true;
  if (tracker.tumbling) return 'tumble';

  if (player.hurt) return 'hurt';
  if (player.crouching) return 'duck';
  if (!player.grounded) return player.jumpY >= tracker.lastJumpY ? 'jumpRise' : 'jumpFall';
  const moving = tracker.lastX !== null && Math.abs(player.x - tracker.lastX) > 0.4;
  return moving ? 'walk' : 'idle';
}

// A single layered teardrop "flame" pointing up from the origin, base to tip.
function drawFlame(ctx, size, lean) {
  const layers = [
    { color: '#c62a10', h: size, w: size * 0.55 },
    { color: '#ff8a00', h: size * 0.72, w: size * 0.42 },
    { color: '#ffe066', h: size * 0.42, w: size * 0.26 },
  ];
  for (const l of layers) {
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.bezierCurveTo(-l.w, -l.h * 0.35, -l.w * 0.5 + lean, -l.h * 0.9 + lean, lean, -l.h + lean);
    ctx.bezierCurveTo(l.w * 0.5 + lean, -l.h * 0.9 + lean, l.w, -l.h * 0.35, 0, 2);
    ctx.closePath();
    ctx.fillStyle = l.color;
    ctx.fill();
  }
}

// A ring of flickering flames orbiting the character while a combo is live —
// more/bigger flames the longer the chain runs. Drawn in the same local,
// facing-flipped space as the rest of the fighter (called right before
// ctx.restore() in drawFighter), so it's centered on them for free.
function drawComboAura(ctx, comboCount, now) {
  const count = Math.min(9, 5 + Math.floor(comboCount / 2));
  const intensity = Math.min(1, 0.55 + comboCount * 0.07);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + now / 700;
    const bob = Math.sin(now / 130 + i * 1.9);
    const fx = Math.cos(angle) * 26;
    const fy = -34 + Math.sin(angle) * 17 + bob * 2;
    const flicker = 0.7 + 0.3 * Math.sin(now / 85 + i * 2.6);
    const size = (9 + flicker * 5) * intensity;

    ctx.save();
    ctx.translate(fx, fy);
    ctx.globalAlpha = 0.75 * intensity;
    drawFlame(ctx, size, Math.sin(now / 100 + i) * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFighter(ctx, player, now, dt) {
  const charId = player.characterId;
  const theme = THEMES[charId] || THEMES.warrior;
  const charDef = charId ? getCharacter(charId) : null;
  const tracker = trackerFor(player.id);
  const matchOver = currState?.phase === 'over';
  const iWon = currState?.winnerId === player.id;

  const animKey = pickAnimKey(player, tracker, matchOver, iWon);
  if (tracker.animKey !== animKey) {
    tracker.animKey = animKey;
    tracker.phase = null;
  }

  if (animKey === 'walk') tracker.walkCycle += dt * (player.sprinting ? 15 : 9);

  let armAngle = 0.1, legSwing = 0, lean = 0, bob = 0, glow = 0, headTiltExtra = 0;
  let knockdown = false;
  let squash = 1;
  let spinAngle = 0;

  // Stand still long enough and the idle pose gives way to a character-
  // specific bit of nonsense. `idleMs` is server-authoritative so both
  // clients see the same antic at the same time.
  const anticMs = player.idleMs || 0;
  const anticActive = animKey === 'idle' && anticMs >= IDLE_ANTIC_AFTER_MS;
  const anticPhase = anticMs / 1000;
  // The mage rotates through three bits; everyone else has one. Previews skip
  // the sleeping pose, which lies him flat and reads as an unidentifiable
  // pink mass at card size.
  const magePoseCount = player.previewMode ? 2 : 3;
  const magePose = Math.floor(anticPhase / 5) % magePoseCount; // 0 gaming, 1 belly, 2 asleep
  const mageAsleep = anticActive && charId === 'mage' && magePose === 2;

  if (animKey === 'idle') {
    bob = Math.sin((now - tracker.idleStart) / 420) * 1.5;
    armAngle = 0.12 + Math.sin((now - tracker.idleStart) / 500) * 0.05;
    lean = Math.sin((now - tracker.idleStart) / 900) * 0.04;
    headTiltExtra = Math.sin((now - tracker.idleStart) / 650) * 1.2;

    if (anticActive) {
      if (charId === 'rogue') {
        armAngle = 0.5 + Math.sin(anticPhase * 2) * 0.5; // twirling the pistol
      } else if (charId === 'mage') {
        if (magePose === 0) { lean = -0.5; armAngle = -0.2; }        // reclined
        else if (magePose === 1) { armAngle = 1.1; bob += 2; }       // scratching
        else { knockdown = true; }                                   // asleep
      } else if (charId === 'archer') {
        // clown dance: bouncing, swinging, twisting
        bob += Math.abs(Math.sin(anticPhase * 6)) * 9;
        armAngle = Math.sin(anticPhase * 6) * 1.5;
        legSwing = Math.sin(anticPhase * 6 + 1) * 0.7;
        lean = Math.sin(anticPhase * 3) * 0.25;
      } else if (charId === 'warrior') {
        lean = -0.35 + Math.sin(anticPhase * 2) * 0.12; // wheelie
        armAngle = 0.4 + Math.sin(anticPhase * 4) * 0.5; // polishing
      }
    }
  } else if (animKey === 'walk') {
    const amp = player.sprinting ? 1.25 : 1;
    legSwing = Math.sin(tracker.walkCycle) * 0.55 * amp;
    armAngle = -Math.sin(tracker.walkCycle) * 0.35 * amp;
    bob = Math.abs(Math.sin(tracker.walkCycle)) * (player.sprinting ? 2.6 : 1.5);
    // Lean into the stride — forward while chasing, back while retreating.
    const moveRelToFacing = Math.sign(player.moveDir) * player.facing;
    lean = moveRelToFacing * (player.sprinting ? 0.22 : 0.1);

    // A little dust puff every time a foot plants (each half walk-cycle).
    const stepPhase = Math.floor(tracker.walkCycle / Math.PI);
    if (stepPhase !== tracker.lastStepPhase) {
      tracker.lastStepPhase = stepPhase;
      spawnParticles(player.x, GROUND_Y - player.jumpY, player.sprinting ? 4 : 2, 'rgba(210,200,180,0.55)', {
        speed: 30, life: 0.25, size: 2, upBias: 4, gravity: 80,
      });
    }
  } else if (animKey === 'jumpRise' || animKey === 'jumpFall') {
    // Continuous cycling limbs while airborne instead of a single frozen
    // pose — reads as actively paddling/running through the air.
    tracker.airCycle += dt * 11;
    const cycle = Math.sin(tracker.airCycle);
    legSwing = cycle * 0.45;
    armAngle = -cycle * 0.5 - 0.35;
    bob = Math.sin(tracker.airCycle * 2) * 1.4;
    lean = animKey === 'jumpRise' ? -0.14 : 0.12;
  } else if (animKey === 'hurt') {
    lean = -0.2;
    armAngle = -0.3;
  } else if (animKey === 'taunt') {
    lean = 0.08;
    armAngle = 0.9;
    bob = Math.sin(now / 180) * 1.5;
  } else if (animKey === 'victory') {
    armAngle = -2.1;
    bob = Math.sin(now / 260) * 2.5;
  } else if (animKey === 'defeat') {
    knockdown = true;
  } else if (animKey === 'duck') {
    legSwing = 0.45;
    armAngle = -0.15;
    squash = 0.72;
  } else if (animKey === 'groundSmash') {
    const phase = player.attack?.phase || 'startup';
    if (phase === 'startup') {
      armAngle = -1.6; // arms raised overhead, coiled for the slam
      lean = -0.05;
    } else if (phase === 'falling') {
      armAngle = 1.3; // tucked dive, arms driven down/forward
      lean = 0.25;
    } else {
      armAngle = 0.3; // recovery: crouched impact pose
      lean = 0.05;
      squash = 0.8;
    }
  } else if (animKey === 'spinKick') {
    const phase = player.attack?.phase || 'startup';
    if (tracker.phase !== phase) { tracker.phase = phase; tracker.phaseStart = now; }
    const atk = charDef?.attacks.spinKick;
    if (phase === 'startup') {
      spinAngle = -0.3; // slight counter-wind before the kick
      legSwing = -0.2;
    } else if (phase === 'active' && atk) {
      const t = Math.min(1, (now - tracker.phaseStart) / atk.activeMs);
      spinAngle = t * Math.PI * 2; // one full 360deg spin over the active window
      legSwing = 0.6;
    } else {
      spinAngle = 0;
      legSwing = 0.2;
    }
  } else if (animKey === 'throw') {
    const phase = player.attack?.phase || 'startup';
    armAngle = phase === 'startup' ? -0.4 : phase === 'active' ? 0.6 : 0.1; // reach out, hold, release
    lean = phase === 'active' ? 0.1 : 0;
  } else if (animKey === 'grabbed') {
    armAngle = -0.1;
    legSwing = Math.sin(now / 90) * 0.15; // small struggle jitter
    lean = 0.1;
  } else if (animKey === 'launcherKick') {
    const phase = player.attack?.phase || 'startup';
    if (phase === 'startup') { legSwing = -0.5; lean = 0.1; } // leg cocked back
    else if (phase === 'active') { legSwing = 1.4; lean = -0.2; } // driven upward
    else { legSwing = 0.3; lean = 0; } // settling
  } else if (animKey === 'tumble') {
    knockdown = true; // reuse the knockdown rotation trick for a ragdoll spin
    legSwing = Math.sin(now / 120) * 0.4;
    armAngle = Math.cos(now / 120) * 0.4;
  } else if (charDef && ATTACK_POSE[animKey]) {
    const atk = charDef.attacks[animKey];
    const phase = player.attack?.phase || 'recovery';
    if (tracker.phase !== phase) {
      tracker.phase = phase;
      tracker.phaseStart = now;
    }
    const durMs = atk[`${phase}Ms`] || 200;
    const t = easeOut(Math.min(1, (now - tracker.phaseStart) / durMs));
    const pose = ATTACK_POSE[animKey];
    const fromAngle = phase === 'startup' ? 0.1 : phase === 'active' ? pose.startup : pose.active;
    const toAngle = pose[phase];
    armAngle = fromAngle + (toAngle - fromAngle) * t;
    const fromLean = phase === 'startup' ? 0 : phase === 'active' ? pose.lean.startup : pose.lean.active;
    lean = fromLean + (pose.lean[phase] - fromLean) * t;
    if (animKey === 'special') {
      // A charged special glows brighter — reads as "more powerful" on top
      // of the damage/knockback boost that's actually happening server-side.
      const chargeFraction = player.attack?.chargeFraction ?? 0;
      const peak = phase === 'startup' ? t : phase === 'active' ? 1 : 1 - t;
      glow = peak * (0.5 + 0.5 * chargeFraction);
    }
  }

  // Landing squash/stretch — a brief bounce pulse layered on top of
  // whatever pose squash the current animKey already set.
  if (tracker.squashUntil && now < tracker.squashUntil) {
    const p = Math.max(0, 1 - (tracker.squashUntil - now) / 140);
    squash *= 1 - 0.25 * Math.sin(p * Math.PI);
  }

  const bottom = GROUND_Y - player.jumpY;

  // ground shadow — shrinks/fades with height for a cheap grounding cue
  const shadowScale = Math.max(0.35, 1 - player.jumpY / 140);
  ctx.save();
  ctx.globalAlpha = 0.35 * shadowScale;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(player.x, GROUND_Y + 3, 18 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Body scale: permanent goon shrink, plus temporary swell from a saiyan
  // transform or a `free` shout. Applied around the feet so the fighter grows
  // upward off the ground rather than sinking into it.
  const effects = player.effects;
  const bodyScale =
    CHARACTER_SCALE *
    (player.sizeScale ?? 1) *
    (effects?.saiyanMs > 0 ? 1.25 : 1) *
    (effects?.bigMs > 0 ? Math.pow(1.3, player.bigStacks || 1) : 1);

  ctx.save();
  ctx.translate(Math.round(player.x), Math.round(bottom - bob));
  if (bodyScale !== 1) ctx.scale(bodyScale, bodyScale);
  if (effects?.saiyanMs > 0) drawSaiyanAura(ctx, now);
  if (player.facing < 0) ctx.scale(-1, 1);
  if (knockdown) {
    ctx.rotate(Math.PI / 2.1);
    ctx.translate(-LEG_LEN - 6, 0);
  } else {
    ctx.rotate(lean);
    if (spinAngle) ctx.rotate(spinAngle);
    if (squash !== 1) ctx.scale(1, squash);
  }

  const backArmAngle = knockdown ? 0.2 : -armAngle * 0.4 + 0.15;
  const frontArmAngle = knockdown ? -0.1 : armAngle;
  const backLegAngle = -legSwing;
  const frontLegAngle = legSwing;

  // back leg — the warrior has no legs to speak of; he has a wheelchair, drawn
  // once here (behind the torso) instead of the two leg limbs.
  if (charId === 'warrior') {
    drawWheelchair(ctx, theme, tracker.walkCycle);
  } else {
    limb(ctx, -4, HIP_Y, LEG_LEN, 10, backLegAngle, theme.secondary);
  }
  // back arm
  limb(ctx, -6, SHOULDER_Y + 2, ARM_LEN, 7, backArmAngle, theme.skin);

  // torso (robe for mage, block for everyone else)
  ctx.fillStyle = theme.primary;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  if (charId === 'mage') {
    // A pink baby dress stretched over an enormous belly — the sides bulge way
    // past the old straight-sided robe.
    ctx.beginPath();
    ctx.moveTo(-10, SHOULDER_Y);
    ctx.lineTo(10, SHOULDER_Y);
    ctx.bezierCurveTo(30, SHOULDER_Y + 12, 30, HIP_Y - 2, 20, HIP_Y + 6);
    ctx.lineTo(-20, HIP_Y + 6);
    ctx.bezierCurveTo(-30, HIP_Y - 2, -30, SHOULDER_Y + 12, -10, SHOULDER_Y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // frilly hem + a little collar, to sell "baby dress" over "robe"
    ctx.fillStyle = '#fff0f7';
    for (let i = -18; i <= 18; i += 6) {
      ctx.beginPath();
      ctx.arc(i, HIP_Y + 6, 3.2, 0, Math.PI);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, SHOULDER_Y + 1, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    const torsoW = charId === 'warrior' ? 30 : 24;
    roundRectPath(ctx, -torsoW / 2, SHOULDER_Y, torsoW, TORSO_LEN, 6);
    ctx.fill();
    ctx.stroke();
    if (charId === 'archer') drawClownDots(ctx);
  }

  // cape / cloak flourish for rogue
  if (charId === 'rogue') {
    const flare = 10 + Math.abs(legSwing) * 14;
    ctx.fillStyle = theme.secondary;
    ctx.beginPath();
    ctx.moveTo(-8, SHOULDER_Y + 4);
    ctx.lineTo(-8 - flare, HIP_Y + 10);
    ctx.lineTo(-2, HIP_Y);
    ctx.closePath();
    ctx.fill();
  }

  // head — reset the stroke, since the costume helpers above set their own
  const headY = HEAD_Y + headTiltExtra;
  ctx.fillStyle = theme.skin;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, headY, HEAD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (charId === 'warrior') {
    ctx.fillStyle = theme.metal;
    ctx.beginPath();
    ctx.arc(0, headY, HEAD_R + 1, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
  } else if (charId === 'mage') {
    // Absurdly oversized pink wizard hat: wide floppy brim + a tall cone that
    // flops over at the tip.
    ctx.fillStyle = theme.secondary;
    ctx.beginPath();
    ctx.ellipse(0, headY - 4, HEAD_R + 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-HEAD_R - 5, headY - 4);
    ctx.lineTo(HEAD_R + 5, headY - 4);
    ctx.quadraticCurveTo(6, headY - 30, -10, headY - 38);
    ctx.quadraticCurveTo(-4, headY - 24, -HEAD_R - 5, headY - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // hatband
    ctx.fillStyle = '#fff0f7';
    roundRectPath(ctx, -HEAD_R - 5, headY - 9, (HEAD_R + 5) * 2, 5, 2);
    ctx.fill();
    ctx.stroke();
  } else if (charId === 'rogue') {
    // Backwards cap: crown over the skull, brim pointing behind him. The rig is
    // drawn facing +x, so the brim goes to -x.
    ctx.fillStyle = '#c8102e';
    ctx.beginPath();
    ctx.arc(0, headY - 1, HEAD_R + 2, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-HEAD_R - 4, headY - 1, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // snapback button
    ctx.fillStyle = theme.metal;
    ctx.beginPath();
    ctx.arc(0, headY - HEAD_R - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (charId === 'archer') {
    // Clown hair tufts either side of the head.
    ctx.fillStyle = '#f0a33c';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * (HEAD_R + 2), headY - 3, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // tiny pointed hat
    ctx.fillStyle = theme.secondary;
    ctx.beginPath();
    ctx.moveTo(-6, headY - HEAD_R + 1);
    ctx.lineTo(6, headY - HEAD_R + 1);
    ctx.lineTo(1, headY - HEAD_R - 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // eyes (small readable facing cue)
  ctx.fillStyle = '#1a1015';
  ctx.beginPath();
  ctx.arc(4, headY - 1, 1.4, 0, Math.PI * 2);
  ctx.fill();

  if (charId === 'archer') {
    // big red nose
    ctx.fillStyle = '#e01e1e';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(7, headY + 2, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawClownRuff(ctx);
  } else if (charId === 'rogue') {
    // red lipstick — a fat little pout under the eye
    ctx.strokeStyle = '#ff2d55';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(4, headY + 3, 3, -0.2, Math.PI * 0.9);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // front leg (in front of torso, slightly brighter than the back leg for depth).
  // The warrior's wheelchair already replaced both legs above.
  if (charId !== 'warrior') {
    limb(ctx, 4, HIP_Y, LEG_LEN, 10, frontLegAngle, theme.primary);
  }
  if (charId === 'archer') {
    // huge clown shoes on both feet
    drawClownShoe(ctx, -4, backLegAngle);
    drawClownShoe(ctx, 4, frontLegAngle);
  }

  // front arm + weapon
  const weaponForKey = (drawCtx) => {
    if (charId === 'warrior') weaponAubergine(drawCtx);
    else if (charId === 'archer') weaponBanana(drawCtx);
    else if (charId === 'mage') weaponStaff(drawCtx, theme, glow);
    else if (charId === 'rogue') weaponDagger(drawCtx, theme);
  };
  limb(ctx, 6, SHOULDER_Y + 2, ARM_LEN, 7, frontArmAngle, theme.skin, weaponForKey);
  if (charId === 'rogue') {
    // off-hand dagger too — twin blades read better for a "flurry" class
    limb(ctx, -6, SHOULDER_Y + 2, ARM_LEN, 7, backArmAngle, theme.skin, (c) => weaponDagger(c, theme));
    drawGoldChain(ctx); // over the arms, so the daggers don't hide it
  }

  // Idle-antic props, drawn over the finished body.
  if (anticActive) {
    if (charId === 'rogue') {
      const firing = now - (tracker.misfireFlashUntil || 0) < 0;
      drawDeagle(ctx, anticPhase, firing);
    } else if (charId === 'mage') {
      if (magePose === 0) drawGamingSetup(ctx, anticPhase);
      else if (magePose === 1) drawBellyFlies(ctx, anticPhase);
      else drawSnoreZ(ctx, anticPhase);
    } else if (charId === 'warrior') {
      drawWheelie(ctx, anticPhase);
    }
  }

  if (player.hurt) {
    ctx.fillStyle = 'rgba(255,50,50,0.28)';
    ctx.beginPath();
    ctx.arc(0, SHOULDER_Y + TORSO_LEN / 2, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  if (player.comboCount > 1) {
    drawComboAura(ctx, player.comboCount, now);
  }

  ctx.restore();

  // speech bubble (taunt) — drawn outside the facing-flip transform so text
  // never renders mirrored
  const headTopY = bottom - (LEG_LEN + TORSO_LEN + HEAD_R * 2 + 6) * bodyScale;
  const bubble = tauntBubbles.get(player.id);
  if (bubble && bubble.until > now) {
    drawTauntBubble(ctx, player.x, headTopY, bubble.text);
  } else if (bubble) {
    tauntBubbles.delete(player.id);
  }

  // Status pips sit above the head — and above the bubble when both are up.
  drawEffectIcons(ctx, player, player.x, headTopY - (bubble && bubble.until > now ? 42 : 10));

  tracker.lastX = player.x;
  tracker.lastJumpY = player.jumpY;
}

// Named status pips floating above a fighter's head, with a live countdown —
// the debuff readout the secret moves need.
const EFFECT_PIPS = [
  { key: 'stunMs', label: 'STUN', color: '#ffd23f' },
  { key: 'rootMs', label: 'ROOT', color: '#7ee06a' },
  { key: 'saiyanMs', label: 'SSJ', color: '#ffb700' },
  { key: 'ickyMs', label: 'ICKY', color: '#f0a8d0' },
  { key: 'pissedMs', label: 'WET', color: '#e8e04a' },
  { key: 'charmedMs', label: 'CHARM', color: '#ff6fd8' },
  { key: 'horseMs', label: 'HORSE', color: '#dcd0c0' },
];

function drawEffectIcons(ctx, player, x, y) {
  const effects = player.effects;
  if (!effects) return;
  const active = EFFECT_PIPS.filter((pip) => effects[pip.key] > 0);
  if (active.length === 0) return;

  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const pipW = 42;
  const totalW = active.length * (pipW + 4) - 4;
  let px0 = x - totalW / 2;

  for (const pip of active) {
    const seconds = Math.ceil(effects[pip.key] / 1000);
    ctx.fillStyle = 'rgba(20,12,24,0.85)';
    ctx.strokeStyle = pip.color;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, px0, y - 8, pipW, 15, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pip.color;
    ctx.fillText(`${pip.label} ${seconds}`, px0 + pipW / 2, y);
    px0 += pipW + 4;
  }

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

// Gold super-saiyan aura — same idea as drawComboAura, different palette.
function drawSaiyanAura(ctx, now) {
  const pulse = 0.75 + Math.sin(now / 90) * 0.25;
  const r = 46 * pulse;
  const grad = ctx.createRadialGradient(0, SHOULDER_Y + 8, 4, 0, SHOULDER_Y + 8, r);
  grad.addColorStop(0, 'rgba(255,225,120,0.45)');
  grad.addColorStop(0.6, 'rgba(255,170,40,0.20)');
  grad.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, SHOULDER_Y + 8, r, 0, Math.PI * 2);
  ctx.fill();

  // upward flame licks
  ctx.fillStyle = 'rgba(255,214,90,0.55)';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + now / 260;
    const h = 12 + Math.sin(now / 70 + i) * 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 16, SHOULDER_Y + 8 + Math.sin(a) * 16);
    ctx.lineTo(Math.cos(a) * 10, SHOULDER_Y + 8 + Math.sin(a) * 10 - h);
    ctx.lineTo(Math.cos(a) * 22, SHOULDER_Y + 8 + Math.sin(a) * 22);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTauntBubble(ctx, x, y, text) {
  ctx.font = 'bold 11px "Courier New", monospace';
  const padX = 8, padY = 6;
  const w = Math.min(180, ctx.measureText(text).width + padX * 2);
  const h = 22 + padY;
  const bx = Math.max(4, Math.min(ARENA_WIDTH - w - 4, x - w / 2));
  const by = y - h;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#1a1015';
  ctx.lineWidth = 2;
  roundRectPath(ctx, bx, by, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, by + h);
  ctx.lineTo(x + 6, by + h);
  ctx.lineTo(x, by + h + 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1a1015';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, text, bx + w / 2, by + h / 2, w - padX * 2, 12);
  ctx.restore();
}

function wrapText(ctx, text, cx, cy, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

// ------------------------------------------------------------- projectile --

const PROJECTILE_COLORS = {
  shortRange: '#e8e8f0',
  longRange: '#d8b46a',
  special: '#ffb347',
};

function drawProjectile(ctx, proj) {
  const player = currState.players.find((p) => p.id === proj.ownerId);
  const charId = player?.characterId;
  const theme = THEMES[charId] || THEMES.warrior;

  // Goon juice ignores the caster's usual projectile look — it's the same
  // glowing purple blob whoever fired it.
  // Goon juice: an actual teardrop-shaped droplet, tapered along its own
  // direction of travel, with a wet trail behind it.
  if (proj.kind === 'goonJuice') {
    const angle = Math.atan2(proj.vy || 0, proj.vx || 1);
    const now = performance.now();
    const squish = 1 + Math.sin(now / 70 + proj.x * 0.05) * 0.12;

    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.rotate(angle);
    ctx.scale(1.9, 1.9); // sized to read against 3x fighters

    // trail
    const trail = ctx.createLinearGradient(-46, 0, 0, 0);
    trail.addColorStop(0, 'rgba(200,235,255,0)');
    trail.addColorStop(1, 'rgba(210,240,255,0.55)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.quadraticCurveTo(-20, -7 * squish, 0, 0);
    ctx.quadraticCurveTo(-20, 7 * squish, -46, 0);
    ctx.closePath();
    ctx.fill();

    // the droplet itself — rounded head, drawn-out tail
    ctx.fillStyle = 'rgba(190,230,255,0.95)';
    ctx.strokeStyle = 'rgba(120,180,225,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.quadraticCurveTo(6, -11 * squish, -13, 0);
    ctx.quadraticCurveTo(6, 11 * squish, 16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // specular glint
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(4, -3, 3.4, 2.2, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    return;
  }

  if (charId === 'mage') {
    const grad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, 9);
    grad.addColorStop(0, '#fff3c4');
    grad.addColorStop(0.5, theme.accent);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (charId === 'archer') {
    ctx.strokeStyle = '#d8b46a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(proj.x - 10, proj.y);
    ctx.lineTo(proj.x + 8, proj.y);
    ctx.stroke();
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.moveTo(proj.x + 8, proj.y);
    ctx.lineTo(proj.x + 2, proj.y - 3);
    ctx.lineTo(proj.x + 2, proj.y + 3);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = theme.metal;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.rotate(performance.now() / 60);
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(0, -3); ctx.lineTo(6, 0); ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ----------------------------------------------------------- stage event --

// The 9,1,1 chain. The politician is the butt of it: he crawls out of the
// wreck insisting it was the wrong target, and if you laugh at him he works
// himself up until he hallucinates himself into a giant furious star.
function drawStageEvent(ctx, ev, now) {
  if (!ev || ev.kind !== 'nineeleven') return;

  if (ev.phase === 'incoming') {
    // shadow racing along the ground ahead of the impact
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(ev.x, GROUND_Y + 4, 120, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(ev.planeX, ev.planeY);
    ctx.rotate(0.7);
    ctx.fillStyle = '#dfe6ee';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    roundRectPath(ctx, -70, -13, 140, 26, 13); // fuselage
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // wings
    ctx.moveTo(-10, 0);
    ctx.lineTo(-46, 40);
    ctx.lineTo(-16, 40);
    ctx.lineTo(18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // tail
    ctx.moveTo(-64, -6);
    ctx.lineTo(-86, -40);
    ctx.lineTo(-56, -34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // trailing smoke
    spawnParticles(ev.planeX - 40, ev.planeY, 2, 'rgba(90,90,100,0.7)', {
      speed: 60, life: 1.4, size: 12, upBias: 10, gravity: -20,
    });
    return;
  }

  if (ev.phase === 'politician') {
    const x = ev.politicianX;
    const bottom = GROUND_Y;
    // burning wreckage he's standing in
    spawnParticles(x + (Math.random() - 0.5) * 200, bottom, 1, 'rgba(255,150,50,0.8)', {
      speed: 70, life: 1.1, size: 7, upBias: 90, gravity: -60,
    });

    ctx.save();
    ctx.translate(x, bottom);
    ctx.scale(2.2, 2.2);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.6;
    // cheap suit
    ctx.fillStyle = '#22283a';
    roundRectPath(ctx, -13, -52, 26, 34, 4);
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, -11, -20, 9, 20, 3);
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, 2, -20, 9, 20, 3);
    ctx.fill();
    ctx.stroke();
    // shirt + red tie
    ctx.fillStyle = '#f0f0f4';
    roundRectPath(ctx, -5, -52, 10, 22, 2);
    ctx.fill();
    ctx.fillStyle = '#c8102e';
    roundRectPath(ctx, -2.5, -50, 5, 20, 1);
    ctx.fill();
    // head, and a truly awful comb-over
    ctx.fillStyle = '#e8b58c';
    ctx.beginPath();
    ctx.arc(0, -62, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c8a44a';
    ctx.beginPath();
    ctx.ellipse(-1, -70, 12, 5, -0.2, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawTauntBubble(ctx, x, bottom - 190, 'hmm. wrong target.');
    return;
  }

  if (ev.phase === 'star') {
    const t = Math.max(0, ev.timerMs) / 10000;
    const x = ev.starX;
    const y = ev.starY;
    // wobbling, over-saturated, obviously a hallucination
    const wobble = Math.sin(now / 90) * 0.09;
    const R = 96 + Math.sin(now / 130) * 8;

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7fd0ff';
    ctx.beginPath();
    ctx.arc(x, y, R * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wobble + Math.sin(now / 700) * 0.15);

    // two overlaid triangles
    ctx.fillStyle = '#3aa0ff';
    ctx.strokeStyle = '#0b3f7a';
    ctx.lineWidth = 5;
    for (const flip of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        const px2 = Math.cos(a) * R;
        const py2 = Math.sin(a) * R * flip;
        i === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // furious eyes
    ctx.fillStyle = '#fff';
    for (const ex of [-26, 26]) {
      ctx.beginPath();
      ctx.ellipse(ex, -6, 15, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#111';
    for (const ex of [-24, 28]) {
      ctx.beginPath();
      ctx.arc(ex, -4, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // angry brows
    ctx.strokeStyle = '#0b1f3a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-42, -24); ctx.lineTo(-12, -12);
    ctx.moveTo(42, -24); ctx.lineTo(12, -12);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();

    // countdown so you know how long you have to survive
    ctx.save();
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    const label = `${Math.ceil(ev.timerMs / 1000)}`;
    ctx.strokeText(label, x, y - R - 18);
    ctx.fillText(label, x, y - R - 18);
    ctx.restore();

    if (Math.random() < 0.3) triggerShake(4 + (1 - t) * 6);
  }
}

// ------------------------------------------------------------------ bomb --

// Giant cartoon bomb from the 1/100 taunt. Bigger than anything else on
// screen on purpose — it should read as obviously unfair.
function drawBomb(ctx, bomb, now) {
  const x = bomb.x;
  const y = GROUND_Y - bomb.jumpY;
  const wobble = Math.sin(now / 220) * 0.12;

  // shadow on the ground below, tightening as it closes in
  const closeness = Math.max(0, Math.min(1, 1 - bomb.jumpY / 460));
  ctx.save();
  ctx.globalAlpha = 0.15 + closeness * 0.4;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y + 3, 20 + closeness * 26, 5 + closeness * 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wobble);

  ctx.fillStyle = '#15151c';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(-11, -12, 7, 5, -0.6, 0, Math.PI * 2);
  ctx.fill();

  // fuse cap + curling fuse
  ctx.fillStyle = '#4a4a54';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  roundRectPath(ctx, -8, -38, 16, 12, 3);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#c8a06a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -38);
  ctx.quadraticCurveTo(16, -50, 8, -60);
  ctx.stroke();

  // sparking fuse tip
  const spark = 4 + Math.sin(now / 45) * 2;
  const grad = ctx.createRadialGradient(8, -60, 0, 8, -60, spark * 2.4);
  grad.addColorStop(0, '#fff6c4');
  grad.addColorStop(0.5, '#ffa53a');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(8, -60, spark * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  spawnParticles(x + 8, y - 60, 1, 'rgba(255,190,90,0.9)', {
    speed: 26, life: 0.4, size: 2, upBias: 18, gravity: -40,
  });
}

let bombFlashUntil = 0;

export function triggerBombFlash() {
  bombFlashUntil = performance.now() + 220;
}

function drawBombFlash(ctx, now) {
  if (now >= bombFlashUntil) return;
  const t = (bombFlashUntil - now) / 220;
  ctx.save();
  ctx.globalAlpha = t * 0.85;
  const grad = ctx.createRadialGradient(
    ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 0,
    ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH * 0.75
  );
  grad.addColorStop(0, '#fffbe8');
  grad.addColorStop(0.4, '#ffb43a');
  grad.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.restore();
}

// ------------------------------------------------------------------ draw --

// Draws a single fighter into a small canvas for the character-select cards.
// Reuses drawFighter by handing it a synthetic player that is permanently
// idle, so the cards show the real art including the idle antics.
export function drawCharacterPreview(ctx, characterId, now) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  const fake = {
    id: `preview-${characterId}`,
    characterId,
    x: 0,
    jumpY: 0,
    facing: 1,
    grounded: true,
    crouching: false,
    sprinting: false,
    moveDir: 0,
    hurt: false,
    attack: null,
    comboCount: 0,
    effects: { stunMs: 0, rootMs: 0, saiyanMs: 0, ssjChargeMs: 0, bigMs: 0, ickyMs: 0, pissedMs: 0, charmedMs: 0, horseMs: 0 },
    sizeScale: 1,
    bigStacks: 0,
    previewMode: true,
    // Offset per character so the four cards aren't doing the same thing in
    // lockstep, and so the mage cycles through all three of his bits.
    idleMs: 2200 + now * 0.9 + characterId.length * 2300,
  };

  // drawFighter works in world space against GROUND_Y — translate the card so
  // the fighter's feet land near the bottom of it, then scale to fit. The
  // bounds account for CHARACTER_SCALE plus headroom for hats, oversized
  // weapons and the idle antics, all of which reach well past the body.
  const fit = Math.min(width / 330, height / 300);
  ctx.save();
  ctx.translate(width / 2, height - 10);
  ctx.scale(fit, fit);
  ctx.translate(0, -GROUND_Y);

  const prevState = currState;
  // drawFighter reads currState for phase/winner; a minimal stand-in keeps it
  // on the plain idle path.
  currState = { phase: 'playing', winnerId: undefined, players: [fake], stageId: null };
  try {
    drawFighter(ctx, fake, now, 1 / 60);
  } finally {
    currState = prevState;
    ctx.restore();
  }
}

export async function loadAssets() {
  // No external assets to preload — kept as a no-op for main.js compatibility.
}

export function draw(ctx) {
  const now = performance.now();
  const dt = lastDrawTime ? Math.min(0.05, (now - lastDrawTime) / 1000) : 0;
  lastDrawTime = now;
  updateEffects(dt);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  if (!currState || (currState.phase !== 'playing' && currState.phase !== 'over')) return;

  ctx.save();
  if (shakeMag > 0) {
    ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  }

  // Pull the camera back a touch so the whole stage sits inside the canvas
  // with a margin, scaling around the arena centre.
  if (WORLD_ZOOM !== 1) {
    ctx.translate(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    ctx.scale(WORLD_ZOOM, WORLD_ZOOM);
    ctx.translate(-ARENA_WIDTH / 2, -ARENA_HEIGHT / 2);
  }

  drawBackground(ctx);
  for (const proj of interpolatedProjectiles()) drawProjectile(ctx, proj);
  for (const player of interpolatedPlayers()) {
    if (!player.characterId) continue;
    drawHorse(ctx, player, now); // mount renders behind its rider
    drawFighter(ctx, player, now, dt);
    drawPuking(ctx, player, now);
  }
  for (const bomb of currState.bombs || []) drawBomb(ctx, bomb, now);
  drawStageEvent(ctx, currState.stageEvent, now);
  drawSsjCharge(ctx, now);
  drawPissStream(ctx, now);
  drawMcdonalds(ctx, now);
  drawSnoopRoll(ctx, now); // cosmetic cameo, rolls in front of the fighters
  drawShockwaves(ctx, now);
  drawEffects(ctx);
  drawBombFlash(ctx, now);

  ctx.restore();
}
