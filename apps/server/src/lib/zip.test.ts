import { describe, expect, it } from "bun:test";
import { readZip, unzipTest } from "../test/zip-reader.js";
import { zipChunks, type ZipEntry } from "./zip.js";

async function zipOf(entries: ZipEntry[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of zipChunks(entries)) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}

async function* chunks(...parts: string[]) {
  for (const part of parts) yield new TextEncoder().encode(part);
}

const text = (s: string) => new TextEncoder().encode(s);

describe("zipChunks", () => {
  it("writes entries whose bytes are in hand and entries that stream, each readable and checksummed", async () => {
    const zip = await zipOf([
      { name: "set.als", data: text("whole") },
      { name: "Samples/Imported/kick é.wav", data: chunks("kick", " bytes") },
      { name: "empty.txt", data: new Uint8Array() },
      { name: "empty-stream.bin", data: chunks() },
      {
        name: "MANIFEST.txt",
        data: text("included\tSamples/Imported/kick é.wav\n"),
      },
    ]);

    const entries = readZip(zip);
    expect(entries.map((e) => [e.name, e.data.toString(), e.crcOk])).toEqual([
      ["set.als", "whole", true],
      ["Samples/Imported/kick é.wav", "kick bytes", true],
      ["empty.txt", "", true],
      ["empty-stream.bin", "", true],
      ["MANIFEST.txt", "included\tSamples/Imported/kick é.wav\n", true],
    ]);

    const tested = await unzipTest(zip);
    if (tested) {
      expect(tested.output).toContain("No errors detected");
      expect(tested.ok).toBe(true);
    }
  });

  it("writes a ZIP64 end of central directory past 65,534 entries", async () => {
    const entries: ZipEntry[] = Array.from({ length: 70_000 }, (_, n) => ({
      name: `e/${n}`,
      data: n % 2 === 0 ? text(String(n)) : chunks(String(n)),
    }));
    const zip = await zipOf(entries);

    const read = readZip(zip);
    expect(read).toHaveLength(70_000);
    expect(
      read.every((e, n) => e.crcOk && e.data.toString() === String(n))
    ).toBe(true);

    const tested = await unzipTest(zip);
    if (tested) expect(tested.ok).toBe(true);
  }, 60_000);

  it("fails the stream, and never closes the archive, when an entry's source throws", async () => {
    async function* broken() {
      yield text("first half");
      throw new Error("the chunk is gone");
    }
    const parts: Uint8Array[] = [];
    const run = async () => {
      for await (const part of zipChunks([
        { name: "a.bin", data: broken() },
        { name: "MANIFEST.txt", data: text("") },
      ])) {
        parts.push(part);
      }
    };
    await expect(run()).rejects.toThrow("the chunk is gone");
    // What was sent is a prefix with no central directory: it cannot open.
    expect(() => readZip(Buffer.concat(parts))).toThrow();
  });
});
