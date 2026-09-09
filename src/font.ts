import { GLYPHS } from "./font-glyphs";

const GLYPH_SIZE = 16;

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string
): void {
  ctx.fillStyle = color;
  const chars = text.toUpperCase();
  for (let i = 0; i < chars.length; i++) {
    const glyph = GLYPHS[chars[i]];
    if (!glyph) {
      continue;
    }
    for (let row = 0; row < GLYPH_SIZE; row++) {
      const line = glyph[row];
      for (let col = 0; col < GLYPH_SIZE; col++) {
        if (line[col] === "1") {
          ctx.fillRect(
            Math.round(x + i * GLYPH_SIZE * scale + col * scale),
            Math.round(y + row * scale),
            scale,
            scale
          );
        }
      }
    }
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
