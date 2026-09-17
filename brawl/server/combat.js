import {
  GROUND_Y,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT_SCALE,
  CHARACTER_SCALE,
} from '../shared/constants.js';

// Attack dimensions in shared/characters.js are authored against the original
// 48x64 fighter, so every hitbox derived from them scales with the body.
const s = (n) => n * CHARACTER_SCALE;

export function aabbOverlap(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

export function getHurtbox(player) {
  const bottom = GROUND_Y - player.jumpY;
  const height = player.crouching ? PLAYER_HEIGHT * CROUCH_HEIGHT_SCALE : PLAYER_HEIGHT;
  return {
    x1: player.x - PLAYER_WIDTH / 2,
    x2: player.x + PLAYER_WIDTH / 2,
    y1: bottom - height,
    y2: bottom,
  };
}

// AoE box for ground smash's landing impact: centered on the landing x,
// spanning the opponent's full height so their exact vertical position
// (floor vs. a platform) doesn't matter.
export function getGroundSmashBox(landingX, landingSurfaceY, radius) {
  return {
    x1: landingX - s(radius),
    x2: landingX + s(radius),
    y1: landingSurfaceY - PLAYER_HEIGHT,
    y2: landingSurfaceY + s(20),
  };
}

// Symmetric AoE box for spin-style attacks that hit on both sides at once —
// same idea as getGroundSmashBox's shape, but centered on the attacker's
// own hurtbox instead of a landing point (a spin kick isn't tied to landing).
export function getSpinKickBox(player, atk) {
  const hurtbox = getHurtbox(player);
  const centerY = (hurtbox.y1 + hurtbox.y2) / 2;
  return {
    x1: player.x - s(atk.hitboxWidth) / 2,
    x2: player.x + s(atk.hitboxWidth) / 2,
    y1: centerY - s(atk.hitboxHeight) / 2,
    y2: centerY + s(atk.hitboxHeight) / 2,
  };
}

// A melee hitbox extends from the attacker's leading edge outward, in
// whichever direction they're currently facing.
export function getMeleeHitbox(player, atk) {
  const hurtbox = getHurtbox(player);
  const centerY = (hurtbox.y1 + hurtbox.y2) / 2;
  const y1 = centerY - s(atk.hitboxHeight) / 2;
  const y2 = centerY + s(atk.hitboxHeight) / 2;
  if (player.facing >= 0) {
    return { x1: hurtbox.x2, x2: hurtbox.x2 + s(atk.hitboxWidth), y1, y2 };
  }
  return { x1: hurtbox.x1 - s(atk.hitboxWidth), x2: hurtbox.x1, y1, y2 };
}

// Advances an in-progress attack's startup/active/recovery timer by dtMs.
// Returns { enteredActive, finished } so the caller can react (resolve a
// melee hit / spawn a projectile the instant the attack becomes active).
export function advanceAttackState(player, atk, dtMs) {
  const state = player.attackState;
  if (!state) return { enteredActive: false, finished: false };

  state.elapsedMs += dtMs;
  let enteredActive = false;
  let finished = false;

  if (state.phase === 'startup' && state.elapsedMs >= atk.startupMs) {
    state.phase = 'active';
    state.elapsedMs = 0;
    enteredActive = true;
  } else if (state.phase === 'active' && state.elapsedMs >= atk.activeMs) {
    state.phase = 'recovery';
    state.elapsedMs = 0;
  } else if (state.phase === 'recovery' && state.elapsedMs >= atk.recoveryMs) {
    finished = true;
  }

  return { enteredActive, finished };
}

export function spawnProjectiles(id, attacker, atk, atkKey) {
  const count = atk.projectileCount || 1;
  const projectiles = [];
  const hurtbox = getHurtbox(attacker);
  const centerY = (hurtbox.y1 + hurtbox.y2) / 2;
  const x = attacker.facing >= 0 ? hurtbox.x2 : hurtbox.x1;
  for (let i = 0; i < count; i++) {
    projectiles.push({
      id: `${id}-${i}`,
      ownerId: attacker.id,
      x,
      y: centerY,
      w: s(atk.hitboxWidth),
      h: s(atk.hitboxHeight),
      vx: attacker.facing * s(atk.projectileSpeed),
      vy: 0, // normal attacks travel horizontally only
      lifeMs: atk.projectileLifetimeMs + i * (atk.projectileSpreadMs || 0),
      delayMs: i * (atk.projectileSpreadMs || 0),
      damage: atk.damage,
      knockback: atk.knockback || 180,
      attackName: atk.name,
      attackKey: atkKey,
    });
  }
  return projectiles;
}

// Fires `count` projectiles evenly around the caster — the goon burst. Every
// other projectile in the game is horizontal-only, so `vy` is optional
// everywhere and defaults to 0; only these carry a vertical component.
// Speed is a balance between "fast and dramatic" and "actually visible" — at
// 900px/s on an 1100px arena the droplets were off-screen before you saw them.
export function spawnRadialProjectiles(id, caster, { count = 18, speed = 620, damage = 6, lifeMs = 1600 } = {}) {
  const hurtbox = getHurtbox(caster);
  const centerY = (hurtbox.y1 + hurtbox.y2) / 2;
  const projectiles = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    projectiles.push({
      id: `${id}-${i}`,
      ownerId: caster.id,
      x: caster.x,
      y: centerY,
      w: 18,
      h: 18,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      lifeMs,
      delayMs: 0,
      damage,
      knockback: 220,
      attackName: 'Goon Juice',
      attackKey: 'goonJuice',
    });
  }
  return projectiles;
}

export function advanceProjectile(proj, dtMs) {
  if (proj.delayMs > 0) {
    proj.delayMs -= dtMs;
    return;
  }
  proj.x += proj.vx * (dtMs / 1000);
  proj.y += (proj.vy || 0) * (dtMs / 1000);
  proj.lifeMs -= dtMs;
}

export function projectileBox(proj) {
  return {
    x1: proj.x - proj.w / 2,
    x2: proj.x + proj.w / 2,
    y1: proj.y - proj.h / 2,
    y2: proj.y + proj.h / 2,
  };
}
