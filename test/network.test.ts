import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  DEFAULT_ARCHITECTURE,
  chosenOutputs,
  isValueHead,
  outputLabelsFor,
  policyFor,
  FEATURE_LABELS,
  GENOME_SIZE,
  INPUT_SIZE,
  OUTPUT_LABELS,
  forward,
  genomeSize,
  layerSizes,
  layoutOf,
  outputsOf,
  randomGenome,
  type Architecture,
} from "../src/agent/policy";
import { checkHistory, createTrainer, type TrainingHistory } from "../src/agent/evolution";
import { createCmaesTrainer } from "../src/agent/cmaes";
import { createReinforceTrainer } from "../src/agent/reinforce";
import { HEIGHT_BINS, REACH_BINS, binOf, createMapElitesTrainer } from "../src/agent/map-elites";
import { recordLessons } from "../src/agent/clone";
import { parseHiddenLayers } from "../src/agent/console-chrome";
import { createWeightEditor } from "../src/agent/weight-editing";
import { createRandom } from "../src/agent/random";
import { DQN_ARCHITECTURE } from "../src/agent/dqn";
import { LEVELS, createPlayingState } from "../src/engine";
import { finishRun, startRun } from "../src/agent/run";
import { readFileSync } from "node:fs";

describe("the shape of the network", () => {
  test("every input and output has a name, in the order the features are built", () => {
    assert.equal(FEATURE_LABELS.length, INPUT_SIZE);
    assert.equal(OUTPUT_LABELS.length, DEFAULT_ARCHITECTURE.outputs);
  });

  test("the default is the 131 weights the recording holds", () => {
    assert.equal(GENOME_SIZE, 131);
    assert.equal(genomeSize(DEFAULT_ARCHITECTURE), 8 * (12 + 1) + 3 * (8 + 1));
  });

  test("a deeper network sizes itself", () => {
    const deep: Architecture = { inputs: 4, hidden: [3, 2], outputs: 1 };
    assert.deepEqual(layerSizes(deep), [4, 3, 2, 1]);
    assert.equal(genomeSize(deep), 3 * 5 + 2 * 4 + 1 * 3);
  });
});

describe("where the weights live", () => {
  test("the layout accounts for every weight exactly once", () => {
    // This is what makes it safe to point at a connection in the console and
    // say which of the stored numbers it is.
    for (const architecture of [
      DEFAULT_ARCHITECTURE,
      { inputs: 4, hidden: [3, 2], outputs: 1 },
      { inputs: 2, hidden: [], outputs: 2 },
    ] satisfies Architecture[]) {
      const seen = new Set<number>();
      for (const layer of layoutOf(architecture)) {
        for (let to = 0; to < layer.to; to++) {
          seen.add(layer.bias(to));
          for (let from = 0; from < layer.from; from++) {
            seen.add(layer.weight(to, from));
          }
        }
      }
      assert.equal(seen.size, genomeSize(architecture));
      assert.equal(Math.min(...seen), 0);
      assert.equal(Math.max(...seen), genomeSize(architecture) - 1);
    }
  });

  test("the layout points at the weight forward actually uses", () => {
    const architecture: Architecture = { inputs: 2, hidden: [1], outputs: 1 };
    const genome = Array.from({ length: genomeSize(architecture) }, () => 0);
    const [hidden] = layoutOf(architecture);

    // Only the second input feeds the hidden node, with weight 1.
    genome[hidden.weight(0, 1)] = 1;
    assert.equal(forward(genome, [0, 0.5], architecture)[1][0], Math.tanh(0.5));
    assert.equal(forward(genome, [0.5, 0], architecture)[1][0], 0, "the first input is not wired");
  });
});

describe("activations", () => {
  test("every layer comes back, inputs first and outputs last", () => {
    const inputs = Array.from({ length: INPUT_SIZE }, (_, i) => i / INPUT_SIZE);
    const activations = forward(randomGenome(), inputs);

    assert.deepEqual(activations[0], inputs);
    assert.deepEqual(
      activations.map((layer) => layer.length),
      layerSizes(DEFAULT_ARCHITECTURE)
    );
    assert.equal(outputsOf(activations).length, DEFAULT_ARCHITECTURE.outputs);
  });
});

