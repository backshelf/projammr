/// <reference types="audioworklet" />
/**
 * The audio thread's DSP processor, registered under {@link DSP_PROCESSOR}.
 * Built to `public/dsp-processor.js` by `bun run build:worklet` (a step
 * `dev` and `build` both run first); the built file is gitignored, served
 * with the same no-cache headers as `sw.js`, and loaded with
 * `audioWorklet.addModule("/dsp-processor.js?v=" + ABI_VERSION)` — see
 * `attachMeters` in `player-engine.ts` and `lab-engine.ts`. The main thread
 * compiles `dsp.wasm` once through `@workspace/dsp/host/browser` and hands
 * the `Module` to every node's `processorOptions`;
 * `@workspace/dsp/host/worklet` instantiates a fresh, independent instance
 * inside each node's constructor.
 *
 * This module extends the global `AudioWorkletProcessor`, which exists only
 * inside the audio thread's global scope — nothing on the main thread may
 * import it, even for a single constant; `processor-protocol.ts` is what
 * the main thread and its tests import instead.
 *
 * Two roles, chosen by `processorOptions.role`:
 *
 * - `"meter"`: one live `Analysis` session pair on the node's own input,
 *   posting `loudness` and `spectrum` frames. One node per tap.
 * - `"player"`: the Lab's decoded-buffer player. It holds up to two sources
 *   in module memory, each with its own `Chain`, fills its stereo output
 *   from both chains at their routed gains, and meters what it plays and,
 *   during a comparison, each source before its chain.
 */

import { Chain, CHAIN_QUANTUM } from "@workspace/dsp/chain";
import {
  createLiveLoudnessMeter,
  createLiveSpectrumMeter,
} from "@workspace/dsp/live";
import {
  Block,
  Meter,
  Param,
  TimeMode,
  type BlockId,
  type ParamId,
} from "@workspace/dsp/params";
import type { Dsp } from "@workspace/dsp/runtime";
import { loadDsp } from "@workspace/dsp/host/worklet";
import {
  DSP_PROCESSOR,
  type DspProcessorOptions,
  type MeterMessage,
  type PlayerCommand,
  type PlayerMessage,
  type PlayerSide,
  type PlayerSlot,
  ROUTE_RAMP_SECONDS,
  type SourceSlot,
} from "@/lib/dsp/processor-protocol";

/**
 * Meters the node's own input: channel count is read from the render
 * quantum, not assumed, so the same processor serves a mono or a stereo tap
 * without the main thread having to know which before the source is
 * connected. A `MediaElementAudioSourceNode`'s channel count tracks its
 * media, so this rebuilds both sessions whenever the quantum's channel count
 * changes underneath it — a track switching between mono and stereo, or a
 * source that starts without a `src` and gets one later — rather than
 * metering every later quantum as whatever shape the first one happened to
 * be.
 */
class MeterRole {
  readonly #dsp: ReturnType<typeof loadDsp>;
  #loudness: ReturnType<typeof createLiveLoudnessMeter> | null = null;
  #spectrum: ReturnType<typeof createLiveSpectrumMeter> | null = null;
  #channels = 0;

  constructor(module: WebAssembly.Module) {
    this.#dsp = loadDsp({ processorOptions: { module } });
  }

  process(input: Float32Array[], post: (message: MeterMessage) => void) {
    if (input.length === 0) return;
    if (!this.#loudness || !this.#spectrum || input.length !== this.#channels) {
      this.#loudness?.free();
      this.#spectrum?.free();
      this.#channels = input.length;
      this.#loudness = createLiveLoudnessMeter(
        this.#dsp,
        sampleRate,
        this.#channels
      );
      this.#spectrum = createLiveSpectrumMeter(
        this.#dsp,
        sampleRate,
        this.#channels
      );
    }
    this.#loudness.process(input);
    this.#spectrum.process(input);
    const frame = this.#loudness.take();
    if (frame) post({ type: "loudness", frame });
    const db = this.#spectrum.take();
    if (db) post({ type: "spectrum", db });
  }
}

