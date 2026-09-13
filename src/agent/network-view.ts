// Draws the policy network: what it sees on the left, what it decides on the
// right, and which connections are carrying that decision right now. The
// weights alone say what the agent could do; multiplying them by the current
// activations says what it is doing, which is the part worth watching.
import { COLORS as GAME_COLORS } from "../render";
import {
  FEATURE_LABELS,
  layerSizes,
  layoutOf,
  outputLabelsFor,
  type Architecture,
  type Genome,
} from "./policy";

const LEFT_MARGIN = 132;
/** Room for the output names, widened to whatever they actually need. */
const MIN_RIGHT_MARGIN = 124;
const LABEL_GAP = 14;
const TOP_MARGIN = 18;
const BOTTOM_MARGIN = 14;
const NODE_RADIUS = 7;
const LABEL_FONT = "11px monospace";
/** How close a click has to land on a connection to select it. */
const PICK_DISTANCE = 5;

const COLORS = {
  background: GAME_COLORS.chartBackground,
  positive: "#ffd84a",
  negative: "#5a7fb8",
  label: GAME_COLORS.chartLabel,
  nodeEdge: "#000000",
  selected: "#ff5a5a",
  pressed: "#42a642",
} as const;

export type Connection = { layer: number; to: number; from: number };

export type NetworkScene = {
  genome: Genome;
  architecture: Architecture;
  /** Every layer's activations, or null when nothing is running. */
  activations: number[][] | null;
  /** Which outputs are currently pressing a button. */
  pressed: boolean[];
  selected: Connection | null;
};

type Geometry = { columns: { x: number; nodes: number[] }[] };

/**
 * Where the nodes sit. Taken from the drawing context so that picking and
 * drawing can never disagree: the output column is placed to fit its names,
 * and a value head's names are far longer than a control head's.
 */
function geometryFor(ctx: CanvasRenderingContext2D, architecture: Architecture): Geometry {
  const { width, height } = ctx.canvas;
  ctx.font = LABEL_FONT;
  const widest = Math.max(...outputLabelsFor(architecture).map((label) => ctx.measureText(label).width));
  const rightMargin = Math.max(MIN_RIGHT_MARGIN, widest + LABEL_GAP * 2);

  const sizes = layerSizes(architecture);
  const span = width - LEFT_MARGIN - rightMargin;
  const usable = height - TOP_MARGIN - BOTTOM_MARGIN;

  return {
    columns: sizes.map((count, layer) => ({
      x: sizes.length === 1 ? LEFT_MARGIN : LEFT_MARGIN + (span * layer) / (sizes.length - 1),
      nodes: Array.from({ length: count }, (_, node) =>
        count === 1 ? TOP_MARGIN + usable / 2 : TOP_MARGIN + (usable * node) / (count - 1)
      ),
    })),
  };
}

