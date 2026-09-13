// The furniture the console needs around the game canvas: the status line, the
// chart, the network picture, the generation buttons and the row that retrains
// with a different shape.
//
// It builds the page and hands back the handles, and everything it can do is a
// callback it was given. Nothing in here knows what a genome or a generation
// is, which is why it can be read on its own.
import { type Method, type TrainingMethod } from "./methods";

export const CAPTIONS = {
  network: "Het netwerk: links wat het ziet, rechts wat het besluit.",
  weights: "De opgeslagen gewichten, per laag: een rij per knoop, de bias als laatste kolom.",
  archive: "Het archief: een vakje per soort gedrag, met de beste agent die zich zo gedroeg.",
  chart: "Fitness per generatie (★ = beste). Escape brengt je terug.",
} as const;

export type Chrome = {
  status: HTMLDivElement;
  generations: HTMLDivElement;
  chartCtx: CanvasRenderingContext2D;
  networkCanvas: HTMLCanvasElement;
  networkCtx: CanvasRenderingContext2D | null;
  setCaption: (text: string) => void;
};

export type ChromeOptions = {
  container: HTMLElement;
  methods: Record<Method, TrainingMethod>;
  /** What the hidden-layer box starts out saying. */
  hidden: readonly number[];
  /** A click in the network picture, in that canvas's own coordinates. */
  onNetworkClick: (x: number, y: number) => void;
  onTrain: (hidden: number[], method: string) => void;
  /** What to say when the hidden-layer box does not read as a list of sizes. */
  onBadLayers: (text: string) => void;
};

function buildCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  element.id = id;
  return element;
}

function buildCaption(text: string): HTMLElement {
  const caption = document.createElement("h2");
  caption.textContent = text;
  return caption;
}

/** "8" or "12,6". Anything else is refused rather than half understood. */
export function parseHiddenLayers(text: string): number[] | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return [];
  }
  const parts = trimmed.split(",").map((part) => Number(part.trim()));
  const valid = parts.every((size) => Number.isInteger(size) && size > 0 && size <= 64);
  return valid ? parts : null;
}

/** Lets you retrain with a different shape without leaving the page. */
function buildArchitectureRow(options: ChromeOptions): HTMLElement {
  const row = document.createElement("div");
  row.id = "architecture";

  const label = document.createElement("label");
  label.textContent = "verborgen lagen ";
  const input = document.createElement("input");
  input.id = "hidden-layers";
  input.value = options.hidden.join(",");
  input.size = 10;
  label.append(input);

  const methodLabel = document.createElement("label");
  methodLabel.textContent = " leren met ";
  const methodSelect = document.createElement("select");
  methodSelect.id = "method";
  for (const [value, entry] of Object.entries(options.methods)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = entry.label;
    methodSelect.append(option);
  }
  methodLabel.append(methodSelect);

  const train = document.createElement("button");
  train.textContent = "train met deze vorm";
  train.onclick = () => {
    const hidden = parseHiddenLayers(input.value);
    if (hidden === null) {
      options.onBadLayers(input.value);
      return;
    }
    options.onTrain(hidden, methodSelect.value);
  };

  row.append(label, methodLabel, train);
  return row;
}

export function buildChrome(options: ChromeOptions): Chrome {
  const status = document.createElement("div");
  status.id = "status";

  const chartCanvas = buildCanvas("chart", 960, 180);
  const networkCanvas = buildCanvas("network", 960, 380);
  const networkCtx = networkCanvas.getContext("2d");
  networkCanvas.onclick = (event) => {
    // Canvas coordinates from a click, whatever the element is scaled to.
    const bounds = networkCanvas.getBoundingClientRect();
    options.onNetworkClick(
      (event.clientX - bounds.left) * (networkCanvas.width / bounds.width),
      (event.clientY - bounds.top) * (networkCanvas.height / bounds.height)
    );
  };

  const generations = document.createElement("div");
  generations.id = "generations";
  const caption = buildCaption(CAPTIONS.network);

  // The training controls sit directly under the game rather than at the very
  // bottom of the page, where the method dropdown was easy to miss entirely.
  options.container.replaceChildren(
    status,
    buildArchitectureRow(options),
    buildCaption(CAPTIONS.chart),
    chartCanvas,
    generations,
    caption,
    networkCanvas
  );
  options.container.hidden = false;

  return {
    status,
    generations,
    chartCtx: chartCanvas.getContext("2d")!,
    networkCanvas,
    networkCtx,
    setCaption: (text: string) => {
      caption.textContent = text;
    },
  };
}
