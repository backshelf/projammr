import { zstdDecompressSync } from "node:zlib";
import { objectKey, readStoredBytes } from "./storage.js";

/** The most bytes one object may decompress to, as on upload. */
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;

/**
 * An object's body, read from its stored file: zstd of `[kind byte] ++ body`.
 * Throws on a missing or unreadable file, a frame that does not decompress,
 * or a kind byte that disagrees with the object's row.
 */
export async function storedBody(hash: string, kind: number): Promise<Buffer> {
  const frame = await readStoredBytes(objectKey(hash));
  const content = zstdDecompressSync(frame, {
    maxOutputLength: MAX_OBJECT_BYTES,
  });
  if (content[0] !== kind) {
    throw new Error(
      `object ${hash} starts with kind byte ${content[0]}, its row says ${kind}`
    );
  }
  return content.subarray(1);
}
