// The per-frame rules of the world: how the player accelerates, jumps, falls,
// lands, and what happens when it meets an enemy. Everything here works on
// plain entities, knows nothing about phases, dialogue or levels beyond their
// platforms, and never touches the DOM.
import { BLOCK_SIZE, ENEMY_SIZE, MUSHROOM_SIZE, PLAYER_SIZE, SMALL_PLAYER_SIZE } from "./level-builders";
import type { BlockDef, EnemyDef, Level, Rect } from "./levels";

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
   * you're already going at least $19. That is the whole difference between
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

  /**
   * A stomped goomba bounces you with $fc. Its ID ($06) is below $09, so
   * EnemyStomped sends it through ChkForDemoteKoopa into HandleStompedShellE,
   * which falls through to SBnce. The $fd on the EnemyStompedPts path belongs
   * to bloobers, cheep-cheeps, bullet bills, hammer bros and lakitus.
   */
  bounceVelocity: 0xfc - 0x100,

  /** PlayerAnimTmrData: frames per step of the walk cycle, fastest first. */
  walkCycleFrames: [0x02, 0x04, 0x07],
  /** GetPlayerAnimSpeed picks that row at these speeds. */
  walkCycleThresholds: [0x1c, 0x0e].map((v) => v * SUBPIXEL),

  /** MoveNormalEnemy: normal enemies walk at $f8 and never turn at a ledge. */
  enemyWalkSpeed: 0x08 * SUBPIXEL,
  /** KickedShellXSpdData: a kicked shell runs at $30, six times a walk. */
  shellSpeed: 0x30 * SUBPIXEL,
  /** RevivalRateData: a stomped koopa gets back up after this many framerules. */
  shellRevivalFramerules: 0x10,
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

  /** BlockBounceTimer: how long a bumped block rides up and drops back. */
  blockBounceFrames: 0x10,
  /** BumpBlock: the block itself leaves at $fe, so two pixels a frame. */
  blockBounceVelocity: 0xfe - 0x100,
  /**
   * BumpBlock zeroes Player_Y_Speed when you knock a solid block, so you stop
   * dead under it. BrickShatter leaves $fe instead: a broken brick lets you
   * keep drifting up through the gap.
   */
  headBumpVelocity: 0,
  shatterVelocity: 0xfe - 0x100,
  /** JCoinC: the coin that pops out leaves at $fb and falls back. */
  coinPopVelocity: 0xfb - 0x100,

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
  /**
   * StompTimer. While it runs, any enemy you touch is stomped rather than
   * dangerous, which is what lets you bounce through a row of them. It sits
   * at $0791, inside the frame timers, so it ticks down every frame and not
   * once per framerule.
   */
  stompTimer: number;
};

export const EnemyKind = { Goomba: "goomba", Koopa: "koopa" } as const;
export type EnemyKind = (typeof EnemyKind)[keyof typeof EnemyKind];

/**
 * What an enemy is doing, which used to be a boolean and a timer between them.
 * A koopa needs four of these, so the machine is written out rather than
 * implied: walking, a shell sitting still, that shell sliding after a kick,
 * and the flattened goomba on its way out.
 */
export const EnemyState = {
  Walking: "walking",
  Squashed: "squashed",
  Shell: "shell",
  Sliding: "sliding",
  Gone: "gone",
} as const;
export type EnemyState = (typeof EnemyState)[keyof typeof EnemyState];

export type Enemy = {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  kind: EnemyKind;
  state: EnemyState;
  /** Which way it is pointed, which a motionless shell keeps from before. */
  facing: Facing;
  /** Enemies stay dormant until the camera brings them into view. */
  awake: boolean;
  /** Counted in framerules, like SMB1's EnemyIntervalTimer. */
  squashTimer: number;
};

/** Anything that can still hurt you, or be hurt. */
export function isActive(enemy: Enemy): boolean {
  return enemy.state === EnemyState.Walking || enemy.state === EnemyState.Sliding;
}

/** Anything still on screen, including a shell and a fading goomba. */
export function isVisible(enemy: Enemy): boolean {
  return enemy.state !== EnemyState.Gone;
}

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
    stompTimer: 0,
  };
}

