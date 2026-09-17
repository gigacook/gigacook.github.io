import { network } from './network.js';
import { unlockAudio, sfx } from './audio.js';
import { ARENA_WIDTH, ARENA_HEIGHT, GROUND_Y } from '../shared/constants.js';

const grid = document.getElementById('stageGrid');

let myPickedStageId = null;

function drawPreview(canvas, stage) {
  const ctx = canvas.getContext('2d');
  const scaleX = canvas.width / ARENA_WIDTH;
  const scaleY = canvas.height / ARENA_HEIGHT;

  // Void background — shows through any gap in the floor as a pit.
  ctx.fillStyle = '#0c0714';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const groundYPx = GROUND_Y * scaleY;
  ctx.fillStyle = '#4a2f66';
  for (const seg of stage.floor) {
    const x1 = Math.max(0, seg.x1) * scaleX;
    const x2 = Math.min(ARENA_WIDTH, seg.x2) * scaleX;
    if (x2 <= x1) continue;
    ctx.fillRect(x1, groundYPx, x2 - x1, canvas.height - groundYPx);
  }

  ctx.fillStyle = '#c9a6ff';
  for (const p of stage.platforms) {
    const x = p.x1 * scaleX;
    const w = (p.x2 - p.x1) * scaleX;
    const y = (GROUND_Y - p.height) * scaleY;
    ctx.fillRect(x, y, w, 3);
  }
}

export function renderStageGrid(stages) {
  grid.innerHTML = '';
  for (const stage of stages) {
    const card = document.createElement('div');
    card.className = 'stageCard';
    card.dataset.id = stage.id;

    const canvas = document.createElement('canvas');
    canvas.width = 140;
    canvas.height = 77;
    drawPreview(canvas, stage);

    const name = document.createElement('div');
    name.className = 'stageName';
    name.textContent = stage.name;

    const blurb = document.createElement('div');
    blurb.className = 'stageBlurb';
    blurb.textContent = stage.blurb;

    card.append(canvas, name, blurb);
    card.addEventListener('click', () => {
      unlockAudio();
      sfx.uiSelect();
      myPickedStageId = stage.id;
      network.selectStage(stage.id);
      updatePickedHighlight();
    });
    card.addEventListener('mouseenter', () => sfx.uiHover());
    grid.appendChild(card);
  }
}

function updatePickedHighlight() {
  for (const card of grid.children) {
    card.classList.toggle('picked', card.dataset.id === myPickedStageId);
  }
}

export function updateStageHighlight(stageId) {
  myPickedStageId = stageId;
  updatePickedHighlight();
}
