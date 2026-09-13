// Picking one connection out of the network and pushing its weight about, with
// the run replayed underneath it so you see what that weight was for.
//
// It keeps the three things an edit consists of, the connection you picked,
// the genome you have made of it, and what the recording did for comparison,
// and it asks for whatever else it needs per call rather than reaching for the
// console's state. That is what makes it testable without a page.
import { finishRun } from "./run";
import { genomeSize, layoutOf, policyFor, roundWeight, type Architecture, type Genome } from "./policy";
import type { Connection } from "./network-view";

const WEIGHT_STEP = 0.05;

/** What an edit needs to know about the screen it is happening on. */
export type EditTarget = {
  architecture: Architecture;
  /** The recorded genome, which an edit starts from and a reset returns to. */
  recorded: Genome;
  levelIndex: number;
};

export type WeightEditor = {
  readonly selected: Connection | null;
  /** The genome to play instead of the recorded one, if there is one. */
  readonly edited: Genome | null;
  select: (connection: Connection | null) => void;
  /** Edits belong to one genome, so moving to another one drops them. */
  clear: () => void;
  /** Stands an archived agent in for the recording, as an edit does. */
  adopt: (genome: Genome) => void;
  /** Up, down and Backspace. True when the key was one of those. */
  handleKey: (key: string, target: EditTarget) => boolean;
  /** The line under the picture, or null when nothing is picked. */
  describe: (target: EditTarget, playing: Genome) => string | null;
};

export function createWeightEditor(onChanged: () => void): WeightEditor {
  let selected: Connection | null = null;
  let edited: Genome | null = null;
  /** Frames the recorded genome took, to compare an edit against. */
  let recordedFrames: number | null = null;

  function indexOf(target: EditTarget, connection: Connection): number {
    return layoutOf(target.architecture)[connection.layer].weight(connection.to, connection.from);
  }

  function nudge(direction: number, target: EditTarget): void {
    if (selected === null) {
      return;
    }
    recordedFrames ??= finishRun(
      target.recorded,
      target.levelIndex,
      target.architecture,
      undefined,
      policyFor(target.architecture)
    ).frames;

    const genome = [...(edited ?? target.recorded)];
    const index = indexOf(target, selected);
    genome[index] = roundWeight(genome[index] + direction * WEIGHT_STEP);
    edited = genome;
    onChanged();
  }

  return {
    get selected() {
      return selected;
    },
    get edited() {
      return edited;
    },
    select(connection: Connection | null): void {
      selected = connection;
    },
    clear(): void {
      selected = null;
      edited = null;
      recordedFrames = null;
    },
    adopt(genome: Genome): void {
      selected = null;
      recordedFrames = null;
      edited = genome;
    },
    handleKey(key: string, target: EditTarget): boolean {
      if (key === "ArrowUp") {
        nudge(1, target);
      } else if (key === "ArrowDown") {
        nudge(-1, target);
      } else if (key === "Backspace") {
        edited = null;
        onChanged();
      } else {
        return false;
      }
      return true;
    },
    describe(target: EditTarget, playing: Genome): string | null {
      if (selected === null) {
        return null;
      }
      const index = indexOf(target, selected);
      const comparison =
        recordedFrames === null ? "" : ` De opname deed er ${String(recordedFrames)} frames over.`;
      return (
        `Gewicht ${String(index)} van ${String(genomeSize(target.architecture))}: ` +
        `laag ${String(selected.layer + 1)}, van knoop ${String(selected.from + 1)} naar ` +
        `${String(selected.to + 1)}. Nu ${playing[index].toFixed(4)}, opgenomen ` +
        `${target.recorded[index].toFixed(4)}. Pijltjes omhoog en omlaag verschuiven het, ` +
        `Backspace zet het terug.` +
        comparison
      );
    },
  };
}
