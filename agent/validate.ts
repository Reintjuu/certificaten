// Headless smoke test: checks each level is still completable after a physics
// or level-data change. Run with: npm run validate-levels
//
// Rather than guessing jump distances from hand-tuned constants, the bot tries
// its options against the real engine and keeps the one that gets furthest: the
// engine is pure, so a simulated hop costs a few dozen cheap steps. That keeps
// this honest when the physics change, which is exactly when a canary has to
// stay trustworthy -- the previous hand-tuned version silently became useless
// the moment the numbers moved.
import { LEVELS, NO_INPUT, createPlayingState, step, type GameState, type Input } from "../src/engine"
import type { Level } from "../src/levels"

const FRAME_BUDGET = 1800 // 30s at 60fps
const HOP_BUDGET = 90 // how far ahead one candidate move is simulated
/** Frames to keep the jump button held. 0 means "walk, don't jump". */
const HOLD_OPTIONS = [0, 4, 8, 12, 16, 22, 28, 34, 40]
const WALK_FRAMES = 12 // how long a "just walk" move commits for

type Move = { inputs: Input[]; state: GameState }

function inputFor(dir: 1 | -1, jumpHeld: boolean, jumpPressed: boolean): Input {
  return { ...NO_INPUT, left: dir === -1, right: dir === 1, run: true, jumpHeld, jumpPressed }
}

/** Plays one candidate move out against the real engine. */
function simulateMove(from: GameState, dir: 1 | -1, holdFrames: number): Move {
  const inputs: Input[] = []
  let state = from

  const length = holdFrames === 0 ? WALK_FRAMES : HOP_BUDGET
  for (let frame = 0; frame < length; frame++) {
    const jumping = holdFrames > 0 && frame < holdFrames
    const next = inputFor(dir, jumping, holdFrames > 0 && frame === 0)
    inputs.push(next)
    state = step(state, next)
    if (state.phase !== "playing") break
    // A hop ends when we touch down again; a walk runs its full length.
    if (holdFrames > 0 && frame > 2 && state.player.grounded) break
  }
  return { inputs, state }
}

/** Lower is better; reaching the certificate wins outright. */
function score(state: GameState, level: Level) {
  if (state.phase === "dialogue") return -Infinity
  if (state.phase === "dead") return Infinity
  const player = state.player
  return Math.abs(level.certificate.x - player.x) + Math.max(0, player.y - level.certificate.y)
}

function bestMove(state: GameState, level: Level): Move | null {
  let best: Move | null = null
  let bestScore = Infinity

  for (const dir of [1, -1] as const) {
    for (const hold of HOLD_OPTIONS) {
      const move = simulateMove(state, dir, hold)
      const moveScore = score(move.state, level)
      if (moveScore < bestScore) {
        bestScore = moveScore
        best = move
      }
    }
  }
  return best
}

type LevelResult = { ok: boolean; frames: number; reason?: string }

function validateLevel(levelIndex: number): LevelResult {
  const level = LEVELS[levelIndex]
  let state = createPlayingState(levelIndex)
  let frames = 0
  let queued: Input[] = []

  while (frames < FRAME_BUDGET) {
    if (state.phase === "dialogue") return { ok: true, frames }
    if (state.phase === "dead") return { ok: false, frames, reason: "died" }

    if (queued.length === 0) {
      const move = bestMove(state, level)
      if (!move || move.inputs.length === 0) return { ok: false, frames, reason: "stuck" }
      queued = move.inputs
    }

    const next = queued.shift()
    if (!next) return { ok: false, frames, reason: "stuck" }
    state = step(state, next)
    frames++
  }
  return { ok: false, frames: FRAME_BUDGET, reason: "timeout" }
}

function runValidation() {
  const results = LEVELS.map((_, index) => validateLevel(index))
  results.forEach((result, index) => {
    console.log(
      `Level ${index + 1}/${LEVELS.length}: ${result.ok ? "OK" : `FAIL (${result.reason})`} - ${result.frames} frames`
    )
  })
  return results.every((result) => result.ok)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  if (runValidation()) {
    console.log("\nAll levels completable.")
  } else {
    console.error("\nThe scripted bot could not finish every level (see agent/train.ts for the real check).")
    process.exit(1)
  }
}
