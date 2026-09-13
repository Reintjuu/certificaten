// Headless smoke test: checks each level is still completable after a physics
// or level-data change. Run with: npm run validate-levels
//
// It is the A* from search.ts, which plays the real engine rather than
// guessing jump distances from hand-tuned constants. That keeps this honest
// when the physics change, which is exactly when a canary has to stay
// trustworthy: the hand-tuned version this replaced silently became useless
// the moment the numbers moved.
import { LEVELS } from "../engine";
import { searchLevel } from "./search";

function runValidation(): boolean {
  const results = LEVELS.map((_, index) => searchLevel(index));
  results.forEach((result, index) => {
    console.log(
      `Level ${index + 1}/${LEVELS.length}: ${result.solved ? "OK" : "FAIL"} - ${result.frames} frames, ` +
        `${result.expanded} plannen bekeken`
    );
  });
  return results.every((result) => result.solved);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (runValidation()) {
    console.log("\nAll levels completable.");
  } else {
    console.error("\nThe search could not finish every level (see agent/train.ts for the real check).");
    process.exit(1);
  }
}
