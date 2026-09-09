// The agent's "brain": a tiny hand-rolled feed-forward network (no ML
// library) mapping the game state to a movement decision. Shared by the
// trainer and the replay viewer so a recorded genome always behaves the same
// in both.
import { CANVAS_W, CANVAS_H, LEVELS, type GameState, type Input } from "../src/engine"

export const INPUT_SIZE = 9
export const HIDDEN_SIZE = 8
export const OUTPUT_SIZE = 2
export const GENOME_SIZE = HIDDEN_SIZE * (INPUT_SIZE + 1) + OUTPUT_SIZE * (HIDDEN_SIZE + 1)

export type Genome = number[]

export function randomGenome(): Genome {
  return Array.from({ length: GENOME_SIZE }, () => Math.random() * 2 - 1)
}

export function forward(genome: Genome, inputs: number[]): [number, number] {
  let index = 0
  const hidden = new Array<number>(HIDDEN_SIZE)
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = genome[index + INPUT_SIZE] // bias
    for (let i = 0; i < INPUT_SIZE; i++) sum += genome[index + i] * inputs[i]
    index += INPUT_SIZE + 1
    hidden[h] = Math.tanh(sum)
  }

  const outputs: [number, number] = [0, 0]
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    let sum = genome[index + HIDDEN_SIZE] // bias
    for (let h = 0; h < HIDDEN_SIZE; h++) sum += genome[index + h] * hidden[h]
    index += HIDDEN_SIZE + 1
    outputs[o] = Math.tanh(sum)
  }
  return outputs
}

/** Everything the agent gets to "see", normalised to roughly -1..1. */
export function features(state: GameState): number[] {
  const level = LEVELS[state.levelIndex]
  const player = state.player
  const certificate = level.certificate

  let nearestDistance = Infinity
  let enemyDx = 0
  let enemyDy = 0
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      enemyDx = (enemy.x - player.x) / CANVAS_W
      enemyDy = (enemy.y - player.y) / CANVAS_H
    }
  }

  return [
    (certificate.x - player.x) / CANVAS_W,
    (certificate.y - player.y) / CANVAS_H,
    player.vx / 3,
    player.vy / 10,
    player.grounded ? 1 : 0,
    enemyDx,
    enemyDy,
    Number.isFinite(nearestDistance) ? 1 : 0,
    1, // bias
  ]
}

export function actionFor(genome: Genome, state: GameState): Input {
  const [horizontal, jump] = forward(genome, features(state))
  const jumpHeld = jump > 0
  return {
    left: horizontal < -0.2,
    right: horizontal > 0.2,
    jumpHeld,
    // The engine only starts a jump when grounded, so repeating "pressed"
    // while airborne is harmless and keeps the policy stateless.
    jumpPressed: jumpHeld,
    confirmPressed: false,
    resetPressed: false,
  }
}
