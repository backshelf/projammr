import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  isObjectHash,
  listStoredKeys,
  LocalStorageBackend,
  objectKey,
  storageExtension,
  storeObjects,
  storedFileExists,
  storedFilePath,
} from "./storage.js";

describe("storageExtension", () => {
  it("keeps a plain extension from the upload's own name", () => {
    expect(storageExtension("song.wav", "audio/wav")).toBe("wav");
    expect(storageExtension("archive.tar.gz", "application/gzip")).toBe("gz");
  });

  it("lowercases what it keeps", () => {
    expect(storageExtension("SONG.WAV", "audio/wav")).toBe("wav");
  });

  it("falls back to the MIME subtype when the name's extension is not plain", () => {
    expect(storageExtension("song.wav/../x", "audio/wav")).toBe("wav");
    expect(storageExtension("evil.sh; rm -rf /", "audio/mpeg")).toBe("mpeg");
    expect(storageExtension("x", "text/html")).toBe("html");
  });

  it("falls back to bin when neither source yields a plain extension", () => {
    expect(storageExtension("x", "")).toBe("bin");
    expect(
      storageExtension("noextension", "application/x-some-long-thing")
    ).toBe("bin");
  });

  it("rejects an extension long enough to hide a payload", () => {
    expect(storageExtension("x.thisistoolong", "audio/wav")).toBe("wav");
  });
});

describe("storedFileExists", () => {
  const key = `storage-test-${crypto.randomUUID()}.txt`;
  const path = storedFilePath(key);

  it("is true for a key whose file is on disk", async () => {
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, "");
    try {
      expect(await storedFileExists(key)).toBe(true);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("is false for a key whose file was never written", async () => {
    expect(await storedFileExists(`missing-${crypto.randomUUID()}.txt`)).toBe(
      false
    );
  });
});

describe("objectKey", () => {
  const hash = "ab" + "0".repeat(62);

  it("shards by the first two hex characters and carries no extension", () => {
    expect(objectKey(hash)).toBe(`objects/ab/${hash}`);
  });

  it("rejects anything that is not 64 lowercase hex characters", () => {
    for (const bad of [
      "",
      "ab",
      hash.toUpperCase(),
      `${hash}0`,
      `../${"0".repeat(61)}`,
      "g".repeat(64),
    ]) {
      expect(isObjectHash(bad)).toBe(false);
      expect(() => objectKey(bad)).toThrow();
    }
  });
});

describe("storeObjects", () => {
  const newHash = () =>
    new Bun.CryptoHasher("sha256").update(crypto.randomUUID()).digest("hex");

  /** The temporary siblings left beside `key`. */
  const temporariesOf = async (key: string) =>
    (await listStoredKeys()).filter((listed) =>
      listed.startsWith(`${key}.tmp-`)
    );

  it("writes each object's bytes unchanged under its key, which the walk reports with forward slashes", async () => {
    const files = [
      {
        hash: newHash(),
        bytes: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 1, 2, 255]),
      },
      { hash: newHash(), bytes: new Uint8Array([7, 8, 9]) },
    ];
    const keys = files.map(({ hash }) => objectKey(hash));

    await storeObjects(files);

    try {
      for (const [index, key] of keys.entries()) {
        expect(
          new Uint8Array(await Bun.file(storedFilePath(key)).bytes())
        ).toEqual(files[index]!.bytes);
      }
      expect(await listStoredKeys()).toEqual(expect.arrayContaining(keys));
    } finally {
      for (const key of keys) await rm(storedFilePath(key), { force: true });
    }
  });

  it("leaves no temporary sibling behind and replaces a file already under the key", async () => {
    const hash = newHash();
    const key = objectKey(hash);
    await storeObjects([{ hash, bytes: new Uint8Array([1]) }]);
    try {
      await storeObjects([{ hash, bytes: new Uint8Array([2, 3]) }]);

      expect(await Bun.file(storedFilePath(key)).bytes()).toEqual(
        new Uint8Array([2, 3])
      );
      expect(await temporariesOf(key)).toEqual([]);
    } finally {
      await rm(storedFilePath(key), { force: true });
    }
  });

  it("removes every temporary file when a rename fails after the writes, and throws", async () => {
    const [placed, blocked] = [newHash(), newHash()];
    const [placedKey, blockedKey] = [objectKey(placed), objectKey(blocked)];
    // A directory under the key: the write beside it succeeds and the rename
    // onto it fails.
    await mkdir(storedFilePath(blockedKey), { recursive: true });

    try {
      await expect(
        storeObjects([
          { hash: placed, bytes: new Uint8Array([1]) },
          { hash: blocked, bytes: new Uint8Array([2]) },
        ])
      ).rejects.toThrow();

      expect(await temporariesOf(placedKey)).toEqual([]);
      expect(await temporariesOf(blockedKey)).toEqual([]);
    } finally {
      await rm(storedFilePath(placedKey), { force: true });
      await rm(storedFilePath(blockedKey), { recursive: true, force: true });
    }
  });

  it("rejects a malformed hash before touching disk", async () => {
    await expect(
      storeObjects([{ hash: "../x", bytes: new Uint8Array() }])
    ).rejects.toThrow();
  });
});

describe("LocalStorageBackend", () => {
  it("supports putBytes, putFromFile, readStream ranges, withLocalFile, and skips .tmp in listEntries", async () => {
    const root = await mkdtemp(join(tmpdir(), "projammr-local-backend-"));
    const backend = new LocalStorageBackend(root);
    try {
      await backend.putBytes(
        "assets/hello.txt",
        new TextEncoder().encode("abcdefghij")
      );
      expect(await backend.exists("assets/hello.txt")).toBe(true);
      expect(await backend.readBytes("assets/hello.txt")).toEqual(
        new TextEncoder().encode("abcdefghij")
      );

      const ranged = new Uint8Array(
        await new Response(
          backend.readStream("assets/hello.txt", [2, 5])
        ).arrayBuffer()
      );
      expect(new TextDecoder().decode(ranged)).toBe("cdef");

      const staged = join(root, ".tmp", "staged.bin");
      await mkdir(join(root, ".tmp"), { recursive: true });
      await writeFile(staged, new Uint8Array([42, 43, 44]));
      // An active temp file under `.tmp/` must not appear in `listEntries()`.
      expect((await backend.listEntries()).map((e) => e.key)).toEqual([
        "assets/hello.txt",
      ]);

      await backend.putFromFile("assets/moved.bin", staged);
      expect(await backend.readBytes("assets/moved.bin")).toEqual(
        new Uint8Array([42, 43, 44])
      );

      const resolved = await backend.withLocalFile(
        "assets/moved.bin",
        async (localPath) => localPath
      );
      expect(resolved).toBe(`${root}/assets/moved.bin`);

      expect(await backend.remove("assets/moved.bin")).toBe(true);
      expect(await backend.exists("assets/moved.bin")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
