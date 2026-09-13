// Playing recorded genomes back over the level. One ghost per generation, or
// just the one you asked for, advanced a frame at a time by the same engine
// that scored them: the weights are the recording, so a replay reproduces the
// run exactly rather than approximating it.
import { CANVAS_H, CANVAS_W, LEVELS, type Level } from "../engine";
import { COLORS, SCREEN_MARGIN, drawEntities, drawScene, withCamera } from "../render";
import { drawText } from "../font";
import { policyFor, type Architecture, type Genome } from "./policy";
import { RunOutcome, advanceRun, startRun, type Run } from "./run";
import type { GenerationRecord } from "./evolution";

/** Frames between samples of a ghost's path. Denser than a run records. */
const PATH_SAMPLE_EVERY = 2;
/** How long a finished replay sits still before starting over. */
const RESTART_DELAY_FRAMES = 90;
const FADED_TRAIL_ALPHA = 0.4;
/** The marker drawn for a ghost that is not the one being followed. */
const GHOST_MARKER = { width: 6, height: 8, offsetX: 5, offsetY: 8 } as const;

export const OUTCOME_LABELS: Record<RunOutcome, string> = {
  [RunOutcome.Running]: "BEZIG",
  [RunOutcome.Solved]: "CERTIFICAAT",
  [RunOutcome.Died]: "GESTRAND",
  [RunOutcome.Stalled]: "VASTGELOPEN",
  [RunOutcome.OutOfTime]: "TIJD OP",
};

export type Ghost = {
  record: GenerationRecord;
  index: number;
  /** Usually the record's, but an edited weight replaces it. */
  genome: Genome;
  run: Run;
  /** Only the leading ghost keeps its whole path; the rest paint into trails. */
  path: { x: number; y: number }[];
  lastPoint: { x: number; y: number } | null;
};

export type ReplayOptions = {
  levelIndex: number;
  architecture: Architecture;
  generations: GenerationRecord[];
  /** Which generation leads, and the only one shown when showAll is false. */
  leadGeneration: number;
  showAll: boolean;
  /** Lets an edited genome stand in for the recorded one. */
  genomeFor: (record: GenerationRecord, index: number) => Genome;
};

export type ReplaySession = {
  readonly lead: Ghost;
  readonly ghosts: readonly Ghost[];
  readonly frame: number;
  readonly showAll: boolean;
  readonly reached: number;
  /** One frame. True when the whole replay has run down and wants restarting. */
  advance: () => boolean;
  draw: (ctx: CanvasRenderingContext2D) => void;
};

function generationColor(index: number, total: number): string {
  const share = total <= 1 ? 1 : index / (total - 1);
  return `hsl(${210 - 160 * share}, 85%, ${45 + 15 * share}%)`;
}

function isFinished(ghost: Ghost): boolean {
  return ghost.run.outcome !== RunOutcome.Running;
}

/** One canvas in level coordinates, painted as each also-ran moves. */
function makeTrails(level: Level): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = level.width;
  canvas.height = CANVAS_H;
  return { canvas, ctx: canvas.getContext("2d")! };
}

