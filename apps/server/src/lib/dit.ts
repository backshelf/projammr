import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { loadDit } from "@workspace/dit/wasm";
import { saveContent } from "../db/queries/commits.js";
import { storedBody } from "./object-body.js";
import { sampleBytes, sampleLeaves } from "./sample-objects.js";

const gzipAsync = promisify(gzip);

/** A pack record's header: `[id 32][kind u8][body length u32 LE]`. */
const RECORD_HEADER_BYTES = 37;

/** Lays out records `[id 32][kind u8][body length u32 LE][body]` in one buffer. */
function buildPack(
  records: { hash: string; kind: number; body: Uint8Array }[]
): Buffer {
  let total = 0;
  for (const { body } of records)
    total += RECORD_HEADER_BYTES + body.byteLength;
  const pack = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const { hash, kind, body } of records) {
    Buffer.from(hash, "hex").copy(pack, offset);
    pack[offset + 32] = kind;
    pack.writeUInt32LE(body.byteLength, offset + 33);
    pack.set(body, offset + RECORD_HEADER_BYTES);
    offset += RECORD_HEADER_BYTES + body.byteLength;
  }
  return pack;
}

/**
 * A save's `.als` file, as dit writes it on checkout: a raw save (a file the
 * reader could not decode) is its stored file verbatim, reassembled from its
 * chunks when the object is Chunked; any other save is rebuilt from the objects
 * it links, through dit.wasm, and gzipped. Each rebuild takes a fresh module
 * instance and drops it when done, so the memory a large set grows it to is
 * reclaimed rather than kept for the process. Any other save with no content,
 * or an object it needs missing or corrupt, throws, and the caller answers 500
 * rather than a partial set.
 */
export async function saveFile(saveId: number): Promise<Uint8Array> {
  const { tree, side, raw, objects } = await saveContent(saveId);
  if (raw !== null) {
    const rawObject = objects.find((o) => o.hash === raw);
    if (!rawObject) {
      throw new Error(`save ${saveId} does not link its raw object ${raw}`);
    }
    const parts: Uint8Array[] = [];
    for await (const part of sampleBytes(
      await sampleLeaves(raw, rawObject.kind)
    )) {
      parts.push(part);
    }
    return Buffer.concat(parts);
  }
  if (tree == null || side == null) {
    throw new Error(`save ${saveId} has no tree or side object`);
  }

  // One file at a time: a set's tree names thousands of leaves, and opening
  // them all at once can run the process out of file descriptors.
  const records: { hash: string; kind: number; body: Uint8Array }[] = [];
  for (const { hash, kind } of objects) {
    try {
      records.push({ hash, kind, body: await storedBody(hash, kind) });
    } catch (error) {
      throw new Error(`object ${hash} of save ${saveId} is unreadable`, {
        cause: error,
      });
    }
  }

  const xml = loadDit().materialise(
    "ableton",
    buildPack(records),
    Buffer.from(tree, "hex"),
    Buffer.from(side, "hex")
  );
  return new Uint8Array(await gzipAsync(xml));
}
