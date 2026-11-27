import { beforeAll, describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import path, { dirname } from "node:path";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import type { Flac } from "libflacjs";
import { Decoder } from "libflacjs/lib/decoder";
import { encodeFlac24, whenFlacReady } from "./flac-encode";

/**
 * The same WebAssembly build the worker loads, read from disk. Under Bun the
 * glue takes its Node path: it reads `FLAC_SCRIPT_LOCATION` from
 * `process.env` as a directory, and would fetch the `.wasm` if `fetch`
 * exists — but Bun's `fetch` throws on a bare path rather than rejecting,
 * which the glue does not catch, so `fetch` is hidden while it evaluates and
 * it reads the file instead.
 */
async function loadFlac(): Promise<Flac> {
  const glue = createRequire(import.meta.url).resolve(
    "libflacjs/dist/libflac.min.wasm.js"
  );
  Object.assign(process.env, { FLAC_SCRIPT_LOCATION: `${dirname(glue)}/` });
  stubGlobal("fetch", undefined);
  try {
    const library = (await import(glue)) as { default: Flac };
    return await whenFlacReady(library.default);
  } finally {
    unstubAllGlobals();
  }
}

/**
 * Decodes `bytes` back to integers per channel, with the file's STREAMINFO.
 * libflacjs hands each decoded channel back as 32-bit little-endian samples,
 * whatever the stream's own bit depth.
 */
function decode(flac: Flac, bytes: Uint8Array<ArrayBuffer>) {
  const decoder = new Decoder(flac);
  try {
    decoder.decode(bytes);
    const metadata = decoder.metadata!;
    const channels = decoder
      .getSamples(false)
      .map((raw) => new Int32Array(raw.slice().buffer));
    return { metadata, channels };
  } finally {
    decoder.destroy();
  }
}

let flac: Flac;
beforeAll(async () => {
  flac = await loadFlac();
});

describe("encodeFlac24", () => {
  it("writes a fLaC stream whose STREAMINFO names 24-bit, the rate, the channels and the length", () => {
    const frames = 70000; // past one encode chunk, so the chunks join up
    const bytes = encodeFlac24(
      flac,
      [new Float32Array(frames), new Float32Array(frames)],
      48000
    );

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("fLaC");
    const { metadata } = decode(flac, bytes);
    expect(metadata.bitsPerSample).toBe(24);
    expect(metadata.sampleRate).toBe(48000);
    expect(metadata.channels).toBe(2);
    expect(metadata.total_samples).toBe(frames);
    expect(metadata.md5sum).toMatch(/^[0-9a-f]{32}$/);
  });

  it("round-trips every sample losslessly, with -1, 0 and 1 at the 24-bit extremes and zero", () => {
    const frames = 70000;
    const left = Float32Array.from({ length: frames }, (_, i) =>
      Math.sin(i / 30)
    );
    left.set([-1, 0, 1], 0);
    const right = Float32Array.from(
      { length: frames },
      (_, i) => Math.cos(i / 17) * 0.25
    );

    const { channels } = decode(flac, encodeFlac24(flac, [left, right], 48000));

    expect([...channels[0]!.subarray(0, 3)]).toEqual([-0x800000, 0, 0x7fffff]);
    const expected = (sample: number) =>
      Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
    expect(channels[0]).toEqual(Int32Array.from(left, expected));
    expect(channels[1]).toEqual(Int32Array.from(right, expected));
  });

  it("clamps a sample past full scale rather than wrapping it", () => {
    const { channels } = decode(
      flac,
      encodeFlac24(flac, [new Float32Array([1.5, -1.5])], 44100)
    );

    expect([...channels[0]!]).toEqual([0x7fffff, -0x800000]);
  });

  it("takes about half a 24-bit WAV's bytes for tonal audio", () => {
    const frames = 48000 * 5;
    const tone = Float32Array.from(
      { length: frames },
      (_, i) =>
        0.4 * Math.sin((2 * Math.PI * 220 * i) / 48000) +
        0.2 * Math.sin((2 * Math.PI * 1370 * i) / 48000)
    );

    const bytes = encodeFlac24(flac, [tone, tone.slice()], 48000);

    expect(bytes.byteLength).toBeLessThan(frames * 2 * 3 * 0.5);
  });
});

describe("libflacjs bundler boundary", () => {
  const clientSrc = path.resolve(import.meta.dir, "../..");

  // `libflacjs/lib/*.js` are UMD wrappers that shadow `require` as a factory
  // parameter, which Turbopack cannot statically resolve — crashing SSR with
  // `MODULE_NOT_FOUND` on `./utils/data-utils` and browsers/workers with
  // `Unexpected use of runtime require`.
  it("never imports libflacjs/lib UMD helpers from production client source", async () => {
    const offenders: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    let scanned = 0;
    for await (const file of glob.scan({ cwd: clientSrc, absolute: true })) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      scanned += 1;
      const text = await Bun.file(file).text();
      if (/from\s+["']libflacjs\/lib\//.test(text)) {
        offenders.push(path.relative(clientSrc, file));
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  // `bounce.ts` is reachable from the app shell (`MusicPlayer`); keeping it off
  // `flac-encode.ts` ensures the encoder stays in the worker chunk only.
  it("keeps bounce.ts independent of flac-encode.ts", async () => {
    const bounceSource = await Bun.file(
      path.join(import.meta.dir, "bounce.ts")
    ).text();
    expect(bounceSource).not.toMatch(/from\s+["'][^"']*flac-encode["']/);
  });
});
