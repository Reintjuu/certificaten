// NEAT: evolution that grows the network instead of filling in a fixed one.
//
// Everything else here trains a shape somebody chose: twelve inputs, eight
// hidden, three outputs, 131 weights, and the only question is what those
// weights should be. NEAT (Stanley and Miikkulainen, 2002) starts with no
// hidden nodes at all and lets mutation add a connection or split one into a
// node, so the shape is an outcome rather than a setting.
//
// Three parts make that work, and all three are here:
//
//  - Innovation numbers. A gene is stamped when it first appears, so two
//    genomes that both grew "input 3 to output 1" can be lined up and crossed
//    even though they arrived at it separately.
//  - Speciation. A fresh node almost always scores worse before it scores
//    better, so genomes are grouped by similarity and compete inside their
//    group. Without it every innovation is out-competed the generation it
//    appears and the topology never goes anywhere.
//  - Starting minimal. Nothing is added that has not paid for itself, which
//    is how it ends up with a small network rather than a pruned large one.
import type { GameState, Input, Level } from "../engine";
import { ACTIONS, features, type Genome } from "./policy";
import { createRandom, type Random } from "./random";

export const NODE_INPUTS = 12;
export const NODE_OUTPUTS = 3;
/**
 * No separate bias node: the feature list the game hands over already ends in
 * a constant 1, so an extra one would be the same node twice.
 */
export const FIRST_OUTPUT = NODE_INPUTS;
export const FIRST_HIDDEN = FIRST_OUTPUT + NODE_OUTPUTS;

export type Connection = {
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
  /** When this connection first appeared anywhere, which is how genes align. */
  innovation: number;
};

export type NeatGenome = {
  /** Highest node id in use; ids below FIRST_HIDDEN are fixed by the game. */
  nodes: number;
  connections: Connection[];
};

/**
 * Hands out innovation numbers, and hands out the *same* one twice when the
 * same connection is invented twice in a generation. That is the whole point:
 * two genomes that grew the same edge have to be able to line it up.
 */
export type Innovations = {
  forConnection: (from: number, to: number) => number;
  count: () => number;
};

export function createInnovations(): Innovations {
  const seen = new Map<string, number>();
  let next = 0;
  return {
    forConnection(from: number, to: number): number {
      const key = `${String(from)}>${String(to)}`;
      const existing = seen.get(key);
      if (existing !== undefined) {
        return existing;
      }
      seen.set(key, next);
      next++;
      return next - 1;
    },
    count: () => next,
  };
}

/** Inputs, bias and outputs, fully connected: the minimal network to start. */
export function minimalGenome(random: Random, innovations: Innovations): NeatGenome {
  const connections: Connection[] = [];
  for (let input = 0; input < NODE_INPUTS; input++) {
    for (let output = 0; output < NODE_OUTPUTS; output++) {
      const to = FIRST_OUTPUT + output;
      connections.push({
        from: input,
        to,
        weight: random() * 2 - 1,
        enabled: true,
        innovation: innovations.forConnection(input, to),
      });
    }
  }
  return { nodes: FIRST_HIDDEN, connections };
}

function isInput(node: number): boolean {
  return node < NODE_INPUTS;
}

function isOutput(node: number): boolean {
  return node >= FIRST_OUTPUT && node < FIRST_HIDDEN;
}

/**
 * Runs the network. The graph is kept acyclic by construction, so one pass in
 * dependency order is enough: a node is ready once everything feeding it has
 * a value, and anything still unresolved after a full sweep cannot become
 * ready at all.
 */
export function activate(genome: NeatGenome, inputs: number[]): number[] {
  const values = new Map<number, number>();
  for (let index = 0; index < NODE_INPUTS; index++) {
    values.set(index, inputs[index] ?? 0);
  }

  const incoming = new Map<number, Connection[]>();
  for (const connection of genome.connections) {
    if (!connection.enabled) {
      continue;
    }
    const list = incoming.get(connection.to) ?? [];
    list.push(connection);
    incoming.set(connection.to, list);
  }

  const pending = [...incoming.keys()];
  let resolved = true;
  while (pending.length > 0 && resolved) {
    resolved = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const node = pending[index];
      const sources = incoming.get(node) ?? [];
      if (!sources.every((connection) => values.has(connection.from))) {
        continue;
      }
      let sum = 0;
      for (const connection of sources) {
        sum += connection.weight * (values.get(connection.from) ?? 0);
      }
      values.set(node, Math.tanh(sum));
      pending.splice(index, 1);
      resolved = true;
    }
  }

  const outputs: number[] = [];
  for (let index = 0; index < NODE_OUTPUTS; index++) {
    outputs.push(values.get(FIRST_OUTPUT + index) ?? 0);
  }
  return outputs;
}

