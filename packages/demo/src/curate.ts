/**
 * Turns the owner's private material into the demo's inputs. The audio the
 * catalogue names is copied out of the source directory into the demo audio
 * directory, audio stream only (ffmpeg, no re-encode), so tags and embedded
 * artwork stay behind. Each session's Ableton set is parsed with dit's own
 * parser (`@workspace/dit/wasm`, so `bun run --filter @workspace/dit build`
 * first), moved onto the demo producer's machine and given demo
 * names, and written as `sets/<session>.json` for the seed. Nothing in the
 * source directory is moved, renamed or deleted.
 *
 *   bun run --cwd packages/demo curate -- --source-dir ~/Downloads --out ~/projammr-demo-audio
 *
 * What each demo file really is lives only in `<out>/curation.json` (or
 * `--curation <file>`), outside the repository:
 *
 *   {
 *     "audio": { "<catalogue file>": "<file in --source-dir>" },
 *     "sets": { "<session key>": { "file": "<path to the .als>",
 *                                  "names": { "<real name>": "<demo name>" } } }
 *   }
 *
 * `names` replaces text in the set's track names and sample paths; the run
 * fails if any of it is still there afterwards. Needs `ffmpeg` and `ffprobe`.
 */
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadDit } from "@workspace/dit/wasm";
import { catalogue } from "./catalogue";
import type { DemoSet } from "./demo-set";
import { versionsOf } from "./lookup";
import type { DemoSession } from "./model";
import { spreadSamples } from "./sample-spread";
import { rebaseHome } from "./session-history";

/** How far a source file's duration may drift from the catalogue's before the pick is suspect. */
const DURATION_TOLERANCE_MS = 1000;

interface Curation {
  audio: Record<string, string>;
  sets: Record<string, { file: string; names: Record<string, string> }>;
}

const home = homedir();
const expand = (path: string) => path.replace(/^~(?=\/)/, home);
const { values } = parseArgs({
  options: {
    "source-dir": { type: "string", default: join(home, "Downloads") },
    out: { type: "string", default: join(home, "projammr-demo-audio") },
    curation: { type: "string" },
  },
});
const sourceDir = expand(values["source-dir"]);
const outDir = expand(values.out);
const curation = (await Bun.file(
  expand(values.curation ?? join(outDir, "curation.json"))
).json()) as Curation;

async function probe(path: string) {
  const out =
    await $`ffprobe -v error -show_entries format=duration,bit_rate -of json ${path}`.json();
  const format = (out as { format: { duration: string; bit_rate: string } })
    .format;
  return {
    durationMs: Math.round(Number(format.duration) * 1000),
    bitRate: Number(format.bit_rate),
  };
}

/** The set as the seed sees it: parsed, on the demo machine, under demo names. */
async function curateSet(session: DemoSession, set: Curation["sets"][string]) {
  const xml = Bun.gunzipSync(await Bun.file(expand(set.file)).bytes());
  const meta = loadDit().parse("ableton", xml);
  const rename = (text: string) =>
    Object.entries(set.names).reduce(
      (out, [from, to]) => out.split(from).join(to),
      text
    );
  const relocate = (paths: string[]) =>
    rebaseHome(paths, session.home).map(rename);
  const curated: DemoSet = {
    tempo: meta.tempo != null ? Number(meta.tempo) : undefined,
    timeSignature: meta.timeSignature ?? undefined,
    rootNote: meta.rootNote ?? undefined,
    scale: meta.scale ?? undefined,
    tracksCount: meta.tracksCount ?? undefined,
    scenesCount: meta.scenesCount ?? undefined,
    dawVersion: meta.dawVersion ?? undefined,
    samples: meta.samplePaths
      ? spreadSamples(relocate(meta.samplePaths))
      : undefined,
    structure: meta.structure
      ? {
          ...meta.structure,
          clips: meta.structure.clips ?? { audio: 0, midi: 0 },
          tracks: meta.structure.tracks.map((t) => ({
            ...t,
            name: rename(t.name),
          })),
        }
      : undefined,
  };
  const json = JSON.stringify(curated, null, 2);
  const left = Object.keys(set.names).filter((name) => json.includes(name));
  if (left.length)
    throw new Error(`${session.key}: still names ${left.join(", ")}`);
  return json;
}

await mkdir(join(outDir, "sets"), { recursive: true });
const entries: {
  file: string;
  title: string;
  source: string;
  bytes: number;
  durationMs: number;
  bitRate: number;
}[] = [];
const problems: string[] = [];

for (const { track, version } of versionsOf(catalogue)) {
  const name = curation.audio[version.file];
  if (!name) {
    problems.push(`${version.file}: curation.json names no source for it`);
    continue;
  }
  const source = join(sourceDir, name);
  const target = join(outDir, version.file);
  if (!(await Bun.file(source).exists())) {
    problems.push(`${version.file}: its source is not in ${sourceDir}`);
    continue;
  }
  const { durationMs } = await probe(source);
  if (Math.abs(durationMs - version.durationMs) > DURATION_TOLERANCE_MS) {
    problems.push(
      `${version.file}: the source is ${durationMs} ms long, the catalogue says ${version.durationMs} ms`
    );
    continue;
  }
  if (!(await Bun.file(target).exists())) {
    await $`ffmpeg -v error -n -i ${source} -map 0:a:0 -map_metadata -1 -c:a copy ${target}`;
  }
  entries.push({
    file: version.file,
    title: track.title,
    source: name,
    bytes: Bun.file(target).size,
    ...(await probe(target)),
  });
}

const wanted = new Set([...versionsOf(catalogue)].map((v) => v.version.file));
for (const file of Object.keys(curation.audio)) {
  if (!wanted.has(file))
    problems.push(`${file}: in curation.json but not in the catalogue`);
}

for (const session of catalogue.projects.flatMap((p) => p.sessions)) {
  const set = curation.sets[session.key];
  if (!set) {
    problems.push(`session ${session.key}: curation.json names no set for it`);
    continue;
  }
  await Bun.write(
    join(outDir, "sets", `${session.key}.json`),
    `${await curateSet(session, set)}\n`
  );
}

await Bun.write(
  join(outDir, "sources.json"),
  `${JSON.stringify({ sourceDir, files: entries }, null, 2)}\n`
);
const mb = entries.reduce((sum, e) => sum + e.bytes, 0) / 1048576;
console.log(
  `copied ${entries.length} files (${mb.toFixed(0)} MB) to ${outDir}`
);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exitCode = 1;
}
