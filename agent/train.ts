// Neuroevolution: a population of tiny networks (see agent/policy.ts) evolves
// via a genetic algorithm to play each level, driving the same pure headless
// engine as agent/validate.ts. Run with: npm run train-agent
//
// Every generation's best genome is stored in agent/training-history.json, so
// agent/replay.html can replay any generation and show the whole learning
// curve -- the weights are the recording, since the engine is deterministic.
import { writeFileSync } from "node:fs"
import { LEVELS, createPlayingState, hasDied, hasFinishedLevel, step } from "../src/engine"
import { RUN_FRAME_BUDGET, actionFor, randomGenome, type Genome } from "./policy"

const POPULATION_SIZE = 60
const GENERATIONS = 30
const ELITE_COUNT = 4
const TOURNAMENT_SIZE = 4
const MUTATION_RATE = 0.12
const MUTATION_SCALE = 0.6
const SOLVE_BONUS = 2000
/** Small reward per frame survived, to favour living over dying early. */
const SURVIVAL_BONUS_PER_FRAME = 0.02
const FPS = 60
const SECONDS_PER_HOUR = 3600
const MS_PER_SECOND = 1000

export type GenerationRecord = {
  generation: number
  bestFitness: number
  meanFitness: number
  solved: number
  genome: Genome
}

export type LevelHistory = {
  level: number
  generations: GenerationRecord[]
  bestGeneration: number
}

/** Total simulated frames, to report how much play time got compressed. */
let simulatedFrames = 0

export function evaluate(genome: Genome, levelIndex: number): { fitness: number; solved: boolean } {
  let state = createPlayingState(levelIndex)
  const level = LEVELS[levelIndex]
  const certificate = level.certificate
  let closest = Infinity
  let solved = false
  let frame = 0

  for (; frame < RUN_FRAME_BUDGET; frame++) {
    if (hasFinishedLevel(state)) {
      solved = true
      break
    }
    if (hasDied(state)) break

    const player = state.player
    closest = Math.min(closest, Math.hypot(certificate.x - player.x, certificate.y - player.y))
    state = step(state, actionFor(genome, state, level))
  }

  simulatedFrames += frame
  return { fitness: -closest + (solved ? SOLVE_BONUS : 0) + frame * SURVIVAL_BONUS_PER_FRAME, solved }
}

function mutate(genome: Genome): Genome {
  return genome.map((weight) =>
    Math.random() < MUTATION_RATE ? weight + (Math.random() * 2 - 1) * MUTATION_SCALE : weight
  )
}

function crossover(a: Genome, b: Genome): Genome {
  return a.map((weight, index) => (Math.random() < 0.5 ? weight : b[index]))
}

function tournamentWinner(population: Genome[], fitnesses: number[]): Genome {
  let winner = Math.floor(Math.random() * population.length)
  for (let i = 1; i < TOURNAMENT_SIZE; i++) {
    const challenger = Math.floor(Math.random() * population.length)
    if (fitnesses[challenger] > fitnesses[winner]) winner = challenger
  }
  return population[winner]
}

function nextGeneration(population: Genome[], fitnesses: number[]): Genome[] {
  const ranked = population
    .map((genome, index) => ({ genome, fitness: fitnesses[index] }))
    .sort((a, b) => b.fitness - a.fitness)

  const offspring = ranked.slice(0, ELITE_COUNT).map((entry) => entry.genome)
  while (offspring.length < population.length) {
    offspring.push(mutate(crossover(tournamentWinner(population, fitnesses), tournamentWinner(population, fitnesses))))
  }
  return offspring
}

function trainLevel(levelIndex: number): LevelHistory {
  let population = Array.from({ length: POPULATION_SIZE }, randomGenome)
  const generations: GenerationRecord[] = []

  for (let generation = 1; generation <= GENERATIONS; generation++) {
    const results = population.map((genome) => evaluate(genome, levelIndex))
    const fitnesses = results.map((result) => result.fitness)
    const bestIndex = fitnesses.indexOf(Math.max(...fitnesses))

    generations.push({
      generation,
      bestFitness: fitnesses[bestIndex],
      meanFitness: fitnesses.reduce((sum, value) => sum + value, 0) / fitnesses.length,
      solved: results.filter((result) => result.solved).length,
      genome: population[bestIndex],
    })

    const record = generations[generations.length - 1]
    console.log(
      `  level ${levelIndex + 1} gen ${generation}/${GENERATIONS}: ` +
        `best ${record.bestFitness.toFixed(1)}, mean ${record.meanFitness.toFixed(1)}, ` +
        `${record.solved}/${POPULATION_SIZE} solved`
    )

    population = nextGeneration(population, fitnesses)
  }

  const bestGeneration = generations.reduce(
    (best, record, index) => (record.bestFitness > generations[best].bestFitness ? index : best),
    0
  )
  return { level: levelIndex, generations, bestGeneration }
}

function main() {
  const startedAt = Date.now()
  const levels: LevelHistory[] = []
  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex++) {
    console.log(`\nTraining level ${levelIndex + 1}/${LEVELS.length}...`)
    const history = trainLevel(levelIndex)
    const best = history.generations[history.bestGeneration]
    console.log(
      `  -> best genome from generation ${best.generation} (fitness ${best.bestFitness.toFixed(1)}, ` +
        `${best.solved}/${POPULATION_SIZE} of that generation solved the level)`
    )
    levels.push(history)
  }

  const outPath = new URL("./training-history.json", import.meta.url)
  writeFileSync(outPath, JSON.stringify({ levels }))

  // Training runs headless and as fast as the CPU allows: no canvas, no
  // waiting on frames. Worth stating plainly, because at 60fps this many
  // simulated frames would take most of a day to watch.
  const seconds = (Date.now() - startedAt) / MS_PER_SECOND
  const realtimeHours = simulatedFrames / FPS / SECONDS_PER_HOUR
  console.log(
    `\nSimulated ${simulatedFrames.toLocaleString("en")} frames ` +
      `(${realtimeHours.toFixed(1)}h of play at 60fps) in ${seconds.toFixed(1)}s ` +
      `-- roughly ${Math.round(simulatedFrames / FPS / seconds).toLocaleString("en")}x realtime.`
  )
  console.log(`Wrote ${outPath.pathname}`)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) main()