/** Height depends on size, and crouching makes big Mario small again. */
function playerHeightOf(player: { big: boolean; crouching: boolean }): number {
  return player.big && !player.crouching ? PHYSICS.playerH : PHYSICS.playerSmallH;
}

/** Resizes around the feet, so growing lifts the head rather than sinking. */
function resizePlayer(p: Player): void {
  const height = playerHeightOf(p);
  if (height === p.h) {
    return;
  }
  p.y += p.h - height;
  p.h = height;
}

export const BlockKind = { Brick: "brick", Question: "question" } as const;
export type BlockKind = (typeof BlockKind)[keyof typeof BlockKind];

/** What comes out of a block, which is nothing once it has been had. */
export const BlockContents = { Nothing: "nothing", Coin: "coin", Mushroom: "mushroom" } as const;
export type BlockContents = (typeof BlockContents)[keyof typeof BlockContents];

export const BlockState = { Idle: "idle", Bumping: "bumping", Broken: "broken" } as const;
export type BlockState = (typeof BlockState)[keyof typeof BlockState];

export type Block = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BlockKind;
  contains: BlockContents;
  state: BlockState;
  /** Counts BlockBounceTimer down, and with it the coin popping out. */
  bounceTimer: number;
  /** What the bounce is showing on its way up, for the frames it lasts. */
  releasing: BlockContents;
};

export function createBlocks(definitions: BlockDef[]): Block[] {
  return definitions.map((definition) => ({
    x: definition.x,
    y: definition.y,
    w: BLOCK_SIZE.w,
    h: BLOCK_SIZE.h,
    kind: definition.kind,
    contains: definition.contains,
    state: BlockState.Idle,
    bounceTimer: 0,
    releasing: BlockContents.Nothing,
  }));
}

/** Solid until it is rubble: a broken brick is a hole you can jump through. */
export function isSolid(block: Block): boolean {
  return block.state !== BlockState.Broken;
}

/**
 * Everything with a surface you can stand on. The physics lands on this list
 * and the agent's terrain probes read it, so what the agent believes is ground
 * is by construction what actually holds it up.
 */
export function surfacesOf(level: Level, blocks: Block[]): Rect[] {
  return [...level.platforms, ...blocks.filter(isSolid)];
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
function moveMushrooms(mushrooms: Mushroom[], level: Level, cameraX: number, blocks: Block[]): void {
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
    landOnPlatform(mushroom, level, blocks);
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
    w: ENEMY_SIZE.w,
    h: ENEMY_SIZE.h,
    vx: PHYSICS.enemyWalkSpeed * definition.facing,
    vy: 0,
    kind: definition.kind ?? EnemyKind.Goomba,
    state: EnemyState.Walking,
    facing: definition.facing,
    awake: false,
    squashTimer: 0,
  }));
}

