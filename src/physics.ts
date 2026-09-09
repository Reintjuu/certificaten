// The per-frame rules of the world: how the player accelerates, jumps, falls,
// lands, and what happens when it meets an enemy. Everything here works on
// plain entities, knows nothing about phases, dialogue or levels beyond their
// platforms, and never touches the DOM.
import { ENEMY_SIZE, MUSHROOM_SIZE, PLAYER_SIZE, SMALL_PLAYER_SIZE } from "./level-builders";
import type { EnemyDef, Level } from "./levels";

export const CANVAS_W = 480;
export const CANVAS_H = 270;

// Constants taken from the Super Mario Bros. disassembly (smbdis.asm), with
// the raw ROM values kept alongside so they can be checked against the source.
//
// Units, as derived from the movement routines:
//  - MoveObjectHorizontally shifts X_Speed's low nybble into the fraction, so
//    one X_Speed unit is 1/16 of a pixel per frame.
//  - ImposeGravity adds Y_Speed straight to Y_Position, so Y_Speed is whole
//    pixels per frame, and the "force" bytes are 1/256 of a pixel per frame^2.
//  - The horizontal adder accumulates into a 1/256 subspeed before carrying
//    into X_Speed, so an adder of N means N/(256*16) pixels per frame^2.
const SUBPIXEL = 1 / 16; // one X_Speed unit
const SUBFORCE = 1 / 256; // one vertical force unit
const HORIZONTAL_ADDER = 1 / (256 * 16);

export const PHYSICS = {
  /** MaxRightXSpdData: $18 walking, $28 running. */
  maxWalkSpeed: 0x18 * SUBPIXEL,
  maxRunSpeed: 0x28 * SUBPIXEL,
  /** FrictionData $e4/$98/$d0. The same adder accelerates and decelerates. */
  accelRunning: 0xe4 * HORIZONTAL_ADDER,
  accelWalking: 0x98 * HORIZONTAL_ADDER,
  accelFastNotRunning: 0xd0 * HORIZONTAL_ADDER,
  /** Above $21 the game switches to the third friction value. */
  fastSpeedThreshold: 0x21 * SUBPIXEL,
  /**
   * In the air X_Physics ignores the button entirely and only asks whether
   * you're already going at least $19 -- that is the whole difference between
   * steering on the ground and steering mid-jump.
   */
  airRunningSpeedThreshold: 0x19 * SUBPIXEL,
  /** Turning around doubles the adder (asl FrictionAdderLow). */
  skidMultiplier: 2,
  /** SetRTmr: holding B while moving sets RunningTimer to $0a frames. */
  runningTimerFrames: 0x0a,

  /** Jump tables, indexed by horizontal speed at take-off. */
  jumpSpeedThresholds: [0x09, 0x10, 0x19, 0x1c].map((v) => v * SUBPIXEL),
  /** PlayerYSpdData: faster run-ups launch harder. */
  jumpVelocity: [0xfc, 0xfc, 0xfc, 0xfb, 0xfb].map((v) => v - 0x100),
  /** JumpMForceData: gravity while rising with the button held. */
  gravityRising: [0x20, 0x20, 0x1e, 0x28, 0x28].map((v) => v * SUBFORCE),
  /** FallMForceData: gravity while falling, or after letting go. */
  gravityFalling: [0x70, 0x70, 0x60, 0x90, 0x90].map((v) => v * SUBFORCE),
  /** MovePlayerVertically caps the fall at $04. */
  maxFallSpeed: 0x04,
  /** DiffToHaltJump: letting go within the first pixel doesn't cut the jump. */
  jumpCutGracePixels: 1,

  /** EnemyStomped: a flat $fd, with no dependence on holding the button. */
  bounceVelocity: 0xfd - 0x100,

  /** PlayerAnimTmrData: frames per step of the walk cycle, fastest first. */
  walkCycleFrames: [0x02, 0x04, 0x07],
  /** GetPlayerAnimSpeed picks that row at these speeds. */
  walkCycleThresholds: [0x1c, 0x0e].map((v) => v * SUBPIXEL),

  /** MoveNormalEnemy: normal enemies walk at $f8 and never turn at a ledge. */
  enemyWalkSpeed: 0x08 * SUBPIXEL,
  /** MoveD_EnemyVertically / SetHiMax: enemy gravity and its fall cap. */
  enemyGravity: 0x3d * SUBFORCE,
  enemyMaxFallSpeed: 0x03,
  /** IntervalTimerControl reloads with $14, so the cycle is 21 frames. */
  frameruleFrames: 0x14 + 1,
  /** GameTimerCtrlTimer reloads with $18: one unit of level time per 24 frames. */
  gameTimerFrames: 0x18,
  /** EnemyIntervalTimer counts framerules, not frames. */
  squashFramerules: 1,
  /** ForceInjury sets InjuryTimer to $08, and that is an interval timer. */
  injuryFramerules: 0x08,
  /** Mushrooms move like a normal enemy. */
  mushroomWalkSpeed: 0x08 * SUBPIXEL,

  playerSmallH: SMALL_PLAYER_SIZE.h,
  mushroomW: MUSHROOM_SIZE.w,
  mushroomH: MUSHROOM_SIZE.h,

  // Ours, not the ROM's.
  deathFallMargin: 60,
  playerW: PLAYER_SIZE.w,
  playerH: PLAYER_SIZE.h,
  enemyW: ENEMY_SIZE.w,
  enemyH: ENEMY_SIZE.h,
} as const;

