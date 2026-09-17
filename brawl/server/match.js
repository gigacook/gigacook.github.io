import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  MAX_HEALTH,
  ROUND_TIME_SECONDS,
  GROUND_Y,
  HURT_MS,
  COMBO_WINDOW_MS,
  COMBO_MULTIPLIER_STEP,
  SCORE_PER_DAMAGE,
  MANA_REGEN_PER_SEC,
  SPRINT_MANA_DRAIN_PER_SEC,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  MIN_X,
  MAX_X,
  FALL_DEATH_JUMP_Y,
  SPECIAL_CHARGE_MAX,
  SPECIAL_CHARGE_PER_HIT,
  SPECIAL_CHARGE_COMBO_INSTANT,
  SPECIAL_CHARGE_MULT_MIN,
  SPECIAL_CHARGE_MULT_MAX,
  CHARACTER_SCALE,
} from '../shared/constants.js';
import { getCharacter } from '../shared/characters.js';
import { STAGE_LAYOUTS, getStageLayout } from '../shared/stage.js';
import { applyPhysics, tryJump, canAct } from './physics.js';
import {
  aabbOverlap,
  getHurtbox,
  getMeleeHitbox,
  getGroundSmashBox,
  getSpinKickBox,
  advanceAttackState,
  spawnProjectiles,
  spawnRadialProjectiles,
  advanceProjectile,
  projectileBox,
} from './combat.js';

const ATTACK_KEYS = ['shortRange', 'longRange', 'special'];
const ALL_ATTACK_KEYS = [...ATTACK_KEYS, 'groundSmash', 'spinKick', 'throw', 'launcherKick'];

// Secret-move tuning. Goon is deliberately uncapped but self-destructive:
// cost doubles and stun halves every cast, so spamming it kills you and stops
// working at roughly the same rate.
const GOON_BASE_HP_COST = 5;
const GOON_BASE_STUN_MS = 10000;
const GOON_SHRINK_PER_CAST = 0.92;
const SNOOP_ROOT_MS = 30000;

// `free` stacks up to three times, each one bigger and longer than the last.
const FREE_MAX_STACKS = 3;
const FREE_BIG_MS = 16000;
const FREE_HEAL_FRACTION = 0.3;

// s,s,j — the transformation is now its own move rather than a goon side
// effect. It spends 10s charging (during which you're rooted but invulnerable
// to being interrupted) and then pays out a damage multiplier.
const SSJ_CHARGE_MS = 10000;
const SSJ_ACTIVE_MS = 30000;
const SSJ_POWER_MULTIPLIER = 2.5;

const PISS_DEBUFF_MS = 30000;
const PISS_POWER_MULTIPLIER = 0.25; // 75% weaker
const ICKY_MS = 30000;
const ICKY_ACCEL_MULTIPLIER = 0.35; // sludgy, milkshake-coated movement
const HORSE_MS = 30000;
const HORSE_SPEED_MULTIPLIER = 2.2;
const HORSE_RAM_DAMAGE = 14;
const HORSE_RAM_COOLDOWN_MS = 900;
const CHARM_MS = 10000;

// Idle antics: stand still for a moment and your fighter starts doing
// something stupid, some of which is mechanically real.
const IDLE_ANTIC_DELAY_MS = 2000;
const FART_INTERVAL_MS = 3400; // the wizard, reliably
const FART_DAMAGE = 6;
const FART_RANGE = 260;
const MISFIRE_INTERVAL_MS = 5200; // rogue's deagle gets checked this often
const MISFIRE_CHANCE = 0.18; // ...and goes off this often when checked

// 9,1,1 — a stage event in four beats: a plane comes down and both fighters
// have to get clear of it; a conspiracy-brained politician wanders out of the
// wreckage muttering that it was the wrong target; taunt him and he works
// himself into such a state that he hallucinates himself into a giant angry
// star and chases whoever mocked him. Outrun that and you walk off with his
// power of persuasion.
const PLANE_WARN_MS = 1600; // shadow/siren before impact
const PLANE_FALL_MS = 1800;
const PLANE_BLAST_RADIUS = 190;
const PLANE_DAMAGE = 34;
const POLITICIAN_LINGER_MS = 7000;
const POLITICIAN_TAUNT_RANGE = 260;
const STAR_CHASE_MS = 10000;
const STAR_SPEED = 210;
const STAR_TOUCH_RADIUS = 70;
const STAR_TOUCH_DAMAGE = 20;

// Damage a player deals is scaled by their own buffs/debuffs.
export function powerMultiplierFor(player) {
  let mult = 1;
  if (player.effects?.saiyanMs > 0) mult *= SSJ_POWER_MULTIPLIER;
  if (player.effects?.pissedMs > 0) mult *= PISS_POWER_MULTIPLIER;
  return mult;
}

// Taunt bomb: rare, slow, and unmissable once it locks on.
export const TAUNT_BOMB_CHANCE = 0.1; // 1 in 10 taunts
const BOMB_SPAWN_HEIGHT = 460; // jumpY units above the ground
const BOMB_FALL_SPEED = 70; // px/s downward — deliberately ominous
const BOMB_HOMING_SPEED = 110; // px/s horizontal tracking
const BOMB_FUSE_MS = 9000; // dud out rather than hang around forever
const BOMB_HIT_RADIUS = 34;

// Cowardly platform tuning.
// Fast enough to clear its own width during a fall from near the top of the
// lookahead window. Drop onto one from point-blank range and it still can't
// get out of the way — which is fair, and reads fine.
const PLATFORM_DODGE_SPEED = 460; // px/s while fleeing
const PLATFORM_LOOKAHEAD = 175; // how far above it a faller triggers the dodge
const PLATFORM_MARGIN = 45; // horizontal slack around the platform edges
const PLATFORM_SPRING_K = 5.5; // pull back toward the home position
const PLATFORM_SPRING_DAMPING = 3.2;
const PLATFORM_EDGE_PAD = 20; // keep platforms inside the arena
const PLATFORM_STACK_BAND = 40; // heights within this count as "same row"

