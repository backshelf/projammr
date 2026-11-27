import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { type S3ClientLike, type S3FileLike, S3StorageBackend } from "./s3.js";
import { normalizeS3Prefix } from "./types.js";

type StoredObj = {
  bytes: Uint8Array;
  type: string;
  lastModified: Date;
};

/**
 * In-memory fake implementing {@link S3ClientLike}, supporting prefix listing
 * pagination, byte-range slicing, content types, and concurrency tracking.
 */
function createFakeS3Client(options: { pageSize?: number } = {}) {
  const store = new Map<string, StoredObj>();
  const pageSize = options.pageSize ?? 2;
  let inFlightWrites = 0;
  let maxConcurrentWrites = 0;
  const sliceCalls: { key: string; begin?: number; end?: number }[] = [];
  const writeTypes = new Map<string, string | undefined>();
  const listPrefixes: string[] = [];

  function makeFile(key: string, start?: number, end?: number): S3FileLike {
    return {
      async bytes(): Promise<Uint8Array> {
        const entry = store.get(key);
        if (!entry) {
          const err = new Error(`NoSuchKey: ${key}`) as Error & {
            code: string;
          };
          err.code = "NoSuchKey";
          throw err;
        }
        return entry.bytes.slice(start, end);
      },
      stream(): ReadableStream<Uint8Array> {
        const entry = store.get(key);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            if (!entry) {
              controller.error(new Error(`NoSuchKey: ${key}`));
              return;
            }
            const slice = entry.bytes.slice(start, end);
            if (slice.byteLength > 0) controller.enqueue(slice);
            controller.close();
          },
        });
      },
      slice(begin?: number, sliceEnd?: number): S3FileLike {
        sliceCalls.push({ key, begin, end: sliceEnd });
        return makeFile(key, begin, sliceEnd);
      },
    };
  }

  const client: S3ClientLike = {
    file(path) {
      return makeFile(path);
    },
    async exists(path) {
      return store.has(path);
    },
    async stat(path) {
      const entry = store.get(path);
      if (!entry) {
        const err = new Error(`NotFound: ${path}`) as Error & {
          status: number;
          code: string;
        };
        err.status = 404;
        err.code = "ERR_S3_MISSING_KEY";
        throw err;
      }
      return { size: entry.bytes.byteLength, lastModified: entry.lastModified };
    },
    async write(path, data, writeOpts) {
      inFlightWrites++;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, inFlightWrites);
      try {
        await Bun.sleep(1);
        const bytes =
          data instanceof Uint8Array
            ? new Uint8Array(data)
            : new Uint8Array(await data.bytes());
        writeTypes.set(path, writeOpts?.type);
        store.set(path, {
          bytes,
          type: writeOpts?.type ?? "application/octet-stream",
          lastModified: new Date("2026-05-01T12:00:00Z"),
        });
        return bytes.byteLength;
      } finally {
        inFlightWrites--;
      }
    },
    async delete(path) {
      if (!store.has(path)) {
        const err = new Error("NoSuchKey") as Error & { code: string };
        err.code = "NoSuchKey";
        throw err;
      }
      store.delete(path);
    },
    async list(input) {
      const prefix = input?.prefix ?? "";
      listPrefixes.push(prefix);
      const matching = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const offset = input?.continuationToken
        ? Number(input.continuationToken)
        : 0;
      const page = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      const isTruncated = nextOffset < matching.length;
      return {
        contents: page.map(([key, value]) => ({
          key,
          size: value.bytes.byteLength,
          lastModified: value.lastModified.toISOString(),
        })),
        isTruncated,
        nextContinuationToken: isTruncated ? String(nextOffset) : undefined,
      };
    },
  };

  return {
    client,
    store,
    sliceCalls,
    writeTypes,
    listPrefixes,
    getMaxConcurrentWrites: () => maxConcurrentWrites,
  };
}

describe("normalizeS3Prefix", () => {
  it("normalizes empty, leading, and trailing slashes", () => {
    expect(normalizeS3Prefix(undefined)).toBe("");
    expect(normalizeS3Prefix("")).toBe("");
    expect(normalizeS3Prefix("///")).toBe("");
    expect(normalizeS3Prefix("prod")).toBe("prod/");
    expect(normalizeS3Prefix("/prod/media/")).toBe("prod/media/");
    expect(normalizeS3Prefix("  /a/b//  ")).toBe("a/b/");
  });
});

