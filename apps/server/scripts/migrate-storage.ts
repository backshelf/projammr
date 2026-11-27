/**
 * Idempotently copies local `./static/{assets,images,analysis,objects}` blobs
 * to the configured S3 backend without deleting local files.
 *
 * Usage:
 *   bun scripts/migrate-storage.ts [--dry-run] [--verify] [--concurrency <n>]
 *   docker compose exec api bun dist/scripts/migrate-storage.js --verify
 */
import "dotenv/config";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "../src/lib/log.js";
import {
  LocalStorageBackend,
  objectKey,
  S3StorageBackend,
  STORAGE_DIRS,
  type StorageBackend,
} from "../src/lib/storage.js";
import {
  parseStorageConfig,
  runWithConcurrency,
} from "../src/lib/storage/types.js";

const logger = log("migrate-storage");

const DEFAULT_CONCURRENCY = 8;

const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export type MigrateCliOptions = {
  dryRun: boolean;
  verify: boolean;
  concurrency: number;
};

/** Parses CLI flags for `migrate-storage.ts`. */
export function parseMigrateArgs(argv: readonly string[]): MigrateCliOptions {
  let dryRun = false;
  let verify = false;
  let concurrency = DEFAULT_CONCURRENCY;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--verify") {
      verify = true;
    } else if (arg === "--concurrency") {
      const next = argv[++i];
      concurrency = parseConcurrency(next);
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = parseConcurrency(arg.slice("--concurrency=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, verify, concurrency };
}

function parseConcurrency(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(
      `--concurrency must be a positive integer, got "${raw ?? ""}"`
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${raw}"`);
  }
  return value;
}

function isStorageKey(key: string): boolean {
  return STORAGE_DIRS.some((dir) => key.startsWith(`${dir}/`));
}

function contentTypeForKey(key: string): string {
  if (key.startsWith("objects/")) return "application/octet-stream";
  const ext = extname(key).toLowerCase();
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}

export type MigrateStorageResult = {
  scanned: number;
  copied: number;
  copiedBytes: number;
  skipped: number;
  skippedBytes: number;
  failed: { key: string; error: string }[];
};

/**
 * Copies every blob under `STORAGE_DIRS` from `source` to `target`, skipping
 * keys already present in `target` with the exact same byte length. Never
 * deletes files from `source`.
 */
export async function migrateStorage(options: {
  source: LocalStorageBackend;
  target: StorageBackend;
  dryRun?: boolean;
  concurrency?: number;
}): Promise<MigrateStorageResult> {
  const dryRun = options.dryRun ?? false;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const localEntries = (await options.source.listEntries()).filter((entry) =>
    isStorageKey(entry.key)
  );
  const remoteEntries = await options.target.listEntries();
  const remoteSizes = new Map(
    remoteEntries.map((entry) => [entry.key, entry.size])
  );

  const result: MigrateStorageResult = {
    scanned: localEntries.length,
    copied: 0,
    copiedBytes: 0,
    skipped: 0,
    skippedBytes: 0,
    failed: [],
  };

  await runWithConcurrency(localEntries, concurrency, async (entry) => {
    if (remoteSizes.get(entry.key) === entry.size) {
      result.skipped++;
      result.skippedBytes += entry.size;
      return;
    }

    if (dryRun) {
      result.copied++;
      result.copiedBytes += entry.size;
      return;
    }

    try {
      await options.target.putFromFile(
        entry.key,
        options.source.pathOf(entry.key),
        contentTypeForKey(entry.key)
      );
      result.copied++;
      result.copiedBytes += entry.size;
    } catch (error) {
      result.failed.push({
        key: entry.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return result;
}

export type VerifyStorageResult = {
  checked: number;
  missing: string[];
};

/** Verifies every key in `referencedKeys` exists in `target`. */
export async function verifyStorage(
  target: StorageBackend,
  referencedKeys: readonly string[]
): Promise<VerifyStorageResult> {
  const unique = [...new Set(referencedKeys)];
  const remoteKeys = new Set(
    (await target.listEntries()).map((entry) => entry.key)
  );
  const missing = unique.filter((key) => !remoteKeys.has(key));
  return { checked: unique.length, missing };
}

/** Collects every stored key referenced by Postgres rows. */
async function collectDatabaseKeys(): Promise<string[]> {
  const [
    { isNotNull },
    { db },
    { assets },
    { images },
    { objects },
    { trackAudios },
  ] = await Promise.all([
    import("drizzle-orm"),
    import("../src/db/index.js"),
    import("../src/db/schema/assets.js"),
    import("../src/db/schema/images.js"),
    import("../src/db/schema/objects.js"),
    import("../src/db/schema/tracks.js"),
  ]);

  try {
    const [assetRows, imageRows, spectrograms, objectRows] = await Promise.all([
      db.select({ key: assets.assetPath }).from(assets),
      db.select({ key: images.assetPath }).from(images),
      db
        .select({ key: trackAudios.spectrogramKey })
        .from(trackAudios)
        .where(isNotNull(trackAudios.spectrogramKey)),
      db.select({ hash: objects.hash }).from(objects),
    ]);

    return [
      ...assetRows.map((row) => row.key),
      ...imageRows.map((row) => row.key),
      ...spectrograms.flatMap((row) => (row.key ? [row.key] : [])),
      ...objectRows.map((row) => objectKey(row.hash)),
    ];
  } finally {
    await db.$client.end();
  }
}

async function main(): Promise<void> {
  const options = parseMigrateArgs(process.argv.slice(2));
  const config = parseStorageConfig({
    ...process.env,
    STORAGE_BACKEND: "s3",
  });
  if (config.kind !== "s3") {
    throw new Error("S3 configuration is required to run migrate-storage");
  }

  const source = new LocalStorageBackend();
  const target = new S3StorageBackend(config.s3);

  logger.info("starting local-to-S3 storage migration", {
    bucket: config.s3.bucket,
    prefix: config.s3.prefix,
    dryRun: options.dryRun,
    verify: options.verify,
    concurrency: options.concurrency,
  });

  const report = await migrateStorage({
    source,
    target,
    dryRun: options.dryRun,
    concurrency: options.concurrency,
  });

  logger.info(
    options.dryRun ? "dry run complete" : "migration complete",
    report
  );

  if (report.failed.length > 0) {
    process.exitCode = 1;
  }

  if (options.verify) {
    const dbKeys = await collectDatabaseKeys();
    const verification = await verifyStorage(target, dbKeys);
    logger.info("verification complete", {
      checked: verification.checked,
      missing: verification.missing.length,
    });
    if (verification.missing.length > 0) {
      for (const key of verification.missing) {
        logger.error("missing referenced key in S3", { key });
      }
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
