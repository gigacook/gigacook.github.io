import { network } from './network.js';
import { unlockAudio, sfx } from './audio.js';
import { drawCharacterPreview } from './renderer.js';

const grid = document.getElementById('characterGrid');
const statusEl = document.getElementById('selectStatus');

let myPickedId = null;
let previewCanvases = [];
let previewLoopStarted = false;

// Keep the preview cards animating so the idle antics are visible before you
// ever pick anyone.
function startPreviewLoop() {
  if (previewLoopStarted) return;
  previewLoopStarted = true;
  const tick = () => {
    for (const { canvas, id } of previewCanvases) {
      drawCharacterPreview(canvas.getContext('2d'), id, performance.now());
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function renderCharacterGrid(characters) {
  grid.innerHTML = '';
  previewCanvases = [];
  for (const character of characters) {
    const card = document.createElement('div');
    card.className = 'charCard';
    card.dataset.id = character.id;

    // Live preview of the actual fighter, drawn with the same renderer the
    // match uses — so the card can never disagree with what you get.
    const swatch = document.createElement('canvas');
    swatch.width = 150;
    swatch.height = 175;
    swatch.className = 'charPreview';
    previewCanvases.push({ canvas: swatch, id: character.id });

    const name = document.createElement('div');
    name.className = 'charName';
    name.textContent = character.name;

    const blurb = document.createElement('div');
    blurb.className = 'charBlurb';
    blurb.textContent = character.blurb;

    card.append(swatch, name, blurb);
    card.addEventListener('click', () => {
      unlockAudio();
      sfx.uiSelect();
      myPickedId = character.id;
      network.selectCharacter(character.id);
      updatePickedHighlight();
    });
    card.addEventListener('mouseenter', () => sfx.uiHover());
    grid.appendChild(card);
  }
  startPreviewLoop();
}

function updatePickedHighlight() {
  for (const card of grid.children) {
    card.classList.toggle('picked', card.dataset.id === myPickedId);
  }
}

export function updateSelectStatus(state, myId) {
  const me = state.players.find((p) => p.id === myId);
  const opponent = state.players.find((p) => p.id !== myId);
  myPickedId = me?.characterId || null;
  updatePickedHighlight();

  if (!me?.characterId) {
    statusEl.textContent = 'Pick a fighter above.';
  } else if (!state.stageId) {
    statusEl.textContent = `You picked ${me.characterId}. Now pick a stage below.`;
  } else if (!opponent?.characterId) {
    statusEl.textContent = 'Waiting for opponent to pick a fighter...';
  } else {
    statusEl.textContent = 'Starting...';
  }
}
