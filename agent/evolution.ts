// The genetic algorithm itself, free of Node so it runs in the browser too.
// It hands back one generation at a time, which lets the page train without
// freezing: run a generation per animation frame instead of blocking for the
// whole thing.
import { LEVELS, createPlayingState, hasDied, hasFinishedLevel, step } from "../src/engine";
import { RUN_FRAME_BUDGET, actionFor, randomGenome, type Genome } from "./policy";

export const POPULATION_SIZE = 80;
export const GENERATIONS = 60;

const ELITE_COUNT = 4;
const TOURNAMENT_SIZE = 4;
const MUTATION_RATE = 0.12;
const MUTATION_SCALE = 0.6;
const SOLVE_BONUS = 2000;
/** Small reward per frame survived, to favour living over dying early. */
const SURVIVAL_BONUS_PER_FRAME = 0.02;

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
  runGeneration: () => GenerationRecord;
  toHistory: () => LevelHistory;
};

export function evaluate(genome: Genome, levelIndex: number): Evaluation {
  let state = createPlayingState(levelIndex);
  const certificate = LEVELS[levelIndex].certificate;
  let closest = Infinity;
  let solved = false;
  let frame = 0;

  for (; frame < RUN_FRAME_BUDGET; frame++) {
    if (hasFinishedLevel(state)) {
      solved = true;
      break;
    }
    if (hasDied(state)) {
      break;
    }

    const player = state.player;
    closest = Math.min(closest, Math.hypot(certificate.x - player.x, certificate.y - player.y));
    state = step(state, actionFor(genome, state, LEVELS[levelIndex]));
  }

  const fitness = -closest + (solved ? SOLVE_BONUS : 0) + frame * SURVIVAL_BONUS_PER_FRAME;
  return { fitness, solved, frames: frame };
}

function mutate(genome: Genome): Genome {
  return genome.map((weight) =>
    Math.random() < MUTATION_RATE ? weight + (Math.random() * 2 - 1) * MUTATION_SCALE : weight
  );
}

function crossover(a: Genome, b: Genome): Genome {
  return a.map((weight, index) => (Math.random() < 0.5 ? weight : b[index]));
}

function tournamentWinner(population: Genome[], fitnesses: number[]): Genome {
  let winner = Math.floor(Math.random() * population.length);
  for (let i = 1; i < TOURNAMENT_SIZE; i++) {
    const challenger = Math.floor(Math.random() * population.length);
    if (fitnesses[challenger] > fitnesses[winner]) {
      winner = challenger;
    }
  }
  return population[winner];
}

function nextGeneration(population: Genome[], fitnesses: number[]): Genome[] {
  const ranked = population
    .map((genome, index) => ({ genome, fitness: fitnesses[index] }))
    .sort((a, b) => b.fitness - a.fitness);

  const offspring = ranked.slice(0, ELITE_COUNT).map((entry) => entry.genome);
  while (offspring.length < population.length) {
    offspring.push(
      mutate(crossover(tournamentWinner(population, fitnesses), tournamentWinner(population, fitnesses)))
    );
  }
  return offspring;
}

export function bestGenerationOf(generations: GenerationRecord[]): number {
  return generations.reduce(
    (best, record, index) => (record.bestFitness > generations[best].bestFitness ? index : best),
    0
  );
}

export function createTrainer(levelIndex: number): Trainer {
  let population = Array.from({ length: POPULATION_SIZE }, randomGenome);
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;

  return {
    levelIndex,
    generations,
    get framesSimulated() {
      return framesSimulated;
    },
    get done() {
      return generations.length >= GENERATIONS;
    },
    runGeneration(): GenerationRecord {
      const results = population.map((genome) => evaluate(genome, levelIndex));
      const fitnesses = results.map((result) => result.fitness);
      framesSimulated += results.reduce((total, result) => total + result.frames, 0);

      const bestIndex = fitnesses.indexOf(Math.max(...fitnesses));
      const record: GenerationRecord = {
        generation: generations.length + 1,
        bestFitness: fitnesses[bestIndex],
        meanFitness: fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length,
        solved: results.filter((result) => result.solved).length,
        genome: population[bestIndex],
      };
      generations.push(record);
      population = nextGeneration(population, fitnesses);
      return record;
    },
    toHistory(): LevelHistory {
      return { level: levelIndex, generations, bestGeneration: bestGenerationOf(generations) };
    },
  };
}
