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

/** Episodes per weight update. One episode's gradient is far too noisy. */
const EPISODES_PER_UPDATE = 40;
/** Updates per level, matching the evolution's generation count so the two
 * learning curves can be read on one chart. */
const UPDATES = 100;

const LEARNING_RATE = 3;
/** What the step size decays to by the last update. */
const LEARNING_RATE_FLOOR = 0.15;
/**
 * Spread of the noise added to the outputs when acting. It goes on the tanh'd
 * output rather than the sum behind it: once a sum grows past about two, tanh
 * is flat and noise on it changes no button at all, so every episode in a
 * batch came out identical and learning stopped dead.
 */
export const EXPLORATION = 0.4;

/**
 * How many frames one draw of exploration noise is held for. Redrawing it
 * every frame produces jitter rather than behaviour: the agent never holds a
 * jump or sustains a run, so the episodes it samples are not the kinds of
 * episode it needs to discover.
 */
const TRAINING_SEED = 20260911;

export type Step = {
  activations: number[][];
  sums: number[][];
  /** What was actually sampled at the output layer. */
  sampled: number[];
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
  path?.push(pathPointOf(run));

  while (run.outcome === RunOutcome.Running) {
    const { sums, activations } = forwardPass(genome, features(run.state, LEVELS[levelIndex]), architecture);
    const means = activations[activations.length - 1];
    const sampled = means.map((mean) => Math.max(-1, Math.min(1, mean + gaussian(random) * EXPLORATION)));

    run = stepRun(run, inputFromOutputs(sampled), levelIndex);
    if (path !== undefined && run.frames % PATH_SAMPLE_EVERY === 0) {
      path.push(pathPointOf(run));
    }
    steps.push({ activations, sums, sampled });
  }

  return { steps, run, frames: run.frames };
}

/**
 * How good the episode was, on exactly the scale the evolution is scored on, so
 * the two methods are optimising the same thing and their curves compare.
 *
 * Not a per frame return-to-go, which is what this used to do. With a reward
 * of "distance closed this frame", the return from frame t telescopes into
 * "the progress still to come", which is smaller the further along you already
 * are. Subtracting a baseline taken per frame number cannot remove that, so an
 * episode was penalised for having got somewhere, which is backwards.
 */
function episodeReturn(run: Run): number {
  return fitnessOf(run);
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

  /**
   * The step size winds down over the run. A fixed one finds a good policy and
   * then walks off it again: the late updates are as large as the early ones,
   * and with an advantage this noisy that is enough to undo the progress.
   */
  function learningRateFactor(): number {
    const progress = generations.length / UPDATES;
    return 1 - (1 - LEARNING_RATE_FLOOR) * progress;
  }

  function applyBatch(): void {
    const gradient = new Array<number>(genomeSize(architecture)).fill(0);
    const returns = batch.map(({ run }) => episodeReturn(run));
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const spread =
      Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length) || 1;

    batch.forEach((episode, index) => {
      const advantage = (returns[index] - mean) / spread;
      for (const step of episode.steps) {
        accumulate(gradient, genome, step, advantage, architecture);
      }
    });

    // Averaged over frames, not episodes. The gradient is a sum over every
    // step in the batch, some six thousand of them, so dividing by the twenty
    // episodes left an update large enough to blow the weights out in one go.
    const steps = batch.reduce((total, episode) => total + episode.steps.length, 0);
    const scale = (LEARNING_RATE * learningRateFactor()) / Math.max(1, steps);
    genome = genome.map((weight, index) => roundWeight(weight + scale * gradient[index]));

    // Scored by the policy without its exploration noise, because that is the
    // agent the genome below actually describes. Recording the best sampled
    // episode instead made the chart claim a solved level whenever the noise
    // got lucky, while the stored genome walked into the same enemy as ever.
    const greedy = finishRun(genome, levelIndex, architecture);
    generations.push({
      generation: generations.length + 1,
      bestFitness: fitnessOf(greedy),
      meanFitness: mean,
      // Also the greedy policy, for the same reason: a generation record has
      // to describe one agent, not a mix of the agent and its lucky samples.
      solved: greedy.outcome === RunOutcome.Solved ? 1 : 0,
      genome: [...genome],
    });
    batch = [];
  }

  return {
    levelIndex,
    architecture,
    totalGenerations: UPDATES,
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
