import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EnemyKind,
  EnemyState,
  LEVELS,
  NO_INPUT,
  createInitialState,
  createPlayingState,
  step,
} from "../src/engine";
import { SoundEvent, eventsBetween } from "../src/sound-events";

// Sound itself cannot be unit tested: a WebAudio context makes noise, not
// assertions. What can be tested is the deciding, which is why it lives apart
// from the playing.

describe("what a frame is worth hearing", () => {
  test("nothing happens when nothing happens", () => {
    const state = createPlayingState(0);
    assert.deepEqual(eventsBetween(state, state), []);
  });

  test("leaving the ground upwards is a jump", () => {
    const grounded = createPlayingState(0);
    grounded.player.grounded = true;
    const airborne = { ...grounded, player: { ...grounded.player, grounded: false, vy: -4 } };

    assert.deepEqual(eventsBetween(grounded, airborne), [SoundEvent.Jump]);
  });

  test("walking off a ledge is not a jump", () => {
    // Falling and jumping look the same in the grounded flag alone, which is
    // why the direction of travel is part of the test rather than a detail.
    const grounded = createPlayingState(0);
    grounded.player.grounded = true;
    const falling = { ...grounded, player: { ...grounded.player, grounded: false, vy: 2 } };

    assert.deepEqual(eventsBetween(grounded, falling), []);
  });

  test("an enemy going out is a stomp", () => {
    const before = createPlayingState(0);
    const after = {
      ...before,
      enemies: before.enemies.map((enemy, index) =>
        index === 0 ? { ...enemy, state: EnemyState.Gone } : enemy
      ),
    };
    assert.deepEqual(eventsBetween(before, after), [SoundEvent.Stomp]);
  });

  test("a koopa withdrawing into its shell is a stomp too", () => {
    const before = createPlayingState(1);
    const shelled = {
      ...before,
      enemies: before.enemies.map((enemy) =>
        enemy.kind === EnemyKind.Koopa ? { ...enemy, state: EnemyState.Shell } : enemy
      ),
    };
    assert.deepEqual(eventsBetween(before, shelled), [SoundEvent.Stomp]);
  });

  test("kicking that shell awake is heard as well", () => {
    const standing = createPlayingState(1);
    const before = {
      ...standing,
      enemies: standing.enemies.map((enemy) =>
        enemy.kind === EnemyKind.Koopa ? { ...enemy, state: EnemyState.Shell } : enemy
      ),
    };
    const kicked = {
      ...before,
      enemies: before.enemies.map((enemy) =>
        enemy.kind === EnemyKind.Koopa ? { ...enemy, state: EnemyState.Sliding } : enemy
      ),
    };
    assert.deepEqual(eventsBetween(before, kicked), [SoundEvent.Stomp]);
  });

  test("growing and shrinking are told apart", () => {
    const small = createPlayingState(0);
    const big = { ...small, player: { ...small.player, big: true } };
    const taken = {
      ...big,
      mushrooms: big.mushrooms.map((mushroom, i) => (i === 0 ? { ...mushroom, taken: true } : mushroom)),
    };
    assert.deepEqual(eventsBetween(small, taken), [SoundEvent.Grow]);

    const hit = { ...big, player: { ...big.player, big: false, invincibleFramerules: 8 } };
    assert.deepEqual(eventsBetween(big, hit), [SoundEvent.Shrink]);
  });

  test("crouching is not shrinking, even though the box gets smaller", () => {
    const big = createPlayingState(0);
    big.player.big = true;
    const crouched = { ...big, player: { ...big.player, crouching: true, h: 16 } };
    assert.deepEqual(eventsBetween(big, crouched), []);
  });

  test("dying and reaching the certificate each say so once", () => {
    const playing = createPlayingState(0);
    assert.deepEqual(eventsBetween(playing, { ...playing, phase: "dead" }), [SoundEvent.Die]);

    const won = { ...playing, phase: "dialogue" as const, dialogueKind: "outro" as const };
    assert.deepEqual(eventsBetween(playing, won), [SoundEvent.Certificate]);
    assert.deepEqual(eventsBetween(won, won), [], "and not again on every frame after");
  });

  test("starting the game from the title screen is heard", () => {
    const title = createInitialState();
    const started = step(title, { ...NO_INPUT, confirmPressed: true });
    assert.deepEqual(eventsBetween(title, started), [SoundEvent.Start]);
  });

  test("every event has a sound to play", async () => {
    // The synth indexes its table by event, so a new event without an entry
    // would be a silent hole rather than an error.
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../src/sound.ts", import.meta.url), "utf8")
    );
    for (const event of Object.values(SoundEvent)) {
      assert.ok(
        source.includes(`[SoundEvent.${event.charAt(0).toUpperCase()}${event.slice(1)}]`),
        `no sound written for "${event}"`
      );
    }
  });

  test("a whole level's worth of play makes a plausible amount of noise", () => {
    let state = createPlayingState(0);
    const heard: SoundEvent[] = [];
    for (let frame = 0; frame < 400; frame++) {
      const previous = state;
      state = step(state, {
        ...NO_INPUT,
        right: true,
        run: true,
        jumpHeld: frame % 40 < 12,
        jumpPressed: frame % 40 === 0,
      });
      heard.push(...eventsBetween(previous, state));
    }
    assert.ok(heard.includes(SoundEvent.Jump), "holding the jump button should be heard");
    assert.ok(heard.length < 100, `${heard.length} events in 400 frames is a racket, not a game`);
    assert.ok(LEVELS.length > 0);
  });
});
