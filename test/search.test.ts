import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVELS, NO_INPUT, PHYSICS } from "../src/engine";
import { replay, searchLevel } from "../src/agent/search";
import { decodeInput, encodeInput, routeFor } from "../src/agent/routes";
import { MOVES, playMove } from "../src/agent/moves";
import { createPlayingState } from "../src/engine";
import { finishRun } from "../src/agent/run";
import { DEFAULT_ARCHITECTURE } from "../src/agent/policy";
import type { TrainingHistory } from "../src/agent/evolution";

describe("searching instead of learning", () => {
  const found = LEVELS.map((_, index) => searchLevel(index));

  for (const [index, result] of found.entries()) {
    test(`level ${index + 1}: the search finds a way through`, () => {
      assert.equal(result.solved, true, `no route found in ${result.expanded} expansions`);
    });
  }

  test("it is no slower than the agent that had to be trained", () => {
    // The point of having it: the engine is deterministic and open, so a
    // search reads the answer straight off the model where evolution has to
    // find it by playing 27 million frames.
    const history = JSON.parse(
      readFileSync(new URL("../src/agent/training-history.json", import.meta.url), "utf8")
    ) as TrainingHistory;

    for (const [index, result] of found.entries()) {
      const level = history.levels[index];
      const trained = finishRun(level.generations[level.bestGeneration].genome, index, DEFAULT_ARCHITECTURE);
      assert.ok(
        result.frames <= trained.frames,
        `level ${index + 1}: the search took ${result.frames} frames against the agent's ${trained.frames}`
      );
    }
  });

  test("what it hands back is a run, not a plan", () => {
    // The inputs are replayed through the engine before they are returned, so
    // a route that only works in the search's head cannot get out of it.
    for (const [index, result] of found.entries()) {
      assert.equal(result.inputs.length, result.frames, `level ${index + 1} returned a ragged input list`);
    }
  });

  test("the estimate never asks for more frames than the route it found takes", () => {
    // Admissibility is the whole basis for calling the first solution the
    // fastest one, so it is worth checking rather than asserting in a comment.
    for (const [index, result] of found.entries()) {
      const certificate = LEVELS[index].certificate;
      const start = createPlayingState(index).player;
      const gap = Math.max(0, certificate.x - (start.x + start.w));
      const climb = Math.max(0, start.y - (certificate.y + certificate.h));
      const fastestRise = Math.max(...PHYSICS.jumpVelocity.map(Math.abs));
      const estimate = Math.max(gap / PHYSICS.maxRunSpeed, climb / fastestRise);
      assert.ok(
        estimate <= result.frames,
        `level ${index + 1}: estimated ${estimate.toFixed(0)} frames for a route that took ${result.frames}`
      );
    }
  });
});

describe("what one move is", () => {
  test("a hop ends the moment it lands again", () => {
    // Walk first: a freshly created player is not grounded yet, and jumping
    // needs Player_State == 0, so a jump on the very first frame is lost.
    const state = playMove(createPlayingState(0), { direction: 1, hold: 0 }).state;
    const hop = playMove(state, { direction: 1, hold: 20 });

    assert.ok(hop.inputs.length > 20, "it sees the jump through rather than stopping when the button does");
    assert.equal(hop.state.player.grounded, true, "and it ends on the floor, ready for the next decision");
  });

  test("every move commits to something", () => {
    const state = createPlayingState(0);
    for (const move of MOVES) {
      assert.ok(
        playMove(state, move).inputs.length > 0,
        `${move.direction}/${move.hold} does nothing at all`
      );
    }
  });
});

describe("the route the replay draws", () => {
  const stored = JSON.parse(readFileSync(new URL("../src/agent/routes.json", import.meta.url), "utf8")) as {
    routes: { level: number; frames: number; inputs: number[] }[];
  };

  test("there is one per level", () => {
    assert.deepEqual(
      stored.routes.map((route) => route.level),
      LEVELS.map((_, index) => index)
    );
  });

  for (const route of stored.routes) {
    test(`level ${route.level + 1}: the stored route still finishes it`, () => {
      // The file is generated, so like the trained genomes it can go stale the
      // moment the physics or the level data move. Replaying it is what says
      // so, rather than a comment asking you to remember.
      const played = replay(routeFor(route.level) ?? [], route.level);
      assert.equal(played.solved, true, "the stored route no longer reaches the certificate");
      assert.equal(played.frames, route.frames, "it no longer takes the number of frames stored with it");
    });
  }

  test("a frame of buttons survives the trip through the file", () => {
    const held = { ...NO_INPUT, left: true, jumpHeld: true, jumpPressed: true, run: true };
    assert.deepEqual(decodeInput(encodeInput(held)), held);
    assert.deepEqual(decodeInput(encodeInput(NO_INPUT)), NO_INPUT);
  });
});
