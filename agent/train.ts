// Small neuroevolution experiment: a tiny hand-rolled feed-forward network
// (no ML library -- stays dependency-free like the rest of the project)
// whose weights evolve via a genetic algorithm to play each level, driving
// the same pure headless engine as agent/validate.ts. Run with:
//   npx tsx agent/train.ts
// Writes the best genome's input trace per level to agent/best-run.json,
// which agent/replay.html plays back visually.
import { writeFileSync } from "node:fs"
import { LEVELS, CANVAS_W, CANVAS_H, createPlayingState, step, type GameState, type Input } from "../src/engine"

const INPUT_SIZE = 9
const HIDDEN_SIZE = 8
const OUTPUT_SIZE = 2
const GENOME_SIZE = HIDDEN_SIZE * (INPUT_SIZE + 1) + OUTPUT_SIZE * (HIDDEN_SIZE + 1)

const POP_SIZE = 60
const GENERATIONS = 50
const ELITE = 4
const TOURNAMENT_K = 4
const MUTATION_RATE = 0.12
const MUTATION_SCALE = 0.6
const FRAME_BUDGET = 900 // 15s at 60fps -- plenty for these small levels
const SOLVE_FITNESS_THRESHOLD = 1500 // stop early once genomes reliably solve the level

type Genome = number[]

function randomGenome(): Genome {
  return Array.from({ length: GENOME_SIZE }, () => Math.random() * 2 - 1)
}

function forward(genome: Genome, inputs: number[]): [number, number] {
  let idx = 0
  const hidden = new Array(HIDDEN_SIZE)
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = genome[idx + INPUT_SIZE] // bias
    for (let i = 0; i < INPUT_SIZE; i++) sum += genome[idx + i] * inputs[i]
    idx += INPUT_SIZE + 1
    hidden[h] = Math.tanh(sum)
  }
  const outputs: [number, number] = [0, 0]
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    let sum = genome[idx + HIDDEN_SIZE]
    for (let h = 0; h < HIDDEN_SIZE; h++) sum += genome[idx + h] * hidden[h]
    idx += HIDDEN_SIZE + 1
    outputs[o] = Math.tanh(sum)
  }
  return outputs
}

function features(state: GameState): number[] {
  const level = LEVELS[state.levelIndex]
  const p = state.player
  const cert = level.certificate

  let nearestDist = Infinity
  let ndx = 0
  let ndy = 0
  for (const e of state.enemies) {
    if (!e.alive) continue
    const d = Math.hypot(e.x - p.x, e.y - p.y)
    if (d < nearestDist) {
      nearestDist = d
      ndx = (e.x - p.x) / CANVAS_W
      ndy = (e.y - p.y) / CANVAS_H
    }
  }

  return [
    (cert.x - p.x) / CANVAS_W,
    (cert.y - p.y) / CANVAS_H,
    p.vx / 3,
    p.vy / 10,
    p.grounded ? 1 : 0,
    ndx,
    ndy,
    Number.isFinite(nearestDist) ? 1 : 0,
    1, // bias
  ]
}

function actionFor(genome: Genome, state: GameState): Input {
  const [h, j] = forward(genome, features(state))
  const jumpHeld = j > 0
  return {
    left: h < -0.2,
    right: h > 0.2,
    jumpHeld,
    jumpPressed: jumpHeld,
    confirmPressed: false,
    resetPressed: false,
  }
}

function evaluate(genome: Genome, levelIndex: number): { fitness: number; solved: boolean } {
  let state = createPlayingState(levelIndex)
  const cert = LEVELS[levelIndex].certificate
  let bestDist = Infinity
  let solved = false
  let frame = 0
  for (; frame < FRAME_BUDGET; frame++) {
    if (state.phase === "dialogue") {
      solved = true
      break
    }
    if (state.phase === "dead") break
    const p = state.player
    const dist = Math.hypot(cert.x - p.x, cert.y - p.y)
    if (dist < bestDist) bestDist = dist
    state = step(state, actionFor(genome, state))
  }
  const fitness = -bestDist + (solved ? 2000 : 0) + frame * 0.02
  return { fitness, solved }
}

function recordRun(genome: Genome, levelIndex: number) {
  let state = createPlayingState(levelIndex)
  const inputs: Input[] = []
  let solved = false
  for (let frame = 0; frame < FRAME_BUDGET; frame++) {
    if (state.phase === "dialogue") {
      solved = true
      break
    }
    if (state.phase === "dead") break
    const action = actionFor(genome, state)
    inputs.push(action)
    state = step(state, action)
  }
  return { solved, frames: inputs.length, inputs }
}

function mutate(genome: Genome): Genome {
  return genome.map((w) => (Math.random() < MUTATION_RATE ? w + (Math.random() * 2 - 1) * MUTATION_SCALE : w))
}

function crossover(a: Genome, b: Genome): Genome {
  return a.map((w, i) => (Math.random() < 0.5 ? w : b[i]))
}

function tournamentSelect(population: Genome[], fitnesses: number[]): Genome {
  let bestIdx = Math.floor(Math.random() * population.length)
  for (let i = 1; i < TOURNAMENT_K; i++) {
    const idx = Math.floor(Math.random() * population.length)
    if (fitnesses[idx] > fitnesses[bestIdx]) bestIdx = idx
  }
  return population[bestIdx]
}

function trainLevel(levelIndex: number) {
  let population: Genome[] = Array.from({ length: POP_SIZE }, randomGenome)
  let best: Genome = population[0]
  let bestFitness = -Infinity

  for (let gen = 0; gen < GENERATIONS; gen++) {
    const results = population.map((g) => evaluate(g, levelIndex))
    const fitnesses = results.map((r) => r.fitness)

    for (let i = 0; i < population.length; i++) {
      if (fitnesses[i] > bestFitness) {
        bestFitness = fitnesses[i]
        best = population[i]
      }
    }

    const solvedCount = results.filter((r) => r.solved).length
    console.log(
      `  level ${levelIndex + 1} gen ${gen + 1}/${GENERATIONS}: best fitness ${bestFitness.toFixed(1)}, ${solvedCount}/${POP_SIZE} solved this generation`
    )

    if (bestFitness > SOLVE_FITNESS_THRESHOLD && gen >= 8) break

    const ranked = population
      .map((g, i) => ({ g, f: fitnesses[i] }))
      .sort((a, b) => b.f - a.f)
    const nextGen: Genome[] = ranked.slice(0, ELITE).map((r) => r.g)
    while (nextGen.length < POP_SIZE) {
      const a = tournamentSelect(population, fitnesses)
      const b = tournamentSelect(population, fitnesses)
      nextGen.push(mutate(crossover(a, b)))
    }
    population = nextGen
  }

  return { genome: best, fitness: bestFitness }
}

function main() {
  const results: Record<string, unknown> = {}
  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex++) {
    console.log(`\nTraining level ${levelIndex + 1}/${LEVELS.length}...`)
    const { genome, fitness } = trainLevel(levelIndex)
    const run = recordRun(genome, levelIndex)
    console.log(
      `  -> best fitness ${fitness.toFixed(1)}, recorded run: ${run.solved ? "SOLVED" : "did not solve"} in ${run.frames} frames`
    )
    results[levelIndex] = { solved: run.solved, frames: run.frames, fitness, inputs: run.inputs }
  }

  const outPath = new URL("./best-run.json", import.meta.url)
  writeFileSync(outPath, JSON.stringify(results))
  console.log(`\nWrote ${outPath.pathname}`)
}

main()
