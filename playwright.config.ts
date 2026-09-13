import { defineConfig, devices } from "@playwright/test";

/**
 * The visual regression suite. It runs against the dev server rather than a
 * build, because the page it drives (visual/scenes.html) is a test fixture and
 * has no business in the shipped site.
 *
 * The scenes are drawn on demand and never on a clock, so a screenshot is a
 * function of the code alone. That is what lets the comparison be exact: any
 * difference at all is a change somebody made, not a frame that landed
 * differently this time.
 */
export default defineConfig({
  testDir: "./visual",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI === undefined ? "list" : "github",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 0 },
  },
  use: {
    baseURL: "http://localhost:5173",
    // Pixel art at 1x: scaling it would compare the browser's filtering
    // rather than the game's drawing.
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173/visual/scenes.html",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
});
