import { crc32 } from "node:zlib";

/**
 * A store-only ZIP writer that streams: entries go out as they are read, so
 * an archive of many gigabytes is never held in memory. Audio is already
 * compressed, so an entry is stored as it is.
 *
 * An entry whose bytes are in hand is written with its size and checksum in
 * its header. An entry that streams does not know either until it ends, so its
 * header leaves them out (general-purpose flag bit 3) and a data descriptor
 * after the bytes carries them; those entries are written ZIP64 throughout
 * (an empty ZIP64 extra in the header, 8-byte sizes in the descriptor), since
 * the size is not known to fit 32 bits. The central directory at the end lists
 * every entry, and gains a ZIP64 record when the archive passes 65,534 entries
 * or 4 GiB.
 */

export type ZipEntry = {
  /** The path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array | AsyncIterable<Uint8Array>;
  modified?: Date;
};

type Listed = {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  streamed: boolean;
  dosDate: number;
  dosTime: number;
};

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** Flag bits: 3 = sizes follow the data, 11 = the name is UTF-8. */
const FLAG_UTF8 = 0x0800;
const FLAG_DESCRIPTOR = 0x0008;

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

/** `made by` host 3 (Unix) with version 4.5, and a regular file's mode in the high external bits. */
const MADE_BY = (3 << 8) | 45;
const FILE_MODE = (0o100644 << 16) >>> 0;

function dos(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate:
      ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1),
  };
}

/** Version needed to extract: 4.5 (ZIP64), the same in an entry's local and central headers. */
const VERSION_NEEDED = 45;

function localHeader(entry: Listed): Buffer {
  const extra = entry.streamed ? 20 : 0;
  const header = Buffer.alloc(30 + entry.name.length + extra);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAG_UTF8 | (entry.streamed ? FLAG_DESCRIPTOR : 0), 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  if (entry.streamed) {
    header.writeUInt32LE(U32_MAX, 18);
    header.writeUInt32LE(U32_MAX, 22);
  } else {
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.size, 18);
    header.writeUInt32LE(entry.size, 22);
  }
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(extra, 28);
  entry.name.copy(header, 30);
  if (entry.streamed) {
    const at = 30 + entry.name.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(16, at + 2);
    // Sizes of 0: the descriptor after the data has the real ones.
  }
  return header;
}

function dataDescriptor(entry: Listed): Buffer {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(entry.crc, 4);
  descriptor.writeBigUInt64LE(BigInt(entry.size), 8);
  descriptor.writeBigUInt64LE(BigInt(entry.size), 16);
  return descriptor;
}

function centralHeader(entry: Listed): Buffer {
  const big = {
    size: entry.size >= U32_MAX,
    offset: entry.offset >= U32_MAX,
  };
  const wide = [
    ...(big.size ? [entry.size, entry.size] : []),
    ...(big.offset ? [entry.offset] : []),
  ];
  const extra = wide.length > 0 ? 4 + 8 * wide.length : 0;
  const header = Buffer.alloc(46 + entry.name.length + extra);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(MADE_BY, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAG_UTF8 | (entry.streamed ? FLAG_DESCRIPTOR : 0), 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(big.size ? U32_MAX : entry.size, 20);
  header.writeUInt32LE(big.size ? U32_MAX : entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(extra, 30);
  header.writeUInt32LE(FILE_MODE, 38);
  header.writeUInt32LE(big.offset ? U32_MAX : entry.offset, 42);
  entry.name.copy(header, 46);
  if (extra > 0) {
    const at = 46 + entry.name.length;
    header.writeUInt16LE(0x0001, at);
    header.writeUInt16LE(8 * wide.length, at + 2);
    wide.forEach((value, i) =>
      header.writeBigUInt64LE(BigInt(value), at + 4 + 8 * i)
    );
  }
  return header;
}

function endRecords(count: number, directorySize: number, directoryAt: number) {
  const needsZip64 =
    count >= U16_MAX || directorySize >= U32_MAX || directoryAt >= U32_MAX;
  const parts: Buffer[] = [];
  if (needsZip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_EOCD_SIGNATURE, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(MADE_BY, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryAt), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeBigUInt64LE(BigInt(directoryAt + directorySize), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(needsZip64 ? U16_MAX : count, 8);
  end.writeUInt16LE(needsZip64 ? U16_MAX : count, 10);
  end.writeUInt32LE(needsZip64 ? U32_MAX : directorySize, 12);
  end.writeUInt32LE(needsZip64 ? U32_MAX : directoryAt, 16);
  parts.push(end);
  return parts;
}

/**
 * The archive of `entries`, in order, as the chunks to send. An entry's data
 * is read as the consumer pulls, one chunk at a time, and a source that throws
 * ends the generator with that error: bytes sent cannot be taken back, so the
 * caller streams it as a response that fails rather than one that closes
 * cleanly on a truncated file.
 */
export async function* zipChunks(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>
): AsyncGenerator<Uint8Array> {
  const listed: Listed[] = [];
  let at = 0;
  const emit = (bytes: Uint8Array) => {
    at += bytes.byteLength;
    return bytes;
  };

  for await (const entry of entries) {
    const when = dos(entry.modified ?? new Date());
    const name = Buffer.from(entry.name, "utf8");
    if (name.length > U16_MAX) throw new Error("zip entry name is too long");

    if (entry.data instanceof Uint8Array) {
      const item: Listed = {
        name,
        crc: crc32(entry.data),
        size: entry.data.byteLength,
        offset: at,
        streamed: false,
        ...when,
      };
      listed.push(item);
      yield emit(localHeader(item));
      if (entry.data.byteLength > 0) yield emit(entry.data);
      continue;
    }

    const item: Listed = {
      name,
      crc: 0,
      size: 0,
      offset: at,
      streamed: true,
      ...when,
    };
    yield emit(localHeader(item));
    for await (const chunk of entry.data) {
      item.crc = crc32(chunk, item.crc);
      item.size += chunk.byteLength;
      if (chunk.byteLength > 0) yield emit(chunk);
    }
    listed.push(item);
    yield emit(dataDescriptor(item));
  }

  const directoryAt = at;
  for (const item of listed) yield emit(centralHeader(item));
  const directorySize = at - directoryAt;
  for (const record of endRecords(listed.length, directorySize, directoryAt)) {
    yield emit(record);
  }
}
