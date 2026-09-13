import { test, expect, type Page } from "@playwright/test";

/**
 * Playing it with thumbs. The pad only exists on a coarse pointer, so this
 * project runs a phone profile; on the desktop project there is deliberately
 * nothing to find.
 */
async function startPlaying(page: Page): Promise<void> {
  await page.goto("/");
  const canvas = page.locator("#game");
  const box = await canvas.boundingBox();
  expect(box, "the canvas should be laid out").not.toBeNull();
  // Tap the SPEEL row, which sits about two fifths down the title screen.
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height * 0.42);
  await expect(page.locator("#touch")).toBeVisible();
}

test("the pad stays out of the way until there is something to steer", async ({ page }) => {
  await page.goto("/");
  // The title screen is tapped, not steered, and a pad over it is in the way.
  await expect(page.locator("#touch")).toBeHidden();

  await startPlaying(page);
  await expect(page.locator("#touch .touch-button")).toHaveCount(5);
  await expect(page.locator(".touch-jump")).toBeVisible();
  await expect(page.locator(".touch-left")).toBeVisible();
});

test("the picture uses the whole screen it can", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator("#game").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport, "the phone profile sets a viewport").not.toBeNull();

  // Portrait: the full width. Landscape would be capped by the height instead.
  const widest = Math.min(viewport!.width, (viewport!.height * 16) / 9);
  expect(box!.width).toBeGreaterThanOrEqual(widest - 1);
});

test("holding the right button actually moves the player", async ({ page }) => {
  await startPlaying(page);
  // Past the intro, one tap a line, so the player is on the level.
  for (let line = 0; line < 5; line++) {
    await page.locator("#game").tap();
    await page.waitForTimeout(90);
  }

  const before = await page.locator("#game").screenshot();
  const right = page.locator(".touch-right");
  await right.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await expect(right).toHaveClass(/pressed/);
  await page.waitForTimeout(600);
  const moving = await page.locator("#game").screenshot();
  await right.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await expect(right).not.toHaveClass(/pressed/);

  expect(moving.equals(before), "the picture should have changed while walking right").toBe(false);
});

test("letting go of the screen lets go of the key", async ({ page }) => {
  // A thumb that slides off a button has to release it, or the player keeps
  // running on their own. Pointer capture is what makes that work, so the
  // cancel a browser sends in that case has to be handled too.
  await startPlaying(page);
  const right = page.locator(".touch-right");

  await right.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: true });
  await expect(right).toHaveClass(/pressed/);
  await right.dispatchEvent("pointercancel", { pointerId: 2, pointerType: "touch", isPrimary: true });
  await expect(right).not.toHaveClass(/pressed/);
});
