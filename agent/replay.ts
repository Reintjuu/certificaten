// The AI console: pick what to do from a menu instead of running npm scripts.
// It replays recorded runs, trains fresh ones in the browser, and hands the
// result back as a file. Open it at /agent/replay.html.
//
// It never touches src/main.ts's game loop; it drives the same pure engine
// and draws with the same renderer.
import trainingHistory from "./training-history.json";
import {
  CANVAS_H,
  CANVAS_W,
  LEVELS,
  createPlayingState,
  hasDied,
  hasFinishedLevel,
  isPlaying,
  step,
  type GameState,
} from "../src/engine";
import { COLORS, drawScene, drawEntities, withCamera } from "../src/render";
import { drawText, drawTextCentered } from "../src/font";
import { Menu } from "../src/menu";
import { drawFitnessChart } from "./chart";
import { RUN_FRAME_BUDGET, actionFor } from "./policy";
import { GENERATIONS, createTrainer, type GenerationRecord, type LevelHistory } from "./evolution";

type Screen = "menu" | "replay" | "training";
type Ghost = {
  record: GenerationRecord;
  index: number;
  state: GameState;
  path: { x: number; y: number }[];
  finished: boolean;
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

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const chartCanvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const chartCtx = chartCanvas.getContext("2d")!;
const generationsEl = document.querySelector<HTMLDivElement>("#generations")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;

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
  return { record, index, state: createPlayingState(levelIndex), path: [], finished: false };
}

function startReplay(level: number, generation: number, all: boolean): void {
  screen = "replay";
  levelIndex = level;
  generationIndex = generation;
  showAllGenerations = all;
  frame = 0;
  restartCountdown = RESTART_DELAY_FRAMES;

  const { generations } = levelHistory();
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
  { label: "SPEEL ZELF", hint: "TERUG NAAR HET SPEL", run: () => (location.href = "../index.html") },
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

function drawGhostPath(ghost: Ghost, color: string, width: number, alpha: number): void {
  if (ghost.path.length < 2) {
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ghost.path.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function outcomeOf(ghost: Ghost): string {
  if (hasFinishedLevel(ghost.state)) {
    return "CERTIFICAAT";
  }
  return hasDied(ghost.state) ? "GESTRAND" : "BEZIG";
}

/** The camera follows whichever ghost is furthest along. */
function replayCamera(): number {
  return Math.max(...ghosts.map((ghost) => ghost.state.cameraX));
}

function drawReplay(): void {
  const cameraX = replayCamera();
  const bestIndex = levelHistory().bestGeneration;
  const lead = ghosts[bestIndex] ?? ghosts[0];

  withCamera(ctx, cameraX, () => {
    drawScene(ctx, LEVELS[levelIndex]);
    if (showAllGenerations) {
      for (const ghost of ghosts) {
        const isBest = ghost.index === bestIndex;
        drawGhostPath(ghost, generationColor(ghost.index, ghosts.length), isBest ? 2 : 1, isBest ? 1 : 0.4);
      }
      for (const ghost of ghosts) {
        if (ghost.index === bestIndex) {
          continue;
        }
        ctx.fillStyle = generationColor(ghost.index, ghosts.length);
        ctx.globalAlpha = ghost.finished ? 0.35 : 1;
        ctx.fillRect(Math.round(ghost.state.player.x + 5), Math.round(ghost.state.player.y + 8), 6, 8);
        ctx.globalAlpha = 1;
      }
    }
    drawEntities(ctx, lead.state);
  });

  if (showAllGenerations) {
    const reached = ghosts.filter((ghost) => hasFinishedLevel(ghost.state)).length;
    drawText(ctx, `ALLE ${ghosts.length} GENERATIES`, 6, 6, 1, COLORS.ink);
    drawText(ctx, `FRAME ${frame} ${reached} BINNEN`, 6, 26, 1, COLORS.ink);
    statusEl.textContent =
      `Level ${levelIndex + 1}, alle ${ghosts.length} generaties tegelijk (blauw = vroegste, geel = laatste). ` +
      `${reached} haalden het certificaat.`;
  } else {
    const ghost = ghosts[0];
    drawText(ctx, `LEVEL ${levelIndex + 1} GEN ${ghost.record.generation}`, 6, 6, 1, COLORS.ink);
    drawText(ctx, `FRAME ${frame} ${outcomeOf(ghost)}`, 6, 26, 1, COLORS.ink);
    statusEl.textContent =
      `Generatie ${ghost.record.generation}: beste fitness ${ghost.record.bestFitness.toFixed(1)}, ` +
      `${ghost.record.solved} van de populatie haalde het certificaat. Escape voor het menu.`;
  }
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
  if (latest) {
    drawTextCentered(ctx, `${latest.solved} HAALDEN HET`, CANVAS_W / 2, 165, 1, COLORS.dimText);
  }
  if (blinkTimer < BLINK_HALF) {
    drawTextCentered(ctx, "ESCAPE OM TE STOPPEN", CANVAS_W / 2, 215, 1, COLORS.faintText);
  }

  drawFitnessChart(chartCtx, trainer.generations, 0);
  statusEl.textContent = `Trainen gebeurt hier in de browser; met "download data" bewaar je het resultaat.`;
}

function advanceTraining(): void {
  const trainer = trainers[trainingLevel];
  if (!trainer.done) {
    trainer.runGeneration();
    return;
  }
  if (trainingLevel + 1 < trainers.length) {
    trainingLevel++;
    return;
  }
  history = { levels: trainers.map((each) => each.toHistory()) };
  startReplay(0, history.levels[0].bestGeneration, false);
}

function advanceGhost(ghost: Ghost): void {
  if (ghost.finished) {
    return;
  }
  if (!isPlaying(ghost.state) || frame >= RUN_FRAME_BUDGET) {
    ghost.finished = true;
    return;
  }
  // Re-running the stored genome through the same deterministic engine
  // reproduces that generation's run exactly: the weights are the recording.
  ghost.state = step(ghost.state, actionFor(ghost.record.genome, ghost.state, LEVELS[levelIndex]));
  if (frame % PATH_SAMPLE_EVERY === 0) {
    ghost.path.push({ x: ghost.state.player.x + ghost.state.player.w / 2, y: ghost.state.player.y + 12 });
  }
}

function advanceReplay(): void {
  if (ghosts.every((ghost) => ghost.finished)) {
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

const CONSOLE_KEYS = new Set([...MENU_UP_KEYS, ...MENU_DOWN_KEYS, ...MENU_SELECT_KEYS, ...MENU_BACK_KEYS]);

addEventListener("keydown", (event) => {
  // Same rule as the game: swallow only the keys this page acts on, so the
  // browser's own shortcuts and Firefox's type-ahead find stay out of the way.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (CONSOLE_KEYS.has(event.key)) {
    event.preventDefault();
  }
  if (MENU_BACK_KEYS.has(event.key)) {
    toMenu();
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
});

/** Mouse position in the canvas's own 480x270 coordinates. */
function canvasY(event: MouseEvent): number {
  const bounds = canvas.getBoundingClientRect();
  return (event.clientY - bounds.top) * (canvas.height / bounds.height);
}

canvas.addEventListener("mousemove", (event) => {
  if (screen === "menu") {
    menu.hover(canvasY(event));
  }
});
canvas.addEventListener("click", (event) => {
  if (screen !== "menu") {
    return;
  }
  if (menu.rowAt(canvasY(event)) !== null) {
    menu.activate();
  }
});

function tick(): void {
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

  requestAnimationFrame(tick);
}

toMenu();
tick();
