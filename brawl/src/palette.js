const FALLBACK_COLORS = {
  warrior: '#c0392b',
  archer: '#27ae60',
  mage: '#2980b9',
  rogue: '#8e44ad',
};

// Deterministic fallback color for a character id, used both in the
// character-select cards and as the in-game placeholder sprite until/unless
// real spritesheets are available.
export function colorFor(id) {
  if (!id) return '#666';
  if (FALLBACK_COLORS[id]) return FALLBACK_COLORS[id];
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash}, 55%, 45%)`;
}
