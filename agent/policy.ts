// The agent's "brain": a tiny hand-rolled feed-forward network (no ML
// library) mapping the game state to a movement decision. Shared by the
// trainer and the replay viewer so a recorded genome always behaves the same
// in both.
import { CANVAS_W, CANVAS_H, PHYSICS, type GameState, type Input, type Level } from "../src/engine";

/** How long a single attempt at a level may last, in frames (15s at 60fps).
 * The trainer records runs against this and the viewer replays them against
 * it, so it has to be one number, not two. Crossing a 1440px level at
 * running speed already takes about 600 frames. */
export const RUN_FRAME_BUDGET = 1800;

/** How far an output must swing before it counts as pressing a direction. */
const MOVE_THRESHOLD = 0.2;

export const INPUT_SIZE = 9;
const HIDDEN_SIZE = 8;
const OUTPUT_SIZE = 3;
export const GENOME_SIZE = HIDDEN_SIZE * (INPUT_SIZE + 1) + OUTPUT_SIZE * (HIDDEN_SIZE + 1);

export type Genome = number[];

export function randomGenome(): Genome {
  return Array.from({ length: GENOME_SIZE }, () => Math.random() * 2 - 1);
}

export function forward(genome: Genome, inputs: number[]): [number, number, number] {
  let index = 0;
  const hidden = new Array<number>(HIDDEN_SIZE);
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = genome[index + INPUT_SIZE]; // bias
    for (let i = 0; i < INPUT_SIZE; i++) {
      sum += genome[index + i] * inputs[i];
    }
    index += INPUT_SIZE + 1;
    hidden[h] = Math.tanh(sum);
  }

  const outputs: [number, number, number] = [0, 0, 0];
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    let sum = genome[index + HIDDEN_SIZE]; // bias
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      sum += genome[index + h] * hidden[h];
    }
    index += HIDDEN_SIZE + 1;
    outputs[o] = Math.tanh(sum);
  }
  return outputs;
}

/** Everything the agent gets to "see", normalised to roughly -1..1. */
export function features(state: GameState, level: Level): number[] {
  const player = state.player;
  const certificate = level.certificate;

  let nearestDistance = Infinity;
  let enemyDx = 0;
  let enemyDy = 0;
  for (const enemy of state.enemies) {
    if (!enemy.alive) {
      continue;
    }
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      enemyDx = (enemy.x - player.x) / CANVAS_W;
      enemyDy = (enemy.y - player.y) / CANVAS_H;
    }
  }

  return [
    (certificate.x - player.x) / CANVAS_W,
    (certificate.y - player.y) / CANVAS_H,
    player.vx / PHYSICS.maxRunSpeed,
    player.vy / PHYSICS.maxFallSpeed,
    player.grounded ? 1 : 0,
    enemyDx,
    enemyDy,
    Number.isFinite(nearestDistance) ? 1 : 0,
    1, // bias
  ];
}

export function actionFor(genome: Genome, state: GameState, level: Level): Input {
  const [horizontal, jump, run] = forward(genome, features(state, level));
  const jumpHeld = jump > 0;
  return {
    left: horizontal < -MOVE_THRESHOLD,
    right: horizontal > MOVE_THRESHOLD,
    run: run > 0,
    // Crouching has no use in these levels: there is nothing to duck under.
    down: false,
    jumpHeld,
    // The engine only starts a jump when grounded, so repeating "pressed"
    // while airborne is harmless and keeps the policy stateless.
    jumpPressed: jumpHeld,
    confirmPressed: false,
    resetPressed: false,
  };
}
