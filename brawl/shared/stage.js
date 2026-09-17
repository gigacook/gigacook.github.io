// Selectable platform layouts. `height` is expressed in the same unit as
// player.jumpY (px above the ground), not absolute canvas y — so "standing
// on a platform" is just jumpY === platform.height, and every place that
// already derives screen position from GROUND_Y - jumpY keeps working
// unchanged whether the player is on the floor or a platform.
//
// `floor` is the ground layer, expressed the same way as `platforms`
// (height 0). It's a list rather than one infinite strip so a stage can
// leave gaps in it — walking or getting knocked into a gap means falling
// with nothing underneath, an instant round loss (see server/match.js's
// fall-death check). Stages with a single -Infinity..Infinity segment have
// no gaps and are the "safe" stages.

const SIDE_LEDGES = [
  { id: 'left', x1: 190, x2: 390, height: 140 },
  { id: 'right', x1: 710, x2: 910, height: 140 },
];

export const STAGE_LAYOUTS = [
  {
    id: 'twin-ledges',
    name: '3AM Petrol Station',
    blurb: 'Black ice on every surface. Climb the canopy. No pits, no grip.',
    // `icy: true` on the stage makes ground friction almost nil — you slide
    // for ages after you stop steering (see physics.js).
    icy: true,
    platforms: [
      // pump islands, low and easy
      { id: 'pump-left', x1: 330, x2: 470, height: 90 },
      { id: 'pump-right', x1: 630, x2: 770, height: 90 },
      // the original side ledges
      ...SIDE_LEDGES,
      // up onto the canopy roof, so the top of the map isn't dead space
      { id: 'canopy-step-left', x1: 120, x2: 250, height: 250 },
      { id: 'canopy-step-right', x1: 850, x2: 980, height: 250 },
      { id: 'canopy-roof', x1: 250, x2: 850, height: 330 },
      // and the price sign above everything
      { id: 'sign-perch', x1: 860, x2: 1000, height: 430 },
    ],
    floor: [{ id: 'floor', x1: -Infinity, x2: Infinity, height: 0 }],
  },
  {
    id: 'three-tier',
    name: 'Kebab Shop, Closing Time',
    blurb: 'Greasy floor, awning to climb, and a pit under the middle shelf.',
    // Grease is slippery, but not as bad as ice.
    icy: true,
    iceFriction: 0.55,
    platforms: [
      ...SIDE_LEDGES,
      { id: 'counter-left', x1: 300, x2: 430, height: 70 },
      { id: 'counter-right', x1: 670, x2: 800, height: 70 },
      { id: 'center', x1: 460, x2: 640, height: 260 },
      { id: 'awning-left', x1: 150, x2: 380, height: 360, cowardly: true },
      { id: 'awning-right', x1: 720, x2: 950, height: 360, cowardly: true },
      { id: 'neon', x1: 470, x2: 630, height: 450 },
    ],
    floor: [
      { id: 'floor-a', x1: -Infinity, x2: 480, height: 0 },
      { id: 'floor-b', x1: 620, x2: Infinity, height: 0 },
    ],
  },
  {
    id: 'sky-temple',
    name: 'Multi-Storey Car Park',
    blurb: 'Vertical gauntlet, two pits — and the upper decks run away from you.',
    // `cowardly` platforms slide away from a fighter who is about to land on
    // them (see match.js _tickPlatforms). Only the elevated ones opt in —
    // a fleeing spawn/ground-level platform would just strand people.
    platforms: [
      { id: 'low-left', x1: 110, x2: 300, height: 120 },
      { id: 'low-right', x1: 800, x2: 990, height: 120 },
      { id: 'mid-left', x1: 300, x2: 470, height: 260, cowardly: true },
      { id: 'mid-right', x1: 630, x2: 800, height: 260, cowardly: true },
      { id: 'top-center', x1: 470, x2: 630, height: 360, cowardly: true },
      { id: 'deck-left', x1: 90, x2: 280, height: 430, cowardly: true },
      { id: 'deck-right', x1: 820, x2: 1010, height: 430, cowardly: true },
      { id: 'roof', x1: 430, x2: 670, height: 520 },
    ],
    // Players always spawn at x=150 / ARENA_WIDTH-150 (see match.js), so
    // both pits are kept well clear of those points — otherwise a fighter
    // could tip into a pit within their very first step.
    floor: [
      { id: 'floor-a', x1: -Infinity, x2: 250, height: 0 },
      { id: 'floor-b', x1: 360, x2: 790, height: 0 },
      { id: 'floor-c', x1: 860, x2: Infinity, height: 0 },
    ],
  },
  {
    id: 'the-abyss',
    name: '24h Laundromat',
    blurb: 'No floor at all. Skittish machines over a bottomless drop.',
    // The two spawn platforms are sized to keep a wide margin around the
    // fixed spawn points (x=150 / ARENA_WIDTH-150) so nobody starts on an
    // edge. `floor` is intentionally empty — there is no safe ground
    // anywhere on this stage, so missing every platform means falling.
    platforms: [
      { id: 'spawn-left', x1: 60, x2: 260, height: 70 },
      { id: 'spawn-right', x1: 840, x2: 1040, height: 70 },
      { id: 'step-left', x1: 300, x2: 410, height: 190, cowardly: true },
      { id: 'step-right', x1: 690, x2: 800, height: 190, cowardly: true },
      { id: 'isle-low', x1: 470, x2: 630, height: 60 },
      { id: 'isle-high', x1: 500, x2: 600, height: 320, cowardly: true },
      { id: 'perch-left', x1: 140, x2: 240, height: 280, cowardly: true },
      { id: 'perch-right', x1: 860, x2: 960, height: 280, cowardly: true },
      { id: 'dryer-top-left', x1: 250, x2: 400, height: 430, cowardly: true },
      { id: 'dryer-top-right', x1: 700, x2: 850, height: 430, cowardly: true },
      { id: 'rafter', x1: 480, x2: 620, height: 500 },
    ],
    floor: [],
  },
];

export function getStageLayout(id) {
  return STAGE_LAYOUTS.find((s) => s.id === id) || STAGE_LAYOUTS[0];
}
