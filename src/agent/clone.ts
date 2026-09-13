// Learning by copying someone who already plays: take an agent that works,
// write down what it pressed in every state it met, and fit a fresh network to
// those pairs with ordinary supervised descent.
//
// This is the control experiment for the whole AI side. The teacher is a
// network of exactly the same shape, so the student can in principle match it
// perfectly. If copying works and the policy gradient does not, the difference
// cannot be the architecture or the features: it is the learning signal.
import { LEVELS } from "../engine";
import {
  DEFAULT_ARCHITECTURE,
  features,
  forwardPass,
  genomeSize,
  outputsOf,
  randomGenome,
  roundWeight,
  type Architecture,
  type Genome,
} from "./policy";
import { backpropagate, outputLayer } from "./backprop";
import { createRandom } from "./random";
import {
  PATH_SAMPLE_EVERY,
  RunOutcome,
  advanceRun,
  finishRun,
  fitnessOf,
  pathPointOf,
  startRun,
  type Point,
} from "./run";
import { makeTrainer, type GenerationRecord, type Trainer, type TrainerOptions } from "./evolution";

/**
 * Passes over the lesson set between two points on the chart, and how many of
 * those points there are. Two thousand passes is what it takes to copy the
 * teacher closely enough to reproduce its run; a hundred leaves the error at
 * 0.08, which is larger than the 0.2 threshold a button sits behind and so
 * flips presses at exactly the wrong moments.
 *
 * Split this way because one pass is a few milliseconds and twenty is not: the
 * browser scores one pass per call and the chart still gets a hundred points,
 * like every other method.
 */
const EPOCHS_PER_GENERATION = 20;
const GENERATIONS = 100;
const LEARNING_RATE = 0.5;
const TRAINING_SEED = 20260913;

/**
 * A state the teacher met, and what it did there. The target is the teacher's
 * raw output rather than the button it became, because a button throws away
 * how strongly it was pressed and that is exactly the gradient we want.
 */
type Lesson = { inputs: number[]; targets: number[] };

export function recordLessons(teacher: Genome, levelIndex: number, architecture: Architecture): Lesson[] {
  const lessons: Lesson[] = [];
  let run = startRun(levelIndex);

  while (run.outcome === RunOutcome.Running) {
    const inputs = features(run.state, LEVELS[levelIndex]);
    lessons.push({ inputs, targets: outputsOf(forwardPass(teacher, inputs, architecture).activations) });
    run = advanceRun(run, teacher, levelIndex, architecture);
  }
  return lessons;
}

export function createCloneTrainerUsing(teacherFor: (levelIndex: number) => Genome) {
  return (levelIndex: number, options: TrainerOptions = {}): Trainer => {
    const { seed = TRAINING_SEED + levelIndex, architecture = DEFAULT_ARCHITECTURE } = options;
    const random = createRandom(seed);
    const lessons = recordLessons(teacherFor(levelIndex), levelIndex, architecture);
    let genome = randomGenome(random, architecture);
    const generations: GenerationRecord[] = [];
    let framesSimulated = 0;
    let lastPath: Point[] = [];
    let epochsThisGeneration = 0;

    function runEpoch(): number {
      const gradient = new Array<number>(genomeSize(architecture)).fill(0);
      let error = 0;

      for (const lesson of lessons) {
        const { activations } = forwardPass(genome, lesson.inputs, architecture);
        const outputs = activations[outputLayer(architecture)];
        // Squared error on the outputs, so the delta is the residual through
        // tanh's derivative. Descending it means subtracting the gradient.
        const delta = outputs.map((output, i) => {
          const residual = lesson.targets[i] - output;
          error += residual * residual;
          return residual * (1 - output * output);
        });
        backpropagate(gradient, genome, activations, delta, architecture);
      }

      const scale = LEARNING_RATE / lessons.length;
      genome = genome.map((weight, index) => roundWeight(weight + scale * gradient[index]));
      return error / lessons.length;
    }

    function closeGeneration(error: number): void {
      const path = options.recordPaths === true ? [] : undefined;
      const student = finishRun(genome, levelIndex, architecture, path);
      if (path !== undefined) {
        lastPath = path;
      }
      framesSimulated += student.frames;

      generations.push({
        generation: generations.length + 1,
        bestFitness: fitnessOf(student),
        // Mean squared error per lesson, negated so that up is better on the
        // same chart as everything else.
        meanFitness: -error,
        solved: student.outcome === RunOutcome.Solved ? 1 : 0,
        genome: [...genome],
      });
    }

    return makeTrainer({
      levelIndex,
      architecture,
      totalGenerations: GENERATIONS,
      generations,
      lastPath: () => lastPath,
      framesSimulated: () => framesSimulated,
      generationProgress: () => epochsThisGeneration / EPOCHS_PER_GENERATION,
      evaluateNext(): boolean {
        const error = runEpoch();
        epochsThisGeneration++;
        if (epochsThisGeneration < EPOCHS_PER_GENERATION) {
          return false;
        }
        closeGeneration(error);
        epochsThisGeneration = 0;
        return true;
      },
    });
  };
}

export { PATH_SAMPLE_EVERY, pathPointOf };
