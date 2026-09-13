// On-screen controls for a phone. They do not introduce a second notion of
// input: a button press puts the very key it stands for into the same held and
// pressed sets the keyboard writes to, so everything downstream, the menus,
// the dialogue and the physics, cannot tell the two apart.
import { KEY_BINDINGS } from "./input";

/** The key each button stands in for, taken from the bindings themselves. */
function firstKey(keys: ReadonlySet<string>): string {
  const [key] = keys;
  return key;
}

export type TouchButton = { key: string; label: string; slot: string };

export const TOUCH_BUTTONS: TouchButton[] = [
  { key: firstKey(KEY_BINDINGS.left), label: "◀", slot: "left" },
  { key: firstKey(KEY_BINDINGS.right), label: "▶", slot: "right" },
  { key: firstKey(KEY_BINDINGS.down), label: "▼", slot: "down" },
  { key: firstKey(KEY_BINDINGS.run), label: "REN", slot: "run" },
  { key: firstKey(KEY_BINDINGS.jump), label: "SPRING", slot: "jump" },
];

/**
 * Whether this is a device you play with your thumbs. Touch support alone is
 * not the question: a laptop with a touchscreen still has a keyboard, and a
 * pad over the game would be in the way there.
 */
export function wantsTouchControls(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

export type TouchTarget = {
  held: Set<string>;
  pressed: Set<string>;
};

/**
 * Builds the pad and wires it to the key sets. It stays hidden until something
 * asks for it: see showTouchControls. Pointer capture is what makes a
 * thumb that slides off the button still let go of the key: without it the
 * button never sees the release and the player runs off on their own.
 */
/**
 * Capturing can throw when the pointer is already gone, and a button that
 * throws on the way down never registers as pressed at all. Holding the key
 * matters more than tracking the finger, so the capture is the optional half.
 */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Not capturable; pointerup on the element still releases the key.
  }
}

export function attachTouchControls(container: HTMLElement, target: TouchTarget): void {
  for (const button of TOUCH_BUTTONS) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `touch-button touch-${button.slot}`;
    element.textContent = button.label;
    element.dataset.key = button.key;
    // Nothing here should select text, scroll the page or raise a keyboard.
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      capture(element, event.pointerId);
      element.classList.add("pressed");
      target.held.add(button.key);
      target.pressed.add(button.key);
    });

    const release = (event: PointerEvent): void => {
      event.preventDefault();
      element.classList.remove("pressed");
      target.held.delete(button.key);
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);

    container.append(element);
  }
}

/**
 * A tap anywhere on the picture is the confirm button, which is what a phone
 * player will try first to get past a line of dialogue. Deliberately the
 * confirm key that is not also the jump key, or every tap during play would be
 * a jump as well. `wanted` keeps it off the menus, where a tap already means
 * "this row" and confirming the highlighted one instead would be a surprise.
 */
const TAP_KEY = [...KEY_BINDINGS.confirm].find((key) => !KEY_BINDINGS.jump.has(key)) ?? "enter";

export function attachTapToConfirm(canvas: HTMLElement, target: TouchTarget, wanted: () => boolean): void {
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || !wanted()) {
      return;
    }
    target.pressed.add(TAP_KEY);
  });
}

/** The pad is only worth showing when there is a player to steer. */
export function showTouchControls(container: HTMLElement, wanted: boolean): void {
  container.hidden = !wanted;
}
