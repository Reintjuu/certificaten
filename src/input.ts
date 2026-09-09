import { NO_INPUT, type Input } from "./engine";

/** Keys are compared lower-cased, the way KeyboardEvent.key reports them. */
export const KEY_BINDINGS = {
  jump: new Set([" ", "w", "arrowup"]),
  confirm: new Set([" ", "enter"]),
  left: new Set(["arrowleft", "a"]),
  right: new Set(["arrowright", "d"]),
  down: new Set(["arrowdown", "s"]),
  /** The NES B button: hold to run instead of walk. */
  run: new Set(["shift", "x"]),
  reset: new Set(["r"]),
} as const;

const GAME_KEYS = new Set(Object.values(KEY_BINDINGS).flatMap((keys) => [...keys]));

/**
 * Whether the game consumes this key, and should therefore stop the browser
 * acting on it. Scoped to exactly the game's own keys: swallowing everything
 * would break F5 and Tab, and swallowing nothing leaves Firefox opening its
 * type-ahead find bar the moment you press R.
 */
export function consumesKey(key: string): boolean {
  return GAME_KEYS.has(key.toLowerCase());
}

function anyHeld(current: ReadonlySet<string>, mapped: ReadonlySet<string>): boolean {
  for (const key of mapped) {
    if (current.has(key)) {
      return true;
    }
  }
  return false;
}

/** Held on this frame but not the previous one: the key's rising edge. */
function anyPressed(
  current: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  mapped: ReadonlySet<string>
): boolean {
  for (const key of mapped) {
    if (current.has(key) && !previous.has(key)) {
      return true;
    }
  }
  return false;
}

export function readInput(current: ReadonlySet<string>, previous: ReadonlySet<string>): Input {
  return {
    ...NO_INPUT,
    left: anyHeld(current, KEY_BINDINGS.left),
    right: anyHeld(current, KEY_BINDINGS.right),
    down: anyHeld(current, KEY_BINDINGS.down),
    run: anyHeld(current, KEY_BINDINGS.run),
    jumpHeld: anyHeld(current, KEY_BINDINGS.jump),
    jumpPressed: anyPressed(current, previous, KEY_BINDINGS.jump),
    confirmPressed: anyPressed(current, previous, KEY_BINDINGS.confirm),
    resetPressed: anyPressed(current, previous, KEY_BINDINGS.reset),
  };
}
