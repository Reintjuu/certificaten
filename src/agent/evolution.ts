// The genetic algorithm itself, free of Node so it runs in the browser too.
// It hands out one candidate at a time rather than a whole generation, so the
// page can fit training into the gaps between frames instead of blocking on a
// generation for a quarter of a second at a time.
import {
  DEFAULT_ARCHITECTURE,
  genomeSize,
  randomGenome,
  roundWeight,
  type Architecture,
  type Genome,
} from "./policy";
import { createRandom, type Random } from "./random";
import { RunOutcome, finishRun, fitnessOf, type Point } from "./run";

export const POPULATION_SIZE = 80;
export const GENERATIONS = 100;

const ELITE_COUNT = 4;
const TOURNAMENT_SIZE = 4;
const MUTATION_RATE = 0.12;
const MUTATION_SCALE = 0.6;
/** Fixed so `npm run train-agent` reproduces the recording in the repo. */
const TRAINING_SEED = 20260910;

export type GenerationRecord = {
  generation: number;
  bestFitness: number;
  meanFitness: number;
  solved: number;
  genome: Genome;
};

export type LevelHistory = {
  level: number;
  generations: GenerationRecord[];
  bestGeneration: number;
};

/** What training-history.json holds. */
export type TrainingHistory = {
  architecture: Architecture;
  levels: LevelHistory[];
};

/**
 * A recording only means anything alongside the shape it was trained for: the
 * genome is a flat list of numbers, and the same list read as a different
 * architecture is quietly a different network. Rather than let that happen,
 * refuse it.
 */
export function checkHistory(history: TrainingHistory): TrainingHistory {
  const expected = genomeSize(history.architecture);
  for (const level of history.levels) {
    for (const record of level.generations) {
      if (record.genome.length !== expected) {
        throw new Error(
          `level ${level.level + 1} generation ${record.generation} stores ` +
            `${record.genome.length} weights, but the recorded architecture needs ${expected}`
        );
      }
    }
  }
  return history;
}

export type Evaluation = { fitness: number; solved: boolean; frames: number };

/**
 * Shared by every way of training an agent, so the console can swap one for
 * another without knowing which it has.
 */
export type TrainerOptions = {
  seed?: number;
  architecture?: Architecture;
  /** Keep the path of each candidate, for drawing. Off by default: the command
   * line trainer plays millions of frames and does not want the garbage. */
  recordPaths?: boolean;
};

export type Trainer = {
  levelIndex: number;
  architecture: Architecture;
  /**
   * How many generations this method runs. The console shows it, and reading
   * it from the trainer rather than from the evolution's own constant is what
   * keeps that counter honest when another method is selected.
   */
  totalGenerations: number;
  /** The path of the candidate scored most recently, empty unless asked for. */
  readonly lastPath: readonly Point[];
  generations: GenerationRecord[];
  readonly framesSimulated: number;
  readonly done: boolean;
  /** How far the generation in progress has got, 0..1. */
  readonly generationProgress: number;
  /** Scores one candidate; true once that completed the generation. */
  evaluateNext: () => boolean;
  runGeneration: () => GenerationRecord;
  toHistory: () => LevelHistory;
};

export function evaluate(
  genome: Genome,
  levelIndex: number,
  architecture: Architecture = DEFAULT_ARCHITECTURE,
  path?: Point[]
): Evaluation {
  const run = finishRun(genome, levelIndex, architecture, path);
  return {
    fitness: fitnessOf(run),
    solved: run.outcome === RunOutcome.Solved,
    frames: run.frames,
  };
}

function mutate(genome: Genome, random: Random): Genome {
  return genome.map((weight) =>
    random() < MUTATION_RATE ? roundWeight(weight + (random() * 2 - 1) * MUTATION_SCALE) : weight
  );
}

function crossover(a: Genome, b: Genome, random: Random): Genome {
  return a.map((weight, index) => (random() < 0.5 ? weight : b[index]));
}

