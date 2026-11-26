import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { HTTPException } from "hono/http-exception";
import { byteReader } from "./byte-reader.js";
import { readZstdFrame } from "./zstd-frame.js";

/*
 * A pack is the objects one push uploads, as a run of records:
 *
 *   [id 32][kind u8][length u32 LE][zstd frame of `length` bytes]
 *
 * The frame is the object's file in dit's own store, unchanged: it
 * decompresses to the kind byte followed by the body, and `id` is the raw
 * SHA-256 of those decompressed bytes. The header's kind repeats the frame's
 * first byte so a record is classified before it is decompressed; the two
 * must agree. The frame is exactly one complete zstd frame, with nothing
 * before or after it, because it is stored as sent. Records are read and
 * verified one at a time as the body arrives (its length is declared up front
 * and held to the upload limit before the first byte is read) and handed on
 * in turn, and the route takes them into the repo in groups. A bad record
 * ends the pack: the records before it, its own group's included, are taken
 * and stay.
 */

/** The most bytes an object may take, as its frame or decompressed. */
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;

const ID_BYTES = 32;
/** The id, the kind byte and the frame's length. */
const HEADER_BYTES = ID_BYTES + 1 + 4;

/** dit numbers its object kinds 1 to 5. */
const isObjectKind = (kind: number) => kind >= 1 && kind <= 5;

/** One verified record: its object's hash, kind, and frame as dit sent it. */
export type PackRecord = { hash: string; kind: number; frame: Uint8Array };

/**
 * The header of one record of a pack an object is sent in: its id, its kind
 * and the length of its stored frame, in the layout a pack upload reads.
 */
export function packRecordHeader(
  hash: string,
  kind: number,
  frameLength: number
): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(Buffer.from(hash, "hex"), 0);
  const view = new DataView(header.buffer);
  view.setUint8(ID_BYTES, kind);
  view.setUint32(ID_BYTES + 1, frameLength, true);
  return header;
}

const tooLarge = () =>
  new HTTPException(413, {
    message: `Object is over the ${MAX_OBJECT_BYTES}-byte limit`,
  });

/**
 * A body that stops inside a record. A pack over a proxy's body limit arrives
 * this way, cut short rather than refused.
 */
const truncated = () =>
  new HTTPException(400, {
    message: "Pack is truncated: the body ended inside a record",
  });

/**
 * What `frame` decompresses to. The decoder alone takes trailing bytes and a
 * truncated frame, so the frame's structure is walked first and must be one
 * whole frame, and the output must be the size the frame's header declares.
 */
function decompress(hash: string, frame: Uint8Array): Uint8Array {
  const notOneFrame = () =>
    new HTTPException(400, { message: `Object ${hash} is not one zstd frame` });

  const info = readZstdFrame(frame);
  if (!info) throw notOneFrame();
  if (info.contentSize !== null && info.contentSize > MAX_OBJECT_BYTES) {
    throw tooLarge();
  }

  let content: Uint8Array;
  try {
    content = zstdDecompressSync(frame, { maxOutputLength: MAX_OBJECT_BYTES });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw tooLarge();
    }
    throw notOneFrame();
  }
  if (info.contentSize !== null && content.length !== info.contentSize) {
    throw notOneFrame();
  }
  return content;
}

/**
 * The records of the pack `body` carries, each verified before it is yielded:
 * its frame is within the limit and arrived whole, its kind is one dit
 * writes, its frame is exactly one zstd frame, and its id is the hash of its
 * content. The first record that fails
 * ends the pack with a 400, or a 413 for one over the limit. A request with no
 * body is an empty pack.
 */
export async function* packRecords(
  body: ReadableStream<Uint8Array> | null
): AsyncGenerator<PackRecord> {
  if (!body) return;
  const { read } = byteReader(body);

  for (;;) {
    const header = await read(HEADER_BYTES);
    if (header.length === 0) return;
    if (header.length < HEADER_BYTES) throw truncated();

    const hash = Buffer.from(header.subarray(0, ID_BYTES)).toString("hex");
    const kind = header[ID_BYTES]!;
    const length = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    ).getUint32(ID_BYTES + 1, true);

    if (length > MAX_OBJECT_BYTES) throw tooLarge();
    if (!isObjectKind(kind)) {
      throw new HTTPException(400, {
        message: `Object ${hash} has an unknown kind: ${kind}`,
      });
    }

    const frame = await read(length);
    if (frame.length < length) throw truncated();

    const content = decompress(hash, frame);
    if (content[0] !== kind) {
      throw new HTTPException(400, {
        message: `Object ${hash} does not start with its kind byte ${kind}`,
      });
    }
    if (createHash("sha256").update(content).digest("hex") !== hash) {
      throw new HTTPException(400, {
        message: `Object ${hash} does not match its content`,
      });
    }

    yield { hash, kind, frame };
  }
}
