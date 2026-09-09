// The game's state machine: which screen we're on, which level is loaded, and
// how a frame advances. The rules of the world itself live in physics.ts;
// this file decides when they apply.
import { LEVELS } from "./levels"
import type { Level } from "./levels"
import { createEnemies, createPlayer, overlaps, stepWorld } from "./physics"
import type { Enemy, Input, Player } from "./physics"

export { LEVELS }
export type { Level }
export { CANVAS_W, CANVAS_H, PHYSICS, NO_INPUT } from "./physics"
export type { Player, Enemy, Input, Direction } from "./physics"

/** The blink cycle for "PRESS START" and the dialogue arrow. */
export const BLINK_PERIOD_FRAMES = 60

type GamePhase = "title" | "dialogue" | "playing" | "dead" | "gameComplete"
type DialogueKind = "intro" | "outro"

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

/** Compile-time exhaustiveness guard: adding a GamePhase becomes an error. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`)
}

export function hasFinishedLevel(state: GameState) {
  return state.phase === "dialogue" && state.dialogueKind === "outro"
}

export function hasDied(state: GameState) {
  return state.phase === "dead"
}

export function isPlaying(state: GameState) {
  return state.phase === "playing"
}

export function createPlayingState(levelIndex: number, levels: Level[] = LEVELS): GameState {
  const level = levels[levelIndex]
  return {
    phase: "playing",
    levelIndex,
    player: createPlayer(level.playerStart),
    enemies: createEnemies(level.enemies),
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
  state.enemies = createEnemies(level.enemies)
}

function startDialogue(state: GameState, kind: DialogueKind, levels: Level[]) {
  const level = levels[state.levelIndex]
  state.dialogueKind = kind
  state.dialogueLines = kind === "intro" ? level.intro : level.outro
  state.dialogueIndex = 0
  state.phase = "dialogue"
}

function stepPlaying(state: GameState, input: Input, levels: Level[]) {
  const level = levels[state.levelIndex]
  const { died } = stepWorld(state.player, state.enemies, level, input)

  if (died) {
    state.phase = "dead"
    return
  }
  if (overlaps(state.player, level.certificate)) {
    startDialogue(state, "outro", levels)
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
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
  }
  next.blinkTimer = (state.blinkTimer + 1) % BLINK_PERIOD_FRAMES

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
