import { rm } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { acceptObjects } from "../db/queries/objects.js";
import {
  objects,
  repoObjects,
  saveObjects,
  saveSampleObjects,
} from "../db/schema/objects.js";
import { chunk } from "../lib/chunk.js";
import {
  concatBytes,
  objectRecord,
  type PackRecord,
  packOf,
  recordBytes,
} from "@workspace/dit/pack";
import { objectKey, storedFilePath } from "../lib/storage.js";

export { concatBytes, objectRecord, packOf, recordBytes };

/**
 * Takes `record` into the repo as a pack of that one record, answering
 * whether the push stored it or the hub already had its bytes.
 */
export async function acceptRecord(
  repoId: number,
  pushedBy: string,
  record: PackRecord
): Promise<"stored" | "known"> {
  const { stored } = await acceptObjects(repoId, pushedBy, [record]);
  return stored > 0 ? "stored" : "known";
}

/**
 * Removes objects a test stored: their save and repo links, their rows and
 * their files, none of which a project's delete reaches.
 */
export async function removeObjects(hashes: string[]): Promise<void> {
  for (const batch of chunk(hashes, 5_000)) {
    await db.delete(saveObjects).where(inArray(saveObjects.objectHash, batch));
    await db
      .delete(saveSampleObjects)
      .where(inArray(saveSampleObjects.objectHash, batch));
    await db.delete(repoObjects).where(inArray(repoObjects.objectHash, batch));
    await db.delete(objects).where(inArray(objects.hash, batch));
    await Promise.all(
      batch.map((hash) => rm(storedFilePath(objectKey(hash)), { force: true }))
    );
  }
}
