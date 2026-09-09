import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_H,
  PHYSICS,
  NO_INPUT,
  createPlayingState,
  createInitialState,
  step,
  type GameState,
  type Input,
  type Level,
} from "../src/engine";
import type { EnemyDef } from "../src/levels";

// Synthetic levels keep these tests independent of src/levels.ts, so tuning a
// real level's geometry can never silently break the physics suite.
const GROUND_Y = 200;
// The player starts small, so its feet rest a small-height above the floor.
const RESTING_Y = GROUND_Y - PHYSICS.playerSmallH;

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    width: 480,
    timeLimit: 400,
    platforms: [{ x: 0, y: GROUND_Y, w: 480, h: 20 }],
    enemies: [],
    mushrooms: [],
    certificate: { x: 460, y: 20, w: 18, h: 24 },
    playerStart: { x: 50, y: RESTING_Y },
    intro: ["intro one", "intro two"],
    outro: ["outro one"],
    ...overrides,
  };
}

function input(overrides: Partial<Input> = {}): Input {
  return { ...NO_INPUT, ...overrides };
}

function run(
  state: GameState,
  levels: Level[],
  frames: number,
  action: Input | ((frame: number) => Input)
): GameState {
  let current = state;
  for (let frame = 0; frame < frames; frame++) {
    const nextInput = typeof action === "function" ? action(frame) : action;
    current = step(current, nextInput, levels);
  }
  return current;
}

function settleOnGround(levels: Level[]): GameState {
  return run(createPlayingState(0, levels), levels, 3, NO_INPUT);
}

describe("jumping", () => {
  test("a grounded player jumps", () => {
    const levels = [makeLevel()];
    const grounded = settleOnGround(levels);
    assert.equal(grounded.player.grounded, true);

    const jumped = step(grounded, input({ jumpPressed: true, jumpHeld: true }), levels);
    assert.ok(jumped.player.vy < 0, "jump should give upward velocity");
    assert.equal(jumped.player.grounded, false);
  });

  test("holding jump in mid-air never re-jumps (regression: infinite jump)", () => {
    const levels = [makeLevel()];
    const start = settleOnGround(levels);
    const held = input({ jumpPressed: true, jumpHeld: true });

    // The original bug allowed a new jump whenever |vy| was near zero, which
    // is also true at the apex -- so the player could climb forever.
    let state = start;
    let highest = start.player.y;
    let touchedGroundAgain = false;
    for (let frame = 0; frame < 240; frame++) {
      state = step(state, held, levels);
      highest = Math.min(highest, state.player.y);
      if (frame > 5 && state.player.grounded) {
        touchedGroundAgain = true;
      }
    }

    // A standing jump climbs about 64px; anything far past that means the
    // player kept re-launching in mid-air.
    assert.ok(highest > RESTING_Y - 100, `player climbed unboundedly to y=${highest}`);
    assert.ok(touchedGroundAgain, "player should come back down");
  });

  test("releasing the button early gives a lower jump than holding it", () => {
    const levels = [makeLevel()];
    const start = settleOnGround(levels);

    const apexOf = (holdFrames: number): number => {
      let state = start;
      let apex = start.player.y;
      for (let frame = 0; frame < 90; frame++) {
        const holding = frame < holdFrames;
        state = step(state, input({ jumpPressed: holding, jumpHeld: holding }), levels);
        apex = Math.min(apex, state.player.y);
      }
      return apex;
    };

    const tapped = apexOf(1);
    const held = apexOf(30);
    assert.ok(held < tapped - 20, `holding (${held}) should clear tapping (${tapped}) by a wide margin`);
  });

  test("a fast run-up jumps higher than a standing jump", () => {
    const levels = [makeLevel()];
    const standing = settleOnGround(levels);
    // SMB1 accelerates slowly, so this needs a proper run-up to reach the
    // fastest row of the jump table.
    const running = run(standing, levels, 120, input({ right: true, run: true }));
    assert.ok(Math.abs(running.player.vx) >= PHYSICS.maxRunSpeed * 0.9, "should have reached running speed");

    const jumpFrom = (state: GameState, moving: boolean): number =>
      step(state, input({ jumpPressed: true, jumpHeld: true, right: moving, run: moving }), levels).player.vy;

    assert.ok(jumpFrom(running, true) < jumpFrom(standing, false), "running jump should be stronger");
  });
});