/**
 * Written as a const object rather than a TypeScript `enum`: the values stay
 * plain numbers, so they survive JSON and arithmetic untouched, while the call
 * sites read as names.
 */
export const Direction = { Left: -1, None: 0, Right: 1 } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const Facing = { Left: Direction.Left, Right: Direction.Right } as const;
export type Facing = (typeof Facing)[keyof typeof Facing];

export type Player = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: Facing;
  animTimer: number;
  animFrame: 0 | 1;
  /** RunningTimer: keeps run status for a few frames after letting go of B. */
  runningTimer: number;
  /** Which row of the jump tables this jump took off with. */
  jumpIndex: number;
  /** JumpOrigin_Y_Position: where the current jump started, for the cut grace. */
  jumpOriginY: number;
  /** PlayerStatus: a mushroom makes you big, a hit makes you small again. */
  big: boolean;
  crouching: boolean;
  /** InjuryTimer, counted in framerules like the ROM's. */
  invincibleFramerules: number;
};

export type Enemy = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  alive: boolean;
  /** Enemies stay dormant until the camera brings them into view. */
  awake: boolean;
  /** Counted in framerules, like SMB1's EnemyIntervalTimer. */
  squashTimer: number;
};

export type Input = {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  /** The B button: run rather than walk. */
  run: boolean;
  /** Down on the pad: crouch, which only big Mario can do. */
  down: boolean;
  confirmPressed: boolean;
  resetPressed: boolean;
};

export const NO_INPUT: Input = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  run: false,
  down: false,
  confirmPressed: false,
  resetPressed: false,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function createPlayer(start: { x: number; y: number }): Player {
  return {
    x: start.x,
    y: start.y,
    w: PHYSICS.playerW,
    // Everyone starts small; a mushroom is what makes the box taller.
    h: PHYSICS.playerSmallH,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: Facing.Right,
    animTimer: 0,
    animFrame: 0,
    runningTimer: 0,
    jumpIndex: 0,
    jumpOriginY: start.y,
    big: false,
    crouching: false,
    invincibleFramerules: 0,
  };
}

/** Height depends on size, and crouching makes big Mario small again. */
export function playerHeightOf(player: { big: boolean; crouching: boolean }): number {
  return player.big && !player.crouching ? PHYSICS.playerH : PHYSICS.playerSmallH;
}

/** Resizes around the feet, so growing lifts the head rather than sinking. */
export function resizePlayer(p: Player): void {
  const height = playerHeightOf(p);
  if (height === p.h) {
    return;
  }
  p.y += p.h - height;
  p.h = height;
}

export type Mushroom = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  taken: boolean;
  awake: boolean;
};

