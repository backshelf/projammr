import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { describe, expect, it, jest, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { variantKey, VARIANT_WIDTHS } from "../../lib/images.js";
import { mediaQueue } from "../../lib/jobs.js";
import { objectKey, storedFilePath } from "../../lib/storage.js";
import { baseUrl, onDiskPath, setupSuite } from "../../test/fixtures.js";
import { holdTransaction } from "../../test/held-transaction.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import { db } from "../index.js";
import { images } from "../schema/images.js";
import { objects } from "../schema/objects.js";
import { storageUsage } from "../schema/storage-usage.js";
import { lockObjects } from "./objects.js";
import {
  auditStorage,
  ORPHAN_AGE_MS,
  startStorageAudits,
} from "./storage-audit.js";

const HOUR_MS = 60 * 60 * 1000;

/** Room for a held transaction and the waits queued behind it, under load. */
const RACE_TIMEOUT = 20_000;
import { projectScope, usageFor } from "./storage-usage.js";

const suite = setupSuite("Storage audit");
const { owner, requireProject, uploadAsset, uploadImage } = suite;

/** Writes a file below the static root, optionally dated into the past. */
async function put(key: string, contents: string, ageMs = 0): Promise<string> {
  const path = storedFilePath(key);
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, contents);

  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(path, when, when);
  }
  return path;
}

const older = ORPHAN_AGE_MS + 60_000;

