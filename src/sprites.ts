import { PALETTE, MarioIdle, MarioWalk1, MarioWalk2, MarioJump, Goomba, GoombaSquashed, type Frame } from "./sprite-frames"

export { PALETTE, MarioIdle, MarioWalk1, MarioWalk2, MarioJump, Goomba, GoombaSquashed }
export type { Frame }

export function drawSprite(ctx: CanvasRenderingContext2D, frame: Frame, x: number, y: number, scale: number, flipX = false) {
  const height = frame.length
  const width = frame[0].length
  for (let row = 0; row < height; row++) {
    const line = frame[row]
    for (let col = 0; col < width; col++) {
      const ch = line[col]
      if (ch === " ") continue
      const color = PALETTE[ch]
      if (!color) continue
      const drawCol = flipX ? width - 1 - col : col
      ctx.fillStyle = color
      ctx.fillRect(
        Math.round(x + drawCol * scale),
        Math.round(y + row * scale),
        scale,
        scale
      )
    }
  }
}
