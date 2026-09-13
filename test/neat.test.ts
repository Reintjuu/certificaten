import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../src/agent/random";
import {
  NODE_INPUTS,
  NODE_OUTPUTS,
  activate,
  compatibility,
  createInnovations,
  crossover,
  decodeGenome,
  encodeGenome,
  minimalGenome,
  mutate,
  speciate,
  type NeatGenome,
} from "../src/agent/neat";
import { createNeatTrainer } from "../src/agent/neat-trainer";
import { depthsOf, liveNodes, placeNodes } from "../src/agent/neat-view";

const FIRST_OUTPUT = NODE_INPUTS;
const FIRST_HIDDEN = FIRST_OUTPUT + NODE_OUTPUTS;

function grown(steps: number, seed = 5): NeatGenome {
  const random = createRandom(seed);
  const innovations = createInnovations();
  let genome = minimalGenome(random, innovations);
  for (let step = 0; step < steps; step++) {
    genome = mutate(genome, random, innovations);
  }
  return genome;
}

describe("a network that starts with nothing in the middle", () => {
  test("the first genome is inputs, bias and outputs, and no more", () => {
    const genome = minimalGenome(createRandom(1), createInnovations());

    assert.equal(genome.nodes, FIRST_HIDDEN, "no hidden nodes to begin with");
    assert.equal(genome.connections.length, NODE_INPUTS * NODE_OUTPUTS);
    assert.ok(
      genome.connections.every((connection) => connection.to >= FIRST_OUTPUT),
      "nothing points back into an input"
    );
  });

  test("it answers with one number per button", () => {
    const outputs = activate(
      minimalGenome(createRandom(2), createInnovations()),
      Array.from({ length: NODE_INPUTS }, () => 0.5)
    );
    assert.equal(outputs.length, NODE_OUTPUTS);
    assert.ok(
      outputs.every((value) => value >= -1 && value <= 1),
      "tanh keeps them in range"
    );
  });

  test("the same genome and the same input always give the same answer", () => {
    const genome = grown(40);
    const inputs = Array.from({ length: NODE_INPUTS }, (_, index) => Math.sin(index));
    assert.deepEqual(activate(genome, inputs), activate(genome, inputs));
  });
});

describe("growing it", () => {
  test("splitting a connection barely changes what the network does", () => {
    // The new node carries the old weight with a 1 in front of it, so a
    // topology change has to survive on its own merits rather than be judged
    // on the jolt it caused.
    const random = createRandom(9);
    const innovations = createInnovations();
    const before = minimalGenome(random, innovations);
    const inputs = Array.from({ length: NODE_INPUTS }, () => 0.4);

    let after = before;
    for (let attempt = 0; attempt < 200 && after.nodes === before.nodes; attempt++) {
      after = { nodes: before.nodes, connections: before.connections.map((c) => ({ ...c })) };
      after = mutateWithoutWeights(after, innovations);
    }
    assert.ok(after.nodes > before.nodes, "a node was added at all");

    const drift = activate(after, inputs).map((value, index) =>
      Math.abs(value - activate(before, inputs)[index])
    );
    assert.ok(Math.max(...drift) < 0.35, `splitting moved the outputs by ${Math.max(...drift).toFixed(2)}`);
  });

  /** addNode without the weight jitter, so the split is measured on its own. */
  function mutateWithoutWeights(
    genome: NeatGenome,
    innovations: ReturnType<typeof createInnovations>
  ): NeatGenome {
    const live = genome.connections.filter((connection) => connection.enabled);
    const chosen = live[0];
    chosen.enabled = false;
    const middle = genome.nodes;
    genome.connections.push(
      {
        from: chosen.from,
        to: middle,
        weight: 1,
        enabled: true,
        innovation: innovations.forConnection(chosen.from, middle),
      },
      {
        from: middle,
        to: chosen.to,
        weight: chosen.weight,
        enabled: true,
        innovation: innovations.forConnection(middle, chosen.to),
      }
    );
    return { nodes: genome.nodes + 1, connections: genome.connections };
  }

  test("it never grows a loop, so one pass through is enough", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const genome = grown(200, seed);
      const reachable = new Map<number, Set<number>>();
      for (const connection of genome.connections) {
        if (!connection.enabled) {
          continue;
        }
        const set = reachable.get(connection.from) ?? new Set<number>();
        set.add(connection.to);
        reachable.set(connection.from, set);
      }
      for (const [from, targets] of reachable) {
        const stack = [...targets];
        const seen = new Set<number>();
        while (stack.length > 0) {
          const node = stack.pop();
          if (node === undefined || seen.has(node)) {
            continue;
          }
          assert.notEqual(node, from, `seed ${seed} grew a cycle through node ${String(from)}`);
          seen.add(node);
          stack.push(...(reachable.get(node) ?? []));
        }
      }
    }
  });

  test("the same connection invented twice gets the same number", () => {
    // Which is the whole point of innovation numbers: two genomes that grew
    // the same edge separately have to be able to line it up.
    const innovations = createInnovations();
    assert.equal(innovations.forConnection(3, 20), innovations.forConnection(3, 20));
    assert.notEqual(innovations.forConnection(3, 20), innovations.forConnection(4, 20));
  });
});

