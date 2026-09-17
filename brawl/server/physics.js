import {
  GRAVITY,
  MOVE_SPEED,
  JUMP_SPEED,
  SPRINT_MULTIPLIER,
  MIN_X,
  MAX_X,
} from '../shared/constants.js';

// Movement modifiers from the sillier status effects.
const HORSE_SPEED_MULTIPLIER = 2.2;
const ICKY_ACCEL_MULTIPLIER = 0.35;

// Mutates `player` in place: applies horizontal movement, gravity/jumping,
// platform landings, knockback decay, and clamps to the arena bounds.
// Called once per player per simulation tick.
//
// `platforms` is the current match's stage layout (shared/stage.js).
// `character` is the player's character def, needed to look up groundSmash's
// slamSpeed while a slam is in progress.
//
// player.vy: vertical velocity, positive = moving upward.
// player.jumpY: height above the ground (0 = grounded), or above whichever
// platform the player is currently standing on.
// Single definition of "this player is free to act", shared with match.js so
// attacks and movement can never disagree about it. A stun blocks everything;
// a root is handled separately below because it only blocks walking.
export function canAct(player) {
  return (
    player.attackState === null &&
    player.hurtMs <= 0 &&
    !(player.effects?.stunMs > 0)
  );
}

// `icy` stages keep your momentum after you let go of the stick. `slideVX`
// is the carried-over velocity; it decays slowly on ice and instantly on
// normal ground, so non-icy stages behave exactly as before.
export function applyPhysics(player, dtSeconds, platforms, character, stage = null) {
  let intent = 0;
  if (canAct(player) && !(player.effects?.rootMs > 0)) {
    // Root blocks only self-propelled walking — knockback and gravity below
    // still move a rooted player, which is both fairer and funnier.
    let speed = player.sprinting ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
    if (player.effects?.horseMs > 0) speed *= HORSE_SPEED_MULTIPLIER;
    if (player.effects?.ickyMs > 0) speed *= ICKY_ACCEL_MULTIPLIER;
    intent = player.moveDir * speed;
  }

  let vx;
  if (player.dashVX !== 0) {
    vx = player.dashVX;
    player.slideVX = 0;
  } else if (stage?.icy && player.grounded) {
    // Accelerate toward the intended speed instead of snapping to it, and
    // coast when there's no input.
    const grip = stage.iceFriction ?? 0.28; // 0 = frictionless, 1 = normal
    const accel = 1 - Math.pow(1 - grip, dtSeconds * 60);
    player.slideVX = (player.slideVX || 0) + (intent - (player.slideVX || 0)) * accel;
    if (intent === 0) player.slideVX *= 1 - 0.55 * dtSeconds;
    if (Math.abs(player.slideVX) < 3) player.slideVX = 0;
    vx = player.slideVX;
  } else {
    vx = intent;
    player.slideVX = player.grounded ? 0 : player.slideVX || 0;
  }
  vx += player.knockbackVX;

  player.x += vx * dtSeconds;
  player.x = Math.min(MAX_X, Math.max(MIN_X, player.x));

  // Knockback bleeds off quickly rather than persisting like normal movement.
  player.knockbackVX *= Math.max(0, 1 - 10 * dtSeconds);
  if (Math.abs(player.knockbackVX) < 5) player.knockbackVX = 0;

  // Vertical knockback (e.g. an upward launcher kick) is a one-shot impulse,
  // not a decaying channel like knockbackVX — gravity below already pulls
  // it back down every subsequent tick, so a second decay curve would just
  // fight the normal jump-arc math.
  if (player.knockbackVY !== 0) {
    player.vy += player.knockbackVY;
    player.knockbackVY = 0;
    player.grounded = false;
    player.standingOn = null;
  }

  // A grounded player can walk off the edge of a platform — check the
  // surface they're on is still under their feet before anything else.
  if (player.grounded && player.standingOn !== null) {
    const platform = platforms.find((p) => p.id === player.standingOn);
    const stillSupported = platform && player.x >= platform.x1 && player.x <= platform.x2;
    if (!stillSupported) {
      player.grounded = false;
      player.standingOn = null;
      player.vy = 0;
    }
  }

  if (!player.grounded) {
    const smashPhase = player.attackState?.key === 'groundSmash' ? player.attackState.phase : null;

    if (smashPhase === 'startup') {
      // Windup: suspended in the air, no gravity, no drift — telegraphs the
      // slam before it happens.
      player.vy = 0;
    } else {
      if (smashPhase === 'falling') {
        player.vy = -character.attacks.groundSmash.slamSpeed;
      } else {
        player.vy -= GRAVITY * dtSeconds;
      }

      const jumpYBefore = player.jumpY;
      player.jumpY += player.vy * dtSeconds;

      const candidates = platforms.filter(
        (p) => p.height <= jumpYBefore && p.height >= player.jumpY && player.x >= p.x1 && player.x <= p.x2
      );
      if (candidates.length > 0) {
        const landing = candidates.reduce((a, b) => (b.height > a.height ? b : a));
        player.jumpY = landing.height;
        player.vy = 0;
        player.grounded = true;
        player.standingOn = landing.id;
      }
    }
  }
}

export function tryJump(player) {
  if (canAct(player) && player.grounded) {
    player.vy = JUMP_SPEED;
    player.grounded = false;
    player.standingOn = null;
  }
}
