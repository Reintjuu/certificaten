import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  forwardPass,
  genomeSize,
  layerSizes,
  randomGenome,
  type Architecture,
  type Genome,
} from "../src/agent/policy";
import { EXPLORATION, accumulate, createReinforceTrainer, type Step } from "../src/agent/reinforce";
import { createTrainer } from "../src/agent/evolution";
import { RunOutcome, finishRun, fitnessOf } from "../src/agent/run";
import { createRandom } from "../src/agent/random";
import { DEFAULT_ARCHITECTURE, GENOME_SIZE } from "../src/agent/policy";
import { createCloneTrainerUsing } from "../src/agent/clone";
import { readFileSync } from "node:fs";
import type { TrainingHistory } from "../src/agent/evolution";

const architecture: Architecture = { inputs: 4, hidden: [5, 3], outputs: 3 };

/**
 * log pi(sampled | state) for the Gaussian the trainer samples from, up to the
 * constant that does not depend on the weights.
 */
function logProbability(genome: Genome, inputs: number[], sampled: number[]): number {
  const { activations } = forwardPass(genome, inputs, architecture);
  const means = activations[activations.length - 1];
  return means.reduce(
    (total, mean, i) => total - (sampled[i] - mean) ** 2 / (2 * EXPLORATION * EXPLORATION),
    0
  );
}

describe("the policy gradient", () => {
  test("matches a numerical estimate of the same derivative", () => {
    // The chain rule through two hidden layers is easy to write down wrongly
    // and impossible to notice: training still runs, it just learns nothing.
    // Comparing against finite differences is the only honest check.
    const random = createRandom(4242);
    const genome = randomGenome(random, architecture);
    const inputs = Array.from({ length: architecture.inputs }, () => random() * 2 - 1);

    const { sums, activations } = forwardPass(genome, inputs, architecture);
    const sampled = activations[activations.length - 1].map((mean) => mean + (random() * 2 - 1) * 0.3);
    const step: Step = { sums, activations, sampled };

    const analytic = new Array<number>(genomeSize(architecture)).fill(0);
    accumulate(analytic, genome, step, 1, architecture);

    const epsilon = 1e-5;
    for (let index = 0; index < genome.length; index++) {
      const raised = [...genome];
      const lowered = [...genome];
      raised[index] += epsilon;
      lowered[index] -= epsilon;
      const numeric =
        (logProbability(raised, inputs, sampled) - logProbability(lowered, inputs, sampled)) / (2 * epsilon);

      assert.ok(
        Math.abs(numeric - analytic[index]) < 1e-3 * Math.max(1, Math.abs(numeric)),
        `weight ${index}: analytic ${analytic[index].toFixed(6)} but numerically ${numeric.toFixed(6)}`
      );
    }
  });

  test("every weight gets a gradient, so none of the network is dead", () => {
    const random = createRandom(7);
    const genome = randomGenome(random, architecture);
    const inputs = Array.from({ length: architecture.inputs }, () => 0.5 + random() * 0.5);
    const { sums, activations } = forwardPass(genome, inputs, architecture);
    const sampled = activations[activations.length - 1].map((mean) => mean + 0.3);

    const gradient = new Array<number>(genomeSize(architecture)).fill(0);
    accumulate(gradient, genome, { sums, activations, sampled }, 1, architecture);

    assert.equal(gradient.length, genomeSize(architecture));
    assert.ok(
      gradient.every((value) => Number.isFinite(value)),
      "a non-finite gradient would quietly poison every weight"
    );
    assert.ok(gradient.some((value) => value !== 0));
  });

  test("the architecture it was built for is the one it walks", () => {
    assert.deepEqual(layerSizes(architecture), [4, 5, 3, 3]);
  });
});

describe("why evolution wins here", () => {
  test("a single small weight change does not move the outcome at all", () => {
    // The buttons are thresholds, so the return as a function of the weights is
    // a staircase rather than a slope. A gradient method has almost nothing to
    // descend, while evolution mutates by 0.6 and simply keeps what wins. This
    // is the measured reason the two methods do not come out level.
    const history = JSON.parse(
      readFileSync(new URL("../src/agent/training-history.json", import.meta.url), "utf8")
    ) as TrainingHistory;
    const level = history.levels[0];
    const trained = level.generations[level.bestGeneration].genome;

    const base = finishRun(trained, 0, DEFAULT_ARCHITECTURE).closest;
    let unchanged = 0;
    for (let index = 0; index < trained.length; index++) {
      const nudged = [...trained];
      nudged[index] += 0.01;
      if (finishRun(nudged, 0, DEFAULT_ARCHITECTURE).closest === base) {
        unchanged++;
      }
    }

    assert.equal(trained.length, GENOME_SIZE);
    assert.ok(
      unchanged > trained.length * 0.9,
      `only ${unchanged} of ${trained.length} weights left the run untouched, so the ` +
        "landscape is smoother than the comment above claims"
    );
  });
});

describe("what a recorded generation claims", () => {
  // The bug this pins down: the gradient trainer stored the current weights
  // but recorded the best *sampled* episode's fitness. The stored genome plays
  // without exploration noise and so could never reproduce that number, which
  // made the chart report a solved level whenever the noise got lucky while
  // the agent itself still walked into the first enemy. Both trainers must be
  // able to stand behind the number they record.
  for (const [name, create] of [
    ["evolution", createTrainer],
    ["gradient", createReinforceTrainer],
  ] as const) {
    test(`${name}: every genome reproduces its own recorded fitness`, () => {
      const trainer = create(0, { seed: 99 });
      for (let i = 0; i < 3; i++) {
        trainer.runGeneration();
      }

      for (const record of trainer.generations) {
        const replayed = fitnessOf(finishRun(record.genome, 0, trainer.architecture));
        assert.ok(
          Math.abs(replayed - record.bestFitness) < 1e-6,
          `generation ${record.generation} recorded ${record.bestFitness.toFixed(2)} but its ` +
            `genome replays at ${replayed.toFixed(2)}`
        );
      }
    });
  }
});

describe("learning by copying", () => {
  test("a student reaches the teacher's own score", () => {
    // The control experiment for the whole AI side. The teacher is a network
    // of exactly the same shape, so if plain supervised descent reproduces its
    // run then the architecture and the features were never what held the
    // policy gradient back: the learning signal was.
    const history = JSON.parse(
      readFileSync(new URL("../src/agent/training-history.json", import.meta.url), "utf8")
    ) as TrainingHistory;
    const teacherFor = (level: number): number[] => {
      const recorded = history.levels[level];
      return recorded.generations[recorded.bestGeneration].genome;
    };

    const teacher = finishRun(teacherFor(0), 0, DEFAULT_ARCHITECTURE);
    assert.equal(teacher.outcome, RunOutcome.Solved, "the teacher has to be worth copying");

    const trainer = createCloneTrainerUsing(teacherFor)(0);
    let best = -Infinity;
    while (!trainer.done && best < fitnessOf(teacher)) {
      best = Math.max(best, trainer.runGeneration().bestFitness);
    }

    assert.equal(
      best,
      fitnessOf(teacher),
      "the student should reproduce the teacher's run exactly, not merely approach it"
    );
  });
});
