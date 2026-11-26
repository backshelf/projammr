/*
 * Reads the structure of a zstd frame (RFC 8878 §3.1.1) without decompressing
 * it, to tell a buffer that is exactly one complete frame from one that only
 * decompresses: Bun's decoder takes trailing bytes and concatenated frames
 * without complaint, and answers a truncated frame with partial or empty
 * output instead of an error.
 */

const MAGIC = 0xfd2fb528;
const RLE_BLOCK = 1;
const RESERVED_BLOCK = 3;
const BLOCK_HEADER_BYTES = 3;
const CHECKSUM_BYTES = 4;

/** The Dictionary_ID field's size for each Dictionary_ID_flag value. */
const DICTIONARY_ID_BYTES = [0, 1, 2, 4] as const;

export type ZstdFrameInfo = {
  /** The decompressed size the frame header declares, when it declares one. */
  contentSize: number | null;
};

/**
 * What the header of `bytes` declares, when `bytes` is exactly one complete
 * zstd frame that needs no dictionary; `null` for anything else: another
 * magic number, a reserved bit or block type, a dictionary, bytes that run
 * out inside the frame, or bytes left over after it (a second frame and a
 * skippable frame included).
 */
export function readZstdFrame(bytes: Uint8Array): ZstdFrameInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** Whether `count` more bytes exist at `at`. */
  const has = (at: number, count: number) => at + count <= bytes.length;
  /** An unsigned little-endian integer of 1, 2 or 4 bytes. */
  const uint = (at: number, size: number) =>
    size === 1
      ? view.getUint8(at)
      : size === 2
        ? view.getUint16(at, true)
        : view.getUint32(at, true);

  if (!has(0, 5) || view.getUint32(0, true) !== MAGIC) return null;

  const descriptor = bytes[4]!;
  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor & 0b0010_0000) !== 0;
  const contentChecksum = (descriptor & 0b0000_0100) !== 0;
  const reservedBit = (descriptor & 0b0000_1000) !== 0;
  const dictionaryIdBytes = DICTIONARY_ID_BYTES[descriptor & 0b11]!;
  if (reservedBit) return null;

  let at = 5;
  if (!singleSegment) at += 1; // Window_Descriptor

  if (!has(at, dictionaryIdBytes)) return null;
  if (dictionaryIdBytes > 0 && uint(at, dictionaryIdBytes) !== 0) return null;
  at += dictionaryIdBytes;

  // A zero flag still means one byte when the frame is a single segment.
  const sizeBytes =
    contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
  if (!has(at, sizeBytes)) return null;
  let contentSize: number | null = null;
  if (sizeBytes === 8) {
    const size = view.getBigUint64(at, true);
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    contentSize = Number(size);
  } else if (sizeBytes > 0) {
    contentSize = uint(at, sizeBytes) + (sizeBytes === 2 ? 256 : 0);
  }
  at += sizeBytes;

  for (let last = false; !last;) {
    if (!has(at, BLOCK_HEADER_BYTES)) return null;
    const header = uint(at, 2) | (bytes[at + 2]! << 16);
    last = (header & 1) !== 0;
    const type = (header >> 1) & 0b11;
    // An RLE block's size is what it regenerates; it stores one byte.
    const stored = type === RLE_BLOCK ? 1 : header >> 3;
    if (type === RESERVED_BLOCK) return null;
    at += BLOCK_HEADER_BYTES;
    if (!has(at, stored)) return null;
    at += stored;
  }

  if (contentChecksum) {
    if (!has(at, CHECKSUM_BYTES)) return null;
    at += CHECKSUM_BYTES;
  }

  return at === bytes.length ? { contentSize } : null;
}
