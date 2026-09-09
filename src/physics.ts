// The per-frame rules of the world: how the player accelerates, jumps, falls,
// lands, and what happens when it meets an enemy. Everything here works on
// plain entities, knows nothing about phases, dialogue or levels beyond their
// platforms, and never touches the DOM.
import { ENEMY_SIZE, PLAYER_SIZE } from "./level-builders"
import type { EnemyDef, Level } from "./levels"

export const CANVAS_W = 480
export const CANVAS_H = 270

// Constants adapted from the SMB1 disassembly's documented ratios (see
// README): weak gravity while rising with jump held, ~3x stronger while
// falling; acceleration/friction instead of instant-snap movement; jump
// height depends on how long the jump key is held.
export const PHYSICS = {
  accel: 0.5,
  friction: 0.6,
  maxSpeed: 2.4,
  gravityRise: 0.22,
  gravityFall: 0.6,
  jumpVelocity: -6.6,
  jumpVelocityFast: -7.2,
  jumpCutVy: -2.2,
  bounceVelocity: -4.2,
  squashDuration: 20,
  walkFrameDistance: 14,
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
  confirmPressed: boolean
  resetPressed: boolean
}

export const NO_INPUT: Input = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
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

/** Accelerates or brakes, and reports which way the player is being pushed. */
export function applyHorizontalInput(p: Player, input: Input): Direction {
  const dir: Direction = input.right && !input.left ? 1 : input.left && !input.right ? -1 : 0
  if (dir !== 0) {
    p.vx = clamp(p.vx + dir * PHYSICS.accel, -PHYSICS.maxSpeed, PHYSICS.maxSpeed)
    p.facing = dir
    return dir
  }
  if (p.vx !== 0) {
    const sign = Math.sign(p.vx)
    const braked = p.vx - sign * PHYSICS.friction
    p.vx = Math.sign(braked) === sign ? braked : 0
  }
  return 0
}

export function applyJump(p: Player, input: Input) {
  // Jumping requires actually standing on something. The original prototype
  // used "|vy| < 0.1", which is also true at a jump's apex -- that was the
  // infinite-jump bug.
  if (input.jumpPressed && p.grounded) {
    const fast = Math.abs(p.vx) >= PHYSICS.maxSpeed * 0.9
    p.vy = fast ? PHYSICS.jumpVelocityFast : PHYSICS.jumpVelocity
    p.grounded = false
  }
  // Releasing the button while still rising cuts the jump short.
  if (p.vy < 0 && !input.jumpHeld) {
    p.vy = Math.max(p.vy, PHYSICS.jumpCutVy)
  }
}

export function applyGravity(p: Player, input: Input) {
  const rising = p.vy < 0 && input.jumpHeld
  p.vy += rising ? PHYSICS.gravityRise : PHYSICS.gravityFall
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

/** Advances the walk cycle; faster movement flips frames sooner. */
export function updateAnimation(p: Player, dir: Direction) {
  if (!p.grounded) return
  if (dir === 0) {
    p.animTimer = 0
    p.animFrame = 0
    return
  }
  p.animTimer += Math.abs(p.vx)
  if (p.animTimer > PHYSICS.walkFrameDistance) {
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
