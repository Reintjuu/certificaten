import {
  BLINK_PERIOD_FRAMES,
  CANVAS_W,
  CANVAS_H,
  LEVELS,
  NO_INPUT,
  assertNever,
  createInitialState,
  step,
  type GameState,
} from "./engine";
import { COLORS, SCREEN_MARGIN, drawFrameRate, drawScene, drawEntities, withCamera } from "./render";
import { drawText, drawTextCentered, wrapText } from "./font";
import { Menu } from "./menu";
import { createFrameRate } from "./fps";
import { eventsBetween } from "./sound-events";
import { isMuted, play, toggleMuted, unlockSound } from "./sound";
import { KEY_BINDINGS, consumesKey, readInput, readMenuInput } from "./input";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const consoleContainer = document.querySelector<HTMLElement>("#console")!;
const controlsHint = document.querySelector<HTMLElement>("#controls")!;

const RESTART_PROMPT = "DRUK OP R: OPNIEUW";

/** Down right now. */
const heldKeys = new Set<string>();
/** Keydowns since the last frame, drained by the loop. */
const pressedKeys = new Set<string>();
let state: GameState = createInitialState();
let running = true;

const frameRate = createFrameRate();
let showFrameRate = false;

addEventListener("keydown", (event) => {
  // Leave shortcuts alone: Ctrl+R must still reload the page.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (consumesKey(key)) {
    event.preventDefault();
  }
  // The operating system repeats keydown while a key is held; that is not a
  // new press, and counting it as one would re-trigger the jump on landing.
  // Browsers will not start audio until the page has been interacted with.
  unlockSound();
  if (!event.repeat) {
    pressedKeys.add(key);
    if (KEY_BINDINGS.frameRate.has(key)) {
      showFrameRate = !showFrameRate;
    }
    if (KEY_BINDINGS.mute.has(key)) {
      toggleMuted();
    }
  }
  heldKeys.add(key);
});
addEventListener("keyup", (event) => heldKeys.delete(event.key.toLowerCase()));
// Without this, alt-tabbing away mid-run leaves the key "held" forever and
// the player keeps walking after you come back.
addEventListener("blur", () => {
  heldKeys.clear();
  pressedKeys.clear();
});

function startGame(): void {
  state = step(state, { ...NO_INPUT, confirmPressed: true });
}

/**
 * The console and the training data it carries are a lazy import, so the game
 * itself stays a couple of kilobytes: nothing of it is fetched until someone
 * picks it from the title screen.
 */
function openAgentConsole(): void {
  running = false;
  controlsHint.hidden = true;
  void import("./agent/console").then(({ openConsole }) => {
    openConsole({
      canvas,
      container: consoleContainer,
      onExit: (intent) => {
        controlsHint.hidden = false;
        state = createInitialState();
        heldKeys.clear();
        pressedKeys.clear();
        running = true;
        titleMenu.reset();
        if (intent === "play") {
          startGame();
        }
        loop();
      },
    });
  });
}

const titleMenu = new Menu(
  "QUEESTE NAAR DE",
  [
    { label: "SPEEL", hint: "BEGIN BIJ LOKET EEN", run: startGame },
    { label: "AI CONSOLE", hint: "LAAT DE AI HET DOEN", run: openAgentConsole },
  ],
  "CERTIFICATEN"
);

/** Mouse position in the canvas's own 480x270 coordinates. */
function canvasY(event: MouseEvent): number {
  const bounds = canvas.getBoundingClientRect();
  return (event.clientY - bounds.top) * (canvas.height / bounds.height);
}

canvas.addEventListener("mousemove", (event) => {
  if (running && state.phase === "title") {
    titleMenu.hover(canvasY(event));
  }
});
canvas.addEventListener("click", (event) => {
  if (running && state.phase === "title" && titleMenu.rowAt(canvasY(event)) !== null) {
    titleMenu.activate();
  }
});

