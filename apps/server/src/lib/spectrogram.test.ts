import { afterEach, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { SPECTROGRAM_BANDS } from "@workspace/dsp/offline";
import { writeSpectrogramPng } from "./spectrogram.js";
import { setStorageBackend, type StorageBackend } from "./storage.js";

describe("writeSpectrogramPng", () => {
  const stored = new Map<string, Uint8Array>();

  const memoryBackend: StorageBackend = {
    kind: "local",
    exists: async (key) => stored.has(key),
    stat: async (key) => {
      const bytes = stored.get(key);
      return bytes ? { size: bytes.byteLength, modifiedAt: new Date(0) } : null;
    },
    readBytes: async (key) => {
      const bytes = stored.get(key);
      if (!bytes) throw new Error(`missing key ${key}`);
      return bytes;
    },
    readStream: () => {
      throw new Error("not implemented");
    },
    putBytes: async (key, bytes) => {
      stored.set(key, bytes);
    },
    putFromFile: async () => {
      throw new Error("not implemented");
    },
    putObjects: async () => {
      throw new Error("not implemented");
    },
    listEntries: async () => [],
    withLocalFile: async () => {
      throw new Error("not implemented");
    },
    remove: async (key) => stored.delete(key),
  };

  afterEach(() => {
    stored.clear();
    setStorageBackend(null);
  });

  it("writes a columns × SPECTROGRAM_BANDS single-channel grayscale PNG with lowest band at row 0", async () => {
    setStorageBackend(memoryBackend);
    const columns = 4;
    const bytes = new Uint8Array(columns * SPECTROGRAM_BANDS);
    // Column 0: lowest band = 200, highest band = 50
    bytes[0] = 200;
    bytes[SPECTROGRAM_BANDS - 1] = 50;
    // Column 3: mid band 80 = 255
    bytes[3 * SPECTROGRAM_BANDS + 80] = 255;

    const result = await writeSpectrogramPng(bytes, columns);
    expect(result.key).toMatch(/^analysis\/.+\.png$/);
    const png = stored.get(result.key);
    expect(png).toBeDefined();
    expect(result.bytes).toBe(png!.byteLength);

    const meta = await sharp(png!).metadata();
    expect(meta.width).toBe(columns);
    expect(meta.height).toBe(SPECTROGRAM_BANDS);
    expect(meta.channels).toBe(1);

    const { data, info } = await sharp(png!)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(columns);
    expect(info.height).toBe(SPECTROGRAM_BANDS);
    expect(info.channels).toBe(1);
    expect(data[0 * columns + 0]).toBe(200);
    expect(data[(SPECTROGRAM_BANDS - 1) * columns + 0]).toBe(50);
    expect(data[80 * columns + 3]).toBe(255);
  });
});
