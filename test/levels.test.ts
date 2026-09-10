import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CANVAS_W, CANVAS_H, PHYSICS } from "../src/engine";
import { LEVELS, type Level, type Platform } from "../src/levels";
import { ENEMY_SIZE, PLAYER_SIZE } from "../src/level-builders";
import { PALETTE, BIG_PLAYER, SMALL_PLAYER, Goomba, GoombaSquashed, Mushroom } from "../src/sprites";

function platformUnder(level: Level, x: number, w: number, footY: number): Platform | undefined {
  return level.platforms.find(
    (platform) => platform.y === footY && x >= platform.x && x + w <= platform.x + platform.w
  );
}

// These are the invariants the level builders can't enforce on their own:
// they place things correctly, but nothing stops a hand-edited coordinate
// from putting an enemy in mid-air or a certificate out of reach.
describe("level geometry", () => {
  for (const [index, level] of LEVELS.entries()) {
    const name = `level ${index + 1}`;

    test(`${name}: the player starts standing on a platform`, () => {
      const footY = level.playerStart.y + PLAYER_SIZE.h;
      assert.ok(
        platformUnder(level, level.playerStart.x, PLAYER_SIZE.w, footY),
        `player starts at y=${level.playerStart.y}, which is not on top of any platform`
      );
    });

    test(`${name}: every enemy starts standing on a platform`, () => {
      // They walk off ledges from there, like SMB1's do, but they mustn't
      // start in mid-air.
      for (const enemy of level.enemies) {
        const footY = enemy.y + ENEMY_SIZE.h;
        assert.ok(
          platformUnder(level, enemy.x, ENEMY_SIZE.w, footY),
          `an enemy at (${enemy.x}, ${enemy.y}) is not standing on a platform`
        );
      }
    });

    test(`${name}: the certificate hangs above a platform`, () => {
      const certificate = level.certificate;
      const below = level.platforms
        .filter(
          (platform) =>
            platform.y > certificate.y &&
            certificate.x >= platform.x &&
            certificate.x + certificate.w <= platform.x + platform.w
        )
        .sort((a, b) => a.y - b.y)[0]; // the closest one underneath, not just any
      assert.ok(below, "the certificate is not above any platform, so it can't be reached by landing");
      assert.ok(
        below.y - (certificate.y + certificate.h) < PLAYER_SIZE.h,
        "the certificate floats more than a player-height above its platform"
      );
    });

    test(`${name}: everything stays inside the screen`, () => {
      assert.ok(level.width >= CANVAS_W, "a level is never narrower than the view");
      for (const platform of level.platforms) {
        assert.ok(
          platform.x >= 0 && platform.x + platform.w <= level.width,
          "a platform sticks out sideways"
        );
        assert.ok(platform.y >= 0 && platform.y <= CANVAS_H, "a platform sits outside the screen vertically");
        assert.ok(platform.w > 0 && platform.h > 0, "a platform has no size");
      }
      const certificate = level.certificate;
      assert.ok(certificate.x >= 0 && certificate.x + certificate.w <= level.width);
      assert.ok(certificate.y >= 0);
    });

    test(`${name}: has intro and outro dialogue`, () => {
      assert.ok(level.intro.length > 0, "no intro lines");
      assert.ok(level.outro.length > 0, "no outro lines");
    });
  }
});

describe("jump reach", () => {
  // How far the feet can climb, straight from the physics: v^2 / 2g for the
  // fastest and slowest rows of the jump table.
  const runningRise = PHYSICS.jumpVelocity[4] ** 2 / (2 * PHYSICS.gravityRising[4]);
  const HORIZONTAL_REACH = 130;
  const MARGIN = 8;

  for (const [index, level] of LEVELS.entries()) {
    test(`level ${index + 1}: no platform asks for a climb that can't be made`, () => {
      // A climb that needs all 80px of a perfect running jump reads as
      // possible and isn't. Either make it comfortable or don't offer it.
      for (const target of level.platforms) {
        let easiestClimb = Infinity;
        for (const source of level.platforms) {
          if (source === target) {
            continue;
          }
          const gap = Math.max(0, target.x - (source.x + source.w), source.x - (target.x + target.w));
          const rise = source.y - target.y;
          if (gap <= HORIZONTAL_REACH && rise > 0) {
            easiestClimb = Math.min(easiestClimb, rise);
          }
        }

        assert.ok(
          easiestClimb === Infinity || easiestClimb <= runningRise - MARGIN,
          `platform at x=${target.x} y=${target.y} needs a ${easiestClimb.toFixed(0)}px climb, ` +
            `and a running jump only lifts the feet ${runningRise.toFixed(0)}px`
        );
      }
    });
  }
});

describe("sprites", () => {
  const playerFrames = {
    SmallIdle: SMALL_PLAYER.idle,
    SmallWalk1: SMALL_PLAYER.walk[0],
    SmallWalk2: SMALL_PLAYER.walk[1],
    SmallJump: SMALL_PLAYER.jump,
    BigIdle: BIG_PLAYER.idle,
    BigWalk1: BIG_PLAYER.walk[0],
    BigWalk2: BIG_PLAYER.walk[1],
    BigJump: BIG_PLAYER.jump,
    BigCrouch: BIG_PLAYER.crouch,
  };
  const frames = { ...playerFrames, Goomba, GoombaSquashed, Mushroom };

  test("every frame is a rectangular grid", () => {
    for (const [name, frame] of Object.entries(frames)) {
      const width = frame[0].length;
      for (const [row, line] of frame.entries()) {
        assert.equal(line.length, width, `${name} row ${row} is ${line.length} wide instead of ${width}`);
      }
    }
  });

  test("every pixel is either transparent or a known palette colour", () => {
    // A typo'd letter would silently render as a hole in the sprite, because
    // drawSprite skips characters it doesn't recognise.
    for (const [name, frame] of Object.entries(frames)) {
      for (const line of frame) {
        for (const char of line) {
          assert.ok(char === " " || char in PALETTE, `${name} uses unknown palette letter '${char}'`);
        }
      }
    }
  });

  test("player sprites are as wide as the hitbox and at least as tall", () => {
    // The sprite is drawn standing on the hitbox's feet. Big Mario's sprite is
    // deliberately taller than his box, as the ROM does, so it may
    // overhang upwards, but never be shorter than the box it represents.
    for (const [name, frame] of Object.entries(playerFrames)) {
      assert.equal(frame[0].length, PHYSICS.playerW, `${name} is not as wide as the player hitbox`);
      const box = name.startsWith("Big") && name !== "BigCrouch" ? PHYSICS.playerH : PHYSICS.playerSmallH;
      assert.ok(frame.length >= box, `${name} (${frame.length}px) is shorter than its ${box}px hitbox`);
    }
  });

  test("big Mario is twice the height of small Mario", () => {
    assert.equal(BIG_PLAYER.idle.length, SMALL_PLAYER.idle.length * 2);
  });

  test("the enemy sprite is as wide as the enemy hitbox", () => {
    assert.equal(Goomba[0].length, PHYSICS.enemyW);
    assert.equal(Mushroom[0].length, PHYSICS.mushroomW);
  });
});
