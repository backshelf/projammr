import { LocalStorageBackend, STATIC_ROOT } from "./storage/local.js";
import { S3StorageBackend } from "./storage/s3.js";
import {
  type ByteRange,
  parseStorageConfig,
  STORAGE_DIR,
  type StorageBackend,
  type StorageConfig,
  type StorageKind,
  type StoredEntry,
  type StoredStat,
} from "./storage/types.js";

export {
  LOCAL_TMP_DIR,
  LocalStorageBackend,
  STATIC_ROOT,
  unlinkQuietly,
} from "./storage/local.js";
export { S3StorageBackend } from "./storage/s3.js";
export {
  STORAGE_DIRS,
  type ByteRange,
  type StorageBackend,
  type StorageKind,
  type StoredEntry,
  type StoredStat,
} from "./storage/types.js";

/** Creates the configured {@link StorageBackend} from a parsed {@link StorageConfig}. */
function createStorageBackend(config: StorageConfig): StorageBackend {
  return config.kind === "s3"
    ? new S3StorageBackend(config.s3)
    : new LocalStorageBackend();
}

let activeBackend: StorageBackend | null = null;

/** The active storage backend, created lazily from `STORAGE_BACKEND` on first use. */
export function storageBackend(): StorageBackend {
  activeBackend ??= createStorageBackend(parseStorageConfig(process.env));
  return activeBackend;
}

/** Replaces the active storage backend (pass `null` to reset to the env-configured default). */
export function setStorageBackend(backend: StorageBackend | null): void {
  activeBackend = backend;
}

/** A fresh stored key under `kind`'s directory: `<kind>/<uuid>.<extension>`. */
export function newStorageKey(kind: StorageKind, extension: string): string {
  return `${STORAGE_DIR[kind]}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Where a stored key lives on local disk.
 *
 * A row records the key alone — `images/<uuid>.png` — so one string identifies
 * the file everywhere: it is what an entity's `image` column holds, which lets
 * a cover resolve by plain equality instead of a function over the column, and
 * it is what the `/static` handler resolves back to a row.
 */
export const storedFilePath = (key: string): string => `${STATIC_ROOT}/${key}`;

/** The URL a stored key is served from. */
export const staticUrl = (key: string): string => `/static/${key}`;

/** Whether a stored key exists in the active backend. */
export const storedFileExists = (key: string): Promise<boolean> =>
  storageBackend().exists(key);

/** Size and modification time of a stored key, or null when missing. */
export const storedFileStat = (key: string): Promise<StoredStat | null> =>
  storageBackend().stat(key);

/** Reads a stored key's full bytes from the active backend. */
export const readStoredBytes = (key: string): Promise<Uint8Array> =>
  storageBackend().readBytes(key);

/** Opens a readable byte stream for a stored key, optionally for an inclusive `[start, end]` range. */
export const readStoredStream = (
  key: string,
  range?: ByteRange
): ReadableStream<Uint8Array> => storageBackend().readStream(key, range);

/** Writes raw bytes under an explicit stored key. */
export const storeBytes = (
  key: string,
  bytes: Uint8Array,
  contentType?: string
): Promise<void> => storageBackend().putBytes(key, bytes, contentType);

/** Moves or streams a staged local temp file into storage under an explicit key. */
export const storeFileFromPath = (
  key: string,
  tempPath: string,
  contentType?: string
): Promise<void> => storageBackend().putFromFile(key, tempPath, contentType);

/**
 * Every entry in the active backend with its size and modification time.
 * The storage audit reads this directly so S3 avoids per-key HEAD requests.
 */
export const listStoredEntries = (): Promise<StoredEntry[]> =>
  storageBackend().listEntries();

/** Every stored key in the active backend. */
export async function listStoredKeys(): Promise<string[]> {
  return (await listStoredEntries()).map((entry) => entry.key);
}

/**
 * Runs `fn` against a local filesystem path holding `key`'s bytes.
 * Local storage passes the file path directly; S3 downloads to a temp file and
 * unlinks it when `fn` finishes.
 */
export const withLocalStoredFile = <T>(
  key: string,
  fn: (localPath: string) => Promise<T>
): Promise<T> => storageBackend().withLocalFile(key, fn);

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

/** A staged upload written to a local temp file before moving into storage. */
export type StagedUpload = {
  tempPath: string;
  name: string;
  type: string;
};

/**
 * Stores a staged upload into the active backend and returns the key to record
 * on its row.
 *
 * A rejection propagates: the caller must not insert a row for a file that was
 * never written, or the row points at nothing and the API reports a success it
 * did not achieve.
 */
export async function storeUpload(
  kind: StorageKind,
  source: StagedUpload
): Promise<string> {
  const extension = storageExtension(source.name, source.type);
  const key = newStorageKey(kind, extension);
  await storageBackend().putFromFile(
    key,
    source.tempPath,
    source.type || undefined
  );
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

/** An object's id and its bytes, as {@link storeObjects} writes them. */
type ObjectFile = { hash: string; bytes: Uint8Array };

/**
 * Writes objects' bytes, unchanged, under their content-addressed keys, and
 * returns once all of them are durable in the active backend. The hashes are
 * not verified here: the caller that received the bytes does that.
 */
export async function storeObjects(files: ObjectFile[]): Promise<void> {
  const keyed = files.map(({ hash, bytes }) => ({
    key: objectKey(hash),
    bytes,
  }));
  await storageBackend().putObjects(keyed);
}

/** Removes the stored file a row's key names, tolerating one that is already gone. */
export const removeStoredFile = (key: string): Promise<boolean> =>
  storageBackend().remove(key);
