import { afterEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { Param } from "@workspace/dsp/params";
import type { AudioOutput } from "./audio-output";
import { createLabEngine, LabUnavailable } from "./lab-engine";
import { DEFAULT_LAB } from "./lab-settings";
import type { PlayerCommand, PlayerMessage } from "./processor-protocol";

const RATE = 48000;
const MIB = 1024 * 1024;

/** A version with no stored loudness, which `normalise` leaves alone. */
const unmeasured = { lufs: null, targetLufs: -14 };

const param = () => ({
  value: 1,
  setValueAtTime() {},
  cancelScheduledValues() {},
  linearRampToValueAtTime() {},
});

/** The player node the engine creates; it answers a `load` as the processor does. */
class FakeNode {
  static last: FakeNode | null = null;
  /** Off, a test answers each `load` itself, in whatever order it likes. */
  static answersLoads = true;
  sent: PlayerCommand[] = [];
  port = {
    onmessage: null as ((event: MessageEvent<PlayerMessage>) => void) | null,
    postMessage: (command: PlayerCommand) => {
      this.sent.push(command);
      if (command.type === "load" && FakeNode.answersLoads) {
        this.reply({
          type: "duration",
          slot: command.slot,
          seconds: (command.channels[0]?.length ?? 0) / RATE,
        });
      }
    },
  };
  constructor() {
    FakeNode.last = this;
  }
  reply(message: PlayerMessage) {
    this.port.onmessage?.({ data: message } as MessageEvent<PlayerMessage>);
  }
  connect() {}
  disconnect() {}
}

function fakeContext({ decodes = true }: { decodes?: boolean } = {}) {
  return {
    currentTime: 0,
    sampleRate: RATE,
    audioWorklet: { addModule: () => Promise.resolve() },
    resume: () => Promise.resolve(),
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    decodeAudioData: (buffer: ArrayBuffer) =>
      decodes
        ? Promise.resolve({
            numberOfChannels: 2,
            // one decoded frame per downloaded byte keeps the arithmetic plain
            getChannelData: () => new Float32Array(buffer.byteLength),
          })
        : Promise.reject(new DOMException("unsupported", "EncodingError")),
  };
}

/** A response streamed in `chunks` pieces, declaring `declared` bytes. */
function streamed(bytes: number, chunks: number, declared = bytes) {
  const size = Math.ceil(bytes / chunks);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const piece = Math.min(size, bytes - sent);
      sent += piece;
      controller.enqueue(new Uint8Array(piece));
    },
  });
  return new Response(body, {
    headers: { "Content-Length": String(declared) },
  });
}

const events = () => {
  const order: string[] = [];
  return {
    order,
    play: mock(() => order.push("play")),
    pause: mock(() => order.push("pause")),
    ended: mock(() => order.push("ended")),
    duration: mock((seconds: number) => order.push(`duration ${seconds}`)),
    error: mock(),
    gr: mock((db: number) => order.push(`gr ${db}`)),
    loudness: mock((side: string) => order.push(`loudness ${side}`)),
  };
};

async function setup({
  fetchImpl = async () => streamed(RATE, 4),
  coarse = false,
  decodes = true,
}: {
  fetchImpl?: (url: string) => Promise<Response>;
  coarse?: boolean;
  decodes?: boolean;
} = {}) {
  stubGlobal("AudioWorkletNode", FakeNode);
  const ctx = fakeContext({ decodes });
  const output = { ctx, analyser: {} } as unknown as AudioOutput;
  const heard = events();
  const fetchSpy = mock((url: string) => fetchImpl(url));
  const requestCopy = mock(async () => "/media/copy.mp3");
  const lab = await createLabEngine(output, heard, {
    fetch: ((input: string) => fetchSpy(input)) as unknown as typeof fetch,
    coarse: () => coarse,
    requestCopy,
  });
  return { lab, ctx, heard, fetchSpy, requestCopy, node: FakeNode.last! };
}

const source = { src: "/media/take.wav", assetId: 7 };
const signal = () => new AbortController().signal;

