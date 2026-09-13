// Deep Q-learning: instead of a policy that says what to do, a network that
// says what each button combination is worth, and an agent that takes the best
// one. Twelve combinations come out of the game's buttons, which is small
// enough to score them all.
//
// This is the fair second attempt at reinforcement learning here. The policy
// gradient acts through thresholds on continuous outputs, and the return as a
// function of the weights is a staircase because of it. Choosing the largest
// of twelve values has no threshold to fall foul of: any change that reorders
// them changes the action, and any change that does not is genuinely neutral.
import { LEVELS } from "../engine";
import {
  ACTIONS,
  INPUT_SIZE,
  actionFromValues,
  features,
  forwardPass,
  genomeSize,
  layerSizes,
  randomGenome,
  roundWeight,
  type Architecture,
} from "./policy";
import { backpropagate, outputLayer } from "./backprop";
import { createRandom, type Random } from "./random";
import {
  PATH_SAMPLE_EVERY,
  RunOutcome,
  distanceToCertificate,
  finishRun,
  fitnessOf,
  pathPointOf,
  startRun,
  stepRun,
  type Point,
  type Run,
} from "./run";
import {
  bestGenerationOf,
  type GenerationRecord,
  type LevelHistory,
  type Trainer,
  type TrainerOptions,
} from "./evolution";

/** The value head has one output per action rather than three controls. */
export const DQN_ARCHITECTURE: Architecture = {
  inputs: INPUT_SIZE,
  hidden: [24],
  outputs: ACTIONS.length,
};

const EPISODES_PER_GENERATION = 8;
const GENERATIONS = 60;
const LEARNING_RATE = 0.05;
const DISCOUNT = 0.999;
/** Exploration, walked down from the first value to the second over the run. */
const EPSILON_START = 1;
const EPSILON_END = 0.05;
/** Transitions kept to learn from, and how many are replayed per step. */
const REPLAY_CAPACITY = 20000;
const BATCH_SIZE = 32;
/**
 * Frames between learning steps. Learning on every one costs five minutes a
 * level here, which is no use in a browser; the original paper replays every
 * fourth frame for the same reason.
 */
const LEARN_EVERY = 4;
/** Frames between copies of the live network into the one that sets targets. */
const TARGET_SYNC_FRAMES = 500;
/**
 * Frames of an episode advanced per call. Playing a whole one at a time is
 * twenty five milliseconds of replay learning, which overshoots the browser's
 * frame budget by more than it contains and drops the page to 34fps.
 */
const FRAMES_PER_CALL = 60;
const TRAINING_SEED = 20260914;

type Transition = {
  state: number[];
  action: number;
  reward: number;
  next: number[] | null;
};

/** Progress closed towards the certificate, which is what the score rewards. */
function rewardFor(before: number, after: number, run: Run): number {
  const progress = before - after;
  if (run.outcome === RunOutcome.Solved) {
    return progress + 100;
  }
  return run.outcome === RunOutcome.Died ? progress - 50 : progress;
}

function bestAction(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
}

