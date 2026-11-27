import { inArray, isNotNull } from "drizzle-orm";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import {
  imageKeyStem,
  readVariantKey,
  VARIANT_WIDTHS,
} from "../../lib/images.js";
import { instancePolicy } from "../../lib/instance-policy.js";
import { log } from "../../lib/log.js";
import {
  listStoredEntries,
  objectHashOf,
  objectKey,
  removeStoredFile,
  STORAGE_DIRS,
} from "../../lib/storage.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { images } from "../schema/images.js";
import { objects } from "../schema/objects.js";
import { trackAudios } from "../schema/tracks.js";
import {
  enqueueInstanceJob,
  lastInstanceJob,
  registerJobHandler,
  startInstanceJobs,
} from "./jobs.js";
import {
  OBJECT_LOCKS_PER_TRANSACTION,
  removeUnnamedObjectFiles,
} from "./objects.js";
import { recomputeAllUsage, type UsageDrift } from "./storage-usage.js";

const logger = log("storage-audit");

/**
 * How old a file has to be before the audit will treat it as an orphan.
 *
 * An upload writes its bytes before the row that names them exists, so a file
 * younger than this may simply be one whose row has not committed yet. The
 * floor is what makes deleting by "no row names it" safe at all; nothing else
 * in the audit protects such a file.
 */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export type StorageAuditReport = {
  /** Files below the static root the audit looked at. */
  scanned: number;
  /** Files under no storage directory, which the audit never touches. */
  foreign: number;
  deleted: number;
  deletedBytes: number;
  /** Orphans old enough to remove, left in place because the instance only reports them. */
  reported: number;
  reportedBytes: number;
  /** Files no row named that were too young to remove. */
  sparedYoung: number;
  variantsReady: number;
  drift: UsageDrift[];
};

/** Every key the rows point at, and the image stems their resizes are named after. */
async function referencedKeys(): Promise<{
  keys: Set<string>;
  imageStems: Set<string>;
}> {
  const [assetRows, imageRows, spectrograms, objectRows] = await Promise.all([
    db.select({ key: assets.assetPath }).from(assets),
    db.select({ key: images.assetPath }).from(images),
    db
      .select({ key: trackAudios.spectrogramKey })
      .from(trackAudios)
      .where(isNotNull(trackAudios.spectrogramKey)),
    db.select({ hash: objects.hash }).from(objects),
  ]);

  return {
    keys: new Set([
      ...assetRows.map((row) => row.key),
      ...imageRows.map((row) => row.key),
      ...spectrograms.flatMap((row) => (row.key ? [row.key] : [])),
      ...objectRows.map((row) => objectKey(row.hash)),
    ]),
    imageStems: new Set(imageRows.map((row) => imageKeyStem(row.key))),
  };
}

/**
 * Whether a stored file still belongs to something.
 *
 * A cached resize carries no row of its own: it is named after its original's
 * UUID, so what it is checked against is the set of image keys rather than the
 * set of stored keys. Everything else has to be named by a row exactly.
 */
function isReferenced(
  key: string,
  referenced: { keys: Set<string>; imageStems: Set<string> }
): boolean {
  const variant = readVariantKey(key);
  return variant
    ? referenced.imageStems.has(variant.stem)
    : referenced.keys.has(key);
}

/** Whether a key is in a directory the storage layer owns and may delete from. */
const isStorageKey = (key: string): boolean =>
  STORAGE_DIRS.some((dir) => key.startsWith(`${dir}/`));

/**
 * Marks the images every width has been resized for, from what the walk found
 * on disk, and clears the flag on the ones missing a width. This is what the
 * outstanding-work finder reads instead of stat-ing four files per image at
 * every boot.
 */
async function reconcileVariantsReady(keys: string[]): Promise<number> {
  const widthsByStem = new Map<string, Set<number>>();
  for (const key of keys) {
    const variant = readVariantKey(key);
    // Only the WebP set decides readiness: a JPEG is made on demand and the
    // variants job never generates one.
    if (variant?.format !== "webp") continue;

    const widths = widthsByStem.get(variant.stem) ?? new Set<number>();
    widths.add(variant.width);
    widthsByStem.set(variant.stem, widths);
  }

  const rows = await db
    .select({
      id: images.id,
      key: images.assetPath,
      ready: images.variantsReady,
    })
    .from(images);

  const ready: number[] = [];
  const notReady: number[] = [];
  for (const row of rows) {
    const widths = widthsByStem.get(imageKeyStem(row.key));
    const complete = VARIANT_WIDTHS.every((width) => widths?.has(width));
    if (complete !== row.ready) (complete ? ready : notReady).push(row.id);
  }

  for (const batch of chunk(ready, bindParamLimit())) {
    await db
      .update(images)
      .set({ variantsReady: true })
      .where(inArray(images.id, batch));
  }
  for (const batch of chunk(notReady, bindParamLimit())) {
    await db
      .update(images)
      .set({ variantsReady: false })
      .where(inArray(images.id, batch));
  }

  return ready.length;
}

