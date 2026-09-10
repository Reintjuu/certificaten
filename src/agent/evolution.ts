// The genetic algorithm itself, free of Node so it runs in the browser too.
// It hands out one candidate at a time rather than a whole generation, so the
// page can fit training into the gaps between frames instead of blocking on a
// generation for a quarter of a second at a time.
import { randomGenome, roundWeight, type Genome } from "./policy";
import { createRandom, type Random } from "./random";
import { RunOutcome, finishRun, fitnessOf } from "./run";

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

export type Evaluation = { fitness: number; solved: boolean; frames: number };

export type Trainer = {
  levelIndex: number;
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

export function evaluate(genome: Genome, levelIndex: number): Evaluation {
  const run = finishRun(genome, levelIndex);
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

export function bestGenerationOf(generations: GenerationRecord[]): number {
  return generations.reduce(
    (best, record, index) => (record.bestFitness > generations[best].bestFitness ? index : best),
    0
  );
}

export function createTrainer(levelIndex: number, seed = TRAINING_SEED + levelIndex): Trainer {
  const random = createRandom(seed);
  let population = Array.from({ length: POPULATION_SIZE }, () => randomGenome(random));
  let results: Evaluation[] = [];
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;

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

  return {
    levelIndex,
    generations,
    get framesSimulated() {
      return framesSimulated;
    },
    get done() {
      return generations.length >= GENERATIONS;
    },
    get generationProgress() {
      return results.length / POPULATION_SIZE;
    },
    evaluateNext(): boolean {
      const evaluation = evaluate(population[results.length], levelIndex);
      results.push(evaluation);
      framesSimulated += evaluation.frames;
      if (results.length < POPULATION_SIZE) {
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
