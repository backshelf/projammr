import { constants, zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "bun:test";
import { readZstdFrame } from "./zstd-frame.js";

const frameOf = (
  data: Uint8Array,
  params: Record<number, number> = {}
): Uint8Array =>
  zstdCompressSync(data, {
    params: { [constants.ZSTD_c_compressionLevel]: 3, ...params },
  });

const join = (...parts: Iterable<number>[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

/** Text that compresses to one small compressed block. */
const text = Buffer.from("hello hello hello ".repeat(20));

/** Bytes with no repeated text, enough of them to span several compressed blocks. */
const noise = (length: number) =>
  Uint8Array.from({ length }, (_, i) => ((i * 2654435761) >>> 13) & 255);

const SKIPPABLE = [0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0];

describe("readZstdFrame", () => {
  describe("accepts exactly one complete frame", () => {
    for (const level of [1, 3, 19]) {
      it(`at level ${level}, with its content size`, () => {
        const frame = frameOf(text, {
          [constants.ZSTD_c_compressionLevel]: level,
        });
        expect(readZstdFrame(frame)).toEqual({ contentSize: text.length });
      });

      it(`at level ${level}, without a content size`, () => {
        const frame = frameOf(text, {
          [constants.ZSTD_c_compressionLevel]: level,
          [constants.ZSTD_c_contentSizeFlag]: 0,
        });
        expect(readZstdFrame(frame)).toEqual({ contentSize: null });
      });
    }

    it("with a content checksum", () => {
      const frame = frameOf(text, { [constants.ZSTD_c_checksumFlag]: 1 });
      expect(readZstdFrame(frame)).toEqual({ contentSize: text.length });
    });

    it("of an input that fits in no block at all", () => {
      expect(readZstdFrame(frameOf(new Uint8Array(0)))).toEqual({
        contentSize: 0,
      });
    });

    // The content size field is 1, 2 or 4 bytes wide by size, and the
    // 2-byte form stores the size less 256.
    for (const size of [1, 255, 256, 65_791, 65_792, 300_000]) {
      it(`declaring a content size of ${size}`, () => {
        const frame = frameOf(noise(size));
        expect(readZstdFrame(frame)).toEqual({ contentSize: size });
      });
    }

    it("of several blocks, noise and a long run of one byte alike", () => {
      const data = join(noise(400_000), new Uint8Array(500_000).fill(9));
      for (const checksum of [0, 1]) {
        const frame = frameOf(data, {
          [constants.ZSTD_c_checksumFlag]: checksum,
        });
        expect(readZstdFrame(frame)).toEqual({ contentSize: data.length });
      }
    });

    it("of one byte repeated, which zstd writes as RLE blocks", () => {
      const run = new Uint8Array(1_000_000).fill(7);
      const frame = frameOf(run);
      // 1 MB in under a hundred bytes: only RLE blocks can do that.
      expect(frame.length).toBeLessThan(100);
      expect(readZstdFrame(frame)).toEqual({ contentSize: run.length });
    });

    it("of an input larger than a block with no content size", () => {
      const data = join(noise(300_000), new Uint8Array(300_000).fill(1));
      const frame = frameOf(data, { [constants.ZSTD_c_contentSizeFlag]: 0 });
      expect(readZstdFrame(frame)).toEqual({ contentSize: null });
    });

    it("declaring its size in eight bytes", () => {
      // magic, descriptor (8-byte size, single segment), size, one empty last raw block
      const frame = join(
        [0x28, 0xb5, 0x2f, 0xfd, 0xe0],
        [0x39, 0x30, 0, 0, 0, 0, 0, 0],
        [0x01, 0, 0]
      );
      expect(readZstdFrame(frame)).toEqual({ contentSize: 12_345 });
    });

    it("naming dictionary id zero", () => {
      const frame = frameOf(text);
      const withId = join(
        frame.subarray(0, 4),
        [frame[4]! | 0b01],
        [0],
        frame.subarray(5)
      );
      expect(readZstdFrame(withId)).toEqual({ contentSize: text.length });
    });
  });

  describe("refuses", () => {
    const frame = frameOf(text);

    it("an empty buffer", () => {
      expect(readZstdFrame(new Uint8Array(0))).toBeNull();
    });

    it("a frame truncated at every length", () => {
      for (let length = 0; length < frame.length; length++) {
        expect(readZstdFrame(frame.subarray(0, length))).toBeNull();
      }
    });

    it("a large frame truncated at several points", () => {
      const big = frameOf(
        join(noise(400_000), new Uint8Array(500_000).fill(9)),
        {
          [constants.ZSTD_c_checksumFlag]: 1,
        }
      );
      for (const fraction of [0.01, 0.25, 0.5, 0.9, 0.999]) {
        const cut = big.subarray(0, Math.floor(big.length * fraction));
        expect(readZstdFrame(cut)).toBeNull();
      }
      // The four checksum bytes are part of the frame.
      for (const missing of [1, 2, 3, 4]) {
        expect(readZstdFrame(big.subarray(0, big.length - missing))).toBeNull();
      }
    });

    it("bytes after the frame", () => {
      expect(readZstdFrame(join(frame, [0]))).toBeNull();
      expect(readZstdFrame(join(frame, [0, 0, 0]))).toBeNull();
    });

    it("two frames", () => {
      expect(readZstdFrame(join(frame, frame))).toBeNull();
    });

    it("a frame followed by a skippable frame", () => {
      expect(readZstdFrame(join(frame, SKIPPABLE))).toBeNull();
    });

    it("a skippable frame alone", () => {
      expect(readZstdFrame(Uint8Array.from(SKIPPABLE))).toBeNull();
    });

    it("a wrong magic number", () => {
      const bad = Uint8Array.from(frame);
      bad[0] = bad[0]! ^ 1;
      expect(readZstdFrame(bad)).toBeNull();
    });

    it("a frame whose reserved descriptor bit is set", () => {
      const bad = Uint8Array.from(frame);
      bad[4] = bad[4]! | 0b0000_1000;
      expect(readZstdFrame(bad)).toBeNull();
    });

    it("a frame whose first block has the reserved type", () => {
      // magic 4, descriptor 1, then the 2-byte content size of a single segment.
      const blockHeader = 7;
      const bad = Uint8Array.from(frame);
      bad[blockHeader] = bad[blockHeader]! | 0b110;
      expect(readZstdFrame(bad)).toBeNull();
    });

    it("a frame that names a dictionary", () => {
      for (const [flag, id] of [
        [0b01, [5]],
        [0b10, [1, 0]],
        [0b11, [0, 0, 0, 1]],
      ] as const) {
        const withId = join(
          frame.subarray(0, 4),
          [frame[4]! | flag],
          id,
          frame.subarray(5)
        );
        expect(readZstdFrame(withId)).toBeNull();
      }
    });

    it("a content size past what a number holds", () => {
      const frame8 = join(
        [0x28, 0xb5, 0x2f, 0xfd, 0xe0],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        [0x01, 0, 0]
      );
      expect(readZstdFrame(frame8)).toBeNull();
    });
  });
});
