// Shared between server and client so both agree on the rules of the world.

export const TICK_RATE = 30; // simulation steps per second
export const TICK_MS = 1000 / TICK_RATE;

export const ARENA_WIDTH = 1100;
export const ARENA_HEIGHT = 600;
export const GROUND_Y = 520; // y coordinate of the floor (feet position)

// Everything about a fighter — hurtbox, drawn body, melee reach, and the
// mobility needed to still get around the stage — scales off this one number.
// The original 48x64 fighters read as peas on a 1100x600 arena.
export const CHARACTER_SCALE = 2.25; // 75% of the original 3

export const PLAYER_WIDTH = 48 * CHARACTER_SCALE;
export const PLAYER_HEIGHT = 64 * CHARACTER_SCALE;

export const GRAVITY = 1400; // px/s^2, pulls jumpY back toward 0
// Move/jump scale with the body, otherwise big fighters feel like they're
// wading and can no longer clear their own height.
export const MOVE_SPEED = 260 * CHARACTER_SCALE;
export const JUMP_SPEED = 680 * Math.sqrt(CHARACTER_SCALE);

// Falling below this jumpY while airborne (no platform caught you) means
// you've dropped into a stage pit — an instant round loss for whoever fell.
export const FALL_DEATH_JUMP_Y = -250;

export const MAX_HEALTH = 150;
export const ROUND_TIME_SECONDS = 180;
export const HURT_MS = 300; // hit-stun duration after landing a hit on someone

export const CROUCH_HEIGHT_SCALE = 0.65; // hurtbox height multiplier while crouching
export const MANA_REGEN_PER_SEC = 9;
export const SPRINT_MULTIPLIER = 1.6;
export const SPRINT_MANA_DRAIN_PER_SEC = 25;

// Combo window: a hit must land within this many ms of the previous hit
// (by the same attacker, on the same target) to extend the combo chain.
export const COMBO_WINDOW_MS = 1500;
export const COMBO_MULTIPLIER_STEP = 0.2; // +20% damage (and score) per chained hit
export const SCORE_PER_DAMAGE = 10;

export const TAUNT_COOLDOWN_MS = 1500;

// Special-attack charge meter: landing any hit builds it up (faster with a
// bigger combo multiplier — see COMBO_MULTIPLIER_STEP), and a 4-hit combo
// maxes it out instantly regardless of how much had built up. Casting a
// special locks in a damage/knockback multiplier based on charge at the
// moment of the cast (interpolated between the min/max below) and spends
// the whole meter, win or miss.
export const SPECIAL_CHARGE_MAX = 100;
export const SPECIAL_CHARGE_PER_HIT = 20;
export const SPECIAL_CHARGE_COMBO_INSTANT = 4; // combo hit count that force-maxes the meter
export const SPECIAL_CHARGE_MULT_MIN = 0.7; // uncharged special: weaker than before
export const SPECIAL_CHARGE_MULT_MAX = 2.0; // fully charged special: much stronger

// Player can't leave the arena horizontally.
export const MIN_X = PLAYER_WIDTH / 2;
export const MAX_X = ARENA_WIDTH - PLAYER_WIDTH / 2;
