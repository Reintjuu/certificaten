import { test, expect, type Page } from "@playwright/test";

/**
 * One screenshot per scene, compared pixel for pixel against the committed
 * baseline. The scenes themselves live in scenes.ts; this only asks for them
 * by name, so adding a scene there adds a test here.
 *
 * When a change is meant to alter what the game looks like, run
 * `npm run test:visual -- --update-snapshots` and commit the new baselines,
 * having looked at them.
 */
async function openStage(page: Page): Promise<string[]> {
  await page.goto("/visual/scenes.html");
  await page.waitForFunction(() => "sceneNames" in window);
  return page.evaluate(() => (window as unknown as { sceneNames: string[] }).sceneNames);
}

test("every scene still looks the way it was drawn", async ({ page }) => {
  const names = await openStage(page);
  expect(names.length).toBeGreaterThan(5);

  for (const name of names) {
    await page.evaluate((scene) => {
      (window as unknown as { drawSceneNamed: (n: string) => void }).drawSceneNamed(scene);
    }, name);
    await expect(page.locator("#stage")).toHaveScreenshot(`${name}.png`);
  }
});

test("the game itself boots, takes a keypress and draws", async ({ page }) => {
  // The scenes above drive the engine directly. This one goes through the real
  // page: index.html, the title screen, and a key that has to reach the loop.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator("#game")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  const painted = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (canvas == null || context == null) {
      return 0;
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return new Set(pixels).size;
  });

  expect(painted, "the canvas should hold more than one flat colour").toBeGreaterThan(4);
  expect(errors).toEqual([]);
});
