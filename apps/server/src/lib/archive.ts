import { saveSampleRefs } from "../db/queries/archives.js";
import { linkedSampleKinds } from "../db/queries/sample-objects.js";
import { saveFile } from "./dit.js";
import { leavesPresent, sampleBytes, sampleLeaves } from "./sample-objects.js";
import type { ZipEntry } from "./zip.js";

/** What one set of an archive is made from. */
type ArchiveSet = {
  /** The set's file name, `<session name>.als`. */
  fileName: string;
  saveId: number;
  /** The set's `.als` bytes, when the caller has them in hand already. */
  file?: Uint8Array;
  /** When the set's tip commit was made; decides a path two sets share. */
  committedAt?: Date;
};

/** The states the manifest lists a reference in. */
type SampleState =
  | "included"
  | "not pushed"
  | "outside the project folder"
  | "older version, not included";

/** Whether a character is a C0 control code. */
const isControl = (char: string) => char.charCodeAt(0) < 0x20;

/** A file name that cannot be read as a path inside the archive. */
function entryName(name: string): string {
  const cleaned = [...name]
    .map((char) =>
      char === "\\" || char === "/" || isControl(char) ? "_" : char
    )
    .join("")
    .trim();
  return cleaned === "" || cleaned === "." || cleaned === ".."
    ? "set"
    : cleaned;
}

/**
 * Picks a unique archive entry name for `fileName` given the names already
 * `used`, appending ` (2)`, ` (3)`, … to the sanitised base name before its
 * extension rather than stacking suffixes onto previous attempts.
 */
export function uniqueEntryName(
  fileName: string,
  used: ReadonlySet<string>
): string {
  const base = entryName(fileName);
  const dot = base.lastIndexOf(".");
  let name = base;
  for (let n = 2; used.has(name); n++) {
    name =
      dot > 0
        ? `${base.slice(0, dot)} (${n})${base.slice(dot)}`
        : `${base} (${n})`;
  }
  return name;
}

/**
 * A reference's project-relative path as a safe archive path, or null when it
 * is not one: dit only reports `relative` under `Samples/`, but the hub does
 * not take a path from a client into an archive unchecked. An absolute path,
 * a `..` or `.` segment, an empty segment or any path that does not start in
 * `Samples/` is refused. A backslash reads as a separator and leading `./`
 * segments are dropped first, as dit reads them, so a reference counted as held
 * is also placed.
 */
function archivePath(relative: string | undefined): string | null {
  if (relative === undefined) return null;
  // As dit's containment reads a path: either separator, and a leading `./`.
  const segments = relative.replaceAll("\\", "/").split("/");
  while (segments[0] === ".") segments.shift();
  if (segments[0] !== "Samples" || segments.length < 2) return null;
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      [...segment].some(isControl)
    ) {
      return null;
    }
  }
  return segments.join("/");
}

/** One manifest line: the state, a tab, the path as the set writes it. */
const manifestLine = (state: SampleState, path: string) =>
  `${state}\t${path.replace(/[\r\n]/g, " ")}`;

/**
 * The entries of an archive of `sets`, in the project folder's layout: each set
 * at its file name, every sample the hub holds at its `relative` path, and
 * `MANIFEST.txt` last with one line per reference. A set is rebuilt when its
 * turn comes, so only one is in memory at a time. A sample is checked before
 * its entry starts: one whose chunk files are not all there is listed "not
 * pushed", never begun; a chunk that vanishes after its entry began throws out
 * of the generator and ends the response.
 *
 * A folder holds one file at a path. When sets reference a path with different
 * objects, the set with the newest `committedAt` (the later in `sets` on a tie)
 * decides which is written, and the other references are listed "older
 * version, not included": the hub holds that file, the archive just has no
 * place for it.
 */
export async function* archiveEntries(
  sets: readonly ArchiveSet[]
): AsyncGenerator<ZipEntry> {
  const lines = new Set<string>();
  const used = new Set<string>();

  // The references are small; read them all first so each path's newest
  // version is known before the first sample is written.
  const loaded = [];
  const winner = new Map<string, { object: string; at: number }>();
  for (const set of sets) {
    const refs = await saveSampleRefs(set.saveId);
    const kinds = await linkedSampleKinds(set.saveId, refs);
    loaded.push({ set, refs, kinds });
    const at = set.committedAt?.getTime() ?? 0;
    for (const ref of refs) {
      const path = ref.kind === "project" ? archivePath(ref.relative) : null;
      if (path === null || !ref.object || !kinds.has(ref.object)) continue;
      const best = winner.get(path);
      if (!best || at >= best.at) winner.set(path, { object: ref.object, at });
    }
  }

  const written = new Set<string>();
  for (const { set, refs, kinds } of loaded) {
    const bytes = set.file ?? (await saveFile(set.saveId));
    const name = uniqueEntryName(set.fileName, used);
    used.add(name);
    yield { name, data: bytes };

    for (const ref of refs) {
      if (ref.kind !== "project") {
        lines.add(manifestLine("outside the project folder", ref.path));
        continue;
      }
      const path = archivePath(ref.relative);
      const kind = ref.object ? kinds.get(ref.object) : undefined;
      if (path === null || !ref.object || kind === undefined) {
        lines.add(manifestLine("not pushed", ref.path));
        continue;
      }
      if (winner.get(path)!.object !== ref.object) {
        lines.add(manifestLine("older version, not included", ref.path));
        continue;
      }
      if (written.has(path)) {
        lines.add(manifestLine("included", ref.path));
        continue;
      }

      let leaves: string[];
      try {
        leaves = await sampleLeaves(ref.object, kind);
      } catch {
        lines.add(manifestLine("not pushed", ref.path));
        continue;
      }
      if (!(await leavesPresent(leaves))) {
        lines.add(manifestLine("not pushed", ref.path));
        continue;
      }

      written.add(path);
      lines.add(manifestLine("included", ref.path));
      yield { name: path, data: sampleBytes(leaves) };
    }
  }

  const manifest = [...lines].map((line) => `${line}\n`).join("");
  yield { name: "MANIFEST.txt", data: new TextEncoder().encode(manifest) };
}
