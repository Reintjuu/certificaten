// The chain rule through the network, shared by everything that learns with a
// gradient. What differs between methods is only the error they hand in at the
// output layer; everything behind that is the same walk backwards, and having
// one copy of it is what let a numerical check cover them all.
import { layerSizes, layoutOf, type Architecture, type Genome } from "./policy";

/**
 * Adds one example's contribution to `gradient`.
 *
 * `outputDelta` is dE/d(output sum) for whatever the method is maximising: for
 * a policy gradient that is the score function times the advantage, for a
 * regression it is the residual. `activations` is what forwardPass returned
 * for the same input, inputs first and outputs last.
 */
export function backpropagate(
  gradient: number[],
  genome: Genome,
  activations: number[][],
  outputDelta: number[],
  architecture: Architecture
): void {
  const layers = layoutOf(architecture);
  let delta = outputDelta;

  for (let layer = layers.length - 1; layer >= 0; layer--) {
    const wiring = layers[layer];
    const previous = activations[layer];

    for (let to = 0; to < wiring.to; to++) {
      gradient[wiring.bias(to)] += delta[to];
      for (let from = 0; from < wiring.from; from++) {
        gradient[wiring.weight(to, from)] += delta[to] * previous[from];
      }
    }

    if (layer === 0) {
      break;
    }
    const back = new Array<number>(wiring.from);
    for (let from = 0; from < wiring.from; from++) {
      let sum = 0;
      for (let to = 0; to < wiring.to; to++) {
        sum += delta[to] * genome[wiring.weight(to, from)];
      }
      // previous[from] is tanh of its own sum, so its derivative is 1 - a^2.
      back[from] = sum * (1 - previous[from] * previous[from]);
    }
    delta = back;
  }
}

/** Index of the layer holding the outputs, for reading them back. */
export function outputLayer(architecture: Architecture): number {
  return layerSizes(architecture).length - 1;
}
