// Headless smoke test: checks each level is still completable after a physics
// or level-data change. Run with: npm run validate-levels
//
// Rather than guessing jump distances from hand-tuned constants, the bot tries
// its options against the real engine and keeps the one that gets furthest: the
// engine is pure, so a simulated hop costs a few dozen cheap steps. That keeps
// this honest when the physics change, which is exactly when a canary has to
// stay trustworthy. The previous hand-tuned version silently became useless
// the moment the numbers moved.
import {
  LEVELS,
  NO_INPUT,
  createPlayingState,
  hasDied,
  hasFinishedLevel,
  isPlaying,
  step,
  type GameState,
  type Input,
} from "../engine";
import type { Level } from "../levels";

const FRAME_BUDGET = 1800; // 30s at 60fps
const HOP_BUDGET = 90; // how far ahead one candidate move is simulated
/**
 * Frames to keep the jump button held. 0 means "walk, don't jump". Six rungs
 * rather than nine: at three moves deep the difference in what the bot finds
 * is two frames across all three levels, and it runs in a third of the time.
 */
const HOLD_OPTIONS = [0, 6, 12, 20, 28, 40];
const WALK_FRAMES = 12; // how long a "just walk" move commits for

type Move = { inputs: Input[]; state: GameState };

function inputFor(dir: 1 | -1, jumpHeld: boolean, jumpPressed: boolean): Input {
  return { ...NO_INPUT, left: dir === -1, right: dir === 1, run: true, jumpHeld, jumpPressed };
}

/** Plays one candidate move out against the real engine. */
function simulateMove(from: GameState, dir: 1 | -1, holdFrames: number): Move {
  const inputs: Input[] = [];
  let state = from;

  const length = holdFrames === 0 ? WALK_FRAMES : HOP_BUDGET;
  for (let frame = 0; frame < length; frame++) {
    const jumping = holdFrames > 0 && frame < holdFrames;
    const next = inputFor(dir, jumping, holdFrames > 0 && frame === 0);
    inputs.push(next);
    state = step(state, next);
    if (!isPlaying(state)) {
      break;
    }
    // A hop ends when we touch down again; a walk runs its full length.
    if (holdFrames > 0 && frame > 2 && state.player.grounded) {
      break;
    }
  }
  return { inputs, state };
}

const DEATH_PENALTY = 100000;

/**
 * Lower is better. Dying is heavily penalised but still ranked, so that when
 * every option looks fatal the bot picks the least bad one and keeps playing
 * rather than reporting itself stuck.
 */
function score(move: Move, level: Level): number {
  const player = move.state.player;
  const distance = Math.abs(level.certificate.x - player.x) + Math.max(0, player.y - level.certificate.y);
  if (hasFinishedLevel(move.state)) {
    return -Infinity;
  }
  return hasDied(move.state) ? DEATH_PENALTY + distance : distance;
}

/**
 * How many moves ahead to look. One is not enough: at a gap every jump from a
 * standstill scores worse than staying put, and backing up for a run-up scores
 * worse still, so a greedy bot parks itself at the edge forever. Two stopped
 * being enough once the stomp bounce was corrected to the ROM's $fc, which
 * throws the bot further after a stomp than it used to plan for.
 */
const LOOKAHEAD_MOVES = 3;

type Candidate = { move: Move; score: number };

function bestMove(state: GameState, level: Level, depth = LOOKAHEAD_MOVES): Candidate {
  const candidates: Candidate[] = [];
  for (const dir of [1, -1] as const) {
    for (const hold of HOLD_OPTIONS) {
      const move = simulateMove(state, dir, hold);
      candidates.push({ move, score: score(move, level) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  // Never empty: two directions times the hold options.
  let best = candidates[0];
  if (depth <= 1) {
    return best;
  }

  for (const candidate of candidates) {
    if (candidate.score === -Infinity) {
      return candidate;
    }
    if (candidate.score >= DEATH_PENALTY) {
      continue;
    }
    const reachable = Math.min(candidate.score, bestMove(candidate.move.state, level, depth - 1).score);
    if (reachable < best.score) {
      best = { move: candidate.move, score: reachable };
    }
  }
  return best;
}

type LevelResult = { ok: boolean; frames: number; reason?: string };

export function validateLevel(levelIndex: number): LevelResult {
  const level = LEVELS[levelIndex];
  let state = createPlayingState(levelIndex);
  let frames = 0;
  let queued: Input[] = [];

  while (frames < FRAME_BUDGET) {
    if (hasFinishedLevel(state)) {
      return { ok: true, frames };
    }
    if (hasDied(state)) {
      return { ok: false, frames, reason: "died" };
    }

    if (queued.length === 0) {
      const plan = bestMove(state, level);
      if (plan.move.inputs.length === 0) {
        return { ok: false, frames, reason: "stuck" };
      }
      queued = plan.move.inputs;
    }

    const next = queued.shift();
    if (!next) {
      return { ok: false, frames, reason: "stuck" };
    }
    state = step(state, next);
    frames++;
  }
  return { ok: false, frames: FRAME_BUDGET, reason: "timeout" };
}

function runValidation(): boolean {
  const results = LEVELS.map((_, index) => validateLevel(index));
  results.forEach((result, index) => {
    console.log(
      `Level ${index + 1}/${LEVELS.length}: ${result.ok ? "OK" : `FAIL (${result.reason})`} - ${result.frames} frames`
    );
  });
  return results.every((result) => result.ok);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (runValidation()) {
    console.log("\nAll levels completable.");
  } else {
    console.error("\nThe scripted bot could not finish every level (see agent/train.ts for the real check).");
    process.exit(1);
  }
}
