import { lt } from "drizzle-orm";
import { db } from "../index.js";
import { errorFields, log } from "../../lib/log.js";
import { startPolicyTimer } from "../../lib/policy-timer.js";
import { deviceCodes } from "../schema/auth.js";

const logger = log("device-codes");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes every device authorization whose `expiresAt` is older than
 * `olderThanMs` (a day by default). Better Auth's `deviceAuthorization` plugin
 * removes a row when it is redeemed, denied or polled past its expiry, so what
 * is left here is a code the device never polled again: a row nobody will
 * read. The day's grace keeps a code that just expired for the plugin's own
 * `expired_token` answer.
 */
export async function reapExpiredDeviceCodes(
  olderThanMs = DAY_MS
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);

  const deleted = await db
    .delete(deviceCodes)
    .where(lt(deviceCodes.expiresAt, cutoff))
    .returning({ id: deviceCodes.id });

  return deleted.length;
}

/**
 * Runs the reaper once at boot, then once a day, unref'd so it cannot hold the
 * process open on its own. Only `server.ts` calls it: `app.ts` is imported by
 * every test file and by `generate-api.ts`, neither of which wants a
 * background interval running against a database that may not exist.
 */
export function startDeviceCodeReaper(): void {
  const run = () => {
    reapExpiredDeviceCodes()
      .then((count) => {
        if (count > 0) logger.info("reaped expired device codes", { count });
      })
      .catch((error) => {
        logger.error("device-code reaper failed", errorFields(error));
      });
  };

  run();
  startPolicyTimer(run, { intervalMs: () => DAY_MS });
}
