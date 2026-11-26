import { stat } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { objects } from "../db/schema/objects.js";
import { chunk } from "./chunk.js";
import { storedBody } from "./object-body.js";
import { objectKey, storedFilePath } from "./storage.js";

/** An object kind byte, as `objects.kind` stores it. */
const KIND_BLOB = 1;
const KIND_CHUNKED = 2;

/** The chunk ids a Chunked object's body names: 32 bytes each, in order. */
function chunkIds(body: Uint8Array): string[] {
  if (body.byteLength % 32 !== 0) {
    throw new Error("a Chunked body is not a whole number of ids");
  }
  const ids: string[] = [];
  for (let at = 0; at < body.byteLength; at += 32) {
    ids.push(Buffer.from(body.subarray(at, at + 32)).toString("hex"));
  }
  return ids;
}

/**
 * The ids a push names as a commit's sample objects, with the chunks of every
 * Chunked one among them: a chunk is a Blob the repo holds on its own, and the
 * retention sweep keeps only what a link names. An object the hub lacks, or a
 * Chunked file that cannot be read, adds nothing; the caller keeps the ids it
 * was given.
 */
export async function withChunks(hashes: string[]): Promise<string[]> {
  const all = new Set(hashes);
  for (const batch of chunk(hashes, 5_000)) {
    const rows = await db
      .select({ hash: objects.hash, kind: objects.kind })
      .from(objects)
      .where(inArray(objects.hash, batch));
    for (const row of rows) {
      if (row.kind !== KIND_CHUNKED) continue;
      try {
        for (const id of chunkIds(await storedBody(row.hash, row.kind))) {
          all.add(id);
        }
      } catch {
        // The unreadable file is reported when a download reads it.
      }
    }
  }
  return [...all];
}

/**
 * The Blob objects a sample's bytes are the concatenation of: a Blob is its
 * own one leaf, a Chunked object names its chunks in order. Throws when a
 * Chunked file is missing or malformed.
 */
export async function sampleLeaves(
  hash: string,
  kind: number
): Promise<string[]> {
  if (kind === KIND_BLOB) return [hash];
  if (kind !== KIND_CHUNKED) throw new Error(`object ${hash} is not a sample`);
  return chunkIds(await storedBody(hash, kind));
}

/**
 * Whether every leaf's stored file is there. One `stat` each, never an open
 * file, so a sample of thousands of chunks holds no descriptor: a download
 * checks this before its first byte, since bytes sent cannot be taken back.
 */
export async function leavesPresent(leaves: string[]): Promise<boolean> {
  for (const leaf of leaves) {
    try {
      await stat(storedFilePath(objectKey(leaf)));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * A sample's bytes, one leaf at a time. A leaf that has vanished or fails to
 * decode since the check throws, which ends the response it is part of.
 */
export async function* sampleBytes(
  leaves: string[]
): AsyncGenerator<Uint8Array> {
  for (const leaf of leaves) yield await storedBody(leaf, KIND_BLOB);
}