function tournamentWinner(population: Genome[], fitnesses: number[], random: Random): Genome {
  let winner = Math.floor(random() * population.length);
  for (let i = 1; i < TOURNAMENT_SIZE; i++) {
    const challenger = Math.floor(random() * population.length);
    if (fitnesses[challenger] > fitnesses[winner]) {
      winner = challenger;
    }
  }
  return population[winner];
}

function nextGeneration(population: Genome[], fitnesses: number[], random: Random): Genome[] {
  const ranked = population
    .map((genome, index) => ({ genome, fitness: fitnesses[index] }))
    .sort((a, b) => b.fitness - a.fitness);

  const offspring = ranked.slice(0, ELITE_COUNT).map((entry) => entry.genome);
  while (offspring.length < population.length) {
    const parents = crossover(
      tournamentWinner(population, fitnesses, random),
      tournamentWinner(population, fitnesses, random),
      random
    );
    offspring.push(mutate(parents, random));
  }
  return offspring;
}

function bestGenerationOf(generations: GenerationRecord[]): number {
  return generations.reduce(
    (best, record, index) => (record.bestFitness > generations[best].bestFitness ? index : best),
    0
  );
}

/**
 * What a way of training actually has to provide. Everything else about a
 * trainer is the same whichever method it is, and six copies of it is six
 * chances for them to drift apart.
 */
export type TrainerParts = {
  levelIndex: number;
  architecture: Architecture;
  totalGenerations: number;
  generations: GenerationRecord[];
  /** Scores one candidate; true once that completed a generation. */
  evaluateNext: () => boolean;
  framesSimulated: () => number;
  /** How far the generation in progress has got, 0..1. */
  generationProgress: () => number;
  lastPath: () => readonly Point[];
};

export function makeTrainer(parts: TrainerParts): Trainer {
  return {
    levelIndex: parts.levelIndex,
    architecture: parts.architecture,
    totalGenerations: parts.totalGenerations,
    generations: parts.generations,
    get lastPath() {
      return parts.lastPath();
    },
    get framesSimulated() {
      return parts.framesSimulated();
    },
    get done() {
      return parts.generations.length >= parts.totalGenerations;
    },
    get generationProgress() {
      return parts.generationProgress();
    },
    evaluateNext: parts.evaluateNext,
    runGeneration(): GenerationRecord {
      while (!parts.evaluateNext()) {
        // Keep going until the generation is complete.
      }
      return parts.generations[parts.generations.length - 1];
    },
    toHistory(): LevelHistory {
      return {
        level: parts.levelIndex,
        generations: parts.generations,
        bestGeneration: bestGenerationOf(parts.generations),
      };
    },
  };
}

export function createTrainer(levelIndex: number, options: TrainerOptions = {}): Trainer {
  const { seed = TRAINING_SEED + levelIndex, architecture = DEFAULT_ARCHITECTURE } = options;
  const random = createRandom(seed);
  let population = Array.from({ length: POPULATION_SIZE }, () => randomGenome(random, architecture));
  let results: Evaluation[] = [];
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let lastPath: Point[] = [];

  function closeGeneration(): void {
    const fitnesses = results.map((result) => result.fitness);
    const bestIndex = fitnesses.indexOf(Math.max(...fitnesses));
    generations.push({
      generation: generations.length + 1,
      bestFitness: fitnesses[bestIndex],
      meanFitness: fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length,
      solved: results.filter((result) => result.solved).length,
      genome: population[bestIndex],
    });
    population = nextGeneration(population, fitnesses, random);
    results = [];
  }

  return makeTrainer({
    levelIndex,
    architecture,
    totalGenerations: GENERATIONS,
    generations,
    lastPath: () => lastPath,
    framesSimulated: () => framesSimulated,
    generationProgress: () => results.length / POPULATION_SIZE,
    evaluateNext(): boolean {
      lastPath = options.recordPaths === true ? [] : lastPath;
      const evaluation = evaluate(
        population[results.length],
        levelIndex,
        architecture,
        options.recordPaths === true ? lastPath : undefined
      );
      results.push(evaluation);
      framesSimulated += evaluation.frames;
      if (results.length < POPULATION_SIZE) {
        return false;
      }
      closeGeneration();
      return true;
    },
  });
}
