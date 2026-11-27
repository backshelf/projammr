import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  LocalStorageBackend,
  type StorageBackend,
  type StoredEntry,
} from "../src/lib/storage.js";
import {
  migrateStorage,
  parseMigrateArgs,
  verifyStorage,
} from "./migrate-storage.js";

function createInMemoryTarget() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const uploadedKeys: string[] = [];

  const target: StorageBackend = {
    kind: "s3",
    async exists(key) {
      return objects.has(key);
    },
    async stat(key) {
      const obj = objects.get(key);
      return obj
        ? { size: obj.bytes.byteLength, modifiedAt: new Date(0) }
        : null;
    },
    async readBytes(key) {
      return objects.get(key)!.bytes;
    },
    readStream() {
      throw new Error("not used");
    },
    async putBytes(key, bytes, contentType) {
      objects.set(key, { bytes: new Uint8Array(bytes), type: contentType });
    },
    async putFromFile(key, tempPath, contentType) {
      const bytes = new Uint8Array(await Bun.file(tempPath).bytes());
      objects.set(key, { bytes, type: contentType });
      uploadedKeys.push(key);
    },
    async putObjects() {},
    async remove(key) {
      return objects.delete(key);
    },
    async listEntries(): Promise<StoredEntry[]> {
      return [...objects.entries()].map(([key, value]) => ({
        key,
        size: value.bytes.byteLength,
        modifiedAt: new Date(0),
      }));
    },
    async withLocalFile(_key, fn) {
      return fn("");
    },
  };

  return { target, objects, uploadedKeys };
}

describe("parseMigrateArgs", () => {
  it("parses defaults and supported flags", () => {
    expect(parseMigrateArgs([])).toEqual({
      dryRun: false,
      verify: false,
      concurrency: 8,
    });
    expect(
      parseMigrateArgs(["--dry-run", "--verify", "--concurrency", "16"])
    ).toEqual({
      dryRun: true,
      verify: true,
      concurrency: 16,
    });
    expect(parseMigrateArgs(["--concurrency=4"])).toEqual({
      dryRun: false,
      verify: false,
      concurrency: 4,
    });
  });

  it("rejects invalid flags and concurrency values", () => {
    expect(() => parseMigrateArgs(["--unknown"])).toThrow();
    expect(() => parseMigrateArgs(["--concurrency", "0"])).toThrow();
    expect(() => parseMigrateArgs(["--concurrency=abc"])).toThrow();
  });
});

describe("migrateStorage", () => {
  it("copies STORAGE_DIRS keys idempotently, skips matching sizes, ignores foreign files, and keeps local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "projammr-migrate-"));
    try {
      const source = new LocalStorageBackend(root);
      await source.putBytes("assets/a.wav", new Uint8Array([1, 2, 3, 4]));
      await source.putBytes("images/cover.png", new Uint8Array([5, 6, 7]));
      await source.putBytes(
        "images/variants/cover-w64.webp",
        new Uint8Array([8, 9])
      );
      await source.putBytes("analysis/spec.png", new Uint8Array([10]));
      await source.putBytes(
        `objects/aa/${"a".repeat(64)}`,
        new Uint8Array([11, 12])
      );
      // Foreign file outside STORAGE_DIRS must be ignored.
      await mkdir(join(root, "stray"), { recursive: true });
      await writeFile(join(root, "stray", "readme.txt"), "ignore me");

      const { target, objects, uploadedKeys } = createInMemoryTarget();

      // Dry run copies nothing.
      const dry = await migrateStorage({ source, target, dryRun: true });
      expect(dry.scanned).toBe(5);
      expect(dry.copied).toBe(5);
      expect(dry.skipped).toBe(0);
      expect(objects.size).toBe(0);

      // First real run copies all 5 keys.
      const first = await migrateStorage({ source, target, concurrency: 2 });
      expect(first.scanned).toBe(5);
      expect(first.copied).toBe(5);
      expect(first.skipped).toBe(0);
      expect(first.failed).toEqual([]);
      expect(objects.size).toBe(5);
      expect(objects.get("assets/a.wav")?.type).toBe("audio/wav");
      expect(objects.get("images/cover.png")?.type).toBe("image/png");
      expect(objects.get(`objects/aa/${"a".repeat(64)}`)?.type).toBe(
        "application/octet-stream"
      );

      // Local files are never deleted.
      expect(existsSync(source.pathOf("assets/a.wav"))).toBe(true);
      expect(existsSync(source.pathOf("images/cover.png"))).toBe(true);

      // Second run skips everything with matching size.
      uploadedKeys.length = 0;
      const second = await migrateStorage({ source, target });
      expect(second.copied).toBe(0);
      expect(second.skipped).toBe(5);
      expect(uploadedKeys).toEqual([]);

      // A mismatched size on the target gets re-uploaded.
      objects.set("assets/a.wav", { bytes: new Uint8Array([1]) });
      const third = await migrateStorage({ source, target });
      expect(third.copied).toBe(1);
      expect(third.skipped).toBe(4);
      expect(uploadedKeys).toEqual(["assets/a.wav"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("verifyStorage", () => {
  it("reports missing referenced keys cleanly", async () => {
    const { target } = createInMemoryTarget();
    await target.putBytes("assets/present.wav", new Uint8Array([1]));

    expect(await verifyStorage(target, ["assets/present.wav"])).toEqual({
      checked: 1,
      missing: [],
    });

    expect(
      await verifyStorage(target, ["assets/present.wav", "assets/missing.wav"])
    ).toEqual({
      checked: 2,
      missing: ["assets/missing.wav"],
    });
  });
});
