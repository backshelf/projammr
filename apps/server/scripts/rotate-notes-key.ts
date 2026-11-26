/**
 * Re-wraps every note's data key onto the current `NOTES_MASTER_KEY`, run by
 * hand after a key rotation: set `NOTES_MASTER_KEY` to the new key,
 * `NOTES_MASTER_KEY_PREVIOUS` to the one every note was wrapped under before,
 * raise `NOTES_KEY_VERSION` by one, restart the API, then run this against
 * the live database (in the image: `bun dist/scripts/rotate-notes-key.js`).
 * Safe to interrupt and re-run at any point — each batch is its own
 * transaction, and a note already on the current version is never selected
 * again — so once it reports 0 remaining, `NOTES_MASTER_KEY_PREVIOUS` can be
 * unset.
 */
import {
  countNotesOnPreviousKeyVersion,
  rotateNotesKeyBatch,
} from "../src/db/queries/notes-key-rotation.js";
import { db } from "../src/db/index.js";
import { log } from "../src/lib/log.js";

const logger = log("rotate-notes-key");

try {
  let rewrapped = 0;
  for (;;) {
    const moved = await rotateNotesKeyBatch();
    if (moved === 0) break;
    rewrapped += moved;
    logger.info("rewrapped a batch", { batch: moved, total: rewrapped });
  }

  const remaining = await countNotesOnPreviousKeyVersion();
  logger.info("rotation complete", { rewrapped, remaining });
} finally {
  await db.$client.end();
}