describe("a recording and its architecture", () => {
  const history = (genomeLength: number): TrainingHistory => ({
    architecture: DEFAULT_ARCHITECTURE,
    levels: [
      {
        level: 0,
        bestGeneration: 0,
        generations: [
          {
            generation: 1,
            bestFitness: 0,
            meanFitness: 0,
            solved: 0,
            genome: Array.from({ length: genomeLength }, () => 0),
          },
        ],
      },
    ],
  });

  test("one that matches is accepted", () => {
    assert.doesNotThrow(() => checkHistory(history(GENOME_SIZE)));
  });

  test("one whose genomes do not fit the architecture is refused, not guessed at", () => {
    assert.throws(() => checkHistory(history(GENOME_SIZE - 1)), /stores 130 weights/);
  });
});

describe("the hidden layers you can type in", () => {
  test("a single number and a list both work", () => {
    assert.deepEqual(parseHiddenLayers("8"), [8]);
    assert.deepEqual(parseHiddenLayers("12,6"), [12, 6]);
    assert.deepEqual(parseHiddenLayers(" 12 , 6 "), [12, 6]);
  });

  test("no hidden layers at all is a straight line from inputs to outputs", () => {
    assert.deepEqual(parseHiddenLayers(""), []);
  });

  test("anything it cannot read is refused rather than half understood", () => {
    for (const bad of ["nonsense", "8,", "0", "-4", "2.5", "8 6", "9999"]) {
      assert.equal(parseHiddenLayers(bad), null, `"${bad}" should not parse`);
    }
  });
});

describe("two kinds of output head", () => {
  test("a control head reads three axes, a value head one per button combination", () => {
    assert.equal(isValueHead(DEFAULT_ARCHITECTURE), false);
    assert.equal(isValueHead(DQN_ARCHITECTURE), true);
    assert.equal(ACTIONS.length, 12, "three directions times jump times run");
    assert.equal(outputLabelsFor(DEFAULT_ARCHITECTURE).length, DEFAULT_ARCHITECTURE.outputs);
    assert.equal(outputLabelsFor(DQN_ARCHITECTURE).length, ACTIONS.length);
  });

  test("a value head lights the one output it acted on", () => {
    const values = [0, 0.4, -0.2, 0.9, 0.1, 0, 0, 0, 0, 0, 0, 0];
    const chosen = chosenOutputs(values, DQN_ARCHITECTURE);
    assert.equal(chosen.filter(Boolean).length, 1);
    assert.equal(chosen[3], true, "the largest value is the action taken");
  });

  test("the policy for a shape matches how that shape is read", () => {
    // What keeps a replay honest: a genome trained as a value head has to be
    // replayed by taking the largest value, not by thresholding three axes.
    const level = LEVELS[0];
    const state = createPlayingState(0);
    const values = randomGenome(undefined, DQN_ARCHITECTURE);
    const acted = policyFor(DQN_ARCHITECTURE)(values, state, level, DQN_ARCHITECTURE);
    assert.ok(
      ACTIONS.some(
        (action) =>
          action.left === acted.left &&
          action.right === acted.right &&
          action.jumpHeld === acted.jumpHeld &&
          action.run === acted.run
      ),
      "a value head can only produce one of the listed combinations"
    );
  });
});

describe("search that learns where to look", () => {
  test("CMA-ES reaches the same place on far less simulation", () => {
    // Over nine full runs each, measured outside the suite, the two solve
    // equally often (7 of 9) and their best runs are within thirty frames of
    // each other, while CMA-ES simulates 9.8M frames against 29.7M. What is
    // cheap enough to assert here is that gap, and that CMA-ES is a working
    // optimiser rather than merely a frugal one.
    const GENERATIONS = 40;
    let cmaesFrames = 0;
    let evolutionFrames = 0;
    let cmaesSolved = 0;

    for (const seed of [1, 2]) {
      const cmaes = createCmaesTrainer(0, { seed });
      const evolution = createTrainer(0, { seed });
      for (let i = 0; i < GENERATIONS; i++) {
        cmaesSolved += cmaes.runGeneration().solved > 0 ? 1 : 0;
        evolution.runGeneration();
      }
      cmaesFrames += cmaes.framesSimulated;
      evolutionFrames += evolution.framesSimulated;
    }

    assert.ok(
      cmaesFrames < evolutionFrames / 2,
      `CMA-ES simulated ${cmaesFrames} frames against the evolution's ${evolutionFrames}`
    );
    assert.ok(cmaesSolved > 0, "CMA-ES should reach the certificate within forty generations");
  });
});