describe("the storage audit", () => {
  it("removes an aged orphan and spares a fresh one", async () => {
    const orphan = await put(
      `assets/${crypto.randomUUID()}.txt`,
      "nobody's",
      older
    );
    const fresh = await put(`assets/${crypto.randomUUID()}.txt`, "just landed");

    const report = await auditStorage();

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(report.deletedBytes).toBeGreaterThanOrEqual("nobody's".length);
    expect(report.sparedYoung).toBeGreaterThanOrEqual(1);
  });

  it("only counts an aged orphan while the instance reports orphans rather than deleting them", async () => {
    stubInstancePolicy({ limits: { orphanMode: "report" } });
    try {
      const orphan = await put(
        `assets/${crypto.randomUUID()}.txt`,
        "reported only",
        older
      );

      const report = await auditStorage();

      expect(existsSync(orphan)).toBe(true);
      expect(report.deleted).toBe(0);
      expect(report.reported).toBeGreaterThanOrEqual(1);
      expect(report.reportedBytes).toBeGreaterThanOrEqual(
        "reported only".length
      );
    } finally {
      restoreInstancePolicy();
    }
  });

  it("spares a file a row still names, however old it is", async () => {
    requireProject();
    const asset = await uploadAsset("kept.txt");
    const when = new Date(Date.now() - older);
    await utimes(onDiskPath(asset.assetPath), when, when);

    await auditStorage();

    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);
  });

  it("spares an object its table names and reaps an unnamed one and an abandoned temporary file", async () => {
    const hash = new Bun.CryptoHasher("sha256")
      .update(crypto.randomUUID())
      .digest("hex");
    const stray = new Bun.CryptoHasher("sha256")
      .update(crypto.randomUUID())
      .digest("hex");
    await db.insert(objects).values({ hash, kind: 1, size: 3 });
    const named = await put(objectKey(hash), "abc", older);
    const unnamed = await put(objectKey(stray), "abc", older);
    const temporary = await put(
      `${objectKey(stray)}.tmp-${crypto.randomUUID()}`,
      "ab",
      older
    );

    try {
      await auditStorage();

      expect(existsSync(named)).toBe(true);
      expect(existsSync(unnamed)).toBe(false);
      expect(existsSync(temporary)).toBe(false);
    } finally {
      await db.delete(objects).where(eq(objects.hash, hash));
      await rm(named, { force: true });
    }
  });

  it(
    "spares an aged object file a push records while the audit is deciding on it",
    async () => {
      const hash = new Bun.CryptoHasher("sha256")
        .update(crypto.randomUUID())
        .digest("hex");
      const reused = await put(objectKey(hash), "abc", older);
      const push = await holdTransaction((tx) => lockObjects(tx, [hash]));

      try {
        const auditing = auditStorage();
        await push.blocking();
        await push.commit(async (tx) => {
          await tx.insert(objects).values({ hash, kind: 1, size: 3 });
        });
        await auditing;

        expect(existsSync(reused)).toBe(true);
      } finally {
        await push.commit();
        await db.delete(objects).where(eq(objects.hash, hash));
        await rm(reused, { force: true });
      }
    },
    RACE_TIMEOUT
  );

  it("spares the resizes of an image that is still there, and reaps an orphaned one", async () => {
    requireProject();
    const image = await uploadImage("audited.jpeg");
    await mediaQueue.idle();

    const kept = variantKey(image.assetPath, VARIANT_WIDTHS[0]);
    const when = new Date(Date.now() - older);
    await utimes(storedFilePath(kept), when, when);

    const strayVariant = await put(
      variantKey(`images/${crypto.randomUUID()}.jpeg`, VARIANT_WIDTHS[0]),
      "resize of nothing",
      older
    );

    await auditStorage();

    expect(existsSync(storedFilePath(kept))).toBe(true);
    expect(existsSync(strayVariant)).toBe(false);
  });

  it("leaves a file that is not under a storage directory alone", async () => {
    const foreign = await put("notes.txt", "put here by hand", older);

    const report = await auditStorage();

    expect(existsSync(foreign)).toBe(true);
    expect(report.foreign).toBeGreaterThanOrEqual(1);
  });

  it("marks an image whose resizes are all on disk", async () => {
    requireProject();
    const image = await uploadImage("ready.jpeg");
    await mediaQueue.idle();

    await db
      .update(images)
      .set({ variantsReady: false })
      .where(eq(images.id, image.id));

    await auditStorage();

    const [row] = await db
      .select({ ready: images.variantsReady })
      .from(images)
      .where(eq(images.id, image.id));
    expect(row!.ready).toBe(true);
  });

  it("re-derives a counter that has been written wrong and reports the drift", async () => {
    requireProject();
    await uploadAsset("recounted.txt");
    const correct = await usageFor(projectScope(suite.projectId));

    await db
      .update(storageUsage)
      .set({ bytes: 1 })
      .where(eq(storageUsage.scopeId, String(suite.projectId)));

    const report = await auditStorage();

    expect(await usageFor(projectScope(suite.projectId))).toBe(correct);
    expect(report.drift).toContainEqual({
      scopeKind: "project",
      scopeId: String(suite.projectId),
      recordedBytes: 1,
      actualBytes: correct,
    });
  });

  it("runs as a job whose row carries what it found", async () => {
    await put(`analysis/${crypto.randomUUID()}.png`, "stale tile", older);

    const { enqueueStorageAudit } = await import("./storage-audit.js");
    const jobId = await enqueueStorageAudit();
    expect(jobId).toBeNumber();
    await mediaQueue.idle();

    const res = await app.request(`${baseUrl}/jobs/${jobId}`, {
      headers: { Cookie: owner.cookie },
    });
    // The audit belongs to no project, so no project's routes will show it.
    expect(res.status).toBe(404);

    const row = await db.query.jobs.findFirst({ where: { id: jobId } });
    expect(row?.status).toBe("done");
    expect(row?.result).toMatchObject({ deleted: expect.any(Number) });
    expect(row?.projectId).toBeNull();
  });
});

describe("startStorageAudits", () => {
  it("queues an audit at once and then every interval, re-arming when the instance changes it", () => {
    jest.useFakeTimers();
    const enqueue = mock(async () => undefined);
    const stop = startStorageAudits(enqueue);
    try {
      expect(enqueue).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(24 * HOUR_MS);
      expect(enqueue).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(HOUR_MS);
      stubInstancePolicy({ limits: { auditIntervalHours: 2 } });
      jest.advanceTimersByTime(2 * HOUR_MS);
      expect(enqueue).toHaveBeenCalledTimes(3);
    } finally {
      stop();
      restoreInstancePolicy();
      jest.useRealTimers();
    }
  });
});