const STEREO = 2;
const BYTES_PER_FRAME = STEREO * Float32Array.BYTES_PER_ELEMENT;
/** How often a playing node reports its position. */
const POSITION_SECONDS = 0.05;
/** How often a running compressor reports its gain reduction. */
const GAIN_REDUCTION_SECONDS = 0.01;
/**
 * Frames of lead-in a chain is offered in one call while a source placed
 * before its own start plays it: silence up to the source's start, then the
 * source itself. More than the time stretcher's input capacity, so it never
 * pads a call short of what it reads, which would shift the source late.
 */
const LEAD_FRAMES = CHAIN_QUANTUM * 64;

type LiveMeters = {
  loudness: ReturnType<typeof createLiveLoudnessMeter>;
  spectrum: ReturnType<typeof createLiveSpectrumMeter>;
};

/** One decoded source in module memory, interleaved stereo, and its chain. */
type Source = {
  ptr: number;
  bytes: number;
  frames: number;
  chain: Chain;
  /** The next source frame the chain reads; negative before the source starts. */
  read: number;
  /** Output frames rendered since the source ran out, so the tail plays out. */
  tail: number;
};

/**
 * A linear gain ramp stepped once per output frame: `set` moves it to a new
 * target over a fixed number of frames from wherever it is, after holding
 * where it is for `after` frames.
 */
class GainRamp {
  #value: number;
  #target: number;
  #step = 0;
  #hold = 0;

  constructor(value: number) {
    this.#value = value;
    this.#target = value;
  }

