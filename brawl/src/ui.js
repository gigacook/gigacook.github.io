import { MAX_HEALTH, SPECIAL_CHARGE_MAX } from '../shared/constants.js';

const screens = {
  waiting: document.getElementById('waitingScreen'),
  disconnected: document.getElementById('disconnectedScreen'),
  select: document.getElementById('selectScreen'),
  game: document.getElementById('gameScreen'),
};

export function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
  if (name !== 'game') showOverOverlay(false);
}

const p1NameEl = document.getElementById('p1Name');
const p2NameEl = document.getElementById('p2Name');
const p1HealthEl = document.getElementById('p1Health');
const p2HealthEl = document.getElementById('p2Health');
const p1ManaEl = document.getElementById('p1Mana');
const p2ManaEl = document.getElementById('p2Mana');
const p1ChargeEl = document.getElementById('p1Charge');
const p2ChargeEl = document.getElementById('p2Charge');
const p1ScoreEl = document.getElementById('p1Score');
const p2ScoreEl = document.getElementById('p2Score');
const p1ComboEl = document.getElementById('p1Combo');
const p2ComboEl = document.getElementById('p2Combo');
const timerEl = document.getElementById('timer');
const overOverlayEl = document.getElementById('overOverlay');
const resultTextEl = document.getElementById('resultText');
const rematchStatusEl = document.getElementById('rematchStatus');

function updateCombo(el, combo) {
  if (combo > 1) {
    el.textContent = `${combo}x combo`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export function updateHud(state, myId) {
  const me = state.players.find((p) => p.id === myId);
  const opponent = state.players.find((p) => p.id !== myId);
  if (!me || !opponent) return;
  p1NameEl.textContent = me.characterId || '';
  p2NameEl.textContent = opponent.characterId || '';
  p1HealthEl.style.width = `${Math.max(0, (me.health / MAX_HEALTH) * 100)}%`;
  p2HealthEl.style.width = `${Math.max(0, (opponent.health / MAX_HEALTH) * 100)}%`;
  p1ManaEl.style.width = `${me.maxMana ? Math.max(0, (me.mana / me.maxMana) * 100) : 0}%`;
  p2ManaEl.style.width = `${opponent.maxMana ? Math.max(0, (opponent.mana / opponent.maxMana) * 100) : 0}%`;
  const p1ChargePct = Math.max(0, Math.min(100, (me.specialCharge / SPECIAL_CHARGE_MAX) * 100));
  const p2ChargePct = Math.max(0, Math.min(100, (opponent.specialCharge / SPECIAL_CHARGE_MAX) * 100));
  p1ChargeEl.style.width = `${p1ChargePct}%`;
  p2ChargeEl.style.width = `${p2ChargePct}%`;
  p1ChargeEl.classList.toggle('full', p1ChargePct >= 100);
  p2ChargeEl.classList.toggle('full', p2ChargePct >= 100);
  p1ScoreEl.textContent = me.score;
  p2ScoreEl.textContent = opponent.score;
  updateCombo(p1ComboEl, me.comboCount);
  updateCombo(p2ComboEl, opponent.comboCount);
  timerEl.textContent = state.timeRemaining;
}

export function showOverOverlay(show) {
  overOverlayEl.classList.toggle('hidden', !show);
}

export function updateOverScreen(state, myId) {
  showOverOverlay(true);
  const me = state.players.find((p) => p.id === myId);
  if (state.endReason === 'gooned') {
    // Somebody gooned themselves to death — the cause of death outranks the
    // usual win/lose line, on both screens.
    resultTextEl.textContent =
      state.winnerId === myId ? 'They GOONED THEMSELVES TO DEATH!' : 'You GOONED YOURSELF TO DEATH.';
  } else if (state.winnerId === null) {
    resultTextEl.textContent = "It's a draw!";
  } else if (state.winnerId === myId) {
    resultTextEl.textContent = 'You win!';
  } else {
    resultTextEl.textContent = 'You lose.';
  }
  rematchStatusEl.textContent = me?.rematchReady ? 'Waiting for opponent to rematch...' : '';
}
