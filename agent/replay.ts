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
import { actionFor, type Genome } from "./policy"

type GenerationRecord = { generation: number; bestFitness: number; meanFitness: number; solved: number; genome: Genome }
type LevelHistory = { level: number; generations: GenerationRecord[]; bestGeneration: number }
type Ghost = {
  record: GenerationRecord
  index: number
  state: GameState
  path: { x: number; y: number }[]
  finished: boolean
}

const history = trainingHistory as unknown as { levels: LevelHistory[] }

const FRAME_BUDGET = 900
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

  const { generations } = levelHistory()
  ghosts =
    mode === "all"
      ? generations.map(makeGhost)
      : [makeGhost(generations[generationIndex], generationIndex)]

  renderControls()
  drawChart()
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

function drawChart() {
  const { generations, bestGeneration } = levelHistory()
  const width = chartCanvas.width
  const height = chartCanvas.height
  const bottom = height - 26 // room for the legend underneath the plot
  const top = 10

  chartCtx.fillStyle = "#141414"
  chartCtx.fillRect(0, 0, width, height)

  const pointX = (index: number) =>
    generations.length === 1 ? width / 2 : (index / (generations.length - 1)) * (width - 20) + 10

  // Solved-count bars first, on their own scale: the best-fitness line
  // saturates the moment one genome reaches the certificate (the solve bonus
  // dwarfs everything else), so "how much of the population can finish the
  // level" is what actually shows the population learning.
  const maxSolved = Math.max(1, ...generations.map((record) => record.solved))
  const barWidth = Math.max(2, (width - 20) / generations.length - 2)
  chartCtx.fillStyle = "#2f5d3a"
  generations.forEach((record, index) => {
    const barHeight = (record.solved / maxSolved) * (bottom - top)
    chartCtx.fillRect(pointX(index) - barWidth / 2, bottom - barHeight, barWidth, barHeight)
  })

  const fitnessValues = generations.flatMap((record) => [record.bestFitness, record.meanFitness])
  const min = Math.min(...fitnessValues)
  const span = Math.max(...fitnessValues) - min || 1
  const pointY = (value: number) => bottom - ((value - min) / span) * (bottom - top)

  const plot = (pick: (record: GenerationRecord) => number, color: string) => {
    chartCtx.strokeStyle = color
    chartCtx.lineWidth = 2
    chartCtx.beginPath()
    generations.forEach((record, index) => {
      const x = pointX(index)
      const y = pointY(pick(record))
      if (index === 0) chartCtx.moveTo(x, y)
      else chartCtx.lineTo(x, y)
    })
    chartCtx.stroke()
  }

  plot((record) => record.meanFitness, "#5a7fb8")
  plot((record) => record.bestFitness, "#ffd84a")

  chartCtx.fillStyle = "#ff5a5a"
  chartCtx.beginPath()
  chartCtx.arc(pointX(bestGeneration), pointY(generations[bestGeneration].bestFitness), 4, 0, Math.PI * 2)
  chartCtx.fill()

  chartCtx.font = "11px monospace"
  const legend: [string, string][] = [
    ["#ffd84a", "beste fitness"],
    ["#5a7fb8", "gemiddelde fitness"],
    ["#2f5d3a", `opgelost per generatie (max ${maxSolved})`],
    ["#ff5a5a", "beste generatie"],
  ]
  let legendX = 10
  for (const [color, label] of legend) {
    chartCtx.fillStyle = color
    chartCtx.fillRect(legendX, height - 16, 10, 8)
    chartCtx.fillStyle = "#999"
    chartCtx.fillText(label, legendX + 14, height - 8)
    legendX += 24 + chartCtx.measureText(label).width
  }
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
  if (ghost.state.phase !== "playing" || frame >= FRAME_BUDGET) {
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

load(0, history.levels[0].bestGeneration)
tick()
