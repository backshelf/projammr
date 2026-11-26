import { afterAll, describe, expect, it } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { dspModuleUrl } from "@workspace/dsp/host/browser";
import { SPECTRUM_LAYOUT } from "@workspace/dsp/spectrum";
import { Block, Param } from "@workspace/dsp/params";
import {
  DSP_PROCESSOR,
  type MeterMessage,
  type PlayerCommand,
  type PlayerMessage,
} from "./processor-protocol";

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

type ProcessorInstance = {
  port: {
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
    onmessage?: ((event: MessageEvent) => void) | null;
  };
  process: (inputs: Float32Array[][], outputs?: Float32Array[][]) => boolean;
};

type ProcessorCtor = new (options: {
  processorOptions?: unknown;
}) => ProcessorInstance;

/**
 * `registerProcessor` runs as the module's own import-time side effect, on
 * the audio thread's global scope — these three globals stand in for it, the
 * way `AudioWorkletProcessor`, `registerProcessor` and `sampleRate` exist
 * only there.
 */
let registered: { name: string; ctor: ProcessorCtor } | null = null;

class FakeAudioWorkletProcessor {
  port: ProcessorInstance["port"] = { postMessage: () => {} };
}

stubGlobal("sampleRate", SAMPLE_RATE);
stubGlobal("currentTime", 0);
stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
stubGlobal("registerProcessor", (name: string, ctor: ProcessorCtor) => {
  registered = { name, ctor };
});

await import("./processor.worklet");

afterAll(() => unstubAllGlobals());

async function compiledModule(): Promise<WebAssembly.Module> {
  return new WebAssembly.Module(await Bun.file(dspModuleUrl).bytes());
}

async function meterNode(): Promise<ProcessorInstance> {
  const wasmModule = await compiledModule();
  return new registered!.ctor({
    processorOptions: { role: "meter", module: wasmModule },
  });
}

describe("DspProcessor", () => {
  it("registers under DSP_PROCESSOR", () => {
    expect(registered?.name).toBe(DSP_PROCESSOR);
  });

  it("posts a loudness frame per hop and a spectrum frame per window, identically on two independent nodes", async () => {
    const a = await meterNode();
    const b = await meterNode();
    const postedA: MeterMessage[] = [];
    const postedB: MeterMessage[] = [];
    a.port.postMessage = (message) => postedA.push(message as MeterMessage);
    b.port.postMessage = (message) => postedB.push(message as MeterMessage);

    // A full spectrum window plus a few extra render quanta, so both meters
    // close at least one hop and one spectrum window.
    const length = SPECTRUM_LAYOUT.fftSize + QUANTUM * 4;
    const channel = Float32Array.from({ length }, (_, i) =>
      Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE)
    );

    for (let offset = 0; offset < length; offset += QUANTUM) {
      const quantum = channel.subarray(offset, offset + QUANTUM);
      expect(a.process([[quantum, quantum]])).toBe(true);
      expect(b.process([[quantum, quantum]])).toBe(true);
    }

    // Two taps fed the same signal through their own session are the same
    // reading, which is what "one session per node" promises: neither leaks
    // state into the other.
    expect(postedA).toEqual(postedB);

    const loudness = postedA.filter((message) => message.type === "loudness");
    const spectrum = postedA.filter((message) => message.type === "spectrum");
    expect(loudness.length).toBeGreaterThan(0);
    expect(spectrum.length).toBeGreaterThan(0);
    expect((spectrum[0] as { db: Float32Array }).db.length).toBe(
      SPECTRUM_LAYOUT.bands
    );
  });

  it("re-meters at the new channel count when the tap goes from mono to stereo", async () => {
    // A `MediaElementAudioSourceNode` reports as many channels as its media
    // does, so a source without a `src` yet (mono, per the spec's default)
    // that later gets a stereo one changes shape mid-stream. Fixing the
    // sessions to whatever the first quantum's channel count was would meter
    // every later stereo hop as mono — reading only the left plane, so a
    // stereo signal comes out roughly 3 dB quiet — instead of rebuilding
    // for the shape actually arriving.
    const node = await meterNode();
    const posted: MeterMessage[] = [];
    node.port.postMessage = (message) => posted.push(message as MeterMessage);

    node.process([[new Float32Array(QUANTUM)]]);

    const length = QUANTUM * 60;
    const channel = Float32Array.from(
      { length },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)
    );
    for (let offset = 0; offset < length; offset += QUANTUM) {
      const quantum = channel.subarray(offset, offset + QUANTUM);
      node.process([[quantum, quantum]]);
    }

    const loudness = posted.filter((message) => message.type === "loudness");
    const last = loudness.at(-1) as { frame: { momentary: number } };
    // A 0.5-amplitude 1 kHz sine on both stereo channels: -6.02 LUFS.
    // Left-plane-only mono metering of the same signal reads roughly -9 LUFS.
    expect(Math.abs(last.frame.momentary - -6.02)).toBeLessThanOrEqual(0.1);
  });

  it("posts nothing for a silent input with no channels", async () => {
    const node = await meterNode();
    const posted: unknown[] = [];
    node.port.postMessage = (message) => posted.push(message);

    expect(node.process([])).toBe(true);
    expect(posted).toHaveLength(0);
  });

  it("rejects options with no compiled module", () => {
    expect(
      () => new registered!.ctor({ processorOptions: { role: "meter" } })
    ).toThrow(TypeError);
    expect(() => new registered!.ctor({})).toThrow(TypeError);
    expect(
      () =>
        new registered!.ctor({
          processorOptions: { role: "meter", module: "not-a-module" },
        })
    ).toThrow(TypeError);
  });
  it("rejects an unknown role", async () => {
    const wasmModule = await compiledModule();
    expect(
      () =>
        new registered!.ctor({
          processorOptions: { role: "mixer", module: wasmModule },
        })
    ).toThrow(TypeError);
  });
});

