/**
 * A frame rate readout you can switch on to see what the machine is actually
 * managing, rather than taking anyone's word for it.
 */
const WINDOW_MS = 500;

export type FrameRate = {
  /** Call once per drawn frame. */
  record: () => void;
  /** Frames per second over the last half second, or null until there are enough. */
  readonly perSecond: number | null;
};

export function createFrameRate(): FrameRate {
  const stamps: number[] = [];
  return {
    record(): void {
      const now = performance.now();
      stamps.push(now);
      while (stamps.length > 0 && now - stamps[0] > WINDOW_MS) {
        stamps.shift();
      }
    },
    get perSecond(): number | null {
      if (stamps.length < 2) {
        return null;
      }
      const span = stamps[stamps.length - 1] - stamps[0];
      return span > 0 ? Math.round(((stamps.length - 1) / span) * 1000) : null;
    },
  };
}