export function createMushrooms(definitions: { x: number; y: number }[]): Mushroom[] {
  return definitions.map((definition) => ({
    x: definition.x,
    y: definition.y,
    w: PHYSICS.mushroomW,
    h: PHYSICS.mushroomH,
    vx: PHYSICS.mushroomWalkSpeed,
    vy: 0,
    taken: false,
    awake: false,
  }));
}

/** Mushrooms walk and fall exactly like the enemies do. */
export function moveMushrooms(mushrooms: Mushroom[], level: Level, cameraX: number): void {
  for (const mushroom of mushrooms) {
    if (mushroom.taken) {
      continue;
    }
    if (!mushroom.awake) {
      if (mushroom.x > cameraX + CANVAS_W) {
        continue;
      }
      mushroom.awake = true;
    }
    mushroom.x += mushroom.vx;
    mushroom.vy = Math.min(mushroom.vy + PHYSICS.enemyGravity, PHYSICS.enemyMaxFallSpeed);
    mushroom.y += mushroom.vy;
    landOnPlatform(mushroom, level);
    if (mushroom.x < 0) {
      mushroom.vx = Math.abs(mushroom.vx);
    }
    if (mushroom.x + mushroom.w > level.width) {
      mushroom.vx = -Math.abs(mushroom.vx);
    }
    if (mushroom.y > CANVAS_H + PHYSICS.deathFallMargin) {
      mushroom.taken = true;
    }
  }
}

export function createEnemies(definitions: EnemyDef[]): Enemy[] {
  return definitions.map((definition) => ({
    x: definition.x,
    y: definition.y,
    w: PHYSICS.enemyW,
    h: PHYSICS.enemyH,
    vx: definition.facing * PHYSICS.enemyWalkSpeed,
    vy: 0,
    alive: true,
    awake: false,
    squashTimer: 0,
  }));
}

/** Drops a box onto any platform surface it crossed this frame. */
function landOnPlatform(
  box: { x: number; y: number; w: number; h: number; vy: number },
  level: Level
): boolean {
  for (const platform of level.platforms) {
    const horizontallyOver = box.x + box.w > platform.x && box.x < platform.x + platform.w;
    const crossedSurface = box.y + box.h >= platform.y && box.y + box.h - box.vy <= platform.y;
    if (box.vy >= 0 && horizontallyOver && crossedSurface) {
      box.y = platform.y - box.h;
      box.vy = 0;
      return true;
    }
  }
  return false;
}

/**
 * On the ground SMB1 asks whether you're holding B while pushing the way you
 * already move; in the air X_Physics ignores the button and only looks at how
 * fast you're already going.
 */
function isRunning(p: Player, input: Input, pushingAlong: boolean): boolean {
  if (!p.grounded) {
    return Math.abs(p.vx) >= PHYSICS.airRunningSpeedThreshold;
  }
  return pushingAlong && (input.run || p.runningTimer > 0);
}

/** FrictionData, doubled when pushing against the way you move: the skid. */
function frictionAdder(p: Player, dir: Direction, movingDir: Direction, running: boolean): number {
  const base = running
    ? PHYSICS.accelRunning
    : Math.abs(p.vx) >= PHYSICS.fastSpeedThreshold
      ? PHYSICS.accelFastNotRunning
      : PHYSICS.accelWalking;
  const turningAround = dir !== Direction.None && movingDir !== Direction.None && dir !== movingDir;
  return turningAround ? base * PHYSICS.skidMultiplier : base;
}

function updateRunningTimer(p: Player, input: Input, pushingAlong: boolean): void {
  if (input.run && p.grounded && pushingAlong) {
    p.runningTimer = PHYSICS.runningTimerFrames;
  } else if (p.runningTimer > 0) {
    p.runningTimer--;
  }
}

/**
 * Ports ImposeFriction: a single adder both accelerates and brakes, so
 * letting go slows you at the same rate that holding a direction sped you up.
 */