/** A `"player"`-role node, its commands sent as the main thread's port would send them. */
async function playerNode() {
  const node = new registered!.ctor({
    processorOptions: { role: "player", module: await compiledModule() },
  });
  const posted: PlayerMessage[] = [];
  node.port.postMessage = (message) => posted.push(message as PlayerMessage);
  const send = (command: PlayerCommand) =>
    node.port.onmessage!({ data: command } as MessageEvent);
  const render = (quanta: number) => {
    const out: Float32Array[] = [];
    for (let q = 0; q < quanta; q++) {
      const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
      node.process([], [output]);
      out.push(...output);
    }
    return out;
  };
  return { posted, send, render };
}

/** A mono sine of `seconds` at 0.5 amplitude. */
function sine(seconds: number): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * SAMPLE_RATE) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  );
}

const quantaFor = (seconds: number) =>
  Math.ceil((seconds * SAMPLE_RATE) / QUANTUM);

describe("DspProcessor player role", () => {
  it("reports the source's duration once it holds a load", async () => {
    const { posted, send } = await playerNode();

    send({ type: "load", slot: "a", channels: [sine(0.5)] });

    expect(posted).toEqual([{ type: "duration", slot: "a", seconds: 0.5 }]);
  });

  it("renders silence until played", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(0.5)] });

    const out = render(8);

    expect(out.every((channel) => channel.every((v) => v === 0))).toBe(true);
  });

  it("plays the source through the chain, reports its position, and posts pause before ended", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(0.5)] });
    send({ type: "play" });

    const out = render(quantaFor(0.8));

    const energy = out.reduce(
      (sum, channel) => sum + channel.reduce((s, v) => s + v * v, 0),
      0
    );
    expect(energy).toBeGreaterThan(0);
    const types = posted.map((message) => message.type);
    const positions = posted.flatMap((message) =>
      message.type === "position" ? [message.frame] : []
    );
    expect(positions.length).toBeGreaterThan(5);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(types.indexOf("ended")).toBe(types.indexOf("pause") + 1);
    expect(types.filter((type) => type === "ended")).toHaveLength(1);
    expect(positions.at(-1)).toBe(0.5 * SAMPLE_RATE);
  });

  it("starts from the seeked position", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(1)] });
    send({ type: "seek", seconds: 0.25, seq: 1 });
    send({ type: "play" });

    render(quantaFor(0.06));

    const first = posted.find((message) => message.type === "position") as {
      frame: number;
    };
    expect(first.frame).toBeGreaterThanOrEqual(0.25 * SAMPLE_RATE);
    expect(first.frame).toBeLessThan(0.32 * SAMPLE_RATE);
  });

  it("reads the source at the set speed", async () => {
    const { posted, send, render } = await playerNode();
    send({
      type: "params",
      values: [[Param.TimeSpeed, 2]],
      bypass: [],
    });
    send({ type: "load", slot: "a", channels: [sine(2)] });
    send({ type: "play" });

    render(quantaFor(0.5));

    const last = posted.findLast((message) => message.type === "position") as {
      frame: number;
    };
    // Half a second of output at double speed has read about a second.
    expect(last.frame / SAMPLE_RATE).toBeGreaterThan(0.85);
  });

  it("reports gain reduction, in positive dB, only while the compressor runs", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(1)] });
    send({ type: "play" });
    render(quantaFor(0.1));
    expect(posted.some((message) => message.type === "gr")).toBe(false);

    send({ type: "params", values: [], bypass: [[Block.Compressor, false]] });
    render(quantaFor(0.1));

    const last = posted.findLast((message) => message.type === "gr") as {
      db: number;
    };
    // A -6 dBFS sine against the default -18 dB threshold is well over it.
    expect(last.db).toBeGreaterThan(1);
  });
});