  set(target: number, frames: number, after = 0) {
    this.#target = target;
    this.#hold = after;
    this.#step = frames > 0 ? (target - this.#value) / frames : 0;
    if (this.#step === 0 && after === 0) this.#value = target;
  }

  /** Whether the ramp has come to rest at silence. */
  get silent(): boolean {
    return this.#value === 0 && this.#target === 0;
  }

  /** The gain for the next frame. */
  next(): number {
    if (this.#hold > 0) {
      this.#hold -= 1;
      return this.#value;
    }
    if (this.#step === 0) this.#value = this.#target;
    if (this.#value === this.#target) return this.#value;
    const moved = this.#value + this.#step;
    const passed =
      this.#step > 0 ? moved >= this.#target : moved <= this.#target;
    this.#value = passed ? this.#target : moved;
    return this.#value;
  }
}

/**
 * The Lab's player. Sources are copied once into `dsp_alloc`'d memory and
 * pulled through their chain (`chain_process` reads as many frames as the
 * speed needs and reports how many), so the read position only ever moves
 * by what the chain consumed. Parameters are remembered and replayed onto a
 * chain a later `load` creates, so a source swapped in mid-session sounds
 * like the one it replaced.
 *
 * With a comparison's second source loaded, both chains run every quantum,
 * so the silent one stays warm and in step, and the output is each chain's
 * output times its own ramped gain.
 *
 * A crossfade mixes the same way: the incoming source, loaded ahead into
 * `"next"` and never read there, becomes `"a"` and plays from its start
 * through its own chain, and the outgoing one plays on as `"b"` through its
 * own, each chain run once and their outputs summed at their ramped gains,
 * so nothing is processed twice. The outgoing chain is left as it was heard
 * — parameters sent during the overlap reach the incoming one alone — and
 * is dropped once its gain comes to rest at silence or its source runs out.
 */
class PlayerRole {
  readonly #dsp: Dsp;
  readonly #sources: Record<SourceSlot, Source | null> = {
    a: null,
    b: null,
    next: null,
  };
  /** Whether `"b"` is a crossfade's outgoing source rather than a comparison's. */
  #tail = false;
  readonly #params = new Map<ParamId, number>();
  readonly #bypass = new Map<BlockId, boolean>();
  readonly #gains: Record<PlayerSlot, GainRamp> = {
    a: new GainRamp(1),
    b: new GainRamp(0),
  };
  #active: PlayerSlot = "a";
  /** Source frames `"b"` sits ahead of `"a"`. */
  #offset = 0;
  #curve: number[] | null = null;
  #playing = false;
  #seq = 0;
  #sincePosition = 0;
  #sinceGainReduction = 0;
  readonly #mix: LiveMeters;
  /** Each source's pre-chain meters, opened with the first comparison. */
  #pre: Record<PlayerSlot, LiveMeters> | null = null;
  /** Interleaved frames in module memory a lead-in is assembled in. */
  readonly #lead: number;
  /** Each chain's output, copied out of module memory before the next call into it. */
  readonly #rendered: Record<PlayerSlot, Float32Array> = {
    a: new Float32Array(CHAIN_QUANTUM * STEREO),
    b: new Float32Array(CHAIN_QUANTUM * STEREO),
  };
  /** Planar scratch for a pre-chain reading, grown to the largest read. */
  #planar: [Float32Array, Float32Array] = [
    new Float32Array(CHAIN_QUANTUM),
    new Float32Array(CHAIN_QUANTUM),
  ];

  constructor(module: WebAssembly.Module) {
    this.#dsp = loadDsp({ processorOptions: { module } });
    this.#mix = this.#meters();
    this.#lead =
      this.#dsp.exports.dsp_alloc(LEAD_FRAMES * BYTES_PER_FRAME) >>> 0;
  }

  #meters(): LiveMeters {
    return {
      loudness: createLiveLoudnessMeter(this.#dsp, sampleRate, STEREO),
      spectrum: createLiveSpectrumMeter(this.#dsp, sampleRate, STEREO),
    };
  }

  command(command: PlayerCommand, post: (message: PlayerMessage) => void) {
    switch (command.type) {
      case "load":
        return this.#load(command.slot, command.channels, post);
      case "unload":
        return this.#unload(command.slot);
      case "play": {
        const source = this.#sources.a;
        if (!source) return;
        // As an ended media element does, playing again starts over.
        if (source.read >= source.frames) this.#seek(0);
        this.#playing = true;
        this.#sincePosition = 0;
        return;
      }
      case "pause":
        this.#playing = false;
        return;
      case "seek":
        this.#seq = command.seq;
        return this.#seek(command.seconds);
      case "params":
        for (const [param, value] of command.values) {
          this.#params.set(param, value);
          this.#eachChain((chain) => chain.set(param, value));
        }
        for (const [block, bypassed] of command.bypass) {
          this.#bypass.set(block, bypassed);
          this.#eachChain((chain) => chain.setBypass(block, bypassed));
        }
        return;
      case "curve":
        this.#curve = command.gains;
        this.#eachChain((chain) => chain.setEqCurve(command.gains));
        return;
      case "offset":
        this.#offset = Math.round(command.seconds * sampleRate);
        return this.#placeB();
      case "route": {
        this.#active = command.active;
        const frames = Math.round(ROUTE_RAMP_SECONDS * sampleRate);
        for (const slot of ["a", "b"] as const) {
          this.#gains[slot].set(
            slot === command.active ? command.gains[slot] : 0,
            frames
          );
        }
        return;
      }
      case "promote":
        this.#seq = command.seq;
        return this.#promote();
      case "crossfade":
        this.#seq = command.seq;
        return this.#crossfade(command.seconds);
    }
  }

  /** Every chain a parameter reaches: all but a crossfade's outgoing one. */
  #eachChain(fn: (chain: Chain) => void) {
    for (const [slot, source] of Object.entries(this.#sources)) {
      if (source && !(slot === "b" && this.#tail)) fn(source.chain);
    }
  }

  /** Drops what is left of a crossfade's outgoing source. */
  #dropTail() {
    if (this.#tail) this.#unload("b");
  }

  /**
   * Starts `"next"` from its beginning as `"a"`, fading in over `seconds`,
   * with the playing `"a"` fading out as `"b"` over the same time from the
   * gain it was heard at. The fade-in waits out the incoming chain's own
   * latency, so its first sound rises from silence rather than arriving part
   * way up the ramp; the fade-out starts at once, on sound already heard.
   * Without a source in `"next"`, nothing changes.
   */
  #crossfade(seconds: number) {
    const incoming = this.#sources.next;
    if (!incoming) return;
    this.#sources.next = null;
    this.#unload("b");
    const outgoing = this.#sources.a;
    this.#sources.a = incoming;
    this.#sources.b = outgoing;
    this.#tail = outgoing !== null;
    const frames = Math.round(seconds * sampleRate);
    this.#gains.b = this.#gains.a;
    this.#gains.b.set(0, frames);
    this.#gains.a = new GainRamp(0);
    this.#gains.a.set(1, frames, Math.round(incoming.chain.latency));
    this.#active = "a";
    this.#offset = 0;
    this.#sincePosition = 0;
  }

  #load(
    slot: SourceSlot,
    channels: Float32Array[],
    post: (message: PlayerMessage) => void
  ) {
    if (slot === "a") this.#dropTail();
    this.#unload(slot);
    const frames = channels[0]?.length ?? 0;
    const { exports } = this.#dsp;
    const bytes = Math.max(1, frames) * BYTES_PER_FRAME;
    const ptr = exports.dsp_alloc(bytes) >>> 0;
    if (ptr === 0) {
      post({ type: "failed", slot, reason: "memory" });
      return;
    }
    let chain: Chain;
    try {
      chain = new Chain(this.#dsp, sampleRate, CHAIN_QUANTUM);
    } catch {
      exports.dsp_free(ptr, bytes);
      post({ type: "failed", slot, reason: "memory" });
      return;
    }
    const left = channels[0] ?? new Float32Array(0);
    const right = channels[1] ?? left;
    const memory = new Float32Array(
      exports.memory.buffer,
      ptr,
      frames * STEREO
    );
    for (let i = 0; i < frames; i++) {
      memory[i * STEREO] = left[i]!;
      memory[i * STEREO + 1] = right[i]!;
    }
    for (const [param, value] of this.#params) chain.set(param, value);
    for (const [block, bypassed] of this.#bypass) {
      chain.setBypass(block, bypassed);
    }
    if (this.#curve) chain.setEqCurve(this.#curve);
    this.#sources[slot] = { ptr, bytes, frames, chain, read: 0, tail: 0 };
    if (slot === "b") {
      this.#pre ??= { a: this.#meters(), b: this.#meters() };
      this.#placeB();
    }
    post({ type: "duration", slot, seconds: frames / sampleRate });
  }

  #unload(slot: SourceSlot) {
    if (slot === "b") this.#tail = false;
    const source = this.#sources[slot];
    if (!source) return;
    source.chain.free();
    this.#dsp.exports.dsp_free(source.ptr, source.bytes);
    this.#sources[slot] = null;
    if (slot === "a") this.#playing = false;
  }

  /** `"b"` alone, where it is; the route and the offset go back to one source. */
  #promote() {
    const b = this.#sources.b;
    if (!b) return;
    this.#sources.b = null;
    const playing = this.#playing;
    this.#unload("a");
    this.#sources.a = b;
    this.#playing = playing;
    const gains = this.#gains;
    [gains.a, gains.b] = [gains.b, gains.a];
    this.#active = this.#active === "b" ? "a" : "b";
    this.#offset = 0;
  }

  /** Puts `"b"` at `"a"`'s read position plus the offset. */
  #placeB() {
    const b = this.#sources.b;
    if (!b) return;
    const from = this.#sources.a?.read ?? 0;
    b.read = Math.min(b.frames, from + this.#offset);
    b.tail = 0;
    b.chain.reset();
  }

  #seek(seconds: number) {
    this.#dropTail();
    const a = this.#sources.a;
    if (a) {
      const frame = Math.round(Math.max(0, seconds) * sampleRate);
      a.read = Math.min(a.frames, frame);
      a.tail = 0;
      a.chain.reset();
    }
    this.#placeB();
    this.#sincePosition = 0;
  }

  /** The source frame being heard: the read position less what the chain still holds. */
  #heard(source: Source): number {
    const held = Math.round(source.chain.latency * this.#sourceRate());
    return Math.max(0, Math.min(source.frames, source.read - held));
  }

  /** Source frames the chain reads per output frame: the speed, except in pitch-only mode. */
  #sourceRate(): number {
    if (this.#params.get(Param.TimeMode) === TimeMode.Pitch) return 1;
    return this.#params.get(Param.TimeSpeed) ?? 1;
  }

  /**
   * Writes the lead-in of a source whose read position is before its start
   * into `#lead`: the silence left before the start, then the source from its
   * first frame, as one run. Returns the frames written.
   */
  #leadIn(source: Source): number {
    const silence = Math.min(-source.read, LEAD_FRAMES);
    const head = Math.min(LEAD_FRAMES - silence, source.frames);
    const memory = this.#dsp.exports.memory.buffer;
    const lead = new Float32Array(memory, this.#lead, LEAD_FRAMES * STEREO);
    lead.fill(0, 0, silence * STEREO);
    lead.set(
      new Float32Array(memory, source.ptr, head * STEREO),
      silence * STEREO
    );
    return silence + head;
  }

  /**
   * Runs `slot`'s chain for one quantum into `#rendered[slot]`, through its
   * lead-in while its read position is still before the source's start, and
   * meters what it read while `#pre` is open.
   */
  #render(slot: PlayerSlot, post: (message: PlayerMessage) => void) {
    const source = this.#sources[slot]!;
    const { chain } = source;
    const lead = source.read < 0;
    const input = lead
      ? this.#lead
      : source.ptr + source.read * BYTES_PER_FRAME;
    const available = lead ? this.#leadIn(source) : source.frames - source.read;
    const read = chain.process(input, available);
    this.#rendered[slot].set(chain.output);
    if (this.#pre && this.#sources.b && !this.#tail) {
      this.#meterRead(slot, input, read, post);
    }
    source.read += read;
  }

  /** Meters `frames` interleaved source frames at `ptr`, before the chain. */
  #meterRead(
    slot: PlayerSlot,
    ptr: number,
    frames: number,
    post: (message: PlayerMessage) => void
  ) {
    if (frames <= 0) return;
    if (this.#planar[0].length < frames) {
      this.#planar = [new Float32Array(frames), new Float32Array(frames)];
    }
    const interleaved = new Float32Array(
      this.#dsp.exports.memory.buffer,
      ptr,
      frames * STEREO
    );
    const left = this.#planar[0].subarray(0, frames);
    const right = this.#planar[1].subarray(0, frames);
    for (let i = 0; i < frames; i++) {
      left[i] = interleaved[i * STEREO]!;
      right[i] = interleaved[i * STEREO + 1]!;
    }
    this.#meter(this.#pre![slot], [left, right], slot, post);
  }

  #meter(
    meters: LiveMeters,
    channels: Float32Array[],
    side: PlayerSide,
    post: (message: PlayerMessage) => void
  ) {
    meters.loudness.process(channels);
    meters.spectrum.process(channels);
    const frame = meters.loudness.take();
    if (frame) post({ type: "loudness", side, frame });
    const db = meters.spectrum.take();
    if (db) post({ type: "spectrum", side, db });
  }

  process(output: Float32Array[], post: (message: PlayerMessage) => void) {
    const source = this.#sources.a;
    if (!this.#playing || !source) {
      for (const channel of output) channel.fill(0);
      return;
    }
    const length = output[0]?.length ?? 0;
    const compared = this.#sources.b;
    this.#render("a", post);
    if (compared) this.#render("b", post);

    const a = this.#rendered.a;
    const b = this.#rendered.b;
    const gainA = this.#gains.a;
    const gainB = this.#gains.b;
    const left = output[0];
    const right = output[1] ?? output[0];
    for (let i = 0; i < length; i++) {
      const ga = gainA.next();
      const gb = gainB.next();
      const l = a[i * STEREO]! * ga + (compared ? b[i * STEREO]! * gb : 0);
      const r =
        a[i * STEREO + 1]! * ga + (compared ? b[i * STEREO + 1]! * gb : 0);
      if (left) left[i] = l;
      if (right && right !== left) right[i] = r;
    }

    this.#meter(this.#mix, output, "mix", post);

    if (this.#tail && compared) {
      if (compared.read >= compared.frames) compared.tail += length;
      const played = compared.tail >= compared.chain.latency;
      if (gainB.silent || (compared.read >= compared.frames && played)) {
        this.#unload("b");
      }
    }

    if (this.#bypass.get(Block.Compressor) === false) {
      this.#sinceGainReduction += length;
      if (this.#sinceGainReduction >= GAIN_REDUCTION_SECONDS * sampleRate) {
        this.#sinceGainReduction = 0;
        const heard = (compared && this.#active === "b" ? compared : source)
          .chain;
        post({ type: "gr", db: heard.meter(Meter.GainReductionDb) });
      }
    }

    if (source.read >= source.frames) {
      source.tail += length;
      if (source.tail >= source.chain.latency) {
        this.#playing = false;
        post({
          type: "position",
          frame: source.frames,
          at: currentTime,
          seq: this.#seq,
        });
        post({ type: "pause" });
        post({ type: "ended" });
        return;
      }
    }

    this.#sincePosition += length;
    if (this.#sincePosition >= POSITION_SECONDS * sampleRate) {
      this.#sincePosition = 0;
      post({
        type: "position",
        frame: this.#heard(source),
        at: currentTime,
        seq: this.#seq,
      });
    }
  }
}