/** Whether `from` can already be reached from `to`, which would make a cycle. */
function reaches(genome: NeatGenome, from: number, to: number): boolean {
  const stack = [to];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    if (node === from) {
      return true;
    }
    seen.add(node);
    for (const connection of genome.connections) {
      if (connection.from === node) {
        stack.push(connection.to);
      }
    }
  }
  return false;
}

export const MUTATION = {
  weightChance: 0.8,
  /** Of the weights that change, this many are replaced outright. */
  replaceChance: 0.1,
  step: 0.5,
  addConnectionChance: 0.06,
  addNodeChance: 0.03,
} as const;

function mutateWeights(genome: NeatGenome, random: Random): void {
  for (const connection of genome.connections) {
    if (random() > MUTATION.weightChance) {
      continue;
    }
    connection.weight =
      random() < MUTATION.replaceChance
        ? random() * 2 - 1
        : connection.weight + (random() * 2 - 1) * MUTATION.step;
  }
}

function addConnection(genome: NeatGenome, random: Random, innovations: Innovations): void {
  // A handful of tries rather than a full search: the graph is small, and a
  // generation that adds nothing is not a problem.
  for (let attempt = 0; attempt < 12; attempt++) {
    const from = Math.floor(random() * genome.nodes);
    const to = Math.floor(random() * genome.nodes);
    if (isOutput(from) || isInput(to) || from === to) {
      continue;
    }
    if (genome.connections.some((existing) => existing.from === from && existing.to === to)) {
      continue;
    }
    // Skip it when the target can already reach the source: that edge would
    // close a loop, and the single pass in activate() assumes there are none.
    if (reaches(genome, from, to)) {
      continue;
    }
    genome.connections.push({
      from,
      to,
      weight: random() * 2 - 1,
      enabled: true,
      innovation: innovations.forConnection(from, to),
    });
    return;
  }
}

/**
 * Splits a connection in two with a new node in the middle. The old gene is
 * disabled rather than removed, the first half gets weight 1 and the second
 * the old weight, so the network's behaviour barely moves: a new node has to
 * survive long enough to be worth something.
 */
function addNode(genome: NeatGenome, random: Random, innovations: Innovations): void {
  const live = genome.connections.filter((connection) => connection.enabled);
  if (live.length === 0) {
    return;
  }
  const chosen = live[Math.floor(random() * live.length)];
  chosen.enabled = false;
  const middle = genome.nodes;
  genome.nodes++;
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
}

export function mutate(genome: NeatGenome, random: Random, innovations: Innovations): NeatGenome {
  const copy: NeatGenome = {
    nodes: genome.nodes,
    connections: genome.connections.map((connection) => ({ ...connection })),
  };
  mutateWeights(copy, random);
  if (random() < MUTATION.addConnectionChance) {
    addConnection(copy, random, innovations);
  }
  if (random() < MUTATION.addNodeChance) {
    addNode(copy, random, innovations);
  }
  return copy;
}

/**
 * Genes with the same innovation number are the same edge and one parent's is
 * taken at random; everything else comes from the fitter parent, which is what
 * keeps a child from inheriting half a topology from each side.
 */
export function crossover(fitter: NeatGenome, other: NeatGenome, random: Random): NeatGenome {
  const otherByInnovation = new Map(
    other.connections.map((connection) => [connection.innovation, connection])
  );
  const connections = fitter.connections.map((connection) => {
    const match = otherByInnovation.get(connection.innovation);
    const chosen = match !== undefined && random() < 0.5 ? match : connection;
    return { ...chosen };
  });
  return { nodes: Math.max(fitter.nodes, other.nodes), connections };
}

export const COMPATIBILITY = {
  /** Weights on disjoint genes and on how far the shared weights drifted. */
  disjoint: 1,
  weights: 0.4,
  threshold: 3,
} as const;

/** How unalike two genomes are, which is what decides who competes with whom. */
export function compatibility(a: NeatGenome, b: NeatGenome): number {
  const byInnovation = new Map(b.connections.map((connection) => [connection.innovation, connection]));
  let shared = 0;
  let drift = 0;
  let disjoint = 0;
  for (const connection of a.connections) {
    const match = byInnovation.get(connection.innovation);
    if (match === undefined) {
      disjoint++;
      continue;
    }
    shared++;
    drift += Math.abs(connection.weight - match.weight);
  }
  disjoint += b.connections.length - shared;

  const size = Math.max(a.connections.length, b.connections.length, 1);
  const averageDrift = shared === 0 ? 0 : drift / shared;
  return (COMPATIBILITY.disjoint * disjoint) / size + COMPATIBILITY.weights * averageDrift;
}

