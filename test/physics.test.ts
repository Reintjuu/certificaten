import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NO_INPUT,
  PHYSICS,
  applyGravity,
  applyHorizontalInput,
  applyJump,
  clamp,
  jumpIndexFor,
  createPlayer,
  moveEnemies,
  overlaps,
  resolveEnemyCollisions,
  resolvePlatformCollisions,
  updateAnimation,
  walkCycleFramesFor,
  type Enemy,
  type Input,
  Facing,
  type Player,
} from "../src/physics";
import type { Level } from "../src/levels";

// Unit tests for the individual rules. test/engine.test.ts covers how they
// add up over a whole run; these pin down each rule on its own, so a failure
// says which one broke rather than "the player ended up somewhere odd".

function player(overrides: Partial<Player> = {}): Player {
  return { ...createPlayer({ x: 100, y: 100 }), ...overrides };
}

function input(overrides: Partial<Input> = {}): Input {
  return { ...NO_INPUT, ...overrides };
}

function enemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    x: 100,
    y: 100,
    w: PHYSICS.enemyW,
    h: PHYSICS.enemyH,
    vx: 1,
    vy: 0,
    alive: true,
    awake: true,
    squashTimer: 0,
    ...overrides,
  };
}

function levelWithPlatform(x: number, y: number, w: number): Level {
  return {
    width: 480,
    timeLimit: 400,
    platforms: [{ x, y, w, h: 12 }],
    enemies: [],
    mushrooms: [],
    certificate: { x: 0, y: 0, w: 1, h: 1 },
    playerStart: { x: 0, y: 0 },
    intro: [],
    outro: [],
  };
}

/**
 * End-to-end checks on the port: simulate a jump and compare what it actually
 * does with what the ROM's tables predict. If a constant is mistyped or the
 * units are misread, these move by far more than the tolerance.
 *
 * The measured arc lands about 3% under the textbook v^2 / 2g, because both
 * this and the ROM step gravity once per frame rather than integrating
 * continuously. That gap is the discretisation, not an error.
 */
describe("jump measurements match the ROM's tables", () => {
  const GROUND = 200;

  function jumpArc(runUp: boolean): { rise: number; length: number } {
    const level = levelWithPlatform(0, GROUND, 480);
    const p = player({ x: 20, y: GROUND - PHYSICS.playerSmallH, grounded: true });
    const held = input({ jumpHeld: true, jumpPressed: true, right: runUp, run: runUp });

    if (runUp) {
      for (let frame = 0; frame < 200; frame++) {
        applyHorizontalInput(p, input({ right: true, run: true }));
        p.x += p.vx;
      }
    }

    const startX = p.x;
    const startFeet = p.y + p.h;
    let highestFeet = startFeet;
    applyJump(p, held);

    for (let frame = 0; frame < 200; frame++) {
      applyHorizontalInput(p, held);
      applyGravity(p, held);
      p.x += p.vx;
      p.y += p.vy;
      highestFeet = Math.min(highestFeet, p.y + p.h);
      resolvePlatformCollisions(p, level);
      if (frame > 2 && p.grounded) {
        break;
      }
    }
    return { rise: startFeet - highestFeet, length: p.x - startX };
  }

  test("a standing jump lifts the feet by v^2 / 2g of the slowest row", () => {
    const predicted = PHYSICS.jumpVelocity[0] ** 2 / (2 * PHYSICS.gravityRising[0]);
    const measured = jumpArc(false).rise;
    assert.ok(
      Math.abs(measured - predicted) < predicted * 0.05,
      `standing jump rose ${measured.toFixed(1)}px, the tables predict ${predicted.toFixed(1)}px`
    );
  });

  test("a running jump uses the fastest row, and clears more ground", () => {
    const predicted = PHYSICS.jumpVelocity[4] ** 2 / (2 * PHYSICS.gravityRising[4]);
    const running = jumpArc(true);
    assert.ok(
      Math.abs(running.rise - predicted) < predicted * 0.05,
      `running jump rose ${running.rise.toFixed(1)}px, the tables predict ${predicted.toFixed(1)}px`
    );
    assert.ok(running.length > jumpArc(false).length, "a run-up must carry you further");
  });

  test("top speed is reached in about three quarters of a second", () => {
    // 40 subpixels at an adder of $e4 is roughly 45 frames: SMB1's famously
    // long run-up, and a good tell that the units are read correctly.
    const p = player({ grounded: true, facing: Facing.Right });
    let frames = 0;
    while (p.vx < PHYSICS.maxRunSpeed && frames < 300) {
      applyHorizontalInput(p, input({ right: true, run: true }));
      frames++;
    }
    assert.ok(frames > 30 && frames < 60, `reached top speed in ${frames} frames`);
  });
});