/** Yellow for a positive number, blue for a negative one, faded by strength. */
function signedColor(value: number, strength: number): string {
  const alpha = Math.min(1, Math.max(0.05, strength));
  const base = value >= 0 ? COLORS.positive : COLORS.negative;
  return `${base}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function sameConnection(a: Connection | null, b: Connection): boolean {
  return a !== null && a.layer === b.layer && a.to === b.to && a.from === b.from;
}

export function drawNetwork(ctx: CanvasRenderingContext2D, scene: NetworkScene): void {
  const { width, height } = ctx.canvas;
  const outputLabels = outputLabelsFor(scene.architecture);
  const { columns } = geometryFor(ctx, scene.architecture);
  const layers = layoutOf(scene.architecture);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const biggest = Math.max(...scene.genome.map(Math.abs), 1);

  layers.forEach((layer, index) => {
    const left = columns[index];
    const right = columns[index + 1];
    const incoming = scene.activations?.[index] ?? null;

    for (let to = 0; to < layer.to; to++) {
      for (let from = 0; from < layer.from; from++) {
        const weight = scene.genome[layer.weight(to, from)];
        // Thickness is the weight, brightness is what it is carrying this
        // frame. A fat connection fed by a zero input does nothing, and that
        // should look like nothing.
        const carried = incoming === null ? 1 : Math.abs(weight * incoming[from]);
        ctx.strokeStyle = signedColor(weight, incoming === null ? 0.5 : carried);
        ctx.lineWidth = 0.4 + (Math.abs(weight) / biggest) * 2.2;
        ctx.beginPath();
        ctx.moveTo(left.x, left.nodes[from]);
        ctx.lineTo(right.x, right.nodes[to]);
        ctx.stroke();

        if (sameConnection(scene.selected, { layer: index, to, from })) {
          ctx.strokeStyle = COLORS.selected;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  });

  columns.forEach((column, index) => {
    const values = scene.activations?.[index] ?? null;
    column.nodes.forEach((y, node) => {
      const value = values?.[node] ?? 0;
      ctx.beginPath();
      ctx.arc(column.x, y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = signedColor(value, Math.abs(value));
      ctx.fill();
      ctx.strokeStyle = COLORS.nodeEdge;
      ctx.lineWidth = 1;
      ctx.stroke();

      if (index === 0) {
        ctx.fillStyle = COLORS.label;
        ctx.textAlign = "right";
        ctx.fillText(FEATURE_LABELS[node] ?? `in ${node}`, column.x - NODE_RADIUS - 6, y + 4);
      }
      if (index === columns.length - 1) {
        ctx.fillStyle = scene.pressed[node] ? COLORS.pressed : COLORS.label;
        ctx.textAlign = "left";
        ctx.fillText(outputLabels[node] ?? `uit ${node}`, column.x + NODE_RADIUS + 6, y + 4);
      }
    });
  });
  ctx.textAlign = "left";
}

/** Distance from a point to a line segment, for picking a connection. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Which connection a click landed on, if any. */
export function connectionAt(
  ctx: CanvasRenderingContext2D,
  architecture: Architecture,
  x: number,
  y: number
): Connection | null {
  const { columns } = geometryFor(ctx, architecture);
  const layers = layoutOf(architecture);
  let closest: Connection | null = null;
  let closestDistance = PICK_DISTANCE;

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    const left = columns[index];
    const right = columns[index + 1];
    for (let to = 0; to < layer.to; to++) {
      for (let from = 0; from < layer.from; from++) {
        const distance = distanceToSegment(x, y, left.x, left.nodes[from], right.x, right.nodes[to]);
        if (distance < closestDistance) {
          closest = { layer: index, to, from };
          closestDistance = distance;
        }
      }
    }
  }
  return closest;
}

/**
 * The stored numbers themselves, as a grid per layer: one row per node, one
 * column per incoming value with the bias last. This is literally what sits in
 * training-history.json.
 */
export function drawWeightMap(
  ctx: CanvasRenderingContext2D,
  genome: Genome,
  architecture: Architecture
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const layers = layoutOf(architecture);
  const biggest = Math.max(...genome.map(Math.abs), 1);
  const gap = 18;
  const totalColumns = layers.reduce((sum, layer) => sum + layer.from + 1, 0);
  const cell = Math.min(
    (width - gap * (layers.length + 1)) / totalColumns,
    (height - 28) / Math.max(...layers.map((layer) => layer.to))
  );

  let x = gap;
  ctx.font = LABEL_FONT;
  layers.forEach((layer, index) => {
    ctx.fillStyle = COLORS.label;
    ctx.fillText(`laag ${index + 1}: ${layer.to} x (${layer.from} + bias)`, x, 12);

    for (let to = 0; to < layer.to; to++) {
      for (let from = 0; from <= layer.from; from++) {
        const isBias = from === layer.from;
        const value = genome[isBias ? layer.bias(to) : layer.weight(to, from)];
        ctx.fillStyle = signedColor(value, Math.abs(value) / biggest);
        ctx.fillRect(x + from * cell, 20 + to * cell, cell - 1, cell - 1);
      }
    }
    x += (layer.from + 1) * cell + gap;
  });
}