function freshPlayerState(id) {
  return {
    id,
    characterId: null,
    x: 0,
    jumpY: 0,
    vy: 0,
    grounded: true,
    standingOn: null,
    facing: 1,
    moveDir: 0,
    health: MAX_HEALTH,
    mana: 0,
    duckHeld: false,
    crouching: false,
    sprintHeld: false,
    sprinting: false,
    attackState: null, // { key, phase, elapsedMs, hasHit }
    cooldowns: { shortRange: 0, longRange: 0, special: 0, groundSmash: 0, spinKick: 0, throw: 0, launcherKick: 0 },
    hurtMs: 0,
    knockbackVX: 0,
    knockbackVY: 0,
    grabbedBy: null, // id of the player currently holding us in a throw, or null
    dashVX: 0,
    slideVX: 0, // carried momentum on icy stages
    idleMs: 0, // how long they've stood doing nothing, drives idle antics
    anticTimerMs: 0,
    lastFartAt: 0,
    lastMisfireAt: 0,
    rematchReady: false,
    score: 0,
    comboCount: 0,
    comboTimerMs: 0,
    specialCharge: 0,
    lastHitPoints: 0, // most recent score awarded, for client popup dedup
    ...freshEffectState(),
  };
}

// Status effects and secret-move bookkeeping. Split out because _startRound
// has to reset exactly this subset without rebuilding the whole player.
function freshEffectState() {
  return {
    effects: {
      stunMs: 0, // blocks everything: movement, jumping, attacking
      rootMs: 0, // blocks self-propelled walking only; attacks still allowed
      saiyanMs: 0, // s,s,j payoff: gold aura, size, damage multiplier
      ssjChargeMs: 0, // s,s,j windup — rooted, lightning, growing
      bigMs: 0, // self buff: scale-up only (from the `free` move)
      ickyMs: 0, // McDonald's beam: sluggish, and your taunts turn pathetic
      pissedMs: 0, // drenched: power gutted, and puking
      charmedMs: 0, // forced to walk toward whoever charmed you
      horseMs: 0, // mounted on the stallion
    },
    goonCasts: 0, // escalates the goon cost, halves its stun, shrinks the caster
    sizeScale: 1, // permanent per-round shrink from repeated goon casts
    bigStacks: 0, // how many times `free` has been stacked (max FREE_MAX_STACKS)
    charmedBy: null, // id of whoever charmed us, for the follow direction
    secretMovesUsed: { snoop: false }, // once per round
  };
}

