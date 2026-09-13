// What just happened, worked out by comparing two frames of game state.
//
// The engine stays pure and knows nothing about sound; the shell asks this
// what changed and hands the answer to the synth. Keeping the deciding apart
// from the playing is what makes it testable at all, since a WebAudio context
// is not something a unit test can listen to.
import { BlockState, EnemyState, PHYSICS, isActive, type GameState } from "./engine";

export const SoundEvent = {
  Jump: "jump",
  Stomp: "stomp",
  Grow: "grow",
  Shrink: "shrink",
  Die: "die",
  Certificate: "certificate",
  Talk: "talk",
  Start: "start",
  Stamp: "stamp",
  Bump: "bump",
  Break: "break",
} as const;
export type SoundEvent = (typeof SoundEvent)[keyof typeof SoundEvent];

/** Anything that stopped being a threat: flattened, shelled or knocked away. */
function countDealtWith(state: GameState): number {
  return state.enemies.filter((enemy) => !isActive(enemy)).length;
}

/** Kicking a shell awake, which SMB1 answers with the stomp blip as well. */
function countSliding(state: GameState): number {
  return state.enemies.filter((enemy) => enemy.state === EnemyState.Sliding).length;
}

/** A block only ever goes one way: idle, knocked, and sometimes to rubble. */
function countBroken(state: GameState): number {
  return state.blocks.filter((block) => block.state === BlockState.Broken).length;
}

function countBumped(state: GameState): number {
  return state.blocks.filter((block) => block.bounceTimer === PHYSICS.blockBounceFrames).length;
}

function countTaken(state: GameState): number {
  return state.mushrooms.filter((mushroom) => mushroom.taken).length;
}

/**
 * Everything worth hearing between one frame and the next. Order matters only
 * in that a frame can carry more than one: landing on the last enemy of a
 * level both stomps and, a frame later, finishes.
 */
export function eventsBetween(previous: GameState, next: GameState): SoundEvent[] {
  const events: SoundEvent[] = [];

  // Leaving the ground upwards is a jump; falling off a ledge is not.
  if (previous.player.grounded && !next.player.grounded && next.player.vy < 0) {
    events.push(SoundEvent.Jump);
  }
  if (countDealtWith(next) > countDealtWith(previous)) {
    events.push(SoundEvent.Stomp);
  }
  if (countSliding(next) > countSliding(previous)) {
    events.push(SoundEvent.Stomp);
  }
  if (countTaken(next) > countTaken(previous)) {
    events.push(SoundEvent.Grow);
  }
  if (next.coins > previous.coins) {
    events.push(SoundEvent.Stamp);
  } else if (countBroken(next) > countBroken(previous)) {
    events.push(SoundEvent.Break);
  } else if (countBumped(next) > countBumped(previous)) {
    events.push(SoundEvent.Bump);
  }
  // Losing your size is a hit; gaining it is the mushroom above.
  if (previous.player.big && !next.player.big && next.player.invincibleFramerules > 0) {
    events.push(SoundEvent.Shrink);
  }
  if (previous.phase !== "dead" && next.phase === "dead") {
    events.push(SoundEvent.Die);
  }
  if (next.phase === "dialogue" && next.dialogueKind === "outro" && previous.phase === "playing") {
    events.push(SoundEvent.Certificate);
  }
  if (previous.phase === "title" && next.phase === "dialogue") {
    events.push(SoundEvent.Start);
  }
  if (
    previous.phase === "dialogue" &&
    next.phase === "dialogue" &&
    next.dialogueIndex > previous.dialogueIndex
  ) {
    events.push(SoundEvent.Talk);
  }
  return events;
}
