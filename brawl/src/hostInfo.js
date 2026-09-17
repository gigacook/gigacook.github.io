// Browser edition: instead of LAN share links, the waiting screen offers who
// to fight. Online LAN play still needs the Node server version.
import { network } from './network.js';
import { unlockAudio } from './audio.js';

const container = document.getElementById('shareLinks');

export function loadShareLinks() {
  if (!container || container.dataset.ready) return;
  container.dataset.ready = '1';
  container.innerHTML = '';

  const options = [
    ['🤖 Fight the CPU', () => network.cpu()],
    ['🥊 Training dummy', () => network.solo()],
  ];
  for (const [label, start] of options) {
    const btn = document.createElement('button');
    btn.className = 'modeBtn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      unlockAudio();
      start();
    });
    container.appendChild(btn);
  }
}
