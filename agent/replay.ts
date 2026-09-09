// Standalone viewer for a training run: replays stored genomes through the
// real, deterministic engine and draws them with the game's own renderer --
// without touching src/main.ts's game-state-machine. Dev only: open via
// `npm run dev` at /agent/replay.html.
//
// Two modes: one generation at a time, or every generation at once as
// coloured "ghosts" with the path each one took.
import trainingHistory from "./training-history.json"
import { LEVELS, createPlayingState, step, type GameState } from "../src/engine"
import { COLORS, drawScene, drawEntities } from "../src/render"
import { drawText } from "../src/font"
import { drawFitnessChart } from "./chart"
import { RUN_FRAME_BUDGET, actionFor } from "./policy"

// Types come from the trainer that writes this file, so the two can't drift.
// `import type` is erased, so no Node-only code reaches the browser bundle.
import type { GenerationRecord, LevelHistory } from "./train"

type Ghost = {
  record: GenerationRecord
  index: number
  state: GameState
  path: { x: number; y: number }[]
  finished: boolean
}

const history: { levels: LevelHistory[] } = trainingHistory

const RESTART_DELAY_FRAMES = 90
const PATH_SAMPLE_EVERY = 2

const canvas = document.querySelector<HTMLCanvasElement>("#game")!
const ctx = canvas.getContext("2d")!
ctx.imageSmoothingEnabled = false

const levelButtonsEl = document.querySelector<HTMLDivElement>("#levels")!
const modeButtonsEl = document.querySelector<HTMLDivElement>("#modes")!
const generationsEl = document.querySelector<HTMLDivElement>("#generations")!
const chartCanvas = document.querySelector<HTMLCanvasElement>("#chart")!
const chartCtx = chartCanvas.getContext("2d")!
const statusEl = document.querySelector<HTMLDivElement>("#status")!

let levelIndex = 0
let generationIndex = 0
let mode: "single" | "all" = "single"
let frame = 0
let restartCountdown = RESTART_DELAY_FRAMES
let ghosts: Ghost[] = []

function levelHistory() {
  return history.levels[levelIndex]
}

/** Blue for the first generation through to yellow for the last. */
function generationColor(index: number, total: number) {
  const t = total <= 1 ? 1 : index / (total - 1)
  return `hsl(${210 - 160 * t}, 85%, ${45 + 15 * t}%)`
}

function makeGhost(record: GenerationRecord, index: number): Ghost {
  return { record, index, state: createPlayingState(levelIndex), path: [], finished: false }
}

function load(level: number, generation: number) {
  levelIndex = level
  generationIndex = generation
  frame = 0
  restartCountdown = RESTART_DELAY_FRAMES

  const { generations, bestGeneration } = levelHistory()
  ghosts =
    mode === "all"
      ? generations.map(makeGhost)
      : [makeGhost(generations[generationIndex], generationIndex)]

  renderControls()
  drawFitnessChart(chartCtx, generations, bestGeneration)
}

function button(label: string, active: boolean, onClick: () => void, title?: string) {
  const element = document.createElement("button")
  element.textContent = label
  element.className = active ? "active" : ""
  if (title) element.title = title
  element.onclick = onClick
  return element
}

function renderControls() {
  const { generations, bestGeneration } = levelHistory()

  levelButtonsEl.replaceChildren(
    ...history.levels.map((_, index) =>
      button(`Level ${index + 1}`, index === levelIndex, () => load(index, history.levels[index].bestGeneration))
    )
  )

  modeButtonsEl.replaceChildren(
    button("Eén generatie", mode === "single", () => {
      mode = "single"
      load(levelIndex, generationIndex)
    }),
    button("Alle generaties tegelijk", mode === "all", () => {
      mode = "all"
      load(levelIndex, generationIndex)
    })
  )

  generationsEl.replaceChildren(
    ...generations.map((record, index) =>
      button(
        `${record.generation}${index === bestGeneration ? " ★" : ""}`,
        mode === "single" && index === generationIndex,
        () => {
          mode = "single"
          load(levelIndex, index)
        },
        `beste fitness ${record.bestFitness.toFixed(1)}, ${record.solved} van de populatie haalde het certificaat`
      )
    )
  )
}

