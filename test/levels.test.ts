import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { CANVAS_W, CANVAS_H, PHYSICS } from "../src/engine"
import { LEVELS, type Level, type Platform } from "../src/levels"
import { CERTIFICATE_SIZE, ENEMY_SIZE, PLAYER_SIZE } from "../src/level-builders"
import { PALETTE, MarioIdle, MarioWalk1, MarioWalk2, MarioJump, Goomba, GoombaSquashed } from "../src/sprites"

function platformUnder(level: Level, x: number, w: number, footY: number): Platform | undefined {
  return level.platforms.find(
    (platform) => platform.y === footY && x >= platform.x && x + w <= platform.x + platform.w
  )
}

// These are the invariants the level builders can't enforce on their own:
// they place things correctly, but nothing stops a hand-edited coordinate
// from putting an enemy in mid-air or a certificate out of reach.
describe("level geometry", () => {
  for (const [index, level] of LEVELS.entries()) {
    const name = `level ${index + 1}`

    test(`${name}: the player starts standing on a platform`, () => {
      const footY = level.playerStart.y + PLAYER_SIZE.h
      assert.ok(
        platformUnder(level, level.playerStart.x, PLAYER_SIZE.w, footY),
        `player starts at y=${level.playerStart.y}, which is not on top of any platform`
      )
    })

    test(`${name}: every enemy starts standing on a platform`, () => {
      // They walk off ledges from there, like SMB1's do, but they mustn't
      // start in mid-air.
      for (const enemy of level.enemies) {
        const footY = enemy.y + ENEMY_SIZE.h
        assert.ok(
          platformUnder(level, enemy.x, ENEMY_SIZE.w, footY),
          `an enemy at (${enemy.x}, ${enemy.y}) is not standing on a platform`
        )
        assert.ok(enemy.facing === 1 || enemy.facing === -1, "an enemy needs a facing direction")
      }
    })

    test(`${name}: the certificate hangs above a platform`, () => {
      const certificate = level.certificate
      const below = level.platforms
        .filter(
          (platform) =>
            platform.y > certificate.y &&
            certificate.x >= platform.x &&
            certificate.x + certificate.w <= platform.x + platform.w
        )
        .sort((a, b) => a.y - b.y)[0] // the closest one underneath, not just any
      assert.ok(below, "the certificate is not above any platform, so it can't be reached by landing")
      assert.ok(
        below.y - (certificate.y + certificate.h) < PLAYER_SIZE.h,
        "the certificate floats more than a player-height above its platform"
      )
    })

    test(`${name}: everything stays inside the screen`, () => {
      assert.ok(level.width >= CANVAS_W, "a level is never narrower than the view")
      for (const platform of level.platforms) {
        assert.ok(platform.x >= 0 && platform.x + platform.w <= level.width, "a platform sticks out sideways")
        assert.ok(platform.y >= 0 && platform.y <= CANVAS_H, "a platform sits outside the screen vertically")
        assert.ok(platform.w > 0 && platform.h > 0, "a platform has no size")
      }
      const certificate = level.certificate
      assert.ok(certificate.x >= 0 && certificate.x + certificate.w <= level.width)
      assert.ok(certificate.y >= 0)
    })

    test(`${name}: has intro and outro dialogue`, () => {
      assert.ok(level.intro.length > 0, "no intro lines")
      assert.ok(level.outro.length > 0, "no outro lines")
    })
  }
})

describe("sprites", () => {
  const frames = { MarioIdle, MarioWalk1, MarioWalk2, MarioJump, Goomba, GoombaSquashed }

  test("every frame is a rectangular grid", () => {
    for (const [name, frame] of Object.entries(frames)) {
      const width = frame[0].length
      for (const [row, line] of frame.entries()) {
        assert.equal(line.length, width, `${name} row ${row} is ${line.length} wide instead of ${width}`)
      }
    }
  })

  test("every pixel is either transparent or a known palette colour", () => {
    // A typo'd letter would silently render as a hole in the sprite, because
    // drawSprite skips characters it doesn't recognise.
    for (const [name, frame] of Object.entries(frames)) {
      for (const line of frame) {
        for (const char of line) {
          assert.ok(char === " " || char in PALETTE, `${name} uses unknown palette letter '${char}'`)
        }
      }
    }
  })

  test("the player sprite matches the player's hitbox", () => {
    // If the drawing and the collision box disagree, the character visibly
    // clips into platforms or floats above them.
    for (const [name, frame] of Object.entries({ MarioIdle, MarioWalk1, MarioWalk2, MarioJump })) {
      assert.equal(frame[0].length, PHYSICS.playerW, `${name} is not as wide as the player hitbox`)
      assert.equal(frame.length, PHYSICS.playerH, `${name} is not as tall as the player hitbox`)
    }
  })

  test("the enemy sprite is as wide as the enemy hitbox", () => {
    assert.equal(Goomba[0].length, PHYSICS.enemyW)
    assert.equal(CERTIFICATE_SIZE.w > 0 && CERTIFICATE_SIZE.h > 0, true)
  })
})