export function applyHorizontalInput(p: Player, input: Input): Direction {
  const pressed: Direction =
    input.right && !input.left
      ? Direction.Right
      : input.left && !input.right
        ? Direction.Left
        : Direction.None;
  if (pressed !== Direction.None) {
    p.facing = pressed;
  }
  // Crouching big Mario keeps his momentum but can't walk.
  const dir: Direction = p.crouching ? Direction.None : pressed;
  // Player_MovingDir keeps the last direction travelled when standing still,
  // which is what lets you break into a run from a standstill. Approximation:
  // the ROM flips it to the facing direction once a skid drops below $0b
  // (ProcSkid), where this waits for the speed to actually cross zero. The
  // difference lasts a fraction of a second at under 0.7px per frame.
  const movingDir: Direction = p.vx !== 0 ? (Math.sign(p.vx) as Direction) : p.facing;
  const pushingAlong = dir !== Direction.None && dir === movingDir;

  updateRunningTimer(p, input, pushingAlong);
  const running = isRunning(p, input, pushingAlong);
  const maxSpeed = running ? PHYSICS.maxRunSpeed : PHYSICS.maxWalkSpeed;
  const adder = frictionAdder(p, dir, movingDir, running);

  if (dir !== Direction.None) {
    p.vx = clamp(p.vx + dir * adder, -maxSpeed, maxSpeed);
    p.facing = dir;
    return dir;
  }

  // In the air with nothing held, SMB1 skips friction entirely (LRAir only
  // calls ImposeFriction when a direction is pressed), so a jump keeps all of
  // its horizontal speed. Only the ground brakes you.
  if (p.grounded && p.vx !== 0) {
    const braked = p.vx - movingDir * adder;
    p.vx = Math.sign(braked) === movingDir ? clamp(braked, -maxSpeed, maxSpeed) : 0;
  }
  return Direction.None;
}

export function jumpIndexFor(speed: number): number {
  let index = 0;
  while (index < PHYSICS.jumpSpeedThresholds.length && speed >= PHYSICS.jumpSpeedThresholds[index]) {
    index++;
  }
  return index;
}

export function applyJump(p: Player, input: Input): void {
  // Jumping requires actually standing on something (SMB1 gates this on
  // Player_State == 0). There is deliberately no coyote time: the original
  // has none, and adding it would be the one obviously un-NES thing here.
  if (!input.jumpPressed || !p.grounded) {
    return;
  }
  p.jumpIndex = jumpIndexFor(Math.abs(p.vx));
  p.vy = PHYSICS.jumpVelocity[p.jumpIndex];
  p.jumpOriginY = p.y;
  p.grounded = false;
}

/**
 * SMB1 varies jump height by *switching gravity*, not by cutting the upward
 * speed: let go of the button and JumpSwimSub swaps the gentle rising force
 * for the much heavier falling one. Letting go within the first pixel of the
 * jump doesn't count (DiffToHaltJump).
 */
export function applyGravity(p: Player, input: Input): void {
  const risenFar = p.jumpOriginY - p.y >= PHYSICS.jumpCutGracePixels;
  const stillBeingLifted = p.vy < 0 && (input.jumpHeld || !risenFar);
  p.vy += stillBeingLifted ? PHYSICS.gravityRising[p.jumpIndex] : PHYSICS.gravityFalling[p.jumpIndex];
  if (p.vy > PHYSICS.maxFallSpeed) {
    p.vy = PHYSICS.maxFallSpeed;
  }
}

/** Lands the player on any platform whose surface it crossed this frame. */
export function resolvePlatformCollisions(p: Player, level: Level): void {
  p.grounded = landOnPlatform(p, level);
}

export function walkCycleFramesFor(speed: number): number {
  const row = PHYSICS.walkCycleThresholds.findIndex((threshold) => speed >= threshold);
  return PHYSICS.walkCycleFrames[row === -1 ? PHYSICS.walkCycleFrames.length - 1 : row];
}

export function updateAnimation(p: Player, dir: Direction): void {
  if (!p.grounded) {
    return;
  }
  if (dir === Direction.None) {
    p.animTimer = 0;
    p.animFrame = 0;
    return;
  }
  p.animTimer++;
  if (p.animTimer >= walkCycleFramesFor(Math.abs(p.vx))) {
    p.animTimer = 0;
    p.animFrame = p.animFrame === 0 ? 1 : 0;
  }
}

