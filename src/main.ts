import {
  BLINK_PERIOD_FRAMES,
  CANVAS_W,
  CANVAS_H,
  LEVELS,
  assertNever,
  createInitialState,
  step,
  type GameState,
} from "./engine";
import { COLORS, drawScene, drawEntities, withCamera } from "./render";
import { drawText, drawTextCentered, wrapText } from "./font";
import { consumesKey, readInput } from "./input";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const RESTART_PROMPT = "DRUK OP R: OPNIEUW";

const keys = new Set<string>();
let prevKeys = new Set<string>();

addEventListener("keydown", (event) => {
  // Leave shortcuts alone: Ctrl+R must still reload the page.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (consumesKey(key)) {
    event.preventDefault();
  }
  keys.add(key);
});
addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
// Without this, alt-tabbing away mid-run leaves the key "held" forever and
// the player keeps walking after you come back.
addEventListener("blur", () => {
  keys.clear();
});

let state: GameState = createInitialState();

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

function drawTitleScreen(state: GameState): void {
  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawTextCentered(ctx, "QUEESTE NAAR DE", CANVAS_W / 2, 60, 1, COLORS.text);
  drawTextCentered(ctx, "CERTIFICATEN", CANVAS_W / 2, 84, 1, COLORS.highlight);

  if (state.blinkTimer < BLINK_PERIOD_FRAMES / 2) {
    drawTextCentered(ctx, "PRESS START", CANVAS_W / 2, 170, 1, COLORS.text);
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
    drawScene(ctx, LEVELS[state.levelIndex]);
    drawEntities(ctx, state);
  });
}

function draw(state: GameState): void {
  switch (state.phase) {
    case "title":
      drawTitleScreen(state);
      return;
    case "dialogue":
      withCamera(ctx, state.cameraX, () => {
        drawScene(ctx, LEVELS[state.levelIndex]);
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

function loop(): void {
  const input = readInput(keys, prevKeys);
  state = step(state, input);
  draw(state);
  prevKeys = new Set(keys);
  requestAnimationFrame(loop);
}

loop();