export class Match {
  constructor(id, playerIds) {
    this.id = id;
    this.players = playerIds.map(freshPlayerState);
    this.phase = 'select'; // 'select' -> 'playing' -> 'over'
    this.stageId = null;
    this.platforms = [];
    this.floor = [];
    this.stage = null;
    this.projectiles = [];
    this.bombs = [];
    this.stageEvent = null;
    this.timeRemaining = ROUND_TIME_SECONDS;
    this.winnerId = undefined; // undefined = n/a, null = draw, id = winner
    this.endReason = null; // e.g. 'gooned' when a player goons themselves to death
    this._projectileCounter = 0;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  getOpponent(id) {
    return this.players.find((p) => p.id !== id);
  }

  hasPlayer(id) {
    return Boolean(this.getPlayer(id));
  }

  selectCharacter(playerId, characterId) {
    if (this.phase !== 'select') return;
    if (!getCharacter(characterId)) return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.characterId = characterId;
    this._maybeStartRound();
  }

  selectStage(playerId, stageId) {
    if (this.phase !== 'select') return;
    if (!this.getPlayer(playerId)) return;
    if (!STAGE_LAYOUTS.some((s) => s.id === stageId)) return;
    this.stageId = stageId;
    this._maybeStartRound();
  }

  _maybeStartRound() {
    if (this.phase !== 'select') return;
    if (!this.stageId) return;
    if (this.players.every((p) => p.characterId)) {
      this._startRound();
    }
  }

  _startRound() {
    const [a, b] = this.players;
    const layout = getStageLayout(this.stageId);
    const spawnAX = 150;
    const spawnBX = ARENA_WIDTH - 150;
    // Spawning "grounded" only works if standingOn names the actual surface
    // under the spawn point (and jumpY matches its height) — a null/
    // unmatched id means the walked-off-the-edge check in physics.js never
    // fires, so the player would slide right off it as if it were solid.
    // Prefer the floor when one covers the spawn point; stages with no
    // floor there at all (e.g. a platforms-only map) fall back to whichever
    // platform is under it instead, so a fighter can spawn on a ledge. Pick
    // the LOWEST overlapping platform, not the highest — a spawn platform
    // can have another platform floating directly above it (to climb to
    // later), and the fighter should start on the ground-level one, not get
    // teleported up to whatever's stacked on top of it.
    const surfaceAt = (x) => {
      const floorSeg = layout.floor.find((f) => x >= f.x1 && x <= f.x2);
      if (floorSeg) return floorSeg;
      return layout.platforms
        .filter((p) => x >= p.x1 && x <= p.x2)
        .reduce((best, p) => (!best || p.height < best.height ? p : best), null) || { id: null, height: 0 };
    };
    const spawnA = surfaceAt(spawnAX);
    const spawnB = surfaceAt(spawnBX);
    Object.assign(a, {
      x: spawnAX,
      jumpY: spawnA.height,
      vy: 0,
      grounded: true,
      standingOn: spawnA.id,
      facing: 1,
      moveDir: 0,
      health: MAX_HEALTH,
      mana: getCharacter(a.characterId).maxMana,
      duckHeld: false,
      crouching: false,
      sprintHeld: false,
      sprinting: false,
      attackState: null,
      cooldowns: { shortRange: 0, longRange: 0, special: 0, groundSmash: 0, spinKick: 0, throw: 0, launcherKick: 0 },
      hurtMs: 0,
      knockbackVX: 0,
      knockbackVY: 0,
      grabbedBy: null,
      dashVX: 0,
      slideVX: 0,
      specialCharge: 0,
      ...freshEffectState(),
    });
    Object.assign(b, {
      x: spawnBX,
      jumpY: spawnB.height,
      vy: 0,
      grounded: true,
      standingOn: spawnB.id,
      facing: -1,
      moveDir: 0,
      health: MAX_HEALTH,
      mana: getCharacter(b.characterId).maxMana,
      duckHeld: false,
      crouching: false,
      sprintHeld: false,
      sprinting: false,
      attackState: null,
      cooldowns: { shortRange: 0, longRange: 0, special: 0, groundSmash: 0, spinKick: 0, throw: 0, launcherKick: 0 },
      hurtMs: 0,
      knockbackVX: 0,
      knockbackVY: 0,
      grabbedBy: null,
      dashVX: 0,
      specialCharge: 0,
      ...freshEffectState(),
    });
    // Platforms are cloned per match because cowardly ones move; the floor
    // never does, so it stays a reference to the shared layout.
    this.platforms = layout.platforms.map((p) => ({
      ...p,
      homeX1: p.x1,
      vx: 0,
      cowardly: Boolean(p.cowardly),
    }));
    this.floor = layout.floor;
    this.stage = layout; // for stage-wide traits like `icy`
    this.projectiles = [];
    this.bombs = [];
    this.stageEvent = null;
    this.timeRemaining = ROUND_TIME_SECONDS;
    this.winnerId = undefined;
    this.endReason = null;
    this.phase = 'playing';
  }

  setMoveDir(playerId, dir) {
    if (this.phase !== 'playing') return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.moveDir = Math.max(-1, Math.min(1, dir));
  }

  setDuckHeld(playerId, held) {
    if (this.phase !== 'playing') return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.duckHeld = Boolean(held);
  }

  setSprintHeld(playerId, held) {
    if (this.phase !== 'playing') return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.sprintHeld = Boolean(held);
  }

  jump(playerId) {
    if (this.phase !== 'playing') return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    if (player.grabbedBy !== null) return;
    tryJump(player);
  }

  // A taunt very occasionally summons a giant cartoon bomb (see index.js for
  // the roll). It descends slowly onto the opponent and one-shots them.
  spawnTauntBomb(casterId) {
    if (this.phase !== 'playing') return;
    const caster = this.getPlayer(casterId);
    const target = this.getOpponent(casterId);
    if (!caster || !target) return;
    this.bombs.push({
      id: `b${this._projectileCounter++}`,
      ownerId: caster.id,
      targetId: target.id,
      x: caster.x,
      jumpY: BOMB_SPAWN_HEIGHT,
      fuseMs: BOMB_FUSE_MS,
    });
  }

  // Cowardly platforms edge away from anyone dropping toward them, then drift
  // back home once the coast is clear. Deliberately a proximity check rather
  // than a real trajectory solve — the joke is "it noticed you and bailed",
  // which reads identically and is far easier to tune.
  // Standing still long enough makes a fighter start entertaining themselves.
  // Mostly cosmetic (the client draws it off `idleMs`), but the wizard's fart
  // and the rogue's trigger discipline are mechanically real.
  _tickIdleAntics(player, dtMs) {
    const busy =
      player.moveDir !== 0 ||
      !player.grounded ||
      player.attackState !== null ||
      player.hurtMs > 0 ||
      player.grabbedBy !== null;

    if (busy) {
      player.idleMs = 0;
      player.anticTimerMs = 0;
      return;
    }

    player.idleMs = (player.idleMs || 0) + dtMs;
    if (player.idleMs < IDLE_ANTIC_DELAY_MS) return;

    player.anticTimerMs = (player.anticTimerMs || 0) + dtMs;
    const opponent = this.getOpponent(player.id);

    if (player.characterId === 'mage' && player.anticTimerMs >= FART_INTERVAL_MS) {
      player.anticTimerMs = 0;
      player.lastFartAt = Date.now();
      if (Math.abs(opponent.x - player.x) <= FART_RANGE) {
        this.applyDamage(player.id, opponent, FART_DAMAGE, Math.sign(opponent.x - player.x) || 1, 180);
      }
      return;
    }

    if (player.characterId === 'rogue' && player.anticTimerMs >= MISFIRE_INTERVAL_MS) {
      player.anticTimerMs = 0;
      if (Math.random() < MISFIRE_CHANCE) {
        // The gun goes off. Sometimes that just wins the round outright.
        player.lastMisfireAt = Date.now();
        this.applyDamage(player.id, opponent, 9999, Math.sign(opponent.x - player.x) || 1, 700);
      }
    }
  }

  _tickPlatforms(dtMs) {
    const dt = dtMs / 1000;
    const occupied = new Set(this.players.map((p) => p.standingOn).filter(Boolean));

    for (const plat of this.platforms) {
      if (!plat.cowardly) continue;

      const width = plat.x2 - plat.x1;

      // Never move out from under someone already standing on it — including
      // while springing home.
      if (occupied.has(plat.id)) {
        plat.vx = 0;
        continue;
      }

      let dodge = 0;
      for (const player of this.players) {
        if (player.grounded || player.vy > 0) continue; // only reacts to incoming falls
        const gap = player.jumpY - plat.height;
        if (gap < 0 || gap > PLATFORM_LOOKAHEAD) continue;
        if (player.x < plat.x1 - PLATFORM_MARGIN || player.x > plat.x2 + PLATFORM_MARGIN) continue;
        const center = (plat.x1 + plat.x2) / 2;
        dodge = (Math.sign(center - player.x) || 1) * PLATFORM_DODGE_SPEED;
        break;
      }

      if (dodge !== 0) {
        plat.vx = dodge;
      } else {
        // critically-ish damped drift back to where it belongs
        plat.vx += ((plat.homeX1 - plat.x1) * PLATFORM_SPRING_K - plat.vx * PLATFORM_SPRING_DAMPING) * dt;
      }

      let nx1 = plat.x1 + plat.vx * dt;
      nx1 = Math.max(PLATFORM_EDGE_PAD, Math.min(ARENA_WIDTH - PLATFORM_EDGE_PAD - width, nx1));
      let nx2 = nx1 + width;

      // Don't slide into a neighbour sharing roughly the same height — freeze
      // this tick rather than resolving a push-apart.
      const blocked = this.platforms.some(
        (other) =>
          other !== plat &&
          Math.abs(other.height - plat.height) <= PLATFORM_STACK_BAND &&
          nx1 < other.x2 &&
          nx2 > other.x1
      );
      if (blocked) {
        plat.vx = 0;
        continue;
      }

      plat.x1 = nx1;
      plat.x2 = nx2;
    }
  }

  _tickBombs(dtMs) {
    if (this.bombs.length === 0) return;
    const dt = dtMs / 1000;

    for (const bomb of [...this.bombs]) {
      const target = this.getPlayer(bomb.targetId);
      if (!target) {
        this.bombs = this.bombs.filter((b) => b !== bomb);
        continue;
      }

      // Settles at ground level rather than sinking through the stage — if the
      // target keeps running it hovers and stalks them until the fuse dies.
      bomb.jumpY = Math.max(0, bomb.jumpY - BOMB_FALL_SPEED * dt);
      bomb.fuseMs -= dtMs;

      // Horizontal lock-on, capped so it drifts rather than teleports.
      const dx = target.x - bomb.x;
      const step = BOMB_HOMING_SPEED * dt;
      bomb.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;

      const bombY = GROUND_Y - bomb.jumpY;
      const box = {
        x1: bomb.x - BOMB_HIT_RADIUS,
        x2: bomb.x + BOMB_HIT_RADIUS,
        y1: bombY - BOMB_HIT_RADIUS,
        y2: bombY + BOMB_HIT_RADIUS,
      };

      if (aabbOverlap(box, getHurtbox(target))) {
        this.bombs = this.bombs.filter((b) => b !== bomb);
        const dirSign = Math.sign(target.x - bomb.x) || 1;
        // applyDamage already clamps health and ends the round for us.
        this.applyDamage(bomb.ownerId, target, 9999, dirSign, 500, 400);
        return; // round is over; stop processing bombs this tick
      }

      // Never connected before the fuse died — a harmless dud.
      if (bomb.fuseMs <= 0) {
        this.bombs = this.bombs.filter((b) => b !== bomb);
      }
    }
  }

  // Secret key-sequence moves (see public/src/input.js for the sequences).
  // Returns an optional { taunt, roll } payload for index.js to broadcast —
  // Match deliberately has no `io` reference of its own.
  secretMove(playerId, name) {
    if (this.phase !== 'playing') return null;
    const player = this.getPlayer(playerId);
    if (!player) return null;

    // `free` is the one move that works while stunned or rooted — escaping is
    // its entire purpose, so it bypasses canAct on purpose.
    if (name === 'free') return this._freeMove(player);

    if (!canAct(player)) return null;
    if (name === 'goon') return this._goonMove(player);
    if (name === 'snoop') return this._snoopMove(player);
    if (name === 'ssj') return this._ssjMove(player);
    if (name === 'piss') return this._pissMove(player);
    if (name === 'mcdonalds') return this._mcdonaldsMove(player);
    if (name === 'horse') return this._horseMove(player);
    if (name === 'nineeleven') return this._planeMove(player);
    return null;
  }

  // 9,1,1 — nobody owns this one; it's a hazard for both players.
  _planeMove(player) {
    if (this.stageEvent) return null;
    const targetX = 200 + Math.random() * (ARENA_WIDTH - 400);
    this.stageEvent = {
      kind: 'nineeleven',
      phase: 'incoming',
      timerMs: PLANE_WARN_MS + PLANE_FALL_MS,
      x: targetX,
      planeX: -200,
      planeY: 40,
      politicianX: targetX,
      starX: targetX,
      starY: GROUND_Y - 200,
      chaseTargetId: null,
      enragedBy: null,
    };
    return { plane: { x: targetX, casterId: player.id } };
  }

  // Called from index.js whenever anyone taunts, so the politician can take
  // it personally.
  notifyTaunt(playerId) {
    const ev = this.stageEvent;
    if (!ev || ev.phase !== 'politician') return null;
    const player = this.getPlayer(playerId);
    if (!player) return null;
    if (Math.abs(player.x - ev.politicianX) > POLITICIAN_TAUNT_RANGE) return null;

    // He does not take it well.
    ev.phase = 'star';
    ev.timerMs = STAR_CHASE_MS;
    ev.chaseTargetId = playerId;
    ev.enragedBy = playerId;
    ev.starX = ev.politicianX;
    ev.starY = GROUND_Y - 200;

    // Everyone who isn't being chased is frozen watching it happen.
    for (const p of this.players) {
      if (p.id !== playerId) p.effects.stunMs = Math.max(p.effects.stunMs, STAR_CHASE_MS);
    }
    return { star: { targetId: playerId } };
  }

  _tickStageEvent(dtMs) {
    const ev = this.stageEvent;
    if (!ev) return;
    const dt = dtMs / 1000;
    ev.timerMs -= dtMs;

    if (ev.phase === 'incoming') {
      // Comes in low across the arena and augers into the target point.
      const total = PLANE_WARN_MS + PLANE_FALL_MS;
      const t = 1 - Math.max(0, ev.timerMs) / total;
      ev.planeX = -200 + (ev.x + 200) * t;
      ev.planeY = 40 + (GROUND_Y - 40) * Math.pow(t, 2.4);

      if (ev.timerMs <= 0) {
        for (const p of this.players) {
          if (Math.abs(p.x - ev.x) <= PLANE_BLAST_RADIUS) {
            p.health = Math.max(0, p.health - PLANE_DAMAGE);
            p.hurtMs = HURT_MS;
            p.knockbackVX = Math.sign(p.x - ev.x || 1) * 700;
            p.knockbackVY = 500;
            if (p.health <= 0) {
              this._endRound(this.getOpponent(p.id).id);
              this.stageEvent = null;
              return;
            }
          }
        }
        ev.phase = 'politician';
        ev.timerMs = POLITICIAN_LINGER_MS;
      }
      return;
    }

    if (ev.phase === 'politician') {
      if (ev.timerMs <= 0) this.stageEvent = null; // wanders off, unbothered
      return;
    }

    if (ev.phase === 'star') {
      const target = this.getPlayer(ev.chaseTargetId);
      if (!target) {
        this.stageEvent = null;
        return;
      }
      // Lumbering but relentless.
      const ty = GROUND_Y - target.jumpY - PLAYER_HEIGHT / 2;
      ev.starX += Math.sign(target.x - ev.starX || 1) * STAR_SPEED * dt;
      ev.starY += Math.sign(ty - ev.starY || 1) * STAR_SPEED * 0.7 * dt;

      const dx = ev.starX - target.x;
      const dy = ev.starY - ty;
      if (Math.hypot(dx, dy) <= STAR_TOUCH_RADIUS && target.hurtMs <= 0) {
        this.applyDamage(ev.chaseTargetId, target, STAR_TOUCH_DAMAGE, Math.sign(-dx) || 1, 520);
        if (this.phase !== 'playing') {
          this.stageEvent = null;
          return;
        }
      }

      if (ev.timerMs <= 0) {
        // Survived the whole chase — you take his gift of persuasion.
        const other = this.getOpponent(ev.chaseTargetId);
        if (other) {
          other.effects.stunMs = 0;
          other.effects.charmedMs = CHARM_MS;
          other.charmedBy = ev.chaseTargetId;
        }
        this.stageEvent = null;
      }
    }
  }

  // s,s,j — a 10s charge (rooted, crackling, swelling) that pays out a long
  // damage buff. Interrupting it isn't possible; you just can't walk.
  _ssjMove(player) {
    if (player.effects.ssjChargeMs > 0 || player.effects.saiyanMs > 0) return null;
    player.effects.ssjChargeMs = SSJ_CHARGE_MS;
    player.effects.rootMs = Math.max(player.effects.rootMs, SSJ_CHARGE_MS);
    return { ssj: { casterId: player.id, chargeMs: SSJ_CHARGE_MS } };
  }

  // p,i,s,s — a stream that guts the target's power and leaves them puking.
  _pissMove(player) {
    const opponent = this.getOpponent(player.id);
    opponent.effects.pissedMs = PISS_DEBUFF_MS;
    return { piss: { casterId: player.id, targetId: opponent.id } };
  }

  // "mcdonalds" — a golden-arches UFO beams the opponent, making them
  // sluggish and turning their taunts into anxious whimpering.
  _mcdonaldsMove(player) {
    const opponent = this.getOpponent(player.id);
    opponent.effects.ickyMs = ICKY_MS;
    return { mcdonalds: { casterId: player.id, targetId: opponent.id } };
  }

  // h,o,r,s,e — mount up. Fast, and ramming deals contact damage.
  _horseMove(player) {
    if (player.effects.horseMs > 0) return null;
    player.effects.horseMs = HORSE_MS;
    return { horse: { casterId: player.id } };
  }

  // g,o,o,n — spammable, but each cast costs double the HP of the last, halves
  // the stun it applies, and permanently shrinks the caster for the round.
  // Goon yourself to death and the round ends with a dedicated message.
  _goonMove(player) {
    const opponent = this.getOpponent(player.id);
    const n = player.goonCasts;
    const hpCost = GOON_BASE_HP_COST * Math.pow(2, n);
    const stunMs = GOON_BASE_STUN_MS / Math.pow(2, n);

    player.goonCasts += 1;
    player.sizeScale = Math.pow(GOON_SHRINK_PER_CAST, player.goonCasts);
    opponent.effects.stunMs = Math.max(opponent.effects.stunMs, stunMs);

    const id = `g${this._projectileCounter++}`;
    this.projectiles.push(...spawnRadialProjectiles(id, player));

    player.health -= hpCost;
    if (player.health <= 0) {
      player.health = 0;
      this._endRound(opponent.id, 'gooned');
    }
    return { goon: { casterId: player.id } };
  }

  // 4,2,0 — once per round. The root lands immediately and server-side; the
  // rolling cameo itself is a purely cosmetic client animation.
  _snoopMove(player) {
    if (player.secretMovesUsed.snoop) return null;
    player.secretMovesUsed.snoop = true;
    const opponent = this.getOpponent(player.id);
    opponent.effects.rootMs = Math.max(opponent.effects.rootMs, SNOOP_ROOT_MS);
    return { roll: { casterId: player.id } };
  }

  // f,r,e,e — once per round. Clears your own debuffs (buffs are left alone),
  // heals 30%, and puffs you up for a while.
  // f,r,e,e — stacks up to three times. Each stack clears your debuffs again,
  // heals again, and makes you dramatically larger for longer.
  _freeMove(player) {
    if (player.bigStacks >= FREE_MAX_STACKS) return null;
    player.bigStacks += 1;
    player.effects.stunMs = 0;
    player.effects.rootMs = 0;
    player.effects.ickyMs = 0;
    player.effects.pissedMs = 0;
    player.effects.charmedMs = 0;
    player.charmedBy = null;
    player.effects.bigMs = FREE_BIG_MS * player.bigStacks;
    player.health = Math.min(MAX_HEALTH, player.health + MAX_HEALTH * FREE_HEAL_FRACTION);
    return {
      taunt: { playerId: player.id, message: 'YOU WILL NEVER GET THIS!!' },
      free: { casterId: player.id, stacks: player.bigStacks },
    };
  }

  startAttack(playerId, attackKey) {
    if (this.phase !== 'playing') return;
    if (!ATTACK_KEYS.includes(attackKey)) return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    if (!canAct(player)) return; // covers mid-attack, hit-stun and being stunned
    if (player.grabbedBy !== null) return; // frozen while being grabbed

    // Down + short attack, in the air: a ground smash instead of the normal
    // melee swing. Resolved here (server-authoritative on `grounded`) rather
    // than trusting the client's own airborne/duck state.
    if (attackKey === 'shortRange' && player.duckHeld && !player.grounded) {
      this._startGroundSmash(player);
      return;
    }

    // Sprint + short attack, grounded: a wide spinning kick instead of the
    // normal jab.
    if (attackKey === 'shortRange' && player.sprintHeld && player.grounded) {
      this._startSpinKick(player);
      return;
    }

    // Duck + long attack, grounded: an unblockable grab instead of the
    // normal ranged attack. Range is resolved later (in _advanceThrow, once
    // startup finishes) rather than here, so a duck+K attempt can still
    // whiff if the opponent isn't close by the time the windup completes.
    if (attackKey === 'longRange' && player.duckHeld && player.grounded) {
      this._startThrow(player);
      return;
    }

    // Special key while airborne: a rising launcher kick instead of the
    // character's normal grounded special.
    if (attackKey === 'special' && !player.grounded) {
      this._startLauncherKick(player);
      return;
    }

    if (player.cooldowns[attackKey] > 0) return;

    const character = getCharacter(player.characterId);
    const atk = character.attacks[attackKey];
    if (player.mana < atk.manaCost) return;

    // Casting a special locks in its power from the charge meter at this
    // exact moment and spends the whole meter — whether or not it actually
    // lands. `chargeFraction` rides along on the attack state so the hit
    // resolution below (tick()) knows how hard to hit.
    const chargeFraction = attackKey === 'special' ? player.specialCharge / SPECIAL_CHARGE_MAX : 0;
    player.attackState = { key: attackKey, phase: 'startup', elapsedMs: 0, hasHit: false, chargeFraction };
    player.cooldowns[attackKey] = atk.cooldownMs;
    player.mana -= atk.manaCost;
    if (attackKey === 'special') player.specialCharge = 0;
  }

  _startGroundSmash(player) {
    const character = getCharacter(player.characterId);
    const atk = character.attacks.groundSmash;
    if (player.cooldowns.groundSmash > 0) return;
    if (player.mana < atk.manaCost) return;

    player.attackState = { key: 'groundSmash', phase: 'startup', elapsedMs: 0, hasHit: false };
    player.cooldowns.groundSmash = atk.cooldownMs;
    player.mana -= atk.manaCost;
  }

  _startSpinKick(player) {
    const character = getCharacter(player.characterId);
    const atk = character.attacks.spinKick;
    if (player.cooldowns.spinKick > 0) return;
    if (player.mana < atk.manaCost) return;

    player.attackState = { key: 'spinKick', phase: 'startup', elapsedMs: 0, hasHit: false };
    player.cooldowns.spinKick = atk.cooldownMs;
    player.mana -= atk.manaCost;
  }

  _startThrow(player) {
    const character = getCharacter(player.characterId);
    const atk = character.attacks.throw;
    if (player.cooldowns.throw > 0) return;
    if (player.mana < atk.manaCost) return;

    player.attackState = { key: 'throw', phase: 'startup', elapsedMs: 0, hasHit: false };
    player.cooldowns.throw = atk.cooldownMs;
    player.mana -= atk.manaCost;
  }

  _startLauncherKick(player) {
    const character = getCharacter(player.characterId);
    const atk = character.attacks.launcherKick;
    if (player.cooldowns.launcherKick > 0) return;
    if (player.mana < atk.manaCost) return;

    player.attackState = { key: 'launcherKick', phase: 'startup', elapsedMs: 0, hasHit: false };
    player.cooldowns.launcherKick = atk.cooldownMs;
    player.mana -= atk.manaCost;
  }

  requestRematch(playerId) {
    if (this.phase !== 'over') return;
    const player = this.getPlayer(playerId);
    if (!player) return;
    player.rematchReady = true;
    if (this.players.every((p) => p.rematchReady)) {
      this.players.forEach((p) => {
        const id = p.id;
        Object.assign(p, freshPlayerState(id));
      });
      this.phase = 'select';
      this.stageId = null;
    }
  }

  // Interpolates a special's damage/knockback between the uncharged and
  // fully-charged multipliers based on the charge fraction locked in when
  // it was cast. Leaves hitbox size, timing, and every other field alone.
  _chargeScaledAtk(atk, chargeFraction) {
    const mult = SPECIAL_CHARGE_MULT_MIN + (SPECIAL_CHARGE_MULT_MAX - SPECIAL_CHARGE_MULT_MIN) * (chargeFraction || 0);
    return { ...atk, damage: atk.damage * mult, knockback: (atk.knockback || 160) * mult };
  }

  applyDamage(attackerId, target, damage, dirSign, knockback, knockbackVY = 0, isSpecialCast = false) {
    if (this.phase !== 'playing') return;
    const attacker = this.getPlayer(attackerId);

    // Chained hits land harder, not just score more — attacker.comboCount
    // here is how many hits already landed in the current chain (0 for the
    // opener), so the first hit is unaffected and each subsequent hit within
    // the combo window scales up, same rate the score bonus already used.
    const comboMultiplier = 1 + attacker.comboCount * COMBO_MULTIPLIER_STEP;
    // Buffs/debuffs on the attacker (super saiyan, being pissed on) scale
    // everything they deal.
    const scaledDamage = Math.round(damage * comboMultiplier * powerMultiplierFor(attacker));

    target.health = Math.max(0, target.health - scaledDamage);
    target.hurtMs = HURT_MS;
    target.attackState = null;
    target.dashVX = 0;
    target.knockbackVX = dirSign * knockback;
    target.knockbackVY = knockbackVY;

    // Being hit interrupts whatever combo the victim had going.
    target.comboCount = 0;
    target.comboTimerMs = 0;

    attacker.comboCount += 1;
    attacker.comboTimerMs = COMBO_WINDOW_MS;

    // Landing a hit charges up the special attack; a bigger combo charges
    // it faster (same multiplier that's already boosting this hit's
    // damage), and a 4-hit combo maxes it out instantly regardless of
    // however much charge had built up before. A special's own hit is
    // excluded — it was just cast by spending the meter, so it landing
    // shouldn't immediately refill the very meter it just spent.
    if (!isSpecialCast) {
      if (attacker.comboCount >= SPECIAL_CHARGE_COMBO_INSTANT) {
        attacker.specialCharge = SPECIAL_CHARGE_MAX;
      } else {
        attacker.specialCharge = Math.min(
          SPECIAL_CHARGE_MAX,
          attacker.specialCharge + SPECIAL_CHARGE_PER_HIT * comboMultiplier
        );
      }
    }

    const points = Math.round(scaledDamage * SCORE_PER_DAMAGE);
    attacker.score += points;
    attacker.lastHitPoints = points;

    if (target.health <= 0) {
      this._endRound(this.getOpponent(target.id).id);
    }
  }

  _endRound(winnerId, reason = null) {
    if (this.phase !== 'playing') return;
    this.phase = 'over';
    this.winnerId = winnerId;
    this.endReason = reason;
    this.projectiles = [];
    // A bomb still in the air when the clock runs out must not detonate into
    // an already-finished round.
    this.bombs = [];
    this.stageEvent = null;
    for (const p of this.players) p.grabbedBy = null;
  }

  tick(dtSeconds) {
    if (this.phase !== 'playing') return;
    const dtMs = dtSeconds * 1000;

    this.timeRemaining -= dtSeconds;

    for (const player of this.players) {
      // While grabbed, the victim's position is fully owned by the
      // attacker's _advanceThrow this tick — skip their own physics/attack
      // advance entirely so nothing fights the repositioning.
      if (player.grabbedBy !== null) continue;

      const character = getCharacter(player.characterId);
      const opponent = this.getOpponent(player.id);

      for (const key of ALL_ATTACK_KEYS) {
        player.cooldowns[key] = Math.max(0, player.cooldowns[key] - dtMs);
      }
      if (player.hurtMs > 0) player.hurtMs = Math.max(0, player.hurtMs - dtMs);

      const chargingBefore = player.effects.ssjChargeMs;
      for (const key of Object.keys(player.effects)) {
        player.effects[key] = Math.max(0, player.effects[key] - dtMs);
      }
      // Charge complete -> transform.
      if (chargingBefore > 0 && player.effects.ssjChargeMs === 0) {
        player.effects.saiyanMs = SSJ_ACTIVE_MS;
      }
      if (player.effects.charmedMs === 0) player.charmedBy = null;

      // Charmed: your inputs are overridden and you walk toward your charmer.
      if (player.effects.charmedMs > 0 && player.charmedBy) {
        const charmer = this.getPlayer(player.charmedBy);
        if (charmer) player.moveDir = Math.sign(charmer.x - player.x) || 0;
      }

      this._tickIdleAntics(player, dtMs);

      // Mounted: ramming the opponent hurts them, on a short cooldown.
      if (player.effects.horseMs > 0) {
        player.horseRamCooldownMs = Math.max(0, (player.horseRamCooldownMs || 0) - dtMs);
        const other = this.getOpponent(player.id);
        if (
          player.horseRamCooldownMs === 0 &&
          player.moveDir !== 0 &&
          aabbOverlap(getHurtbox(player), getHurtbox(other))
        ) {
          player.horseRamCooldownMs = HORSE_RAM_COOLDOWN_MS;
          this.applyDamage(player.id, other, HORSE_RAM_DAMAGE, Math.sign(other.x - player.x) || 1, 600);
        }
      }

      if (player.comboTimerMs > 0) {
        player.comboTimerMs = Math.max(0, player.comboTimerMs - dtMs);
        if (player.comboTimerMs === 0) player.comboCount = 0;
      }

      // Dash-type specials (e.g. Rogue's Dash Strike) move the player during
      // their attack's startup window, then release control back to physics.
      player.dashVX = 0;
      if (player.attackState) {
        const atk = character.attacks[player.attackState.key];
        if (
          atk.dashSpeed &&
          player.attackState.phase === 'startup' &&
          player.attackState.elapsedMs < atk.dashMs
        ) {
          player.dashVX = player.facing * atk.dashSpeed * CHARACTER_SCALE;
        }
      }

      if (player.dashVX === 0 && player.hurtMs <= 0) {
        player.facing = opponent.x >= player.x ? 1 : -1;
      }

      // Sprinting must be derived before physics runs, since physics reads
      // it to pick the movement speed this tick.
      player.sprinting =
        player.sprintHeld && player.moveDir !== 0 && player.mana > 0 && player.attackState === null;

      applyPhysics(player, dtSeconds, [...this.platforms, ...this.floor], character, this.stage);

      // Fell through a gap in the stage floor with nothing catching them —
      // an instant round loss, same as health hitting 0.
      if (!player.grounded && player.jumpY < FALL_DEATH_JUMP_Y) {
        this._endRound(opponent.id);
      }

      // Crouching reflects the post-physics grounded state (e.g. a player
      // who just landed this tick can crouch immediately).
      player.crouching = player.duckHeld && player.grounded && player.attackState === null;

      if (player.sprinting) {
        player.mana = Math.max(0, player.mana - SPRINT_MANA_DRAIN_PER_SEC * dtSeconds);
      } else {
        player.mana = Math.min(character.maxMana, player.mana + MANA_REGEN_PER_SEC * dtSeconds);
      }

      if (player.attackState) {
        const atk = character.attacks[player.attackState.key];
        // Charge-scaled damage/knockback for a special cast — hitbox size
        // and timing stay the same as the base attack data (`atk`); only
        // the actual power dealt reads from this.
        const dealAtk = player.attackState.key === 'special'
          ? this._chargeScaledAtk(atk, player.attackState.chargeFraction)
          : atk;

        if (player.attackState.key === 'groundSmash') {
          this._advanceGroundSmash(player, opponent, atk, dtMs);
        } else if (player.attackState.key === 'throw') {
          this._advanceThrow(player, opponent, atk, dtMs);
        } else {
          const { enteredActive, finished } = advanceAttackState(player, atk, dtMs);

          if (enteredActive && atk.projectileSpeed) {
            const id = `p${this._projectileCounter++}`;
            this.projectiles.push(...spawnProjectiles(id, player, dealAtk, player.attackState.key));
          }

          if (
            player.attackState &&
            player.attackState.phase === 'active' &&
            !atk.projectileSpeed &&
            !player.attackState.hasHit
          ) {
            const box = player.attackState.key === 'spinKick'
              ? getSpinKickBox(player, atk)
              : getMeleeHitbox(player, atk);
            const oppBox = getHurtbox(opponent);
            if (aabbOverlap(box, oppBox)) {
              player.attackState.hasHit = true;
              const dirSign = player.attackState.key === 'spinKick'
                ? (Math.sign(opponent.x - player.x) || player.facing || 1)
                : player.facing;
              this.applyDamage(
                player.id,
                opponent,
                dealAtk.damage,
                dirSign,
                dealAtk.knockback || 160,
                dealAtk.knockbackVY || 0,
                player.attackState.key === 'special'
              );
            }
          }

          if (finished && player.attackState) {
            player.attackState = null;
          }
        }
      }
    }

    this._tickProjectiles(dtMs);
    this._tickBombs(dtMs);
    this._tickPlatforms(dtMs);
    this._tickStageEvent(dtMs);

    if (this.phase === 'playing' && this.timeRemaining <= 0) {
      const [a, b] = this.players;
      let winnerId = null;
      if (a.health > b.health) winnerId = a.id;
      else if (b.health > a.health) winnerId = b.id;
      this._endRound(winnerId);
    }
  }

  // Ground smash has its own startup/falling/recovery machine — `falling`
  // has no fixed duration (it ends whenever physics.js sets grounded=true),
  // so it can't go through the generic advanceAttackState timer.
  _advanceGroundSmash(player, opponent, atk, dtMs) {
    const state = player.attackState;
    state.elapsedMs += dtMs;

    if (state.phase === 'startup') {
      if (state.elapsedMs >= atk.startupMs) {
        state.phase = 'falling';
        state.elapsedMs = 0;
      }
    } else if (state.phase === 'falling') {
      if (player.grounded) {
        const landingSurfaceY = GROUND_Y - player.jumpY;
        const box = getGroundSmashBox(player.x, landingSurfaceY, atk.aoeRadius);
        if (aabbOverlap(box, getHurtbox(opponent))) {
          const dirSign = Math.sign(opponent.x - player.x) || player.facing || 1;
          this.applyDamage(player.id, opponent, atk.damage, dirSign, atk.knockback);
        }
        if (player.attackState) {
          state.phase = 'recovery';
          state.elapsedMs = 0;
        }
      }
    } else if (state.phase === 'recovery') {
      if (state.elapsedMs >= atk.recoveryMs) {
        player.attackState = null;
      }
    }
  }

  // Throw has its own startup/active/recovery machine (like groundSmash)
  // because its 'active' phase repositions the opponent every tick, and its
  // hit resolution is a one-time proximity check at the startup->active
  // transition rather than a continuous AABB overlap test.
  _advanceThrow(player, opponent, atk, dtMs) {
    const state = player.attackState;
    state.elapsedMs += dtMs;

    if (state.phase === 'startup') {
      if (state.elapsedMs >= atk.startupMs) {
        const dist = Math.abs(opponent.x - player.x);
        if (dist <= atk.grabRange * CHARACTER_SCALE && opponent.grabbedBy === null) {
          opponent.grabbedBy = player.id;
          opponent.attackState = null;
          opponent.dashVX = 0;
          opponent.knockbackVX = 0;
          opponent.knockbackVY = 0;
          state.phase = 'active';
        } else {
          state.phase = 'recovery'; // whiffed — opponent was out of range
        }
        state.elapsedMs = 0;
      }
    } else if (state.phase === 'active') {
      const holdOffset = PLAYER_WIDTH * 1.1;
      opponent.x = Math.min(MAX_X, Math.max(MIN_X, player.x + player.facing * holdOffset));
      opponent.jumpY = 0;
      opponent.vy = 0;
      opponent.grounded = true;
      opponent.standingOn = null;

      if (state.elapsedMs >= atk.activeMs) {
        opponent.grabbedBy = null;
        this.applyDamage(player.id, opponent, atk.damage, player.facing, atk.knockback);
        state.phase = 'recovery';
        state.elapsedMs = 0;
      }
    } else if (state.phase === 'recovery') {
      if (state.elapsedMs >= atk.recoveryMs) {
        player.attackState = null;
      }
    }
  }

  _tickProjectiles(dtMs) {
    const remaining = [];
    for (const proj of this.projectiles) {
      advanceProjectile(proj, dtMs);

      if (proj.delayMs <= 0) {
        const target = this.getOpponent(proj.ownerId);
        const box = projectileBox(proj);
        const targetBox = getHurtbox(target);
        if (aabbOverlap(box, targetBox)) {
          this.applyDamage(proj.ownerId, target, proj.damage, Math.sign(proj.vx) || 1, proj.knockback, 0, proj.attackKey === 'special');
          continue; // consumed on hit
        }
        // Radial projectiles travel vertically too, so cull on both axes —
        // otherwise the up/down ones linger forever off-screen.
        if (
          proj.lifeMs <= 0 ||
          proj.x < -50 || proj.x > ARENA_WIDTH + 50 ||
          proj.y < -50 || proj.y > ARENA_HEIGHT + 50
        ) {
          continue; // expired / off-arena
        }
      }
      remaining.push(proj);
    }
    this.projectiles = remaining;
  }

  serialize() {
    return {
      phase: this.phase,
      stageId: this.stageId,
      timeRemaining: Math.max(0, Math.ceil(this.timeRemaining)),
      winnerId: this.winnerId,
      endReason: this.endReason ?? null,
      groundY: GROUND_Y,
      players: this.players.map((p) => ({
        id: p.id,
        characterId: p.characterId,
        x: p.x,
        jumpY: p.jumpY,
        facing: p.facing,
        health: p.health,
        mana: p.mana,
        maxMana: getCharacter(p.characterId)?.maxMana ?? 0,
        crouching: p.crouching,
        sprinting: p.sprinting,
        grounded: p.grounded,
        grabbedBy: p.grabbedBy,
        hurt: p.hurtMs > 0,
        attack: p.attackState
          ? { key: p.attackState.key, phase: p.attackState.phase, chargeFraction: p.attackState.chargeFraction || 0 }
          : null,
        rematchReady: p.rematchReady,
        score: p.score,
        comboCount: p.comboCount,
        lastHitPoints: p.lastHitPoints,
        specialCharge: p.specialCharge,
        effects: { ...p.effects },
        sizeScale: p.sizeScale,
        bigStacks: p.bigStacks,
        powerMultiplier: powerMultiplierFor(p),
        idleMs: p.idleMs || 0,
        lastFartAt: p.lastFartAt || 0,
        lastMisfireAt: p.lastMisfireAt || 0,
      })),
      projectiles: this.projectiles
        .filter((p) => p.delayMs <= 0)
        // vx/vy go out so the client can orient direction-dependent art
        // (the goon-juice droplets point along their travel).
        .map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          ownerId: p.ownerId,
          kind: p.attackKey,
          vx: p.vx,
          vy: p.vy || 0,
        })),
      bombs: this.bombs.map((b) => ({ id: b.id, x: b.x, jumpY: b.jumpY, targetId: b.targetId })),
      stageEvent: this.stageEvent
        ? {
            kind: this.stageEvent.kind,
            phase: this.stageEvent.phase,
            x: this.stageEvent.x,
            planeX: this.stageEvent.planeX,
            planeY: this.stageEvent.planeY,
            politicianX: this.stageEvent.politicianX,
            starX: this.stageEvent.starX,
            starY: this.stageEvent.starY,
            chaseTargetId: this.stageEvent.chaseTargetId,
            timerMs: this.stageEvent.timerMs,
          }
        : null,
      // Cowardly platforms move, so the client can no longer draw them from
      // the static layout — it has to render whatever the server says.
      platforms: this.platforms.map((p) => ({
        id: p.id,
        x1: p.x1,
        x2: p.x2,
        height: p.height,
        cowardly: p.cowardly,
      })),
    };
  }
}