describe("S3StorageBackend", () => {
  it("applies normalized S3_PREFIX to every read, write, stat, exists, and delete", async () => {
    const fake = createFakeS3Client();
    const backend = new S3StorageBackend({
      client: fake.client,
      prefix: "/tenant-a/prod/",
    });

    expect(backend.kind).toBe("s3");
    expect(backend.prefix).toBe("tenant-a/prod/");

    await backend.putBytes(
      "assets/demo.wav",
      new Uint8Array([1, 2, 3, 4]),
      "audio/wav"
    );

    expect(fake.store.has("tenant-a/prod/assets/demo.wav")).toBe(true);
    expect(fake.writeTypes.get("tenant-a/prod/assets/demo.wav")).toBe(
      "audio/wav"
    );
    expect(await backend.exists("assets/demo.wav")).toBe(true);
    expect(await backend.exists("assets/missing.wav")).toBe(false);

    const info = await backend.stat("assets/demo.wav");
    expect(info).toEqual({
      size: 4,
      modifiedAt: new Date("2026-05-01T12:00:00Z"),
    });
    expect(await backend.stat("assets/missing.wav")).toBeNull();

    expect(await backend.readBytes("assets/demo.wav")).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );

    expect(await backend.remove("assets/demo.wav")).toBe(true);
    expect(await backend.exists("assets/demo.wav")).toBe(false);
    // Deleting an already-missing object still succeeds.
    expect(await backend.remove("assets/demo.wav")).toBe(true);
  });

  it("streams full objects and inclusive byte ranges via s3.file().slice(start, end + 1)", async () => {
    const fake = createFakeS3Client();
    const backend = new S3StorageBackend({ client: fake.client });
    const data = new TextEncoder().encode("0123456789abcdef");
    await backend.putBytes("assets/range.bin", data);

    const full = new Uint8Array(
      await new Response(backend.readStream("assets/range.bin")).arrayBuffer()
    );
    expect(full).toEqual(data);

    const partial = new Uint8Array(
      await new Response(
        backend.readStream("assets/range.bin", [4, 9])
      ).arrayBuffer()
    );
    expect(new TextDecoder().decode(partial)).toBe("456789");
    expect(fake.sliceCalls).toContainEqual({
      key: "assets/range.bin",
      begin: 4,
      end: 10,
    });
  });

  it("streams a local file to S3 in putFromFile", async () => {
    const fake = createFakeS3Client();
    const backend = new S3StorageBackend({ client: fake.client });
    const dir = await mkdtemp(join(tmpdir(), "projammr-s3-test-"));
    const tempFile = join(dir, "upload.mp3");
    try {
      await writeFile(tempFile, new Uint8Array([0x49, 0x44, 0x33, 0x04]));
      await backend.putFromFile("assets/upload.mp3", tempFile, "audio/mpeg");

      expect(await backend.readBytes("assets/upload.mp3")).toEqual(
        new Uint8Array([0x49, 0x44, 0x33, 0x04])
      );
      expect(fake.writeTypes.get("assets/upload.mp3")).toBe("audio/mpeg");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uploads objects with bounded concurrency (<= 16)", async () => {
    const fake = createFakeS3Client();
    const backend = new S3StorageBackend({ client: fake.client });
    const files = Array.from({ length: 40 }, (_, i) => ({
      key: `objects/aa/${String(i).padStart(64, "0")}`,
      bytes: new Uint8Array([i]),
    }));

    await backend.putObjects(files);

    expect(fake.store.size).toBe(40);
    expect(fake.getMaxConcurrentWrites()).toBeLessThanOrEqual(16);
    expect(fake.getMaxConcurrentWrites()).toBeGreaterThan(1);
  });

  it("paginates ListObjectsV2 across STORAGE_DIRS and strips prefix", async () => {
    const fake = createFakeS3Client({ pageSize: 2 });
    const backend = new S3StorageBackend({
      client: fake.client,
      prefix: "inst/",
    });

    await backend.putBytes("assets/a1.wav", new Uint8Array(10));
    await backend.putBytes("assets/a2.wav", new Uint8Array(20));
    await backend.putBytes("assets/a3.wav", new Uint8Array(30));
    await backend.putBytes("images/i1.png", new Uint8Array(40));
    await backend.putBytes("images/variants/i1-w64.webp", new Uint8Array(12));
    await backend.putBytes("analysis/s1.png", new Uint8Array(15));
    await backend.putBytes("objects/ab/" + "a".repeat(64), new Uint8Array(5));
    // Foreign key outside STORAGE_DIRS is not listed by S3 prefix scan.
    fake.store.set("inst/unrelated/note.txt", {
      bytes: new Uint8Array(7),
      type: "text/plain",
      lastModified: new Date("2026-05-01T12:00:00Z"),
    });

    const entries = await backend.listEntries();
    const byKey = new Map(entries.map((e) => [e.key, e]));

    expect(entries.length).toBe(7);
    expect(byKey.get("assets/a1.wav")?.size).toBe(10);
    expect(byKey.get("assets/a3.wav")?.size).toBe(30);
    expect(byKey.get("images/variants/i1-w64.webp")?.size).toBe(12);
    expect(byKey.get("analysis/s1.png")?.size).toBe(15);
    expect(byKey.has("unrelated/note.txt")).toBe(false);
    expect(byKey.get("assets/a1.wav")?.modifiedAt).toEqual(
      new Date("2026-05-01T12:00:00Z")
    );
  });

  it("downloads to an OS temp file in withLocalFile and always unlinks it", async () => {
    const fake = createFakeS3Client();
    const backend = new S3StorageBackend({ client: fake.client });
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    await backend.putBytes("assets/clip.wav", payload);

    let capturedPath = "";
    const result = await backend.withLocalFile(
      "assets/clip.wav",
      async (localPath) => {
        capturedPath = localPath;
        expect(localPath.endsWith(".wav")).toBe(true);
        expect(new Uint8Array(await readFile(localPath))).toEqual(payload);
        return "ok";
      }
    );
    expect(result).toBe("ok");
    expect(existsSync(capturedPath)).toBe(false);

    // Even when `fn` throws, the temp file is cleaned up.
    let failedPath = "";
    await expect(
      backend.withLocalFile("assets/clip.wav", async (localPath) => {
        failedPath = localPath;
        expect(existsSync(localPath)).toBe(true);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(existsSync(failedPath)).toBe(false);
  });

  it("rethrows non-404 errors from stat", async () => {
    const fake = createFakeS3Client();
    fake.client.stat = async () => {
      throw new Error("AccessDenied");
    };
    const backend = new S3StorageBackend({ client: fake.client });
    await expect(backend.stat("assets/x.wav")).rejects.toThrow("AccessDenied");
  });
});
