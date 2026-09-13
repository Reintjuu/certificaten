// A small NES-shaped synth. The APU had two pulse channels, a triangle and a
// noise generator, and everything the console ever said came out of those; the
// effects here are written in the same terms.
//
// The tunes and jingles in the ROM are Nintendo's composition, so none of them
// are reproduced. What is borrowed is the machine: the same four voices, the
// same hard envelopes, the same lack of anything in between. The effects below
// are written for this game, the way the sprites were drawn for it.
import { SoundEvent } from "./sound-events";

/** Duty cycles the NES pulse channels could be set to. */
const DUTY = { eighth: 0.125, quarter: 0.25, half: 0.5 } as const;
type Duty = keyof typeof DUTY;

type Note = {
  /** Hertz, or a sweep from the first to the second. */
  pitch: number | [number, number];
  /** Seconds. */
  length: number;
  voice: "pulse" | "triangle" | "noise";
  duty?: Duty;
  gain?: number;
  /** Seconds to wait after the previous note started. */
  at?: number;
};

const EFFECTS: Record<SoundEvent, Note[]> = {
  [SoundEvent.Jump]: [{ pitch: [220, 660], length: 0.16, voice: "pulse", duty: "half" }],
  [SoundEvent.Stomp]: [
    { pitch: [520, 120], length: 0.12, voice: "pulse", duty: "eighth" },
    { pitch: 0, length: 0.07, voice: "noise", gain: 0.5, at: 0 },
  ],
  [SoundEvent.Grow]: [
    { pitch: 392, length: 0.07, voice: "pulse", duty: "quarter" },
    { pitch: 523, length: 0.07, voice: "pulse", duty: "quarter", at: 0.07 },
    { pitch: 659, length: 0.07, voice: "pulse", duty: "quarter", at: 0.14 },
    { pitch: 784, length: 0.12, voice: "pulse", duty: "quarter", at: 0.21 },
  ],
  [SoundEvent.Shrink]: [
    { pitch: 659, length: 0.07, voice: "pulse", duty: "eighth" },
    { pitch: 440, length: 0.07, voice: "pulse", duty: "eighth", at: 0.07 },
    { pitch: 294, length: 0.14, voice: "pulse", duty: "eighth", at: 0.14 },
  ],
  [SoundEvent.Die]: [
    { pitch: 330, length: 0.12, voice: "pulse", duty: "half" },
    { pitch: 247, length: 0.12, voice: "pulse", duty: "half", at: 0.14 },
    { pitch: [196, 62], length: 0.5, voice: "pulse", duty: "half", at: 0.28 },
  ],
  [SoundEvent.Certificate]: [
    { pitch: 523, length: 0.1, voice: "pulse", duty: "quarter" },
    { pitch: 659, length: 0.1, voice: "pulse", duty: "quarter", at: 0.1 },
    { pitch: 784, length: 0.1, voice: "pulse", duty: "quarter", at: 0.2 },
    { pitch: 1047, length: 0.28, voice: "pulse", duty: "quarter", at: 0.3 },
    { pitch: 262, length: 0.38, voice: "triangle", gain: 0.5, at: 0.3 },
  ],
  [SoundEvent.Talk]: [{ pitch: 880, length: 0.03, voice: "pulse", duty: "eighth", gain: 0.3 }],
  [SoundEvent.Start]: [
    { pitch: 392, length: 0.09, voice: "pulse", duty: "half" },
    { pitch: 523, length: 0.09, voice: "pulse", duty: "half", at: 0.1 },
    { pitch: 784, length: 0.18, voice: "pulse", duty: "half", at: 0.2 },
  ],
};

const MASTER_GAIN = 0.18;
/** Rise and fall of a note, short enough to keep the hard NES edge. */
const ATTACK = 0.005;
const RELEASE = 0.02;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const waves = new Map<Duty, PeriodicWave>();
let muted = false;

/**
 * A square wave of a given duty, built from its Fourier series. The browser
 * only offers a 50% square, and the narrower duties are most of what makes a
 * pulse channel sound like one.
 */
function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const harmonics = 24;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Browsers refuse to start audio before the page has been interacted with, so
 * the context is built on the first key or click rather than at load.
 */
function wake(): AudioContext | null {
  if (context === null) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
    noiseBuffer = makeNoise(context);
    for (const [name, duty] of Object.entries(DUTY)) {
      waves.set(name as Duty, pulseWave(context, duty));
    }
  }
  if (context.state === "suspended") {
    void context.resume();
  }
  return context;
}

function playNote(ctx: AudioContext, out: GainNode, note: Note, start: number): void {
  const envelope = ctx.createGain();
  const peak = note.gain ?? 1;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(peak, start + ATTACK);
  envelope.gain.setValueAtTime(peak, start + note.length - RELEASE);
  envelope.gain.linearRampToValueAtTime(0, start + note.length);
  envelope.connect(out);

  if (note.voice === "noise") {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.connect(envelope);
    source.start(start);
    source.stop(start + note.length);
    return;
  }

  const oscillator = ctx.createOscillator();
  if (note.voice === "triangle") {
    oscillator.type = "triangle";
  } else {
    const wave = waves.get(note.duty ?? "half");
    if (wave === undefined) {
      oscillator.type = "square";
    } else {
      oscillator.setPeriodicWave(wave);
    }
  }

  if (Array.isArray(note.pitch)) {
    oscillator.frequency.setValueAtTime(note.pitch[0], start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, note.pitch[1]), start + note.length);
  } else {
    oscillator.frequency.setValueAtTime(note.pitch, start);
  }
  oscillator.connect(envelope);
  oscillator.start(start);
  oscillator.stop(start + note.length);
}

export function play(event: SoundEvent): void {
  if (muted) {
    return;
  }
  const ctx = wake();
  if (ctx === null || master === null) {
    return;
  }
  const now = ctx.currentTime;
  for (const note of EFFECTS[event]) {
    playNote(ctx, master, note, now + (note.at ?? 0));
  }
}

/** Call from the first key or click, so the context is allowed to start. */
export function unlockSound(): void {
  wake();
}

export function toggleMuted(): boolean {
  muted = !muted;
  return muted;
}

export function isMuted(): boolean {
  return muted;
}
