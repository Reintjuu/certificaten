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
  /** Toggles the frame rate readout. */
  frameRate: new Set(["f"]),
  /** Silences the game. */
  mute: new Set(["m"]),
  menuUp: new Set(["arrowup", "w"]),
  menuDown: new Set(["arrowdown", "s"]),
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

function anyOf(keys: ReadonlySet<string>, mapped: ReadonlySet<string>): boolean {
  for (const key of mapped) {
    if (keys.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * `held` is what is down right now; `pressed` is every key whose keydown
 * arrived since the last frame. They are two sets rather than this frame's
 * and the previous frame's, because comparing snapshots loses a tap that
 * starts and ends inside one frame: the key is never seen down at all.
 */
export function readInput(held: ReadonlySet<string>, pressed: ReadonlySet<string>): Input {
  return {
    ...NO_INPUT,
    left: anyOf(held, KEY_BINDINGS.left),
    right: anyOf(held, KEY_BINDINGS.right),
    down: anyOf(held, KEY_BINDINGS.down),
    run: anyOf(held, KEY_BINDINGS.run),
    jumpHeld: anyOf(held, KEY_BINDINGS.jump),
    jumpPressed: anyOf(pressed, KEY_BINDINGS.jump),
    confirmPressed: anyOf(pressed, KEY_BINDINGS.confirm),
    resetPressed: anyOf(pressed, KEY_BINDINGS.reset),
  };
}

/** Menu navigation, which reads the same keys as movement but means something else. */
export type MenuInput = { up: boolean; down: boolean; confirm: boolean };

export function readMenuInput(pressed: ReadonlySet<string>): MenuInput {
  return {
    up: anyOf(pressed, KEY_BINDINGS.menuUp),
    down: anyOf(pressed, KEY_BINDINGS.menuDown),
    confirm: anyOf(pressed, KEY_BINDINGS.confirm),
  };
}
