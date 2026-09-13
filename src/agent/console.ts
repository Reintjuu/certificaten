// The AI console: pick what to do from a menu instead of running npm scripts.
// It replays recorded runs, trains fresh ones in the browser, and hands the
// result back as a file. The title screen opens it.
//
// It never touches the game's own loop; it borrows the canvas, drives the same
// pure engine and draws with the same renderer.
import trainingHistory from "./training-history.json";
import { CANVAS_H, CANVAS_W, LEVELS } from "../engine";
import { COLORS, drawFrameRate } from "../render";
import { drawTextCentered } from "../font";
import { Menu } from "../menu";
import { createFrameRate } from "../fps";
import { drawFitnessChart } from "./chart";
import { finishRun } from "./run";
import { checkHistory, createTrainer, type LevelHistory, type TrainingHistory } from "./evolution";
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
import { createMapElitesTrainer, type Archive } from "./map-elites";
import { cellAt, drawArchive } from "./archive-view";
import { DQN_ARCHITECTURE, createDqnTrainer } from "./dqn";
import { startTrainingSession, type TrainingSession } from "./training-view";
import { startReplaySession, type Ghost, type ReplaySession } from "./replay-view";

type Screen = "menu" | "replay" | "training" | "weights" | "archive";
const shipped = checkHistory(trainingHistory);
// Starts as the recording committed to the repo. Training in the browser
// replaces it in memory only: a static host can't be written to, so keeping a
// browser-trained result means downloading it and committing the file.
let history: TrainingHistory = shipped;

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
let blinkTimer = 0;
let replay: ReplaySession | null = null;
let training: TrainingSession | null = null;
/**
 * Archives from the last MAP-Elites run, one per level, kept to look at. Held
 * at full length so indexing a level always answers rather than running off
 * the end of an array the type says cannot be short.
 */
const archives: (Archive | null)[] = LEVELS.map(() => null);

function levelHistory(): LevelHistory {
  return history.levels[levelIndex];
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

  replay = startReplaySession({
    levelIndex: level,
    architecture: history.architecture,
    generations: levelHistory().generations,
    leadGeneration: all ? levelHistory().bestGeneration : generation,
    showAll: all,
    genomeFor: (record, index) =>
      index === levelHistory().bestGeneration ? (editedGenome ?? record.genome) : record.genome,
  });

  renderGenerationButtons();
  drawFitnessChart(chartCtx, levelHistory().generations, levelHistory().bestGeneration);
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
  archive: {
    label: "MAP-Elites (archief)",
    short: "MAP-ELITES",
    create: createMapElitesTrainer,
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

function startArchive(): void {
  if (archives[levelIndex] === null) {
    statusEl.textContent =
      "Er is nog geen archief. Train eerst met MAP-Elites; die bewaart per soort gedrag de beste agent.";
    return;
  }
  screen = "archive";
  generationsEl.replaceChildren();
  setNetworkCaption(ARCHIVE_CAPTION);
}

function drawArchiveScreen(): void {
  const grid = archives[levelIndex];
  if (grid === null) {
    toMenu();
    return;
  }

  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "ARCHIEF", CANVAS_W / 2, 44, 1, COLORS.highlight);
  drawTextCentered(ctx, `LEVEL ${levelIndex + 1}`, CANVAS_W / 2, 96, 1, COLORS.text);
  drawTextCentered(ctx, "KLIK EEN VAKJE", CANVAS_W / 2, 140, 1, COLORS.dimText);
  if (blinkTimer < BLINK_HALF) {
    drawTextCentered(ctx, "ESCAPE VOOR HET MENU", CANVAS_W / 2, 200, 1, COLORS.faintText);
  }

  if (networkCtx !== null) {
    drawArchive(networkCtx, grid);
  }
  statusEl.textContent =
    "Elk vakje is een soort gedrag: hoe ver hij kwam tegen hoe hoog hij kwam, met de beste agent " +
    "die zich zo gedroeg. Klik er een aan om hem te zien spelen.";
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
  { label: "ARCHIEF", hint: "GEDRAG UIT MAP-ELITES", run: startArchive },
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
  if (replay === null) {
    return;
  }
  replay.draw(ctx);
  drawNetworkFor(replay.lead);

  statusEl.textContent = replay.showAll
    ? `Level ${String(levelIndex + 1)}, alle ${String(replay.ghosts.length)} generaties tegelijk ` +
      `(blauw = vroegste, geel = laatste). ${String(replay.reached)} haalden het certificaat.`
    : replayStatus(replay.lead);
}

function advanceReplay(): void {
  if (replay?.advance() === true) {
    startReplay(levelIndex, generationIndex, showAllGenerations);
  }
}

/** Shows movement within a generation, so a slow level still looks alive. */
function hasArchive(trainer: unknown): trainer is { archive: Archive } {
  return typeof trainer === "object" && trainer !== null && "archive" in trainer;
}

function finishTraining(session: TrainingSession): void {
  clearEdits();
  session.trainers.forEach((trainer, level) => {
    archives[level] = hasArchive(trainer) ? trainer.archive : null;
  });
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
  } else if (screen === "archive") {
    drawArchiveScreen();
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
const ARCHIVE_CAPTION = "Het archief: een vakje per soort gedrag, met de beste agent die zich zo gedroeg.";

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
  if (networkCanvas === null || networkCtx === null) {
    return;
  }
  const bounds = networkCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (networkCanvas.width / bounds.width);
  const y = (event.clientY - bounds.top) * (networkCanvas.height / bounds.height);

  if (screen === "archive") {
    playElite(cellAt(networkCtx, x, y));
    return;
  }
  if (screen === "replay" && !showAllGenerations) {
    selected = connectionAt(networkCtx, history.architecture, x, y);
  }
}

/** Replays whichever agent fills the clicked cell of the archive. */
function playElite(cell: number | null): void {
  const grid = archives[levelIndex];
  const elite = cell === null || grid === null ? null : grid[cell];
  if (elite === null) {
    statusEl.textContent = "Dat vakje is leeg: geen enkele agent gedroeg zich zo.";
    return;
  }
  editedGenome = elite.genome;
  selected = null;
  recordedFrames = null;
  startReplay(levelIndex, levelHistory().bestGeneration, false);
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
