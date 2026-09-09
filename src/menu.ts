import { CANVAS_W, CANVAS_H } from "./engine";
import { COLORS } from "./render";
import { drawText, drawTextCentered, textWidth } from "./font";

export type MenuItem = { label: string; hint?: string; run: () => void };

const ROW_HEIGHT = 26;
const SCALE = 1;
const GLYPH = 16;

/**
 * A NES-style menu: arrows and enter move a marker, and the mouse selects the
 * row it is over. Both drive the same selection, so neither is a second-class
 * way in.
 */
export class Menu {
  private selected = 0;

  constructor(
    private readonly title: string,
    private readonly items: MenuItem[]
  ) {}

  moveBy(delta: number): void {
    const count = this.items.length;
    this.selected = (this.selected + delta + count) % count;
  }

  activate(): void {
    this.items[this.selected]?.run();
  }

  get selectedIndex(): number {
    return this.selected;
  }

  private get top(): number {
    return CANVAS_H / 2 - (this.items.length * ROW_HEIGHT) / 2;
  }

  /** Which row a canvas-space point is over, or null. */
  rowAt(y: number): number | null {
    const row = Math.floor((y - this.top) / ROW_HEIGHT);
    return row >= 0 && row < this.items.length ? row : null;
  }

  hover(y: number): void {
    const row = this.rowAt(y);
    if (row !== null) {
      this.selected = row;
    }
  }

  draw(ctx: CanvasRenderingContext2D, blinkTimer: number): void {
    ctx.fillStyle = COLORS.nightSky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawTextCentered(ctx, this.title, CANVAS_W / 2, 40, SCALE, COLORS.highlight);

    this.items.forEach((item, index) => {
      const isSelected = index === this.selected;
      const y = this.top + index * ROW_HEIGHT;
      const width = textWidth(item.label, SCALE);
      const x = CANVAS_W / 2 - width / 2;

      if (isSelected) {
        ctx.fillStyle = "#20204a";
        ctx.fillRect(x - 24, y - 4, width + 48, GLYPH + 8);
        drawText(ctx, "▶", x - 22, y, SCALE, COLORS.highlight);
      }
      drawText(ctx, item.label, x, y, SCALE, isSelected ? "#ffffff" : "#8888cc");
    });

    const hint = this.items[this.selected]?.hint;
    if (hint) {
      drawTextCentered(ctx, hint, CANVAS_W / 2, CANVAS_H - 46, SCALE, "#8888cc");
    }
    if (blinkTimer < 30) {
      drawTextCentered(ctx, "PIJLTJES EN ENTER", CANVAS_W / 2, CANVAS_H - 24, SCALE, "#5a5a8c");
    }
  }
}
