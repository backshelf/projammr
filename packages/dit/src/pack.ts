import { createHash } from "node:crypto";
import { constants, zstdCompressSync } from "node:zlib";

// Builds the pack the hub's `POST /repos/:id/objects` takes, for tests of the
// server and for the demo's seed: objects as dit stores them, zstd-framed.

/** One object as a pack carries it: its id as hex, its kind and its zstd frame. */
export type PackRecord = { hash: string; kind: number; frame: Uint8Array };

/**
 * An object as dit stores and packs it: its kind byte and `content`,
 * compressed at zstd level 3 and named by the SHA-256 of those same bytes.
 * `frameKind` writes a different first byte into the frame than the header
 * carries, for a case that needs the two to disagree. `params` are further zstd
 * compression parameters, such as leaving the content size out of the frame.
 */
export function objectRecord(
  content: string | Uint8Array,
  kind = 1,
  frameKind = kind,
  params: Record<number, number> = {}
): PackRecord {
  const body = typeof content === "string" ? Buffer.from(content) : content;
  const raw = Buffer.concat([Uint8Array.of(frameKind), body]);
  return {
    hash: createHash("sha256").update(raw).digest("hex"),
    kind,
    frame: zstdCompressSync(raw, {
      params: { [constants.ZSTD_c_compressionLevel]: 3, ...params },
    }),
  };
}

/**
 * A record as a pack carries it, `[id 32][kind u8][length u32 LE][frame]`.
 * `length` is the frame's own unless a case needs the header to say otherwise.
 */
export function recordBytes(
  { hash, kind, frame }: PackRecord,
  length = frame.length
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(37 + frame.length);
  bytes.set(Buffer.from(hash, "hex"), 0);
  bytes[32] = kind;
  new DataView(bytes.buffer).setUint32(33, length, true);
  bytes.set(frame, 37);
  return bytes;
}

/** `parts` end to end, as one request body. */
export const concatBytes = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.concat(parts));

/** The pack of `records`, in order. */
export const packOf = (...records: PackRecord[]) =>
  concatBytes(...records.map((record) => recordBytes(record)));
