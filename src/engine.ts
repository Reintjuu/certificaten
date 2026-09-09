import { LEVELS } from "./levels"
import type { Level } from "./levels"
import { ENEMY_SIZE, PLAYER_SIZE } from "./level-builders"

export { LEVELS }
export type { Level }

export const CANVAS_W = 480
export const CANVAS_H = 270

// Physics constants, adapted from the SMB1 disassembly's documented ratios
// (see README): weak gravity while rising with jump held, ~3x stronger while
// falling; acceleration/friction instead of instant-snap movement; jump height
// depends on how long the jump key is held.
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

export type GamePhase = "title" | "dialogue" | "playing" | "dead" | "gameComplete"
export type DialogueKind = "intro" | "outro"

export type GameState = {
  phase: GamePhase
  levelIndex: number
  player: Player
  enemies: Enemy[]
  dialogueLines: string[]
  dialogueIndex: number
  dialogueKind: DialogueKind
  blinkTimer: number
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

/** Compile-time exhaustiveness guard: adding a GamePhase becomes an error. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`)
}

export type Direction = -1 | 0 | 1

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function overlaps(
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

export function createEnemies(level: Level): Enemy[] {
  return level.enemies.map((d) => ({
    x: d.x,
    y: d.y,
    w: PHYSICS.enemyW,
    h: PHYSICS.enemyH,
    vx: d.vx,
    patrolMin: d.patrolMin,
    patrolMax: d.patrolMax,
    alive: true,
    squashTimer: 0,
  }))
}

export function createPlayingState(levelIndex: number, levels: Level[] = LEVELS): GameState {
  const level = levels[levelIndex]
  return {
    phase: "playing",
    levelIndex,
    player: createPlayer(level.playerStart),
    enemies: createEnemies(level),
    dialogueLines: [],
    dialogueIndex: 0,
    dialogueKind: "intro",
    blinkTimer: 0,
  }
}

export function createInitialState(levels: Level[] = LEVELS): GameState {
  return { ...createPlayingState(0, levels), phase: "title" }
}

function resetLevel(state: GameState, levels: Level[]) {
  const level = levels[state.levelIndex]
  state.player = createPlayer(level.playerStart)
  state.enemies = createEnemies(level)
}

function startDialogue(state: GameState, kind: DialogueKind, levels: Level[]) {
  const level = levels[state.levelIndex]
  state.dialogueKind = kind
  state.dialogueLines = kind === "intro" ? level.intro : level.outro
  state.dialogueIndex = 0
  state.phase = "dialogue"
}

// --- physics steps, each small enough to unit-test on its own ---

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
  for (const plat of level.platforms) {
    const horizontallyOver = p.x + p.w > plat.x && p.x < plat.x + plat.w
    const crossedSurface = p.y + p.h >= plat.y && p.y + p.h - p.vy <= plat.y
    if (p.vy >= 0 && horizontallyOver && crossedSurface) {
      p.y = plat.y - p.h
      p.vy = 0
      p.grounded = true
    }
  }
}

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
  for (const e of enemies) {
    if (!e.alive) {
      if (e.squashTimer > 0) e.squashTimer--
      continue
    }
    e.x += e.vx
    if (e.x < e.patrolMin || e.x > e.patrolMax) e.vx *= -1
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
  for (const e of enemies) {
    if (!e.alive || !overlaps(p, e)) continue
    const cameFromAbove = fallVy > 0 && bottomBeforeFall <= e.y + e.h * 0.5
    if (!cameFromAbove) return true
    e.alive = false
    e.squashTimer = PHYSICS.squashDuration
    p.vy = PHYSICS.bounceVelocity
  }
  return false
}

function stepPlaying(state: GameState, input: Input, levels: Level[]) {
  const p = state.player
  const level = levels[state.levelIndex]

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

  moveEnemies(state.enemies)
  if (resolveEnemyCollisions(p, state.enemies, fallVy, bottomBeforeFall)) {
    state.phase = "dead"
    return
  }

  if (overlaps(p, level.certificate)) {
    startDialogue(state, "outro", levels)
    return
  }

  if (p.y > CANVAS_H + PHYSICS.deathFallMargin) {
    state.phase = "dead"
  }
}

function advanceDialogue(state: GameState, levels: Level[]) {
  state.dialogueIndex++
  if (state.dialogueIndex < state.dialogueLines.length) return

  if (state.dialogueKind === "intro") {
    resetLevel(state, levels)
    state.phase = "playing"
  } else if (state.levelIndex + 1 < levels.length) {
    state.levelIndex++
    startDialogue(state, "intro", levels)
  } else {
    state.phase = "gameComplete"
  }
}

/** Advances the game by one frame. Pure: never mutates the state passed in. */
export function step(state: GameState, input: Input, levels: Level[] = LEVELS): GameState {
  const next: GameState = {
    ...state,
    player: { ...state.player },
    enemies: state.enemies.map((e) => ({ ...e })),
  }
  next.blinkTimer = (state.blinkTimer + 1) % 60

  switch (next.phase) {
    case "title":
      if (input.confirmPressed) startDialogue(next, "intro", levels)
      break

    case "dialogue":
      if (input.confirmPressed) advanceDialogue(next, levels)
      break

    case "playing":
      if (input.resetPressed) {
        resetLevel(next, levels)
      } else {
        stepPlaying(next, input, levels)
      }
      break

    case "dead":
      if (input.resetPressed) {
        resetLevel(next, levels)
        next.phase = "playing"
      }
      break

    case "gameComplete":
      if (input.resetPressed) {
        next.levelIndex = 0
        resetLevel(next, levels)
        next.phase = "title"
      }
      break

    default:
      assertNever(next.phase)
  }

  return next
}
