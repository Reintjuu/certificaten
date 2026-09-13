// A* over the game itself, which is the odd one out among the methods here: it
// does not learn anything. The engine is deterministic and fully inspectable,
// so a search can simply try futures and keep the cheapest. That is how the
// 2009 Mario AI competition was won, by a search rather than by any of the
// learners that entered, and it is worth having next to six that do learn.
//
// Nothing about the future is approximated: what the search tries is exactly
// what the game does, because it is the game doing it. The one thing it gives
// up is granularity, by planning in moves rather than in frames.
import { LEVELS, PHYSICS, hasDied, hasFinishedLevel, type Input } from "../engine";
import { MOVES, playMove, type Move } from "./moves";
import { RunOutcome, startRun, stepRun, type Run } from "./run";

/** A ceiling, so a level it cannot solve fails in seconds rather than never. */
export const DEFAULT_EXPANSION_BUDGET = 20_000;

export type SearchResult = {
  /** One entry per frame, ready to replay through the engine. */
  inputs: Input[];
  frames: number;
  solved: boolean;
  /** Nodes taken off the frontier, which is what the search cost. */
  expanded: number;
};

type Node = {
  run: Run;
  /** How this node was reached, and from where. */
  move: Move | null;
  inputs: Input[];
  parent: Node | null;
  cost: number;
  estimate: number;
};

/** jumpVelocity's fastest row, as a positive number of pixels per frame. */
const FASTEST_RISE = Math.max(...PHYSICS.jumpVelocity.map(Math.abs));

/**
 * Frames still needed at best. You close the horizontal gap at no more than
 * maxRunSpeed a frame and you rise at no more than the fastest row of the jump
 * table, so each of those is a floor on what is left, and so is the larger of
 * the two. Both are floors rather than guesses, which is what makes the first
 * solution A* finds the fastest one these moves allow.
 */
function framesAtBest(run: Run, levelIndex: number): number {
  const player = run.state.player;
  const certificate = LEVELS[levelIndex].certificate;
  const gap = Math.max(0, certificate.x - (player.x + player.w));
  const climb = Math.max(0, player.y - (certificate.y + certificate.h));
  return Math.max(gap / PHYSICS.maxRunSpeed, climb / FASTEST_RISE);
}

/**
 * States are collapsed onto a grid, or the search drowns in futures that are a
 * quarter of a pixel apart. Enemies are deliberately left out of it: they move
 * with the clock, so the cheapest way to a spot is also the earliest one, and
 * the first arrival is the one worth keeping.
 */
function keyOf(run: Run): string {
  const p = run.state.player;
  return [Math.round(p.x / 4), Math.round(p.y / 4), Math.round(p.vx), p.grounded ? 1 : 0, p.big ? 1 : 0].join(
    ","
  );
}

/** A binary heap, because the frontier is where an A* spends its life. */
class Frontier {
  private readonly nodes: Node[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: Node): void {
    this.nodes.push(node);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priority(parent) <= this.priority(index)) {
        break;
      }
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): Node | undefined {
    const top = this.nodes[0];
    const last = this.nodes.pop();
    if (last !== undefined && this.nodes.length > 0) {
      this.nodes[0] = last;
      this.sink(0);
    }
    return top;
  }

  private sink(start: number): void {
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.nodes.length && this.priority(left) < this.priority(smallest)) {
        smallest = left;
      }
      if (right < this.nodes.length && this.priority(right) < this.priority(smallest)) {
        smallest = right;
      }
      if (smallest === index) {
        return;
      }
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private priority(index: number): number {
    return this.nodes[index].cost + this.nodes[index].estimate;
  }

  private swap(a: number, b: number): void {
    const held = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = held;
  }
}

function inputsTo(node: Node): Input[] {
  const inputs: Input[] = [];
  for (let walk: Node | null = node; walk !== null; walk = walk.parent) {
    inputs.unshift(...walk.inputs);
  }
  return inputs;
}

