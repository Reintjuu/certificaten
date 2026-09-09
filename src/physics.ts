// The per-frame rules of the world: how the player accelerates, jumps, falls,
// lands, and what happens when it meets an enemy. Everything here works on
// plain entities, knows nothing about phases, dialogue or levels beyond their
// platforms, and never touches the DOM.
import { ENEMY_SIZE, PLAYER_SIZE } from "./level-builders"
import type { EnemyDef, Level } from "./levels"

export const CANVAS_W = 480
export const CANVAS_H = 270

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
const SUBPIXEL = 1 / 16 // one X_Speed unit
const SUBFORCE = 1 / 256 // one vertical force unit
const HORIZONTAL_ADDER = 1 / (256 * 16)

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

  // Ours, not the ROM's: this game has no scrolling camera or score, so these
  // have no original to be faithful to.
  squashDuration: 20,
  deathFallMargin: 60,
  playerW: PLAYER_SIZE.w,
  playerH: PLAYER_SIZE.h,
  enemyW: ENEMY_SIZE.w,
  enemyH: ENEMY_SIZE.h,
} as const

export type Direction = -1 | 0 | 1

export type Player = {
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  grounded: boolean
  facing: 1 | -1
  animTimer: number
  animFrame: 0 | 1
  /** RunningTimer: keeps run status for a few frames after letting go of B. */
  runningTimer: number
  /** Which row of the jump tables this jump took off with. */
  jumpIndex: number
  /** JumpOrigin_Y_Position: where the current jump started, for the cut grace. */
  jumpOriginY: number
}

export type Enemy = {
  x: number
  y: number
  w: number
  h: number
  vx: number
  patrolMin: number
  patrolMax: number
  alive: boolean
  squashTimer: number
}

export type Input = {
  left: boolean
  right: boolean
  jumpHeld: boolean
  jumpPressed: boolean
  /** The B button: run rather than walk. */
  run: boolean
  confirmPressed: boolean
  resetPressed: boolean
}

export const NO_INPUT: Input = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  run: false,
  confirmPressed: false,
  resetPressed: false,
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function createPlayer(start: { x: number; y: number }): Player {
  return {
    x: start.x,
    y: start.y,
    w: PHYSICS.playerW,
    h: PHYSICS.playerH,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 1,
    animTimer: 0,
    animFrame: 0,
    runningTimer: 0,
    jumpIndex: 0,
    jumpOriginY: start.y,
  }
}

export function createEnemies(definitions: EnemyDef[]): Enemy[] {
  return definitions.map((definition) => ({
    x: definition.x,
    y: definition.y,
    w: PHYSICS.enemyW,
    h: PHYSICS.enemyH,
    vx: definition.vx,
    patrolMin: definition.patrolMin,
    patrolMax: definition.patrolMax,
    alive: true,
    squashTimer: 0,
  }))
}

/**
 * On the ground SMB1 asks whether you're holding B while pushing the way you
 * already move; in the air X_Physics ignores the button and only looks at how
 * fast you're already going.
 */
function isRunning(p: Player, input: Input, pushingAlong: boolean) {
  if (!p.grounded) return Math.abs(p.vx) >= PHYSICS.airRunningSpeedThreshold
  return pushingAlong && (input.run || p.runningTimer > 0)
}

/** FrictionData, doubled when pushing against the way you move: the skid. */
function frictionAdder(p: Player, dir: Direction, movingDir: Direction, running: boolean) {
  const base = running
    ? PHYSICS.accelRunning
    : Math.abs(p.vx) >= PHYSICS.fastSpeedThreshold
      ? PHYSICS.accelFastNotRunning
      : PHYSICS.accelWalking
  const turningAround = dir !== 0 && movingDir !== 0 && dir !== movingDir
  return turningAround ? base * PHYSICS.skidMultiplier : base
}

function updateRunningTimer(p: Player, input: Input, pushingAlong: boolean) {
  if (input.run && p.grounded && pushingAlong) p.runningTimer = PHYSICS.runningTimerFrames
  else if (p.runningTimer > 0) p.runningTimer--
}

/**
 * Ports ImposeFriction: a single adder both accelerates and brakes, so
 * letting go slows you at the same rate that holding a direction sped you up.
 */
export function applyHorizontalInput(p: Player, input: Input): Direction {
  const dir: Direction = input.right && !input.left ? 1 : input.left && !input.right ? -1 : 0
  // Player_MovingDir keeps the last direction travelled when standing still,
  // which is what lets you break into a run from a standstill.
  const movingDir: Direction = p.vx !== 0 ? (Math.sign(p.vx) as Direction) : p.facing
  const pushingAlong = dir !== 0 && dir === movingDir

  updateRunningTimer(p, input, pushingAlong)
  const running = isRunning(p, input, pushingAlong)
  const maxSpeed = running ? PHYSICS.maxRunSpeed : PHYSICS.maxWalkSpeed
  const adder = frictionAdder(p, dir, movingDir, running)

  if (dir !== 0) {
    p.vx = clamp(p.vx + dir * adder, -maxSpeed, maxSpeed)
    p.facing = dir
    return dir
  }

  if (p.vx !== 0) {
    const braked = p.vx - movingDir * adder
    p.vx = Math.sign(braked) === movingDir ? clamp(braked, -maxSpeed, maxSpeed) : 0
  }
  return 0
}

