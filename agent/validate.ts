// Headless regression check: a simple scripted bot plays every level using the
// pure game engine (no canvas, no DOM) and checks the certificate is reachable
// without dying, within a frame budget. Run with: npx tsx agent/validate.ts
import { LEVELS, createPlayingState, step, type GameState, type Input, type Player } from "../src/engine"
import type { Platform } from "../src/levels"

const FRAME_BUDGET = 1800 // 30s at 60fps
const EDGE_LOOKAHEAD = 28
const ENEMY_LOOKAHEAD_X = 40
const ENEMY_LOOKAHEAD_Y = 40
const MAX_JUMP_FRAMES = 24

// Greedily picks the next stepping-stone platform: the one whose center gets
// us closest to the certificate horizontally, with a bonus for platforms
// above us (since every level is a rough staircase up towards the goal).
// This replaces a purely reactive "jump when the ground runs out" bot, which
// happily walks forever along a level's continuous ground floor without ever
// looking up at the platforms it's supposed to climb.
const MAX_SINGLE_JUMP_RISE = 90 // roughly what one full-held jump can climb

function bestScoringPlatform(level: (typeof LEVELS)[number], p: Player, exclude: Platform | undefined): Platform {
  let best = level.platforms[0]
  let bestScore = -Infinity
  for (const pl of level.platforms) {
    if (pl === exclude) continue
    const center = pl.x + pl.w / 2
    const distToGoalX = Math.abs(level.certificate.x - center)
    const heightBenefit = p.y - pl.y // positive when pl is higher up than the player
    const score = -distToGoalX + heightBenefit * 0.6
    if (score > bestScore) {
      bestScore = score
      best = pl
    }
  }
  return best
}

function chooseTarget(level: (typeof LEVELS)[number], p: Player, exclude: Platform | undefined): Platform {
  const global = bestScoringPlatform(level, p, exclude)
  if (p.y - global.y <= MAX_SINGLE_JUMP_RISE) return global

  // The goal platform is higher than one jump can reach: aim for the
  // nearest platform that's both a genuine step up and within jump range,
  // so the level's staircase gets climbed one step at a time instead of
  // attempting (and overshooting) one huge leap.
  let best: Platform | null = null
  let bestDist = Infinity
  for (const pl of level.platforms) {
    if (pl === exclude) continue
    const center = pl.x + pl.w / 2
    const rise = p.y - pl.y
    if (rise <= 0 || rise > MAX_SINGLE_JUMP_RISE) continue
    const distX = Math.abs(center - (p.x + p.w / 2))
    if (distX > 160) continue
    if (distX < bestDist) {
      bestDist = distX
      best = pl
    }
  }
  return best ?? global
}

// Bot state (how long we've been holding jump, and what we're jumping towards)
// lives outside the pure engine state, the same way a human's "how long am I
// holding the button" isn't part of the game world.
export function makeHeuristicBot() {
  let jumpFramesRemaining = 0
  let targetY: number | null = null
  let lockedTarget: Platform | null = null

  return function heuristicAction(state: GameState): Input {
    const level = LEVELS[state.levelIndex]
    const p = state.player

    const standing = level.platforms.find(
      (pl) => p.x + p.w > pl.x && p.x < pl.x + pl.w && Math.abs(p.y + p.h - pl.y) < 2
    )
    // While a jump is actively in progress, keep aiming at the platform we
    // took off for -- recomputing mid-flight lets the rising player "reach"
    // a further/higher platform than the one it jumped for, so the release
    // height (and direction) drift to a different target partway through
    // the same jump.
    const stepTarget = jumpFramesRemaining > 0 && lockedTarget ? lockedTarget : chooseTarget(level, p, standing)
    lockedTarget = stepTarget
    const stepCenter = stepTarget.x + stepTarget.w / 2
    const dx = stepCenter - (p.x + p.w / 2)
    const left = dx < -4
    const right = dx > 4
    const dir = right ? 1 : left ? -1 : 0

    if (p.grounded) {
      let wantsJump = false
      if (!standing) {
        wantsJump = true
      } else if (dir !== 0) {
        const edge = dir === 1 ? standing.x + standing.w : standing.x
        const distToEdge = dir === 1 ? edge - (p.x + p.w) : p.x - edge
        if (distToEdge < EDGE_LOOKAHEAD) wantsJump = true
      }
      // the step target is a platform above us (not just further along the
      // one we're standing on) and we're close enough underneath/beside it
      // to jump onto it -- otherwise a bot on a long, unbroken floor never
      // looks up at the platforms it's meant to climb.
      if (stepTarget !== standing && stepTarget.y < p.y - 10) {
        const spanDist =
          stepTarget.x > p.x + p.w
            ? stepTarget.x - (p.x + p.w)
            : p.x > stepTarget.x + stepTarget.w
              ? p.x - (stepTarget.x + stepTarget.w)
              : 0
        if (spanDist < 70) wantsJump = true
      }
      for (const e of state.enemies) {
        if (
          e.alive &&
          dir !== 0 &&
          Math.sign(e.x - p.x) === dir &&
          Math.abs(e.x - p.x) < ENEMY_LOOKAHEAD_X &&
          Math.abs(e.y - p.y) < ENEMY_LOOKAHEAD_Y
        ) {
          wantsJump = true
        }
      }
      if (wantsJump) {
        jumpFramesRemaining = MAX_JUMP_FRAMES
        targetY = stepTarget.y
      }
    }

    let jumpHeld = jumpFramesRemaining > 0
    if (jumpHeld && targetY !== null && p.y + p.h <= targetY) {
      // feet have risen at least as high as the platform we're aiming for; let gravity do the rest
      jumpHeld = false
      jumpFramesRemaining = 0
    }
    if (jumpFramesRemaining > 0) jumpFramesRemaining--

    return { left, right, jumpHeld, jumpPressed: jumpHeld, confirmPressed: false, resetPressed: false }
  }
}

function validateLevel(levelIndex: number) {
  let state = createPlayingState(levelIndex)
  const heuristicAction = makeHeuristicBot()
  for (let frame = 0; frame < FRAME_BUDGET; frame++) {
    if (state.phase === "dialogue") {
      return { ok: true, frames: frame }
    }
    if (state.phase === "dead") {
      return { ok: false, frames: frame, reason: "died" }
    }
    state = step(state, heuristicAction(state))
  }
  return { ok: false, frames: FRAME_BUDGET, reason: "timeout" }
}

export function runValidation() {
  let allOk = true
  for (let i = 0; i < LEVELS.length; i++) {
    const result = validateLevel(i)
    const status = result.ok ? "OK" : `FAIL (${result.reason})`
    console.log(`Level ${i + 1}/${LEVELS.length}: ${status} - ${result.frames} frames`)
    if (!result.ok) allOk = false
  }
  return allOk
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const allOk = runValidation()
  if (!allOk) {
    console.error("\nOne or more levels are not completable by the heuristic bot.")
    process.exit(1)
  } else {
    console.log("\nAll levels completable.")
  }
}
