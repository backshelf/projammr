import { describe, expect, test } from "bun:test";
import {
  type BounceFile,
  bounceNameOf,
  groupBounces,
  preferredFirst,
} from "./bounce.js";
import { isLosslessName, LOSSLESS_EXTENSIONS } from "./lossless.js";

const MIN = 60 * 1000;

const file = (
  path: string,
  atMinutes: number,
  size = 1000,
  machine?: string
): BounceFile => ({ path, mtimeMs: atMinutes * MIN, size, machine });

const paths = (runs: BounceFile[][]) =>
  runs
    .map((run) => run.map((f) => f.path))
    .sort((a, b) => a[0]!.localeCompare(b[0]!));

const group = (files: BounceFile[], windowMs = 2 * MIN) =>
  groupBounces(files, windowMs, (f) => f);

describe("isLosslessName", () => {
  test("names every lossless extension, in any case", () => {
    for (const ext of LOSSLESS_EXTENSIONS) {
      expect(isLosslessName(`Song${ext}`)).toBe(true);
      expect(isLosslessName(`SONG${ext.toUpperCase()}`)).toBe(true);
    }
  });

  test("rejects lossy formats and extensionless names", () => {
    expect(isLosslessName("Song.mp3")).toBe(false);
    expect(isLosslessName("Song.m4a")).toBe(false);
    expect(isLosslessName("wav")).toBe(false);
  });
});

describe("bounceNameOf", () => {
  test("splits a posix path into folder and lowercased stem", () => {
    expect(bounceNameOf("/music/Mixes/Song.WAV")).toEqual({
      folder: "/music/Mixes/",
      stem: "song",
    });
  });

  test("splits a windows path on backslashes", () => {
    expect(bounceNameOf("C:\\Music\\Mixes\\Song.mp3")).toEqual({
      folder: "C:\\Music\\Mixes\\",
      stem: "song",
    });
  });

  test("keeps the folder's case as written", () => {
    expect(bounceNameOf("/Music/MIXES/a.wav")?.folder).toBe("/Music/MIXES/");
  });

  test("keeps every dot but the last in the stem", () => {
    expect(bounceNameOf("/m/song v1.2.wav")?.stem).toBe("song v1.2");
  });

  test("is null without an extension", () => {
    expect(bounceNameOf("/m/Song")).toBeNull();
    expect(bounceNameOf("/m/.wav")).toBeNull();
  });

  test("a bare name has an empty folder", () => {
    expect(bounceNameOf("Song.wav")).toEqual({ folder: "", stem: "song" });
  });
});

