// The agent's "brain": a tiny hand-rolled feed-forward network (no ML
// library) mapping the game state to a movement decision. Shared by the
// trainer and the replay viewer so a recorded genome always behaves the same
// in both.
import { CANVAS_W, CANVAS_H, PHYSICS, type GameState, type Input, type Level } from "../engine";
import type { Random } from "./random";

/** How far an output must swing before it counts as pressing a direction. */
const MOVE_THRESHOLD = 0.2;

export const INPUT_SIZE = 12;
const OUTPUT_SIZE = 3;

/**
 * The shape of the network. Hidden is a list, so more than one hidden layer
 * costs nothing but a longer list, and the console can offer it as a setting.
 */
export type Architecture = {
  readonly inputs: number;
  readonly hidden: readonly number[];
  readonly outputs: number;
};

export const DEFAULT_ARCHITECTURE: Architecture = {
  inputs: INPUT_SIZE,
  hidden: [8],
  outputs: OUTPUT_SIZE,
};

/** Input count, each hidden count, then the output count. */
export function layerSizes(architecture: Architecture): number[] {
  return [architecture.inputs, ...architecture.hidden, architecture.outputs];
}

export function genomeSize(architecture: Architecture): number {
  const sizes = layerSizes(architecture);
  let total = 0;
  for (let layer = 1; layer < sizes.length; layer++) {
    total += sizes[layer] * (sizes[layer - 1] + 1);
  }
  return total;
}

export const GENOME_SIZE = genomeSize(DEFAULT_ARCHITECTURE);

export type Genome = number[];

/**
 * Where every weight sits in the flat genome, so the console can point at one
 * and say what it connects. A node's weights are stored together, its bias
 * last: node t of a layer fed by `from` inputs starts at t * (from + 1).
 */
export type LayerLayout = {
  /** How many values feed this layer, and how many nodes it has. */
  from: number;
  to: number;
  /** Genome index of the weight from incoming node `f` into node `t`. */
  weight: (t: number, f: number) => number;
  /** Genome index of node `t`'s bias. */
  bias: (t: number) => number;
};

export function layoutOf(architecture: Architecture): LayerLayout[] {
  const sizes = layerSizes(architecture);
  const layouts: LayerLayout[] = [];
  let base = 0;

  for (let layer = 1; layer < sizes.length; layer++) {
    const from = sizes[layer - 1];
    const to = sizes[layer];
    const start = base;
    layouts.push({
      from,
      to,
      weight: (t, f) => start + t * (from + 1) + f,
      bias: (t) => start + t * (from + 1) + from,
    });
    base += to * (from + 1);
  }
  return layouts;
}

/**
 * Weights are kept to four decimals. A tanh network cannot tell the difference,
 * and the recording committed to the repo shrinks by two thirds because JSON
 * no longer writes out seventeen digits per weight. Rounding happens where
 * weights are made, so what runs in memory is exactly what lands in the file.
 */
export function roundWeight(weight: number): number {
  return Math.round(weight * 1e4) / 1e4;
}

export function randomGenome(random: Random = Math.random, architecture = DEFAULT_ARCHITECTURE): Genome {
  return Array.from({ length: genomeSize(architecture) }, () => roundWeight(random() * 2 - 1));
}

/**
 * Every layer's activations, inputs first and outputs last, rather than only
 * the outputs. The console draws exactly this, and the policy would otherwise
 * have to be run twice to show what it was thinking.
 */
export function forward(genome: Genome, inputs: number[], architecture = DEFAULT_ARCHITECTURE): number[][] {
  const sizes = layerSizes(architecture);
  const activations: number[][] = [inputs];
  let index = 0;

  for (let layer = 1; layer < sizes.length; layer++) {
    const previous = activations[layer - 1];
    const from = sizes[layer - 1];
    const current = new Array<number>(sizes[layer]);

    for (let node = 0; node < sizes[layer]; node++) {
      let sum = genome[index + from];
      for (let i = 0; i < from; i++) {
        sum += genome[index + i] * previous[i];
      }
      index += from + 1;
      current[node] = Math.tanh(sum);
    }
    activations.push(current);
  }
  return activations;
}

export function outputsOf(activations: number[][]): number[] {
  return activations[activations.length - 1];
}

/** Names in the order features() builds them, so a reader can tell them apart. */
export const FEATURE_LABELS = [
  "grond +20",
  "grond +48",
  "grond +80",
  "certificaat dx",
  "certificaat dy",
  "snelheid vx",
  "snelheid vy",
  "staat op grond",
  "vijand dx",
  "vijand dy",
  "vijand in beeld",
  "bias",
] as const;

export const OUTPUT_LABELS = ["links / rechts", "springen", "rennen"] as const;

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

export function actionFor(
  genome: Genome,
  state: GameState,
  level: Level,
  architecture = DEFAULT_ARCHITECTURE
): Input {
  const [horizontal, jump, run] = outputsOf(forward(genome, features(state, level), architecture));
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
