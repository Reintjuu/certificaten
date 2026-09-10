import { GLYPHS } from "./font-glyphs";

const GLYPH_SIZE = 16;

/**
 * One offscreen strip per colour holding every glyph side by side, so drawing
 * a character is a single blit instead of one fillRect per lit pixel. The HUD
 * alone was 1,953 fillRect calls a frame and the title screen 6,099, which is
 * what made the game stutter on a slow machine.
 *
 * Built on first use rather than at import time: this module is also loaded by
 * the tests, which run in Node and have no document.
 */
type GlyphAtlas = { image: HTMLCanvasElement; columnOf: Map<string, number> };

const atlases = new Map<string, GlyphAtlas>();

function buildAtlas(color: string): GlyphAtlas {
  const entries = Object.entries(GLYPHS);
  const image = document.createElement("canvas");
  image.width = entries.length * GLYPH_SIZE;
  image.height = GLYPH_SIZE;

  const ctx = image.getContext("2d")!;
  ctx.fillStyle = color;
  const columnOf = new Map<string, number>();

  entries.forEach(([char, glyph], index) => {
    if (glyph === undefined) {
      return;
    }
    const left = index * GLYPH_SIZE;
    columnOf.set(char, left);
    for (let row = 0; row < GLYPH_SIZE; row++) {
      const line = glyph[row];
      for (let col = 0; col < GLYPH_SIZE; col++) {
        if (line[col] === "1") {
          ctx.fillRect(left + col, row, 1, 1);
        }
      }
    }
  });

  return { image, columnOf };
}

function atlasFor(color: string): GlyphAtlas {
  const existing = atlases.get(color);
  if (existing !== undefined) {
    return existing;
  }
  const atlas = buildAtlas(color);
  atlases.set(color, atlas);
  return atlas;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string
): void {
  const { image, columnOf } = atlasFor(color);
  const size = GLYPH_SIZE * scale;
  // Rounding the glyph's origin rather than each of its pixels lands on the
  // same pixels, because Math.round(x + n) is Math.round(x) + n for whole n.
  const left = Math.round(x);
  const top = Math.round(y);
  const chars = text.toUpperCase();

  for (let i = 0; i < chars.length; i++) {
    const column = columnOf.get(chars[i]);
    if (column === undefined) {
      continue;
    }
    ctx.drawImage(image, column, 0, GLYPH_SIZE, GLYPH_SIZE, left + i * size, top, size, size);
  }
}

export function textWidth(text: string, scale: number): number {
  return text.length * GLYPH_SIZE * scale;
}

export function drawTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  scale: number,
  color: string
): void {
  drawText(ctx, text, centerX - textWidth(text, scale) / 2, y, scale, color);
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}