/** The summed energy of each rendered quantum, both channels. */
function quantumEnergies(out: Float32Array[]): number[] {
  const energies: number[] = [];
  for (let q = 0; q < out.length; q += 2) {
    let sum = 0;
    for (const channel of [out[q]!, out[q + 1]!]) {
      for (const v of channel) sum += v * v;
    }
    energies.push(sum);
  }
  return energies;
}

/** `seconds` of silence, then a 0.5-amplitude sine to `total`. */
function silenceThenSine(seconds: number, total: number): Float32Array {
  const start = Math.round(seconds * SAMPLE_RATE);
  return Float32Array.from(
    { length: Math.round(total * SAMPLE_RATE) },
    (_, i) =>
      i < start ? 0 : 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  );
}

describe("DspProcessor player role comparison", () => {
  it("swaps between the two chains' outputs over a 12 ms ramp", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(2)] });
    send({
      type: "load",
      slot: "b",
      channels: [new Float32Array(SAMPLE_RATE * 2)],
    });
    send({ type: "play" });
    const steady = quantumEnergies(render(quantaFor(0.2))).at(-1)!;
    expect(steady).toBeGreaterThan(0);

    send({ type: "route", active: "b", gains: { a: 1, b: 1 } });
    const ramp = quantumEnergies(render(8));

    // 12 ms is 576 frames: four and a half quanta falling to silence.
    expect(ramp[0]).toBeGreaterThan(0);
    expect(ramp[0]).toBeLessThan(steady);
    expect(ramp[3]).toBeGreaterThan(0);
    expect(ramp[3]).toBeLessThan(ramp[0]!);
    expect(ramp.slice(5).every((energy) => energy === 0)).toBe(true);

    send({ type: "route", active: "a", gains: { a: 1, b: 1 } });
    const back = quantumEnergies(render(8));
    // Energy per quantum wanders with the sine's phase; back at full gain it
    // is the same order as before the swap, not a ramp's fraction of it.
    expect(back.at(-1)! / steady).toBeGreaterThan(0.8);
    expect(back.at(-1)! / steady).toBeLessThan(1.2);
  });

  it("sets each chain's final gain from the route", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(2)] });
    send({ type: "load", slot: "b", channels: [sine(2)] });
    send({ type: "play" });
    render(quantaFor(0.2));
    const mean = (energies: number[]) =>
      energies.reduce((sum, energy) => sum + energy, 0) / energies.length;
    const full = mean(quantumEnergies(render(quantaFor(0.5))));

    send({ type: "route", active: "a", gains: { a: 0.5, b: 1 } });
    render(8);
    const halved = mean(quantumEnergies(render(quantaFor(0.5))));

    // Half the amplitude is a quarter of the energy.
    expect(halved / full).toBeCloseTo(0.25, 1);
  });

  it("places source b at a's position plus the offset", async () => {
    const heardAt = async (offset: number) => {
      const { send, render } = await playerNode();
      send({
        type: "load",
        slot: "a",
        channels: [new Float32Array(SAMPLE_RATE * 2)],
      });
      send({ type: "load", slot: "b", channels: [silenceThenSine(1, 2)] });
      send({ type: "offset", seconds: offset });
      send({ type: "route", active: "b", gains: { a: 1, b: 1 } });
      send({ type: "seek", seconds: 0, seq: 1 });
      send({ type: "play" });
      return quantumEnergies(render(quantaFor(0.3)));
    };

    // B's material starts a second in: unplaced, the first 0.3 s are silent;
    // placed a second ahead, they already carry it.
    expect((await heardAt(0)).every((energy) => energy === 0)).toBe(true);
    expect((await heardAt(1)).at(-1)).toBeGreaterThan(0);
  });

  it("plays a lead-in of silence while b is placed before its own start", async () => {
    const { send, render } = await playerNode();
    send({
      type: "load",
      slot: "a",
      channels: [new Float32Array(SAMPLE_RATE * 2)],
    });
    send({ type: "load", slot: "b", channels: [sine(2)] });
    send({ type: "offset", seconds: -0.5 });
    send({ type: "route", active: "b", gains: { a: 1, b: 1 } });
    send({ type: "play" });

    const early = quantumEnergies(render(quantaFor(0.3)));
    const later = quantumEnergies(render(quantaFor(0.5)));

    expect(early.slice(5).every((energy) => energy === 0)).toBe(true);
    expect(later.at(-1)).toBeGreaterThan(0);
  });

  it("lands b exactly the offset late after a lead-in, however long the lead-in", async () => {
    const impulse = () => {
      const channel = new Float32Array(SAMPLE_RATE * 2);
      channel[Math.round(0.8 * SAMPLE_RATE)] = 1;
      return channel;
    };
    const peakAt = async (offset: number) => {
      const { send, render } = await playerNode();
      send({ type: "load", slot: "a", channels: [impulse()] });
      send({ type: "load", slot: "b", channels: [impulse()] });
      send({ type: "offset", seconds: offset });
      send({ type: "route", active: "b", gains: { a: 1, b: 1 } });
      send({ type: "play" });
      const left = render(quantaFor(1.8)).filter((_, i) => i % 2 === 0);
      let peak = 0;
      let at = -1;
      left.forEach((channel, q) =>
        channel.forEach((v, i) => {
          if (Math.abs(v) > peak) [peak, at] = [Math.abs(v), q * QUANTUM + i];
        })
      );
      return at;
    };

    const aligned = await peakAt(0);
    for (const offset of [-0.013, -0.0301, -0.5]) {
      expect((await peakAt(offset)) - aligned).toBe(
        -Math.round(offset * SAMPLE_RATE)
      );
    }
  });

  it("meters each source before its chain only while comparing, and the mix always", async () => {
    const { posted, send, render } = await playerNode();
    const sides = () =>
      new Set(
        posted.flatMap((message) =>
          message.type === "loudness" ? [message.side] : []
        )
      );
    send({ type: "load", slot: "a", channels: [sine(2)] });
    send({ type: "play" });
    render(quantaFor(0.1));
    expect([...sides()]).toEqual(["mix"]);

    posted.length = 0;
    send({ type: "load", slot: "b", channels: [sine(2)] });
    render(quantaFor(0.1));
    expect(sides()).toEqual(new Set(["a", "b", "mix"]));
  });

  it("drops a comparison's source for a crossfade's", async () => {
    const { send, render } = await playerNode();
    send({
      type: "load",
      slot: "a",
      channels: [new Float32Array(SAMPLE_RATE * 2)],
    });
    send({ type: "load", slot: "b", channels: [sine(2)] });
    send({ type: "route", active: "b", gains: { a: 1, b: 1 } });
    send({
      type: "load",
      slot: "next",
      channels: [new Float32Array(SAMPLE_RATE)],
    });
    send({ type: "play" });
    render(quantaFor(0.1));

    send({ type: "crossfade", seconds: 0.01, seq: 1 });
    const after = quantumEnergies(render(quantaFor(0.2)));

    // B was the only sound; the crossfade leaves a silent incoming and the
    // old silent A fading, never B.
    expect(after.slice(4).every((energy) => energy === 0)).toBe(true);
  });

  it("promotes b to the only source at its own position", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "load", slot: "b", channels: [sine(3)] });
    send({ type: "offset", seconds: 1 });
    send({ type: "route", active: "b", gains: { a: 1, b: 0.5 } });
    send({ type: "play" });
    render(quantaFor(0.2));

    send({ type: "promote", seq: 2 });
    send({ type: "route", active: "a", gains: { a: 1, b: 1 } });
    posted.length = 0;
    render(quantaFor(0.1));

    const position = posted.findLast(
      (message) => message.type === "position"
    ) as {
      frame: number;
    };
    // The heard position is b's: a second ahead of where a had got to.
    expect(position.frame / SAMPLE_RATE).toBeGreaterThan(1.2);
    const loudnessSides = posted.flatMap((message) =>
      message.type === "loudness" ? [message.side] : []
    );
    expect(new Set(loudnessSides)).toEqual(new Set(["mix"]));
  });
});

