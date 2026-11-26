/**
 * Captures every shot in `manifest.ts` from a running Projammr client, in
 * light and dark, on desktop (1440×900) and phone (iPhone 12, 390×844), into
 * `src/assets/screenshots/<id>.<theme>.<viewport>.webp`.
 *
 *   bun apps/web/scripts/screenshots/capture.ts --client http://localhost:3003 \
 *     [--seed ~/projammr-demo-audio/seed-result.json] [--only track,session]
 *
 * The demo world comes from `packages/demo` (see its scripts' headers):
 *
 *   1. With the workspace's API stopped:
 *      `bun run --cwd packages/demo restore` (restores the latest snapshot).
 *      When there is no snapshot, or restore says to reseed:
 *      `curate`, `demo-env`, start the API, `seed`, then `snapshot`.
 *   2. Start the API from `apps/server` (its `.env` now carries the demo notes
 *      key) and a production build of the client: `next build`,
 *      then `next start` on the workspace's port, never `next dev`.
 *   3. Run this script against the client.
 *
 * The seed's result file names the ids the routes need. Motion is emulated as
 * reduced, and each shot waits for the network to go quiet and for fonts and
 * images to finish before it is taken. A full run (no `--only`) also removes
 * screenshots the manifest does not name. Needs `agent-browser` on PATH.
 */
import type { SeedResult } from "@workspace/demo/seed-result";
import { mkdir, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type Shot,
  shots,
  type Step,
  type Theme,
  type Viewport,
} from "./manifest";
import { browser, BUDGET_BYTES, encode, OUT_DIR } from "./shared";

const VIEWPORTS: Record<Viewport, string[][]> = {
  desktop: [["set", "viewport", "1440", "900", "1"]],
  phone: [["set", "device", "iPhone 12"]],
};

const { values } = parseArgs({
  options: {
    client: { type: "string" },
    seed: {
      type: "string",
      default: join(homedir(), "projammr-demo-audio/seed-result.json"),
    },
    only: { type: "string" },
  },
});
if (!values.client) {
  console.error(
    "usage: capture.ts --client <url> [--seed <file>] [--only <id,id>]"
  );
  process.exit(1);
}
const client = values.client.replace(/\/$/, "");
const seed = (await Bun.file(values.seed).json()) as SeedResult;
const only = values.only?.split(",");
const selected = only ? shots.filter((s) => only.includes(s.id)) : shots;
if (only && selected.length !== only.length) {
  console.error(
    `unknown shot id in --only: ${only.filter((id) => !shots.some((s) => s.id === id)).join(", ")}`
  );
  process.exit(1);
}

type Project = SeedResult["projects"][string];

/** What each route placeholder kind looks up in the seed result. */
const PLACEHOLDERS: Record<
  string,
  (key: string) => number | string | undefined
> = {
  project: (key) => seed.projects[key]?.id,
  track: (key) => inProject(key, (p) => p.tracks),
  collection: (key) => inProject(key, (p) => p.collections),
  session: (key) => inProject(key, (p) => p.sessions),
  lyrics: (key) => inProject(key, (p) => p.lyrics),
  invite: (key) => inProject(key, (p) => p.invites),
  note: (key) => seed.notes[Number(key)],
  share: (key) => seed.shareLinks.find((l) => l.entity === key)?.token,
};

/** A `<project>/<entity>` key looked up in one of the project's maps. */
function inProject(
  key: string,
  map: (p: Project) => Record<string, number | string>
) {
  const [project, entity] = key.split("/");
  const found = seed.projects[project!];
  return found && entity ? map(found)[entity] : undefined;
}

/** Resolves a route's `{kind:key}` placeholders against the seed result. */
function resolveRoute(route: string): string {
  return route.replace(/\{(\w+):([^}]+)\}/g, (_, kind: string, key: string) => {
    const found = PLACEHOLDERS[kind]?.(key);
    if (found === undefined)
      throw new Error(`the seed result has no ${kind} "${key}"`);
    return String(found);
  });
}

const GUEST = "guest";
/** The account a shot is taken as: its own, or the seed's first (the producer). */
const viewerOf = (shot: Shot) => shot.as ?? Object.keys(seed.accounts)[0]!;

const sessionName = (as: string, viewport: Viewport) =>
  `projammr-shots-${as}-${viewport}`;

