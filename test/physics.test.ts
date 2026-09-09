import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  NO_INPUT,
  PHYSICS,
  applyGravity,
  applyHorizontalInput,
  applyJump,
  clamp,
  createPlayer,
  moveEnemies,
  overlaps,
  resolveEnemyCollisions,
  resolvePlatformCollisions,
  updateAnimation,
  type Enemy,
  type Input,
  type Player,
} from "../src/physics"
import type { Level } from "../src/levels"

// Unit tests for the individual rules. test/engine.test.ts covers how they
// add up over a whole run; these pin down each rule on its own, so a failure
// says which one broke rather than "the player ended up somewhere odd".

function player(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ x: 100, y: 100 }), ...overrides }
}

function input(overrides: Partial<Input> = {}): Input {
  return { ...NO_INPUT, ...overrides }
}

function enemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    x: 100,
    y: 100,
    w: PHYSICS.enemyW,
    h: PHYSICS.enemyH,
    vx: 1,
    patrolMin: 90,
    patrolMax: 110,
    alive: true,
    squashTimer: 0,
    ...overrides,
  }
}

function levelWithPlatform(x: number, y: number, w: number): Level {
  return {
    platforms: [{ x, y, w, h: 12 }],
    enemies: [],
    certificate: { x: 0, y: 0, w: 1, h: 1 },
    playerStart: { x: 0, y: 0 },
    intro: [],
    outro: [],
  }
}

describe("clamp and overlaps", () => {
  test("clamp keeps a value inside its bounds", () => {
    assert.equal(clamp(5, 0, 10), 5)
    assert.equal(clamp(-5, 0, 10), 0)
    assert.equal(clamp(15, 0, 10), 10)
  })

  test("overlaps is true only when boxes really intersect", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 }
    assert.equal(overlaps(box, { x: 5, y: 5, w: 10, h: 10 }), true)
    assert.equal(overlaps(box, { x: 10, y: 0, w: 10, h: 10 }), false, "touching edges is not overlapping")
    assert.equal(overlaps(box, { x: 0, y: 20, w: 10, h: 10 }), false)
  })
})

describe("applyHorizontalInput", () => {
  test("accelerates and reports the direction", () => {
    const p = player()
    assert.equal(applyHorizontalInput(p, input({ right: true })), 1)
    assert.equal(p.vx, PHYSICS.accel)
    assert.equal(p.facing, 1)
  })

  test("never exceeds the top speed", () => {
    const p = player({ vx: PHYSICS.maxSpeed })
    applyHorizontalInput(p, input({ right: true }))
    assert.equal(p.vx, PHYSICS.maxSpeed)
  })

  test("pressing both directions cancels out", () => {
    const p = player({ vx: 1 })
    assert.equal(applyHorizontalInput(p, input({ left: true, right: true })), 0)
    assert.ok(p.vx < 1, "and friction still applies")
  })

  test("friction lands exactly on zero instead of overshooting into reverse", () => {
    const p = player({ vx: PHYSICS.friction / 2 })
    applyHorizontalInput(p, input())
    assert.equal(p.vx, 0)
  })

  test("facing only changes when a direction is actually pressed", () => {
    const p = player({ facing: -1, vx: -1 })
    applyHorizontalInput(p, input())
    assert.equal(p.facing, -1)
  })
})

describe("applyJump", () => {
  test("only launches when grounded", () => {
    const airborne = player({ grounded: false })
    applyJump(airborne, input({ jumpPressed: true, jumpHeld: true }))
    assert.equal(airborne.vy, 0)

    const grounded = player({ grounded: true })
    applyJump(grounded, input({ jumpPressed: true, jumpHeld: true }))
    assert.equal(grounded.vy, PHYSICS.jumpVelocity)
    assert.equal(grounded.grounded, false)
  })

  test("running at speed gives the stronger jump", () => {
    const p = player({ grounded: true, vx: PHYSICS.maxSpeed })
    applyJump(p, input({ jumpPressed: true, jumpHeld: true }))
    assert.equal(p.vy, PHYSICS.jumpVelocityFast)
  })

  test("letting go while rising cuts the jump short", () => {
    const p = player({ vy: PHYSICS.jumpVelocity })
    applyJump(p, input({ jumpHeld: false }))
    assert.equal(p.vy, PHYSICS.jumpCutVy)
  })

  test("letting go while falling changes nothing", () => {
    const p = player({ vy: 4 })
    applyJump(p, input({ jumpHeld: false }))
    assert.equal(p.vy, 4)
  })
})

