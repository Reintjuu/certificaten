// Standalone viewer: replays a recorded agent/train.ts run through the real,
// deterministic engine and draws it with the game's own sprites/font -- but
// never touches src/main.ts's game-state-machine (title/dialogue/etc). Dev
// only: open via `npm run dev` at /agent/replay.html (Vite serves any file
// in the project in dev mode; this second HTML entry isn't wired into the
// production build).
import bestRuns from "./best-run.json"
import { CANVAS_W, CANVAS_H, LEVELS, createPlayingState, step, type GameState, type Input } from "../src/engine"
import { drawSprite, MarioIdle, MarioWalk1, MarioWalk2, MarioJump, Goomba, GoombaSquashed } from "../src/sprites"
import { drawText } from "../src/font"

type RecordedRun = { solved: boolean; frames: number; fitness: number; inputs: Input[] }
const runs = bestRuns as unknown as Record<string, RecordedRun>

const canvas = document.querySelector<HTMLCanvasElement>("#game")!
const ctx = canvas.getContext("2d")!
ctx.imageSmoothingEnabled = false

const levelButtonsEl = document.querySelector<HTMLDivElement>("#levels")!
const statusEl = document.querySelector<HTMLDivElement>("#status")!

let currentLevel = 0
let frameIndex = 0
let state: GameState = createPlayingState(0)
let playing = true

function loadLevel(levelIndex: number) {
  currentLevel = levelIndex
  frameIndex = 0
  state = createPlayingState(levelIndex)
  playing = true
}

for (let i = 0; i < LEVELS.length; i++) {
  const btn = document.createElement("button")
  btn.textContent = `Level ${i + 1}`
  btn.onclick = () => loadLevel(i)
  levelButtonsEl.appendChild(btn)
}

function drawScene(levelIndex: number) {
  const level = LEVELS[levelIndex]
  ctx.fillStyle = "#62b9ff"
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  for (const p of level.platforms) {
    ctx.fillStyle = "#42a642"
    ctx.fillRect(p.x, p.y, p.w, p.h)
    ctx.fillStyle = "#8b5a2b"
    ctx.fillRect(p.x, p.y + 5, p.w, p.h - 5)
  }
  const c = level.certificate
  ctx.fillStyle = "#fff8d6"
  ctx.fillRect(c.x, c.y, c.w, c.h)
  ctx.fillStyle = "#d33333"
  ctx.fillRect(c.x + 4, c.y + 4, 10, 4)
  ctx.fillRect(c.x + 7, c.y + 8, 4, 11)
}

function marioFrame(state: GameState) {
  const p = state.player
  if (!p.grounded) return MarioJump
  if (p.vx !== 0) return p.animFrame === 0 ? MarioWalk1 : MarioWalk2
  return MarioIdle
}

function draw() {
  drawScene(currentLevel)
  for (const e of state.enemies) {
    if (!e.alive && e.squashTimer <= 0) continue
    const frame = e.alive ? Goomba : GoombaSquashed
    const y = e.alive ? e.y : e.y + (e.h - GoombaSquashed.length)
    drawSprite(ctx, frame, e.x, y, 1, false)
  }
  const p = state.player
  drawSprite(ctx, marioFrame(state), p.x, p.y, 1, p.facing === -1)

  const run = runs[currentLevel]
  const label = run
    ? `LEVEL ${currentLevel + 1} - FRAME ${frameIndex} OF ${run.frames} - ${run.solved ? "SOLVED" : "DID NOT SOLVE"}`
    : `LEVEL ${currentLevel + 1} - NO RECORDED RUN`
  drawText(ctx, label, 6, 6, 0.6, "#111111")
  statusEl.textContent = playing ? "playing" : "finished (restarting)"
}

function tick() {
  const run = runs[currentLevel]
  if (run && playing && frameIndex < run.inputs.length && state.phase !== "dead" && state.phase !== "dialogue") {
    state = step(state, run.inputs[frameIndex])
    frameIndex++
  } else {
    playing = false
  }
  draw()
  if (!playing) {
    setTimeout(() => loadLevel(currentLevel), 1200)
  }
  requestAnimationFrame(tick)
}

loadLevel(0)
tick()
