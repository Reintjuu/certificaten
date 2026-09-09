// Standalone viewer: replays a recorded agent/train.ts run through the real,
// deterministic engine and draws it with the game's own renderer -- but never
// touches src/main.ts's game-state-machine (title/dialogue/etc). Dev only:
// open via `npm run dev` at /agent/replay.html.
import trainingHistory from "./training-history.json"
import { LEVELS, createPlayingState, step, type GameState } from "../src/engine"
import { COLORS, drawScene, drawEntities } from "../src/render"
import { drawText } from "../src/font"
import { actionFor, type Genome } from "./policy"

type GenerationRecord = { generation: number; bestFitness: number; meanFitness: number; solved: number; genome: Genome }
type LevelHistory = { level: number; generations: GenerationRecord[]; bestGeneration: number }

const history = trainingHistory as unknown as { levels: LevelHistory[] }

const canvas = document.querySelector<HTMLCanvasElement>("#game")!
const ctx = canvas.getContext("2d")!
ctx.imageSmoothingEnabled = false

const levelButtonsEl = document.querySelector<HTMLDivElement>("#levels")!
const generationsEl = document.querySelector<HTMLDivElement>("#generations")!
const chartCanvas = document.querySelector<HTMLCanvasElement>("#chart")!
const chartCtx = chartCanvas.getContext("2d")!
const statusEl = document.querySelector<HTMLDivElement>("#status")!

let levelIndex = 0
let generationIndex = 0
let frame = 0
let state: GameState = createPlayingState(0)

function levelHistory() {
  return history.levels[levelIndex]
}

function currentGeneration() {
  return levelHistory().generations[generationIndex]
}

function load(level: number, generation: number) {
  levelIndex = level
  generationIndex = generation
  frame = 0
  state = createPlayingState(level)
  renderGenerationButtons()
  drawChart()
}

function renderLevelButtons() {
  levelButtonsEl.replaceChildren()
  for (const [index] of history.levels.entries()) {
    const button = document.createElement("button")
    button.textContent = `Level ${index + 1}`
    button.className = index === levelIndex ? "active" : ""
    button.onclick = () => load(index, history.levels[index].bestGeneration)
    levelButtonsEl.appendChild(button)
  }
}

function renderGenerationButtons() {
  renderLevelButtons()
  generationsEl.replaceChildren()
  const { generations, bestGeneration } = levelHistory()
  for (const [index, record] of generations.entries()) {
    const button = document.createElement("button")
    button.textContent = `${record.generation}${index === bestGeneration ? " ★" : ""}`
    button.title = `beste fitness ${record.bestFitness.toFixed(1)}, ${record.solved} van de populatie haalde het certificaat`
    button.className = index === generationIndex ? "active" : ""
    button.onclick = () => load(levelIndex, index)
    generationsEl.appendChild(button)
  }
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
  const maxSolved = Math.max(1, ...generations.map((g) => g.solved))
  const barWidth = Math.max(2, (width - 20) / generations.length - 2)
  chartCtx.fillStyle = "#2f5d3a"
  generations.forEach((record, index) => {
    const barHeight = (record.solved / maxSolved) * (bottom - top)
    chartCtx.fillRect(pointX(index) - barWidth / 2, bottom - barHeight, barWidth, barHeight)
  })

  const fitnessValues = generations.flatMap((g) => [g.bestFitness, g.meanFitness])
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

function draw() {
  drawScene(ctx, LEVELS[levelIndex])
  drawEntities(ctx, state)

  const record = currentGeneration()
  const outcome = state.phase === "dialogue" ? "CERTIFICAAT" : state.phase === "dead" ? "GESTRAND" : "BEZIG"
  drawText(ctx, `LEVEL ${levelIndex + 1} GEN ${record.generation}`, 6, 6, 1, COLORS.ink)
  drawText(ctx, `FRAME ${frame} ${outcome}`, 6, 26, 1, COLORS.ink)

  statusEl.textContent =
    `Generatie ${record.generation}: beste fitness ${record.bestFitness.toFixed(1)}, ` +
    `gemiddelde ${record.meanFitness.toFixed(1)}, ${record.solved} van de populatie haalde het certificaat.`
}

const FRAME_BUDGET = 900
const RESTART_DELAY_FRAMES = 90
let restartCountdown = 0

function tick() {
  const finished = state.phase === "dead" || state.phase === "dialogue" || frame >= FRAME_BUDGET
  if (finished) {
    restartCountdown--
    if (restartCountdown <= 0) load(levelIndex, generationIndex)
  } else {
    // Re-running the stored genome through the same deterministic engine
    // reproduces that generation's run exactly, so no input traces need
    // storing -- the weights are the recording.
    state = step(state, actionFor(currentGeneration().genome, state))
    frame++
    restartCountdown = RESTART_DELAY_FRAMES
  }
  draw()
  requestAnimationFrame(tick)
}

load(0, history.levels[0].bestGeneration)
tick()
