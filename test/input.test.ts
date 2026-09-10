import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { KEY_BINDINGS, consumesKey, readInput, readMenuInput } from "../src/input";

const held = (...keys: string[]): Set<string> => new Set(keys);

describe("which keys the game takes from the browser", () => {
  test("every bound key is claimed", () => {
    // Regression: only the scrolling keys were claimed, so pressing R reached
    // Firefox's type-ahead find instead of resetting the level.
    for (const [action, keys] of Object.entries(KEY_BINDINGS)) {
      for (const key of keys) {
        assert.ok(consumesKey(key), `${action}'s key "${key}" is not claimed from the browser`);
      }
    }
  });

  test("keys the game doesn't use are left to the browser", () => {
    for (const key of ["F5", "Tab", "F12", "p", "Home"]) {
      assert.equal(consumesKey(key), false, `"${key}" should reach the browser`);
    }
  });

  test("claiming ignores the case the browser reports", () => {
    assert.equal(consumesKey("R"), true);
    assert.equal(consumesKey("ArrowLeft"), true);
  });
});

describe("readInput", () => {
  test("reads held directions and the run button", () => {
    const input = readInput(held("arrowright", "shift"), held());
    assert.equal(input.right, true);
    assert.equal(input.run, true);
    assert.equal(input.left, false);
  });

  test("jump fires on the press, not for as long as it is held", () => {
    const pressed = readInput(held(" "), held(" "));
    assert.equal(pressed.jumpPressed, true);
    assert.equal(pressed.jumpHeld, true);

    const stillHeld = readInput(held(" "), held());
    assert.equal(stillHeld.jumpPressed, false, "holding must not re-trigger the jump");
    assert.equal(stillHeld.jumpHeld, true, "but it is still held, which keeps the rise going");
  });

  test("a tap shorter than one frame still counts", () => {
    // Regression: the loop used to compare this frame's keys with the last
    // frame's, so a key pressed and released between two frames was never
    // seen down and the press was dropped.
    const tap = readInput(held(), held("r"));
    assert.equal(tap.resetPressed, true);
    assert.equal(readInput(held("r"), held()).resetPressed, false, "still held is not a new press");
  });

  test("both alternatives for a direction work", () => {
    assert.equal(readInput(held("a"), held()).left, true);
    assert.equal(readInput(held("arrowleft"), held()).left, true);
  });

  test("an empty keyboard means no input at all", () => {
    const input = readInput(held(), held());
    assert.deepEqual(Object.values(input).filter(Boolean), []);
  });
});

describe("readMenuInput", () => {
  test("only reacts to presses, so a held key does not scroll the menu", () => {
    assert.equal(readMenuInput(held("arrowdown")).down, true);
    assert.equal(readMenuInput(held()).down, false);
  });

  test("confirm and navigation come off the same keyboard", () => {
    const input = readMenuInput(held("enter", "arrowup"));
    assert.equal(input.confirm, true);
    assert.equal(input.up, true);
    assert.equal(input.down, false);
  });
});