export function startReplaySession(options: ReplayOptions): ReplaySession {
  const { levelIndex, architecture, generations, leadGeneration, showAll, genomeFor } = options;
  const level = LEVELS[levelIndex];
  const policy = policyFor(architecture);
  const trails = makeTrails(level);

  const chosen = showAll ? generations : [generations[leadGeneration] ?? generations[generations.length - 1]];
  const ghosts: Ghost[] = chosen.map((record, position) => {
    const index = showAll ? position : leadGeneration;
    return {
      record,
      index,
      genome: genomeFor(record, index),
      run: startRun(levelIndex),
      path: [],
      lastPoint: null,
    };
  });

  const leadPosition = showAll ? Math.min(leadGeneration, ghosts.length - 1) : 0;
  let frame = 0;
  let restartCountdown = RESTART_DELAY_FRAMES;

  function extendTrail(ghost: Ghost, to: { x: number; y: number }): void {
    const from = ghost.lastPoint;
    ghost.lastPoint = to;
    if (from === null || ghost.index === ghosts[leadPosition].index) {
      return;
    }
    trails.ctx.strokeStyle = generationColor(ghost.index, ghosts.length);
    trails.ctx.lineWidth = 1;
    trails.ctx.beginPath();
    trails.ctx.moveTo(from.x, from.y);
    trails.ctx.lineTo(to.x, to.y);
    trails.ctx.stroke();
  }

  function advanceGhost(ghost: Ghost): void {
    if (isFinished(ghost)) {
      return;
    }
    ghost.run = advanceRun(ghost.run, ghost.genome, levelIndex, architecture, policy);
    if (frame % PATH_SAMPLE_EVERY !== 0) {
      return;
    }
    const { player } = ghost.run.state;
    const point = { x: player.x + player.w / 2, y: player.y + 12 };
    if (ghost.index === ghosts[leadPosition].index) {
      ghost.path.push(point);
    }
    extendTrail(ghost, point);
  }

  function drawLeadPath(ctx: CanvasRenderingContext2D, ghost: Ghost): void {
    if (ghost.path.length < 2) {
      return;
    }
    ctx.strokeStyle = generationColor(ghost.index, ghosts.length);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ghost.path.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
  }

  return {
    ghosts,
    showAll,
    get lead() {
      return ghosts[leadPosition];
    },
    get frame() {
      return frame;
    },
    get reached() {
      return ghosts.filter((ghost) => ghost.run.outcome === RunOutcome.Solved).length;
    },

    advance(): boolean {
      if (ghosts.every(isFinished)) {
        restartCountdown--;
        return restartCountdown <= 0;
      }
      ghosts.forEach(advanceGhost);
      frame++;
      restartCountdown = RESTART_DELAY_FRAMES;
      return false;
    },

    draw(ctx: CanvasRenderingContext2D): void {
      const lead = ghosts[leadPosition];
      const cameraX = Math.max(...ghosts.map((ghost) => ghost.run.state.cameraX));

      withCamera(ctx, cameraX, () => {
        drawScene(ctx, level, cameraX);
        if (showAll) {
          const left = Math.round(cameraX);
          const width = Math.min(CANVAS_W, trails.canvas.width - left);
          ctx.globalAlpha = FADED_TRAIL_ALPHA;
          ctx.drawImage(trails.canvas, left, 0, width, CANVAS_H, left, 0, width, CANVAS_H);
          ctx.globalAlpha = 1;
          drawLeadPath(ctx, lead);

          for (const ghost of ghosts) {
            if (ghost === lead) {
              continue;
            }
            ctx.fillStyle = generationColor(ghost.index, ghosts.length);
            ctx.globalAlpha = isFinished(ghost) ? 0.35 : 1;
            ctx.fillRect(
              Math.round(ghost.run.state.player.x + GHOST_MARKER.offsetX),
              Math.round(ghost.run.state.player.y + GHOST_MARKER.offsetY),
              GHOST_MARKER.width,
              GHOST_MARKER.height
            );
            ctx.globalAlpha = 1;
          }
        }
        drawEntities(ctx, lead.run.state);
      });

      const heading = showAll
        ? `ALLE ${String(ghosts.length)} GENERATIES`
        : `LEVEL ${String(levelIndex + 1)} GEN ${String(lead.record.generation)}`;
      const second = showAll
        ? `FRAME ${String(frame)} ${String(this.reached)} BINNEN`
        : `FRAME ${String(frame)} ${OUTCOME_LABELS[lead.run.outcome]}`;
      drawText(ctx, heading, SCREEN_MARGIN, SCREEN_MARGIN, 1, COLORS.ink);
      drawText(ctx, second, SCREEN_MARGIN, 26, 1, COLORS.ink);
    },
  };
}
