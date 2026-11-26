import { describe, expect, it } from "bun:test";
import { uniqueEntryName } from "./archive.js";

describe("uniqueEntryName", () => {
  it("deduplicates repeated filenames as Track.als, Track (2).als, Track (3).als", () => {
    const used = new Set<string>();
    const names = ["Track.als", "Track.als", "Track.als", "Track.als"].map(
      (fileName) => {
        const name = uniqueEntryName(fileName, used);
        used.add(name);
        return name;
      }
    );

    expect(names).toEqual([
      "Track.als",
      "Track (2).als",
      "Track (3).als",
      "Track (4).als",
    ]);
  });

  it("handles extensionless names and pre-existing numbered collisions", () => {
    const used = new Set(["Demo", "Demo (2)", "Beat.als", "Beat (2).als"]);
    expect(uniqueEntryName("Demo", used)).toBe("Demo (3)");
    expect(uniqueEntryName("Beat.als", used)).toBe("Beat (3).als");
  });

  it("sanitises path separators and control characters", () => {
    const used = new Set<string>();
    expect(uniqueEntryName("dir/sub\\set\x00.als", used)).toBe(
      "dir_sub_set_.als"
    );
    expect(uniqueEntryName("..", used)).toBe("set");
  });
});
