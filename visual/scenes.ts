// Draws each named scene deterministically for the visual regression tests.
// See scenes.html for why this exists outside the game.
import {
  BlockContents,
  CANVAS_W,
  EnemyKind,
  EnemyState,
  LEVELS,
  NO_INPUT,
  createPlayingState,
  step,
  type GameState,
  type Input,
} from "../src/engine";
import { drawEntities, drawScene, withCamera } from "../src/render";
import { Menu } from "../src/menu";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

/** Runs the level the way a player would hold the keys, frame by frame. */
function play(levelIndex: number, frames: number, inputFor: (frame: number) => Partial<Input>): GameState {
  let state = createPlayingState(levelIndex);
  for (let frame = 0; frame < frames; frame++) {
    state = step(state, { ...NO_INPUT, ...inputFor(frame) });
  }
  return state;
}

function paint(state: GameState, levelIndex: number): void {
  // withCamera is how the game draws a frame: the scene is painted in level
  // coordinates, so the shift has to be in place before either call.
  withCamera(ctx, state.cameraX, () => {
    drawScene(ctx, LEVELS[levelIndex], state.cameraX);
    drawEntities(ctx, state);
  });
}

const sprint = (): Partial<Input> => ({ right: true, run: true });
const sprintAndJump = (frame: number): Partial<Input> => ({
  right: true,
  run: true,
  jumpPressed: frame % 40 === 0,
  jumpHeld: frame % 40 < 20,
});

const SCENES = new Map<string, () => void>(
  Object.entries({
    /** The real title menu, at a fixed point in its blink so it holds still. */
    title(): void {
      new Menu(
        "QUEESTE NAAR DE",
        [
          { label: "SPEEL", hint: "BEGIN BIJ LOKET EEN", run: (): void => undefined },
          { label: "AI CONSOLE", hint: "LAAT DE AI HET DOEN", run: (): void => undefined },
        ],
        "CERTIFICATEN"
      ).draw(ctx, 0);
    },

    "level-1-start": (): void => {
      paint(createPlayingState(0), 0);
    },
    "level-2-start": (): void => {
      paint(createPlayingState(1), 1);
    },
    "level-3-start": (): void => {
      paint(createPlayingState(2), 2);
    },

    /** Mid level, so the camera, the ledges and the enemies are all in frame. */
    "level-1-running": (): void => {
      paint(play(0, 200, sprint), 0);
    },
    "level-2-climbing": (): void => {
      paint(play(1, 260, sprintAndJump), 1);
    },

    /** A koopa withdrawn into its shell, and the same shell on the move. */
    koopa(): void {
      const state = createPlayingState(1);
      const koopa = state.enemies.find((enemy) => enemy.kind === EnemyKind.Koopa) ?? state.enemies[0];
      // Clamped the way the game clamps it, so the frame is one you could see.
      state.cameraX = Math.min(koopa.x - 200, LEVELS[1].width - CANVAS_W);
      state.player.x = koopa.x - 40;
      state.player.y = koopa.y - 8;
      state.player.big = true;
      paint(state, 1);
      koopa.state = EnemyState.Shell;
      ctx.save();
      ctx.translate(-state.cameraX, 0);
      drawEntities(ctx, state);
      ctx.restore();
    },

    /** A question block mid bounce with the stamp coming out of it. */
    blocks(): void {
      const state = createPlayingState(0);
      const block = state.blocks[0];
      state.player.x = block.x;
      state.player.y = 240 - state.player.h;
      state.blocks[0] = {
        ...block,
        releasing: BlockContents.Coin,
        bounceTimer: 12,
        contains: BlockContents.Nothing,
      };
      paint(state, 0);
    },
  })
);

export function drawSceneNamed(name: string): void {
  // A name that is not in the map is a typo in the test, so say so loudly
  // rather than screenshotting an empty canvas and calling it a pass.
  const scene = SCENES.get(name);
  if (scene === undefined) {
    throw new Error(`no scene called ${name}`);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  scene();
}

// Handles for the test to call, since the page has no clock of its own.
const stage = window as unknown as {
  drawSceneNamed: (name: string) => void;
  sceneNames: string[];
};
stage.drawSceneNamed = drawSceneNamed;
stage.sceneNames = [...SCENES.keys()];