/** Advances a run by replaying a move's inputs, so the run bookkeeping holds. */
function follow(run: Run, inputs: Input[], levelIndex: number): Run {
  let walked = run;
  for (const input of inputs) {
    if (walked.outcome !== RunOutcome.Running) {
      break;
    }
    walked = stepRun(walked, input, levelIndex);
  }
  return walked;
}

export type SearchOptions = {
  /** Nodes the search may take off the frontier before it gives up. */
  budget?: number;
  /**
   * How much the search leans on the estimate. At 1 the estimate is a true
   * floor and the first solution found is the fastest these moves allow. Above
   * 1 that guarantee goes and the search heads for the certificate instead,
   * which is faster to run and bounded: never worse than this many times the
   * best there is.
   */
  weight?: number;
};

export type Search = {
  /**
   * Expands at most this many nodes and says whether it is finished. Handing
   * the search out in slices is what lets a page run it without the frame it
   * is in going missing.
   */
  expand: (nodes: number) => boolean;
  readonly expanded: number;
  /** The best route so far, which is the answer once expand says it is done. */
  readonly result: SearchResult;
};

export function createSearch(levelIndex: number, options: SearchOptions = {}): Search {
  const { budget = DEFAULT_EXPANSION_BUDGET, weight = 1 } = options;
  const start = startRun(levelIndex);
  const root: Node = { run: start, move: null, inputs: [], parent: null, cost: 0, estimate: 0 };
  const frontier = new Frontier();
  const seen = new Set<string>([keyOf(start)]);
  frontier.push(root);

  let closest = root;
  let closestEstimate = Infinity;
  let expanded = 0;
  let solution: Node | null = null;

  function finished(): boolean {
    return solution !== null || expanded >= budget || frontier.size === 0;
  }

  return {
    get expanded() {
      return expanded;
    },
    get result() {
      return replay(inputsTo(solution ?? closest), levelIndex, expanded);
    },
    expand(nodes: number): boolean {
      for (let step = 0; step < nodes && !finished(); step++) {
        const node = frontier.pop();
        if (node === undefined) {
          break;
        }
        expanded++;

        if (hasFinishedLevel(node.run.state)) {
          solution = node;
          break;
        }
        const estimate = framesAtBest(node.run, levelIndex);
        if (estimate < closestEstimate) {
          closest = node;
          closestEstimate = estimate;
        }

        for (const move of MOVES) {
          const played = playMove(node.run.state, move);
          const run = follow(node.run, played.inputs, levelIndex);
          if (hasDied(run.state) || run.outcome === RunOutcome.OutOfTime) {
            continue;
          }
          const key = keyOf(run);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          frontier.push({
            run,
            move,
            inputs: played.inputs,
            parent: node,
            cost: run.frames,
            estimate: weight * framesAtBest(run, levelIndex),
          });
        }
      }
      return finished();
    },
  };
}

/**
 * The fastest way through a level that these moves allow, or the closest it
 * came within its budget. What comes back is the frame-by-frame input list,
 * played back through the engine before it is handed over, so it is a run that
 * demonstrably happens rather than a plan that ought to work.
 */
export function searchLevel(levelIndex: number, options: SearchOptions = {}): SearchResult {
  const search = createSearch(levelIndex, options);
  while (!search.expand(1000)) {
    // Keep going until it has an answer or has run out of budget.
  }
  return search.result;
}

/** Plays a found sequence back through the engine and reports what happened. */
export function replay(inputs: Input[], levelIndex: number, expanded = 0): SearchResult {
  let run = startRun(levelIndex);
  let frames = 0;
  for (const input of inputs) {
    if (run.outcome !== RunOutcome.Running) {
      break;
    }
    run = stepRun(run, input, levelIndex);
    frames++;
  }
  return { inputs: inputs.slice(0, frames), frames, solved: run.outcome === RunOutcome.Solved, expanded };
}
