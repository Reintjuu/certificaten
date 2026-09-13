// The MAP-Elites archive as a grid: one cell per kind of behaviour, holding
// the best agent that behaved that way. Reading it is the point of the method,
// so it gets a picture rather than a number.
import { CANVAS_H, CANVAS_W } from "../engine";
import { COLORS as GAME_COLORS } from "../render";
import { drawTextCentered } from "../font";
import { HEIGHT_BINS, REACH_BINS, type Archive } from "./map-elites";

const LEFT_MARGIN = 90;
const RIGHT_MARGIN = 16;
const TOP_MARGIN = 26;
const BOTTOM_MARGIN = 34;
const LABEL_FONT = "11px monospace";

const COLORS = {
  background: GAME_COLORS.chartBackground,
  empty: "#1f1f1f",
  label: GAME_COLORS.chartLabel,
  solved: GAME_COLORS.highlight,
  outline: "#000000",
} as const;

type Grid = { x: number; y: number; cell: number };

function gridFor(ctx: CanvasRenderingContext2D): Grid {
  const { width, height } = ctx.canvas;
  const cell = Math.min(
    (width - LEFT_MARGIN - RIGHT_MARGIN) / REACH_BINS,
    (height - TOP_MARGIN - BOTTOM_MARGIN) / HEIGHT_BINS
  );
  return { x: LEFT_MARGIN, y: TOP_MARGIN, cell };
}

/** Blue for a poor cell through to green for one that reaches the certificate. */
function cellColor(fitness: number, worst: number, best: number): string {
  const share = best === worst ? 1 : (fitness - worst) / (best - worst);
  return `hsl(${210 - 150 * share}, 80%, ${28 + 32 * share}%)`;
}

export function drawArchive(ctx: CanvasRenderingContext2D, archive: Archive): void {
  const { width, height } = ctx.canvas;
  const { x: left, y: top, cell } = gridFor(ctx);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const filled = archive.filter((entry) => entry !== null);
  const scores = filled.map((entry) => entry.fitness);
  const worst = Math.min(...scores, 0);
  const best = Math.max(...scores, 1);

  for (let row = 0; row < HEIGHT_BINS; row++) {
    for (let column = 0; column < REACH_BINS; column++) {
      const entry = archive[row * REACH_BINS + column];
      const x = left + column * cell;
      const y = top + row * cell;

      ctx.fillStyle = entry === null ? COLORS.empty : cellColor(entry.fitness, worst, best);
      ctx.fillRect(x, y, cell - 2, cell - 2);
      if (entry?.solved === true) {
        ctx.strokeStyle = COLORS.solved;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, cell - 4, cell - 4);
      }
    }
  }

  ctx.font = LABEL_FONT;
  ctx.fillStyle = COLORS.label;
  ctx.textAlign = "right";
  ctx.fillText("hoog", LEFT_MARGIN - 8, top + 12);
  ctx.fillText("laag", LEFT_MARGIN - 8, top + HEIGHT_BINS * cell - 4);
  ctx.textAlign = "left";
  ctx.fillText("hoe hoog hij kwam", 6, 16);
  ctx.fillText("hoe ver hij kwam, van start tot certificaat", left, top + HEIGHT_BINS * cell + 16);
  ctx.fillText(
    `${filled.length} van ${archive.length} soorten gedrag gevonden, ` +
      `${filled.filter((entry) => entry.solved).length} daarvan halen het certificaat (geel omrand)`,
    left,
    top + HEIGHT_BINS * cell + 30
  );
}

/** Which cell a click landed on, or null outside the grid. */
export function cellAt(ctx: CanvasRenderingContext2D, x: number, y: number): number | null {
  const { x: left, y: top, cell } = gridFor(ctx);
  const column = Math.floor((x - left) / cell);
  const row = Math.floor((y - top) / cell);
  if (column < 0 || column >= REACH_BINS || row < 0 || row >= HEIGHT_BINS) {
    return null;
  }
  return row * REACH_BINS + column;
}

/**
 * The whole screen around the grid, which the console used to assemble
 * itself. Drawn here with the grid it belongs to, and the caption comes back
 * rather than being written into the page from a drawing function.
 */
export function drawArchiveScreen(
  ctx: CanvasRenderingContext2D,
  gridCtx: CanvasRenderingContext2D | null,
  scene: { archive: Archive; levelIndex: number; prompt: boolean }
): string {
  ctx.fillStyle = GAME_COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "ARCHIEF", CANVAS_W / 2, 44, 1, GAME_COLORS.highlight);
  drawTextCentered(ctx, `LEVEL ${String(scene.levelIndex + 1)}`, CANVAS_W / 2, 96, 1, GAME_COLORS.text);
  drawTextCentered(ctx, "KLIK EEN VAKJE", CANVAS_W / 2, 140, 1, GAME_COLORS.dimText);
  if (scene.prompt) {
    drawTextCentered(ctx, "ESCAPE VOOR HET MENU", CANVAS_W / 2, 200, 1, GAME_COLORS.faintText);
  }

  if (gridCtx !== null) {
    drawArchive(gridCtx, scene.archive);
  }

  return (
    "Elk vakje is een soort gedrag: hoe ver hij kwam tegen hoe hoog hij kwam, met de beste agent " +
    "die zich zo gedroeg. Klik er een aan om hem te zien spelen."
  );
}