describe("crossing and grouping", () => {
  test("a child takes its shape from the fitter parent", () => {
    const random = createRandom(3);
    const fitter = grown(60, 11);
    const other = grown(60, 12);
    const child = crossover(fitter, other, random);

    assert.equal(child.connections.length, fitter.connections.length);
    assert.deepEqual(
      child.connections.map((connection) => connection.innovation),
      fitter.connections.map((connection) => connection.innovation)
    );
  });

  test("a genome is more like itself than like anything else", () => {
    const one = grown(80, 21);
    const other = grown(80, 22);
    assert.equal(compatibility(one, one), 0);
    assert.ok(compatibility(one, other) > 0);
  });

  test("everyone lands in exactly one species", () => {
    const population = [1, 2, 3, 4, 5, 6].map((seed) => grown(60, seed));
    const species = speciate(population, []);
    const placed = species.flatMap((group) => group.members).sort((a, b) => a - b);

    assert.deepEqual(placed, [0, 1, 2, 3, 4, 5]);
    assert.ok(species.length >= 1);
  });
});

describe("writing a graph into a list of numbers", () => {
  test("what goes in comes back out", () => {
    const genome = grown(120, 7);
    assert.deepEqual(decodeGenome(encodeGenome(genome)), genome);
  });

  test("the recording stays plain numbers", () => {
    assert.ok(encodeGenome(grown(30)).every((value) => typeof value === "number" && Number.isFinite(value)));
  });
});

describe("drawing a shape nobody chose", () => {
  test("inputs are on the left and outputs on the right", () => {
    const genome = grown(150, 4);
    const depths = depthsOf(genome);
    const deepest = Math.max(...depths);

    for (let node = 0; node < NODE_INPUTS; node++) {
      assert.equal(depths[node], 0);
    }
    for (let node = FIRST_OUTPUT; node < FIRST_HIDDEN; node++) {
      assert.equal(depths[node], deepest, "outputs are drawn last whatever their depth");
    }
  });

  test("orphans left by a split are not drawn as if they were part of it", () => {
    // Splitting a connection and later disabling the halves leaves a node
    // with nothing attached. Drawing it suggests structure that is not there.
    const genome = grown(200, 13);
    const live = liveNodes(genome);
    for (const node of live) {
      const attached =
        node < FIRST_HIDDEN ||
        genome.connections.some(
          (connection) => connection.enabled && (connection.from === node || connection.to === node)
        );
      assert.ok(attached, `node ${String(node)} is counted as live but nothing reaches it`);
    }
    assert.ok(live.size <= genome.nodes);
  });

  test("every node lands somewhere on the canvas", () => {
    const genome = grown(150, 8);
    for (const at of placeNodes(genome, 480, 270)) {
      assert.ok(at.x >= 0 && at.x <= 480, `x ${String(at.x)} is off the canvas`);
      assert.ok(at.y >= 0 && at.y <= 270, `y ${String(at.y)} is off the canvas`);
    }
  });
});

describe("NEAT as a trainer", () => {
  test("it improves, and it grows while doing it", () => {
    const trainer = createNeatTrainer(0);
    const early: number[] = [];
    for (let generation = 0; generation < 12; generation++) {
      early.push(trainer.runGeneration().bestFitness);
    }

    assert.ok(
      Math.max(...early) > early[0],
      "twelve generations should find something better than the first"
    );
    const grownGenome = decodeGenome(trainer.generations[trainer.generations.length - 1].genome);
    assert.ok(grownGenome.nodes >= FIRST_HIDDEN, "it never loses the nodes the game needs");
  });
});