export function jumpIndexFor(speed: number): number {
  let index = 0
  while (index < PHYSICS.jumpSpeedThresholds.length && speed >= PHYSICS.jumpSpeedThresholds[index]) {
    index++
  }
  return index
}

export function applyJump(p: Player, input: Input) {
  // Jumping requires actually standing on something (SMB1 gates this on
  // Player_State == 0). There is deliberately no coyote time: the original
  // has none, and adding it would be the one obviously un-NES thing here.
  if (!input.jumpPressed || !p.grounded) return
  p.jumpIndex = jumpIndexFor(Math.abs(p.vx))
  p.vy = PHYSICS.jumpVelocity[p.jumpIndex]
  p.jumpOriginY = p.y
  p.grounded = false
}

/**
 * SMB1 varies jump height by *switching gravity*, not by cutting the upward
 * speed: let go of the button and JumpSwimSub swaps the gentle rising force
 * for the much heavier falling one. Letting go within the first pixel of the
 * jump doesn't count (DiffToHaltJump).
 */
export function applyGravity(p: Player, input: Input) {
  const risenFar = p.jumpOriginY - p.y >= PHYSICS.jumpCutGracePixels
  const stillBeingLifted = p.vy < 0 && (input.jumpHeld || !risenFar)
  p.vy += stillBeingLifted ? PHYSICS.gravityRising[p.jumpIndex] : PHYSICS.gravityFalling[p.jumpIndex]
  if (p.vy > PHYSICS.maxFallSpeed) p.vy = PHYSICS.maxFallSpeed
}

/** Lands the player on any platform whose surface it crossed this frame. */
export function resolvePlatformCollisions(p: Player, level: Level) {
  p.grounded = false
  for (const platform of level.platforms) {
    const horizontallyOver = p.x + p.w > platform.x && p.x < platform.x + platform.w
    const crossedSurface = p.y + p.h >= platform.y && p.y + p.h - p.vy <= platform.y
    if (p.vy >= 0 && horizontallyOver && crossedSurface) {
      p.y = platform.y - p.h
      p.vy = 0
      p.grounded = true
    }
  }
}

export function walkCycleFramesFor(speed: number): number {
  const row = PHYSICS.walkCycleThresholds.findIndex((threshold) => speed >= threshold)
  return PHYSICS.walkCycleFrames[row === -1 ? PHYSICS.walkCycleFrames.length - 1 : row]
}

export function updateAnimation(p: Player, dir: Direction) {
  if (!p.grounded) return
  if (dir === 0) {
    p.animTimer = 0
    p.animFrame = 0
    return
  }
  p.animTimer++
  if (p.animTimer >= walkCycleFramesFor(Math.abs(p.vx))) {
    p.animTimer = 0
    p.animFrame = p.animFrame === 0 ? 1 : 0
  }
}

export function moveEnemies(enemies: Enemy[]) {
  for (const enemy of enemies) {
    if (!enemy.alive) {
      if (enemy.squashTimer > 0) enemy.squashTimer--
      continue
    }
    enemy.x += enemy.vx
    if (enemy.x < enemy.patrolMin || enemy.x > enemy.patrolMax) enemy.vx *= -1
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
    if (!enemy.alive || !overlaps(p, enemy)) continue
    const cameFromAbove = fallVy > 0 && bottomBeforeFall <= enemy.y + enemy.h * 0.5
    if (!cameFromAbove) return true
    enemy.alive = false
    enemy.squashTimer = PHYSICS.squashDuration
    p.vy = PHYSICS.bounceVelocity
  }
  return false
}

/** Everything a single playing frame does to the world, in order. */
export function stepWorld(p: Player, enemies: Enemy[], level: Level, input: Input): { died: boolean } {
  const dir = applyHorizontalInput(p, input)
  applyJump(p, input)
  applyGravity(p, input)

  p.x += p.vx
  p.y += p.vy
  const fallVy = p.vy
  const bottomBeforeFall = p.y + p.h - fallVy

  resolvePlatformCollisions(p, level)
  p.x = clamp(p.x, 0, CANVAS_W - p.w)
  updateAnimation(p, dir)

  moveEnemies(enemies)
  const hitByEnemy = resolveEnemyCollisions(p, enemies, fallVy, bottomBeforeFall)
  const fellOut = p.y > CANVAS_H + PHYSICS.deathFallMargin
  return { died: hitByEnemy || fellOut }
}
