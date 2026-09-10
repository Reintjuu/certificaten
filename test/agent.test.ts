import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVELS, createPlayingState } from "../src/engine";
import {
  GENOME_SIZE,
  INPUT_SIZE,
  actionFor,
  features,
  forward,
  randomGenome,
  type Genome,
} from "../src/agent/policy";
import { evaluate, type LevelHistory } from "../src/agent/evolution";

const history = JSON.parse(
  readFileSync(new URL("../src/agent/training-history.json", import.meta.url), "utf8")
) as {
  levels: LevelHistory[];
};

describe("policy network", () => {
  test("sees a fixed-size, finite view of the world", () => {
    for (const [index] of LEVELS.entries()) {
      const values = features(createPlayingState(index), LEVELS[index]);
      assert.equal(values.length, INPUT_SIZE);
      assert.ok(values.every(Number.isFinite), `level ${index + 1} produced a non-finite feature`);
    }
  });

  test("copes with a level where every enemy is already gone", () => {
    const state = createPlayingState(0);
    state.enemies.forEach((enemy) => (enemy.alive = false));
    const values = features(state, LEVELS[0]);
    assert.equal(values.length, INPUT_SIZE);
    assert.ok(values.every(Number.isFinite));
  });

  test("outputs stay within tanh's range", () => {
    const state = createPlayingState(0);
    for (let i = 0; i < 50; i++) {
      for (const output of forward(randomGenome(), features(state, LEVELS[0]))) {
        assert.ok(output >= -1 && output <= 1, `output ${output} escaped the -1..1 range`);
      }
    }
  });

  test("every weight in the genome is actually used", () => {
    // Guards the hand-rolled weight layout: if GENOME_SIZE and the indexing in
    // forward() ever drift apart, some weights silently stop mattering.
    // Inputs are all non-zero and the base weights are small, so nothing is
    // masked by a zero feature or a saturated tanh.
    const inputs = Array.from({ length: INPUT_SIZE }, (_, i) => 0.5 + i * 0.05);
    const base: Genome = Array.from({ length: GENOME_SIZE }, () => 0.01);
    const baseline = forward(base, inputs);

    for (let index = 0; index < GENOME_SIZE; index++) {
      const nudged = [...base];
      nudged[index] += 0.5;
      assert.notDeepEqual(forward(nudged, inputs), baseline, `weight ${index} has no effect on the output`);
    }
  });

  test("never asks to walk left and right at the same time", () => {
    const state = createPlayingState(0);
    for (let i = 0; i < 200; i++) {
      const action = actionFor(randomGenome(), state, LEVELS[0]);
      assert.ok(!(action.left && action.right));
    }
  });

  test("the same genome and state always give the same action", () => {
    const state = createPlayingState(1);
    const genome = randomGenome();
    assert.deepEqual(actionFor(genome, state, LEVELS[1]), actionFor(genome, state, LEVELS[1]));
  });
});

describe("recorded training history", () => {
  test("covers every level", () => {
    assert.equal(history.levels.length, LEVELS.length);
  });

  test("stores a well-formed genome for every generation", () => {
    for (const level of history.levels) {
      assert.ok(level.generations.length > 0, `level ${level.level + 1} has no generations`);
      for (const record of level.generations) {
        assert.equal(record.genome.length, GENOME_SIZE);
        assert.ok(record.genome.every(Number.isFinite));
        assert.ok(record.solved >= 0);
      }
    }
  });

  test("bestGeneration really points at the highest-scoring generation", () => {
    for (const level of history.levels) {
      const best = Math.max(...level.generations.map((record) => record.bestFitness));
      assert.equal(level.generations[level.bestGeneration].bestFitness, best);
    }
  });

  test("each level's best genome still finishes that level", () => {
    // The engine is deterministic, so a stored genome must reproduce its run
    // exactly, so this fails if physics or level geometry changes without
    // retraining, which is precisely when the recording goes stale.
    for (const level of history.levels) {
      const best = level.generations[level.bestGeneration].genome;
      const result = evaluate(best, level.level);
      assert.equal(
        result.solved,
        true,
        `level ${level.level + 1}'s recorded best genome no longer solves it`
      );
    }
  });
});
