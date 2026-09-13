// One definition of what a run is, when it ends and what it was worth.
// The trainer scores runs with it and the console replays them with it, so a
// ghost on screen stops exactly where the trainer stopped counting.
import {
  CANVAS_H,
  LEVELS,
  createPlayingState,
  hasDied,
  hasFinishedLevel,
  step,
  type GameState,
  type Input,
} from "../engine";
import { DEFAULT_ARCHITECTURE, actionFor, type Architecture, type Genome, type Policy } from "./policy";

/**
 * A hard ceiling on one attempt, in frames (30s at 60fps). Crossing a 1440px
 * level at running speed takes about 600 frames, so this is generous.
 */
export const RUN_FRAME_BUDGET = 1800;

/**
 * A run also ends once it has spent this long without getting any closer to
 * the certificate. The level timer would do the job in principle, but 400
 * units of it is 9600 frames: far too late to be a useful signal, and the
 * agent that hops on the spot forever would burn the whole budget first.
 */
export const STALE_FRAMES = 180;

/** Ignore distance changes below this, so jitter does not read as progress. */
const PROGRESS_EPSILON = 0.5;

export const RunOutcome = {
  Running: "running",
  Solved: "solved",
  Died: "died",
  Stalled: "stalled",
  OutOfTime: "outOfTime",
} as const;
export type RunOutcome = (typeof RunOutcome)[keyof typeof RunOutcome];

export type Run = {
  state: GameState;
  frames: number;
  /** The closest the player has come to the certificate, in pixels. */
  closest: number;
  /** The highest the player has been, as a y coordinate, so smaller is higher. */
  highest: number;
  framesSinceProgress: number;
  outcome: RunOutcome;
};

/**
 * Distance to the certificate, with height measured against how much height
 * there is rather than in raw pixels. A level is 1440 wide and 270 tall, so
 * unweighted the horizontal term drowns the vertical one: on level 1, running
 * right earned 1105 of the 1200 points available and the final climb, which
 * is the only hard part, was worth 95. Agents duly learned to sprint right,
 * pass under the certificate and pile into the wall. Scaling the vertical
 * term by the same ratio is what normalising both axes comes to, while
 * keeping the result in horizontal-equivalent pixels so the fitness scale and
 * PROGRESS_EPSILON below still mean what they did.
 */
export function distanceToCertificate(state: GameState, levelIndex: number): number {
  const level = LEVELS[levelIndex];
  const verticalWeight = level.width / CANVAS_H;
  const dx = level.certificate.x - state.player.x;
  const dy = level.certificate.y - state.player.y;
  return Math.hypot(dx, dy * verticalWeight);
}

export function startRun(levelIndex: number): Run {
  const state = createPlayingState(levelIndex);
  return {
    state,
    frames: 0,
    closest: distanceToCertificate(state, levelIndex),
    highest: state.player.y,
    framesSinceProgress: 0,
    outcome: RunOutcome.Running,
  };
}

function outcomeOf(run: Run): RunOutcome {
  if (hasFinishedLevel(run.state)) {
    return RunOutcome.Solved;
  }
  if (hasDied(run.state)) {
    return RunOutcome.Died;
  }
  if (run.framesSinceProgress >= STALE_FRAMES) {
    return RunOutcome.Stalled;
  }
  return run.frames >= RUN_FRAME_BUDGET ? RunOutcome.OutOfTime : RunOutcome.Running;
}

/**
 * Advances a live run by one frame with an action already chosen, so a trainer
 * that samples its own actions still ends runs by exactly the same rules.
 */
export function stepRun(run: Run, input: Input, levelIndex: number): Run {
  if (run.outcome !== RunOutcome.Running) {
    return run;
  }
  const state = step(run.state, input);
  const distance = distanceToCertificate(state, levelIndex);
  const madeProgress = distance < run.closest - PROGRESS_EPSILON;
  const advanced: Run = {
    state,
    frames: run.frames + 1,
    closest: Math.min(run.closest, distance),
    highest: Math.min(run.highest, state.player.y),
    framesSinceProgress: madeProgress ? 0 : run.framesSinceProgress + 1,
    outcome: RunOutcome.Running,
  };
  return { ...advanced, outcome: outcomeOf(advanced) };
}

/** Advances a live run by a single frame. A finished run is returned as is. */
export function advanceRun(
  run: Run,
  genome: Genome,
  levelIndex: number,
  architecture: Architecture = DEFAULT_ARCHITECTURE,
  policy: Policy = actionFor
): Run {
  if (run.outcome !== RunOutcome.Running) {
    return run;
  }
  return stepRun(run, policy(genome, run.state, LEVELS[levelIndex], architecture), levelIndex);
}

export type Point = { x: number; y: number };

/** Where the player was, sampled coarsely enough to be cheap to keep. */
export const PATH_SAMPLE_EVERY = 4;

export function pathPointOf(run: Run): Point {
  const { player } = run.state;
  return { x: player.x + player.w / 2, y: player.y + player.h / 2 };
}

/**
 * Plays a genome out. Pass `path` and it is filled with where the player went,
 * which is what lets the trainer show its work; leave it out and nothing is
 * allocated, which is what the command line trainer wants.
 */
export function finishRun(
  genome: Genome,
  levelIndex: number,
  architecture: Architecture = DEFAULT_ARCHITECTURE,
  path?: Point[],
  policy: Policy = actionFor
): Run {
  let run = startRun(levelIndex);
  path?.push(pathPointOf(run));
  while (run.outcome === RunOutcome.Running) {
    run = advanceRun(run, genome, levelIndex, architecture, policy);
    if (path !== undefined && run.frames % PATH_SAMPLE_EVERY === 0) {
      path.push(pathPointOf(run));
    }
  }
  return run;
}

/** Reaching the certificate outranks everything; among solutions, speed wins. */
const SOLVE_BONUS = 2000;

export function fitnessOf(run: Run): number {
  if (run.outcome === RunOutcome.Solved) {
    return SOLVE_BONUS + (RUN_FRAME_BUDGET - run.frames);
  }
  return -run.closest;
}
