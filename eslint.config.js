import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.js", "src/font-glyphs.ts", "src/sprite-frames.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // House style, as asked for.
      semi: ["error", "always"],
      curly: ["error", "all"],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          // Declared functions state their return type; inline callbacks like
          // .map(x => x.y) read better without one.
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],

      // Object types are written as `type` throughout; enforce that rather
      // than letting interfaces creep in.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // Numbers in template literals are exactly what the HUD and the logs
      // are made of.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // The canvas and its elements are guaranteed by the page's own markup.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // node:test's test() returns a promise that nobody is meant to await.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  }
);
