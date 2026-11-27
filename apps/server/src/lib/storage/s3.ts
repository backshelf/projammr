import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { errorFields, log } from "../log.js";
import { unlinkQuietly } from "./local.js";
import {
  type ByteRange,
  normalizeS3Prefix,
  runWithConcurrency,
  STORAGE_DIRS,
  type S3StorageConfig,
  type StorageBackend,
  type StoredEntry,
  type StoredStat,
} from "./types.js";

const logger = log("storage");

/** Concurrency cap for batch object PUTs (`storeObjects`). */
const OBJECT_PUT_CONCURRENCY = 16;

/** Structural subset of `Bun.S3File` used by {@link S3StorageBackend}. */
export interface S3FileLike {
  bytes(): Promise<Uint8Array>;
  stream(): ReadableStream<Uint8Array>;
  slice(begin?: number, end?: number): S3FileLike;
}

/** Structural subset of `Bun.S3Client` used by {@link S3StorageBackend}. */
export interface S3ClientLike {
  file(path: string, options?: Bun.S3Options): S3FileLike;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; lastModified: Date }>;
  write(
    path: string,
    data: Uint8Array | Bun.BunFile,
    options?: Bun.S3Options
  ): Promise<number>;
  delete(path: string): Promise<void>;
  list(
    input?: Bun.S3ListObjectsOptions | null
  ): Promise<Bun.S3ListObjectsResponse>;
}

/** Whether an error from `Bun.S3Client` indicates that the requested key does not exist. */
function isS3NotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (err.status === 404 || err.statusCode === 404) return true;
  if (
    err.code === "NoSuchKey" ||
    err.code === "NotFound" ||
    err.code === "ERR_S3_MISSING_KEY"
  ) {
    return true;
  }
  if (
    typeof err.message === "string" &&
    /\b(NoSuchKey|NotFound|404)\b/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

/**
 * S3-compatible object storage backend backed by Bun's native `Bun.S3Client`
 * (Cloudflare R2, AWS S3, MinIO).
 */
export class S3StorageBackend implements StorageBackend {
  readonly kind = "s3" as const;
  readonly prefix: string;
  private readonly client: S3ClientLike;

  constructor(
    configOrClient: S3StorageConfig | { client: S3ClientLike; prefix?: string }
  ) {
    if ("client" in configOrClient) {
      this.client = configOrClient.client;
      this.prefix = normalizeS3Prefix(configOrClient.prefix);
    } else {
      this.prefix = normalizeS3Prefix(configOrClient.prefix);
      this.client = new Bun.S3Client({
        bucket: configOrClient.bucket,
        accessKeyId: configOrClient.accessKeyId,
        secretAccessKey: configOrClient.secretAccessKey,
        region: configOrClient.region,
        ...(configOrClient.endpoint
          ? { endpoint: configOrClient.endpoint }
          : {}),
      });
    }
  }

  fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private stripPrefix(fullKey: string): string {
    return this.prefix && fullKey.startsWith(this.prefix)
      ? fullKey.slice(this.prefix.length)
      : fullKey;
  }

  exists(key: string): Promise<boolean> {
    return this.client.exists(this.fullKey(key));
  }

  async stat(key: string): Promise<StoredStat | null> {
    try {
      const info = await this.client.stat(this.fullKey(key));
      return {
        size: info.size,
        modifiedAt:
          info.lastModified instanceof Date
            ? info.lastModified
            : new Date(info.lastModified),
      };
    } catch (error) {
      if (isS3NotFoundError(error)) return null;
      throw error;
    }
  }

  async readBytes(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.client.file(this.fullKey(key)).bytes());
  }

  readStream(key: string, range?: ByteRange): ReadableStream<Uint8Array> {
    const file = this.client.file(this.fullKey(key));
    return range ? file.slice(range[0], range[1] + 1).stream() : file.stream();
  }

  async putBytes(
    key: string,
    bytes: Uint8Array,
    contentType?: string
  ): Promise<void> {
    await this.client.write(
      this.fullKey(key),
      bytes,
      contentType ? { type: contentType } : undefined
    );
  }

  async putFromFile(
    key: string,
    tempPath: string,
    contentType?: string
  ): Promise<void> {
    await this.client.write(
      this.fullKey(key),
      Bun.file(tempPath),
      contentType ? { type: contentType } : undefined
    );
  }

  async putObjects(files: { key: string; bytes: Uint8Array }[]): Promise<void> {
    await runWithConcurrency(
      files,
      OBJECT_PUT_CONCURRENCY,
      async ({ key, bytes }) => {
        await this.client.write(this.fullKey(key), bytes, {
          type: "application/octet-stream",
        });
      }
    );
  }

  async remove(key: string): Promise<boolean> {
    try {
      await this.client.delete(this.fullKey(key));
      return true;
    } catch (error) {
      if (isS3NotFoundError(error)) return true;
      logger.error("failed to delete S3 object", {
        key,
        ...errorFields(error),
      });
      return false;
    }
  }

  async listEntries(): Promise<StoredEntry[]> {
    const entries: StoredEntry[] = [];
    for (const dir of STORAGE_DIRS) {
      const prefix = `${this.prefix}${dir}/`;
      let continuationToken: string | undefined;
      do {
        const page = await this.client.list(
          continuationToken ? { prefix, continuationToken } : { prefix }
        );
        for (const item of page.contents ?? []) {
          entries.push({
            key: this.stripPrefix(item.key),
            size: item.size ?? 0,
            modifiedAt: item.lastModified
              ? new Date(item.lastModified)
              : new Date(0),
          });
        }
        continuationToken = page.isTruncated
          ? page.nextContinuationToken
          : undefined;
      } while (continuationToken);
    }
    return entries;
  }

  async withLocalFile<T>(
    key: string,
    fn: (localPath: string) => Promise<T>
  ): Promise<T> {
    const tempPath = join(
      tmpdir(),
      `projammr-${crypto.randomUUID()}${extname(key)}`
    );
    const writer = Bun.file(tempPath).writer();
    let writerEnded = false;
    try {
      const reader = this.readStream(key).getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const written = writer.write(value);
          if (written instanceof Promise) await written;
        }
      } finally {
        reader.releaseLock();
      }
      await writer.end();
      writerEnded = true;
      return await fn(tempPath);
    } catch (error) {
      if (!writerEnded) {
        try {
          await writer.end();
        } catch {
          // Ignore close error while propagating the original failure.
        }
      }
      throw error;
    } finally {
      await unlinkQuietly(tempPath);
    }
  }
}
