// One definition of what a run is, when it ends and what it was worth.
// The trainer scores runs with it and the console replays them with it, so a
// ghost on screen stops exactly where the trainer stopped counting.
import { LEVELS, createPlayingState, hasDied, hasFinishedLevel, step, type GameState } from "../engine";
import { actionFor, type Genome } from "./policy";

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
  framesSinceProgress: number;
  outcome: RunOutcome;
};

function distanceToCertificate(state: GameState, levelIndex: number): number {
  const { x, y } = LEVELS[levelIndex].certificate;
  return Math.hypot(x - state.player.x, y - state.player.y);
}

export function startRun(levelIndex: number): Run {
  const state = createPlayingState(levelIndex);
  return {
    state,
    frames: 0,
    closest: distanceToCertificate(state, levelIndex),
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

/** Advances a live run by a single frame. A finished run is returned as is. */
export function advanceRun(run: Run, genome: Genome, levelIndex: number): Run {
  if (run.outcome !== RunOutcome.Running) {
    return run;
  }
  const state = step(run.state, actionFor(genome, run.state, LEVELS[levelIndex]));
  const distance = distanceToCertificate(state, levelIndex);
  const madeProgress = distance < run.closest - PROGRESS_EPSILON;
  const advanced: Run = {
    state,
    frames: run.frames + 1,
    closest: Math.min(run.closest, distance),
    framesSinceProgress: madeProgress ? 0 : run.framesSinceProgress + 1,
    outcome: RunOutcome.Running,
  };
  return { ...advanced, outcome: outcomeOf(advanced) };
}

export function finishRun(genome: Genome, levelIndex: number): Run {
  let run = startRun(levelIndex);
  while (run.outcome === RunOutcome.Running) {
    run = advanceRun(run, genome, levelIndex);
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