describe("clamp and overlaps", () => {
  test("clamp keeps a value inside its bounds", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
  });

  test("overlaps is true only when boxes really intersect", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    assert.equal(overlaps(box, { x: 5, y: 5, w: 10, h: 10 }), true);
    assert.equal(overlaps(box, { x: 10, y: 0, w: 10, h: 10 }), false, "touching edges is not overlapping");
    assert.equal(overlaps(box, { x: 0, y: 20, w: 10, h: 10 }), false);
  });
});

describe("applyHorizontalInput", () => {
  test("a jump keeps its horizontal speed: only the ground brakes you", () => {
    // LRAir skips ImposeFriction when no direction is held, so momentum
    // carries you across a gap even if you let go of the pad.
    const airborne = player({ vx: PHYSICS.maxRunSpeed, grounded: false });
    applyHorizontalInput(airborne, input());
    assert.equal(airborne.vx, PHYSICS.maxRunSpeed);

    const grounded = player({ vx: PHYSICS.maxRunSpeed, grounded: true });
    applyHorizontalInput(grounded, input());
    assert.ok(grounded.vx < PHYSICS.maxRunSpeed);
  });

  test("accelerates and reports the direction", () => {
    const p = player();
    assert.equal(applyHorizontalInput(p, input({ right: true })), 1);
    assert.equal(p.vx, PHYSICS.accelWalking, "walking pace without the run button");
    assert.equal(p.facing, 1);
  });

  test("walking is capped lower than running", () => {
    const walking = player({ vx: PHYSICS.maxWalkSpeed, facing: 1, grounded: true });
    applyHorizontalInput(walking, input({ right: true }));
    assert.equal(walking.vx, PHYSICS.maxWalkSpeed);

    const running = player({ vx: PHYSICS.maxWalkSpeed, facing: 1, grounded: true });
    applyHorizontalInput(running, input({ right: true, run: true }));
    assert.ok(running.vx > PHYSICS.maxWalkSpeed, "holding run lifts the cap");
    assert.ok(running.vx <= PHYSICS.maxRunSpeed);
  });

  test("run status lingers for a few frames after letting go of the button", () => {
    // SetRTmr: RunningTimer is set to 10 and counts down, so tapping the
    // button doesn't drop you straight back to walking pace.
    const p = player({ vx: PHYSICS.maxWalkSpeed, facing: 1, grounded: true });
    applyHorizontalInput(p, input({ right: true, run: true }));
    assert.equal(p.runningTimer, PHYSICS.runningTimerFrames);

    applyHorizontalInput(p, input({ right: true }));
    assert.equal(p.runningTimer, PHYSICS.runningTimerFrames - 1);
    assert.ok(p.vx > PHYSICS.maxWalkSpeed, "still allowed to run while the timer lasts");
  });

  test("turning around brakes twice as hard as walking does", () => {
    const skidding = player({ vx: 1, facing: 1, grounded: true });
    applyHorizontalInput(skidding, input({ left: true }));
    const skidDelta = 1 - skidding.vx;

    const starting = player({ vx: 0, facing: -1, grounded: true });
    applyHorizontalInput(starting, input({ left: true }));
    assert.ok(
      skidDelta > Math.abs(starting.vx) * 1.9,
      `skid should apply about double the adder (skid ${skidDelta}, plain ${Math.abs(starting.vx)})`
    );
  });

  test("pressing both directions cancels out", () => {
    const p = player({ vx: 1, grounded: true });
    assert.equal(applyHorizontalInput(p, input({ left: true, right: true })), 0);
    assert.ok(p.vx < 1, "and friction still applies");
  });

  test("friction lands exactly on zero instead of overshooting into reverse", () => {
    const p = player({ vx: PHYSICS.accelWalking / 2, grounded: true });
    applyHorizontalInput(p, input());
    assert.equal(p.vx, 0);
  });

  test("facing only changes when a direction is actually pressed", () => {
    const p = player({ facing: Facing.Left, vx: -1, grounded: true });
    applyHorizontalInput(p, input());
    assert.equal(p.facing, -1);
  });
});

describe("applyJump", () => {
  test("only launches when grounded", () => {
    const airborne = player({ grounded: false });
    applyJump(airborne, input({ jumpPressed: true, jumpHeld: true }));
    assert.equal(airborne.vy, 0);

    const grounded = player({ grounded: true });
    applyJump(grounded, input({ jumpPressed: true, jumpHeld: true }));
    assert.equal(grounded.vy, PHYSICS.jumpVelocity[0]);
    assert.equal(grounded.grounded, false);
  });

  test("the take-off speed picks the jump table row", () => {
    for (const [speed, expected] of [
      [0, 0],
      [0.6, 1],
      [1.1, 2],
      [1.6, 3],
      [2.5, 4],
    ] as const) {
      assert.equal(jumpIndexFor(speed), expected, `speed ${speed}`);
    }
  });

  test("a faster run-up launches harder", () => {
    const standing = player({ grounded: true, vx: 0 });
    applyJump(standing, input({ jumpPressed: true, jumpHeld: true }));

    const sprinting = player({ grounded: true, vx: PHYSICS.maxRunSpeed });
    applyJump(sprinting, input({ jumpPressed: true, jumpHeld: true }));

    assert.ok(sprinting.vy < standing.vy, "the fast row launches with more upward speed");
  });
});

