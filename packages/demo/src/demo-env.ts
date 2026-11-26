/**
 * Prepares this workspace's API to seed the demo world: writes a fresh,
 * demo-only NOTES_MASTER_KEY into the workspace's own
 * `apps/server/.env`, never any other checkout's. It refuses to run from the
 * main checkout, whose key encrypts the owner's own notes, and on an env that
 * names the main checkout's database. The key is what the seed's notes and
 * lyrics are encrypted under, so `snapshot.ts` records it and `restore.ts`
 * puts it back; it guards nothing real.
 *
 *   bun run --cwd packages/demo demo-env
 *
 * Then (re)start the API and run the seed against an empty database.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import {
  assertNotMainCheckout,
  assertWorkspaceEnv,
  writeDemoEnv,
} from "./snapshot-io";
import { WORKSPACE_SERVER_ENV } from "./snapshot-lib";

await assertNotMainCheckout();

const { values } = parseArgs({
  options: { "server-env": { type: "string", default: WORKSPACE_SERVER_ENV } },
});
const envPath = await assertWorkspaceEnv(values["server-env"]);

await writeDemoEnv(envPath, randomBytes(32).toString("base64"));
console.log(
  `wrote a demo NOTES_MASTER_KEY to ${envPath}; restart the API before seeding`
);
