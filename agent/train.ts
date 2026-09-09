// Neuroevolution: a population of tiny networks (see agent/policy.ts) evolves
// via a genetic algorithm to play each level, driving the same pure headless
// engine as agent/validate.ts. Run with: npm run train-agent
//
// Every generation's best genome is stored in agent/training-history.json, so
// agent/replay.html can replay any generation and show the whole learning
// curve -- the weights are the recording, since the engine is deterministic.
import { writeFileSync } from "node:fs"
import { LEVELS, createPlayingState, step } from "../src/engine"
import { actionFor, randomGenome, type Genome } from "./policy"

const POPULATION_SIZE = 60
const GENERATIONS = 30
const ELITE_COUNT = 4
const TOURNAMENT_SIZE = 4
const MUTATION_RATE = 0.12
const MUTATION_SCALE = 0.6
const FRAME_BUDGET = 900 // 15s at 60fps -- plenty for these small levels
const SOLVE_BONUS = 2000

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

export function evaluate(genome: Genome, levelIndex: number): { fitness: number; solved: boolean } {
  let state = createPlayingState(levelIndex)
  const certificate = LEVELS[levelIndex].certificate
  let closest = Infinity
  let solved = false
  let frame = 0

  for (; frame < FRAME_BUDGET; frame++) {
    if (state.phase === "dialogue") {
      solved = true
      break
    }
    if (state.phase === "dead") break

    const player = state.player
    closest = Math.min(closest, Math.hypot(certificate.x - player.x, certificate.y - player.y))
    state = step(state, actionFor(genome, state))
  }

  return { fitness: -closest + (solved ? SOLVE_BONUS : 0) + frame * 0.02, solved }
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

export function trainLevel(levelIndex: number, log = console.log): LevelHistory {
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
    log(
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
  console.log(`\nWrote ${outPath.pathname}`)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) main()
