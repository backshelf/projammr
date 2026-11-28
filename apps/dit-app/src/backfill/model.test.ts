import { describe, expect, test } from "bun:test";
import {
  formattersFor,
  DEFAULT_FORMAT_PREFS,
} from "@workspace/ui/lib/formatters";

import {
  announcement,
  folderFigures,
  folderFacts,
  progressPercent,
  readout,
  stateKinds,
  stateLine,
  storageLine,
  targetForSession,
  targetForTrack,
  tickedPaths,
  toggled,
} from "./model";
import { folder, inState, mother } from "./test-support";

const format = formattersFor(DEFAULT_FORMAT_PREFS, "UTC");
const host = { host: "projammr.example" };
const GB = 1024 ** 3;

describe("ticks", () => {
  test("every found folder is ticked until it is unticked, and one already in dit never is", () => {
    const folders = [folder("a"), folder("b"), folder("c", { already: true })];

    expect(tickedPaths(folders, new Set())).toEqual([
      folders[0]!.path,
      folders[1]!.path,
    ]);
    expect(tickedPaths(folders, new Set([folders[0]!.path]))).toEqual([
      folders[1]!.path,
    ]);
  });

  test("toggling flips one path and leaves the set it was given alone", () => {
    const before = new Set(["a"]);

    expect([...toggled(before, "b")]).toEqual(["a", "b"]);
    expect([...toggled(before, "a")]).toEqual([]);
    expect([...before]).toEqual(["a"]);
  });
});

describe("what a folder says", () => {
  test("its facts leave the date off when it has no save", () => {
    expect(folderFacts(folder("a", { sets: 1, newest: null }), format)).toBe(
      "1 set · 2.3 GB"
    );
  });

  test("each state reads as the spec words it", () => {
    const said = (state: Parameters<typeof stateLine>[0]): string | null =>
      stateLine(state, host, format);

    expect(said({ state: "idle" })).toBeNull();
    expect(said({ state: "waiting" })).toBe("Waiting");
    expect(said({ state: "committing", done: 12, of: 41 })).toBe(
      "12 of 41 sets"
    );
    expect(said({ state: "uploading", sent: 3.1 * GB, of: 8.4 * GB })).toBe(
      "3.1 of 8.4 GB"
    );
    expect(said({ state: "waiting-for-hub" })).toBe(
      "Waiting for projammr.example"
    );
    expect(said({ state: "done" })).toBe("Done");
    expect(said({ state: "paused" })).toBe("Paused");
    expect(said({ state: "failed", reason: "It broke." })).toBe("It broke.");
  });

  test("an upload that has not reached the total's unit keeps its own", () => {
    expect(
      stateLine(
        { state: "uploading", sent: 850 * 1024 ** 2, of: 8.4 * GB },
        host,
        format
      )
    ).toBe("850 MB of 8.4 GB");
  });

  test("a run with no host to name still reads", () => {
    expect(
      stateLine({ state: "waiting-for-hub" }, { host: null }, format)
    ).toBe("Waiting for the hub");
  });

  test("progress is a share of the whole, nothing for a state with nothing to measure", () => {
    expect(progressPercent({ state: "committing", done: 1, of: 4 })).toBe(25);
    expect(progressPercent({ state: "uploading", sent: 0, of: 0 })).toBe(0);
    expect(progressPercent({ state: "done" })).toBe(100);
    expect(progressPercent({ state: "paused" })).toBeNull();
  });

  test("the figures show what is known and a dash for what is not yet", () => {
    const running = inState("a", { state: "committing", done: 2, of: 9 });
    expect(folderFigures(running, null, format)).toEqual({
      committed: "2 of 9",
      saves: "–",
      uploaded: "–",
    });

    const finished = inState("b", { state: "done" });
    expect(
      folderFigures(finished, { saves: 1200, sets: 9, bytes: 2.3 * GB }, format)
    ).toEqual({ committed: "9", saves: "1,200", uploaded: "2.3 GB" });
  });
});

describe("storage", () => {
  test("fits, over, and no cap each have their line", () => {
    expect(storageLine({ bytes: 8.4 * GB, remaining: 31 * GB }, format)).toBe(
      "Needs 8.4 GB of your 31 GB left."
    );
    expect(storageLine({ bytes: 14.2 * GB, remaining: 9.8 * GB }, format)).toBe(
      "These folders need 14.2 GB and you have 9.8 GB left. Go back (⌘[) to untick folders until they fit."
    );
    expect(storageLine({ bytes: 14.2 * GB, remaining: null }, format)).toBe(
      "Needs 14.2 GB. No storage limit on this instance."
    );
  });

  test("exactly the room left still fits", () => {
    expect(storageLine({ bytes: 9 * GB, remaining: 9 * GB }, format)).toBe(
      "Needs 9 GB of your 9 GB left."
    );
  });
});

describe("the readout", () => {
  test("names the month the history goes back to", () => {
    expect(
      readout(
        {
          firstSave: Date.UTC(2019, 2, 12, 12),
          saves: 3412,
          sets: 266,
          projects: 41,
        },
        format
      )
    ).toBe(
      "Your history goes back to March 2019: 3,412 saves across 266 sets in 41 projects."
    );
  });

  test("with no first save it still counts what came in", () => {
    expect(
      readout({ firstSave: null, saves: 2, sets: 1, projects: 1 }, format)
    ).toBe("2 saves across 1 set in 1 project.");
  });
});

describe("where a set goes", () => {
  const choices = {
    tracks: mother.chosen!.tracks,
    sessions: mother.chosen!.sessions,
    newTrack: "science",
  };
  const [matched, , , fresh] = mother.chosen!.sets;

  test("a track pick is that track, or the folder's new one", () => {
    expect(targetForTrack("12", choices)).toEqual({ kind: "track", id: 12 });
    expect(targetForTrack("new", choices)).toEqual({
      kind: "new-track",
      name: "science",
    });
  });

  test("a session pick is that session; New session keeps the matched session's track, else makes the folder's", () => {
    expect(targetForSession("813", fresh!, choices)).toEqual({
      kind: "session",
      id: 813,
    });
    expect(targetForSession("new", matched!, choices)).toEqual({
      kind: "track",
      id: 11,
    });
    expect(targetForSession("new", fresh!, choices)).toEqual({
      kind: "new-track",
      name: "science",
    });
  });
});

describe("the live region", () => {
  test("says a folder that finished or failed, and nothing for a count or a pause", () => {
    const before = stateKinds([
      inState("a", { state: "committing", done: 1, of: 3 }),
      inState("b", { state: "uploading", sent: 1, of: 2 }),
      inState("c", { state: "waiting" }),
    ]);

    expect(
      announcement(before, [
        inState("a", { state: "committing", done: 2, of: 3 }),
        inState("b", { state: "uploading", sent: 2, of: 2 }),
        inState("c", { state: "paused" }),
      ])
    ).toBeNull();
    expect(
      announcement(before, [
        inState("a", { state: "done" }),
        inState("b", { state: "uploading", sent: 1, of: 2 }),
        inState("c", { state: "waiting" }),
      ])
    ).toBe("a Project: done");
    expect(
      announcement(before, [
        inState("a", { state: "committing", done: 1, of: 3 }),
        inState("b", { state: "failed", reason: "Storage is full." }),
        inState("c", { state: "waiting" }),
      ])
    ).toBe("b Project: failed. Storage is full.");
  });

  test("a folder that was not there before is not news", () => {
    expect(
      announcement(new Map(), [inState("a", { state: "done" })])
    ).toBeNull();
  });
});