function outcomeOf(ghost: Ghost) {
  if (ghost.state.phase === "dialogue") return "CERTIFICAAT"
  return ghost.state.phase === "dead" ? "GESTRAND" : "BEZIG"
}

function drawGhostPath(ghost: Ghost, color: string, width: number, alpha: number) {
  if (ghost.path.length < 2) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ghost.path.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()
  ctx.globalAlpha = 1
}

function drawAllGenerations() {
  const total = ghosts.length
  const bestIndex = levelHistory().bestGeneration

  for (const ghost of ghosts) {
    const isBest = ghost.index === bestIndex
    drawGhostPath(ghost, generationColor(ghost.index, total), isBest ? 2 : 1, isBest ? 1 : 0.4)
  }

  for (const ghost of ghosts) {
    if (ghost.index === bestIndex) continue
    const player = ghost.state.player
    ctx.fillStyle = generationColor(ghost.index, total)
    ctx.globalAlpha = ghost.finished ? 0.35 : 1
    ctx.fillRect(Math.round(player.x + 5), Math.round(player.y + 8), 6, 8)
    ctx.globalAlpha = 1
  }

  // The best generation gets the real sprite so it stays readable in the crowd.
  const best = ghosts[bestIndex] ?? ghosts[0]
  drawEntities(ctx, best.state)

  const reached = ghosts.filter((ghost) => ghost.state.phase === "dialogue").length
  const alive = ghosts.filter((ghost) => !ghost.finished).length
  drawText(ctx, `ALLE ${total} GENERATIES`, 6, 6, 1, COLORS.ink)
  drawText(ctx, `FRAME ${frame} ${reached} BINNEN`, 6, 26, 1, COLORS.ink)
  statusEl.textContent =
    `Alle ${total} generaties tegelijk (blauw = vroegste, geel = laatste, sprite = beste generatie ` +
    `${best.record.generation}). ${reached} haalden het certificaat, ${alive} nog onderweg.`
}

function drawSingleGeneration() {
  const ghost = ghosts[0]
  drawEntities(ctx, ghost.state)
  drawText(ctx, `LEVEL ${levelIndex + 1} GEN ${ghost.record.generation}`, 6, 6, 1, COLORS.ink)
  drawText(ctx, `FRAME ${frame} ${outcomeOf(ghost)}`, 6, 26, 1, COLORS.ink)
  statusEl.textContent =
    `Generatie ${ghost.record.generation}: beste fitness ${ghost.record.bestFitness.toFixed(1)}, ` +
    `gemiddelde ${ghost.record.meanFitness.toFixed(1)}, ${ghost.record.solved} van de populatie haalde het certificaat.`
}

function draw() {
  drawScene(ctx, LEVELS[levelIndex])
  if (mode === "all") drawAllGenerations()
  else drawSingleGeneration()
}

function advance(ghost: Ghost) {
  if (ghost.finished) return
  if (ghost.state.phase !== "playing" || frame >= RUN_FRAME_BUDGET) {
    ghost.finished = true
    return
  }
  // Re-running the stored genome through the same deterministic engine
  // reproduces that generation's run exactly, so no input traces need
  // storing -- the weights are the recording.
  ghost.state = step(ghost.state, actionFor(ghost.record.genome, ghost.state, LEVELS[levelIndex]))
  if (frame % PATH_SAMPLE_EVERY === 0) {
    ghost.path.push({ x: ghost.state.player.x + ghost.state.player.w / 2, y: ghost.state.player.y + 12 })
  }
}

function tick() {
  if (ghosts.every((ghost) => ghost.finished)) {
    restartCountdown--
    if (restartCountdown <= 0) load(levelIndex, generationIndex)
  } else {
    ghosts.forEach(advance)
    frame++
    restartCountdown = RESTART_DELAY_FRAMES
  }
  draw()
  requestAnimationFrame(tick)
}

// The recording is a separate file from the levels it was trained on, so it
// can go stale -- say a level was added without retraining. Say so plainly
// instead of failing on an undefined lookup halfway through a frame.
if (history.levels.length < LEVELS.length) {
  statusEl.textContent =
    `De opname dekt ${history.levels.length} van de ${LEVELS.length} levels. ` +
    `Draai "npm run train-agent" opnieuw om hem bij te werken.`
} else {
  load(0, history.levels[0].bestGeneration)
  tick()
}
