// Drawing a network whose shape nobody chose. The layered view in
// network-view.ts positions a node by which layer it is in; a NEAT genome has
// no layers, so depth is worked out from the graph itself: a node sits one
// step to the right of the furthest thing feeding it.
import { COLORS as GAME_COLORS } from "../render";
import { FEATURE_LABELS, OUTPUT_LABELS } from "./policy";
import { FIRST_HIDDEN, FIRST_OUTPUT, NODE_INPUTS, activate, type Connection, type NeatGenome } from "./neat";

const LEFT_MARGIN = 132;
const RIGHT_MARGIN = 124;
const TOP_MARGIN = 18;
const BOTTOM_MARGIN = 14;
const NODE_RADIUS = 6;
const LABEL_FONT = "11px monospace";

const COLORS = {
  background: GAME_COLORS.chartBackground,
  positive: "#ffd84a",
  negative: "#5a7fb8",
  label: GAME_COLORS.chartLabel,
  nodeEdge: "#000000",
  pressed: "#42a642",
} as const;

/**
 * How many steps from the inputs each node is. Inputs are 0, outputs are put
 * last whatever their depth, and everything else is one past its deepest
 * source. The graph is acyclic, so repeating the sweep until it settles
 * terminates.
 */
export function depthsOf(genome: NeatGenome): number[] {
  const depths = new Array<number>(genome.nodes).fill(0);
  for (let pass = 0; pass < genome.nodes; pass++) {
    let moved = false;
    for (const connection of genome.connections) {
      if (!connection.enabled) {
        continue;
      }
      const candidate = depths[connection.from] + 1;
      if (candidate > depths[connection.to]) {
        depths[connection.to] = candidate;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
  }
  const deepest = Math.max(1, ...depths);
  for (let node = FIRST_OUTPUT; node < FIRST_HIDDEN; node++) {
    depths[node] = deepest;
  }
  return depths;
}

/**
 * The nodes that are actually part of the network. Splitting a connection and
 * later disabling the halves leaves an orphan behind; drawing those suggests
 * structure that is not there, and counting them overstates what grew.
 */
export function liveNodes(genome: NeatGenome): Set<number> {
  const live = new Set<number>();
  for (let node = 0; node < FIRST_HIDDEN; node++) {
    live.add(node);
  }
  for (const connection of genome.connections) {
    if (connection.enabled) {
      live.add(connection.from);
      live.add(connection.to);
    }
  }
  return live;
}

type Placed = { x: number; y: number };

export function placeNodes(genome: NeatGenome, width: number, height: number): Placed[] {
  const depths = depthsOf(genome);
  const deepest = Math.max(1, ...depths);
  const span = width - LEFT_MARGIN - RIGHT_MARGIN;
  const usable = height - TOP_MARGIN - BOTTOM_MARGIN;

  // Nodes at the same depth are spread down the column in id order, so a
  // genome that gains a node does not reshuffle the ones already drawn.
  const byDepth = new Map<number, number[]>();
  for (let node = 0; node < genome.nodes; node++) {
    const column = byDepth.get(depths[node]) ?? [];
    column.push(node);
    byDepth.set(depths[node], column);
  }

  const placed: Placed[] = [];
  for (let node = 0; node < genome.nodes; node++) {
    const column = byDepth.get(depths[node]) ?? [node];
    const position = column.indexOf(node);
    placed.push({
      x: LEFT_MARGIN + (span * depths[node]) / deepest,
      y:
        column.length === 1
          ? TOP_MARGIN + usable / 2
          : TOP_MARGIN + (usable * position) / (column.length - 1),
    });
  }
  return placed;
}

function signedColor(value: number, strength: number): string {
  const alpha = Math.min(1, Math.max(0.05, strength));
  const base = value >= 0 ? COLORS.positive : COLORS.negative;
  return `${base}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export type NeatScene = {
  genome: NeatGenome;
  /** What the network sees this frame, or null when nothing is running. */
  inputs: number[] | null;
  pressed: boolean[];
};

function drawConnections(ctx: CanvasRenderingContext2D, scene: NeatScene, placed: Placed[]): void {
  const live: Connection[] = scene.genome.connections.filter((connection) => connection.enabled);
  const biggest = Math.max(...live.map((connection) => Math.abs(connection.weight)), 1);

  for (const connection of live) {
    const from = placed[connection.from];
    const to = placed[connection.to];
    ctx.strokeStyle = signedColor(connection.weight, 0.55);
    ctx.lineWidth = 0.4 + (Math.abs(connection.weight) / biggest) * 2.2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

export function drawNeatNetwork(ctx: CanvasRenderingContext2D, scene: NeatScene): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  const placed = placeNodes(scene.genome, width, height);
  drawConnections(ctx, scene, placed);

  const outputs = scene.inputs === null ? null : activate(scene.genome, scene.inputs);
  const live = liveNodes(scene.genome);

  for (const node of live) {
    const at = placed[node];
    const value =
      scene.inputs === null
        ? 0
        : node < NODE_INPUTS
          ? (scene.inputs[node] ?? 0)
          : node >= FIRST_OUTPUT && node < FIRST_HIDDEN
            ? (outputs?.[node - FIRST_OUTPUT] ?? 0)
            : 0;

    ctx.beginPath();
    ctx.arc(at.x, at.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = signedColor(value, Math.abs(value));
    ctx.fill();
    ctx.strokeStyle = COLORS.nodeEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (node < NODE_INPUTS) {
      ctx.fillStyle = COLORS.label;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(FEATURE_LABELS[node], at.x - NODE_RADIUS - 6, at.y);
    } else if (node >= FIRST_OUTPUT && node < FIRST_HIDDEN) {
      const index = node - FIRST_OUTPUT;
      ctx.fillStyle = scene.pressed[index] ? COLORS.pressed : COLORS.label;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(OUTPUT_LABELS[index], at.x + NODE_RADIUS + 6, at.y);
    }
  }

  const hidden = [...live].filter((node) => node >= FIRST_HIDDEN).length;
  const edges = scene.genome.connections.filter((connection) => connection.enabled).length;
  ctx.fillStyle = COLORS.label;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`gegroeid: ${String(hidden)} verborgen knopen, ${String(edges)} verbindingen`, 8, 6);
}
