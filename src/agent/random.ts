/**
 * A seeded pseudo-random generator (mulberry32), so a training run can be
 * repeated exactly. With Math.random the same command produced a different
 * agent every time: one run of level 1 finished with six solvers, the next
 * with none, and the recording committed to the repo was whatever the last
 * run happened to yield.
 */
export type Random = () => number;

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
