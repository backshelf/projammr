import {
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { errorFields, log } from "./log.js";

const logger = log("storage");

/** Where stored files live, relative to the server's working directory. */
const STATIC_ROOT = "./static";

/** The subdirectory of the static root that files of each kind are written to. */
const STORAGE_DIR = {
  assets: "assets",
  images: "images",
  /** Spectrogram PNGs, written by the analysis funnel rather than an upload. */
  analysis: "analysis",
  /** Content-addressed dit objects, keyed by {@link objectKey}. */
  objects: "objects",
} as const;

export type StorageKind = keyof typeof STORAGE_DIR;

/**
 * The directories a stored key may live under. A file anywhere else below the
 * static root was not put there by the storage layer, which is why the audit
 * leaves it alone.
 */
export const STORAGE_DIRS: readonly string[] = Object.values(STORAGE_DIR);

/** A fresh stored key under `kind`'s directory: `<kind>/<uuid>.<extension>`. */
export function newStorageKey(kind: StorageKind, extension: string): string {
  return `${STORAGE_DIR[kind]}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Where a stored key lives on disk.
 *
 * A row records the key alone — `images/<uuid>.png` — so one string identifies
 * the file everywhere: it is what an entity's `image` column holds, which lets
 * a cover resolve by plain equality instead of a function over the column, and
 * it is what the `/static` handler resolves back to a row.
 */
export const storedFilePath = (key: string): string => `${STATIC_ROOT}/${key}`;

/** The URL a stored key is served from. */
export const staticUrl = (key: string): string => `/static/${key}`;

/** Whether a stored key's file is still on disk. */
export const storedFileExists = (key: string): Promise<boolean> =>
  Bun.file(storedFilePath(key)).exists();

/**
 * Every file below the static root, keyed the way a row names it. The walk is
 * how the storage audit learns what is on disk — no row lists the cached
 * resizes, and only disk knows what a crashed upload left behind. A static root
 * that does not exist yet holds nothing.
 */
export async function listStoredKeys(): Promise<string[]> {
  const entries = await readdir(STATIC_ROOT, {
    recursive: true,
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  // A key is the path below the root, always with forward slashes, which is
  // what the rows hold and what `storedFilePath` renders back.
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(STATIC_ROOT, `${entry.parentPath}/${entry.name}`)
        .split(sep)
        .join("/")
    );
}

/** What disk says of a stored key's file, or null once it is gone. */
export async function storedFileStat(
  key: string
): Promise<{ size: number; modifiedAt: Date } | null> {
  const file = await stat(storedFilePath(key)).catch(() => null);
  return file && { size: file.size, modifiedAt: file.mtime };
}

const SAFE_EXTENSION = /^[a-z0-9]{1,8}$/i;

/**
 * The extension a stored file gets: the upload's own when it is plain, else one
 * derived from the MIME type, else `bin`.
 *
 * The upload's name is attacker-controlled, so anything carrying a separator, a
 * shell metacharacter or an implausible length is discarded rather than
 * sanitised — the stored name is a UUID and the extension is the only part of
 * the client's string that survives.
 */
export function storageExtension(fileName: string, mime: string): string {
  const own = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1)
    : "";
  if (SAFE_EXTENSION.test(own)) return own.toLowerCase();

  const fromMime = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "");
  return fromMime && SAFE_EXTENSION.test(fromMime)
    ? fromMime.toLowerCase()
    : "bin";
}

/**
 * Writes an upload to disk and returns the key to record on its row.
 *
 * A rejection propagates: the caller must not insert a row for a file that was
 * never written, or the row points at nothing and the API reports a success it
 * did not achieve.
 */
export async function storeUpload(
  kind: StorageKind,
  file: File
): Promise<string> {
  const extension = storageExtension(file.name, file.type);
  const key = newStorageKey(kind, extension);

  await writeFile(storedFilePath(key), Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
  });

  return key;
}

/** An object's id: the lowercase hex SHA-256 of its content. */
const OBJECT_HASH = /^[0-9a-f]{64}$/;

/** Whether a string is a well-formed object hash. */
export const isObjectHash = (hash: string): boolean => OBJECT_HASH.test(hash);

/**
 * The stored key of an object: `objects/<first two hex>/<hash>`, no extension.
 * Throws on a hash that is not 64 lowercase hex characters, so a key can never
 * be built from a path-shaped string.
 */
export function objectKey(hash: string): string {
  if (!isObjectHash(hash)) throw new Error(`invalid object hash: ${hash}`);
  return `${STORAGE_DIR.objects}/${hash.slice(0, 2)}/${hash}`;
}

/** The hash an object's stored key names, or null for any other key. */
export function objectHashOf(key: string): string | null {
  const hash = key.slice(key.lastIndexOf("/") + 1);
  return isObjectHash(hash) && objectKey(hash) === key ? hash : null;
}

/** Flushes a directory's entries to disk, so a rename or a new entry in it survives power loss. */
async function syncDirectory(dir: string): Promise<void> {
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

/** An object's id and its bytes, as {@link storeObjects} writes them. */
type ObjectFile = { hash: string; bytes: Uint8Array };

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

/**
 * Writes objects' bytes, unchanged, under their content-addressed keys, and
 * returns once all of them are on disk for good. The hashes are not verified
 * here: the caller that received the bytes does that.
 *
 * Each object's bytes go to a temporary sibling and are flushed, then every
 * temporary file is renamed onto its key, then each directory a rename landed
 * in is flushed once, so neither a killed process nor power loss leaves a
 * truncated file under a final name, and a row committed after this returns
 * always finds its whole file. A write or a rename that fails removes every
 * temporary file and throws; one that a crash leaves behind is unreferenced,
 * and the storage audit reaps it, as it does a file renamed into place whose
 * row never committed.
 *
 * A file already under a key is replaced. The caller holds the objects' locks
 * and has written their `objects` rows itself, so such a file is an orphan no
 * committed row vouches for, and the verified bytes in hand are the ones to
 * keep.
 */
export async function storeObjects(files: ObjectFile[]): Promise<void> {
  const paths = files.map(({ hash }) => storedFilePath(objectKey(hash)));
  const directories = [...new Set(paths.map((path) => dirname(path)))];
  // One at a time: two creations racing up the same missing parents could
  // each leave the flushing of a parent to the other.
  for (const directory of directories) await makeDurableDirectory(directory);

  const temporaries = paths.map((path) => `${path}.tmp-${crypto.randomUUID()}`);
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

/**
 * Removes a stored file, tolerating one that is already gone.
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

/** {@link unlinkQuietly} for the file a row's key names. */
export const removeStoredFile = (key: string): Promise<boolean> =>
  unlinkQuietly(storedFilePath(key));