describe("what every trainer shares", () => {
  const factories = [
    ["evolutie", createTrainer],
    ["gradient", createReinforceTrainer],
    ["CMA-ES", createCmaesTrainer],
    ["MAP-Elites", createMapElitesTrainer],
  ] as const;

  for (const [name, make] of factories) {
    test(`${name}: the shared readings stay live`, () => {
      // Regression: MAP-Elites once spread the shared builder into a new object
      // to bolt its archive on, which reads the getters once and freezes them.
      // framesSimulated would then sit at zero and done would never turn true.
      const trainer = make(0, { seed: 5 });
      const before = trainer.framesSimulated;
      assert.equal(trainer.done, false);

      trainer.runGeneration();
      const after = trainer.framesSimulated;
      assert.equal(before, 0);
      assert.ok(after > before, "frames simulated should count up");
      assert.equal(trainer.generations.length, 1);
      assert.equal(trainer.toHistory().level, 0);
    });
  }
});

describe("the pieces the methods are built from", () => {
  test("a lesson set is one entry per frame the teacher played", () => {
    const history = JSON.parse(
      readFileSync(new URL("../src/agent/training-history.json", import.meta.url), "utf8")
    ) as TrainingHistory;
    const level = history.levels[0];
    const teacher = level.generations[level.bestGeneration].genome;

    const played = finishRun(teacher, 0, DEFAULT_ARCHITECTURE);
    const lessons = recordLessons(teacher, 0, DEFAULT_ARCHITECTURE);

    assert.equal(lessons.length, played.frames, "a lesson for every frame it was asked to act");
    assert.ok(
      lessons.every((lesson) => lesson.inputs.length === DEFAULT_ARCHITECTURE.inputs),
      "every lesson sees the same thing the network does"
    );
  });

  test("a behaviour lands in the cell its reach and height say it should", () => {
    // The two axes of the archive, so a mistake here would quietly file every
    // agent under the same behaviour and the grid would say nothing.
    const start = startRun(0);
    const first = binOf(start, 0);
    assert.ok(first >= 0 && first < REACH_BINS * HEIGHT_BINS);

    const further = { ...start, state: { ...start.state, player: { ...start.state.player, x: 1400 } } };
    assert.ok(binOf(further, 0) > first, "getting further along moves it along the row");

    const higher = { ...start, highest: 0 };
    assert.notEqual(binOf(higher, 0), first, "climbing moves it to another row");
  });
});

describe("editing a weight by hand", () => {
  const architecture = DEFAULT_ARCHITECTURE;
  const recorded = randomGenome(createRandom(4), architecture);
  const target = { architecture, recorded, levelIndex: 0 };
  const connection = { layer: 0, to: 2, from: 3 };
  const index = layoutOf(architecture)[connection.layer].weight(connection.to, connection.from);

  test("nothing is said until you pick a connection", () => {
    const editor = createWeightEditor(() => undefined);
    assert.equal(editor.describe(target, recorded), null);
    assert.equal(editor.edited, null);
  });

  test("an arrow moves exactly the weight you picked, and nothing else", () => {
    let replayed = 0;
    const editor = createWeightEditor(() => {
      replayed++;
    });
    editor.select(connection);

    assert.equal(editor.handleKey("ArrowUp", target), true);
    const edited = editor.edited;
    assert.ok(edited);
    assert.ok(edited[index] > recorded[index], "the picked weight goes up");
    for (const [at, value] of edited.entries()) {
      if (at !== index) {
        assert.equal(value, recorded[at], `weight ${String(at)} moved as well`);
      }
    }
    assert.equal(replayed, 1, "and the run is played again so you can see it");
  });

  test("Backspace puts the recording back", () => {
    const editor = createWeightEditor(() => undefined);
    editor.select(connection);
    editor.handleKey("ArrowDown", target);
    assert.ok(editor.edited);

    assert.equal(editor.handleKey("Backspace", target), true);
    assert.equal(editor.edited, null);
  });

  test("a key it has no business with is left alone", () => {
    const editor = createWeightEditor(() => undefined);
    editor.select(connection);
    assert.equal(editor.handleKey("q", target), false);
  });

  test("it names the weight it is on, and where it sits", () => {
    const editor = createWeightEditor(() => undefined);
    editor.select(connection);
    const described = editor.describe(target, recorded);
    assert.ok(described !== null);
    assert.ok(described.includes(`Gewicht ${String(index)}`));
    assert.ok(described.includes("laag 1"), "and which layer it is in, counted from one");
  });
});
