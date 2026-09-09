import { LEVELS } from "./levels"

export { LEVELS }

export const CANVAS_W = 480
export const CANVAS_H = 270

// Physics constants, adapted from the SMB1 disassembly's documented ratios
// (see plan / README): weak gravity while rising with jump held, ~3x stronger
// while falling; acceleration/friction instead of instant-snap movement;
// jump height depends on how long the jump key is held.
const ACCEL = 0.5
const FRICTION = 0.6
const MAX_SPEED = 2.4
const GRAVITY_RISE = 0.22
const GRAVITY_FALL = 0.6
const JUMP_VELOCITY = -6.6
const JUMP_VELOCITY_FAST = -7.2
const JUMP_CUT_VY = -2.2
const BOUNCE_VELOCITY = -4.2
const SQUASH_DURATION = 20
const WALK_FRAME_DISTANCE = 14
const DEATH_FALL_MARGIN = 60

const PLAYER_W = 16
const PLAYER_H = 24
const ENEMY_W = 16
const ENEMY_H = 16

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createPlayer(start: { x: number; y: number }): Player {
  return {
    x: start.x,
    y: start.y,
    w: PLAYER_W,
    h: PLAYER_H,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: 1,
    animTimer: 0,
    animFrame: 0,
  }
}

function createEnemies(level: (typeof LEVELS)[number]): Enemy[] {
  return level.enemies.map((d) => ({
    x: d.x,
    y: d.y,
    w: ENEMY_W,
    h: ENEMY_H,
    vx: d.vx,
    patrolMin: d.patrolMin,
    patrolMax: d.patrolMax,
    alive: true,
    squashTimer: 0,
  }))
}

function resetLevel(state: GameState) {
  const level = LEVELS[state.levelIndex]
  state.player = createPlayer(level.playerStart)
  state.enemies = createEnemies(level)
}

function startDialogue(state: GameState, kind: DialogueKind) {
  const level = LEVELS[state.levelIndex]
  state.dialogueKind = kind
  state.dialogueLines = kind === "intro" ? level.intro : level.outro
  state.dialogueIndex = 0
  state.phase = "dialogue"
}

export function createPlayingState(levelIndex: number): GameState {
  const level = LEVELS[levelIndex]
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

export function createInitialState(): GameState {
  const state: GameState = {
    phase: "title",
    levelIndex: 0,
    player: createPlayer(LEVELS[0].playerStart),
    enemies: createEnemies(LEVELS[0]),
    dialogueLines: [],
    dialogueIndex: 0,
    dialogueKind: "intro",
    blinkTimer: 0,
  }
  return state
}

function stepPlaying(state: GameState, input: Input) {
  const p = state.player
  const level = LEVELS[state.levelIndex]

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  if (dir !== 0) {
    p.vx = clamp(p.vx + dir * ACCEL, -MAX_SPEED, MAX_SPEED)
    p.facing = dir as 1 | -1
  } else if (p.vx !== 0) {
    const sign = Math.sign(p.vx)
    const next = p.vx - sign * FRICTION
    p.vx = Math.sign(next) === sign ? next : 0
  }

  if (input.jumpPressed && p.grounded) {
    p.vy = Math.abs(p.vx) >= MAX_SPEED * 0.9 ? JUMP_VELOCITY_FAST : JUMP_VELOCITY
    p.grounded = false
  }

  if (p.vy < 0 && !input.jumpHeld) {
    p.vy = Math.max(p.vy, JUMP_CUT_VY)
  }

  if (p.vy < 0 && input.jumpHeld) p.vy += GRAVITY_RISE
  else p.vy += GRAVITY_FALL

  p.x += p.vx
  p.y += p.vy
  const fallVy = p.vy // pre-collision fall speed
  const bottomBeforeFall = p.y + p.h - fallVy // used below so a platform
  // landing (which snaps p.y and zeroes p.vy) can't hide that we were also
  // falling onto an enemy from above on this same frame.

  p.grounded = false
  for (const plat of level.platforms) {
    if (
      p.vy >= 0 &&
      p.x + p.w > plat.x &&
      p.x < plat.x + plat.w &&
      p.y + p.h >= plat.y &&
      p.y + p.h - p.vy <= plat.y
    ) {
      p.y = plat.y - p.h
      p.vy = 0
      p.grounded = true
    }
  }

  p.x = clamp(p.x, 0, CANVAS_W - p.w)

  if (p.grounded) {
    if (dir !== 0) {
      p.animTimer += Math.abs(p.vx)
      if (p.animTimer > WALK_FRAME_DISTANCE) {
        p.animTimer = 0
        p.animFrame = p.animFrame === 0 ? 1 : 0
      }
    } else {
      p.animTimer = 0
      p.animFrame = 0
    }
  }

  for (const e of state.enemies) {
    if (!e.alive) {
      if (e.squashTimer > 0) e.squashTimer--
      continue
    }
    e.x += e.vx
    if (e.x < e.patrolMin || e.x > e.patrolMax) e.vx *= -1
  }

  for (const e of state.enemies) {
    if (!e.alive) continue
    const overlapX = p.x + p.w > e.x && p.x < e.x + e.w
    const overlapY = p.y + p.h >= e.y && p.y < e.y + e.h
    if (!overlapX || !overlapY) continue
    const cameFromAbove = fallVy > 0 && bottomBeforeFall <= e.y + e.h * 0.5
    if (cameFromAbove) {
      e.alive = false
      e.squashTimer = SQUASH_DURATION
      p.vy = BOUNCE_VELOCITY
    } else {
      state.phase = "dead"
      return
    }
  }

  const c = level.certificate
  if (p.x < c.x + c.w && p.x + p.w > c.x && p.y < c.y + c.h && p.y + p.h > c.y) {
    startDialogue(state, "outro")
    return
  }

  if (p.y > CANVAS_H + DEATH_FALL_MARGIN) {
    state.phase = "dead"
  }
}

export function step(state: GameState, input: Input): GameState {
  const next: GameState = {
    ...state,
    player: { ...state.player },
    enemies: state.enemies.map((e) => ({ ...e })),
  }
  next.blinkTimer = (state.blinkTimer + 1) % 60

  switch (next.phase) {
    case "title":
      if (input.confirmPressed) startDialogue(next, "intro")
      break

    case "dialogue":
      if (input.confirmPressed) {
        next.dialogueIndex++
        if (next.dialogueIndex >= next.dialogueLines.length) {
          if (next.dialogueKind === "intro") {
            resetLevel(next)
            next.phase = "playing"
          } else if (next.levelIndex + 1 < LEVELS.length) {
            next.levelIndex++
            startDialogue(next, "intro")
          } else {
            next.phase = "gameComplete"
          }
        }
      }
      break

    case "playing":
      stepPlaying(next, input)
      if (input.resetPressed) resetLevel(next)
      break

    case "dead":
      if (input.resetPressed) {
        resetLevel(next)
        next.phase = "playing"
      }
      break

    case "gameComplete":
      if (input.resetPressed) {
        next.levelIndex = 0
        resetLevel(next)
        next.phase = "title"
      }
      break
  }

  return next
}
