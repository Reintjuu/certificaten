import type { BlockDef, EnemyDef, Platform, Rect } from "./levels";
// Types only: physics.ts imports the sizes above, so a value import here
// would close the circle and leave one of the two half-built at load time.
import type { BlockContents, EnemyKind, Facing } from "./physics";

// Sizes the builders need to place things on top of a platform. They mirror
// PHYSICS in engine.ts; engine.ts imports them from here so the two can never
// drift apart.
/**
 * BoundBoxCtrlData gives big Mario a 24px-tall box and the small/crouching
 * one 12px. The widths there are 12 and 10, but this game's sprites and level
 * geometry are built on 16, so the width stays 16: a deliberate deviation.
 */
export const PLAYER_SIZE = { w: 16, h: 24 } as const;
export const SMALL_PLAYER_SIZE = { w: 16, h: 16 } as const;
export const MUSHROOM_SIZE = { w: 16, h: 16 } as const;
export const ENEMY_SIZE = { w: 16, h: 16 } as const;
/** One metatile, the grid SMB1's whole world is built on. */
export const BLOCK_SIZE = { w: 16, h: 16 } as const;
const CERTIFICATE_SIZE = { w: 18, h: 24 } as const;

const DEFAULT_PLATFORM_THICKNESS = 12;
const CERTIFICATE_HOVER_ABOVE_PLATFORM = 13;

export function platform(x: number, y: number, w: number, h = DEFAULT_PLATFORM_THICKNESS): Platform {
  return { x, y, w, h };
}

export function enemyOn(
  platform: Platform,
  placement: { offsetFromLeftEdge: number; facing: Facing; kind?: EnemyKind }
): EnemyDef {
  return {
    x: platform.x + placement.offsetFromLeftEdge,
    y: platform.y - ENEMY_SIZE.h,
    facing: placement.facing,
    kind: placement.kind,
  };
}

export function mushroomOn(platform: Platform, offsetFromLeftEdge: number): { x: number; y: number } {
  return { x: platform.x + offsetFromLeftEdge, y: platform.y - MUSHROOM_SIZE.h };
}

export function certificateOn(platform: Platform, offsetFromLeftEdge: number): Rect {
  return {
    x: platform.x + offsetFromLeftEdge,
    y: platform.y - CERTIFICATE_SIZE.h - CERTIFICATE_HOVER_ABOVE_PLATFORM,
    ...CERTIFICATE_SIZE,
  };
}

export function startOn(platform: Platform, offsetFromLeftEdge: number): { x: number; y: number } {
  return { x: platform.x + offsetFromLeftEdge, y: platform.y - PLAYER_SIZE.h };
}

/**
 * A row of blocks written as a picture: "?" is a question block, "b" a plain
 * brick, "c" a brick with a stamp in it and a space a gap. Reading the row
 * back tells you what the level looks like, which a list of coordinates does
 * not.
 */
export function blockRow(
  x: number,
  y: number,
  pattern: string,
  contents: { question: BlockContents } = { question: "coin" }
): BlockDef[] {
  const defs: BlockDef[] = [];
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    const spot = { x: x + index * BLOCK_SIZE.w, y };
    if (character === "?") {
      defs.push({ ...spot, kind: "question", contains: contents.question });
    } else if (character === "b") {
      defs.push({ ...spot, kind: "brick", contains: "nothing" });
    } else if (character === "c") {
      defs.push({ ...spot, kind: "brick", contains: "coin" });
    }
  }
  return defs;
}
