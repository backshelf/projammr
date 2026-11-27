/** The subdirectories a stored key may live under. */
export const STORAGE_DIR = {
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

type StorageBackendKind = "local" | "s3";

export type S3StorageConfig = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  region: string;
  /** Normalized prefix: empty string, or non-empty with no leading slash and a trailing slash. */
  prefix: string;
};

export type StorageConfig =
  { kind: "local" } | { kind: "s3"; s3: S3StorageConfig };

export type StoredStat = {
  size: number;
  modifiedAt: Date;
};

export type StoredEntry = StoredStat & {
  key: string;
};

/** Inclusive `[start, end]` byte range, matching HTTP `Range` semantics. */
export type ByteRange = readonly [start: number, end: number];

/**
 * Pluggable blob store behind every stored key (`assets/`, `images/`,
 * `images/variants/`, `analysis/`, and `objects/`). Callers always pass
 * relative stored keys, never filesystem paths or bucket prefixes.
 */
export interface StorageBackend {
  readonly kind: StorageBackendKind;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StoredStat | null>;
  readBytes(key: string): Promise<Uint8Array>;
  readStream(key: string, range?: ByteRange): ReadableStream<Uint8Array>;
  putBytes(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  putFromFile(
    key: string,
    tempPath: string,
    contentType?: string
  ): Promise<void>;
  putObjects(files: { key: string; bytes: Uint8Array }[]): Promise<void>;
  remove(key: string): Promise<boolean>;
  listEntries(): Promise<StoredEntry[]>;
  withLocalFile<T>(
    key: string,
    fn: (localPath: string) => Promise<T>
  ): Promise<T>;
}

/** Normalizes an optional S3 key prefix to `""` or `"a/b/"` (no leading slash, single trailing slash). */
export function normalizeS3Prefix(raw: string | undefined): string {
  const trimmed = raw?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return trimmed ? `${trimmed}/` : "";
}

/**
 * Parses and validates storage backend configuration from environment
 * variables. Throws with a clear message when `STORAGE_BACKEND` is invalid or
 * required S3 settings are missing.
 */
export function parseStorageConfig(
  env: Record<string, string | undefined> = process.env
): StorageConfig {
  const rawKind = env.STORAGE_BACKEND?.trim();
  if (!rawKind || rawKind === "local") return { kind: "local" };
  if (rawKind !== "s3") {
    throw new Error(
      `STORAGE_BACKEND must be "local" or "s3", got "${rawKind}".`
    );
  }

  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();

  const missing: string[] = [];
  if (!bucket) missing.push("S3_BUCKET");
  if (!accessKeyId) missing.push("S3_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} must be set when STORAGE_BACKEND=s3.`
    );
  }

  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  if (endpoint) {
    try {
      new URL(endpoint);
    } catch {
      throw new Error(`S3_ENDPOINT must be a valid URL, got "${endpoint}".`);
    }
  }

  const region = env.S3_REGION?.trim() || "auto";
  const prefix = normalizeS3Prefix(env.S3_PREFIX);

  return {
    kind: "s3",
    s3: {
      bucket: bucket!,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      ...(endpoint ? { endpoint } : {}),
      region,
      prefix,
    },
  };
}

/** Runs `worker` over `items` with at most `limit` concurrent promises in flight. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, next));
}
