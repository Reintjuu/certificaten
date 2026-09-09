import { BLINK_PERIOD_FRAMES, CANVAS_W, CANVAS_H, LEVELS, assertNever, createInitialState, step, type GameState, type Input } from "./engine"
import { COLORS, drawScene, drawEntities, withCamera } from "./render"
import { drawText, drawTextCentered, wrapText } from "./font"

const canvas = document.querySelector<HTMLCanvasElement>("#game")!
const ctx = canvas.getContext("2d")!
ctx.imageSmoothingEnabled = false

const JUMP_KEYS = new Set([" ", "w", "arrowup"])
const CONFIRM_KEYS = new Set([" ", "enter"])
const LEFT_KEYS = new Set(["arrowleft", "a"])
const RIGHT_KEYS = new Set(["arrowright", "d"])
const RESET_KEYS = new Set(["r"])
// The NES B button: hold to run instead of walk.
const RUN_KEYS = new Set(["shift", "x"])

// Only the keys that would otherwise scroll the page. Swallowing every
// keydown also swallowed F5, Ctrl+R and Tab, so the page couldn't be
// refreshed while it had focus.
const SCROLL_KEYS = new Set([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"])

const keys = new Set<string>()
let prevKeys = new Set<string>()

addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (SCROLL_KEYS.has(key)) e.preventDefault()
  keys.add(key)
})
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()))
// Without this, alt-tabbing away mid-run leaves the key "held" forever and
// the player keeps walking after you come back.
addEventListener("blur", () => keys.clear())

function anyPressed(current: Set<string>, previous: Set<string>, mapped: Set<string>) {
  for (const k of mapped) {
    if (current.has(k) && !previous.has(k)) return true
  }
  return false
}

function anyHeld(current: Set<string>, mapped: Set<string>) {
  for (const k of mapped) if (current.has(k)) return true
  return false
}

function readInput(): Input {
  return {
    left: anyHeld(keys, LEFT_KEYS),
    right: anyHeld(keys, RIGHT_KEYS),
    jumpHeld: anyHeld(keys, JUMP_KEYS),
    run: anyHeld(keys, RUN_KEYS),
    jumpPressed: anyPressed(keys, prevKeys, JUMP_KEYS),
    confirmPressed: anyPressed(keys, prevKeys, CONFIRM_KEYS),
    resetPressed: anyPressed(keys, prevKeys, RESET_KEYS),
  }
}

let state: GameState = createInitialState()

function drawHud(state: GameState) {
  drawText(ctx, `LEVEL ${state.levelIndex + 1}-${LEVELS.length}`, 8, 6, 1, COLORS.ink)
  const time = String(Math.max(0, state.timeRemaining)).padStart(3, "0")
  drawText(ctx, `TIJD ${time}`, CANVAS_W - 8 * 16, 6, 1, COLORS.ink)
}

function drawDialogueBox(state: GameState) {
  const boxX = 6
  const boxY = 130
  const boxW = CANVAS_W - 12
  const boxH = 134

  ctx.fillStyle = COLORS.dialogueBorder
  ctx.fillRect(boxX, boxY, boxW, boxH)
  ctx.fillStyle = COLORS.dialogueBg
  ctx.fillRect(boxX + 3, boxY + 3, boxW - 6, boxH - 6)

  const scale = 1
  const padding = 10
  const lineHeight = 16 * scale + 3
  const maxChars = Math.floor((boxW - padding * 2) / (16 * scale))
  const line = state.dialogueLines[state.dialogueIndex] ?? ""
  const wrapped = wrapText(line, maxChars)

  wrapped.forEach((row, i) => {
    drawText(ctx, row, boxX + padding, boxY + padding + i * lineHeight, scale, "#ffffff")
  })

  if (state.blinkTimer < BLINK_PERIOD_FRAMES / 2) {
    drawText(ctx, "▼", boxX + boxW - 24, boxY + boxH - 22, 1, "#ffffff")
  }
}

function drawTitleScreen(state: GameState) {
  ctx.fillStyle = COLORS.nightSky
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  drawTextCentered(ctx, "QUEESTE NAAR DE", CANVAS_W / 2, 60, 1, "#ffffff")
  drawTextCentered(ctx, "CERTIFICATEN", CANVAS_W / 2, 84, 1, COLORS.highlight)

  if (state.blinkTimer < BLINK_PERIOD_FRAMES / 2) {
    drawTextCentered(ctx, "PRESS START", CANVAS_W / 2, 170, 1, "#ffffff")
  }
}

function drawGameComplete() {
  ctx.fillStyle = COLORS.nightSky
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  drawTextCentered(ctx, "QUEESTE VOLBRACHT", CANVAS_W / 2, 100, 1, COLORS.highlight)
  drawTextCentered(ctx, "DRUK OP R: OPNIEUW", CANVAS_W / 2, 140, 1, "#ffffff")
}

function drawDeadOverlay() {
  ctx.fillStyle = "rgba(0,0,0,0.72)"
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  drawTextCentered(ctx, "JE BENT GESTRAND", CANVAS_W / 2, 110, 1, "#ffffff")
  drawTextCentered(ctx, "DRUK OP R: OPNIEUW", CANVAS_W / 2, 150, 1, "#ffffff")
}

function drawWorld(state: GameState) {
  withCamera(ctx, state.cameraX, () => {
    drawScene(ctx, LEVELS[state.levelIndex])
    drawEntities(ctx, state)
  })
}

function draw(state: GameState) {
  switch (state.phase) {
    case "title":
      drawTitleScreen(state)
      return
    case "dialogue":
      withCamera(ctx, state.cameraX, () => drawScene(ctx, LEVELS[state.levelIndex]))
      drawDialogueBox(state)
      return
    case "playing":
      drawWorld(state)
      drawHud(state)
      return
    case "dead":
      drawWorld(state)
      drawHud(state)
      drawDeadOverlay()
      return
    case "gameComplete":
      drawGameComplete()
      return
    default:
      assertNever(state.phase)
  }
}

function loop() {
  const input = readInput()
  state = step(state, input)
  draw(state)
  prevKeys = new Set(keys)
  requestAnimationFrame(loop)
}

loop()
