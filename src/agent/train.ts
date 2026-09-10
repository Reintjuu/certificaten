// Command-line trainer: runs the evolution in agent/evolution.ts to
// completion and writes src/agent/training-history.json, which the console
// ships as its default recording. Run with: npm run train-agent
//
// The same evolution runs in the browser from the AI console, where it can't
// write a file; there you download the result and commit it.
import { writeFileSync } from "node:fs";
import { LEVELS } from "../engine";
import { GENERATIONS, POPULATION_SIZE, createTrainer, type LevelHistory } from "./evolution";

export type { GenerationRecord, LevelHistory } from "./evolution";

const FPS = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

function main(): void {
  const startedAt = Date.now();
  const levels: LevelHistory[] = [];
  let framesSimulated = 0;

  for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex++) {
    console.log(`\nTraining level ${levelIndex + 1}/${LEVELS.length}...`);
    const trainer = createTrainer(levelIndex);

    while (!trainer.done) {
      const record = trainer.runGeneration();
      console.log(
        `  level ${levelIndex + 1} gen ${record.generation}/${GENERATIONS}: ` +
          `best ${record.bestFitness.toFixed(1)}, mean ${record.meanFitness.toFixed(1)}, ` +
          `${record.solved}/${POPULATION_SIZE} solved`
      );
    }

    const history = trainer.toHistory();
    const best = history.generations[history.bestGeneration];
    console.log(
      `  -> best genome from generation ${best.generation} (fitness ${best.bestFitness.toFixed(1)}, ` +
        `${best.solved}/${POPULATION_SIZE} of that generation solved the level)`
    );
    framesSimulated += trainer.framesSimulated;
    levels.push(history);
  }

  const outPath = new URL("./training-history.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify({ levels }));

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
