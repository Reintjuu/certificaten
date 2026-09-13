// The AI console: pick what to do from a menu instead of running npm scripts.
// It replays recorded runs, trains fresh ones in the browser, and hands the
// result back as a file. The title screen opens it.
//
// It never touches the game's own loop; it borrows the canvas, drives the same
// pure engine and draws with the same renderer.
import trainingHistory from "./training-history.json";
import { CANVAS_H, CANVAS_W, LEVELS, type Level } from "../engine";
import { COLORS, SCREEN_MARGIN, drawFrameRate, drawScene, drawEntities, withCamera } from "../render";
import { drawText, drawTextCentered } from "../font";
import { Menu } from "../menu";
import { createFrameRate } from "../fps";
import { drawFitnessChart } from "./chart";
import { RunOutcome, advanceRun, finishRun, startRun, type Run } from "./run";
import {
  checkHistory,
  createTrainer,
  type GenerationRecord,
  type LevelHistory,
  type TrainingHistory,
} from "./evolution";
import {
  DEFAULT_ARCHITECTURE,
  features,
  forward,
  genomeSize,
  layoutOf,
  chosenOutputs,
  outputsOf,
  policyFor,
  roundWeight,
  type Architecture,
  type Genome,
} from "./policy";
import { connectionAt, drawNetwork, drawWeightMap, type Connection } from "./network-view";
import { createReinforceTrainer } from "./reinforce";
import { createCloneTrainerUsing } from "./clone";
import { createCmaesTrainer } from "./cmaes";
import { DQN_ARCHITECTURE, createDqnTrainer } from "./dqn";
import { startTrainingSession, type TrainingSession } from "./training-view";

type Screen = "menu" | "replay" | "training" | "weights";
type Ghost = {
  record: GenerationRecord;
  index: number;
  /** Usually the record's, but an edited weight replaces it. */
  genome: Genome;
  run: Run;
  /** Only the leading ghost keeps its whole path; the rest paint into trails. */
  path: { x: number; y: number }[];
  lastPoint: { x: number; y: number } | null;
};

const shipped = checkHistory(trainingHistory);
// Starts as the recording committed to the repo. Training in the browser
// replaces it in memory only: a static host can't be written to, so keeping a
// browser-trained result means downloading it and committing the file.
let history: TrainingHistory = shipped;

const RESTART_DELAY_FRAMES = 90;
/** Named apart from run.ts's: these are the live ghosts, sampled denser. */
const GHOST_PATH_SAMPLE_EVERY = 2;
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
let leaveConsole: ((intent: ConsoleExit) => void) | null = null;
let running = false;

const frameRate = createFrameRate();
let showFrameRate = false;

let networkCtx: CanvasRenderingContext2D | null = null;
let networkCanvas: HTMLCanvasElement | null = null;
let networkCaption: HTMLElement | null = null;
let selected: Connection | null = null;
/** A hand-edited copy of the best genome, replayed instead of the recorded one. */
let editedGenome: Genome | null = null;
/** Frames the recorded genome took, to compare an edit against. */
let recordedFrames: number | null = null;

let screen: Screen = "menu";
let levelIndex = 0;
let generationIndex = 0;
let showAllGenerations = false;
let frame = 0;
let blinkTimer = 0;
let restartCountdown = RESTART_DELAY_FRAMES;
let ghosts: Ghost[] = [];
let training: TrainingSession | null = null;

function levelHistory(): LevelHistory {
  return history.levels[levelIndex];
}

function generationColor(index: number, total: number): string {
  const t = total <= 1 ? 1 : index / (total - 1);
  return `hsl(${210 - 160 * t}, 85%, ${45 + 15 * t}%)`;
}

function makeGhost(record: GenerationRecord, index: number): Ghost {
  const edited = index === levelHistory().bestGeneration ? editedGenome : null;
  return {
    record,
    index,
    genome: edited ?? record.genome,
    run: startRun(levelIndex),
    path: [],
    lastPoint: null,
  };
}

function isFinished(ghost: Ghost): boolean {
  return ghost.run.outcome !== RunOutcome.Running;
}