/** Drops a box onto any platform surface it crossed this frame. */
function landOnPlatform(
  box: { x: number; y: number; w: number; h: number; vy: number },
  level: Level,
  blocks: Block[] = []
): boolean {
  for (const surface of surfacesOf(level, blocks)) {
    const horizontallyOver = box.x + box.w > surface.x && box.x < surface.x + surface.w;
    const crossedSurface = box.y + box.h >= surface.y && box.y + box.h - box.vy <= surface.y;
    if (box.vy >= 0 && horizontallyOver && crossedSurface) {
      box.y = surface.y - box.h;
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

/** Lands the player on any surface it crossed this frame, blocks included. */
export function resolvePlatformCollisions(p: Player, level: Level, blocks: Block[] = []): void {
  p.grounded = landOnPlatform(p, level, blocks);
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
export function moveEnemies(
  enemies: Enemy[],
  level: Level,
  cameraX: number,
  framerule: boolean,
  blocks: Block[] = []
): void {
  for (const enemy of enemies) {
    if (enemy.state === EnemyState.Gone) {
      continue;
    }
    if (enemy.state === EnemyState.Squashed || enemy.state === EnemyState.Shell) {
      if (framerule && enemy.squashTimer > 0) {
        enemy.squashTimer--;
      }
      if (enemy.squashTimer === 0) {
        // A flattened goomba is finished; a koopa climbs back into its feet
        // and carries on the way it was going.
        if (enemy.kind === EnemyKind.Koopa) {
          enemy.state = EnemyState.Walking;
          send(enemy, enemy.facing, PHYSICS.enemyWalkSpeed);
        } else {
          enemy.state = EnemyState.Gone;
        }
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
    landOnPlatform(enemy, level, blocks);

    // The level's outer walls are the only thing that turns them around.
    if (enemy.x < 0) {
      send(enemy, Facing.Right, Math.abs(enemy.vx));
    }
    if (enemy.x + enemy.w > level.width) {
      send(enemy, Facing.Left, Math.abs(enemy.vx));
    }
    if (enemy.y > CANVAS_H + PHYSICS.deathFallMargin) {
      enemy.state = EnemyState.Gone;
    }
  }
  runDownAnythingInTheWay(enemies);
}

/** Direction and speed are set together, so the two can never disagree. */
function send(enemy: Enemy, facing: Facing, speed: number): void {
  enemy.facing = facing;
  enemy.vx = speed * facing;
}

/** A sliding shell clears out whatever it catches, as it does in the ROM. */
function runDownAnythingInTheWay(enemies: Enemy[]): void {
  for (const shell of enemies) {
    if (shell.state !== EnemyState.Sliding) {
      continue;
    }
    for (const other of enemies) {
      if (other !== shell && isActive(other) && overlaps(shell, other)) {
        other.state = EnemyState.Gone;
      }
    }
  }
}

/**
 * Returns true if the player died. `fallVy` and `bottomBeforeFall` are taken
 * from before platform collision ran, so landing on a platform (which zeroes
 * vy and snaps y) can't hide that we were also dropping onto an enemy.
 */
/**
 * ChkForPlayerInjury decides this on Player_Y_Speed alone for a goomba: if you
 * are on the way down you stomp, full stop. The comparison of positions that
 * follows it only applies to enemies with an ID of at least Bloober ($07), and
 * a goomba is $06. An extra height test here used to turn perfectly good
 * stomps into injuries.
 *
 * `wasFalling` is that Y_Speed, translated. Our gravity is applied and then
 * undone by the platform snap every frame, so a walking player technically has
 * a downward speed; the ROM simply holds Player_Y_Speed at zero while standing,
 * and being airborne at the start of the frame is what expresses that here.
 */
export function resolveEnemyCollisions(p: Player, enemies: Enemy[], wasFalling: boolean): boolean {
  for (const enemy of enemies) {
    if (!overlaps(p, enemy)) {
      continue;
    }

    // A shell sitting still is not a threat, it is a thing to kick. Which way
    // it goes is decided by which side of it you are on.
    if (enemy.state === EnemyState.Shell) {
      enemy.state = EnemyState.Sliding;
      // EnemyFacePlayer: it leaves in whichever direction you are not.
      send(enemy, p.x + p.w / 2 < enemy.x + enemy.w / 2 ? Facing.Right : Facing.Left, PHYSICS.shellSpeed);
      enemy.squashTimer = 0;
      if (wasFalling) {
        p.vy = PHYSICS.bounceVelocity;
      }
      continue;
    }
    if (!isActive(enemy)) {
      continue;
    }

    // ChkETmrs: a stomp already landed this frame makes the next one a stomp
    // too, which is why two enemies at once cannot cost you your size.
    if (wasFalling || p.stompTimer > 0) {
      stomp(enemy);
      p.vy = PHYSICS.bounceVelocity;
      p.stompTimer++;
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

/** What landing on one does, which is where a koopa differs from a goomba. */
function stomp(enemy: Enemy): void {
  if (enemy.kind === EnemyKind.Koopa) {
    // A sliding shell stops dead; a walking koopa becomes that shell.
    enemy.state = EnemyState.Shell;
    enemy.vx = 0;
    enemy.squashTimer = PHYSICS.shellRevivalFramerules;
    return;
  }
  enemy.state = EnemyState.Squashed;
  enemy.vx = 0;
  enemy.squashTimer = PHYSICS.squashFramerules;
}

function collectMushrooms(p: Player, mushrooms: Mushroom[]): void {
  for (const mushroom of mushrooms) {
    if (mushroom.taken || !overlaps(p, mushroom)) {
      continue;
    }
    mushroom.taken = true;
    p.big = true;
    resizePlayer(p);
  }
}

/**
 * PlayerHeadCollision: coming up under a block stops you dead against it and
 * knocks it. Big Mario shatters a plain brick; small Mario only rattles it.
 * Whatever was inside comes out, and the stamp is credited the moment it
 * pops, exactly as GiveOneCoin does: the coin flying up is only animation.
 */
function bumpBlocks(p: Player, blocks: Block[], mushrooms: Mushroom[]): BlockContents {
  for (const block of blocks) {
    if (!isSolid(block)) {
      continue;
    }
    const underside = block.y + block.h;
    const horizontallyUnder = p.x + p.w > block.x && p.x < block.x + block.w;
    const crossedUnderside = p.y <= underside && p.y - p.vy >= underside;
    if (p.vy >= 0 || !horizontallyUnder || !crossedUnderside) {
      continue;
    }

    p.y = underside;
    const shatters = block.kind === BlockKind.Brick && block.contains === BlockContents.Nothing && p.big;
    p.vy = shatters ? PHYSICS.shatterVelocity : PHYSICS.headBumpVelocity;

    block.releasing = block.contains;
    block.contains = BlockContents.Nothing;
    block.bounceTimer = PHYSICS.blockBounceFrames;
    block.state = shatters ? BlockState.Broken : BlockState.Bumping;
    if (block.releasing === BlockContents.Mushroom) {
      mushrooms.push(...createMushrooms([{ x: block.x, y: block.y - MUSHROOM_SIZE.h }]));
    }
    return block.releasing;
  }
  return BlockContents.Nothing;
}

/** The bounce is a timer, and the coin popping out of it rides the same one. */
function settleBlocks(blocks: Block[]): void {
  for (const block of blocks) {
    if (block.bounceTimer > 0) {
      block.bounceTimer--;
      if (block.bounceTimer === 0 && block.state === BlockState.Bumping) {
        block.state = BlockState.Idle;
        block.releasing = BlockContents.Nothing;
      }
    }
  }
}

/** Everything a single playing frame does to the world, in order. */
export function stepWorld(
  p: Player,
  enemies: Enemy[],
  mushrooms: Mushroom[],
  blocks: Block[],
  level: Level,
  input: Input,
  view: { cameraX: number; framerule: boolean }
): { died: boolean; coins: number } {
  if (view.framerule && p.invincibleFramerules > 0) {
    p.invincibleFramerules--;
  }
  if (p.stompTimer > 0) {
    p.stompTimer--;
  }
  const wasAirborne = !p.grounded;
  p.crouching = p.big && p.grounded && input.down;
  resizePlayer(p);

  const dir = applyHorizontalInput(p, input);
  applyJump(p, input);
  applyGravity(p, input);

  p.x += p.vx;
  p.y += p.vy;
  const wasFalling = wasAirborne && p.vy > 0;

  // Age what happened before deciding what happens now, so a block knocked
  // this frame still has its whole bounce ahead of it.
  settleBlocks(blocks);
  const released = bumpBlocks(p, blocks, mushrooms);
  resolvePlatformCollisions(p, level, blocks);
  // SMB1 never scrolls back, so the left edge of the view is a wall.
  p.x = clamp(p.x, view.cameraX, level.width - p.w);
  updateAnimation(p, dir);

  moveEnemies(enemies, level, view.cameraX, view.framerule, blocks);
  moveMushrooms(mushrooms, level, view.cameraX, blocks);
  collectMushrooms(p, mushrooms);
  const hitByEnemy = resolveEnemyCollisions(p, enemies, wasFalling);
  const fellOut = p.y > CANVAS_H + PHYSICS.deathFallMargin;
  return {
    died: hitByEnemy || fellOut,
    coins: released === BlockContents.Coin ? 1 : 0,
  };
}
