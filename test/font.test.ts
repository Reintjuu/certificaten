import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GLYPHS } from "../src/font-glyphs";
import { textWidth, wrapText } from "../src/font";
import { LEVELS } from "../src/levels";

const GLYPH_SIZE = 16;
/**
 * Found rather than listed: a hand-kept list is how the menu's marker glyph
 * once slipped through this check unnoticed.
 */
const DRAWN_TEXT_SOURCES = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `src/${name}`)
  .filter((file) => {
    const source = readFileSync(file, "utf8");
    // The module that declares drawText only mentions its own name.
    return source.includes("drawText") && !source.includes("export function drawText");
  });

function missingGlyphs(text: string): string[] {
  return [...new Set(text.toUpperCase())].filter((ch) => !(ch in GLYPHS));
}

/** Splits a call's argument list on the commas that separate arguments. */
function splitArguments(source: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (const char of source) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth++;
    } else if (")]}".includes(char)) {
      depth--;
    } else if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  args.push(current.trim());
  return args;
}

/** The argument list of every drawText/drawTextCentered call, however it is wrapped. */
function drawTextCallArguments(source: string): string[] {
  const calls: string[] = [];
  const pattern = /drawText(?:Centered)?\(/g;

  for (const match of source.matchAll(pattern)) {
    let depth = 0;
    let quote: string | null = null;
    let index = match.index + match[0].length - 1;
    const from = index + 1;

    for (; index < source.length; index++) {
      const char = source[index];
      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    calls.push(source.slice(from, index));
  }
  return calls;
}

/** Every `drawText`/`drawTextCentered` call, with its literal text and scale. */
function drawTextCalls(file: string): { file: string; text: string; scale: number | null }[] {
  const source = readFileSync(file, "utf8");
  const numericConstants = new Map(
    [...source.matchAll(/const\s+(\w+)\s*=\s*([\d.]+)\s*;?\s*$/gm)].map(({ 1: name, 2: value }) => [
      name,
      Number(value),
    ])
  );

  return drawTextCallArguments(source).map((rest) => {
    // drawText(ctx, text, x, y, scale, colour)
    const [, text = "", , , scaleToken = ""] = splitArguments(rest);
    const literal = /^(?:"([^"]*)"|`([^`]*)`)$/.exec(text.trim());
    const scale = numericConstants.get(scaleToken.trim()) ?? Number(scaleToken);
    return {
      file,
      // Template placeholders are runtime values; the surrounding literal text
      // is what we can check for glyph coverage.
      text: (literal?.[1] ?? literal?.[2] ?? "").replace(/\$\{[^}]*\}/g, ""),
      scale: Number.isNaN(scale) ? null : scale,
    };
  });
}

describe("glyph coverage", () => {
  test("the source scan actually finds the draw calls it checks", () => {
    // Without this, a broken regex would make the two scanning tests below
    // pass by finding nothing at all.
    for (const file of DRAWN_TEXT_SOURCES) {
      assert.ok(
        drawTextCalls(file).length >= 2,
        `found no drawText calls in ${file}, so the scan regex is stale`
      );
    }
  });

  test("every dialogue line in every level can be rendered", () => {
    for (const [index, level] of LEVELS.entries()) {
      for (const line of [...level.intro, ...level.outro]) {
        assert.deepEqual(
          missingGlyphs(line),
          [],
          `level ${index + 1} line "${line}" has unrenderable characters`
        );
      }
    }
  });

  test("every literal string drawn on screen can be rendered", () => {
    // Regression: '/' and '▼' were used on screen without existing in the
    // glyph set, and drawText silently skips unknown characters, so the
    // text just quietly rendered with a hole in it.
    for (const call of DRAWN_TEXT_SOURCES.flatMap(drawTextCalls)) {
      assert.deepEqual(
        missingGlyphs(call.text),
        [],
        `${call.file} draws unrenderable characters in "${call.text}"`
      );
    }
  });

  test("all glyphs are a full 16x16 grid of on/off pixels", () => {
    for (const [char, rows] of Object.entries(GLYPHS)) {
      assert.ok(rows, `glyph '${char}' has no rows at all`);
      assert.equal(rows.length, GLYPH_SIZE, `glyph '${char}' has ${rows.length} rows`);
      for (const row of rows) {
        assert.equal(row.length, GLYPH_SIZE, `glyph '${char}' has a row of ${row.length} pixels`);
        assert.match(row, /^[01]+$/, `glyph '${char}' has a row that isn't pure on/off pixels`);
      }
    }
  });
});

describe("text scaling", () => {
  test("text is only ever drawn at whole-number scales", () => {
    // Regression: at a fractional scale each source pixel is rounded
    // independently, so adjacent columns collapse onto the same output pixel
    // and glyphs distort: a 'B' rendered at scale 0.75 read as a 'D'.
    for (const call of DRAWN_TEXT_SOURCES.flatMap(drawTextCalls)) {
      assert.ok(call.scale !== null, `could not read the scale argument in ${call.file}`);
      assert.ok(
        Number.isInteger(call.scale),
        `${call.file} draws text at fractional scale ${call.scale}, which distorts the pixel glyphs`
      );
    }
  });

  test("textWidth matches the space the glyphs actually occupy", () => {
    assert.equal(textWidth("ABC", 1), 3 * GLYPH_SIZE);
    assert.equal(textWidth("ABC", 2), 6 * GLYPH_SIZE);
    assert.equal(textWidth("", 1), 0);
  });
});

describe("wrapText", () => {
  test("keeps every line within the requested width", () => {
    const line = "certificaat 2 verkregen na drie exemplaren die niemand leest";
    for (const maxChars of [10, 20, 27, 40]) {
      for (const row of wrapText(line, maxChars)) {
        const singleWord = !row.includes(" ");
        assert.ok(row.length <= maxChars || singleWord, `"${row}" exceeds ${maxChars} characters`);
      }
    }
  });

  test("preserves the original words and their order", () => {
    const line = "het laatste loket hoogste toren langste rij";
    assert.equal(wrapText(line, 12).join(" "), line);
  });

  test("keeps a word that is longer than the line on its own line", () => {
    assert.deepEqual(wrapText("bureaucratie-avonturier ja", 10), ["bureaucratie-avonturier", "ja"]);
  });

  test("every dialogue line fits the dialogue box without clipping", () => {
    // The box fits 27 characters per row and 6 rows at scale 1.
    const maxChars = 27;
    const maxRows = 6;
    for (const level of LEVELS) {
      for (const line of [...level.intro, ...level.outro]) {
        const rows = wrapText(line, maxChars);
        assert.ok(rows.length <= maxRows, `"${line}" wraps to ${rows.length} rows, more than the box shows`);
      }
    }
  });
});