afterEach(() => {
  FakeNode.answersLoads = true;
  unstubAllGlobals();
});

describe("createLabEngine load", () => {
  it("emits duration as an event once the processor holds the source", async () => {
    const { lab, heard, node } = await setup();

    await lab.load(source, () => {}, signal());

    expect(heard.order).toEqual(["duration 1"]);
    const load = node.sent.find((command) => command.type === "load");
    expect(load).toMatchObject({ type: "load", slot: "a" });
  });

  it("reports download fractions that climb to 1", async () => {
    const { lab } = await setup();
    const fractions: number[] = [];

    await lab.load(source, (fraction) => fractions.push(fraction), signal());

    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(new Set(fractions).size).toBeGreaterThan(3);
  });

  it("falls back to the 320 kbps copy when the upload is over this device's cap", async () => {
    const { lab, fetchSpy, requestCopy } = await setup({
      coarse: true,
      fetchImpl: async (url) =>
        url === source.src ? streamed(8, 1, 81 * MIB) : streamed(RATE, 2),
    });
    const sources: string[] = [];

    await lab.load(source, (_, from) => sources.push(from), signal());

    expect(requestCopy).toHaveBeenCalledWith(7, expect.any(AbortSignal));
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      source.src,
      "/media/copy.mp3",
    ]);
    expect(lab.source).toBe("copy");
    expect(sources.at(-1)).toBe("copy");
  });

  it("decodes the original on a desktop at the same size", async () => {
    const { lab, requestCopy } = await setup({
      fetchImpl: async () => streamed(8, 1, 81 * MIB),
    });

    await lab.load(source, () => {}, signal());

    expect(requestCopy).not.toHaveBeenCalled();
    expect(lab.source).toBe("original");
  });

  it("is unavailable when the format cannot be decoded", async () => {
    const { lab } = await setup({ decodes: false });

    const loading = lab.load(source, () => {}, signal());

    await expect(loading).rejects.toBeInstanceOf(LabUnavailable);
    await expect(loading).rejects.toMatchObject({
      reason: "This format cannot be decoded here",
    });
  });
});

describe("createLabEngine transport", () => {
  it("reports pause before ended when the source runs out", async () => {
    const { lab, heard, node } = await setup();
    await lab.load(source, () => {}, signal());
    lab.play();
    heard.order.length = 0;

    node.reply({ type: "pause" });
    node.reply({ type: "ended" });

    expect(heard.order).toEqual(["pause", "ended"]);
    expect(lab.playing).toBe(false);
  });

  it("runs time on the context clock at the playback speed, corrected by position frames", async () => {
    const { lab, ctx, node } = await setup({
      fetchImpl: async () => streamed(RATE * 10, 2),
    });
    await lab.load(source, () => {}, signal());
    lab.set({ ...DEFAULT_LAB, speed: 2 }, unmeasured);
    lab.start({ position: 1, playing: true }, 0.012);

    ctx.currentTime = 0.5;
    expect(lab.time).toBeCloseTo(2);

    const seek = node.sent.findLast((command) => command.type === "seek")!;
    const seq = (seek as { seq: number }).seq;
    node.reply({ type: "position", frame: RATE * 1.9, at: 0.5, seq });
    expect(lab.time).toBeCloseTo(1.9);

    // A frame posted before a later seek landed is stale.
    lab.seek(5);
    node.reply({ type: "position", frame: RATE * 2, at: 0.5, seq });
    expect(lab.time).toBeCloseTo(5);
  });

  it("forwards a gr frame as the compressor's gain reduction", async () => {
    const { lab, heard, node } = await setup();
    await lab.load(source, () => {}, signal());
    heard.order.length = 0;

    node.reply({ type: "gr", db: 4.5 });

    expect(heard.order).toEqual(["gr 4.5"]);
  });

  it("sends only the parameters a change moved", async () => {
    const { lab, node } = await setup();
    lab.set(DEFAULT_LAB, unmeasured);
    node.sent.length = 0;

    lab.set({ ...DEFAULT_LAB, pitch: 3 }, unmeasured);

    expect(node.sent).toEqual([
      {
        type: "params",
        values: [[Param.TimePitchSemitones, 3]],
        bypass: [],
      },
    ]);
  });
});