export function createDqnTrainer(levelIndex: number, options: TrainerOptions = {}): Trainer {
  const { seed = TRAINING_SEED + levelIndex, architecture = DQN_ARCHITECTURE } = options;
  const random = createRandom(seed);
  let genome = randomGenome(random, architecture);
  let target = [...genome];
  const replay: Transition[] = [];
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let sinceSync = 0;
  let episodesThisGeneration = 0;
  let lastPath: Point[] = [];

  function epsilon(): number {
    const progress = Math.min(1, generations.length / GENERATIONS);
    return EPSILON_START + (EPSILON_END - EPSILON_START) * progress;
  }

  function remember(transition: Transition): void {
    replay.push(transition);
    if (replay.length > REPLAY_CAPACITY) {
      replay.shift();
    }
  }

  /**
   * One pass of Q-learning over a handful of remembered transitions. The
   * target comes from the frozen copy, which is what stops the network from
   * chasing its own moving estimate.
   */
  function learn(): void {
    if (replay.length < BATCH_SIZE) {
      return;
    }
    const gradient = new Array<number>(genomeSize(architecture)).fill(0);
    const outputs = layerSizes(architecture).at(-1) ?? 0;

    for (let i = 0; i < BATCH_SIZE; i++) {
      const sample = replay[Math.floor(random() * replay.length)];
      const { activations } = forwardPass(genome, sample.state, architecture);
      const values = activations[outputLayer(architecture)];

      let wanted = sample.reward;
      if (sample.next !== null) {
        const ahead = forwardPass(target, sample.next, architecture).activations[outputLayer(architecture)];
        wanted += DISCOUNT * ahead[bestAction(ahead)];
      }

      // Only the action that was taken has a target; the rest are left alone.
      const delta = new Array<number>(outputs).fill(0);
      const taken = values[sample.action];
      delta[sample.action] = (wanted - taken) * (1 - taken * taken);
      backpropagate(gradient, genome, activations, delta, architecture);
    }

    const scale = LEARNING_RATE / BATCH_SIZE;
    genome = genome.map((weight, index) => roundWeight(weight + scale * gradient[index]));
  }

  /** The episode in progress, carried between calls so one call stays short. */
  let current: Run | null = null;
  let distance = 0;
  let episodePath: Point[] = [];

  function beginEpisode(): Run {
    const run = startRun(levelIndex);
    distance = distanceToCertificate(run.state, levelIndex);
    episodePath = [pathPointOf(run)];
    return run;
  }

  /** Advances the episode by at most FRAMES_PER_CALL; true when it ended. */
  function advanceEpisode(random: Random): boolean {
    let run = current ?? beginEpisode();

    for (let i = 0; i < FRAMES_PER_CALL && run.outcome === RunOutcome.Running; i++) {
      const state = features(run.state, LEVELS[levelIndex]);
      const values = forwardPass(genome, state, architecture).activations[outputLayer(architecture)];
      const action = random() < epsilon() ? Math.floor(random() * ACTIONS.length) : bestAction(values);

      run = stepRun(run, ACTIONS[action], levelIndex);
      const after = distanceToCertificate(run.state, levelIndex);
      const ended = run.outcome !== RunOutcome.Running;
      remember({
        state,
        action,
        reward: rewardFor(distance, after, run),
        next: ended ? null : features(run.state, LEVELS[levelIndex]),
      });
      distance = after;

      if (run.frames % PATH_SAMPLE_EVERY === 0) {
        episodePath.push(pathPointOf(run));
      }
      if (run.frames % LEARN_EVERY === 0) {
        learn();
      }
      sinceSync++;
      if (sinceSync >= TARGET_SYNC_FRAMES) {
        target = [...genome];
        sinceSync = 0;
      }
    }

    current = run;
    if (run.outcome === RunOutcome.Running) {
      return false;
    }
    framesSimulated += run.frames;
    if (options.recordPaths === true) {
      lastPath = episodePath;
    }
    current = null;
    return true;
  }

  function closeGeneration(): void {
    const path = options.recordPaths === true ? [] : undefined;
    const greedy = finishRun(genome, levelIndex, architecture, path, actionFromValues);
    if (path !== undefined) {
      lastPath = path;
    }
    generations.push({
      generation: generations.length + 1,
      bestFitness: fitnessOf(greedy),
      meanFitness: fitnessOf(greedy),
      solved: greedy.outcome === RunOutcome.Solved ? 1 : 0,
      genome: [...genome],
    });
  }

  return {
    levelIndex,
    architecture,
    totalGenerations: GENERATIONS,
    generations,
    get lastPath() {
      return lastPath;
    },
    get framesSimulated() {
      return framesSimulated;
    },
    get done() {
      return generations.length >= GENERATIONS;
    },
    get generationProgress() {
      return episodesThisGeneration / EPISODES_PER_GENERATION;
    },
    evaluateNext(): boolean {
      if (!advanceEpisode(random)) {
        return false;
      }
      episodesThisGeneration++;
      if (episodesThisGeneration < EPISODES_PER_GENERATION) {
        return false;
      }
      closeGeneration();
      episodesThisGeneration = 0;
      return true;
    },
    runGeneration(): GenerationRecord {
      while (!this.evaluateNext()) {
        // Keep playing until the generation is complete.
      }
      return generations[generations.length - 1];
    },
    toHistory(): LevelHistory {
      return { level: levelIndex, generations, bestGeneration: bestGenerationOf(generations) };
    },
  };
}
