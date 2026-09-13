// Quality-diversity: instead of hunting one best agent, fill a grid of
// behaviours and keep the best agent found for each. The axes here are how far
// along the level a run got and how high it ever climbed, which are the two
// things that distinguish the attempts you can see on screen.
//
// Level 1 is genuinely deceptive: running right is locally rewarding, but the
// certificate sits above a climb you have to set up for. An objective-only
// search has nothing pulling it towards the detour, while an archive keeps the
// odd agent that went high and never threw it away for scoring badly.
import { CANVAS_H, LEVELS } from "../engine";
import { DEFAULT_ARCHITECTURE, randomGenome, roundWeight, type Genome } from "./policy";
import { createRandom, type Random } from "./random";
import { RunOutcome, finishRun, fitnessOf, type Point, type Run } from "./run";
import { makeTrainer, type GenerationRecord, type Trainer, type TrainerOptions } from "./evolution";

/** Cells across the two behaviour axes. */
export const REACH_BINS = 16;
export const HEIGHT_BINS = 8;
/** Candidates tried per generation, and how many are random rather than bred. */
const CANDIDATES_PER_GENERATION = 80;
const GENERATIONS = 100;
const SEED_GENERATIONS = 8;
const MUTATION_RATE = 0.12;
const MUTATION_SCALE = 0.8;
const TRAINING_SEED = 20260916;

export type Elite = { genome: Genome; fitness: number; solved: boolean };
/** Row-major, REACH_BINS wide, with empty cells left null. */
export type Archive = (Elite | null)[];

export function binOf(run: Run, levelIndex: number): number {
  const level = LEVELS[levelIndex];
  const reach = Math.min(REACH_BINS - 1, Math.floor((run.state.player.x / level.width) * REACH_BINS));
  // Height measured downwards in the engine, so flip it to read as climbing.
  const climbed = 1 - Math.min(1, Math.max(0, run.highest / CANVAS_H));
  const height = Math.min(HEIGHT_BINS - 1, Math.floor(climbed * HEIGHT_BINS));
  return height * REACH_BINS + reach;
}

/** A trainer that also hands out its archive, which is the point of it. */
export type MapElitesTrainer = Trainer & { archive: Archive };

export function createMapElitesTrainer(levelIndex: number, options: TrainerOptions = {}): MapElitesTrainer {
  const { seed = TRAINING_SEED + levelIndex, architecture = DEFAULT_ARCHITECTURE } = options;
  const random = createRandom(seed);
  const archive: Archive = new Array<Elite | null>(REACH_BINS * HEIGHT_BINS).fill(null);
  const generations: GenerationRecord[] = [];
  let framesSimulated = 0;
  let triedThisGeneration = 0;
  let lastPath: Point[] = [];

  function occupied(): Elite[] {
    return archive.filter((cell): cell is Elite => cell !== null);
  }

  function mutate(genome: Genome, random: Random): Genome {
    return genome.map((weight) =>
      random() < MUTATION_RATE ? roundWeight(weight + (random() * 2 - 1) * MUTATION_SCALE) : weight
    );
  }

  /** Early on there is nothing to breed from, so the grid is seeded at random. */
  function nextCandidate(): Genome {
    const filled = occupied();
    if (generations.length < SEED_GENERATIONS || filled.length === 0) {
      return randomGenome(random, architecture);
    }
    return mutate(filled[Math.floor(random() * filled.length)].genome, random);
  }

  function tryCandidate(): void {
    const genome = nextCandidate();
    const path = options.recordPaths === true ? [] : undefined;
    const run = finishRun(genome, levelIndex, architecture, path);
    if (path !== undefined) {
      lastPath = path;
    }
    framesSimulated += run.frames;

    const cell = binOf(run, levelIndex);
    const fitness = fitnessOf(run);
    const sitting = archive[cell];
    // A cell only ever improves, which is what stops a good oddity from being
    // bred out the way an objective-only population would lose it.
    if (sitting === null || fitness > sitting.fitness) {
      archive[cell] = { genome, fitness, solved: run.outcome === RunOutcome.Solved };
    }
  }

  function closeGeneration(): void {
    const filled = occupied();
    const best = filled.reduce<Elite | null>(
      (found, cell) => (found === null || cell.fitness > found.fitness ? cell : found),
      null
    );

    generations.push({
      generation: generations.length + 1,
      bestFitness: best?.fitness ?? -Infinity,
      // How much of the grid is filled, scaled onto the chart. The point of
      // this method is coverage, so that is what the second line should show.
      meanFitness: (filled.length / archive.length) * 1000,
      solved: filled.filter((cell) => cell.solved).length,
      genome: best === null ? randomGenome(random, architecture) : [...best.genome],
    });
  }

  // Assigned onto the trainer rather than spread into a new object: the
  // shared builder returns getters, and spreading would read them once and
  // freeze done and framesSimulated at their starting values.
  return Object.assign(
    makeTrainer({
      levelIndex,
      architecture,
      totalGenerations: GENERATIONS,
      generations,
      lastPath: () => lastPath,
      framesSimulated: () => framesSimulated,
      generationProgress: () => triedThisGeneration / CANDIDATES_PER_GENERATION,
      evaluateNext(): boolean {
        tryCandidate();
        triedThisGeneration++;
        if (triedThisGeneration < CANDIDATES_PER_GENERATION) {
          return false;
        }
        closeGeneration();
        triedThisGeneration = 0;
        return true;
      },
    }),
    { archive }
  );
}