describe("createLabEngine comparison", () => {
  it("loads the compared source into slot b without reporting it as the track's duration", async () => {
    const { lab, heard, node } = await setup();
    await lab.load(source, () => {}, signal());
    heard.order.length = 0;

    await lab.loadCompare(
      { src: "/media/b.wav", assetId: 8 },
      () => {},
      signal()
    );

    expect(
      node.sent.findLast((command) => command.type === "load")
    ).toMatchObject({ type: "load", slot: "b" });
    expect(heard.order).toEqual([]);
  });

  it("settles each slot's load on its own answer when both prepare at once", async () => {
    FakeNode.answersLoads = false;
    const { lab, node } = await setup();
    const settled: string[] = [];
    const loadingA = lab
      .load(source, () => {}, signal())
      .then(() => settled.push("a"));
    const loadingB = lab
      .loadCompare({ src: "/media/b.wav", assetId: 8 }, () => {}, signal())
      .then(() => settled.push("b"));
    await waitForLoads(node, 2);

    node.reply({ type: "duration", slot: "b", seconds: 2 });
    await loadingB;
    node.reply({ type: "duration", slot: "a", seconds: 1 });
    await loadingA;

    expect(settled).toEqual(["b", "a"]);
  });

  it("sends the offset and the route to the processor", async () => {
    const { lab, node } = await setup();
    await lab.loadCompare(
      { src: "/media/b.wav", assetId: 8 },
      () => {},
      signal()
    );
    node.sent.length = 0;

    lab.alignCompare(-1.25);
    lab.routeCompare("b", { a: 1, b: 0.5 });

    expect(node.sent).toEqual([
      { type: "offset", seconds: -1.25 },
      { type: "route", active: "b", gains: { a: 1, b: 0.5 } },
    ]);
  });

  it("unloads the compared source and routes back to a at full gain", async () => {
    const { lab, node } = await setup();
    await lab.loadCompare(
      { src: "/media/b.wav", assetId: 8 },
      () => {},
      signal()
    );
    node.sent.length = 0;

    lab.unloadCompare();

    expect(node.sent).toEqual([
      { type: "unload", slot: "b" },
      { type: "route", active: "a", gains: { a: 1, b: 1 } },
    ]);
  });

  it("promotes the compared source at its own position and reports its duration", async () => {
    const { lab, heard, node } = await setup({
      fetchImpl: async (url) =>
        url === source.src ? streamed(RATE * 10, 2) : streamed(RATE * 12, 2),
    });
    await lab.load(source, () => {}, signal());
    await lab.loadCompare(
      { src: "/media/b.wav", assetId: 8 },
      () => {},
      signal()
    );
    lab.alignCompare(1.5);
    lab.seek(4);
    heard.order.length = 0;
    node.sent.length = 0;

    lab.promoteCompare();

    expect(lab.time).toBeCloseTo(5.5);
    expect(heard.order).toEqual(["duration 12"]);
    const promote = node.sent[0] as { type: string; seq: number };
    expect(promote.type).toBe("promote");
    expect(node.sent[1]).toEqual({
      type: "route",
      active: "a",
      gains: { a: 1, b: 1 },
    });
    // A position frame from before the promote is a's, and stale.
    node.reply({
      type: "position",
      frame: RATE * 4,
      at: 0,
      seq: promote.seq - 1,
    });
    expect(lab.time).toBeCloseTo(5.5);
  });

  it("forwards the mix side's frames alongside each source's", async () => {
    const { lab, heard, node } = await setup();
    await lab.load(source, () => {}, signal());
    heard.order.length = 0;
    const frame = { momentary: -14, shortTerm: -14, peak: -1 };

    node.reply({ type: "loudness", side: "mix", frame });
    node.reply({ type: "loudness", side: "b", frame });

    expect(heard.order).toEqual(["loudness mix", "loudness b"]);
  });
});

