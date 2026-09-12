// One training run, and the screen that shows it. Kept apart from the console
// so that file is about choosing what to look at rather than about running an
// evolution: this owns the trainers, the budget, and the drawing.
import { CANVAS_H, CANVAS_W, LEVELS, type Level } from "../engine";
import { COLORS, SCREEN_MARGIN, levelImage } from "../render";
import { drawText } from "../font";
import { POPULATION_SIZE, type Trainer, type TrainerOptions } from "./evolution";
import type { Architecture } from "./policy";
import type { Point } from "./run";

const HEADER_HEIGHT = 52;
const FOOTER_HEIGHT = 28;
/** How much of the older generations' lines survive each new generation. */
const TRAIL_FADE = 0.3;
/** How long training may hold the thread each frame. */
const BUDGET_MS = 10;
const PROGRESS_BAR_WIDTH = 160;

export type TrainerFactory = (levelIndex: number, options?: TrainerOptions) => Trainer;

/**
 * Two small canvases at overview size rather than one at level size: a level is
 * 1440 wide and only 480 of it fits, and how far along a candidate gets is the
 * whole point of the screen. Pre-scaling both means each frame is two
 * one-to-one blits instead of two filtered ones, which is the difference
 * between 52 and 61 frames a second.
 */
type Overview = {
  scale: number;
  scene: HTMLCanvasElement;
  trails: HTMLCanvasElement;
  trailCtx: CanvasRenderingContext2D;
};

function overviewFor(level: Level): Overview {
  const scale = CANVAS_W / level.width;
  const height = Math.round(CANVAS_H * scale);

  const scene = document.createElement("canvas");
  scene.width = CANVAS_W;
  scene.height = height;
  const sceneCtx = scene.getContext("2d")!;
  // Thinning a 5px platform top to under two pixels with nearest neighbour
  // loses it altogether, so this one blit is filtered.
  sceneCtx.imageSmoothingEnabled = true;
  sceneCtx.drawImage(levelImage(level), 0, 0, CANVAS_W, height);

  const trails = document.createElement("canvas");
  trails.width = CANVAS_W;
  trails.height = height;

  return { scale, scene, trails, trailCtx: trails.getContext("2d")! };
}

/** One colour per candidate within a generation, cool to warm. */
function candidateColor(index: number): string {
  const share = Math.min(1, index / Math.max(1, POPULATION_SIZE - 1));
  return `hsl(${210 - 160 * share}, 85%, ${45 + 15 * share}%)`;
}

export type TrainingSession = {
  readonly currentTrainer: Trainer;
  readonly trainers: readonly Trainer[];
  /** Scores candidates within this frame's budget; true once all levels are done. */
  advance: () => boolean;
  draw: (ctx: CanvasRenderingContext2D, showHint: boolean) => void;
  status: () => string;
};

export function startTrainingSession(
  factory: TrainerFactory,
  methodLabel: string,
  architecture: Architecture
): TrainingSession {
  const trainers = LEVELS.map((_, index) => factory(index, { architecture, recordPaths: true }));
  let level = 0;
  let overview = overviewFor(LEVELS[0]);
  let candidatesDrawn = 0;

  function drawCandidate(path: readonly Point[]): void {
    if (path.length < 2) {
      return;
    }
    const { trailCtx: into, scale } = overview;
    into.strokeStyle = candidateColor(candidatesDrawn);
    into.lineWidth = 1;
    into.beginPath();
    path.forEach((point, at) => {
      const x = point.x * scale;
      const y = point.y * scale;
      if (at === 0) {
        into.moveTo(x, y);
      } else {
        into.lineTo(x, y);
      }
    });
    into.stroke();
  }

  /**
   * Erases part of what is there instead of clearing it, so the last few
   * generations stay faintly visible. Clearing outright strobed: a generation
   * is eighty candidates and takes about a seventh of a second.
   */
  function fadeTrails(): void {
    const { trailCtx, trails } = overview;
    trailCtx.globalCompositeOperation = "destination-out";
    trailCtx.fillStyle = `rgba(0, 0, 0, ${String(TRAIL_FADE)})`;
    trailCtx.fillRect(0, 0, trails.width, trails.height);
    trailCtx.globalCompositeOperation = "source-over";
  }

  function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number): void {
    const x = CANVAS_W - PROGRESS_BAR_WIDTH - SCREEN_MARGIN;
    ctx.fillStyle = COLORS.selectedRow;
    ctx.fillRect(x, 10, PROGRESS_BAR_WIDTH, 8);
    ctx.fillStyle = COLORS.highlight;
    ctx.fillRect(x, 10, Math.round(PROGRESS_BAR_WIDTH * progress), 8);
  }

  return {
    trainers,
    get currentTrainer() {
      return trainers[level];
    },

    advance(): boolean {
      const deadline = performance.now() + BUDGET_MS;
      for (;;) {
        const trainer = trainers[level];
        if (!trainer.done) {
          const closedGeneration = trainer.evaluateNext();
          drawCandidate(trainer.lastPath);
          candidatesDrawn = closedGeneration ? 0 : candidatesDrawn + 1;
          if (closedGeneration) {
            fadeTrails();
          }
        } else if (level + 1 < trainers.length) {
          level++;
          overview = overviewFor(LEVELS[level]);
          candidatesDrawn = 0;
        } else {
          return true;
        }
        if (performance.now() >= deadline) {
          return false;
        }
      }
    },

    draw(ctx: CanvasRenderingContext2D, showHint: boolean): void {
      const trainer = trainers[level];
      ctx.fillStyle = COLORS.nightSky;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      const band = CANVAS_H - HEADER_HEIGHT - FOOTER_HEIGHT;
      const top = HEADER_HEIGHT + (band - overview.scene.height) / 2;
      ctx.drawImage(overview.scene, 0, top);
      ctx.drawImage(overview.trails, 0, top);

      // Opaque, not the translucent shroud: the level's clouds showed through
      // it as grey blocks between the letters.
      ctx.fillStyle = COLORS.nightSky;
      ctx.fillRect(0, 0, CANVAS_W, HEADER_HEIGHT);
      ctx.fillRect(0, CANVAS_H - FOOTER_HEIGHT, CANVAS_W, FOOTER_HEIGHT);

      drawText(ctx, methodLabel, SCREEN_MARGIN, SCREEN_MARGIN, 1, COLORS.highlight);
      drawText(
        ctx,
        `L${level + 1}/${LEVELS.length} GEN ${trainer.generations.length}/${trainer.totalGenerations}`,
        SCREEN_MARGIN,
        28,
        1,
        COLORS.text
      );
      const latest = trainer.generations.at(-1);
      drawText(
        ctx,
        `${latest === undefined ? 0 : latest.solved} BINNEN`,
        CANVAS_W - 150,
        28,
        1,
        COLORS.dimText
      );
      drawProgressBar(ctx, trainer.generationProgress);
      if (showHint) {
        drawText(ctx, "ESCAPE OM TE STOPPEN", SCREEN_MARGIN, CANVAS_H - 22, 1, COLORS.faintText);
      }
    },

    status(): string {
      return (
        `Elke lijn is een kandidaat die net is uitgespeeld, ${String(candidatesDrawn)} deze generatie. ` +
        `Ze worden per stuk in ongeveer een milliseconde doorgerekend, dus je ziet hun vorm en niet hun beweging. ` +
        `Met "download data" bewaar je het resultaat.`
      );
    },
  };
}
