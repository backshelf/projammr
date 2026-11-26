import { afterEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { waitFor } from "@workspace/test/wait-for";
import type { ActionError, Asset } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { DEFAULT_LAB } from "./lab-settings";
import { bounce, type BounceDeps, type BounceInput } from "./bounce";
import type { PlayerCommand, PlayerMessage } from "./processor-protocol";

/**
 * The player node a render creates; records every command it's sent and
 * answers a `load` the way the worklet's player role does — `duration` once
 * the source sits in module memory, or `failed` when `loadOutcome` simulates
 * a load the processor could not hold (a phone out of memory, say).
 */
class FakeNode {
  static last: FakeNode | null = null;
  static loadOutcome: "duration" | "failed" = "duration";
  sent: PlayerCommand[] = [];
  onprocessorerror: (() => void) | null = null;
  port: {
    onmessage: ((event: MessageEvent<PlayerMessage>) => void) | null;
    postMessage: (command: PlayerCommand) => void;
  };
  constructor() {
    FakeNode.last = this;
    const port: FakeNode["port"] = {
      onmessage: null,
      postMessage: (command: PlayerCommand) => {
        this.sent.push(command);
        if (command.type === "load") {
          queueMicrotask(() => {
            const message: PlayerMessage =
              FakeNode.loadOutcome === "failed"
                ? { type: "failed", slot: command.slot, reason: "memory" }
                : { type: "duration", slot: command.slot, seconds: 0 };
            port.onmessage?.({ data: message } as MessageEvent<PlayerMessage>);
          });
        }
      },
    };
    this.port = port;
  }
  connect() {}
  disconnect() {}
}

type FakeAudioBuffer = {
  numberOfChannels: number;
  length: number;
  getChannelData: (i: number) => Float32Array;
};

const fakeBuffer = (length: number, numberOfChannels = 1): FakeAudioBuffer => ({
  numberOfChannels,
  length,
  getChannelData: () => new Float32Array(length),
});

/**
 * One fake offline context serves both the decode probe and the render —
 * `bounce.ts` never calls `decodeAudioData` on the render context or
 * `suspend`/`startRendering` on the decode probe, so nothing collides.
 */
function fakeOfflineContext(decoded: FakeAudioBuffer) {
  const suspends: { at: number; resolve: () => void }[] = [];
  let resolveRendering!: (buffer: FakeAudioBuffer) => void;
  let markStarted!: () => void;
  /** Resolves once `startRendering` is actually called, whatever the checkpoint count. */
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const ctx = {
    audioWorklet: { addModule: () => Promise.resolve() },
    destination: {},
    decodeAudioData: () => Promise.resolve(decoded),
    suspend: (at: number) =>
      new Promise<void>((resolve) => suspends.push({ at, resolve })),
    resume: () => Promise.resolve(),
    startRendering: () => {
      markStarted();
      return new Promise<FakeAudioBuffer>((resolve) => {
        resolveRendering = resolve;
      });
    },
  };
  return {
    ctx,
    suspends,
    started,
    resolveRendering: (buffer: FakeAudioBuffer) => resolveRendering(buffer),
  };
}

function setup({
  decodedFrames = 48000 * 12,
  loadOutcome = "duration" as "duration" | "failed",
} = {}) {
  FakeNode.last = null;
  FakeNode.loadOutcome = loadOutcome;
  stubGlobal("AudioWorkletNode", FakeNode);
  const offline = fakeOfflineContext(fakeBuffer(decodedFrames));
  const rendered = fakeBuffer(decodedFrames, 2);

  // Typed from the dependency it stands in for, so `encode.mock.calls` stays a
  // typed tuple; inferring from a no-argument implementation makes every
  // recorded call `[]`.
  const encode = mock<BounceDeps["encode"]>(async () => new ArrayBuffer(8));
  const upload = mock(
    async (
      file: File,
      _projectId: number,
      onProgress?: (fraction: number) => void
    ): Promise<Asset | ActionError> => {
      onProgress?.(0.5);
      onProgress?.(1);
      return { id: 42, name: file.name } as Asset;
    }
  );
  const attach = mock(
    async (assetId: number): Promise<Asset | ActionError> =>
      ({ id: assetId, name: "attached.flac" }) as Asset
  );

  const uploadLimit = mock(
    async (): Promise<number | ActionError> => 512 * 1024 * 1024
  );

  const deps: BounceDeps = {
    fetch: (async () =>
      new Response(new Uint8Array(10), {
        headers: { "Content-Length": "10" },
      })) as unknown as typeof fetch,
    coarse: () => false,
    requestCopy: mock(async () => "/media/copy.mp3"),
    createOfflineContext: mock(
      () => offline.ctx as unknown as OfflineAudioContext
    ),
    encode,
    uploadLimit,
    upload,
    attach,
  };

  const input: BounceInput = {
    source: { src: "/media/take.wav", assetId: 7 },
    settings: DEFAULT_LAB,
    loudness: { lufs: null, targetLufs: -14 },
    curve: null,
    projectId: 3,
    trackId: 9,
    name: "Take — Lab bounce.flac",
  };

  return {
    deps,
    input,
    offline,
    rendered,
    encode,
    uploadLimit,
    upload,
    attach,
  };
}

afterEach(() => unstubAllGlobals());

describe("bounce", () => {
  it("renders through checkpoints that post climbing fractions, then encodes, uploads and attaches", async () => {
    const { deps, input, offline, rendered, encode, upload, attach } = setup();
    const statuses: { phase: string; fraction?: number }[] = [];

    const running = bounce(
      input,
      deps,
      (status) => statuses.push(status),
      new AbortController().signal
    );

    await waitFor(() => {
      if (offline.suspends.length === 0)
        throw new Error("waiting for checkpoints");
    });
    const checkpoints = offline.suspends.length;
    expect(checkpoints).toBeGreaterThan(0);
    expect(statuses[0]).toEqual({ phase: "rendering", fraction: 0 });

    offline.suspends.forEach((checkpoint) => checkpoint.resolve());
    await waitFor(() => {
      const rendering = statuses.filter((s) => s.phase === "rendering");
      if (rendering.length < checkpoints + 1)
        throw new Error("waiting for progress");
    });

    const fractions = statuses
      .filter((s) => s.phase === "rendering")
      .map((s) => s.fraction!);
    expect(fractions[0]).toBe(0);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]!);
    }

    offline.resolveRendering(rendered);

    const result = await running;

    expect(statuses.some((s) => s.phase === "encoding")).toBe(true);
    expect(
      statuses.filter((s) => s.phase === "uploading").map((s) => s.fraction)
    ).toEqual([0, 0.5, 1]);

    expect(encode).toHaveBeenCalledTimes(1);
    const [encodedChannels, encodedRate] = encode.mock.calls[0]!;
    expect(encodedChannels).toHaveLength(2); // the rendered buffer's own channel count
    expect(encodedRate).toBe(48000);

    expect(upload).toHaveBeenCalledTimes(1);
    const [uploadedFile, uploadedProjectId] = upload.mock.calls[0]!;
    expect(uploadedFile.name).toBe(input.name);
    expect(uploadedFile.type).toBe("audio/flac");
    expect(uploadedProjectId).toBe(input.projectId);

    expect(attach).toHaveBeenCalledWith(42, "track", input.trackId);
    expect(isActionError(result)).toBe(false);
  });

  it("stops at the upload's error without attaching", async () => {
    const { deps, input, offline, rendered, attach } = setup({
      decodedFrames: 1000,
    });
    const failingUpload = mock(async (): Promise<Asset | ActionError> => ({
      error: "Too large",
    }));
    const failing = { ...deps, upload: failingUpload };

    const running = bounce(
      input,
      failing,
      () => {},
      new AbortController().signal
    );
    await offline.started;
    offline.suspends.forEach((checkpoint) => checkpoint.resolve());
    offline.resolveRendering(rendered);

    const result = await running;

    expect(result).toEqual({ error: "Too large" });
    expect(attach).not.toHaveBeenCalled();
  });

  it("rejects without rendering, encoding or uploading when the player could not hold the source", async () => {
    const { deps, input, offline, rendered, encode, upload, attach } = setup({
      loadOutcome: "failed",
    });

    const running = bounce(input, deps, () => {}, new AbortController().signal);

    // A render that (wrongly) pressed ahead despite the "failed" message
    // would eventually call `startRendering`; drive it to completion so a
    // regression fails on the assertions below instead of hanging here.
    const outcome = await Promise.race([
      running.then(
        () => "resolved" as const,
        () => "rejected" as const
      ),
      offline.started.then(() => "started" as const),
    ]);
    if (outcome === "started") {
      offline.suspends.forEach((checkpoint) => checkpoint.resolve());
      offline.resolveRendering(rendered);
    }

    await expect(running).rejects.toThrow(/memory/i);
    expect(encode).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("stops short of encoding, uploading or attaching once the caller aborts mid-render", async () => {
    const { deps, input, offline, rendered, encode, upload, attach } = setup();
    const controller = new AbortController();

    const running = bounce(input, deps, () => {}, controller.signal);

    await offline.started;
    offline.suspends.forEach((checkpoint) => checkpoint.resolve());
    controller.abort();
    offline.resolveRendering(rendered);

    await expect(running).rejects.toThrow();
    expect(encode).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("does not attach an upload that settles after the caller aborts", async () => {
    const { deps, input, offline, rendered, attach } = setup();
    let resolveUpload!: (asset: Asset) => void;
    const upload = mock(
      () =>
        new Promise<Asset | ActionError>((resolve) => {
          resolveUpload = resolve;
        })
    );
    const aborting: BounceDeps = { ...deps, upload };
    const controller = new AbortController();

    const running = bounce(input, aborting, () => {}, controller.signal);

    await offline.started;
    offline.suspends.forEach((checkpoint) => checkpoint.resolve());
    offline.resolveRendering(rendered);
    await waitFor(() => {
      if (upload.mock.calls.length === 0) throw new Error("waiting for upload");
    });

    controller.abort();
    resolveUpload({ id: 42, name: "bounced.flac" } as Asset);

    await expect(running).rejects.toThrow();
    expect(attach).not.toHaveBeenCalled();
  });

  it("stops before rendering, naming both sizes, when the estimated FLAC is over the upload cap", async () => {
    const { deps, input, encode, upload, attach } = setup({
      decodedFrames: 48000 * 150,
    });
    const statuses: { phase: string }[] = [];
    const capped: BounceDeps = {
      ...deps,
      uploadLimit: async () => 10 * 1024 * 1024,
    };

    const result = await bounce(
      input,
      capped,
      (status) => statuses.push(status),
      new AbortController().signal
    );

    expect(result).toEqual({
      error: "This bounce would be about 31 MB; uploads are limited to 10 MB.",
    });
    expect(statuses).toEqual([]);
    // Only the decode probe: no render context was ever built.
    expect(deps.createOfflineContext).toHaveBeenCalledTimes(1);
    expect(encode).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("stops at the upload limit's own error without downloading anything", async () => {
    const { deps, input, upload } = setup();
    const fetchSource = mock(deps.fetch);
    const failing: BounceDeps = {
      ...deps,
      fetch: fetchSource as unknown as typeof fetch,
      uploadLimit: async () => ({ error: "You are not signed in" }),
    };

    const result = await bounce(
      input,
      failing,
      () => {},
      new AbortController().signal
    );

    expect(result).toEqual({ error: "You are not signed in" });
    expect(fetchSource).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports an upload the server refused as too big with both sizes, without attaching", async () => {
    const { deps, input, offline, rendered, attach } = setup({
      decodedFrames: 1000,
    });
    const tooBig: BounceDeps = {
      ...deps,
      encode: async () => new ArrayBuffer(3 * 1024 * 1024),
      upload: async () => ({
        error: "Invalid request",
        status: 400,
        code: "invalid_request",
        details: {
          issues: [
            {
              code: "too_big",
              maximum: 2 * 1024 * 1024,
              path: ["file"],
              message: "Too big",
            },
          ],
        },
      }),
    };

    const running = bounce(
      input,
      tooBig,
      () => {},
      new AbortController().signal
    );
    await offline.started;
    offline.suspends.forEach((checkpoint) => checkpoint.resolve());
    offline.resolveRendering(rendered);

    expect(await running).toEqual({
      error: "This bounce is 3 MB; uploads are limited to 2 MB.",
    });
    expect(attach).not.toHaveBeenCalled();
  });
});
