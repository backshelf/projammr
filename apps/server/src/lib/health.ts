import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { mediaQueue } from "./jobs.js";
import { binaryPresent } from "./media.js";
import { FFMPEG_PATH } from "./media-binaries.js";
import { appVersion } from "./version.js";

/** Long enough to cross a busy pool, short enough to answer a monitor. */
const DB_TIMEOUT_MS = 2000;

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.boolean(),
  media: z.object({
    ffmpeg: z.boolean(),
  }),
  queue: z.number(),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

async function databaseReachable(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database check timed out")),
          DB_TIMEOUT_MS
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the deployment can currently do, and which version is running. The
 * version is already public on `/api/instance`. Says nothing
 * about how the deployment is configured — the endpoint is public.
 */
export async function checkHealth(): Promise<Health> {
  const [database, ffmpeg] = await Promise.all([
    databaseReachable(),
    binaryPresent(FFMPEG_PATH),
  ]);

  return {
    status: database && ffmpeg ? "ok" : "degraded",
    db: database,
    media: { ffmpeg },
    queue: mediaQueue.size,
    version: appVersion,
  };
}
