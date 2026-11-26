import { describe, expect, it } from "bun:test";
import { byteReader } from "./byte-reader.js";

/** A stream that delivers `chunks` one at a time, as a request body would. */
const streamOf = (...chunks: number[][]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });

const bytes = (array: Uint8Array) => [...array];

describe("byteReader", () => {
  it("joins a read that spans several chunks", async () => {
    const { read } = byteReader(streamOf([1, 2], [3], [4, 5, 6]));

    expect(bytes(await read(5))).toEqual([1, 2, 3, 4, 5]);
    expect(bytes(await read(1))).toEqual([6]);
  });

  it("splits one chunk across several reads", async () => {
    const { read } = byteReader(streamOf([1, 2, 3, 4, 5, 6, 7]));

    expect(bytes(await read(2))).toEqual([1, 2]);
    expect(bytes(await read(3))).toEqual([3, 4, 5]);
    expect(bytes(await read(2))).toEqual([6, 7]);
  });

  it("reads a header split across chunks and the frame that follows it in the same chunk", async () => {
    const { read } = byteReader(streamOf([1, 2, 3], [4, 9, 9, 9], [9, 8]));

    expect(bytes(await read(4))).toEqual([1, 2, 3, 4]);
    expect(bytes(await read(4))).toEqual([9, 9, 9, 9]);
    expect(bytes(await read(1))).toEqual([8]);
  });

  it("answers with nothing once the stream has ended on a read boundary", async () => {
    const { read } = byteReader(streamOf([1, 2], [3]));

    expect(bytes(await read(3))).toEqual([1, 2, 3]);
    expect((await read(37)).length).toBe(0);
  });

  it("answers with what is left when the stream ends before a read is satisfied", async () => {
    const { read } = byteReader(streamOf([1, 2], [3]));

    expect(bytes(await read(2))).toEqual([1, 2]);
    expect(bytes(await read(10))).toEqual([3]);
    expect((await read(1)).length).toBe(0);
  });

  it("skips empty chunks", async () => {
    const { read } = byteReader(streamOf([], [1], [], [2, 3]));

    expect(bytes(await read(3))).toEqual([1, 2, 3]);
  });

  it("reads nothing for a read of no bytes", async () => {
    const { read } = byteReader(streamOf([1]));

    expect((await read(0)).length).toBe(0);
    expect(bytes(await read(1))).toEqual([1]);
  });

  it("passes on the error a stream raises", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
        controller.error(new Error("over the limit"));
      },
    });
    const { read } = byteReader(failing);

    await expect(read(2)).rejects.toThrow("over the limit");
  });
});