describe("applyGravity", () => {
  test("pulls gently while rising with the button held", () => {
    const p = player({ vy: -5 })
    applyGravity(p, input({ jumpHeld: true }))
    assert.equal(p.vy, -5 + PHYSICS.gravityRise)
  })

  test("pulls hard while falling", () => {
    const p = player({ vy: 1 })
    applyGravity(p, input({ jumpHeld: true }))
    assert.equal(p.vy, 1 + PHYSICS.gravityFall)
  })

  test("falling is meaningfully heavier than rising", () => {
    assert.ok(PHYSICS.gravityFall > PHYSICS.gravityRise * 2)
  })
})

describe("resolvePlatformCollisions", () => {
  const level = levelWithPlatform(0, 200, 100)

  test("snaps onto the surface it crossed and marks the player grounded", () => {
    // feet at 196 before the move, at 204 after: they cross the surface at 200
    const p = player({ x: 20, y: 180, vy: 8 })
    resolvePlatformCollisions(p, level)
    assert.equal(p.y, 200 - PHYSICS.playerH)
    assert.equal(p.vy, 0)
    assert.equal(p.grounded, true)
  })

  test("does not catch a player moving upward through the platform", () => {
    const p = player({ x: 20, y: 180, vy: -8 })
    resolvePlatformCollisions(p, level)
    assert.equal(p.grounded, false)
  })

  test("does not catch a player falling beside the platform", () => {
    const p = player({ x: 300, y: 180, vy: 8 })
    resolvePlatformCollisions(p, level)
    assert.equal(p.grounded, false)
  })
})

describe("updateAnimation", () => {
  test("flips the walk frame once enough ground is covered", () => {
    const p = player({ grounded: true, vx: PHYSICS.maxSpeed, animTimer: PHYSICS.walkFrameDistance })
    updateAnimation(p, 1)
    assert.equal(p.animFrame, 1)
    assert.equal(p.animTimer, 0)
  })

  test("standing still resets to the idle frame", () => {
    const p = player({ grounded: true, animFrame: 1, animTimer: 9 })
    updateAnimation(p, 0)
    assert.equal(p.animFrame, 0)
    assert.equal(p.animTimer, 0)
  })

  test("leaves the frame alone in mid-air, where the jump pose is shown", () => {
    const p = player({ grounded: false, animFrame: 1, animTimer: 5 })
    updateAnimation(p, 1)
    assert.equal(p.animFrame, 1)
    assert.equal(p.animTimer, 5)
  })
})

describe("moveEnemies", () => {
  test("turns around at the patrol bounds", () => {
    const walker = enemy({ x: 110, vx: 1 })
    moveEnemies([walker])
    assert.ok(walker.vx < 0)
  })

  test("a squashed enemy stops moving and counts down", () => {
    const squashed = enemy({ alive: false, squashTimer: 3, x: 100 })
    moveEnemies([squashed])
    assert.equal(squashed.x, 100)
    assert.equal(squashed.squashTimer, 2)
  })

  test("the countdown never goes negative", () => {
    const gone = enemy({ alive: false, squashTimer: 0 })
    moveEnemies([gone])
    assert.equal(gone.squashTimer, 0)
  })
})

describe("resolveEnemyCollisions", () => {
  test("dropping from above squashes and bounces", () => {
    const target = enemy({ x: 100, y: 100 })
    const p = player({ x: 100, y: 100 - PHYSICS.playerH + 4 })
    const died = resolveEnemyCollisions(p, [target], 6, 100)

    assert.equal(died, false)
    assert.equal(target.alive, false)
    assert.equal(target.squashTimer, PHYSICS.squashDuration)
    assert.equal(p.vy, PHYSICS.bounceVelocity)
  })

  test("walking into one from the side is fatal", () => {
    const target = enemy({ x: 100, y: 100 })
    const p = player({ x: 95, y: 100 })
    assert.equal(resolveEnemyCollisions(p, [target], 0, 124), true)
    assert.equal(target.alive, true)
  })

  test("an already squashed enemy is harmless", () => {
    const target = enemy({ x: 100, y: 100, alive: false })
    const p = player({ x: 100, y: 100 })
    assert.equal(resolveEnemyCollisions(p, [target], 0, 124), false)
  })
})
