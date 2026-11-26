import { desc, eq, gt, lt, sql } from "drizzle-orm";
import { notesMasterKeys } from "../../lib/env.js";
import {
  type MasterKeys,
  PREVIOUS_KEY_ENV_VAR,
  rewrap,
  unwrap,
} from "../../lib/notes-crypto.js";
import { db, type Tx } from "../index.js";
import { notes } from "../schema/notes.js";

/** How many notes `rotateNotesKeyBatch` re-wraps per call. */
const ROTATION_BATCH_SIZE = 500;

/** How the refusals below tell an operator to run `scripts/rotate-notes-key.ts` in the image. */
const ROTATE_COMMAND = "`bun dist/scripts/rotate-notes-key.js`";

/**
 * How many notes are still wrapped under a key version older than the
 * current one — `scripts/rotate-notes-key.ts`'s "am I done" check: at 0,
 * `NOTES_MASTER_KEY_PREVIOUS` can be unset.
 */
export async function countNotesOnPreviousKeyVersion(
  keys: MasterKeys = notesMasterKeys
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notes)
    .where(lt(notes.keyVersion, keys.version));
  return row?.count ?? 0;
}

/**
 * Refuses a start the notes could not survive: when a note already tagged
 * with the current `NOTES_KEY_VERSION` will not open under `NOTES_MASTER_KEY`,
 * the key was changed without a rotation, and every read and write of that
 * note would fail later, one request at a time. One note is enough — every
 * note on a version is wrapped under the same root key. With no note on the
 * current version there is nothing to check. A note on a version above the
 * current one means `NOTES_KEY_VERSION` went backwards (dropped from `.env`,
 * so compose's default of 1 took over): every such note would fail to open,
 * and new ones would be written under the old version beside them. Notes
 * below the current version are a rotation in progress while
 * `NOTES_MASTER_KEY_PREVIOUS` is set; with it unset (a rotation abandoned
 * halfway, or the previous key removed before the rotate script reached 0),
 * none of them would open.
 */
export async function assertNotesKeyOpensCurrentVersion(
  keys: MasterKeys = notesMasterKeys
): Promise<void> {
  const [highest] = await db
    .select({ version: notes.keyVersion })
    .from(notes)
    .where(gt(notes.keyVersion, keys.version))
    .orderBy(desc(notes.keyVersion))
    .limit(1);
  if (highest) {
    throw new Error(
      `Notes are stored under NOTES_KEY_VERSION ${highest.version}, above the configured ${keys.version}. ` +
        `Set NOTES_KEY_VERSION to ${highest.version} (when it is unset it defaults to 1).`
    );
  }

  if (!keys.previous) {
    const below = await countNotesOnPreviousKeyVersion(keys);
    if (below > 0) {
      throw new Error(
        `${below === 1 ? "1 note is" : `${below} notes are`} stored under a NOTES_KEY_VERSION below the configured ` +
          `${keys.version}, and ${PREVIOUS_KEY_ENV_VAR} is not set to open them. ` +
          `Put the old key back in ${PREVIOUS_KEY_ENV_VAR}, start the API, then finish the rotation ` +
          `with the rotate script (${ROTATE_COMMAND}).`
      );
    }
  }

  const [row] = await db
    .select({
      wrappedKey: notes.wrappedKey,
      keyScope: notes.keyScope,
      keyVersion: notes.keyVersion,
    })
    .from(notes)
    .where(eq(notes.keyVersion, keys.version))
    .limit(1);
  if (!row) return;

  try {
    unwrap(keys, row);
  } catch (cause) {
    throw new Error(
      `NOTES_MASTER_KEY cannot open the notes stored under NOTES_KEY_VERSION ${keys.version}. ` +
        `If the key was changed on purpose, put the old key in ${PREVIOUS_KEY_ENV_VAR}, ` +
        `raise NOTES_KEY_VERSION to ${keys.version + 1}, start the API, then run the rotate script ` +
        `(${ROTATE_COMMAND}). Otherwise restore the original NOTES_MASTER_KEY.`,
      { cause }
    );
  }
}

/**
 * Re-wraps up to `limit` notes still on an older key version, all in one
 * transaction. `FOR UPDATE SKIP LOCKED` is what makes the batch the unit of
 * resumability: a run interrupted mid-transaction commits nothing, so the
 * rows it had locked are exactly the rows the next call picks up, and a
 * second run started concurrently takes the next batch instead of waiting on
 * rows the first is already re-wrapping. `scripts/rotate-notes-key.ts` loops
 * this at the default {@link ROTATION_BATCH_SIZE} until it returns 0; a
 * smaller `limit` is what a test uses to see several batches without seeding
 * hundreds of rows, and `keys` defaults to the app's own so a test can drive
 * a rotation between two keys it generated instead of the real
 * `NOTES_MASTER_KEY`. Content is never touched — only the data key's own
 * wrapping, the same as {@link rewrap} already does for a scope change,
 * called here with the row's own scope unchanged.
 */
export async function rotateNotesKeyBatch(
  limit: number = ROTATION_BATCH_SIZE,
  keys: MasterKeys = notesMasterKeys
): Promise<number> {
  return db.transaction(async (tx: Tx) => {
    const batch = await tx
      .select({
        id: notes.id,
        keyScope: notes.keyScope,
        keyVersion: notes.keyVersion,
        wrappedKey: notes.wrappedKey,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(lt(notes.keyVersion, keys.version))
      .orderBy(notes.id)
      .limit(limit)
      .for("update", { skipLocked: true });

    for (const row of batch) {
      const envelope = rewrap(keys, row, row.keyScope);
      // updatedAt is written back unchanged: a re-wrap is not an edit, and
      // the author's notebook is ordered by when a note was last written to.
      await tx
        .update(notes)
        .set({ ...envelope, updatedAt: row.updatedAt })
        .where(eq(notes.id, row.id));
    }

    return batch.length;
  });
}
