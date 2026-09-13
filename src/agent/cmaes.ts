// Evolution that learns where to look. The plain genetic algorithm mutates
// every weight by the same amount in every direction; this keeps a mean and a
// per weight step size, and after each generation it moves the mean towards
// the candidates that did well and stretches the step size along the
// directions those candidates actually differed in.
//
// This is the separable form of CMA-ES: a diagonal covariance rather than a
// full matrix. It gives up correlations between weights and in exchange needs
// no eigendecomposition, which for 131 largely independent weights is a good
// trade and keeps the whole thing readable.
import { DEFAULT_ARCHITECTURE, genomeSize, roundWeight, type Genome } from "./policy";
import { createRandom, type Random } from "./random";
import { RunOutcome, finishRun, fitnessOf, type Point } from "./run";
import {
  bestGenerationOf,
  evaluate,
  type GenerationRecord,
  type LevelHistory,
  type Trainer,
  type TrainerOptions,
} from "./evolution";

/** Candidates per generation, and how many of them get a say in the next mean. */
const POPULATION = 24;
const PARENTS = 12;
const GENERATIONS = 100;
/** How far the first generation is scattered around the starting mean. */
const INITIAL_STEP = 0.6;
/** How fast the step sizes may grow or shrink per generation. */
const STEP_ADAPTION = 0.25;
const MIN_STEP = 0.01;
const MAX_STEP = 2;
const TRAINING_SEED = 20260915;

function gaussian(random: Random): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * Weights that fall off with rank, so the best candidate pulls hardest. The
 * standard CMA-ES choice, and it matters: weighting every parent equally
 * throws away most of what the ranking told you.
 */
function rankWeights(count: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => Math.log(count + 0.5) - Math.log(i + 1));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

export function createCmaesTrainer(levelIndex: number, options: TrainerOptions = {}): Trainer {
  const { seed = TRAINING_SEED + levelIndex, architecture = DEFAULT_ARCHITECTURE } = options;
  const random = createRandom(seed);
  const size = genomeSize(architecture);

  let mean = Array.from({ length: size }, () => roundWeight(random() * 2 - 1));
  let step = new Array<number>(size).fill(INITIAL_STEP);
  const weights = rankWeights(PARENTS);

  let population: Genome[] = [];
  let scored: { genome: Genome; fitness: number; solved: boolean }[] = [];
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let lastPath: Point[] = [];

  function sample(): Genome {
    return mean.map((centre, i) => roundWeight(centre + gaussian(random) * step[i]));
  }

  function fillPopulation(): void {
    population = Array.from({ length: POPULATION }, sample);
    scored = [];
  }

  function adapt(): void {
    const parents = scored.slice(0, PARENTS);
    const previous = mean;

    mean = mean.map((_, i) =>
      roundWeight(parents.reduce((sum, parent, p) => sum + weights[p] * parent.genome[i], 0))
    );

    // Per weight, how far the chosen parents strayed from where the mean was.
    // Spread out along an axis means that axis was worth exploring, so the
    // step grows there; huddled together means it was not, so it shrinks.
    step = step.map((current, i) => {
      const spread = Math.sqrt(
        parents.reduce((sum, parent, p) => sum + weights[p] * (parent.genome[i] - previous[i]) ** 2, 0)
      );
      const wanted = spread / Math.max(current, MIN_STEP);
      const adapted = current * Math.exp(STEP_ADAPTION * (wanted - 1));
      return Math.max(MIN_STEP, Math.min(MAX_STEP, adapted));
    });
  }

  function closeGeneration(): void {
    scored.sort((a, b) => b.fitness - a.fitness);
    adapt();

    // The mean is the agent this generation stands behind, so it is what gets
    // recorded and what the chart plots.
    const path = options.recordPaths === true ? [] : undefined;
    const centre = finishRun(mean, levelIndex, architecture, path);
    if (path !== undefined) {
      lastPath = path;
    }

    generations.push({
      generation: generations.length + 1,
      bestFitness: fitnessOf(centre),
      meanFitness: scored.reduce((sum, entry) => sum + entry.fitness, 0) / scored.length,
      solved: centre.outcome === RunOutcome.Solved ? 1 : 0,
      genome: [...mean],
    });
    fillPopulation();
  }

  fillPopulation();

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
      return scored.length / POPULATION;
    },
    evaluateNext(): boolean {
      const candidate = population[scored.length];
      const evaluation = evaluate(candidate, levelIndex, architecture);
      framesSimulated += evaluation.frames;
      scored.push({ genome: candidate, fitness: evaluation.fitness, solved: evaluation.solved });

      if (scored.length < POPULATION) {
        return false;
      }
      closeGeneration();
      return true;
    },
    runGeneration(): GenerationRecord {
      while (!this.evaluateNext()) {
        // Keep scoring until the generation is complete.
      }
      return generations[generations.length - 1];
    },
    toHistory(): LevelHistory {
      return { level: levelIndex, generations, bestGeneration: bestGenerationOf(generations) };
    },
  };
}
