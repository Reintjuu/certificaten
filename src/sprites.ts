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

/**
 * Each frame is rasterised once into an offscreen canvas, in both facings, so
 * drawing a character is one blit. The old loop set ctx.fillStyle and called
 * fillRect for every opaque pixel, which for big Mario alone is 267 of each.
 * Built on demand, because the tests import the frames in Node.
 */
type CachedFrame = { forward: HTMLCanvasElement; mirrored: HTMLCanvasElement };

const cache = new Map<Frame, CachedFrame>();

function rasterise(frame: Frame, flipX: boolean): HTMLCanvasElement {
  const width = frame[0].length;
  const height = frame.length;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  for (let row = 0; row < height; row++) {
    const line = frame[row];
    for (let col = 0; col < width; col++) {
      const color = PALETTE[line[col]];
      if (color === undefined) {
        continue;
      }
      ctx.fillStyle = color;
      ctx.fillRect(flipX ? width - 1 - col : col, row, 1, 1);
    }
  }
  return canvas;
}

function cached(frame: Frame): CachedFrame {
  const existing = cache.get(frame);
  if (existing !== undefined) {
    return existing;
  }
  const entry = { forward: rasterise(frame, false), mirrored: rasterise(frame, true) };
  cache.set(frame, entry);
  return entry;
}

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  x: number,
  y: number,
  scale: number,
  flipX = false
): void {
  const entry = cached(frame);
  const image = flipX ? entry.mirrored : entry.forward;
  ctx.drawImage(image, Math.round(x), Math.round(y), image.width * scale, image.height * scale);
}
