import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NO_INPUT } from "../src/engine";
import { consumesKey, readInput, readMenuInput } from "../src/input";
import { TOUCH_BUTTONS } from "../src/touch";

describe("the buttons a phone gets", () => {
  test("every button stands for a key the game actually reads", () => {
    // The pad presses keys rather than inventing a second kind of input, so a
    // renamed binding has to break here rather than silently do nothing.
    for (const button of TOUCH_BUTTONS) {
      assert.equal(consumesKey(button.key), true, `nothing reads ${button.key}, which ${button.label} sends`);
    }
  });

  test("there is a way to walk both ways, to jump and to run", () => {
    const held = new Set(TOUCH_BUTTONS.map((button) => button.key));
    const input = readInput(held, new Set());

    assert.equal(input.left, true);
    assert.equal(input.right, true);
    assert.equal(input.jumpHeld, true);
    assert.equal(input.run, true);
    assert.equal(input.down, true);
  });

  test("holding a button is not the same as pressing it", () => {
    // Jumping is edge triggered: holding the button down must not re-jump
    // every frame, which is what happens if held doubles as pressed.
    const jump = TOUCH_BUTTONS.find((button) => button.slot === "jump");
    assert.ok(jump);

    const stillHolding = readInput(new Set([jump.key]), new Set());
    assert.equal(stillHolding.jumpHeld, true);
    assert.equal(stillHolding.jumpPressed, false);

    const justPressed = readInput(new Set([jump.key]), new Set([jump.key]));
    assert.equal(justPressed.jumpPressed, true);
  });

  test("the direction buttons drive a menu as well as a player", () => {
    const down = TOUCH_BUTTONS.find((button) => button.slot === "down");
    assert.ok(down);
    assert.equal(readMenuInput(new Set([down.key])).down, true);
  });

  test("pressing nothing is NO_INPUT", () => {
    assert.deepEqual(readInput(new Set(), new Set()), NO_INPUT);
  });
});
