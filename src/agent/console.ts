// The AI console: pick what to do from a menu instead of running npm scripts.
// It replays recorded runs, trains fresh ones in the browser, and hands the
// result back as a file. The title screen opens it.
//
// It never touches the game's own loop; it borrows the canvas, drives the same
// pure engine and draws with the same renderer.
import trainingHistory from "./training-history.json";
import { LEVELS, type Input } from "../engine";
import { drawFrameRate } from "../render";
import { Menu } from "../menu";
import { createFrameRate } from "../fps";
import { drawFitnessChart } from "./chart";
import { checkHistory, type LevelHistory, type TrainingHistory } from "./evolution";
import { features, forward, chosenOutputs, outputsOf, type Genome } from "./policy";
import { connectionAt, drawNetwork } from "./network-view";
import { createWeightEditor, type EditTarget } from "./weight-editing";
import { type Archive } from "./map-elites";
import { isMethod, trainingMethods, type Method } from "./methods";
import { cellAt, drawArchiveScreen as drawArchiveScreenView } from "./archive-view";
import { CAPTIONS, buildChrome, type Chrome } from "./console-chrome";
import { drawWeightsScreen } from "./weights-view";
import { isNeat, neatPolicy } from "./neat-trainer";
import { decodeGenome } from "./neat";
import { drawNeatNetwork } from "./neat-view";
import { startTrainingSession, type TrainingSession } from "./training-view";
import { startReplaySession, type Ghost, type ReplaySession } from "./replay-view";
import { routeFor } from "./routes";
import { startRun, stepRun, RunOutcome } from "./run";

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
let chrome: Chrome | null = null;
let leaveConsole: ((intent: ConsoleExit) => void) | null = null;
let running = false;

const frameRate = createFrameRate();
let showFrameRate = false;

/** Picking a connection apart, which only the replay screen offers. */
const editor = createWeightEditor(() => {
  startReplay(levelIndex, levelHistory().bestGeneration, false);
});

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

/** The one line of text under the picture, which every screen writes to. */
function say(text: string): void {
  if (chrome !== null) {
    chrome.status.textContent = text;
  }
}

function levelHistory(): LevelHistory {
  return history.levels[levelIndex];
}

/**
 * Where the A* route puts the player on every frame. Read from the file the
 * trainer writes rather than searched here: one search is a few seconds of
 * work, and doing that between frames made the first seconds of a replay
 * stutter.
 */
const routePoints = new Map<number, { x: number; y: number }[]>();

function routeToBeat(levelIndex: number): { x: number; y: number }[] {
  const known = routePoints.get(levelIndex);
  if (known !== undefined) {
    return known;
  }
  const points: { x: number; y: number }[] = [];
  let run = startRun(levelIndex);
  for (const input of routeFor(levelIndex) ?? []) {
    if (run.outcome !== RunOutcome.Running) {
      break;
    }
    run = stepRun(run, input, levelIndex);
    const { player } = run.state;
    points.push({ x: player.x + player.w / 2, y: player.y + 12 });
  }
  routePoints.set(levelIndex, points);
  return points;
}

function startReplay(level: number, generation: number, all: boolean): void {
  screen = "replay";
  setNetworkCaption(CAPTIONS.network);
  levelIndex = level;
  generationIndex = generation;
  showAllGenerations = all;

  replay = startReplaySession({
    levelIndex: level,
    routeToBeat: routeToBeat(level),
    policy: isNeat(history.architecture) ? neatPolicy : undefined,
    architecture: history.architecture,
    generations: levelHistory().generations,
    leadGeneration: all ? levelHistory().bestGeneration : generation,
    showAll: all,
    genomeFor: (record, index) =>
      index === levelHistory().bestGeneration ? (editor.edited ?? record.genome) : record.genome,
  });

  renderGenerationButtons();
  drawFitnessChart(chrome!.chartCtx, levelHistory().generations, levelHistory().bestGeneration);
}

/**
 * The teacher for behaviour cloning is whatever the console currently holds as
 * the best agent for that level, so cloning after a retrain copies the new one.
 */
function teacherFor(level: number): Genome {
  const recorded = history.levels[level];
  return recorded.generations[recorded.bestGeneration].genome;
}

const TRAINING_METHODS = trainingMethods(teacherFor);

let method: Method = "evolution";

function startTraining(
  hidden: readonly number[] = history.architecture.hidden,
  chosen: Method = method
): void {
  screen = "training";
  method = chosen;
  const { create, short, architectureFor } = TRAINING_METHODS[chosen];
  training = startTrainingSession(create, short, architectureFor(hidden));
  chrome?.generations.replaceChildren();
}

function startArchive(): void {
  if (archives[levelIndex] === null) {
    say("Er is nog geen archief. Train eerst met MAP-Elites; die bewaart per soort gedrag de beste agent.");
    return;
  }
  screen = "archive";
  chrome?.generations.replaceChildren();
  setNetworkCaption(CAPTIONS.archive);
}

function drawArchiveScreen(): void {
  const grid = archives[levelIndex];
  if (grid === null) {
    toMenu();
    return;
  }
  say(
    drawArchiveScreenView(ctx, chrome?.networkCtx ?? null, {
      archive: grid,
      levelIndex,
      prompt: blinkTimer < BLINK_HALF,
    })
  );
}

function startWeightMap(): void {
  screen = "weights";
  chrome?.generations.replaceChildren();
  setNetworkCaption(CAPTIONS.weights);
}

