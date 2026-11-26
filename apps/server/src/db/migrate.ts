/**
 * Applies pending migrations and exits: `pnpm migrate` in development, and the
 * first thing the API container does. A failure propagates as a non-zero exit
 * so nothing starts against a schema that is behind.
 */
import { mcpEnabled } from "../lib/env.js";
import { log } from "../lib/log.js";
import { db } from "./index.js";
import { applyMigrations } from "./migrator.js";

const logger = log("migrate");

try {
  await applyMigrations();
  logger.info("migrations applied");
  if (mcpEnabled) {
    // The OAuth provider inserts its resource row when the auth instance
    // initialises. Its duplicate-row check matches the driver's message, which
    // Drizzle wraps, so processes starting together on a fresh database race
    // and all but one throw. Seeding here, once and before anything else
    // starts, leaves them nothing to insert. Imported only now: the tables
    // must exist before initialisation reads them.
    const { auth } = await import("../auth.js");
    await auth.$context;
    logger.info("oauth resource seeded");
  }
} finally {
  await db.$client.end();
}