/**
 * Enemies walk, fall and drop off ledges: SMB1's normal enemies only turn
 * around when something blocks them, never at an edge. They stay dormant
 * until the camera reaches them, the way the original spawns them from the
 * level data as it scrolls.
 */
export function moveEnemies(enemies: Enemy[], level: Level, cameraX: number, framerule: boolean): void {
  for (const enemy of enemies) {
    if (!enemy.alive) {
      if (framerule && enemy.squashTimer > 0) {
        enemy.squashTimer--;
      }
      continue;
    }
    if (!enemy.awake) {
      if (enemy.x > cameraX + CANVAS_W) {
        continue;
      }
      enemy.awake = true;
    }

    enemy.x += enemy.vx;
    enemy.vy = Math.min(enemy.vy + PHYSICS.enemyGravity, PHYSICS.enemyMaxFallSpeed);
    enemy.y += enemy.vy;
    landOnPlatform(enemy, level);

    // The level's outer walls are the only thing that turns them around.
    if (enemy.x < 0) {
      enemy.vx = Math.abs(enemy.vx);
    }
    if (enemy.x + enemy.w > level.width) {
      enemy.vx = -Math.abs(enemy.vx);
    }
    if (enemy.y > CANVAS_H + PHYSICS.deathFallMargin) {
      enemy.alive = false;
    }
  }
}

/**
 * Returns true if the player died. `fallVy` and `bottomBeforeFall` are taken
 * from before platform collision ran, so landing on a platform (which zeroes
 * vy and snaps y) can't hide that we were also dropping onto an enemy.
 */
export function resolveEnemyCollisions(
  p: Player,
  enemies: Enemy[],
  fallVy: number,
  bottomBeforeFall: number
): boolean {
  for (const enemy of enemies) {
    if (!enemy.alive || !overlaps(p, enemy)) {
      continue;
    }

    const cameFromAbove = fallVy > 0 && bottomBeforeFall <= enemy.y + enemy.h * 0.5;
    if (cameFromAbove) {
      enemy.alive = false;
      enemy.squashTimer = PHYSICS.squashFramerules;
      p.vy = PHYSICS.bounceVelocity;
      continue;
    }

    if (p.invincibleFramerules > 0) {
      continue;
    }
    // ForceInjury: being big costs you your size and buys a moment of
    // invincibility; being small is fatal.
    if (!p.big) {
      return true;
    }
    p.big = false;
    p.crouching = false;
    resizePlayer(p);
    p.invincibleFramerules = PHYSICS.injuryFramerules;
  }
  return false;
}

export function collectMushrooms(p: Player, mushrooms: Mushroom[]): void {
  for (const mushroom of mushrooms) {
    if (mushroom.taken || !overlaps(p, mushroom)) {
      continue;
    }
    mushroom.taken = true;
    p.big = true;
    resizePlayer(p);
  }
}

/** Everything a single playing frame does to the world, in order. */
export function stepWorld(
  p: Player,
  enemies: Enemy[],
  mushrooms: Mushroom[],
  level: Level,
  input: Input,
  view: { cameraX: number; framerule: boolean }
): { died: boolean } {
  if (view.framerule && p.invincibleFramerules > 0) {
    p.invincibleFramerules--;
  }
  p.crouching = p.big && p.grounded && input.down;
  resizePlayer(p);

  const dir = applyHorizontalInput(p, input);
  applyJump(p, input);
  applyGravity(p, input);

  p.x += p.vx;
  p.y += p.vy;
  const fallVy = p.vy;
  const bottomBeforeFall = p.y + p.h - fallVy;

  resolvePlatformCollisions(p, level);
  // SMB1 never scrolls back, so the left edge of the view is a wall.
  p.x = clamp(p.x, view.cameraX, level.width - p.w);
  updateAnimation(p, dir);

  moveEnemies(enemies, level, view.cameraX, view.framerule);
  moveMushrooms(mushrooms, level, view.cameraX);
  collectMushrooms(p, mushrooms);
  const hitByEnemy = resolveEnemyCollisions(p, enemies, fallVy, bottomBeforeFall);
  const fellOut = p.y > CANVAS_H + PHYSICS.deathFallMargin;
  return { died: hitByEnemy || fellOut };
}
