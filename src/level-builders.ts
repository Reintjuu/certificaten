import type { EnemyDef, Platform, Rect } from "./levels"

// Sizes the builders need to place things on top of a platform. They mirror
// PHYSICS in engine.ts; engine.ts imports them from here so the two can never
// drift apart.
export const PLAYER_SIZE = { w: 16, h: 24 } as const
export const ENEMY_SIZE = { w: 16, h: 16 } as const
export const CERTIFICATE_SIZE = { w: 18, h: 24 } as const

/** Platforms are all drawn this thick unless a level says otherwise. */
const DEFAULT_PLATFORM_THICKNESS = 12

/** How far the certificate floats above the platform it belongs to. */
const CERTIFICATE_HOVER = 13

export function platform(x: number, y: number, w: number, h = DEFAULT_PLATFORM_THICKNESS): Platform {
  return { x, y, w, h }
}

/**
 * An enemy walking back and forth on top of `on`. Patrol bounds are given
 * relative to that platform's left edge, so moving the platform moves the
 * enemy with it and the patrol can't accidentally end up in mid-air.
 */
export function enemyOn(
  on: Platform,
  options: { from: number; to: number; speed: number }
): EnemyDef {
  return {
    x: on.x + options.from,
    y: on.y - ENEMY_SIZE.h,
    vx: options.speed,
    patrolMin: on.x + options.from,
    patrolMax: on.x + options.to,
  }
}

/** The certificate, floating just above `on`, `offset` px from its left edge. */
export function certificateOn(on: Platform, offset: number): Rect {
  return {
    x: on.x + offset,
    y: on.y - CERTIFICATE_SIZE.h - CERTIFICATE_HOVER,
    ...CERTIFICATE_SIZE,
  }
}

/** Where the player starts: standing on `on`, `offset` px from its left edge. */
export function startOn(on: Platform, offset: number) {
  return { x: on.x + offset, y: on.y - PLAYER_SIZE.h }
}