describe("DspProcessor player role crossfade", () => {
  const silence = (seconds: number) =>
    new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const mean = (energies: number[]) =>
    energies.reduce((sum, energy) => sum + energy, 0) / energies.length;

  it("holds the next source silent and unread until the crossfade starts it", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [silence(2)] });
    send({ type: "load", slot: "next", channels: [sine(2)] });
    send({ type: "play" });

    const waiting = quantumEnergies(render(quantaFor(0.3)));
    expect(posted).toContainEqual({
      type: "duration",
      slot: "next",
      seconds: 2,
    });
    expect(waiting.every((energy) => energy === 0)).toBe(true);

    send({ type: "crossfade", seconds: 0.1, seq: 1 });
    const fading = quantumEnergies(render(quantaFor(0.3)));

    // Silent through its chain's own latency, then rising from silence over
    // the tenth of a second rather than arriving at full level.
    const steady = mean(fading.slice(-10));
    const first = fading.findIndex((energy) => energy > 0);
    expect(first).toBeGreaterThan(0);
    expect(fading[first]!).toBeLessThan(steady / 50);
    expect(fading[first + quantaFor(0.05)]!).toBeLessThan(steady / 2);
    expect(steady).toBeGreaterThan(0);
  });

  it("fades the playing source out over the seconds given, then lets it go", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "load", slot: "next", channels: [silence(3)] });
    send({ type: "play" });
    const steady = mean(quantumEnergies(render(quantaFor(0.2))));

    send({ type: "crossfade", seconds: 0.5, seq: 1 });
    const fading = quantumEnergies(render(quantaFor(0.7)));

    const quarter = quantaFor(0.125);
    // A quarter of the way in, the linear ramp is at three quarters: about
    // nine sixteenths of the energy.
    expect(fading[quarter]! / steady).toBeGreaterThan(0.4);
    expect(fading[quarter]! / steady).toBeLessThan(0.75);
    expect(fading.slice(quantaFor(0.55)).every((energy) => energy === 0)).toBe(
      true
    );
  });

  it("reports the incoming source's time from its start, stamped with the crossfade's seq", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "seek", seconds: 2, seq: 1 });
    send({ type: "play" });
    render(quantaFor(0.2));
    send({ type: "load", slot: "next", channels: [sine(3)] });

    send({ type: "crossfade", seconds: 1, seq: 2 });
    posted.length = 0;
    render(quantaFor(0.2));

    const positions = posted.flatMap((message) =>
      message.type === "position" ? [message] : []
    );
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every((position) => position.seq === 2)).toBe(true);
    expect(positions.at(-1)!.frame / SAMPLE_RATE).toBeLessThan(0.25);
  });

  it("carries on through the outgoing source running out, never ending on it", async () => {
    const { posted, send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(0.3)] });
    send({ type: "load", slot: "next", channels: [sine(2)] });
    send({ type: "play" });
    render(quantaFor(0.1));

    send({ type: "crossfade", seconds: 1, seq: 1 });
    const out = quantumEnergies(render(quantaFor(0.6)));

    expect(posted.some((message) => message.type === "ended")).toBe(false);
    expect(out.at(-1)).toBeGreaterThan(0);
  });

  it("keeps parameters sent during the overlap off the outgoing chain", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "load", slot: "next", channels: [silence(3)] });
    send({ type: "play" });
    render(quantaFor(0.2));
    send({ type: "crossfade", seconds: 2, seq: 1 });
    const before = mean(quantumEnergies(render(8)));

    send({
      type: "params",
      values: [[Param.GainNormaliseDb, 12]],
      bypass: [],
    });
    const after = mean(quantumEnergies(render(8)));

    // Twelve dB louder would be about sixteen times the energy; the outgoing
    // chain keeps fading as it was heard.
    expect(after / before).toBeLessThan(1.1);
  });

  it("drops what is left of the outgoing source on a seek", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "load", slot: "next", channels: [silence(3)] });
    send({ type: "play" });
    render(quantaFor(0.2));
    send({ type: "crossfade", seconds: 2, seq: 1 });
    render(4);

    send({ type: "seek", seconds: 0.5, seq: 2 });
    const after = quantumEnergies(render(8));

    expect(after.every((energy) => energy === 0)).toBe(true);
  });

  it("changes nothing without a next source", async () => {
    const { send, render } = await playerNode();
    send({ type: "load", slot: "a", channels: [sine(3)] });
    send({ type: "play" });
    const steady = mean(quantumEnergies(render(quantaFor(0.2))));

    send({ type: "crossfade", seconds: 0.1, seq: 1 });
    const after = mean(quantumEnergies(render(quantaFor(0.3))));

    expect(after / steady).toBeGreaterThan(0.8);
  });
});
