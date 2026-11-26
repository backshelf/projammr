import { isLosslessName } from "./lossless.js";

/** What grouping and ordering read of a file; the caller's own row type stays intact. */
export type BounceFile = {
  /** The file's path on the machine that scanned it; either separator may divide it. */
  path: string;
  mtimeMs: number;
  size: number;
  /** The scanning machine, when files from several may be mixed. */
  machine?: string;
};

/** Which of a bounce's files goes first: by size, or by format, with the path as the last word. */
export type BounceOrder = "largest" | "smallest" | "lossless";

/**
 * Where a file sits and what it is called without its extension (lowercased),
 * or null when the name has no extension. The folder is kept as written, its
 * trailing separator included.
 */
export function bounceNameOf(
  path: string
): { folder: string; stem: string } | null {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const file = path.slice(cut + 1);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  return {
    folder: path.slice(0, cut + 1),
    stem: file.slice(0, dot).toLowerCase(),
  };
}

/**
 * Groups files into bounces: the same machine, folder and case-insensitive
 * name, written within `windowMs` of the one before — a DAW exports the
 * formats of one bounce one after another, never hours apart. A name exported
 * again later is a new bounce of its own, not a copy of the first, and so is a
 * file on a path the bounce already holds, however soon after: that is the
 * same file exported again, not another format of it. Every run comes back,
 * singletons included; a file with no extension belongs to none.
 */
export function groupBounces<T>(
  files: readonly T[],
  windowMs: number,
  fileOf: (item: T) => BounceFile
): T[][] {
  const byName = new Map<string, { item: T; file: BounceFile }[]>();
  for (const item of files) {
    const file = fileOf(item);
    const name = bounceNameOf(file.path);
    if (!name) continue;
    const key = JSON.stringify([file.machine ?? null, name.folder, name.stem]);
    const named = byName.get(key);
    if (named) named.push({ item, file });
    else byName.set(key, [{ item, file }]);
  }

  const runs: T[][] = [];
  for (const named of byName.values()) {
    named.sort(
      (a, b) =>
        a.file.mtimeMs - b.file.mtimeMs || compareText(a.file.path, b.file.path)
    );
    let run: { item: T; file: BounceFile }[] = [];
    for (const entry of named) {
      const previous = run.at(-1);
      const path = entry.file.path.toLowerCase();
      if (
        previous &&
        (entry.file.mtimeMs - previous.file.mtimeMs > windowMs ||
          run.some((other) => other.file.path.toLowerCase() === path))
      ) {
        runs.push(run.map(({ item }) => item));
        run = [];
      }
      run.push(entry);
    }
    if (run.length > 0) runs.push(run.map(({ item }) => item));
  }
  return runs;
}

/**
 * A comparator that puts the file to keep first. `largest`: the larger, a tie
 * going to a lossless format; `smallest`: the smaller, the same tie; `lossless`:
 * a lossless format, a tie going to the larger. A tie on both goes to the path
 * that sorts first.
 */
export function preferredFirst<T>(
  order: BounceOrder,
  fileOf: (item: T) => BounceFile
): (a: T, b: T) => number {
  return (itemA, itemB) => {
    const a = fileOf(itemA);
    const b = fileOf(itemB);
    const bySize = order === "smallest" ? a.size - b.size : b.size - a.size;
    const byLossless =
      Number(isLosslessName(b.path)) - Number(isLosslessName(a.path));
    const byPath = compareText(a.path, b.path);
    return order === "lossless"
      ? byLossless || bySize || byPath
      : bySize || byLossless || byPath;
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
