// The AI console: pick what to do from a menu instead of running npm scripts.
// It replays recorded runs, trains fresh ones in the browser, and hands the
// result back as a file. The title screen opens it.
//
// It never touches the game's own loop; it borrows the canvas, drives the same
// pure engine and draws with the same renderer.
import trainingHistory from "./training-history.json";
import { CANVAS_H, CANVAS_W, LEVELS, type Level } from "../engine";
import { COLORS, drawFrameRate, drawScene, drawEntities, withCamera } from "../render";
import { drawText, drawTextCentered } from "../font";
import { Menu } from "../menu";
import { createFrameRate } from "../fps";
import { drawFitnessChart } from "./chart";
import { RunOutcome, advanceRun, startRun, type Run } from "./run";
import { GENERATIONS, createTrainer, type GenerationRecord, type LevelHistory } from "./evolution";

type Screen = "menu" | "replay" | "training";
type Ghost = {
  record: GenerationRecord;
  index: number;
  run: Run;
  /** Only the leading ghost keeps its whole path; the rest paint into trails. */
  path: { x: number; y: number }[];
  lastPoint: { x: number; y: number } | null;
};

const shipped = trainingHistory;
// Starts as the recording committed to the repo. Training in the browser
// replaces it in memory only: a static host can't be written to, so keeping a
// browser-trained result means downloading it and committing the file.
let history: { levels: LevelHistory[] } = shipped;

const RESTART_DELAY_FRAMES = 90;
const PATH_SAMPLE_EVERY = 2;
const BLINK_HALF = 30;
const MENU_UP_KEYS = new Set(["ArrowUp", "w"]);
const MENU_DOWN_KEYS = new Set(["ArrowDown", "s"]);
const MENU_SELECT_KEYS = new Set(["Enter", " "]);
const MENU_BACK_KEYS = new Set(["Escape"]);
const FRAME_RATE_KEYS = new Set(["f", "F"]);

let canvas!: HTMLCanvasElement;
let ctx!: CanvasRenderingContext2D;
let chartCtx!: CanvasRenderingContext2D;
let generationsEl!: HTMLDivElement;
let statusEl!: HTMLDivElement;
let leaveConsole: (() => void) | null = null;
let running = false;

const frameRate = createFrameRate();
let showFrameRate = false;

let screen: Screen = "menu";
let levelIndex = 0;
let generationIndex = 0;
let showAllGenerations = false;
let frame = 0;
let blinkTimer = 0;
let restartCountdown = RESTART_DELAY_FRAMES;
let ghosts: Ghost[] = [];
let trainers: ReturnType<typeof createTrainer>[] = [];
let trainingLevel = 0;

function levelHistory(): LevelHistory {
  return history.levels[levelIndex];
}

function generationColor(index: number, total: number): string {
  const t = total <= 1 ? 1 : index / (total - 1);
  return `hsl(${210 - 160 * t}, 85%, ${45 + 15 * t}%)`;
}

function makeGhost(record: GenerationRecord, index: number): Ghost {
  return { record, index, run: startRun(levelIndex), path: [], lastPoint: null };
}

function isFinished(ghost: Ghost): boolean {
  return ghost.run.outcome !== RunOutcome.Running;
}

function startReplay(level: number, generation: number, all: boolean): void {
  screen = "replay";
  levelIndex = level;
  generationIndex = generation;
  showAllGenerations = all;
  frame = 0;
  restartCountdown = RESTART_DELAY_FRAMES;

  const { generations } = levelHistory();
  resetTrails(LEVELS[levelIndex]);
  ghosts = all ? generations.map(makeGhost) : [makeGhost(generations[generationIndex], generationIndex)];
  renderGenerationButtons();
  drawFitnessChart(chartCtx, generations, levelHistory().bestGeneration);
}

function startTraining(): void {
  screen = "training";
  trainingLevel = 0;
  trainers = LEVELS.map((_, index) => createTrainer(index));
  generationsEl.replaceChildren();
}