/** Reads `processorOptions`, throwing unless it names a known role and carries a compiled module. */
function roleOptions(options: unknown): DspProcessorOptions {
  const opts = options as { role?: unknown; module?: unknown } | undefined;
  const role = opts?.role;
  if (
    (role !== "meter" && role !== "player") ||
    !(opts?.module instanceof WebAssembly.Module)
  ) {
    throw new TypeError(
      `dsp processor: expected { role: "meter" | "player", module: WebAssembly.Module }, got ${JSON.stringify(opts)}`
    );
  }
  return { role, module: opts.module };
}

/** Posts a message, transferring a spectrum frame's buffer rather than copying it. */
function postFrom(port: MessagePort) {
  return (message: MeterMessage | PlayerMessage) => {
    if (message.type === "spectrum") {
      port.postMessage(message, [message.db.buffer]);
    } else {
      port.postMessage(message);
    }
  };
}

class DspProcessor extends AudioWorkletProcessor {
  readonly #meter: MeterRole | null = null;
  readonly #player: PlayerRole | null = null;
  readonly #post = postFrom(this.port);

  constructor(options: { processorOptions?: unknown }) {
    super();
    const { role, module } = roleOptions(options.processorOptions);
    if (role === "meter") {
      this.#meter = new MeterRole(module);
      return;
    }
    const player = new PlayerRole(module);
    this.#player = player;
    this.port.onmessage = (event: MessageEvent<PlayerCommand>) =>
      player.command(event.data, this.#post);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.#player) this.#player.process(outputs[0] ?? [], this.#post);
    else this.#meter?.process(inputs[0] ?? [], this.#post);
    return true;
  }
}

registerProcessor(DSP_PROCESSOR, DspProcessor);
