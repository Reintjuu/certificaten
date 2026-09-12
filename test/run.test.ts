import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/engine";
import { createTrainer } from "../src/agent/evolution";
import {
  RUN_FRAME_BUDGET,
  RunOutcome,
  STALE_FRAMES,
  advanceRun,
  fitnessOf,
  finishRun,
  startRun,
  type Run,
} from "../src/agent/run";
import { GENOME_SIZE, type Genome } from "../src/agent/policy";

/** A genome of zeroes: tanh(0) is 0, so it holds still and never jumps. */
const IDLE_GENOME: Genome = Array.from({ length: GENOME_SIZE }, () => 0);

const solvedRun = (frames: number): Run => ({
  state: startRun(0).state,
  frames,
  closest: 0,
  framesSinceProgress: 0,
  outcome: RunOutcome.Solved,
});

describe("when a run ends", () => {
  test("standing still is cut off as stalled, long before the frame budget", () => {
    const run = finishRun(IDLE_GENOME, 0);
    assert.equal(run.outcome, RunOutcome.Stalled);
    assert.ok(
      run.frames <= STALE_FRAMES + 1,
      `a motionless run took ${run.frames} frames to end, not about ${STALE_FRAMES}`
    );
    assert.ok(run.frames < RUN_FRAME_BUDGET, "it should never reach the hard budget");
  });

  test("a finished run ignores further frames", () => {
    const stalled = finishRun(IDLE_GENOME, 0);
    assert.deepEqual(advanceRun(stalled, IDLE_GENOME, 0), stalled);
  });

  test("progress towards the certificate keeps a run alive", () => {
    let run = startRun(0);
    for (let i = 0; i < STALE_FRAMES * 2; i++) {
      run = { ...run, framesSinceProgress: 0 };
      run = advanceRun(run, IDLE_GENOME, 0);
    }
    assert.notEqual(run.outcome, RunOutcome.Stalled);
  });
});

describe("what a run is worth", () => {
  test("reaching the certificate sooner scores higher", () => {
    assert.ok(fitnessOf(solvedRun(300)) > fitnessOf(solvedRun(900)));
  });

  test("any solution outscores any near miss", () => {
    const nearMiss: Run = { ...solvedRun(0), outcome: RunOutcome.Stalled, closest: 1 };
    assert.ok(fitnessOf(solvedRun(RUN_FRAME_BUDGET)) > fitnessOf(nearMiss));
  });

  test("getting closer scores higher when the certificate is missed", () => {
    const near: Run = { ...solvedRun(0), outcome: RunOutcome.Died, closest: 40 };
    const far: Run = { ...near, closest: 400 };
    assert.ok(fitnessOf(near) > fitnessOf(far));
  });
});

describe("training", () => {
  test("the same seed produces the same run twice", () => {
    const run = (): number[] => {
      const trainer = createTrainer(0, { seed: 12345 });
      for (let i = 0; i < 5; i++) {
        trainer.runGeneration();
      }
      return trainer.generations.map((record) => record.bestFitness);
    };
    assert.deepEqual(run(), run());
  });

  test("a generation is scored one candidate at a time", () => {
    // What keeps the browser responsive: the page can stop between candidates.
    const trainer = createTrainer(0, { seed: 999 });
    assert.equal(trainer.evaluateNext(), false, "one candidate cannot complete a generation");
    const progress = trainer.generationProgress;
    assert.ok(progress > 0 && progress < 1, `${progress} is not part-way through a generation`);
    assert.equal(trainer.generations.length, 0, "the generation is not recorded until it is done");
  });

  test("fitness improves on every level", () => {
    // A short run: enough to show learning happens at all. That the finished
    // agent actually solves its level is checked against the recording in
    // agent.test.ts, which does not cost a full training run here.
    const GENERATIONS_TO_SHOW_LEARNING = 12;
    for (const [index] of LEVELS.entries()) {
      const trainer = createTrainer(index);
      for (let i = 0; i < GENERATIONS_TO_SHOW_LEARNING; i++) {
        trainer.runGeneration();
      }
      const first = trainer.generations[0].bestFitness;
      const best = Math.max(...trainer.generations.map((record) => record.bestFitness));
      assert.ok(best > first, `level ${index + 1} learned nothing: ${first} -> ${best}`);
    }
  });
});