/** The policy the game plays with: the largest output picks the action. */
export function actionForNeat(genome: NeatGenome, state: GameState, level: Level): Input {
  const outputs = activate(genome, features(state, level));
  const [horizontal, jump, run] = outputs;
  return {
    ...ACTIONS[0],
    left: horizontal < -0.2,
    right: horizontal > 0.2,
    jumpHeld: jump > 0,
    jumpPressed: jump > 0,
    run: run > 0,
    down: false,
    confirmPressed: false,
    resetPressed: false,
  };
}

/**
 * A NEAT genome written into the flat number list the recording format keeps,
 * and read back out of it. The format is "a list of numbers" and nothing more,
 * so a graph fits as long as both ends agree how.
 */
export function encodeGenome(genome: NeatGenome): Genome {
  const flat: number[] = [genome.nodes, genome.connections.length];
  for (const connection of genome.connections) {
    flat.push(
      connection.from,
      connection.to,
      connection.weight,
      connection.enabled ? 1 : 0,
      connection.innovation
    );
  }
  return flat;
}

const FIELDS_PER_CONNECTION = 5;

export function decodeGenome(flat: Genome): NeatGenome {
  const [nodes = FIRST_HIDDEN, count = 0] = flat;
  const connections: Connection[] = [];
  for (let index = 0; index < count; index++) {
    const at = 2 + index * FIELDS_PER_CONNECTION;
    connections.push({
      from: flat[at],
      to: flat[at + 1],
      weight: flat[at + 2],
      enabled: flat[at + 3] === 1,
      innovation: flat[at + 4],
    });
  }
  return { nodes, connections };
}

export { createRandom };

/**
 * One generation of the population: score everyone, group them into species,
 * and let each species raise a share of the next generation in proportion to
 * how well its members did once their scores are shared out among them.
 *
 * Sharing is what protects a new shape. Without it a species of one, which is
 * what an innovation starts as, is compared against a hundred refined genomes
 * and loses every time.
 */
export type Species = { representative: NeatGenome; members: number[] };

export function speciate(population: NeatGenome[], previous: Species[]): Species[] {
  const species: Species[] = previous.map((old) => ({ representative: old.representative, members: [] }));
  for (const [index, genome] of population.entries()) {
    const home = species.find(
      (candidate) => compatibility(candidate.representative, genome) < COMPATIBILITY.threshold
    );
    if (home === undefined) {
      species.push({ representative: genome, members: [index] });
    } else {
      home.members.push(index);
    }
  }
  return species.filter((group) => group.members.length > 0);
}

/** Fitness shared within a species, so a crowd is worth no more than a pair. */
function sharedFitness(species: Species, fitnesses: number[]): number {
  const total = species.members.reduce((sum, index) => sum + fitnesses[index], 0);
  return total / species.members.length;
}

export function nextNeatGeneration(
  population: NeatGenome[],
  fitnesses: number[],
  species: Species[],
  random: Random,
  innovations: Innovations
): NeatGenome[] {
  // Shift the scale so that sharing works on positive numbers: fitness here is
  // negative for a run that did not finish, and a share of a negative total
  // would reward the species for being large.
  const floor = Math.min(...fitnesses);
  const lifted = fitnesses.map((fitness) => fitness - floor + 1);
  const shares = species.map((group) => sharedFitness(group, lifted));
  const total = shares.reduce((sum, share) => sum + share, 0);

  const children: NeatGenome[] = [];
  species.forEach((group, index) => {
    const ranked = [...group.members].sort((a, b) => fitnesses[b] - fitnesses[a]);
    // Every species keeps its best member untouched, which is what stops a
    // generation from losing what it just found.
    children.push(population[ranked[0]]);

    const room = Math.round((shares[index] / total) * (population.length - species.length));
    const breeding = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
    for (let born = 0; born < room; born++) {
      const mother = breeding[Math.floor(random() * breeding.length)];
      const father = breeding[Math.floor(random() * breeding.length)];
      const fitter = fitnesses[mother] >= fitnesses[father] ? mother : father;
      const weaker = fitter === mother ? father : mother;
      children.push(mutate(crossover(population[fitter], population[weaker], random), random, innovations));
    }
  });

  // Rounding can leave the population a little short or long; top up from the
  // best there is and cut the tail rather than let the size drift.
  const best = fitnesses.indexOf(Math.max(...fitnesses));
  while (children.length < population.length) {
    children.push(mutate(population[best], random, innovations));
  }
  return children.slice(0, population.length);
}
