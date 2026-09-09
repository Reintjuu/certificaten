import type { EnemyDef, Platform, Rect } from "./levels";
import type { Facing } from "./physics";

// Sizes the builders need to place things on top of a platform. They mirror
// PHYSICS in engine.ts; engine.ts imports them from here so the two can never
// drift apart.
/**
 * BoundBoxCtrlData gives big Mario a 24px-tall box and the small/crouching
 * one 12px. The widths there are 12 and 10, but this game's sprites and level
 * geometry are built on 16, so the width stays 16 -- a deliberate deviation.
 */
export const PLAYER_SIZE = { w: 16, h: 24 } as const;
export const SMALL_PLAYER_SIZE = { w: 16, h: 16 } as const;
export const MUSHROOM_SIZE = { w: 16, h: 16 } as const;
export const ENEMY_SIZE = { w: 16, h: 16 } as const;
export const CERTIFICATE_SIZE = { w: 18, h: 24 } as const;

const DEFAULT_PLATFORM_THICKNESS = 12;
const CERTIFICATE_HOVER_ABOVE_PLATFORM = 13;

export function platform(x: number, y: number, w: number, h = DEFAULT_PLATFORM_THICKNESS): Platform {
  return { x, y, w, h };
}

export function enemyOn(
  platform: Platform,
  placement: { offsetFromLeftEdge: number; facing: Facing }
): EnemyDef {
  return {
    x: platform.x + placement.offsetFromLeftEdge,
    y: platform.y - ENEMY_SIZE.h,
    facing: placement.facing,
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
