// The same network, taught a different way: policy gradient instead of
// evolution. Evolution never looks inside a run, it only scores the whole
// thing and breeds the winners. This nudges each weight in the direction that
// made the good frames more likely, which is a genuinely different answer to
// "how do you get better at this", and worth being able to watch side by side.
//
// It will not beat evolution here. The fastest route is already within two
// frames of what the physics allow, so there is nothing left to win; what this
// shows is how differently the two get there.
import { LEVELS } from "../engine";
import {
  DEFAULT_ARCHITECTURE,
  features,
  forwardPass,
  genomeSize,
  inputFromOutputs,
  layerSizes,
  layoutOf,
  randomGenome,
  roundWeight,
  type Architecture,
  type Genome,
} from "./policy";
import { createRandom, type Random } from "./random";
import {
  PATH_SAMPLE_EVERY,
  RunOutcome,
  distanceToCertificate,
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

/** Episodes per weight update. One episode's gradient is far too noisy. */
export const EPISODES_PER_UPDATE = 20;
/** Updates per level, matching the evolution's generation count so the two
 * learning curves can be read on one chart. */
export const UPDATES = 100;

const LEARNING_RATE = 8;
/**
 * Spread of the noise added to the outputs when acting. It goes on the tanh'd
 * output rather than the sum behind it: once a sum grows past about two, tanh
 * is flat and noise on it changes no button at all, so every episode in a
 * batch came out identical and learning stopped dead.
 */
export const EXPLORATION = 0.4;
const DISCOUNT = 0.99;
/** Terminal rewards, on the same scale as the per frame progress reward. */
const SOLVE_REWARD = 400;
const DEATH_REWARD = -100;
const TRAINING_SEED = 20260911;

export type Step = {
  activations: number[][];
  sums: number[][];
  /** What was actually sampled at the output layer. */
  sampled: number[];
  reward: number;
};

type Episode = { steps: Step[]; run: Run; frames: number };

/** Box-Muller, so the exploration noise is normal rather than uniform. */
function gaussian(random: Random): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function playEpisode(
  genome: Genome,
  levelIndex: number,
  architecture: Architecture,
  random: Random,
  path?: Point[]
): Episode {
  let run = startRun(levelIndex);
  const steps: Step[] = [];
  let distance = distanceToCertificate(run.state, levelIndex);
  path?.push(pathPointOf(run));

  while (run.outcome === RunOutcome.Running) {
    const { sums, activations } = forwardPass(genome, features(run.state, LEVELS[levelIndex]), architecture);
    const means = activations[activations.length - 1];
    const sampled = means.map((mean) => Math.max(-1, Math.min(1, mean + gaussian(random) * EXPLORATION)));

    run = stepRun(run, inputFromOutputs(sampled), levelIndex);
    if (path !== undefined && run.frames % PATH_SAMPLE_EVERY === 0) {
      path.push(pathPointOf(run));
    }
    const next = distanceToCertificate(run.state, levelIndex);
    // Dense on purpose: only paying out at the certificate leaves almost every
    // episode with nothing to learn from.
    steps.push({ activations, sums, sampled, reward: distance - next });
    distance = next;
  }

  // A run always takes at least one step, so there is always a last one to
  // hang the outcome on.
  if (steps.length > 0) {
    const last = steps[steps.length - 1];
    last.reward += run.outcome === RunOutcome.Solved ? SOLVE_REWARD : 0;
    last.reward += run.outcome === RunOutcome.Died ? DEATH_REWARD : 0;
  }
  return { steps, run, frames: run.frames };
}

/** Discounted return from each step to the end of its episode. */
function returnsToGo(steps: Step[]): number[] {
  const returns = new Array<number>(steps.length);
  let running = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    running = steps[i].reward + DISCOUNT * running;
    returns[i] = running;
  }
  return returns;
}

/**
 * Advantages, against a baseline taken per frame number rather than per
 * episode. A return-to-go shrinks towards the end of a run, so subtracting one
 * number from the whole episode would praise every early frame and blame every
 * late one whatever was done in them. Comparing frame 40 only against other
 * frame 40s takes that out. Without a value network this is the honest way to
 * get a baseline, and it costs one pass over the batch.
 */
function advantagesFor(episodes: number[][]): number[][] {
  const longest = Math.max(...episodes.map((returns) => returns.length), 0);
  const means = new Array<number>(longest).fill(0);
  const spreads = new Array<number>(longest).fill(1);

  for (let frame = 0; frame < longest; frame++) {
    const atFrame = episodes.filter((returns) => frame < returns.length).map((returns) => returns[frame]);
    const mean = atFrame.reduce((sum, value) => sum + value, 0) / atFrame.length;
    const variance = atFrame.reduce((sum, value) => sum + (value - mean) ** 2, 0) / atFrame.length;
    means[frame] = mean;
    spreads[frame] = Math.sqrt(variance) || 1;
  }

  return episodes.map((returns) => returns.map((value, frame) => (value - means[frame]) / spreads[frame]));
}