describe("applyGravity", () => {
  test("pulls gently while rising with the button held", () => {
    const p = player({ vy: -4, jumpOriginY: 100, y: 80 });
    applyGravity(p, input({ jumpHeld: true }));
    assert.equal(p.vy, -4 + PHYSICS.gravityRising[0]);
  });

  test("pulls hard while falling", () => {
    const p = player({ vy: 1 });
    applyGravity(p, input({ jumpHeld: true }));
    assert.equal(p.vy, 1 + PHYSICS.gravityFalling[0]);
  });

  test("letting go mid-rise swaps in the heavy falling gravity", () => {
    // SMB1 varies jump height this way rather than by cutting upward speed.
    const p = player({ vy: -4, jumpOriginY: 100, y: 80 });
    applyGravity(p, input({ jumpHeld: false }));
    assert.equal(p.vy, -4 + PHYSICS.gravityFalling[0]);
  });

  test("letting go within the first pixel does not cut the jump", () => {
    // DiffToHaltJump is 1, so a jump can't be cancelled the instant it starts.
    const p = player({ vy: -4, jumpOriginY: 100, y: 99.5 });
    applyGravity(p, input({ jumpHeld: false }));
    assert.equal(p.vy, -4 + PHYSICS.gravityRising[0]);
  });

  test("falling is meaningfully heavier than rising", () => {
    assert.ok(PHYSICS.gravityFalling[0] > PHYSICS.gravityRising[0] * 2);
  });

  test("the fall speed is capped", () => {
    const p = player({ vy: PHYSICS.maxFallSpeed });
    applyGravity(p, input());
    assert.equal(p.vy, PHYSICS.maxFallSpeed);
  });
});

describe("resolvePlatformCollisions", () => {
  const level = levelWithPlatform(0, 200, 100);

  test("snaps onto the surface it crossed and marks the player grounded", () => {
    // feet at 196 before the move, at 204 after: they cross the surface at 200
    const p = player({ x: 20, y: 188, vy: 8 });
    resolvePlatformCollisions(p, level);
    assert.equal(p.y, 200 - PHYSICS.playerSmallH);
    assert.equal(p.vy, 0);
    assert.equal(p.grounded, true);
  });

  test("does not catch a player moving upward through the platform", () => {
    const p = player({ x: 20, y: 188, vy: -8 });
    resolvePlatformCollisions(p, level);
    assert.equal(p.grounded, false);
  });

  test("does not catch a player falling beside the platform", () => {
    const p = player({ x: 300, y: 188, vy: 8 });
    resolvePlatformCollisions(p, level);
    assert.equal(p.grounded, false);
  });
});

describe("updateAnimation", () => {
  test("flips the walk frame once its step has lasted long enough", () => {
    const p = player({ grounded: true, vx: PHYSICS.maxRunSpeed, animTimer: PHYSICS.walkCycleFrames[0] - 1 });
    updateAnimation(p, 1);
    assert.equal(p.animFrame, 1);
    assert.equal(p.animTimer, 0);
  });

  test("running cycles the legs faster than walking, in the ROM's three steps", () => {
    const running = walkCycleFramesFor(PHYSICS.maxRunSpeed);
    const walking = walkCycleFramesFor(PHYSICS.maxWalkSpeed);
    const crawling = walkCycleFramesFor(0.1);
    assert.ok(running < walking, `running (${running}) should step faster than walking (${walking})`);
    assert.ok(walking < crawling, `walking (${walking}) should step faster than crawling (${crawling})`);
    assert.deepEqual([running, walking, crawling], [...PHYSICS.walkCycleFrames]);
  });

  test("standing still resets to the idle frame", () => {
    const p = player({ grounded: true, animFrame: 1, animTimer: 9 });
    updateAnimation(p, 0);
    assert.equal(p.animFrame, 0);
    assert.equal(p.animTimer, 0);
  });

  test("leaves the frame alone in mid-air, where the jump pose is shown", () => {
    const p = player({ grounded: false, animFrame: 1, animTimer: 5 });
    updateAnimation(p, 1);
    assert.equal(p.animFrame, 1);
    assert.equal(p.animTimer, 5);
  });
});