/** Edits belong to one genome, so moving to another one drops them. */
function clearEdits(): void {
  editedGenome = null;
  selected = null;
  recordedFrames = null;
}

function startReplay(level: number, generation: number, all: boolean): void {
  screen = "replay";
  setNetworkCaption(NETWORK_CAPTION);
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

/**
 * The teacher for behaviour cloning is whatever the console currently holds as
 * the best agent for that level, so cloning after a retrain copies the new one.
 */
function teacherFor(level: number): Genome {
  const recorded = history.levels[level];
  return recorded.generations[recorded.bestGeneration].genome;
}

/**
 * `label` names the method in the dropdown, `short` fits the training screen's
 * header, where the full name ran over the progress bar.
 */
/**
 * `architectureFor` lets a method choose its own output layer: a value head
 * has one output per button combination where a control head has three.
 */
const controlHead = (hidden: readonly number[]): Architecture => ({ ...DEFAULT_ARCHITECTURE, hidden });
const valueHead = (hidden: readonly number[]): Architecture => ({ ...DQN_ARCHITECTURE, hidden });

const TRAINING_METHODS = {
  evolution: {
    label: "evolutie",
    short: "EVOLUTIE",
    create: createTrainer,
    architectureFor: controlHead,
  },
  gradient: {
    label: "gradient (REINFORCE)",
    short: "GRADIENT",
    create: createReinforceTrainer,
    architectureFor: controlHead,
  },
  clone: {
    label: "nadoen (behaviour cloning)",
    short: "NADOEN",
    create: createCloneTrainerUsing(teacherFor),
    architectureFor: controlHead,
  },
  cmaes: {
    label: "CMA-ES",
    short: "CMA-ES",
    create: createCmaesTrainer,
    architectureFor: controlHead,
  },
  qlearning: {
    label: "Q-learning (DQN)",
    short: "DQN",
    create: createDqnTrainer,
    architectureFor: valueHead,
  },
} as const;

type Method = keyof typeof TRAINING_METHODS;

let method: Method = "evolution";

function startTraining(
  hidden: readonly number[] = history.architecture.hidden,
  chosen: Method = method
): void {
  screen = "training";
  method = chosen;
  const { create, short, architectureFor } = TRAINING_METHODS[chosen];
  training = startTrainingSession(create, short, architectureFor(hidden));
  generationsEl.replaceChildren();
}

function startWeightMap(): void {
  screen = "weights";
  generationsEl.replaceChildren();
  setNetworkCaption(WEIGHTS_CAPTION);
}

/**
 * The answer to "what is actually saved": one cell per stored number, laid
 * out the way the flat genome is packed.
 */
function drawWeights(): void {
  const genome = shippedGenome();
  const count = genomeSize(history.architecture);
  const shape = [
    history.architecture.inputs,
    ...history.architecture.hidden,
    history.architecture.outputs,
  ].join(" x ");

  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "OPGESLAGEN GEWICHTEN", CANVAS_W / 2, 40, 1, COLORS.highlight);
  drawTextCentered(ctx, `LEVEL ${levelIndex + 1}`, CANVAS_W / 2, 90, 1, COLORS.text);
  drawTextCentered(ctx, `${count} GETALLEN`, CANVAS_W / 2, 130, 1, COLORS.text);
  drawTextCentered(ctx, shape.toUpperCase(), CANVAS_W / 2, 170, 1, COLORS.dimText);
  if (blinkTimer < BLINK_HALF) {
    drawTextCentered(ctx, "ESCAPE VOOR HET MENU", CANVAS_W / 2, 220, 1, COLORS.faintText);
  }

  if (networkCtx !== null) {
    drawWeightMap(networkCtx, genome, history.architecture);
  }
  statusEl.textContent =
    `Elk vakje is een van de ${String(count)} getallen die per generatie worden bewaard: ` +
    `een rij per knoop, een kolom per inkomende waarde, de bias als laatste kolom. ` +
    `Geel is positief, blauw negatief. Dit is generatie ` +
    `${String(levelHistory().generations[levelHistory().bestGeneration].generation)} van level ` +
    `${String(levelIndex + 1)}.`;
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
      clearEdits();
      startReplay(0, history.levels[0].bestGeneration, false);
    },
  },
  {
    label: "ALLE GENERATIES",
    hint: "ALLEMAAL TEGELIJK MET PAD",
    run: () => {
      clearEdits();
      startReplay(0, history.levels[0].bestGeneration, true);
    },
  },
  {
    label: "TRAIN OPNIEUW",
    hint: "IN DE BROWSER, EEN MINUUT",
    run: () => {
      startTraining();
    },
  },
  {
    label: "OPGESLAGEN GEWICHTEN",
    hint: "WAT ER IN HET BESTAND STAAT",
    run: startWeightMap,
  },
  { label: "DOWNLOAD DATA", hint: "JSON OM TE COMMITTEN", run: downloadHistory },
  {
    label: "SPEEL ZELF",
    hint: "TERUG NAAR HET SPEL",
    run: () => {
      leaveConsole?.("play");
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
        clearEdits();
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
        clearEdits();
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

function drawTrails(cameraX: number, alpha = FADED_TRAIL_ALPHA): void {
  if (trails === null) {
    return;
  }
  const left = Math.round(cameraX);
  const width = Math.min(CANVAS_W, trails.width - left);
  ctx.globalAlpha = alpha;
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

/**
 * The same forward pass the agent just made, shown as it happens. Weights say
 * what the network could do; weight times activation says what it is doing.
 */
function drawNetworkFor(ghost: Ghost): void {
  if (networkCtx === null) {
    return;
  }
  const level = LEVELS[levelIndex];
  const activations = forward(ghost.genome, features(ghost.run.state, level), history.architecture);

  drawNetwork(networkCtx, {
    genome: ghost.genome,
    architecture: history.architecture,
    activations,
    pressed: chosenOutputs(outputsOf(activations), history.architecture),
    selected,
  });
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
  drawNetworkFor(lead);

  if (showAllGenerations) {
    const reached = ghosts.filter((ghost) => ghost.run.outcome === RunOutcome.Solved).length;
    drawText(ctx, `ALLE ${ghosts.length} GENERATIES`, SCREEN_MARGIN, SCREEN_MARGIN, 1, COLORS.ink);
    drawText(ctx, `FRAME ${frame} ${reached} BINNEN`, SCREEN_MARGIN, 26, 1, COLORS.ink);
    statusEl.textContent =
      `Level ${levelIndex + 1}, alle ${ghosts.length} generaties tegelijk (blauw = vroegste, geel = laatste). ` +
      `${reached} haalden het certificaat.`;
  } else {
    const ghost = ghosts[0];
    drawText(
      ctx,
      `LEVEL ${levelIndex + 1} GEN ${ghost.record.generation}`,
      SCREEN_MARGIN,
      SCREEN_MARGIN,
      1,
      COLORS.ink
    );
    drawText(ctx, `FRAME ${frame} ${OUTCOME_LABELS[ghost.run.outcome]}`, SCREEN_MARGIN, 26, 1, COLORS.ink);
    statusEl.textContent = replayStatus(ghost);
  }
}

/** Shows movement within a generation, so a slow level still looks alive. */
function finishTraining(session: TrainingSession): void {
  clearEdits();
  history = {
    architecture: session.trainers[0].architecture,
    levels: session.trainers.map((trainer) => trainer.toHistory()),
  };
  startReplay(0, history.levels[0].bestGeneration, false);
}

function advanceTraining(): void {
  if (training === null) {
    return;
  }
  if (training.advance()) {
    const finished = training;
    training = null;
    finishTraining(finished);
  }
}

function drawTraining(): void {
  if (training === null) {
    return;
  }
  training.draw(ctx, blinkTimer < BLINK_HALF);
  drawFitnessChart(chartCtx, training.currentTrainer.generations, 0);
  statusEl.textContent = training.status();
}

function advanceGhost(ghost: Ghost): void {
  if (isFinished(ghost)) {
    return;
  }
  // Re-running the stored genome through the same deterministic engine
  // reproduces that generation's run exactly: the weights are the recording.
  ghost.run = advanceRun(
    ghost.run,
    ghost.genome,
    levelIndex,
    history.architecture,
    policyFor(history.architecture)
  );
  if (frame % GHOST_PATH_SAMPLE_EVERY !== 0) {
    return;
  }
  const { player } = ghost.run.state;
  const point = { x: player.x + player.w / 2, y: player.y + 12 };
  if (ghost.index === levelHistory().bestGeneration) {
    ghost.path.push(point);
  }
  extendTrail(ghost, point);
}

function replayStatus(lead: Ghost): string {
  if (selected === null) {
    return "Klik op een verbinding in het netwerk om het gewicht te zien en aan te passen.";
  }
  const layer = layoutOf(history.architecture)[selected.layer];
  const index = layer.weight(selected.to, selected.from);
  const value = lead.genome[index].toFixed(4);
  const original = shippedGenome()[index].toFixed(4);
  const comparison =
    recordedFrames === null ? "" : ` De opname deed er ${String(recordedFrames)} frames over.`;
  return (
    `Gewicht ${String(index)} van ${String(genomeSize(history.architecture))}: ` +
    `laag ${String(selected.layer + 1)}, van knoop ${String(selected.from + 1)} naar ${String(selected.to + 1)}. ` +
    `Nu ${value}, opgenomen ${original}. Pijltjes omhoog en omlaag verschuiven het, Backspace zet het terug.` +
    comparison
  );
}

/** The recorded best genome for the level on screen, edits aside. */
function shippedGenome(): Genome {
  const level = history.levels[levelIndex];
  return level.generations[level.bestGeneration].genome;
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
  "Backspace",
]);

/** Keys that mean the same thing on every screen. Returns true when handled. */
function handleGlobalKey(key: string): boolean {
  if (FRAME_RATE_KEYS.has(key)) {
    showFrameRate = !showFrameRate;
    return true;
  }
  if (!MENU_BACK_KEYS.has(key)) {
    return false;
  }
  // Escape backs out one step at a time: a screen returns to the menu, the
  // menu returns to the game.
  if (screen === "menu") {
    leaveConsole?.("title");
  } else {
    toMenu();
  }
  return true;
}

/** Adjusting the connection picked in the network. */
function handleWeightKey(key: string): void {
  if (key === "ArrowUp") {
    nudgeSelectedWeight(1);
  } else if (key === "ArrowDown") {
    nudgeSelectedWeight(-1);
  } else if (key === "Backspace") {
    resetEditedWeights();
  }
}

function handleMenuKey(key: string): void {
  if (MENU_UP_KEYS.has(key)) {
    menu.moveBy(-1);
  } else if (MENU_DOWN_KEYS.has(key)) {
    menu.moveBy(1);
  } else if (MENU_SELECT_KEYS.has(key)) {
    menu.activate();
  }
}

function onKeyDown(event: KeyboardEvent): void {
  // Same rule as the game: swallow only the keys this page acts on, so the
  // browser's own shortcuts and Firefox's type-ahead find stay out of the way.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (CONSOLE_KEYS.has(event.key)) {
    event.preventDefault();
  }

  if (handleGlobalKey(event.key)) {
    return;
  }
  if (screen === "replay" && selected !== null) {
    handleWeightKey(event.key);
  } else if (screen === "menu") {
    handleMenuKey(event.key);
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
  } else if (screen === "weights") {
    drawWeights();
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
function buildCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  element.id = id;
  return element;
}

const NETWORK_CAPTION = "Het netwerk: links wat het ziet, rechts wat het besluit.";
const WEIGHTS_CAPTION = "De opgeslagen gewichten, per laag: een rij per knoop, de bias als laatste kolom.";

function setNetworkCaption(text: string): void {
  if (networkCaption !== null) {
    networkCaption.textContent = text;
  }
}

function buildCaption(text: string): HTMLElement {
  const caption = document.createElement("h2");
  caption.textContent = text;
  return caption;
}

/** Lets you retrain with a different shape without leaving the page. */
function buildArchitectureRow(): HTMLElement {
  const row = document.createElement("div");
  row.id = "architecture";

  const label = document.createElement("label");
  label.textContent = "verborgen lagen ";
  const input = document.createElement("input");
  input.id = "hidden-layers";
  input.value = history.architecture.hidden.join(",");
  input.size = 10;
  label.append(input);

  const methodLabel = document.createElement("label");
  methodLabel.textContent = " leren met ";
  const methodSelect = document.createElement("select");
  methodSelect.id = "method";
  for (const [value, entry] of Object.entries(TRAINING_METHODS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = entry.label;
    methodSelect.append(option);
  }
  methodLabel.append(methodSelect);

  const train = document.createElement("button");
  train.textContent = "train met deze vorm";
  train.onclick = () => {
    const hidden = parseHiddenLayers(input.value);
    if (hidden === null) {
      statusEl.textContent = `"${input.value}" is geen lijst positieve gehele getallen, bijvoorbeeld 8 of 12,6.`;
      return;
    }
    startTraining(hidden, methodSelect.value as Method);
  };

  row.append(label, methodLabel, train);
  return row;
}

/** "8" or "12,6". Anything else is refused rather than half understood. */
export function parseHiddenLayers(text: string): number[] | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return [];
  }
  const parts = trimmed.split(",").map((part) => Number(part.trim()));
  const valid = parts.every((size) => Number.isInteger(size) && size > 0 && size <= 64);
  return valid ? parts : null;
}

function buildChrome(container: HTMLElement): void {
  statusEl = document.createElement("div");
  statusEl.id = "status";

  const chartCanvas = buildCanvas("chart", 960, 180);
  chartCtx = chartCanvas.getContext("2d")!;

  networkCanvas = buildCanvas("network", 960, 380);
  networkCtx = networkCanvas.getContext("2d");
  networkCanvas.onclick = (event) => {
    onNetworkClick(event);
  };

  generationsEl = document.createElement("div");
  generationsEl.id = "generations";

  networkCaption = buildCaption(NETWORK_CAPTION);

  // The training controls sit directly under the game rather than at the very
  // bottom of the page, where the method dropdown was easy to miss entirely.
  container.replaceChildren(
    statusEl,
    buildArchitectureRow(),
    buildCaption("Fitness per generatie (\u2605 = beste). Escape brengt je terug."),
    chartCanvas,
    generationsEl,
    networkCaption,
    networkCanvas
  );
  container.hidden = false;
}

/** Canvas coordinates from a click, whatever the element is scaled to. */
function onNetworkClick(event: MouseEvent): void {
  if (networkCanvas === null || screen !== "replay" || showAllGenerations) {
    return;
  }
  const bounds = networkCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (networkCanvas.width / bounds.width);
  const y = (event.clientY - bounds.top) * (networkCanvas.height / bounds.height);
  selected = networkCtx === null ? null : connectionAt(networkCtx, history.architecture, x, y);
}

const WEIGHT_STEP = 0.05;

/** Nudges the selected weight and replays the run with it straight away. */
function nudgeSelectedWeight(direction: number): void {
  if (selected === null) {
    return;
  }
  const recorded = shippedGenome();
  recordedFrames ??= finishRun(
    recorded,
    levelIndex,
    history.architecture,
    undefined,
    policyFor(history.architecture)
  ).frames;
  const index = layoutOf(history.architecture)[selected.layer].weight(selected.to, selected.from);
  const genome = [...(editedGenome ?? recorded)];
  genome[index] = roundWeight(genome[index] + direction * WEIGHT_STEP);
  editedGenome = genome;
  startReplay(levelIndex, levelHistory().bestGeneration, false);
}

function resetEditedWeights(): void {
  editedGenome = null;
  startReplay(levelIndex, levelHistory().bestGeneration, false);
}

/**
 * Escape backs out to the title screen, but the menu entry says "speel zelf"
 * and has to mean it: landing on the title screen again is not playing.
 */
export type ConsoleExit = "title" | "play";

export type ConsoleOptions = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  onExit: (intent: ConsoleExit) => void;
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

  leaveConsole = (intent: ConsoleExit): void => {
    running = false;
    listeners.abort();
    options.container.replaceChildren();
    options.container.hidden = true;
    options.onExit(intent);
  };

  screen = "menu";
  history = shipped;
  running = true;
  toMenu();
  tick();
}