describe("createLabEngine crossfade", () => {
  const nextSource = { src: "/media/next.wav", assetId: 9 };

  /** Track A playing four seconds in, and the next track loaded behind it. */
  async function withNext() {
    const context = await setup({
      fetchImpl: async (url) =>
        url === source.src ? streamed(RATE * 10, 2) : streamed(RATE * 6, 2),
    });
    const { lab, heard, node } = context;
    await lab.load(source, () => {}, signal());
    lab.start({ position: 4, playing: true }, 0.012);
    await lab.loadNext(nextSource, () => {}, signal());
    heard.order.length = 0;
    node.sent.length = 0;
    return context;
  }

  it("loads the next track into its own slot without reporting it as the track's duration", async () => {
    const { lab, heard, node } = await setup();
    await lab.load(source, () => {}, signal());
    heard.order.length = 0;

    await lab.loadNext(nextSource, () => {}, signal());

    expect(
      node.sent.findLast((command) => command.type === "load")
    ).toMatchObject({ type: "load", slot: "next" });
    expect(heard.order).toEqual([]);
  });

  it("starts the next track from its beginning and reports its duration once the call returns", async () => {
    const { lab, heard, node } = await withNext();

    expect(lab.crossfade(3)).toBe(true);

    const crossfade = node.sent[0] as {
      type: string;
      seconds: number;
      seq: number;
    };
    expect(crossfade).toMatchObject({ type: "crossfade", seconds: 3 });
    expect(lab.time).toBe(0);
    expect(lab.playing).toBe(true);
    expect(heard.order).toEqual([]);

    await Promise.resolve();
    expect(heard.order).toEqual(["duration 6"]);

    // A position frame from before the crossfade is the old track's, and stale.
    node.reply({
      type: "position",
      frame: RATE * 5,
      at: 0,
      seq: crossfade.seq - 1,
    });
    expect(lab.time).toBe(0);
  });

  it("refuses without a next track loaded, and after unloading one", async () => {
    const { lab, node } = await withNext();

    lab.unloadNext();
    expect(node.sent).toEqual([{ type: "unload", slot: "next" }]);

    expect(lab.crossfade(3)).toBe(false);
    expect(node.sent.some((command) => command.type === "crossfade")).toBe(
      false
    );
  });

  it("holds nothing from a load aborted before the processor answered", async () => {
    FakeNode.answersLoads = false;
    const { lab, node } = await setup();
    const controller = new AbortController();
    const loading = lab.loadNext(nextSource, () => {}, controller.signal);
    await waitForLoads(node, 1);

    controller.abort();
    node.reply({ type: "duration", slot: "next", seconds: 6 });

    await expect(loading).rejects.toBeDefined();
    expect(lab.crossfade(3)).toBe(false);
  });

  it("waits for an earlier next load to settle before sending its own", async () => {
    FakeNode.answersLoads = false;
    const { lab, heard, node } = await setup();
    const controller = new AbortController();
    const first = lab.loadNext(nextSource, () => {}, controller.signal);
    await waitForLoads(node, 1);
    controller.abort();

    const second = lab.loadNext(
      { src: "/media/other.wav", assetId: 10 },
      () => {},
      signal()
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(node.sent.filter((command) => command.type === "load")).toHaveLength(
      1
    );

    node.reply({ type: "duration", slot: "next", seconds: 6 });
    await expect(first).rejects.toBeDefined();
    await waitForLoads(node, 2);
    node.reply({ type: "duration", slot: "next", seconds: 7 });
    await second;

    expect(lab.crossfade(3)).toBe(true);
    await Promise.resolve();
    // The second load's own answer, not the first's.
    expect(heard.order.at(-1)).toBe("duration 7");
  });
});

/** Resolves once the node has been sent `count` load commands. */
async function waitForLoads(node: FakeNode, count: number) {
  for (let i = 0; i < 50; i++) {
    if (node.sent.filter((command) => command.type === "load").length >= count)
      return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("the loads never reached the processor");
}
