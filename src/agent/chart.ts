// Draws the learning curve of one training run. Kept apart from replay.ts so
// that file is only about replaying runs, not about plotting them.
import { COLORS as GAME_COLORS } from "../render";
import type { GenerationRecord } from "./train";

const LEGEND_HEIGHT = 26;
const TOP_MARGIN = 10;
const SIDE_MARGIN = 10;

const COLORS = {
  background: GAME_COLORS.chartBackground,
  best: GAME_COLORS.highlight,
  mean: GAME_COLORS.chartMean,
  solved: GAME_COLORS.chartSolved,
  marker: GAME_COLORS.chartMarker,
  label: GAME_COLORS.chartLabel,
} as const;

export function drawFitnessChart(
  ctx: CanvasRenderingContext2D,
  generations: GenerationRecord[],
  bestGeneration: number
): void {
  const { width, height } = ctx.canvas;
  const bottom = height - LEGEND_HEIGHT;
  const plotHeight = bottom - TOP_MARGIN;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const xOf = (index: number): number =>
    generations.length === 1
      ? width / 2
      : (index / (generations.length - 1)) * (width - SIDE_MARGIN * 2) + SIDE_MARGIN;

  // Solved-count bars sit behind the lines, on their own scale: the
  // best-fitness line saturates the moment one genome reaches the certificate
  // (the solve bonus dwarfs everything else), so "how much of the population
  // can finish the level" is what actually shows the population learning.
  const maxSolved = Math.max(1, ...generations.map((record) => record.solved));
  const barWidth = Math.max(2, (width - SIDE_MARGIN * 2) / generations.length - 2);
  ctx.fillStyle = COLORS.solved;
  generations.forEach((record, index) => {
    const barHeight = (record.solved / maxSolved) * plotHeight;
    ctx.fillRect(xOf(index) - barWidth / 2, bottom - barHeight, barWidth, barHeight);
  });

  const fitnesses = generations.flatMap((record) => [record.bestFitness, record.meanFitness]);
  const min = Math.min(...fitnesses);
  const span = Math.max(...fitnesses) - min || 1;
  const yOf = (value: number): number => bottom - ((value - min) / span) * plotHeight;

  const plotLine = (pick: (record: GenerationRecord) => number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    generations.forEach((record, index) => {
      const x = xOf(index);
      const y = yOf(pick(record));
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  };

  plotLine((record) => record.meanFitness, COLORS.mean);
  plotLine((record) => record.bestFitness, COLORS.best);

  ctx.fillStyle = COLORS.marker;
  ctx.beginPath();
  ctx.arc(xOf(bestGeneration), yOf(generations[bestGeneration].bestFitness), 4, 0, Math.PI * 2);
  ctx.fill();

  drawLegend(ctx, height, maxSolved);
}

function drawLegend(ctx: CanvasRenderingContext2D, height: number, maxSolved: number): void {
  ctx.font = "11px monospace";
  const entries: [string, string][] = [
    [COLORS.best, "beste fitness"],
    [COLORS.mean, "gemiddelde fitness"],
    [COLORS.solved, `opgelost per generatie (max ${maxSolved})`],
    [COLORS.marker, "beste generatie"],
  ];

  let x = SIDE_MARGIN;
  for (const [color, label] of entries) {
    ctx.fillStyle = color;
    ctx.fillRect(x, height - 16, 10, 8);
    ctx.fillStyle = COLORS.label;
    ctx.fillText(label, x + 14, height - 8);
    x += 24 + ctx.measureText(label).width;
  }
}
