import { CANVAS_W, CANVAS_H } from "./engine";
import { COLORS } from "./render";
import { drawText, drawTextCentered, textWidth } from "./font";

export type MenuItem = { label: string; hint?: string; run: () => void };

const ROW_HEIGHT = 26;
const SCALE = 1;
const GLYPH = 16;
/** Where the header sits, with and without a subtitle under the title. */
const TITLE_Y = 40;
const TITLE_ABOVE_SUBTITLE_Y = 32;
const SUBTITLE_Y = 56;
/** Clear air between the header and the first row. */
const HEADER_GAP = 12;
/** The hint and the "arrows and enter" line live down here. */
const FOOTER_HEIGHT = 54;

/**
 * A NES-style menu: arrows and enter move a marker, and the mouse selects the
 * row it is over. Both drive the same selection, so neither is a second-class
 * way in.
 */
export class Menu {
  private selected = 0;

  constructor(
    private readonly title: string,
    private readonly items: MenuItem[],
    private readonly subtitle?: string
  ) {}

  /** Back to the first row, so a screen you return to looks the same as ever. */
  reset(): void {
    this.selected = 0;
  }

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

  /**
   * Where the rows go. Centred when they fit, pushed down past the header when
   * centring would put the first one on top of the title, and squeezed when
   * there are more rows than there is room for. Drawing and clicking both read
   * it, so a row can never be somewhere other than where it was drawn.
   */
  layout(): { top: number; rowHeight: number } {
    const headerBottom = (this.subtitle === undefined ? TITLE_Y : SUBTITLE_Y) + GLYPH;
    const first = headerBottom + HEADER_GAP;
    const room = CANVAS_H - FOOTER_HEIGHT - first;
    // Never tighter than the letters are tall, whatever the arithmetic says:
    // rows that print over each other are worse than rows that reach into the
    // footer. Nine is what fits at that spacing, which is one more than the
    // longest menu here has.
    const rowHeight = Math.max(GLYPH, Math.min(ROW_HEIGHT, Math.floor(room / this.items.length)));
    const centred = CANVAS_H / 2 - (this.items.length * rowHeight) / 2;
    return { top: Math.max(centred, first), rowHeight };
  }

  /** Which row a canvas-space point is over, or null. */
  rowAt(y: number): number | null {
    const { top, rowHeight } = this.layout();
    const row = Math.floor((y - top) / rowHeight);
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
    if (this.subtitle === undefined) {
      drawTextCentered(ctx, this.title, CANVAS_W / 2, TITLE_Y, SCALE, COLORS.highlight);
    } else {
      drawTextCentered(ctx, this.title, CANVAS_W / 2, TITLE_ABOVE_SUBTITLE_Y, SCALE, COLORS.text);
      drawTextCentered(ctx, this.subtitle, CANVAS_W / 2, SUBTITLE_Y, SCALE, COLORS.highlight);
    }

    const { top, rowHeight } = this.layout();
    this.items.forEach((item, index) => {
      const isSelected = index === this.selected;
      const y = top + index * rowHeight;
      const width = textWidth(item.label, SCALE);
      const x = CANVAS_W / 2 - width / 2;

      if (isSelected) {
        // The highlight never grows past its own row, or a long menu would
        // have every row painting over its neighbour.
        const height = Math.min(GLYPH + 8, rowHeight);
        ctx.fillStyle = COLORS.selectedRow;
        ctx.fillRect(x - 24, y - (height - GLYPH) / 2, width + 48, height);
        drawText(ctx, "▶", x - 22, y, SCALE, COLORS.highlight);
      }
      drawText(ctx, item.label, x, y, SCALE, isSelected ? COLORS.text : COLORS.dimText);
    });

    const hint = this.items[this.selected]?.hint;
    if (hint) {
      drawTextCentered(ctx, hint, CANVAS_W / 2, CANVAS_H - 46, SCALE, COLORS.dimText);
    }
    if (blinkTimer < 30) {
      drawTextCentered(ctx, "PIJLTJES EN ENTER", CANVAS_W / 2, CANVAS_H - 24, SCALE, COLORS.faintText);
    }
  }
}