function downloadHistory(): void {
  const blob = new Blob([JSON.stringify(history)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "training-history.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

const menu = new Menu("AI CONSOLE", [
  {
    label: "BEKIJK BESTE RUN",
    hint: "BESTE GENERATIE, LEVEL 1",
    run: () => {
      startReplay(0, history.levels[0].bestGeneration, false);
    },
  },
  {
    label: "ALLE GENERATIES",
    hint: "ALLEMAAL TEGELIJK MET PAD",
    run: () => {
      startReplay(0, history.levels[0].bestGeneration, true);
    },
  },
  { label: "TRAIN OPNIEUW", hint: "IN DE BROWSER, EEN MINUUT", run: startTraining },
  { label: "DOWNLOAD DATA", hint: "JSON OM TE COMMITTEN", run: downloadHistory },
  {
    label: "SPEEL ZELF",
    hint: "TERUG NAAR HET SPEL",
    run: () => {
      leaveConsole?.();
    },
  },
]);

function renderGenerationButtons(): void {
  if (screen !== "replay") {
    generationsEl.replaceChildren();
    return;
  }
  const { generations, bestGeneration } = levelHistory();
  generationsEl.replaceChildren(
    ...LEVELS.map((_, index) => {
      const button = document.createElement("button");
      button.textContent = `Level ${index + 1}`;
      button.className = index === levelIndex ? "active" : "";
      button.onclick = () => {
        startReplay(index, history.levels[index].bestGeneration, showAllGenerations);
      };
      return button;
    }),
    ...generations.map((record, index) => {
      const button = document.createElement("button");
      button.textContent = `${record.generation}${index === bestGeneration ? " ★" : ""}`;
      button.title = `beste fitness ${record.bestFitness.toFixed(1)}, ${record.solved} haalden het certificaat`;
      button.className = !showAllGenerations && index === generationIndex ? "active" : "";
      button.onclick = () => {
        startReplay(levelIndex, index, false);
      };
      return button;
    })
  );
}

/**
 * The trails of the ninety-nine also-rans, painted once as each segment
 * happens instead of restroked in full every frame. Re-stroking every ghost's
 * whole history came to 13,600 lineTo calls a frame by the end of a run. The
 * leading ghost is still drawn live, because one path is 300 calls and it
 * keeps its exact look.
 */
const FADED_TRAIL_ALPHA = 0.4;
let trails: HTMLCanvasElement | null = null;
let trailCtx: CanvasRenderingContext2D | null = null;

function resetTrails(level: Level): void {
  if (trails?.width !== level.width) {
    trails = document.createElement("canvas");
    trails.width = level.width;
    trails.height = CANVAS_H;
    trailCtx = trails.getContext("2d");
  }
  trailCtx?.clearRect(0, 0, trails.width, trails.height);
}

function extendTrail(ghost: Ghost, to: { x: number; y: number }): void {
  const from = ghost.lastPoint;
  ghost.lastPoint = to;
  if (from === null || trailCtx === null || ghost.index === levelHistory().bestGeneration) {
    return;
  }
  trailCtx.strokeStyle = generationColor(ghost.index, ghosts.length);
  trailCtx.lineWidth = 1;
  trailCtx.beginPath();
  trailCtx.moveTo(from.x, from.y);
  trailCtx.lineTo(to.x, to.y);
  trailCtx.stroke();
}

function drawTrails(cameraX: number): void {
  if (trails === null) {
    return;
  }
  const left = Math.round(cameraX);
  const width = Math.min(CANVAS_W, trails.width - left);
  ctx.globalAlpha = FADED_TRAIL_ALPHA;
  ctx.drawImage(trails, left, 0, width, CANVAS_H, left, 0, width, CANVAS_H);
  ctx.globalAlpha = 1;
}

function drawLeadPath(ghost: Ghost): void {
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

const OUTCOME_LABELS: Record<RunOutcome, string> = {
  [RunOutcome.Running]: "BEZIG",
  [RunOutcome.Solved]: "CERTIFICAAT",
  [RunOutcome.Died]: "GESTRAND",
  [RunOutcome.Stalled]: "VASTGELOPEN",
  [RunOutcome.OutOfTime]: "TIJD OP",
};

/** The camera follows whichever ghost is furthest along. */
function replayCamera(): number {
  return Math.max(...ghosts.map((ghost) => ghost.run.state.cameraX));
}

function drawReplay(): void {
  const cameraX = replayCamera();
  const bestIndex = levelHistory().bestGeneration;
  const lead = ghosts[bestIndex] ?? ghosts[0];

  withCamera(ctx, cameraX, () => {
    drawScene(ctx, LEVELS[levelIndex], cameraX);
    if (showAllGenerations) {
      drawTrails(cameraX);
      drawLeadPath(lead);
      for (const ghost of ghosts) {
        if (ghost.index === bestIndex) {
          continue;
        }
        ctx.fillStyle = generationColor(ghost.index, ghosts.length);
        ctx.globalAlpha = isFinished(ghost) ? 0.35 : 1;
        ctx.fillRect(
          Math.round(ghost.run.state.player.x + 5),
          Math.round(ghost.run.state.player.y + 8),
          6,
          8
        );
        ctx.globalAlpha = 1;
      }
    }
    drawEntities(ctx, lead.run.state);
  });

  if (showAllGenerations) {
    const reached = ghosts.filter((ghost) => ghost.run.outcome === RunOutcome.Solved).length;
    drawText(ctx, `ALLE ${ghosts.length} GENERATIES`, 6, 6, 1, COLORS.ink);
    drawText(ctx, `FRAME ${frame} ${reached} BINNEN`, 6, 26, 1, COLORS.ink);
    statusEl.textContent =
      `Level ${levelIndex + 1}, alle ${ghosts.length} generaties tegelijk (blauw = vroegste, geel = laatste). ` +
      `${reached} haalden het certificaat.`;
  } else {
    const ghost = ghosts[0];
    drawText(ctx, `LEVEL ${levelIndex + 1} GEN ${ghost.record.generation}`, 6, 6, 1, COLORS.ink);
    drawText(ctx, `FRAME ${frame} ${OUTCOME_LABELS[ghost.run.outcome]}`, 6, 26, 1, COLORS.ink);
    statusEl.textContent =
      `Generatie ${ghost.record.generation}: beste fitness ${ghost.record.bestFitness.toFixed(1)}, ` +
      `${ghost.record.solved} van de populatie haalde het certificaat. Escape voor het menu.`;
  }
}

/** Shows movement within a generation, so a slow level still looks alive. */
function drawProgressBar(progress: number): void {
  const width = 240;
  const x = (CANVAS_W - width) / 2;
  ctx.fillStyle = COLORS.selectedRow;
  ctx.fillRect(x, 158, width, 8);
  ctx.fillStyle = COLORS.highlight;
  ctx.fillRect(x, 158, Math.round(width * progress), 8);
}

function drawTraining(): void {
  const trainer = trainers[trainingLevel];
  const latest = trainer.generations.at(-1);

  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "AAN HET TRAINEN", CANVAS_W / 2, 50, 1, COLORS.highlight);
  drawTextCentered(ctx, `LEVEL ${trainingLevel + 1} VAN ${LEVELS.length}`, CANVAS_W / 2, 100, 1, COLORS.text);
  drawTextCentered(
    ctx,
    `GENERATIE ${trainer.generations.length} VAN ${GENERATIONS}`,
    CANVAS_W / 2,
    130,
    1,
    COLORS.text
  );
  drawProgressBar(trainer.generationProgress);
  if (latest) {
    drawTextCentered(ctx, `${latest.solved} HAALDEN HET`, CANVAS_W / 2, 185, 1, COLORS.dimText);
  }
  if (blinkTimer < BLINK_HALF) {
    drawTextCentered(ctx, "ESCAPE OM TE STOPPEN", CANVAS_W / 2, 215, 1, COLORS.faintText);
  }

  drawFitnessChart(chartCtx, trainer.generations, 0);
  statusEl.textContent = `Trainen gebeurt hier in de browser; met "download data" bewaar je het resultaat.`;
}

/**
 * How long training may hold the thread each frame. A whole generation is 80
 * runs and takes a few hundred milliseconds, which used to be done between two
 * paints: the page froze and the generation counter looked stuck. Scoring
 * candidates one at a time until the budget runs out keeps the frame alive.
 */
const TRAINING_BUDGET_MS = 10;

function finishTraining(): void {
  history = { levels: trainers.map((trainer) => trainer.toHistory()) };
  startReplay(0, history.levels[0].bestGeneration, false);
}

function advanceTraining(): void {
  const deadline = performance.now() + TRAINING_BUDGET_MS;
  for (;;) {
    const trainer = trainers[trainingLevel];
    if (!trainer.done) {
      trainer.evaluateNext();
    } else if (trainingLevel + 1 < trainers.length) {
      trainingLevel++;
    } else {
      finishTraining();
      return;
    }
    if (performance.now() >= deadline) {
      return;
    }
  }
}

function advanceGhost(ghost: Ghost): void {
  if (isFinished(ghost)) {
    return;
  }
  // Re-running the stored genome through the same deterministic engine
  // reproduces that generation's run exactly: the weights are the recording.
  ghost.run = advanceRun(ghost.run, ghost.record.genome, levelIndex);
  if (frame % PATH_SAMPLE_EVERY !== 0) {
    return;
  }
  const { player } = ghost.run.state;
  const point = { x: player.x + player.w / 2, y: player.y + 12 };
  if (ghost.index === levelHistory().bestGeneration) {
    ghost.path.push(point);
  }
  extendTrail(ghost, point);
}

function advanceReplay(): void {
  if (ghosts.every(isFinished)) {
    restartCountdown--;
    if (restartCountdown <= 0) {
      startReplay(levelIndex, generationIndex, showAllGenerations);
    }
    return;
  }
  ghosts.forEach(advanceGhost);
  frame++;
  restartCountdown = RESTART_DELAY_FRAMES;
}

function toMenu(): void {
  screen = "menu";
  generationsEl.replaceChildren();
  statusEl.textContent = "Kies met de pijltjes en Enter, of klik.";
}
const CONSOLE_KEYS = new Set([
  ...MENU_UP_KEYS,
  ...MENU_DOWN_KEYS,
  ...MENU_SELECT_KEYS,
  ...MENU_BACK_KEYS,
  ...FRAME_RATE_KEYS,
]);

function onKeyDown(event: KeyboardEvent): void {
  // Same rule as the game: swallow only the keys this page acts on, so the
  // browser's own shortcuts and Firefox's type-ahead find stay out of the way.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (CONSOLE_KEYS.has(event.key)) {
    event.preventDefault();
  }
  if (FRAME_RATE_KEYS.has(event.key)) {
    showFrameRate = !showFrameRate;
    return;
  }
  if (MENU_BACK_KEYS.has(event.key)) {
    // Escape backs out one step at a time: a screen returns to the menu, the
    // menu returns to the game.
    if (screen === "menu") {
      leaveConsole?.();
    } else {
      toMenu();
    }
    return;
  }
  if (screen !== "menu") {
    return;
  }
  if (MENU_UP_KEYS.has(event.key)) {
    menu.moveBy(-1);
  } else if (MENU_DOWN_KEYS.has(event.key)) {
    menu.moveBy(1);
  } else if (MENU_SELECT_KEYS.has(event.key)) {
    menu.activate();
  }
}

/** Mouse position in the canvas's own 480x270 coordinates. */
function canvasY(event: MouseEvent): number {
  const bounds = canvas.getBoundingClientRect();
  return (event.clientY - bounds.top) * (canvas.height / bounds.height);
}

function onMouseMove(event: MouseEvent): void {
  if (screen === "menu") {
    menu.hover(canvasY(event));
  }
}

function onClick(event: MouseEvent): void {
  if (screen !== "menu") {
    return;
  }
  if (menu.rowAt(canvasY(event)) !== null) {
    menu.activate();
  }
}

function tick(): void {
  if (!running) {
    return;
  }
  blinkTimer = (blinkTimer + 1) % 60;

  if (screen === "menu") {
    menu.draw(ctx, blinkTimer);
  } else if (screen === "training") {
    advanceTraining();
    drawTraining();
  } else {
    advanceReplay();
    drawReplay();
  }

  frameRate.record();
  if (showFrameRate) {
    drawFrameRate(ctx, frameRate.perSecond);
  }
  requestAnimationFrame(tick);
}

/** The chrome the console needs beyond the canvas, built when it opens. */
function buildChrome(container: HTMLElement): void {
  statusEl = document.createElement("div");
  statusEl.id = "status";

  const caption = document.createElement("h2");
  caption.textContent = "Fitness per generatie (\u2605 = beste). Escape brengt je terug.";

  const chartCanvas = document.createElement("canvas");
  chartCanvas.width = 960;
  chartCanvas.height = 180;
  chartCanvas.id = "chart";
  chartCtx = chartCanvas.getContext("2d")!;

  generationsEl = document.createElement("div");
  generationsEl.id = "generations";

  container.replaceChildren(statusEl, caption, chartCanvas, generationsEl);
  container.hidden = false;
}

export type ConsoleOptions = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  onExit: () => void;
};

/**
 * Hands the canvas to the console until the player leaves it again. The game
 * loads this lazily, so neither the console nor the training data it carries
 * costs anything until someone opens it.
 */
export function openConsole(options: ConsoleOptions): void {
  canvas = options.canvas;
  ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  buildChrome(options.container);

  const listeners = new AbortController();
  const { signal } = listeners;
  addEventListener("keydown", onKeyDown, { signal });
  canvas.addEventListener("mousemove", onMouseMove, { signal });
  canvas.addEventListener("click", onClick, { signal });

  leaveConsole = (): void => {
    running = false;
    listeners.abort();
    options.container.replaceChildren();
    options.container.hidden = true;
    options.onExit();
  };

  screen = "menu";
  history = shipped;
  running = true;
  toMenu();
  tick();
}
