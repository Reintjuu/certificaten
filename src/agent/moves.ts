// What counts as one decision, shared by the two things that search rather
// than learn: the level canary in validate.ts and the A* in search.ts.
//
// A frame is the wrong unit to plan in. A jump takes tens of frames to play
// out, so planning per frame means a tree that is twelve times wider for every
// frame of a jump and mostly full of futures that change their mind halfway
// up. A move is instead "run this way, hold jump this long, and see it
// through", which is how a person would describe it too.
import { NO_INPUT, isPlaying, step, type GameState, type Input } from "../engine";

/**
 * Frames to keep the jump button held. 0 means "walk, don't jump". Six rungs
 * rather than nine: at three moves deep the difference in what the canary
 * finds is two frames across all three levels, and it runs in a third of the
 * time.
 */
export const HOLD_OPTIONS = [0, 6, 12, 20, 28, 40] as const;

/** How far ahead one hop is simulated before it is abandoned. */
const HOP_BUDGET = 90;
/** How long a "just walk" move commits for. */
const WALK_FRAMES = 12;

export type Direction = 1 | -1;
export type Move = { direction: Direction; hold: number };

/** Every move there is: both ways, every hold. */
export const MOVES: Move[] = ([1, -1] as const).flatMap((direction) =>
  HOLD_OPTIONS.map((hold) => ({ direction, hold }))
);

export type PlayedMove = { inputs: Input[]; state: GameState };

function inputFor(direction: Direction, jumpHeld: boolean, jumpPressed: boolean): Input {
  return { ...NO_INPUT, left: direction === -1, right: direction === 1, run: true, jumpHeld, jumpPressed };
}

/** Plays one candidate move out against the real engine. */
export function playMove(from: GameState, move: Move): PlayedMove {
  const inputs: Input[] = [];
  let state = from;

  const length = move.hold === 0 ? WALK_FRAMES : HOP_BUDGET;
  for (let frame = 0; frame < length; frame++) {
    const jumping = move.hold > 0 && frame < move.hold;
    const next = inputFor(move.direction, jumping, move.hold > 0 && frame === 0);
    inputs.push(next);
    state = step(state, next);
    if (!isPlaying(state)) {
      break;
    }
    // A hop ends when we touch down again; a walk runs its full length.
    if (move.hold > 0 && frame > 2 && state.player.grounded) {
      break;
    }
  }
  return { inputs, state };
}
