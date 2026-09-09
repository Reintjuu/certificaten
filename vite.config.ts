import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // A GitHub Pages project site is served from /<repo>/, so asset URLs need
  // that prefix. Build with BASE_PATH=/queeste-certificaten/ for Pages.
  base: process.env.BASE_PATH ?? "/",
  build: {
    rollupOptions: {
      // Without naming it here the replay viewer is a dev-only page: it works
      // under `npm run dev` and then silently doesn't exist in the build.
      input: {
        game: at("./index.html"),
        replay: at("./agent/replay.html"),
      },
    },
  },
});