describe("horizontal movement", () => {
  test("walking is capped at the walking speed", () => {
    const levels = [makeLevel()];
    const state = run(settleOnGround(levels), levels, 200, input({ right: true }));
    assert.equal(state.player.vx, PHYSICS.maxWalkSpeed);
  });

  test("holding run reaches the higher running speed", () => {
    const levels = [makeLevel()];
    const state = run(settleOnGround(levels), levels, 200, input({ right: true, run: true }));
    assert.equal(state.player.vx, PHYSICS.maxRunSpeed);
  });

  test("friction settles at exactly zero instead of oscillating", () => {
    const levels = [makeLevel()];
    const moving = run(settleOnGround(levels), levels, 30, input({ right: true }));
    const stopped = run(moving, levels, 30, NO_INPUT);
    assert.equal(stopped.player.vx, 0);
  });

  test("the player cannot walk off the sides of the screen", () => {
    const levels = [makeLevel()];
    const state = run(settleOnGround(levels), levels, 400, input({ left: true }));
    assert.equal(state.player.x, 0);
  });

  test("facing follows the last direction pressed", () => {
    const levels = [makeLevel()];
    const right = run(settleOnGround(levels), levels, 5, input({ right: true }));
    assert.equal(right.player.facing, 1);
    const left = run(right, levels, 5, input({ left: true }));
    assert.equal(left.player.facing, -1);
  });
});

describe("platforms", () => {
  test("landing zeroes vertical speed and marks the player grounded", () => {
    const levels = [makeLevel({ playerStart: { x: 50, y: 100 } })];
    const state = run(createPlayingState(0, levels), levels, 60, NO_INPUT);
    assert.equal(state.player.grounded, true);
    assert.equal(state.player.vy, 0);
    assert.equal(state.player.y, RESTING_Y);
  });

  test("falling past the bottom of the world kills the player", () => {
    const levels = [makeLevel({ platforms: [], playerStart: { x: 50, y: CANVAS_H - 10 } })];
    const state = run(createPlayingState(0, levels), levels, 120, NO_INPUT);
    assert.equal(state.phase, "dead");
  });
});

describe("enemies", () => {
  const enemyLevel = (enemyX: number): Level =>
    makeLevel({
      enemies: [{ x: enemyX, y: GROUND_Y - PHYSICS.enemyH, facing: -1 }],
    });

  test("dropping onto an enemy squashes it and bounces the player", () => {
    const levels = [enemyLevel(100)];
    const falling = createPlayingState(0, levels);
    falling.player.x = levels[0].enemies[0].x;
    falling.player.y = 120;

    let state = falling;
    let bounced = false;
    for (let frame = 0; frame < 40 && state.enemies[0].alive; frame++) {
      state = step(state, NO_INPUT, levels);
      if (state.player.vy === PHYSICS.bounceVelocity) {
        bounced = true;
      }
    }

    assert.equal(state.phase, "playing", "a clean stomp must not kill the player");
    assert.equal(state.enemies[0].alive, false);
    assert.equal(state.enemies[0].squashTimer, PHYSICS.squashFramerules);
    assert.ok(bounced, "stomping should bounce the player back up");
  });

  test("the squashed enemy disappears after its timer runs out", () => {
    const levels = [enemyLevel(100)];
    const falling = createPlayingState(0, levels);
    falling.player.x = 100;
    falling.player.y = 120;

    const state = run(falling, levels, 90, NO_INPUT);
    assert.equal(state.enemies[0].alive, false);
    assert.equal(state.enemies[0].squashTimer, 0);
  });

  test("walking into an enemy from the side is fatal", () => {
    const levels = [enemyLevel(150)];
    const state = run(settleOnGround(levels), levels, 120, input({ right: true }));
    assert.equal(state.phase, "dead");
    assert.equal(state.enemies[0].alive, true);
  });

  test("dropping onto an enemy that stands on the ground still stomps it", () => {
    // The enemy check runs on the pre-collision fall speed, so a stomp is
    // judged on where the feet were before the frame moved them, not on
    // whatever the platform collision snapped them to afterwards.
    const levels = [enemyLevel(100)];
    let state = createPlayingState(0, levels);
    state.player.x = 100;
    state.player.y = 190 - PHYSICS.playerH; // feet at 190, above the enemy's midpoint
    state.player.vy = PHYSICS.maxFallSpeed;

    state = step(state, NO_INPUT, levels);
    assert.equal(state.phase, "playing");
    assert.equal(state.enemies[0].alive, false);
  });

  test("an enemy walks off its ledge and falls out of the world", () => {
    // The player keeps its own ground so it stays alive and the world keeps
    // stepping; the enemy's ledge is separate and ends in mid-air.
    const ledge = { x: 200, y: 150, w: 40, h: 12 };
    const levels = [
      makeLevel({
        platforms: [{ x: 0, y: GROUND_Y, w: 100, h: 20 }, ledge],
        enemies: [{ x: 205, y: 150 - PHYSICS.enemyH, facing: 1 }],
      }),
    ];
    const state = run(createPlayingState(0, levels), levels, 300, NO_INPUT);
    assert.equal(state.phase, "playing", "the player should still be standing on its own ground");
    assert.equal(state.enemies[0].alive, false, "the enemy should have walked off and dropped away");
  });
});