describe("moveEnemies", () => {
  const level = levelWithPlatform(0, 200, 200);

  test("walks off the end of its platform instead of turning around", () => {
    // SMB1's normal enemies only turn at something solid, never at a ledge.
    const walker = enemy({ x: 190, y: 200 - PHYSICS.enemyH, vx: PHYSICS.enemyWalkSpeed });
    for (let frame = 0; frame < 90; frame++) {
      moveEnemies([walker], level, 0, false);
    }
    assert.ok(walker.x > 200, "should have walked past the edge");
    assert.ok(walker.vx > 0, "and not turned around");
  });

  test("falls onto a platform below and stops there", () => {
    const falling = enemy({ x: 50, y: 40, vx: 0 });
    for (let frame = 0; frame < 120; frame++) {
      moveEnemies([falling], level, 0, false);
    }
    assert.equal(falling.y, 200 - PHYSICS.enemyH);
    assert.equal(falling.vy, 0);
  });

  test("stays dormant until the camera reaches it", () => {
    const offscreen = enemy({ x: 900, y: 200 - PHYSICS.enemyH });
    offscreen.awake = false;
    moveEnemies([offscreen], { ...level, width: 1440 }, 0, false);
    assert.equal(offscreen.awake, false);
    assert.equal(offscreen.x, 900);

    moveEnemies([offscreen], { ...level, width: 1440 }, 600, false);
    assert.equal(offscreen.awake, true);
  });

  test("a squashed enemy counts down once per framerule, not per frame", () => {
    const squashed = enemy({ alive: false, squashTimer: 3, x: 100 });
    moveEnemies([squashed], level, 0, false);
    assert.equal(squashed.squashTimer, 3, "an ordinary frame leaves it alone");
    moveEnemies([squashed], level, 0, true);
    assert.equal(squashed.squashTimer, 2);
  });

  test("the countdown never goes negative", () => {
    const gone = enemy({ alive: false, squashTimer: 0 });
    moveEnemies([gone], level, 0, true);
    assert.equal(gone.squashTimer, 0);
  });
});

describe("resolveEnemyCollisions", () => {
  test("coming down on one squashes and bounces", () => {
    const target = enemy({ x: 100, y: 100 });
    const p = player({ x: 100, y: 100 - PHYSICS.playerSmallH + 4 });
    const died = resolveEnemyCollisions(p, [target], true);

    assert.equal(died, false);
    assert.equal(target.alive, false);
    assert.equal(target.squashTimer, PHYSICS.squashFramerules);
    assert.equal(p.vy, PHYSICS.bounceVelocity);
  });

  test("the bounce is the ROM's $fc, not $fd", () => {
    // $fd belongs to bloobers and cheep-cheeps; a goomba goes through SBnce.
    assert.equal(PHYSICS.bounceVelocity, -4);
  });

  test("walking into one from the side is fatal", () => {
    const target = enemy({ x: 100, y: 100 });
    const p = player({ x: 95, y: 100 });
    assert.equal(resolveEnemyCollisions(p, [target], false), true);
    assert.equal(target.alive, true);
  });

  test("an already squashed enemy is harmless", () => {
    const target = enemy({ x: 100, y: 100, alive: false });
    const p = player({ x: 100, y: 100 });
    assert.equal(resolveEnemyCollisions(p, [target], false), false);
  });

  test("how deep the overlap is does not matter, only that you were falling", () => {
    // Regression: an extra height test used to demand that the player's feet
    // were still above the enemy's middle, which the ROM does not ask of a
    // goomba. Deep overlaps then injured instead of stomping.
    const target = enemy({ x: 100, y: 100 });
    const p = player({ x: 100, y: 100 + 8, big: true });
    assert.equal(resolveEnemyCollisions(p, [target], true), false);
    assert.equal(target.alive, false);
    assert.equal(p.big, true, "a stomp never costs you your size");
  });

  test("two enemies at once are both stomped", () => {
    // ChkETmrs: StompTimer is already set by the first, so the second is a
    // stomp as well. Without it, one enemy died and the other took your size.
    const first = enemy({ x: 100, y: 100 });
    const second = enemy({ x: 108, y: 100 });
    const p = player({ x: 102, y: 100 - PHYSICS.playerSmallH + 4, big: true });

    assert.equal(resolveEnemyCollisions(p, [first, second], true), false);
    assert.equal(first.alive, false);
    assert.equal(second.alive, false);
    assert.equal(p.big, true);
  });

  test("the stomp timer keeps the next touch safe for a moment", () => {
    const target = enemy({ x: 100, y: 100 });
    const p = player({ x: 100, y: 100, big: true, stompTimer: 1 });

    assert.equal(resolveEnemyCollisions(p, [target], false), false);
    assert.equal(target.alive, false, "the timer makes even a side touch a stomp");
    assert.equal(p.big, true);
  });
});
