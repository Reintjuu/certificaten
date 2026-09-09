import { CANVAS_H, type GameState, type Level, type Player } from "./engine";
import {
  drawSprite,
  BIG_PLAYER,
  SMALL_PLAYER,
  Goomba,
  GoombaSquashed,
  Mushroom,
  type Frame,
} from "./sprites";

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

  // Menus and overlays.
  text: "#ffffff",
  dimText: "#8888cc",
  faintText: "#5a5a8c",
  selectedRow: "#20204a",
  shroud: "rgba(0, 0, 0, 0.72)",

  // The fitness chart.
  chartBackground: "#141414",
  chartMean: "#5a7fb8",
  chartSolved: "#2f5d3a",
  chartMarker: "#ff5a5a",
  chartLabel: "#999999",
} as const;

/** Everything in the world is drawn in level coordinates, shifted by the camera. */
export function withCamera(ctx: CanvasRenderingContext2D, cameraX: number, draw: () => void): void {
  ctx.save();
  ctx.translate(-Math.round(cameraX), 0);
  draw();
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, level: Level): void {
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, level.width, CANVAS_H);

  ctx.fillStyle = COLORS.cloud;
  for (let x = 35; x < level.width; x += 300) {
    ctx.fillRect(x, 35, 42, 8);
    ctx.fillRect(x + 15, 27, 25, 8);
    ctx.fillRect(x + 190, 55, 48, 8);
  }

  for (const platform of level.platforms) {
    ctx.fillStyle = COLORS.groundTop;
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    ctx.fillStyle = COLORS.groundBody;
    ctx.fillRect(platform.x, platform.y + 5, platform.w, platform.h - 5);
  }

  const certificate = level.certificate;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(certificate.x, certificate.y, certificate.w, certificate.h);
  ctx.fillStyle = COLORS.paperInk;
  ctx.fillRect(certificate.x + 4, certificate.y + 4, 10, 4);
  ctx.fillRect(certificate.x + 7, certificate.y + 8, 4, 11);
}

function playerFrame(player: Player): Frame {
  if (player.big && player.crouching) {
    return BIG_PLAYER.crouch;
  }
  const poses = player.big ? BIG_PLAYER : SMALL_PLAYER;
  if (!player.grounded) {
    return poses.jump;
  }
  if (player.vx !== 0) {
    return poses.walk[player.animFrame];
  }
  return poses.idle;
}

export function drawEntities(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const enemy of state.enemies) {
    if (!enemy.alive && enemy.squashTimer <= 0) {
      continue;
    }
    const frame = enemy.alive ? Goomba : GoombaSquashed;
    const y = enemy.alive ? enemy.y : enemy.y + (enemy.h - GoombaSquashed.length);
    drawSprite(ctx, frame, enemy.x, y, 1);
  }

  for (const mushroom of state.mushrooms) {
    if (mushroom.taken) {
      continue;
    }
    drawSprite(ctx, Mushroom, mushroom.x, mushroom.y, 1);
  }

  const player = state.player;
  const frame = playerFrame(player);
  // The sprite stands on the hitbox's feet; big Mario's is taller than his
  // box, so the overhang goes above his head, as in the ROM.
  const spriteY = player.y + player.h - frame.length;
  // Blink while the injury timer runs, the way the ROM flashes the palette.
  if (player.invincibleFramerules % 2 === 0) {
    drawSprite(ctx, frame, player.x, spriteY, 1, player.facing === -1);
  }
}
