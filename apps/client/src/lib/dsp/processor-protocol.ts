/**
 * The DSP processor's registered name, its role options and its message
 * protocol — shared by the worklet (`processor.worklet.ts`, built to
 * `public/dsp-processor.js`) and the main thread (`attachMeters` in
 * `player-engine.ts`, `lab-engine.ts`). Kept apart from the worklet's own
 * implementation because this module is imported from the main thread as
 * ordinary values: `processor.worklet.ts` extends the global
 * `AudioWorkletProcessor`, which exists only inside the audio thread's global
 * scope, so nothing in this file may pull that module in, even for its
 * exported constant.
 */

import type { LoudnessHop } from "@workspace/dsp/analysis";
import type { BlockId, ParamId } from "@workspace/dsp/params";

/** The name every role registers under. */
export const DSP_PROCESSOR = "projammr-dsp";

/** Taps the node's own input for its live loudness and spectrum readouts. */
export type MeterRoleOptions = {
  role: "meter";
  module: WebAssembly.Module;
};

/** The Lab's decoded-buffer player: no input, one stereo output. */
export type PlayerRoleOptions = {
  role: "player";
  module: WebAssembly.Module;
};

export type DspProcessorOptions = MeterRoleOptions | PlayerRoleOptions;

/** What a `"meter"`-role node posts: a loudness frame every 10 ms, a spectrum frame every hop. */
export type MeterMessage =
  | { type: "loudness"; frame: LoudnessHop }
  | { type: "spectrum"; db: Float32Array };

/**
 * A source the player role plays, each with its own chain: `"a"` is what
 * plays, `"b"` the second source of a comparison, or the track a crossfade
 * is fading out.
 */
export type PlayerSlot = "a" | "b";

/**
 * Every source the player role can hold: the two it plays, and `"next"`, a
 * source loaded ahead for a crossfade, which waits silent and unread until
 * the crossfade starts it.
 */
export type SourceSlot = PlayerSlot | "next";

/**
 * What a live meter frame reads: a source before its chain (`"a"`, `"b"`),
 * or `"mix"`, what the player outputs after the chains and their gains.
 */
export type PlayerSide = PlayerSlot | "mix";

/** Seconds a `route` change takes to ramp each chain's output gain, so a swap never clicks. */
export const ROUTE_RAMP_SECONDS = 0.012;

/**
 * Commands the main thread sends a `"player"`-role node. `load`'s `channels`
 * are decoded at the context's own rate and transferred, so the worklet
 * copies them into module memory once and the JS-side buffers are gone.
 * `params` and `bypass` apply to every chain the node holds and to any chain
 * a later `load` creates; values are applied in the order given.
 *
 * A comparison holds a second source in slot `"b"`, which plays in lockstep
 * with `"a"`: `offset` places it `seconds` ahead of `"a"` (the diff's
 * `offsetMs`: positive when `"b"` plays the same material later), `route`
 * ramps each chain's output to `gains[slot]` for the `active` slot and to
 * silence for the other over {@link ROUTE_RAMP_SECONDS}, and `promote` makes
 * `"b"` the only source, at its own position, dropping `"a"`, and stamps
 * later `position` frames with its `seq` as a `seek` does, since the time
 * they report jumps to `"b"`'s. `seek` and `position` always speak in `"a"`'s
 * time.
 *
 * A crossfade holds its incoming source in slot `"next"` until `crossfade`
 * starts it from its own beginning as `"a"`, fading in over `seconds`, while
 * the old `"a"` plays on as `"b"`, fading out over the same `seconds`, and is
 * dropped once silent or run out; `seq` stamps later `position` frames, as
 * the time they report is the new source's. Parameters sent during the
 * overlap reach the new source alone, so the old one fades out as it was
 * heard, and a `seek` or a new `load` into `"a"` drops what is left of it.
 */
export type PlayerCommand =
  | { type: "load"; slot: SourceSlot; channels: Float32Array[] }
  | { type: "unload"; slot: SourceSlot }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; seconds: number; seq: number }
  | {
      type: "params";
      values: [ParamId, number][];
      bypass: [BlockId, boolean][];
    }
  | { type: "curve"; gains: number[] | null }
  | { type: "offset"; seconds: number }
  | {
      type: "route";
      active: PlayerSlot;
      gains: Record<PlayerSlot, number>;
    }
  | { type: "promote"; seq: number }
  | { type: "crossfade"; seconds: number; seq: number };

/**
 * What a `"player"`-role node posts back: `duration` once per `load`, once
 * the source sits in module memory; `failed` when a `load` could not be
 * held; `pause` always ahead of `ended`, as the HTML element orders them;
 * `position` is the heard source frame, about every 50 ms while playing,
 * stamped with the audio thread's `currentTime` and the `seq` of the last
 * `seek` it has seen, so a frame posted before a seek landed can be told
 * apart; `loudness` and `spectrum` read `"mix"` always and each source
 * before its chain while a comparison holds two; `gr` is the compressor's
 * gain reduction in positive dB (0 at rest), every 10 ms while the
 * compressor runs.
 */
export type PlayerMessage =
  | { type: "duration"; slot: SourceSlot; seconds: number }
  | { type: "failed"; slot: SourceSlot; reason: string }
  | { type: "position"; frame: number; at: number; seq: number }
  | { type: "pause" }
  | { type: "ended" }
  | { type: "loudness"; side: PlayerSide; frame: LoudnessHop }
  | { type: "spectrum"; side: PlayerSide; db: Float32Array }
  | { type: "gr"; db: number };
