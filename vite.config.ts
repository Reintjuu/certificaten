import { defineConfig } from "vite";

export default defineConfig({
  // A GitHub Pages project site is served from /<repo>/, so asset URLs need
  // that prefix. `npm run build:github-pages` passes it as --base.
  build: {
    rollupOptions: {
      output: {
        // Keeps the lazily loaded console (and the training data it carries)
        // recognisable in dist/ instead of a hashed name only.
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
