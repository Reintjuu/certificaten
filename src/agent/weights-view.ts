// The "what is actually saved" screen: every stored number as a cell, laid out
// the way the flat genome is packed. Like the other views here it draws and
// returns the line of text that goes under it, so the console only has to put
// that text where text goes.
import { CANVAS_H, CANVAS_W } from "../engine";
import { COLORS } from "../render";
import { drawTextCentered } from "../font";
import { drawWeightMap } from "./network-view";
import { genomeSize, type Architecture, type Genome } from "./policy";

export type WeightsScene = {
  genome: Genome;
  architecture: Architecture;
  levelIndex: number;
  /** Which recorded generation these weights are, for the caption. */
  generation: number;
  /** Whether the "escape" prompt is on this half of its blink. */
  prompt: boolean;
};

export function drawWeightsScreen(
  ctx: CanvasRenderingContext2D,
  mapCtx: CanvasRenderingContext2D | null,
  scene: WeightsScene
): string {
  const count = genomeSize(scene.architecture);
  const shape = [scene.architecture.inputs, ...scene.architecture.hidden, scene.architecture.outputs].join(
    " x "
  );

  ctx.fillStyle = COLORS.nightSky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTextCentered(ctx, "OPGESLAGEN GEWICHTEN", CANVAS_W / 2, 40, 1, COLORS.highlight);
  drawTextCentered(ctx, `LEVEL ${String(scene.levelIndex + 1)}`, CANVAS_W / 2, 90, 1, COLORS.text);
  drawTextCentered(ctx, `${String(count)} GETALLEN`, CANVAS_W / 2, 130, 1, COLORS.text);
  drawTextCentered(ctx, shape.toUpperCase(), CANVAS_W / 2, 170, 1, COLORS.dimText);
  if (scene.prompt) {
    drawTextCentered(ctx, "ESCAPE VOOR HET MENU", CANVAS_W / 2, 220, 1, COLORS.faintText);
  }

  if (mapCtx !== null) {
    drawWeightMap(mapCtx, scene.genome, scene.architecture);
  }

  return (
    `Elk vakje is een van de ${String(count)} getallen die per generatie worden bewaard: ` +
    `een rij per knoop, een kolom per inkomende waarde, de bias als laatste kolom. ` +
    `Geel is positief, blauw negatief. Dit is generatie ${String(scene.generation)} van level ` +
    `${String(scene.levelIndex + 1)}.`
  );
}
