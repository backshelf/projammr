import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { errorFields, log } from "../log.js";
import {
  type ByteRange,
  runWithConcurrency,
  type StorageBackend,
  type StoredEntry,
  type StoredStat,
} from "./types.js";

const logger = log("storage");

/** Where stored files live by default, relative to the server's working directory. */
export const STATIC_ROOT = "./static";

/** Subdirectory under the static root reserved for in-flight streaming upload temp files. */
export const LOCAL_TMP_DIR = ".tmp";

/**
 * Removes a file on disk, tolerating one that is already gone.
 *
 * Callers unlink after the owning row is committed, so a failure here leaves an
 * unreachable orphan rather than a broken row — worth logging, never worth
 * turning a successful delete into an error. Answers whether the file is gone:
 * false only for a failed unlink, which was logged.
 */
export async function unlinkQuietly(path: string): Promise<boolean> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("failed to unlink", { path, ...errorFields(error) });
      return false;
    }
  }
  return true;
}

/** Flushes a directory's entries to disk, so a rename or a new entry in it survives power loss. */
async function syncDirectory(dir: string): Promise<void> {
  // Windows does not support `fsync` on directory file descriptors (returns EPERM).
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Creates `dir` with any missing parents, and flushes each new directory's
 * entry in its own parent, so a file later made durable in `dir` cannot lose
 * the path to it.
 */
async function makeDurableDirectory(dir: string): Promise<void> {
  const created = await mkdir(dir, { recursive: true });
  if (created === undefined) return;

  const top = dirname(resolve(created));
  let parent = resolve(dir);
  do {
    parent = dirname(parent);
    await syncDirectory(parent);
  } while (parent !== top && parent !== dirname(parent));
}

/** Writes `bytes` to a new file at `path` and flushes it to disk. */
async function writeDurableFile(
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const file = await open(path, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Waits for every one of `work` to settle, then throws the first failure, so
 * nothing is still running when the caller cleans up after it.
 */
async function settleAll(work: Promise<unknown>[]): Promise<void> {
  const failed = (await Promise.allSettled(work)).find(
    (result) => result.status === "rejected"
  );
  if (failed) throw failed.reason;
}

/** Local filesystem backend preserving the `./static/<key>` directory layout. */
export class LocalStorageBackend implements StorageBackend {
  readonly kind = "local" as const;

  constructor(readonly root: string = STATIC_ROOT) {}

  pathOf(key: string): string {
    return `${this.root}/${key}`;
  }

  exists(key: string): Promise<boolean> {
    return Bun.file(this.pathOf(key)).exists();
  }

  async stat(key: string): Promise<StoredStat | null> {
    const file = await stat(this.pathOf(key)).catch(() => null);
    return file && { size: file.size, modifiedAt: file.mtime };
  }

  async readBytes(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathOf(key)));
  }

  readStream(key: string, range?: ByteRange): ReadableStream<Uint8Array> {
    const file = Bun.file(this.pathOf(key));
    return range ? file.slice(range[0], range[1] + 1).stream() : file.stream();
  }

  async putBytes(key: string, bytes: Uint8Array): Promise<void> {
    const dest = this.pathOf(key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }

  async putFromFile(key: string, tempPath: string): Promise<void> {
    const dest = this.pathOf(key);
    await mkdir(dirname(dest), { recursive: true });
    try {
      await rename(tempPath, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(tempPath, dest);
      await unlinkQuietly(tempPath);
    }
  }

  async putObjects(files: { key: string; bytes: Uint8Array }[]): Promise<void> {
    const paths = files.map(({ key }) => this.pathOf(key));
    const directories = [...new Set(paths.map((path) => dirname(path)))];
    // One at a time: two creations racing up the same missing parents could
    // each leave the flushing of a parent to the other.
    for (const directory of directories) await makeDurableDirectory(directory);

    const temporaries = paths.map(
      (path) => `${path}.tmp-${crypto.randomUUID()}`
    );
    try {
      await settleAll(
        files.map(({ bytes }, index) =>
          writeDurableFile(temporaries[index]!, bytes)
        )
      );
      await settleAll(
        temporaries.map((temporary, index) => rename(temporary, paths[index]!))
      );
    } catch (error) {
      await Promise.all(temporaries.map(unlinkQuietly));
      throw error;
    }
    await Promise.all(directories.map(syncDirectory));
  }

  remove(key: string): Promise<boolean> {
    return unlinkQuietly(this.pathOf(key));
  }

  async listEntries(): Promise<StoredEntry[]> {
    const dirents = await readdir(this.root, {
      recursive: true,
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });

    const keys = dirents
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(this.root, `${entry.parentPath}/${entry.name}`)
          .split(sep)
          .join("/")
      )
      .filter((key) => !key.startsWith(`${LOCAL_TMP_DIR}/`));

    const results: StoredEntry[] = [];
    await runWithConcurrency(keys, 32, async (key) => {
      const info = await this.stat(key);
      if (info) results.push({ key, ...info });
    });
    return results;
  }

  withLocalFile<T>(
    key: string,
    fn: (localPath: string) => Promise<T>
  ): Promise<T> {
    return fn(this.pathOf(key));
  }
}
