import { CANVAS_W, CANVAS_H, type GameState, type Level, type Player } from "./engine"
import {
  drawSprite,
  MarioIdle,
  MarioWalk1,
  MarioWalk2,
  MarioJump,
  Goomba,
  GoombaSquashed,
  type Frame,
} from "./sprites"

export const COLORS = {
  sky: "#62b9ff",
  cloud: "#ffffff",
  groundTop: "#42a642",
  groundBody: "#8b5a2b",
  ink: "#111111",
  paper: "#fff8d6",
  paperInk: "#d33333",
  dialogueBg: "#0a0a6e",
  dialogueBorder: "#ffffff",
  nightSky: "#0a0a2e",
  highlight: "#ffd84a",
} as const

export function drawScene(ctx: CanvasRenderingContext2D, level: Level) {
  ctx.fillStyle = COLORS.sky
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  ctx.fillStyle = COLORS.cloud
  ctx.fillRect(35, 35, 42, 8)
  ctx.fillRect(50, 27, 25, 8)
  ctx.fillRect(330, 55, 48, 8)

  for (const platform of level.platforms) {
    ctx.fillStyle = COLORS.groundTop
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h)
    ctx.fillStyle = COLORS.groundBody
    ctx.fillRect(platform.x, platform.y + 5, platform.w, platform.h - 5)
  }

  const certificate = level.certificate
  ctx.fillStyle = COLORS.paper
  ctx.fillRect(certificate.x, certificate.y, certificate.w, certificate.h)
  ctx.fillStyle = COLORS.paperInk
  ctx.fillRect(certificate.x + 4, certificate.y + 4, 10, 4)
  ctx.fillRect(certificate.x + 7, certificate.y + 8, 4, 11)
}

export function playerFrame(player: Player): Frame {
  if (!player.grounded) return MarioJump
  if (player.vx !== 0) return player.animFrame === 0 ? MarioWalk1 : MarioWalk2
  return MarioIdle
}

export function drawEntities(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const enemy of state.enemies) {
    if (!enemy.alive && enemy.squashTimer <= 0) continue
    const frame = enemy.alive ? Goomba : GoombaSquashed
    const y = enemy.alive ? enemy.y : enemy.y + (enemy.h - GoombaSquashed.length)
    drawSprite(ctx, frame, enemy.x, y, 1)
  }

  const player = state.player
  drawSprite(ctx, playerFrame(player), player.x, player.y, 1, player.facing === -1)
}
