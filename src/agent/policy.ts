// The agent's "brain": a tiny hand-rolled feed-forward network (no ML
// library) mapping the game state to a movement decision. Shared by the
// trainer and the replay viewer so a recorded genome always behaves the same
// in both.
import { CANVAS_W, CANVAS_H, PHYSICS, type GameState, type Input, type Level } from "../engine";
import type { Random } from "./random";

/** How far an output must swing before it counts as pressing a direction. */
const MOVE_THRESHOLD = 0.2;

export const INPUT_SIZE = 12;
const HIDDEN_SIZE = 8;
const OUTPUT_SIZE = 3;
export const GENOME_SIZE = HIDDEN_SIZE * (INPUT_SIZE + 1) + OUTPUT_SIZE * (HIDDEN_SIZE + 1);

export type Genome = number[];

/**
 * Weights are kept to four decimals. A tanh network cannot tell the difference,
 * and the recording committed to the repo shrinks by two thirds because JSON
 * no longer writes out seventeen digits per weight. Rounding happens where
 * weights are made, so what runs in memory is exactly what lands in the file.
 */
export function roundWeight(weight: number): number {
  return Math.round(weight * 1e4) / 1e4;
}

export function randomGenome(random: Random = Math.random): Genome {
  return Array.from({ length: GENOME_SIZE }, () => roundWeight(random() * 2 - 1));
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

/**
 * How far ahead the terrain probes look, in pixels. Roughly a running jump's
 * worth of ground, so a pit shows up while there is still time to jump.
 */
const PROBE_OFFSETS = [20, 48, 80] as const;
/** A step further up or down than this reads as fully up or fully down. */
const PROBE_RANGE = 80;

/**
 * The height of the ground at one point ahead, relative to the player's feet:
 * positive is a step up, negative a drop, and -1 means no ground at all within
 * range, which is what a pit looks like. Without these the agent is blind to
 * the level's shape and can only aim at the certificate, which is why it used
 * to clear a level by luck rather than by reading the ledge in front of it.
 */
function groundProbe(level: Level, x: number, feetY: number): number {
  let surfaceY = Infinity;
  for (const platform of level.platforms) {
    const spansX = x >= platform.x && x <= platform.x + platform.w;
    if (spansX && platform.y >= feetY - PROBE_RANGE && platform.y < surfaceY) {
      surfaceY = platform.y;
    }
  }
  if (!Number.isFinite(surfaceY)) {
    return -1;
  }
  return Math.max(-1, Math.min(1, (feetY - surfaceY) / PROBE_RANGE));
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

  const feetY = player.y + player.h;
  const centerX = player.x + player.w / 2;

  return [
    ...PROBE_OFFSETS.map((offset) => groundProbe(level, centerX + player.facing * offset, feetY)),
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
