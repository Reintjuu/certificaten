// Command-line trainer: runs the evolution in agent/evolution.ts to
// completion and writes src/agent/training-history.json, which the console
// ships as its default recording. Run with: npm run train-agent
//
// The same evolution runs in the browser from the AI console, where it can't
// write a file; there you download the result and commit it.
import { writeFileSync } from "node:fs";
import { LEVELS } from "../engine";
import { GENERATIONS, POPULATION_SIZE, TRAINING_SEED, createTrainer, type LevelHistory } from "./evolution";
import { DEFAULT_ARCHITECTURE } from "./policy";
import { searchLevel } from "./search";
import { encodeInput } from "./routes";

export type { GenerationRecord, LevelHistory } from "./evolution";

/**
 * Evolution gets stuck, and which run gets stuck is a matter of the seed: on
 * one seed level 2 came out at 616 frames where another seed found 542. Three
 * restarts and keep the best costs a couple of minutes and takes the luck of
 * a single draw out of what ends up committed.
 */
const RESTARTS = 3;

const FPS = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

/**
 * The A* route per level, stored rather than searched in the browser: it is a
 * pure function of the engine and the levels, and searching one takes seconds,
 * which the replay screen cannot spend between two frames.
 */
function writeRoutes(): void {
  console.log("\nSearching the fastest route per level...");
  const routes = LEVELS.map((_, levelIndex) => {
    const found = searchLevel(levelIndex);
    console.log(
      `  level ${levelIndex + 1}: ${found.solved ? `${found.frames} frames` : "NO ROUTE"} ` +
        `(${found.expanded} plans)`
    );
    return { level: levelIndex, frames: found.frames, inputs: found.inputs.map(encodeInput) };
  });

  const routesPath = new URL("./routes.json", import.meta.url);
  writeFileSync(routesPath, JSON.stringify({ routes }));
  console.log(`Wrote ${routesPath.pathname}`);
}

function fitnessOfBest(history: LevelHistory): number {
  return history.generations[history.bestGeneration].bestFitness;
}

function main(): void {
  const startedAt = Date.now();
  const levels: LevelHistory[] = [];
  let framesSimulated = 0;

  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex++) {
    console.log(`\nTraining level ${levelIndex + 1}/${LEVELS.length}...`);
    const attempts: LevelHistory[] = [];

    for (let restart = 0; restart < RESTARTS; restart++) {
      const trainer = createTrainer(levelIndex, { seed: TRAINING_SEED + levelIndex + restart * 1000 });

      while (!trainer.done) {
        const record = trainer.runGeneration();
        console.log(
          `  level ${levelIndex + 1} run ${restart + 1}/${RESTARTS} gen ${record.generation}/${GENERATIONS}: ` +
            `best ${record.bestFitness.toFixed(1)}, mean ${record.meanFitness.toFixed(1)}, ` +
            `${record.solved}/${POPULATION_SIZE} solved`
        );
      }

      attempts.push(trainer.toHistory());
      framesSimulated += trainer.framesSimulated;
    }

    const history = attempts.reduce((best, attempt) =>
      fitnessOfBest(attempt) > fitnessOfBest(best) ? attempt : best
    );
    const best = history.generations[history.bestGeneration];
    console.log(
      `  -> best genome from generation ${best.generation} (fitness ${best.bestFitness.toFixed(1)}, ` +
        `${best.solved}/${POPULATION_SIZE} of that generation solved the level)`
    );
    levels.push(history);
  }

  const outPath = new URL("./training-history.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify({ architecture: DEFAULT_ARCHITECTURE, levels }));
  writeRoutes();

  // Training runs headless and as fast as the CPU allows: no canvas, no
  // waiting on frames. Worth stating plainly, because at 60fps this many
  // simulated frames would take most of a day to watch.
  const seconds = (Date.now() - startedAt) / MS_PER_SECOND;
  console.log(
    `\nSimulated ${framesSimulated.toLocaleString("en")} frames ` +
      `(${(framesSimulated / FPS / SECONDS_PER_HOUR).toFixed(1)}h of play at 60fps) in ${seconds.toFixed(1)}s ` +
      `(roughly ${Math.round(framesSimulated / FPS / seconds).toLocaleString("en")}x realtime).`
  );
  console.log(`Wrote ${outPath.pathname}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
