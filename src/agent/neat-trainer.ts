// The NEAT population wired into the same trainer interface as the rest, so
// the console can run it, chart it and replay it without knowing that this one
// evolves its network's shape as well as its weights.
//
// The recording format keeps a genome as a flat list of numbers. A NEAT genome
// is a graph, so it is written into that list and read back by the policy;
// see encodeGenome. The architecture stored alongside says `neat`, which is
// what tells the console to draw the graph rather than a stack of layers.
import { DEFAULT_ARCHITECTURE, type Architecture, type Policy } from "./policy";
import { createRandom } from "./random";
import { RunOutcome, finishRun, fitnessOf, type Point } from "./run";
import { makeTrainer, type GenerationRecord, type Trainer, type TrainerOptions } from "./evolution";
import {
  actionForNeat,
  createInnovations,
  decodeGenome,
  encodeGenome,
  minimalGenome,
  nextNeatGeneration,
  speciate,
  type NeatGenome,
  type Species,
} from "./neat";

export const POPULATION_SIZE = 80;
export const GENERATIONS = 100;
const TRAINING_SEED = 20260914;

/**
 * NEAT decides its own hidden layers, so there are none to declare. The marker
 * is what the console and the loader check rather than the layer list, which
 * would otherwise read as "a network with no hidden nodes at all".
 */
export const NEAT_ARCHITECTURE: Architecture = { ...DEFAULT_ARCHITECTURE, hidden: [], kind: "neat" };

export function isNeat(architecture: Architecture): boolean {
  return architecture.kind === "neat";
}

/** The policy the replay and the trainer share, reading the graph back out. */
export const neatPolicy: Policy = (flat, state, level) => actionForNeat(decodeGenome(flat), state, level);

export function createNeatTrainer(levelIndex: number, options: TrainerOptions = {}): Trainer {
  const { seed = TRAINING_SEED + levelIndex } = options;
  const random = createRandom(seed);
  const innovations = createInnovations();
  let population: NeatGenome[] = Array.from({ length: POPULATION_SIZE }, () =>
    minimalGenome(random, innovations)
  );
  let species: Species[] = [];
  let fitnesses: number[] = [];
  let solved = 0;
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let lastPath: Point[] = [];

  function closeGeneration(): void {
    const bestIndex = fitnesses.indexOf(Math.max(...fitnesses));
    species = speciate(population, species);
    generations.push({
      generation: generations.length + 1,
      bestFitness: fitnesses[bestIndex],
      meanFitness: fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length,
      solved,
      genome: encodeGenome(population[bestIndex]),
    });
    population = nextNeatGeneration(population, fitnesses, species, random, innovations);
    fitnesses = [];
    solved = 0;
  }

  return makeTrainer({
    levelIndex,
    architecture: NEAT_ARCHITECTURE,
    totalGenerations: GENERATIONS,
    generations,
    lastPath: () => lastPath,
    framesSimulated: () => framesSimulated,
    generationProgress: () => fitnesses.length / POPULATION_SIZE,
    evaluateNext(): boolean {
      const path = options.recordPaths === true ? [] : undefined;
      const run = finishRun(
        encodeGenome(population[fitnesses.length]),
        levelIndex,
        NEAT_ARCHITECTURE,
        path,
        neatPolicy
      );
      if (path !== undefined) {
        lastPath = path;
      }
      fitnesses.push(fitnessOf(run));
      solved += run.outcome === RunOutcome.Solved ? 1 : 0;
      framesSimulated += run.frames;
      if (fitnesses.length < POPULATION_SIZE) {
        return false;
      }
      closeGeneration();
      return true;
    },
  });
}