/**
 * Deletes the files nothing points at, re-derives the storage counters and
 * records which images have all their resizes.
 *
 * Only a file in a storage directory that no row names and that has sat
 * untouched for {@link ORPHAN_AGE_MS} is an orphan, and it is removed only
 * while the instance's `limits.orphanMode` is `delete`; under `report` it is
 * counted and kept. Every other case is counted and left where it is: a file
 * outside the storage directories was not put there by this code, and a young
 * unreferenced file is indistinguishable from an upload whose row is about to
 * commit.
 */
export async function auditStorage(): Promise<StorageAuditReport> {
  const entries = await listStoredEntries();
  const referenced = await referencedKeys();
  const youngerThan = Date.now() - ORPHAN_AGE_MS;
  const { orphanMode } = instancePolicy().limits;

  const report: StorageAuditReport = {
    scanned: entries.length,
    foreign: 0,
    deleted: 0,
    deletedBytes: 0,
    reported: 0,
    reportedBytes: 0,
    sparedYoung: 0,
    variantsReady: 0,
    drift: [],
  };

  const pendingObjects = new Map<string, number>();
  const flushObjectOrphans = async () => {
    if (pendingObjects.size === 0) return;
    const removed = await removeUnnamedObjectFiles([...pendingObjects.keys()]);
    for (const hash of removed) {
      report.deleted++;
      report.deletedBytes += pendingObjects.get(hash) ?? 0;
    }
    pendingObjects.clear();
  };

  for (const entry of entries) {
    const { key } = entry;
    if (!isStorageKey(key)) {
      report.foreign++;
      continue;
    }
    if (isReferenced(key, referenced)) continue;
    if (entry.modifiedAt.getTime() > youngerThan) {
      report.sparedYoung++;
      continue;
    }
    if (orphanMode === "report") {
      report.reported++;
      report.reportedBytes += entry.size;
      continue;
    }

    const hash = objectHashOf(key);
    if (hash) {
      pendingObjects.set(hash, entry.size);
      if (pendingObjects.size >= OBJECT_LOCKS_PER_TRANSACTION) {
        await flushObjectOrphans();
      }
      continue;
    }

    if (!(await removeStoredFile(key))) continue;
    report.deleted++;
    report.deletedBytes += entry.size;
  }

  await flushObjectOrphans();

  report.variantsReady = await reconcileVariantsReady(
    entries.map((entry) => entry.key)
  );
  report.drift = await recomputeAllUsage();

  if (report.drift.length > 0) {
    logger.warn("storage counters had drifted", {
      scopes: report.drift.length,
      drift: report.drift,
    });
  }
  logger.info("storage audit finished", {
    scanned: report.scanned,
    deleted: report.deleted,
    deletedBytes: report.deletedBytes,
    reported: report.reported,
    reportedBytes: report.reportedBytes,
    sparedYoung: report.sparedYoung,
    foreign: report.foreign,
  });

  return report;
}

registerJobHandler(
  "storage_audit",
  async () => {
    const { drift, ...counts } = await auditStorage();
    return { ...counts, driftedScopes: drift.length };
  },
  { label: "Auditing storage" }
);

/** Queues an audit unless one is already waiting or running. */
export const enqueueStorageAudit = () => enqueueInstanceJob("storage_audit");

/**
 * Queues an audit now and every `limits.auditIntervalHours` after that, for as
 * long as the process lives, re-armed when the instance changes the interval.
 * `enqueue` is the queueing step, which a test replaces. Returns the stop.
 */
export function startStorageAudits(
  enqueue: () => Promise<unknown> = enqueueStorageAudit
): () => void {
  return startInstanceJobs(enqueue, "could not queue the storage audit", {
    intervalMs: (policy) => policy.limits.auditIntervalHours * HOUR_MS,
  });
}

/** The most recent audit, for the instance storage readout. */
export const lastStorageAudit = () => lastInstanceJob("storage_audit");
