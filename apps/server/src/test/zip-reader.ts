import { crc32 } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One entry of a zip as its central directory lists it, with its data. */
export type ReadEntry = { name: string; data: Buffer; crcOk: boolean };

/**
 * Reads a zip by its central directory, the way a desktop unarchiver does,
 * independently of the writer that made it: ZIP64 end records, 64-bit sizes
 * and offsets in the extra field, and each entry's checksum.
 */
export function readZip(bytes: Uint8Array): ReadEntry[] {
  const zip = Buffer.from(bytes);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory");

  let count = zip.readUInt16LE(end + 10);
  let directoryAt = zip.readUInt32LE(end + 16);
  if (count === 0xffff || directoryAt === 0xffffffff) {
    const locator = end - 20;
    if (zip.readUInt32LE(locator) !== 0x07064b50) {
      throw new Error("no ZIP64 locator");
    }
    const record = Number(zip.readBigUInt64LE(locator + 8));
    if (zip.readUInt32LE(record) !== 0x06064b50)
      throw new Error("no ZIP64 end");
    count = Number(zip.readBigUInt64LE(record + 32));
    directoryAt = Number(zip.readBigUInt64LE(record + 48));
  }

  const entries: ReadEntry[] = [];
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50)
      throw new Error("bad central entry");
    const crc = zip.readUInt32LE(at + 16);
    let compressed = zip.readUInt32LE(at + 20);
    let size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    let offset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);

    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra < extraEnd) {
      const id = zip.readUInt16LE(extra);
      const length = zip.readUInt16LE(extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = Number(zip.readBigUInt64LE(field));
          field += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = Number(zip.readBigUInt64LE(field));
          field += 8;
        }
        if (offset === 0xffffffff) offset = Number(zip.readBigUInt64LE(field));
      }
      extra += 4 + length;
    }

    if (zip.readUInt32LE(offset) !== 0x04034b50)
      throw new Error("bad local header");
    const dataAt =
      offset +
      30 +
      zip.readUInt16LE(offset + 26) +
      zip.readUInt16LE(offset + 28);
    const data = zip.subarray(dataAt, dataAt + compressed);
    entries.push({
      name,
      data,
      crcOk: compressed === size && crc32(data) === crc,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * `unzip -t` over the bytes, when the tool is installed: its output and whether
 * it exited cleanly. Null on a machine without it.
 */
export async function unzipTest(
  bytes: Uint8Array
): Promise<{ ok: boolean; output: string } | null> {
  const tool = Bun.which("unzip");
  if (!tool) return null;
  const dir = await mkdtemp(join(tmpdir(), "zip-test-"));
  try {
    const file = join(dir, "archive.zip");
    await writeFile(file, bytes);
    const run = Bun.spawn([tool, "-t", file], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ]);
    return { ok: (await run.exited) === 0, output: output + errors };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
