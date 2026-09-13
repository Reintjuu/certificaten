// The game's state machine: which screen we're on, which level is loaded, and
// how a frame advances. The rules of the world itself live in physics.ts;
// this file decides when they apply.
import { LEVELS } from "./levels";
import type { Level } from "./levels";
import {
  CANVAS_W,
  PHYSICS,
  clamp,
  createEnemies,
  createBlocks,
  createMushrooms,
  createPlayer,
  overlaps,
  stepWorld,
} from "./physics";
import type { Block, Enemy, Input, Mushroom, Player } from "./physics";

export { LEVELS };
export type { Level };
export {
  CANVAS_W,
  CANVAS_H,
  PHYSICS,
  NO_INPUT,
  BlockKind,
  BlockContents,
  BlockState,
  EnemyKind,
  EnemyState,
  isActive,
  isSolid,
  isVisible,
  surfacesOf,
} from "./physics";
export type { Block, Player, Enemy, Input, Direction } from "./physics";

/** The blink cycle for "PRESS START" and the dialogue arrow. */
export const BLINK_PERIOD_FRAMES = 60;

type GamePhase = "title" | "dialogue" | "playing" | "dead" | "gameComplete";
type DialogueKind = "intro" | "outro";

export type GameState = {
  phase: GamePhase;
  levelIndex: number;
  player: Player;
  enemies: Enemy[];
  mushrooms: Mushroom[];
  blocks: Block[];
  /** Stamps collected, which is SMB1's coin tally under a duller name. */
  coins: number;
  dialogueLines: string[];
  dialogueIndex: number;
  dialogueKind: DialogueKind;
  blinkTimer: number;
  /** Left edge of the view. SMB1 never scrolls back, so this only grows. */
  cameraX: number;
  /** Counts down to the next framerule, SMB1's 21-frame interval tick. */
  frameruleTimer: number;
  /** Counts down to the next unit of level time. */
  gameTimerTicks: number;
  timeRemaining: number;
};

/** Compile-time exhaustiveness guard: adding a GamePhase becomes an error. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

export function hasFinishedLevel(state: GameState): boolean {
  return state.phase === "dialogue" && state.dialogueKind === "outro";
}

export function hasDied(state: GameState): boolean {
  return state.phase === "dead";
}

export function isPlaying(state: GameState): boolean {
  return state.phase === "playing";
}

export function createPlayingState(levelIndex: number, levels: Level[] = LEVELS): GameState {
  const level = levels[levelIndex];
  return {
    phase: "playing",
    levelIndex,
    player: createPlayer(level.playerStart),
    enemies: createEnemies(level.enemies),
    mushrooms: createMushrooms(level.mushrooms),
    blocks: createBlocks(level.blocks),
    coins: 0,
    dialogueLines: [],
    dialogueIndex: 0,
    dialogueKind: "intro",
    blinkTimer: 0,
    cameraX: 0,
    frameruleTimer: PHYSICS.frameruleFrames,
    gameTimerTicks: PHYSICS.gameTimerFrames,
    timeRemaining: level.timeLimit,
  };
}

export function createInitialState(levels: Level[] = LEVELS): GameState {
  return { ...createPlayingState(0, levels), phase: "title" };
}

function resetLevel(state: GameState, levels: Level[]): void {
  const level = levels[state.levelIndex];
  state.player = createPlayer(level.playerStart);
  state.enemies = createEnemies(level.enemies);
  state.mushrooms = createMushrooms(level.mushrooms);
  state.blocks = createBlocks(level.blocks);
  state.cameraX = 0;
  state.timeRemaining = level.timeLimit;
  state.gameTimerTicks = PHYSICS.gameTimerFrames;
}

/** The view follows the player past the middle of the screen, and never back. */
function updateCamera(state: GameState, level: Level): void {
  const centred = state.player.x + state.player.w / 2 - CANVAS_W / 2;
  state.cameraX = clamp(Math.max(state.cameraX, centred), 0, level.width - CANVAS_W);
}

/** Returns true on the frames where SMB1's interval timers tick. */
function advanceFramerule(state: GameState): boolean {
  state.frameruleTimer--;
  if (state.frameruleTimer > 0) {
    return false;
  }
  state.frameruleTimer = PHYSICS.frameruleFrames;
  return true;
}

function advanceGameTimer(state: GameState): void {
  state.gameTimerTicks--;
  if (state.gameTimerTicks > 0) {
    return;
  }
  state.gameTimerTicks = PHYSICS.gameTimerFrames;
  state.timeRemaining--;
}

function startDialogue(state: GameState, kind: DialogueKind, levels: Level[]): void {
  const level = levels[state.levelIndex];
  state.dialogueKind = kind;
  state.dialogueLines = kind === "intro" ? level.intro : level.outro;
  state.dialogueIndex = 0;
  state.phase = "dialogue";
}

function stepPlaying(state: GameState, input: Input, levels: Level[]): void {
  const level = levels[state.levelIndex];
  const framerule = advanceFramerule(state);
  advanceGameTimer(state);

  // GameState is a World with extra fields on it, so it goes straight in.
  const { died, coins } = stepWorld(state, level, input, { cameraX: state.cameraX, framerule });
  state.coins += coins;
  updateCamera(state, level);

  if (died || state.timeRemaining <= 0) {
    state.phase = "dead";
    return;
  }
  if (overlaps(state.player, level.certificate)) {
    startDialogue(state, "outro", levels);
  }
}

function advanceDialogue(state: GameState, levels: Level[]): void {
  state.dialogueIndex++;
  if (state.dialogueIndex < state.dialogueLines.length) {
    return;
  }

  if (state.dialogueKind === "intro") {
    resetLevel(state, levels);
    state.phase = "playing";
  } else if (state.levelIndex + 1 < levels.length) {
    state.levelIndex++;
    startDialogue(state, "intro", levels);
  } else {
    state.phase = "gameComplete";
  }
}

/** Advances the game by one frame. Pure: never mutates the state passed in. */
export function step(state: GameState, input: Input, levels: Level[] = LEVELS): GameState {
  const next: GameState = {
    ...state,
    player: { ...state.player },
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    mushrooms: state.mushrooms.map((mushroom) => ({ ...mushroom })),
  };
  next.blinkTimer = (state.blinkTimer + 1) % BLINK_PERIOD_FRAMES;

  switch (next.phase) {
    case "title":
      if (input.confirmPressed) {
        startDialogue(next, "intro", levels);
      }
      break;

    case "dialogue":
      if (input.confirmPressed) {
        advanceDialogue(next, levels);
      }
      break;

    case "playing":
      if (input.resetPressed) {
        resetLevel(next, levels);
      } else {
        stepPlaying(next, input, levels);
      }
      break;

    case "dead":
      if (input.resetPressed) {
        resetLevel(next, levels);
        next.phase = "playing";
      }
      break;

    case "gameComplete":
      if (input.resetPressed) {
        next.levelIndex = 0;
        resetLevel(next, levels);
        next.phase = "title";
      }
      break;

    default:
      assertNever(next.phase);
  }

  return next;
}
