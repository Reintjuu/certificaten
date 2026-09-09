import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { KEY_BINDINGS, consumesKey, readInput } from "../src/input";

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

  test("jump and reset fire on the press, not while held", () => {
    const pressed = readInput(held(" "), held());
    assert.equal(pressed.jumpPressed, true);
    assert.equal(pressed.jumpHeld, true);

    const stillHeld = readInput(held(" "), held(" "));
    assert.equal(stillHeld.jumpPressed, false, "holding must not re-trigger the jump");
    assert.equal(stillHeld.jumpHeld, true, "but it is still held, which keeps the rise going");

    assert.equal(readInput(held("r"), held()).resetPressed, true);
    assert.equal(readInput(held("r"), held("r")).resetPressed, false);
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
