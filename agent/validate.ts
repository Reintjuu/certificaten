// Headless smoke test: a scripted bot drives the pure engine (no canvas) to
// check each level is still completable after a physics or level-data change.
// Run with: npm run validate-levels
//
// Deliberately simple rules -- it is a fast canary, not a good player. The
// authoritative "is this level fair" check is the trained agent in
// agent/train.ts (and the test that replays its best genome).
import { LEVELS, createPlayingState, step, NO_INPUT, type GameState, type Input, type Player } from "../src/engine"
import type { Level, Platform } from "../src/levels"

const FRAME_BUDGET = 1800 // 30s at 60fps
const EDGE_LOOKAHEAD = 28
const ENEMY_LOOKAHEAD_X = 40
const ENEMY_LOOKAHEAD_Y = 40
const MAX_JUMP_FRAMES = 24
const MAX_SINGLE_JUMP_RISE = 90 // roughly what one full-held jump can climb
const APPROACH_DISTANCE = 70
const STEP_SEARCH_X = 160

function centerX(rect: { x: number; w: number }) {
  return rect.x + rect.w / 2
}

function standingPlatform(level: Level, player: Player): Platform | undefined {
  return level.platforms.find(
    (platform) =>
      player.x + player.w > platform.x &&
      player.x < platform.x + platform.w &&
      Math.abs(player.y + player.h - platform.y) < 2
  )
}

/** Horizontal gap between the player and a platform's span (0 when over it). */
function distanceToSpan(player: Player, platform: Platform) {
  if (platform.x > player.x + player.w) return platform.x - (player.x + player.w)
  if (player.x > platform.x + platform.w) return player.x - (platform.x + platform.w)
  return 0
}

function bestScoringPlatform(level: Level, player: Player, exclude: Platform | undefined): Platform {
  let best = level.platforms[0]
  let bestScore = -Infinity
  for (const platform of level.platforms) {
    if (platform === exclude) continue
    const towardsGoal = -Math.abs(level.certificate.x - centerX(platform))
    const heightGain = player.y - platform.y
    const score = towardsGoal + heightGain * 0.6
    if (score > bestScore) {
      bestScore = score
      best = platform
    }
  }
  return best
}

/** The nearest platform that is a genuine step up and within one jump. */
function nearestStepUp(level: Level, player: Player, exclude: Platform | undefined): Platform | null {
  let best: Platform | null = null
  let bestDistance = Infinity
  for (const platform of level.platforms) {
    if (platform === exclude) continue
    const rise = player.y - platform.y
    if (rise <= 0 || rise > MAX_SINGLE_JUMP_RISE) continue
    const distance = Math.abs(centerX(platform) - centerX(player))
    if (distance > STEP_SEARCH_X || distance >= bestDistance) continue
    bestDistance = distance
    best = platform
  }
  return best
}

/**
 * Where to head next. Aims straight for the platform closest to the
 * certificate, unless that is higher than a single jump can climb -- then it
 * takes the nearest step up instead, so a staircase gets climbed one step at
 * a time rather than attempted (and overshot) in one leap.
 */
function chooseTarget(level: Level, player: Player, standing: Platform | undefined): Platform {
  const goal = bestScoringPlatform(level, player, standing)
  if (player.y - goal.y <= MAX_SINGLE_JUMP_RISE) return goal
  return nearestStepUp(level, player, standing) ?? goal
}

function runningOutOfPlatform(standing: Platform, player: Player, dir: number) {
  if (dir === 0) return false
  const edge = dir === 1 ? standing.x + standing.w : standing.x
  const distance = dir === 1 ? edge - (player.x + player.w) : player.x - edge
  return distance < EDGE_LOOKAHEAD
}

function enemyAhead(state: GameState, dir: number) {
  const player = state.player
  return state.enemies.some(
    (enemy) =>
      enemy.alive &&
      dir !== 0 &&
      Math.sign(enemy.x - player.x) === dir &&
      Math.abs(enemy.x - player.x) < ENEMY_LOOKAHEAD_X &&
      Math.abs(enemy.y - player.y) < ENEMY_LOOKAHEAD_Y
  )
}

function shouldJump(state: GameState, standing: Platform | undefined, target: Platform, dir: number) {
  if (!standing) return true
  if (runningOutOfPlatform(standing, state.player, dir)) return true
  if (enemyAhead(state, dir)) return true
  const climbing = target !== standing && target.y < state.player.y - 10
  return climbing && distanceToSpan(state.player, target) < APPROACH_DISTANCE
}

/**
 * How long the jump button is held is the bot's own business, not game state
 * -- exactly like a human's thumb. Holding for several frames matters: a
 * one-frame tap triggers the engine's short-hop cut.
 */
function makeHeuristicBot() {
  let jumpFramesLeft = 0
  let targetY: number | null = null

  return function decide(state: GameState): Input {
    const level = LEVELS[state.levelIndex]
    const player = state.player
    const standing = standingPlatform(level, player)
    const target = chooseTarget(level, player, standing)

    const dx = centerX(target) - centerX(player)
    const dir = dx > 4 ? 1 : dx < -4 ? -1 : 0

    if (player.grounded && shouldJump(state, standing, target, dir)) {
      jumpFramesLeft = MAX_JUMP_FRAMES
      targetY = target.y
    }

    // Once the feet clear the platform being aimed at, stop climbing and let
    // gravity bring us down onto it.
    const reachedTargetHeight = targetY !== null && player.y + player.h <= targetY
    if (reachedTargetHeight) jumpFramesLeft = 0

    const jumpHeld = jumpFramesLeft > 0
    if (jumpFramesLeft > 0) jumpFramesLeft--

    return { ...NO_INPUT, left: dir === -1, right: dir === 1, jumpHeld, jumpPressed: jumpHeld }
  }
}

type LevelResult = { ok: boolean; frames: number; reason?: string }

function validateLevel(levelIndex: number): LevelResult {
  let state = createPlayingState(levelIndex)
  const decide = makeHeuristicBot()

  for (let frame = 0; frame < FRAME_BUDGET; frame++) {
    if (state.phase === "dialogue") return { ok: true, frames: frame }
    if (state.phase === "dead") return { ok: false, frames: frame, reason: "died" }
    state = step(state, decide(state))
  }
  return { ok: false, frames: FRAME_BUDGET, reason: "timeout" }
}

function runValidation() {
  const results = LEVELS.map((_, index) => validateLevel(index))
  results.forEach((result, index) => {
    console.log(`Level ${index + 1}/${LEVELS.length}: ${result.ok ? "OK" : `FAIL (${result.reason})`} - ${result.frames} frames`)
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
