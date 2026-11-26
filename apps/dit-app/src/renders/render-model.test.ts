import { describe, expect, test } from "bun:test";

import {
  extensionOf,
  factsOf,
  fileName,
  folderOf,
  isDecidable,
  mainFileIndex,
  namesOf,
  percentOf,
  reasonsOf,
  uploadsLine,
  visibleCards,
} from "./render-model";
import { card, pair } from "./test-cards";

const format = {
  timecode: (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`,
  bytes: (size: number) => `${Math.round(size / 1_048_576)} MB`,
  timeInSet: (seconds: number) => {
    const minutes = Math.round(seconds / 60);
    return minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  },
};

describe("paths", () => {
  test("name a file and its folder whichever separator the path uses", () => {
    expect(fileName("/Users/producer/Exports/v4.wav")).toBe("v4.wav");
    expect(fileName("C:\\Exports\\v4.wav")).toBe("v4.wav");
    expect(folderOf("/Users/producer/Exports/v4.wav")).toBe(
      "/Users/producer/Exports"
    );
    expect(folderOf("v4.wav")).toBe("");
    expect(extensionOf("v4.wav")).toBe(".wav");
    expect(extensionOf("README")).toBe("");
  });
});

describe("namesOf", () => {
  test("is the file's own name for one file", () => {
    expect(namesOf(card())).toBe("science123 v4.wav");
  });

  test("gives a pair's first name whole and the other as its extension", () => {
    expect(namesOf(pair())).toBe("science123 v4.wav and .mp3");
  });

  test("keeps the full name of a file with another stem", () => {
    const other = pair({
      files: [
        { path: "/x/Mix.wav", size: 10 },
        { path: "/x/Mix master.mp3", size: 5 },
      ],
    });
    expect(namesOf(other)).toBe("Mix.wav and Mix master.mp3");
  });

  test("joins three formats with commas", () => {
    const three = pair({
      files: [
        { path: "/x/Mix.wav", size: 10 },
        { path: "/x/Mix.mp3", size: 5 },
        { path: "/x/Mix.flac", size: 7 },
      ],
    });
    expect(namesOf(three)).toBe("Mix.wav, .mp3 and .flac");
  });
});

describe("the file a card plays", () => {
  test("is the one that is uploaded", () => {
    expect(mainFileIndex(pair({ uploadedFile: 1 }))).toBe(1);
  });

  test("is the largest while none is chosen", () => {
    expect(mainFileIndex(pair({ uploadedFile: null }))).toBe(0);
    const mp3First = pair({
      uploadedFile: null,
      files: [
        { path: "/x/Mix.mp3", size: 5 },
        { path: "/x/Mix.wav", size: 10 },
      ],
    });
    expect(mainFileIndex(mp3First)).toBe(1);
  });
});

describe("uploadsLine", () => {
  test("names the extension and size of the file a pair sends", () => {
    expect(uploadsLine(pair(), format.bytes)).toBe("uploads the .wav (48 MB)");
  });

  test("speaks in the past once it is added", () => {
    expect(uploadsLine(pair({ state: "added" }), format.bytes)).toBe(
      "uploaded the .wav (48 MB)"
    );
  });

  test("is nothing for one file, for a pair past the limit, or before a file is chosen", () => {
    expect(uploadsLine(card(), format.bytes)).toBeNull();
    expect(uploadsLine(pair({ state: "over-limit" }), format.bytes)).toBeNull();
    expect(uploadsLine(pair({ uploadedFile: null }), format.bytes)).toBeNull();
  });
});

describe("factsOf", () => {
  const unplaced = { bouncedAfterMs: null };

  test("gives the length and size of a single file", () => {
    expect(factsOf(card(unplaced), format)).toEqual(["3:42", "48 MB"]);
  });

  test("puts how long after the last save it was bounced beside the length", () => {
    expect(factsOf(card(), format)).toEqual([
      "3:42",
      "bounced 4 min after your last save",
      "48 MB",
    ]);
  });

  test("words a bounce made before the save, within a minute, and past an hour", () => {
    const line = (bouncedAfterMs: number): string | undefined =>
      factsOf(card({ bouncedAfterMs }), format)[1];
    expect(line(-4 * 60_000)).toBe("bounced 4 min before your last save");
    expect(line(20_000)).toBe(
      "bounced less than a minute after your last save"
    );
    expect(line(134 * 60_000)).toBe("bounced 2h 14m after your last save");
  });

  test("leaves a pair's size to the line that says which file goes up", () => {
    expect(factsOf(pair(unplaced), format)).toEqual([
      "3:42",
      "uploads the .wav (48 MB)",
    ]);
  });

  test("falls back to the length the player read, in seconds", () => {
    expect(
      factsOf(card({ ...unplaced, durationMs: null }), format, 90)
    ).toEqual(["1:30", "48 MB"]);
    expect(factsOf(card({ ...unplaced, durationMs: null }), format)).toEqual([
      "48 MB",
    ]);
  });

  test("counts the files of a batch", () => {
    expect(factsOf(card({ batch: 3 }), format)).toContain("3 files");
  });
});

describe("reasonsOf", () => {
  test("lists the three kinds in the spec's order and words", () => {
    expect(reasonsOf(card(), format)).toEqual([
      "named like the set",
      "in its folder",
      "4 min after your last save",
    ]);
  });

  test("lists only the kinds that held", () => {
    expect(
      reasonsOf(
        card({
          reasonKinds: { named: false, inFolder: true, nearSave: false },
        }),
        format
      )
    ).toEqual(["in its folder"]);
  });

  test("is nothing when none held, or when the distance is not known", () => {
    const none = { named: false, inFolder: false, nearSave: false };
    expect(reasonsOf(card({ reasonKinds: none }), format)).toEqual([]);
    expect(
      reasonsOf(
        card({
          bouncedAfterMs: null,
          reasonKinds: { named: false, inFolder: false, nearSave: true },
        }),
        format
      )
    ).toEqual([]);
  });
});

describe("percentOf", () => {
  test("is whole percent, never past 100, zero without a total", () => {
    expect(percentOf({ sent: 12, total: 48 })).toBe(25);
    expect(percentOf({ sent: 60, total: 48 })).toBe(100);
    expect(percentOf({ sent: 5, total: 0 })).toBe(0);
    expect(percentOf(null)).toBe(0);
  });
});

describe("which cards are shown", () => {
  test("drops a render the app is still holding back", () => {
    const shown = visibleCards([
      card({ id: 1, state: "waiting" }),
      card({ id: 2 }),
    ]);
    expect(shown.map((c) => c.id)).toEqual([2]);
  });

  test("decides on a proposed card and one over the limit, nothing else", () => {
    expect(isDecidable(card())).toBe(true);
    expect(isDecidable(card({ state: "over-limit" }))).toBe(true);
    for (const state of ["uploading", "queued-offline", "added"] as const) {
      expect(isDecidable(card({ state }))).toBe(false);
    }
  });
});
