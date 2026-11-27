/**
 * One-off backfill: derive accent colours for image rows uploaded before the
 * palette extractor existed. Run with `bun src/db/backfill-palette.ts` from
 * `apps/server`. Idempotent — pass `--all` to recompute rows that already have
 * a value.
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "./index.js";
import { log } from "../lib/log.js";
import { extractPalette } from "../lib/palette.js";
import { readStoredBytes } from "../lib/storage.js";
import { images } from "./schema/images.js";

const logger = log("backfill-palette");

const recomputeAll = process.argv.includes("--all");

const rows = await db
  .select()
  .from(images)
  .where(recomputeAll ? undefined : isNull(images.accentHex));

logger.info("rows to process", { rows: rows.length });

let done = 0;
let failed = 0;

for (const row of rows) {
  try {
    const buffer = Buffer.from(await readStoredBytes(row.assetPath));
    const palette = await extractPalette(buffer);
    await db
      .update(images)
      .set({
        accentHue: palette.accentHue,
        accentChroma: palette.accentChroma,
        accentHex: palette.accentHex,
      })
      .where(eq(images.id, row.id));
    done += 1;
  } catch (e) {
    failed += 1;
    logger.error("row failed", {
      id: row.id,
      assetPath: row.assetPath,
      error: (e as Error).message,
    });
  }
}

logger.info("backfill complete", { updated: done, failed });
process.exit(failed > 0 ? 1 : 0);
