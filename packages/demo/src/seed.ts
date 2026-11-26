/**
 * Seeds the demo catalogue (`catalogue.ts`) into an empty Projammr instance
 * through its HTTP API, the way the client and dit would, then waits
 * for the server's own analysis and image jobs to finish. It writes the ids it
 * created to `--out` (read by the screenshot capture script).
 *
 *   bun run --cwd packages/demo seed -- --api http://localhost:8083 --inputs ~/projammr-demo-audio
 *
 * `--inputs` is the directory `curate.ts` fills: the audio and
 * `sets/<session>.json`. `--out` defaults to `<inputs>/seed-result.json`. The
 * instance must have no accounts yet: give it a fresh database
 * (`.claude/hooks/worktree-setup.sh <path> --db <suffix>`). It runs only
 * from a linked worktree, never the main checkout, whose server holds the
 * owner's own data, and only once `demo-env` has replaced the notes key the
 * worktree's env copied from the main checkout: the seed's notes are
 * encrypted under that key and a snapshot records it.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DemoApi, must } from "./api";
import { Builder } from "./build";
import { catalogue } from "./catalogue";
import { versionsOf } from "./lookup";
import {
  assertNotMainCheckout,
  assertWorkspaceEnv,
  demoNotesKey,
} from "./snapshot-io";
import { WORKSPACE_SERVER_ENV } from "./snapshot-lib";

await assertNotMainCheckout();
await demoNotesKey(
  await Bun.file(await assertWorkspaceEnv(WORKSPACE_SERVER_ENV)).text()
);

const { values } = parseArgs({
  options: {
    api: { type: "string" },
    inputs: { type: "string", default: join(homedir(), "projammr-demo-audio") },
    out: { type: "string" },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (!values.api)
  fail("usage: seed.ts --api <url> [--inputs <dir>] [--out <file>]");
const api = new DemoApi(values.api!.replace(/\/$/, ""));
const out = values.out ?? join(values.inputs, "seed-result.json");

const needed = [
  ...[...versionsOf(catalogue)].map((v) => v.version.file),
  ...catalogue.projects.flatMap((p) =>
    p.sessions.map((s) => join("sets", `${s.key}.json`))
  ),
];
const missing: string[] = [];
for (const file of needed) {
  if (!(await Bun.file(join(values.inputs, file)).exists())) missing.push(file);
}
if (missing.length)
  fail(
    `missing inputs in ${values.inputs} (run curate.ts first):\n${missing.join("\n")}`
  );

const instance = must(
  await api.client().GET("/api/instance"),
  "GET /api/instance"
);
if (instance.hasUsers) {
  fail(
    `${api.baseUrl} already has accounts. The seed expects an empty database; point the API at a fresh one and run it again.`
  );
}

const started = performance.now();
const result = await new Builder(api, catalogue, values.inputs, (line) =>
  console.log(line)
).run();
await Bun.write(out, `${JSON.stringify(result, null, 2)}\n`);

const [admin] = catalogue.accounts;
console.log(
  `\nseeded in ${((performance.now() - started) / 1000).toFixed(0)} s; ids written to ${out}`
);
console.log(`sign in as ${admin!.email} / ${admin!.password}`);