/** Laid out like SMB1's header: labels on one row, values under them. */
function drawHud(state: GameState): void {
  const time = String(Math.max(0, state.timeRemaining)).padStart(3, "0");
  const columns = [
    { x: 24, label: "QUEESTE", value: `${state.levelIndex + 1}-${LEVELS.length}` },
    { x: 200, label: "LOKET", value: `${state.levelIndex + 1}` },
    { x: 344, label: "TIJD", value: time },
  ];

  for (const column of columns) {
    drawText(ctx, column.label, column.x, 6, 1, COLORS.ink);
    drawText(ctx, column.value, column.x, 26, 1, COLORS.ink);
  }
}

function drawDialogueBox(state: GameState): void {
  const boxX = 6;
  const boxY = 130;
  const boxW = CANVAS_W - 12;
  const boxH = 134;

  ctx.fillStyle = COLORS.dialogueBorder;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = COLORS.dialogueBg;
  ctx.fillRect(boxX + 3, boxY + 3, boxW - 6, boxH - 6);

  const scale = 1;
  const padding = 10;
  const lineHeight = 16 * scale + 3;
  const maxChars = Math.floor((boxW - padding * 2) / (16 * scale));
  const line = state.dialogueLines[state.dialogueIndex] ?? "";
  const wrapped = wrapText(line, maxChars);

  wrapped.forEach((row, i) => {
    drawText(ctx, row, boxX + padding, boxY + padding + i * lineHeight, scale, COLORS.text);
  });

  if (state.blinkTimer < BLINK_PERIOD_FRAMES / 2) {
    drawText(ctx, "▼", boxX + boxW - 24, boxY + boxH - 22, 1, COLORS.text);
  }
}

function drawGameComplete(): void {
  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "QUEESTE VOLBRACHT", CANVAS_W / 2, 100, 1, COLORS.highlight);
  drawTextCentered(ctx, RESTART_PROMPT, CANVAS_W / 2, 140, 1, COLORS.text);
}

function drawDeadOverlay(): void {
  ctx.fillStyle = COLORS.shroud;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "JE BENT GESTRAND", CANVAS_W / 2, 110, 1, COLORS.text);
  drawTextCentered(ctx, RESTART_PROMPT, CANVAS_W / 2, 150, 1, COLORS.text);
}

function drawWorld(state: GameState): void {
  withCamera(ctx, state.cameraX, () => {
    drawScene(ctx, LEVELS[state.levelIndex], state.cameraX);
    drawEntities(ctx, state);
  });
}

function draw(state: GameState): void {
  switch (state.phase) {
    case "title":
      titleMenu.draw(ctx, state.blinkTimer);
      return;
    case "dialogue":
      withCamera(ctx, state.cameraX, () => {
        drawScene(ctx, LEVELS[state.levelIndex], state.cameraX);
      });
      drawDialogueBox(state);
      return;
    case "playing":
      drawWorld(state);
      drawHud(state);
      return;
    case "dead":
      drawWorld(state);
      drawHud(state);
      drawDeadOverlay();
      return;
    case "gameComplete":
      drawGameComplete();
      return;
    default:
      assertNever(state.phase);
  }
}

/** On the title screen the same keys drive the menu instead of the player. */
function advanceTitle(): void {
  const menuInput = readMenuInput(pressedKeys);
  if (menuInput.up) {
    titleMenu.moveBy(-1);
  }
  if (menuInput.down) {
    titleMenu.moveBy(1);
  }
  if (menuInput.confirm) {
    titleMenu.activate();
  }
  if (state.phase === "title") {
    state = step(state, NO_INPUT);
  }
}

function loop(): void {
  if (!running) {
    return;
  }
  const before = state;
  if (state.phase === "title") {
    advanceTitle();
  } else {
    state = step(state, readInput(heldKeys, pressedKeys));
  }
  for (const event of eventsBetween(before, state)) {
    play(event);
  }
  draw(state);
  frameRate.record();
  if (showFrameRate) {
    drawFrameRate(ctx, frameRate.perSecond);
  }
  if (isMuted()) {
    drawText(ctx, "GELUID UIT", SCREEN_MARGIN, CANVAS_H - 44, 1, COLORS.faintText);
  }
  pressedKeys.clear();
  requestAnimationFrame(loop);
}

loop();