describe("growing and getting hurt", () => {
  const enemyAt = (x: number): EnemyDef => ({ x, y: GROUND_Y - PHYSICS.enemyH, facing: -1 as const });

  test("a mushroom makes the player big without sinking into the floor", () => {
    const levels = [makeLevel({ mushrooms: [{ x: 50, y: GROUND_Y - PHYSICS.mushroomH }] })];
    const state = run(createPlayingState(0, levels), levels, 10, NO_INPUT);

    assert.equal(state.player.big, true);
    assert.equal(state.player.h, PHYSICS.playerH);
    assert.equal(state.player.y + state.player.h, GROUND_Y, "the feet stay on the ground");
    assert.equal(state.mushrooms[0].taken, true);
  });

  test("a hit costs a big player its size instead of its life", () => {
    const levels = [
      makeLevel({ mushrooms: [{ x: 50, y: GROUND_Y - PHYSICS.mushroomH }], enemies: [enemyAt(150)] }),
    ];
    const grown = run(createPlayingState(0, levels), levels, 10, NO_INPUT);
    assert.equal(grown.player.big, true);

    const hit = run(grown, levels, 200, input({ right: true }));
    assert.equal(hit.phase, "playing", "shrinking is not dying");
    assert.equal(hit.player.big, false);
    assert.ok(hit.player.invincibleFramerules > 0, "and buys a moment of invincibility");
  });

  test("a hit kills a small player", () => {
    const levels = [makeLevel({ enemies: [enemyAt(150)] })];
    const state = run(settleOnGround(levels), levels, 200, input({ right: true }));
    assert.equal(state.phase, "dead");
  });

  test("only a big player can crouch", () => {
    const withoutMushroom = [makeLevel()];
    const small = run(settleOnGround(withoutMushroom), withoutMushroom, 3, input({ down: true }));
    assert.equal(small.player.crouching, false);

    const levels = [makeLevel({ mushrooms: [{ x: 50, y: GROUND_Y - PHYSICS.mushroomH }] })];
    const big = run(createPlayingState(0, levels), levels, 10, NO_INPUT);
    const crouched = step(big, input({ down: true }), levels);
    assert.equal(crouched.player.crouching, true);
    assert.equal(crouched.player.h, PHYSICS.playerSmallH, "crouching shrinks the hitbox");
    assert.equal(crouched.player.y + crouched.player.h, GROUND_Y, "and keeps the feet down");
  });

  test("a crouching player cannot walk", () => {
    const levels = [makeLevel({ mushrooms: [{ x: 50, y: GROUND_Y - PHYSICS.mushroomH }] })];
    const big = run(createPlayingState(0, levels), levels, 10, NO_INPUT);
    const crouched = run(big, levels, 20, input({ down: true, right: true }));
    assert.equal(crouched.player.vx, 0);
  });
});