function drawWeights(): void {
  say(
    drawWeightsScreen(ctx, chrome?.networkCtx ?? null, {
      genome: shippedGenome(),
      architecture: history.architecture,
      levelIndex,
      generation: levelHistory().generations[levelHistory().bestGeneration].generation,
      prompt: blinkTimer < BLINK_HALF,
    })
  );
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
      editor.clear();
      startReplay(0, history.levels[0].bestGeneration, false);
    },
  },
  {
    label: "ALLE GENERATIES",
    hint: "ALLEMAAL TEGELIJK MET PAD",
    run: () => {
      editor.clear();
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
    chrome?.generations.replaceChildren();
    return;
  }
  const { generations, bestGeneration } = levelHistory();
  chrome?.generations.replaceChildren(
    ...LEVELS.map((_, index) => {
      const button = document.createElement("button");
      button.textContent = `Level ${index + 1}`;
      button.className = index === levelIndex ? "active" : "";
      button.onclick = () => {
        editor.clear();
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
        editor.clear();
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
/** Which of the three output nodes is pressing something this frame. */
function buttonsOf(input: Input): boolean[] {
  return [input.left || input.right, input.jumpHeld, input.run];
}

function drawNetworkFor(ghost: Ghost): void {
  const networkCtx = chrome?.networkCtx ?? null;
  if (networkCtx === null) {
    return;
  }
  const level = LEVELS[levelIndex];
  if (isNeat(history.architecture)) {
    // A grown network has no layers to stack, so it gets its own drawing.
    const inputs = features(ghost.run.state, level);
    drawNeatNetwork(networkCtx, {
      genome: decodeGenome(ghost.genome),
      inputs,
      pressed: buttonsOf(neatPolicy(ghost.genome, ghost.run.state, level, history.architecture)),
    });
    return;
  }
  const activations = forward(ghost.genome, features(ghost.run.state, level), history.architecture);

  drawNetwork(networkCtx, {
    genome: ghost.genome,
    architecture: history.architecture,
    activations,
    pressed: chosenOutputs(outputsOf(activations), history.architecture),
    selected: editor.selected,
  });
}

function drawReplay(): void {
  if (replay === null) {
    return;
  }
  replay.draw(ctx);
  drawNetworkFor(replay.lead);

  say(
    replay.showAll
      ? `Level ${String(levelIndex + 1)}, alle ${String(replay.ghosts.length)} generaties tegelijk ` +
          `(blauw = vroegste, geel = laatste). ${String(replay.reached)} haalden het certificaat.`
      : replayStatus(replay.lead)
  );
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
  editor.clear();
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
  drawFitnessChart(chrome!.chartCtx, training.currentTrainer.generations, 0);
  say(training.status());
}

function replayStatus(lead: Ghost): string {
  const described = editor.describe(editTarget(), lead.genome);
  if (described !== null) {
    return described;
  }
  return isNeat(history.architecture)
    ? "Dit netwerk is gegroeid: NEAT begon zonder verborgen knopen en heeft deze er zelf bij gemaakt."
    : "Klik op een verbinding in het netwerk om het gewicht te zien en aan te passen.";
}

/** The recorded best genome for the level on screen, edits aside. */
function shippedGenome(): Genome {
  const level = history.levels[levelIndex];
  return level.generations[level.bestGeneration].genome;
}

/** What an edit on this screen is an edit of. */
function editTarget(): EditTarget {
  return { architecture: history.architecture, recorded: shippedGenome(), levelIndex };
}

function toMenu(): void {
  screen = "menu";
  chrome?.generations.replaceChildren();
  say("Kies met de pijltjes en Enter, of klik.");
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
  if (screen === "replay" && editor.selected !== null) {
    editor.handleKey(event.key, editTarget());
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

function setNetworkCaption(text: string): void {
  chrome?.setCaption(text);
}

/** A click in the network picture, which two screens make something of. */
function onNetworkClick(x: number, y: number): void {
  const networkCtx = chrome?.networkCtx ?? null;
  if (networkCtx === null) {
    return;
  }
  if (screen === "archive") {
    playElite(cellAt(networkCtx, x, y));
    return;
  }
  // A grown network's connections are not at layer coordinates, so there is
  // nothing to pick at: NEAT draws its graph and leaves the weights alone.
  if (screen === "replay" && !showAllGenerations && !isNeat(history.architecture)) {
    editor.select(connectionAt(networkCtx, history.architecture, x, y));
  }
}

/** Replays whichever agent fills the clicked cell of the archive. */
function playElite(cell: number | null): void {
  const grid = archives[levelIndex];
  const elite = cell === null || grid === null ? null : grid[cell];
  if (elite === null) {
    say("Dat vakje is leeg: geen enkele agent gedroeg zich zo.");
    return;
  }
  editor.adopt(elite.genome);
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
  chrome = buildChrome({
    container: options.container,
    methods: TRAINING_METHODS,
    hidden: history.architecture.hidden,
    onNetworkClick,
    onTrain: (hidden, chosen) => {
      // The dropdown is built from the same list, so this only fails if the
      // two ever drift apart.
      if (isMethod(chosen, TRAINING_METHODS)) {
        startTraining(hidden, chosen);
      }
    },
    onBadLayers: (text) => {
      say(`"${text}" is geen lijst positieve gehele getallen, bijvoorbeeld 8 of 12,6.`);
    },
  });

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