describe("groupBounces", () => {
  test("groups formats of one name written within the window", () => {
    const runs = group([file("/m/Song.wav", 0), file("/m/Song.mp3", 1)]);
    expect(paths(runs)).toEqual([["/m/Song.wav", "/m/Song.mp3"]]);
  });

  test("returns singletons as runs of one", () => {
    const runs = group([file("/m/A.wav", 0), file("/m/B.wav", 0)]);
    expect(paths(runs)).toEqual([["/m/A.wav"], ["/m/B.wav"]]);
  });

  test("chains files each within the window of the one before", () => {
    const runs = group([
      file("/m/Song.wav", 0),
      file("/m/Song.mp3", 2),
      file("/m/Song.flac", 4),
    ]);
    expect(runs).toHaveLength(1);
  });

  test("splits on a gap over the window and keeps a gap equal to it", () => {
    const equal = group([file("/m/Song.wav", 0), file("/m/Song.mp3", 2)]);
    expect(equal).toHaveLength(1);
    const over = group([file("/m/Song.wav", 0), file("/m/Song.mp3", 2.5)]);
    expect(over).toHaveLength(2);
  });

  test("puts the same name exported hours later in its own run", () => {
    const runs = group([
      file("/m/Song.wav", 0),
      file("/m/Song.mp3", 1),
      file("/m/Song.wav", 300),
      file("/m/Song.mp3", 301),
    ]);
    expect(runs).toHaveLength(2);
  });

  test("starts a new run on a path the run already holds", () => {
    const runs = group([
      file("/m/Song.wav", 0),
      file("/m/Song.mp3", 0.5),
      file("/m/SONG.WAV", 1),
    ]);
    expect(paths(runs)).toEqual([
      ["/m/Song.wav", "/m/Song.mp3"],
      ["/m/SONG.WAV"],
    ]);
  });

  test("matches stems case-insensitively", () => {
    const runs = group([file("/m/song.wav", 0), file("/m/SONG.mp3", 1)]);
    expect(runs).toHaveLength(1);
  });

  test("keeps folders apart, the folder's case included", () => {
    const runs = group([file("/m/Song.wav", 0), file("/M/Song.mp3", 0)]);
    expect(runs).toHaveLength(2);
  });

  test("groups across both separators of one path but not across folders", () => {
    const same = group([
      file("C:\\m\\Song.wav", 0),
      file("C:\\m\\Song.mp3", 1),
    ]);
    expect(same).toHaveLength(1);
    const apart = group([file("C:\\m\\Song.wav", 0), file("C:/m/Song.mp3", 1)]);
    expect(apart).toHaveLength(2);
  });

  test("keeps machines apart", () => {
    const runs = group([
      file("/m/Song.wav", 0, 1, "laptop"),
      file("/m/Song.mp3", 0, 1, "studio"),
    ]);
    expect(runs).toHaveLength(2);
  });

  test("treats files with no machine as one machine", () => {
    expect(
      group([file("/m/Song.wav", 0), file("/m/Song.mp3", 0)])
    ).toHaveLength(1);
  });

  test("drops a file with no extension", () => {
    expect(group([file("/m/Song", 0), file("/m/Song.wav", 0)])).toHaveLength(1);
  });

  test("orders a run by modified time, then path, whatever order it came in", () => {
    const runs = group([
      file("/m/Song.mp3", 1),
      file("/m/Song.flac", 0),
      file("/m/Song.aif", 0),
    ]);
    expect(runs[0]!.map((f) => f.path)).toEqual([
      "/m/Song.aif",
      "/m/Song.flac",
      "/m/Song.mp3",
    ]);
  });

  test("hands back the caller's own items", () => {
    type Row = { id: number; f: BounceFile };
    const rows: Row[] = [
      { id: 1, f: file("/m/Song.wav", 0) },
      { id: 2, f: file("/m/Song.mp3", 0) },
    ];
    const [run] = groupBounces(rows, 2 * MIN, (row) => row.f);
    expect(run!.map((row) => row.id)).toEqual([2, 1]);
  });
});

describe("preferredFirst", () => {
  const sorted = (
    order: Parameters<typeof preferredFirst>[0],
    files: BounceFile[]
  ) =>
    [...files]
      .sort(preferredFirst(order, (f: BounceFile) => f))
      .map((f) => f.path);

  test("largest puts the larger first", () => {
    expect(
      sorted("largest", [file("/m/a.mp3", 0, 10), file("/m/a.wav", 0, 500)])
    ).toEqual(["/m/a.wav", "/m/a.mp3"]);
  });

  test("largest breaks a size tie towards lossless", () => {
    expect(
      sorted("largest", [file("/m/a.mp3", 0, 10), file("/m/a.flac", 0, 10)])
    ).toEqual(["/m/a.flac", "/m/a.mp3"]);
  });

  test("largest breaks a tie on both by path", () => {
    expect(
      sorted("largest", [file("/m/b.wav", 0, 10), file("/m/a.wav", 0, 10)])
    ).toEqual(["/m/a.wav", "/m/b.wav"]);
  });

  test("smallest puts the smaller first, a tie going to lossless, then path", () => {
    expect(
      sorted("smallest", [
        file("/m/a.wav", 0, 500),
        file("/m/c.mp3", 0, 10),
        file("/m/b.mp3", 0, 10),
        file("/m/d.flac", 0, 10),
      ])
    ).toEqual(["/m/d.flac", "/m/b.mp3", "/m/c.mp3", "/m/a.wav"]);
  });

  test("lossless puts a lossless format first even when smaller", () => {
    expect(
      sorted("lossless", [file("/m/a.mp3", 0, 900), file("/m/a.wav", 0, 10)])
    ).toEqual(["/m/a.wav", "/m/a.mp3"]);
  });

  test("lossless breaks a tie towards the larger, then path", () => {
    expect(
      sorted("lossless", [
        file("/m/c.wav", 0, 10),
        file("/m/b.flac", 0, 10),
        file("/m/a.aif", 0, 5),
      ])
    ).toEqual(["/m/b.flac", "/m/c.wav", "/m/a.aif"]);
  });

  test("compares paths as plain strings, so an uppercase letter sorts first", () => {
    expect(
      sorted("largest", [file("/m/a.wav", 0, 10), file("/m/B.wav", 0, 10)])
    ).toEqual(["/m/B.wav", "/m/a.wav"]);
  });
});
