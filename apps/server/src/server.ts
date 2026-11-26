import { db } from "./db/index.js";
import { startDeviceCodeReaper } from "./db/queries/device-codes.js";
import { startGuestReaper } from "./db/queries/guests.js";
import { startJobRunner } from "./db/queries/jobs.js";
import { assertNotesKeyOpensCurrentVersion } from "./db/queries/notes-key-rotation.js";
import { startRetentionSweeper } from "./db/queries/retention.js";
import { startSaveContentSweeper } from "./db/queries/save-retention.js";
import {
  reloadInstanceSettings,
  startInstanceSettingsRefresh,
} from "./db/queries/settings.js";
import { startStorageAudits } from "./db/queries/storage-audit.js";
import { beginShutdown, IDLE_TIMEOUT_SECONDS } from "./lib/connections.js";
import { MAX_REQUEST_BODY_BYTES } from "./lib/instance-policy.js";
import { errorFields, log } from "./lib/log.js";
import { loadPronunciation } from "./lib/pronunciation.js";
import { setListeningPort } from "./lib/self-origin.js";
import { loadThesaurus } from "./lib/thesaurus.js";

const logger = log("server");

/**
 * How long a shutdown may take before the process is cut off. Docker sends
 * SIGKILL ten seconds after SIGTERM, so this stays inside that.
 */
const SHUTDOWN_TIMEOUT_MS = 8_000;

process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", errorFields(err));
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", errorFields(reason));
});

/**
 * The port the API listens on when `PORT` says nothing. Docker, the Caddyfile
 * and every document that names an address assume it; `PORT` exists so that
 * several checkouts can serve at once.
 */
const DEFAULT_PORT = 8080;

// A key setup the stored notes cannot be opened under (a changed key, a
// version that went backwards, a rotation left without its previous key) stops
// the process here, with the fix in the message, instead of failing note by note.
// Exited by hand: the uncaughtException listener above would otherwise log the
// rejection and leave the process idling until the pool let go, exiting 0.
await assertNotesKeyOpensCurrentVersion().catch((err: unknown) => {
  logger.error("refusing to start", errorFields(err));
  process.exit(1);
});

// The stored instance settings, before the app is first evaluated: `auth.ts`
// takes the session lifetime and the MCP switch from the policy as it is
// imported, and keeps them until the next start, so they have to be the
// stored ones rather than the environment's. That is why the app is imported
// here and not with the modules above, none of which reach it. A load that
// fails is logged and leaves the environment's policy until the refresh below
// succeeds.
await reloadInstanceSettings();
const { app } = await import("./app.js");

const server = Bun.serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  // The transport ceiling, the most any route could be allowed: the upload
  // limit is a setting that can be raised up to it without a restart, and
  // Bun's 128 MiB default would refuse such an upload before the app ran.
  // What a route actually reads is held per request by the body limits in
  // `middleware/body-limit.ts` (`app.ts`): an upload to the instance's limit,
  // every other route to a fixed cap far below this.
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
});

setListeningPort(server.port ?? DEFAULT_PORT);

logger.info("listening", {
  url: server.url.href,
  pid: process.pid,
});

/**
 * Ends the responses that stay open until their client leaves, stops taking
 * requests, lets the others in flight finish, releases the pool and exits, so
 * a container stop ends the process at once instead of waiting out the
 * orchestrator's timeout. Media jobs mid-run are not waited for: the runner
 * queues them again on the next boot.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info("shutting down", { signal });
  setTimeout(() => {
    logger.error("shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  beginShutdown();
  await server.stop();
  await db.$client.end();
  process.exit(0);
}

process.once("SIGTERM", (signal) => void shutdown(signal));
process.once("SIGINT", (signal) => void shutdown(signal));

// Importing the app loaded every module that owns a job kind, so the
// handlers are registered before any resumed row reaches the runner.
void startJobRunner();

// The orphan reaper and the storage re-count, on the instance's interval. The
// first run is at boot: the age floor protects anything an interrupted process
// was in the middle of writing, so there is nothing to wait for. The guest
// reaper, the history sweeper and the save content sweeper keep their
// retention windows the same way; the device code reaper clears codes a day
// past their expiry.
startStorageAudits();
startGuestReaper();
startRetentionSweeper();
startSaveContentSweeper();
startDeviceCodeReaper();

// Every process follows a settings change another one made, on the cache's
// interval; the writing process has already applied its own.
startInstanceSettingsRefresh();

// The pronouncing dictionary and WordNet each cost a few hundred
// milliseconds and tens of megabytes to index, so they are kept out of
// module scope — every test file and the typegen script import the app —
// and warmed here instead, where the first lyrics request will not have to
// wait for them.
void loadPronunciation();
void loadThesaurus();