async function runStep(session: string, step: Step) {
  if (Array.isArray(step)) return browser(session, step);
  if ("pause" in step) return Bun.sleep(step.pause);
  const [selector, text] = [step.scroll, step.text ?? ""].map((s) =>
    JSON.stringify(s)
  );
  return browser(session, [
    "eval",
    `[...document.querySelectorAll(${selector})]
      .find((e) => e.textContent.trim().toLowerCase().startsWith(${text}.toLowerCase()))
      ?.scrollIntoView({ block: "start", behavior: "instant" })`,
  ]);
}

/** Waits for the network, the fonts and every image on the page. */
async function settle(session: string) {
  await browser(session, ["wait", "--load", "networkidle"]);
  await browser(session, [
    "wait",
    "--fn",
    "document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)",
  ]);
}

async function prepare(as: string, viewport: Viewport) {
  const session = sessionName(as, viewport);
  await browser(session, ["close"]).catch(() => undefined);
  for (const step of VIEWPORTS[viewport]) await browser(session, step);
  if (as !== GUEST) {
    const account = seed.accounts[as];
    if (!account) throw new Error(`the seed result has no account "${as}"`);
    await browser(session, ["open", `${client}/sign-in`]);
    await settle(session);
    await browser(session, ["fill", "input[name=email]", account.email]);
    await browser(session, ["fill", "input[name=password]", account.password]);
    await browser(session, [
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Sign in",
      "--exact",
    ]);
    // A signed-out visit to any page shows the same form, so the form going
    // away (not the URL changing) is what says the sign-in took.
    await browser(session, [
      "wait",
      "--fn",
      "!document.querySelector('input[name=password]')",
    ]);
  }
  return session;
}

async function capture(
  shot: Shot,
  session: string,
  theme: Theme,
  viewport: Viewport,
  scratch: string
) {
  await browser(session, ["set", "media", theme, "reduced-motion"]);
  await browser(session, ["open", `${client}${resolveRoute(shot.route)}`]);
  await settle(session);
  for (const step of shot.steps ?? []) await runStep(session, step);
  await settle(session);
  const png = join(scratch, `${shot.id}.${theme}.${viewport}.png`);
  await browser(session, ["screenshot", png]);
  const name = `${shot.id}.${theme}.${viewport}.webp`;
  return { name, size: await encode(png, join(OUT_DIR, name), viewport) };
}

await mkdir(OUT_DIR, { recursive: true });
const scratch = join(tmpdir(), `projammr-shots-${process.pid}`);
await mkdir(scratch, { recursive: true });

const written: { name: string; size: number }[] = [];
const failed: string[] = [];
for (const viewport of ["desktop", "phone"] as const) {
  for (const as of new Set(selected.map(viewerOf))) {
    const batch = selected.filter(
      (s) =>
        viewerOf(s) === as &&
        (s.viewports ?? ["desktop", "phone"]).includes(viewport)
    );
    if (!batch.length) continue;
    const session = await prepare(as, viewport);
    for (const shot of batch) {
      for (const theme of shot.themes ?? (["light", "dark"] as const)) {
        try {
          const file = await capture(shot, session, theme, viewport, scratch);
          written.push(file);
          console.log(`${file.name}  ${(file.size / 1024).toFixed(0)} KB`);
        } catch (error) {
          failed.push(
            `${shot.id}.${theme}.${viewport}: ${(error as Error).message.trim()}`
          );
          console.error(`failed ${shot.id}.${theme}.${viewport}`);
        }
      }
    }
    await browser(session, ["close"]).catch(() => undefined);
  }
}
await rm(scratch, { recursive: true, force: true });

if (!only && !failed.length) {
  const keep = new Set(written.map((w) => w.name));
  for (const name of await readdir(OUT_DIR)) {
    if (name.endsWith(".webp") && !keep.has(name)) {
      await rm(join(OUT_DIR, name));
      console.log(`removed ${name}, no longer in the manifest`);
    }
  }
}

const total = written.reduce((sum, w) => sum + w.size, 0);
const over = written.filter((w) => w.size > BUDGET_BYTES);
console.log(
  `\n${written.length} screenshots, ${(total / 1048576).toFixed(1)} MB in ${OUT_DIR}`
);
if (over.length)
  console.log(
    `over ${BUDGET_BYTES / 1024} KB: ${over.map((w) => w.name).join(", ")}`
  );
if (failed.length) {
  console.error(`\n${failed.length} failed:\n${failed.join("\n")}`);
  process.exitCode = 1;
}
