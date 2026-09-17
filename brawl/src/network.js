// Browser edition: no Socket.IO server. The authoritative Match simulation from
// server/ runs right here in the page, and this module plays the part of both
// the socket and server/index.js, so every other client file runs unchanged.
import { Match, TAUNT_BOMB_CHANCE } from '../server/match.js';
import { CHARACTERS } from '../shared/characters.js';
import { randomTaunt, randomIckyTaunt } from '../shared/taunts.js';
import { TICK_MS, TAUNT_COOLDOWN_MS, PLAYER_WIDTH } from '../shared/constants.js';

const ME = 'you';
const listeners = new Map(); // event -> [callbacks]
let match = null;
let mode = null; // 'cpu' | 'dummy'
let loop = null;
let lastTauntAt = 0;

function emit(event, payload) {
  // Socket.IO delivers asynchronously and as JSON; mirror both so the client
  // never holds a live reference into the simulation.
  const data = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
  setTimeout(() => (listeners.get(event) || []).forEach((cb) => cb(data)), 0);
}

function startLocalMatch(which) {
  if (match) return;
  mode = which;
  const opponentId = which === 'cpu' ? 'cpu' : 'dummy';
  match = new Match('local', [ME, opponentId]);
  const others = CHARACTERS.filter((c) => c.id !== 'rogue');
  match.selectCharacter(opponentId, which === 'cpu' ? others[Math.floor(Math.random() * others.length)].id : 'rogue');
  emit('matchFound', { matchId: 'local', characters: CHARACTERS });
  emit('youAre', { id: ME, opponentId });
  loop = setInterval(() => {
    if (mode === 'cpu') cpu.think(match);
    match.tick(TICK_MS / 1000);
    emit('state', match.serialize());
  }, TICK_MS);
}

// ---- CPU opponent ---------------------------------------------------------
// Plays by the same rules as a human: it only ever calls the public inputs
// (move/jump/duck/attack/taunt), never touches the simulation directly.
const cpu = {
  nextDecisionAt: 0,
  think(m) {
    const bot = m.getPlayer('cpu');
    const you = m.getPlayer(ME);
    if (!bot || !you) return;

    if (m.phase === 'over') {
      if (you.rematchReady && !bot.rematchReady) m.requestRematch('cpu');
      return;
    }
    if (m.phase === 'select') {
      if (!bot.characterId) {
        const pick = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
        m.selectCharacter('cpu', pick.id);
      }
      return;
    }
    if (m.phase !== 'playing') return;

    const now = performance.now();
    if (now < this.nextDecisionAt) return;
    this.nextDecisionAt = now + 90 + Math.random() * 140; // human-ish reaction time

    const dx = you.x - bot.x;
    const dist = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    const close = PLAYER_WIDTH * 1.4;
    const lowHealth = bot.health < 40;

    m.setDuckHeld('cpu', false);
    m.setSprintHeld('cpu', false);

    if (dist > close) {
      // Approach, sprinting across long gaps; back off a little when hurting.
      m.setMoveDir('cpu', lowHealth && Math.random() < 0.3 ? -dir : dir);
      if (dist > 450 && bot.mana > 40) m.setSprintHeld('cpu', true);
      if (dist > 260 && dist < 750 && Math.random() < 0.25) m.startAttack('cpu', 'longRange');
    } else {
      m.setMoveDir('cpu', Math.random() < 0.2 ? dir : 0);
      const roll = Math.random();
      if (bot.specialCharge >= 80 && roll < 0.5) m.startAttack('cpu', 'special');
      else if (roll < 0.55) m.startAttack('cpu', 'shortRange');
      else if (roll < 0.65) { m.setDuckHeld('cpu', true); m.startAttack('cpu', 'longRange'); }
      else if (roll < 0.72) { m.setSprintHeld('cpu', true); m.startAttack('cpu', 'shortRange'); }
    }

    // Jump toward you if you're above, and sometimes just to be annoying.
    if ((you.jumpY - bot.jumpY > 60 && dist < 400) || Math.random() < 0.04) m.jump('cpu');
    if (Math.random() < 0.01) sendTaunt('cpu');
  },
};

function sendTaunt(playerId) {
  if (!match || !match.hasPlayer(playerId)) return;
  const now = Date.now();
  if (playerId === ME) {
    if (now - lastTauntAt < TAUNT_COOLDOWN_MS) return;
    lastTauntAt = now;
  }
  const player = match.getPlayer(playerId);
  const message = player?.effects?.ickyMs > 0 ? randomIckyTaunt() : randomTaunt();
  emit('taunt', { playerId, message });
  if (Math.random() < TAUNT_BOMB_CHANCE) match.spawnTauntBomb(playerId);
  const provoked = match.notifyTaunt(playerId);
  if (provoked?.star) emit('fx:star', provoked.star);
}

export const network = {
  on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(cb);
  },
  selectCharacter(characterId) {
    match?.selectCharacter(ME, characterId);
  },
  selectStage(stageId) {
    match?.selectStage(ME, stageId);
  },
  move(dir) {
    match?.setMoveDir(ME, dir);
  },
  jump() {
    match?.jump(ME);
  },
  duck(active) {
    match?.setDuckHeld(ME, active);
  },
  sprint(active) {
    match?.setSprintHeld(ME, active);
  },
  attack(key) {
    match?.startAttack(ME, key);
  },
  rematch() {
    if (!match) return;
    match.requestRematch(ME);
    if (mode === 'dummy') match.requestRematch('dummy');
  },
  taunt() {
    sendTaunt(ME);
  },
  secretMove(name) {
    if (!match || !match.hasPlayer(ME)) return;
    const result = match.secretMove(ME, name);
    if (!result) return;
    if (result.taunt) emit('taunt', result.taunt);
    for (const key of ['roll', 'goon', 'ssj', 'piss', 'mcdonalds', 'horse', 'free', 'plane']) {
      if (result[key]) emit(`fx:${key}`, result[key]);
    }
  },
  // Training dummy (the original /?solo mode).
  solo() {
    startLocalMatch('dummy');
  },
  cpu() {
    startLocalMatch('cpu');
  },
  get id() {
    return ME;
  },
};

// Same opening move as a real server: tell the client it's waiting.
emit('waiting');