describe("progression", () => {
  test("touching the certificate starts the outro dialogue", () => {
    const levels = [makeLevel({ certificate: { x: 50, y: RESTING_Y, w: 18, h: 24 } })];
    const state = run(createPlayingState(0, levels), levels, 2, NO_INPUT);
    assert.equal(state.phase, "dialogue");
    assert.equal(state.dialogueKind, "outro");
    assert.deepEqual(state.dialogueLines, levels[0].outro);
  });

  test("the title screen leads into the first level's intro", () => {
    const levels = [makeLevel()];
    const state = step(createInitialState(levels), input({ confirmPressed: true }), levels);
    assert.equal(state.phase, "dialogue");
    assert.equal(state.dialogueKind, "intro");
    assert.deepEqual(state.dialogueLines, levels[0].intro);
  });

  test("clicking through the intro starts play", () => {
    const levels = [makeLevel()];
    const confirm = input({ confirmPressed: true });
    let state = step(createInitialState(levels), confirm, levels);
    state = run(state, levels, levels[0].intro.length, confirm);
    assert.equal(state.phase, "playing");
  });

  test("finishing a level's outro moves on to the next level", () => {
    const levels = [makeLevel(), makeLevel({ intro: ["level two"] })];
    let state = createPlayingState(0, levels);
    state.phase = "dialogue";
    state.dialogueKind = "outro";
    state.dialogueLines = levels[0].outro;

    state = run(state, levels, levels[0].outro.length, input({ confirmPressed: true }));
    assert.equal(state.levelIndex, 1);
    assert.equal(state.phase, "dialogue");
    assert.equal(state.dialogueKind, "intro");
  });

  test("finishing the last level's outro completes the game", () => {
    const levels = [makeLevel()];
    let state = createPlayingState(0, levels);
    state.phase = "dialogue";
    state.dialogueKind = "outro";
    state.dialogueLines = levels[0].outro;

    state = run(state, levels, levels[0].outro.length, input({ confirmPressed: true }));
    assert.equal(state.phase, "gameComplete");
  });

  test("reset puts the player back at the start without running physics", () => {
    const levels = [makeLevel()];
    const moved = run(settleOnGround(levels), levels, 40, input({ right: true }));
    assert.notEqual(moved.player.x, levels[0].playerStart.x);

    const reset = step(moved, input({ resetPressed: true }), levels);
    assert.equal(reset.player.x, levels[0].playerStart.x);
    assert.equal(reset.player.vx, 0);
    assert.equal(reset.phase, "playing");
  });

  test("reset revives the player after dying", () => {
    const levels = [makeLevel({ platforms: [], playerStart: { x: 50, y: CANVAS_H - 10 } })];
    const dead = run(createPlayingState(0, levels), levels, 120, NO_INPUT);
    assert.equal(dead.phase, "dead");

    const revived = step(dead, input({ resetPressed: true }), levels);
    assert.equal(revived.phase, "playing");
    assert.equal(revived.player.y, levels[0].playerStart.y);
  });
});

describe("purity", () => {
  test("step never mutates the state it is given", () => {
    const levels = [makeLevel({ enemies: [{ x: 105, y: 100, facing: 1 }] })];
    const state = settleOnGround(levels);
    const before = JSON.stringify(state);

    step(state, input({ right: true, jumpPressed: true, jumpHeld: true }), levels);

    assert.equal(JSON.stringify(state), before);
  });

  test("the same inputs always produce the same run (deterministic replay)", () => {
    const levels = [makeLevel()];
    const script = (frame: number): Input =>
      input({ right: true, jumpPressed: frame % 20 === 0, jumpHeld: frame % 20 < 8 });
    const a = run(createPlayingState(0, levels), levels, 200, script);
    const b = run(createPlayingState(0, levels), levels, 200, script);
    assert.deepEqual(a.player, b.player);
    assert.deepEqual(a.enemies, b.enemies);
  });
});
