import {
  PALETTE,
  SmallIdle,
  SmallWalk1,
  SmallWalk2,
  SmallJump,
  BigIdle,
  BigWalk1,
  BigWalk2,
  BigJump,
  BigCrouch,
  Goomba,
  GoombaSquashed,
  Mushroom,
  type Frame,
} from "./sprite-frames";

export { PALETTE, Goomba, GoombaSquashed, Mushroom };

/** One set of poses per player size, so the renderer picks a set, not a frame. */
export const SMALL_PLAYER = { idle: SmallIdle, walk: [SmallWalk1, SmallWalk2], jump: SmallJump } as const;
export const BIG_PLAYER = {
  idle: BigIdle,
  walk: [BigWalk1, BigWalk2],
  jump: BigJump,
  crouch: BigCrouch,
} as const;
export type { Frame };

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  x: number,
  y: number,
  scale: number,
  flipX = false
): void {
  const height = frame.length;
  const width = frame[0].length;
  for (let row = 0; row < height; row++) {
    const line = frame[row];
    for (let col = 0; col < width; col++) {
      const ch = line[col];
      if (ch === " ") {
        continue;
      }
      const color = PALETTE[ch];
      if (!color) {
        continue;
      }
      const drawCol = flipX ? width - 1 - col : col;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x + drawCol * scale), Math.round(y + row * scale), scale, scale);
    }
  }
}
