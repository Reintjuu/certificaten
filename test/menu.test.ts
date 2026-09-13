import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CANVAS_H } from "../src/engine";
import { Menu } from "../src/menu";

const GLYPH = 16;
/** Where the title and, when there is one, the subtitle are drawn. */
const TITLE_BOTTOM = 40 + GLYPH;
const SUBTITLE_BOTTOM = 56 + GLYPH;

function menuOf(rows: number, subtitle?: string): Menu {
  const items = Array.from({ length: rows }, (_, index) => ({
    label: `ROW ${String(index)}`,
    run: (): void => undefined,
  }));
  return new Menu("AI CONSOLE", items, subtitle);
}

describe("where the menu puts its rows", () => {
  test("a long menu starts below the title instead of on top of it", () => {
    // The console's menu has eight entries. Centring those on the screen put
    // the first one straight through the title, which is what this stops.
    const { top } = menuOf(8).layout();
    assert.ok(top >= TITLE_BOTTOM, `first row at ${String(top)} runs into the title`);
  });

  test("and still leaves room for the hint underneath", () => {
    // Nine rows is what fits between the title and the hint; the longest menu
    // in the game has eight.
    for (const rows of [2, 5, 8, 9]) {
      const { top, rowHeight } = menuOf(rows).layout();
      const bottom = top + (rows - 1) * rowHeight + GLYPH;
      assert.ok(
        bottom <= CANVAS_H - 40,
        `${String(rows)} rows reach ${String(bottom)} of ${String(CANVAS_H)}`
      );
    }
  });

  test("a short menu is still centred rather than shoved up", () => {
    const rows = 2;
    const { top, rowHeight } = menuOf(rows).layout();
    const middle = top + (rows * rowHeight) / 2;
    assert.ok(Math.abs(middle - CANVAS_H / 2) < 1, "two rows should sit around the middle");
  });

  test("a subtitle pushes the rows down further than a bare title", () => {
    const bare = menuOf(8).layout().top;
    const withSubtitle = menuOf(8, "CERTIFICATEN").layout().top;
    assert.ok(withSubtitle > bare);
    assert.ok(withSubtitle >= SUBTITLE_BOTTOM);
  });

  test("rows never overlap each other, however many there are", () => {
    for (const rows of [2, 8, 12, 20]) {
      assert.ok(menuOf(rows).layout().rowHeight >= GLYPH, `${String(rows)} rows print on top of each other`);
    }
  });

  test("clicking a row picks the row that was drawn there", () => {
    const menu = menuOf(8);
    const { top, rowHeight } = menu.layout();

    for (let row = 0; row < 8; row++) {
      assert.equal(menu.rowAt(top + row * rowHeight + 1), row, `the middle of row ${String(row)}`);
    }
    assert.equal(menu.rowAt(top - 4), null, "above the first row is nothing");
    assert.equal(menu.rowAt(top + 8 * rowHeight + 4), null, "and so is below the last");
  });
});