/**
 * Backpropagates one step's contribution into the gradient of
 * log pi(action | state) times the advantage. The action is the sampled sum at
 * the output layer, so d log pi / d sum is how far the sample landed from the
 * mean, over the variance. Everything behind that is the ordinary chain rule
 * through tanh, whose derivative is 1 - tanh^2 and therefore reads straight
 * off the activations we already kept.
 */
export function accumulate(
  gradient: number[],
  genome: Genome,
  step: Step,
  advantage: number,
  architecture: Architecture
): void {
  const layers = layoutOf(architecture);
  const sizes = layerSizes(architecture);

  // d log pi / d sum for a Gaussian around tanh(sum): how far the sample
  // landed from the mean, over the variance, through tanh's own derivative.
  const means = step.activations[sizes.length - 1];
  let delta = means.map(
    (mean, i) => ((step.sampled[i] - mean) / (EXPLORATION * EXPLORATION)) * (1 - mean * mean) * advantage
  );

  for (let layer = layers.length - 1; layer >= 0; layer--) {
    const wiring = layers[layer];
    const previous = step.activations[layer];

    for (let to = 0; to < wiring.to; to++) {
      gradient[wiring.bias(to)] += delta[to];
      for (let from = 0; from < wiring.from; from++) {
        gradient[wiring.weight(to, from)] += delta[to] * previous[from];
      }
    }

    if (layer === 0) {
      break;
    }
    const back = new Array<number>(wiring.from);
    for (let from = 0; from < wiring.from; from++) {
      let sum = 0;
      for (let to = 0; to < wiring.to; to++) {
        sum += delta[to] * genome[wiring.weight(to, from)];
      }
      // previous[from] is tanh of its own sum, so its derivative is 1 - a^2.
      back[from] = sum * (1 - previous[from] * previous[from]);
    }
    delta = back;
  }
}

export function createReinforceTrainer(levelIndex: number, options: TrainerOptions = {}): Trainer {
  const { seed = TRAINING_SEED + levelIndex, architecture = DEFAULT_ARCHITECTURE } = options;
  const random = createRandom(seed);
  let genome = randomGenome(random, architecture);
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let batch: Episode[] = [];
  let lastPath: Point[] = [];

  function applyBatch(): void {
    const gradient = new Array<number>(genomeSize(architecture)).fill(0);
    const returns = batch.map(({ steps }) => returnsToGo(steps));
    const advantages = advantagesFor(returns);

    batch.forEach((episode, index) => {
      episode.steps.forEach((step, frame) => {
        accumulate(gradient, genome, step, advantages[index][frame], architecture);
      });
    });

    // Averaged over frames, not episodes. The gradient is a sum over every
    // step in the batch, some six thousand of them, so dividing by the twenty
    // episodes left an update large enough to blow the weights out in one go.
    const steps = batch.reduce((total, episode) => total + episode.steps.length, 0);
    const scale = LEARNING_RATE / Math.max(1, steps);
    genome = genome.map((weight, index) => roundWeight(weight + scale * gradient[index]));

    const fitnesses = batch.map(({ run }) => fitnessOf(run));
    generations.push({
      generation: generations.length + 1,
      bestFitness: Math.max(...fitnesses),
      meanFitness: fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length,
      solved: batch.filter(({ run }) => run.outcome === RunOutcome.Solved).length,
      genome: [...genome],
    });
    batch = [];
  }

  return {
    levelIndex,
    architecture,
    generations,
    get lastPath() {
      return lastPath;
    },
    get framesSimulated() {
      return framesSimulated;
    },
    get done() {
      return generations.length >= UPDATES;
    },
    get generationProgress() {
      return batch.length / EPISODES_PER_UPDATE;
    },
    evaluateNext(): boolean {
      lastPath = options.recordPaths === true ? [] : lastPath;
      const episode = playEpisode(
        genome,
        levelIndex,
        architecture,
        random,
        options.recordPaths === true ? lastPath : undefined
      );
      framesSimulated += episode.frames;
      batch.push(episode);
      if (batch.length < EPISODES_PER_UPDATE) {
        return false;
      }
      applyBatch();
      return true;
    },
    runGeneration(): GenerationRecord {
      while (!this.evaluateNext()) {
        // Keep playing until the batch is full.
      }
      return generations[generations.length - 1];
    },
    toHistory(): LevelHistory {
      return { level: levelIndex, generations, bestGeneration: bestGenerationOf(generations) };
    },
  };
}
