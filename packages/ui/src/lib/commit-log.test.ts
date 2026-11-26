import type { SessionCommit, SessionSave } from "@workspace/api/api";
import { describe, expect, it } from "bun:test";
import {
  buildCommits,
  clearCompareHref,
  compareHref,
  ditCheckoutCommand,
  foldedTimeInSet,
  foldLabel,
  knownSaves,
  foldLog,
  uncommittedSaves,
  type LogCommit,
} from "./commit-log";

const T0 = Date.UTC(2026, 5, 1);
const MINUTE = 60_000;
const hash = (label: string) => label.padEnd(64, "0");

const meta = (tempo: string) =>
  ({
    tempo,
    timeSignature: "4/4",
    rootNote: null,
    scale: null,
    tracksCount: 1,
    scenesCount: 0,
    dawVersion: null,
    structure: null,
    samplePaths: null,
  }) as NonNullable<SessionSave["meta"]>;

let nextId = 1;
const save = (
  label: string,
  minute: number,
  tempo = "120",
  extra: Partial<SessionSave> = {}
): SessionSave =>
  ({
    id: nextId++,
    hash: hash(label),
    fileUpdatedAt: new Date(T0 + minute * MINUTE).toISOString(),
    machineName: "studio",
    source: "dit",
    contentState: "stored",
    branchId: 1,
    meta: meta(tempo),
    ...extra,
  }) as SessionSave;

const commit = (
  label: string,
  covered: SessionSave[],
  parent: SessionCommit | null,
  extra: Partial<SessionCommit> = {}
): SessionCommit =>
  ({
    id: nextId++,
    hash: hash(`c-${label}`),
    message: label,
    kind: "user",
    committedAt: covered.at(-1)!.fileUpdatedAt,
    machineName: "studio",
    authorId: "u1",
    authorName: "Alex",
    branch: "main",
    parentHash: parent?.hash ?? null,
    saveHash: covered.at(-1)!.hash,
    samplesReferenced: 0,
    samplesHeld: 0,
    timeInSet: null,
    saves: covered,
    ...extra,
  }) as SessionCommit;

/** first (named), cp1 and cp2 (checkpoints), second (named), cp3 (checkpoint, newest). */
function history() {
  const [s1, s2, s3, s4, s5, s6] = [
    save("s1", 0, "120"),
    save("s2", 5, "121"),
    save("s3", 10, "122"),
    save("s4", 15, "123"),
    save("s5", 20, "124"),
    save("s6", 25, "125"),
  ];
  const first = commit("first", [s1], null);
  const cp1 = commit("cp1", [s2], first, { kind: "checkpoint" });
  const cp2 = commit("cp2", [s3, s4], cp1, { kind: "checkpoint" });
  const second = commit("second", [s5], cp2);
  const cp3 = commit("cp3", [s6], second, { kind: "checkpoint" });
  return {
    saves: [s1, s2, s3, s4, s5, s6],
    // newest first, as the route answers
    commits: [cp3, second, cp2, cp1, first],
    s: { s1, s2, s3, s4, s5, s6 },
    c: { first, cp1, cp2, second, cp3 },
  };
}

describe("buildCommits", () => {
  it("words each commit against the previous commit's own save", () => {
    const { commits, c, s } = history();
    const built = buildCommits({ commits });
    const second = built.find((x) => x.id === c.second.id)!;

    expect(second.saveId).toBe(s.s5.id);
    expect(second.baselineSaveId).toBe(s.s4.id);
    expect(second.chips.map((chip) => chip.label)).toEqual(["tempo 123 → 124"]);

    const first = built.find((x) => x.id === c.first.id)!;
    expect(first.baselineSaveId).toBeNull();
    expect(first.chips.map((chip) => chip.label)).toEqual(["First save seen"]);
  });

  it("words each covered save against the one before it, newest first", () => {
    const { commits, c, s } = history();
    const cp2 = buildCommits({ commits }).find((x) => x.id === c.cp2.id)!;

    expect(cp2.saves.map((save) => save.id)).toEqual([s.s4.id, s.s3.id]);
    expect(cp2.saves[0]!.previousId).toBe(s.s3.id);
    expect(cp2.saves[0]!.chips.map((chip) => chip.label)).toEqual([
      "tempo 122 → 123",
    ]);
    expect(cp2.saves[1]!.chips.map((chip) => chip.label)).toEqual([
      "tempo 121 → 122",
    ]);
  });

  it("leaves the chips unknown, not wrong, when the baseline was never loaded", () => {
    const { commits, c } = history();
    const oldest = commits.slice(0, 2); // cp3 and second only
    const built = buildCommits({ commits: oldest });
    const second = built.find((x) => x.id === c.second.id)!;
    expect(second.chipsKnown).toBe(false);
    expect(second.chips).toEqual([]);
    expect(second.baselineSaveId).toBeNull();
  });

  it("finds a baseline among further saves of the session", () => {
    const { commits, c, saves } = history();
    const built = buildCommits({ commits: commits.slice(0, 2), saves });
    expect(built.find((x) => x.id === c.second.id)!.chipsKnown).toBe(true);
  });

  it("carries author, short id and sample counts through", () => {
    const { commits } = history();
    const [row] = buildCommits({ commits });
    expect(row).toMatchObject({
      authorName: "Alex",
      shortId: row!.hash.slice(0, 8),
      samplesReferenced: 0,
    });
  });

  it("carries each commit's time in the set, null where none was counted", () => {
    const { commits } = history();
    const timed = commits.map((commit, i) => ({
      ...commit,
      timeInSet: i === 0 ? 8_040 : null,
    }));
    const built = buildCommits({ commits: timed });
    expect(built.map((row) => row.timeInSet)).toEqual(
      timed.map((commit) => commit.timeInSet)
    );
  });

  it("leaves out a commit that covers no save", () => {
    const { commits, c } = history();
    const empty = { ...c.cp3, saves: [] } as SessionCommit;
    const built = buildCommits({ commits: [empty, ...commits.slice(1)] });
    expect(built.map((x) => x.id)).not.toContain(c.cp3.id);
    expect(built).toHaveLength(commits.length - 1);
  });
});

describe("knownSaves", () => {
  it("lists the saves list and the saves commits cover once each, newest first", () => {
    const { commits, saves, s } = history();
    // The list reaches only the last two saves; the commits bring the rest.
    const known = knownSaves([s.s5, s.s6], commits);
    expect(known.map((save) => save.id)).toEqual(
      [s.s6, s.s5, s.s4, s.s3, s.s2, s.s1].map((save) => save.id)
    );
    expect(knownSaves(saves, [])).toHaveLength(saves.length);
  });
});

describe("foldLog", () => {
  const commits = (): LogCommit[] =>
    buildCommits({ commits: history().commits });

  it("folds checkpoints under the next named commit and leaves the newest as quiet rows", () => {
    const entries = foldLog(commits(), false);
    expect(entries.map((entry) => [entry.kind, entry.commit.message])).toEqual([
      ["checkpoint", "cp3"],
      ["commit", "second"],
      ["commit", "first"],
    ]);
    const second = entries[1]!;
    expect(
      second.kind === "commit" && second.checkpoints.map((c) => c.message)
    ).toEqual(["cp2", "cp1"]);
  });

  it("puts every commit in line with checkpoints shown", () => {
    const entries = foldLog(commits(), true);
    expect(entries.map((entry) => entry.commit.message)).toEqual([
      "cp3",
      "second",
      "cp2",
      "cp1",
      "first",
    ]);
    expect(
      entries.every(
        (entry) => entry.kind === "checkpoint" || entry.commit.kind === "user"
      )
    ).toBe(true);
  });

  it("keeps a log of only checkpoints as quiet rows, newest first", () => {
    const only = commits().filter((commit) => commit.kind === "checkpoint");
    expect(
      foldLog(only, false).map((entry) => [entry.kind, entry.commit.message])
    ).toEqual([
      ["checkpoint", "cp3"],
      ["checkpoint", "cp2"],
      ["checkpoint", "cp1"],
    ]);
  });

  it("reads each fold as its counts", () => {
    const entries = foldLog(commits(), false);
    expect(entries.map(foldLabel)).toEqual([
      "1 save",
      "2 checkpoints · 4 saves",
      "1 save",
    ]);
  });
});

describe("foldedTimeInSet", () => {
  const timed = (times: (number | null)[]) => {
    const { commits } = history();
    return buildCommits({
      commits: commits.map((commit, i) => ({
        ...commit,
        timeInSet: times[i] ?? null,
      })),
    });
  };

  it("sums a named row's own time with its checkpoints'", () => {
    // newest first: cp3, second, cp2, cp1, first
    const entries = foldLog(timed([60, 600, 120, 30, 900]), false);
    expect(entries.map(foldedTimeInSet)).toEqual([60, 750, 900]);
  });

  it("is null when no commit of the row has a time", () => {
    const entries = foldLog(timed([]), false);
    expect(entries.map(foldedTimeInSet)).toEqual([null, null, null]);
  });

  it("counts only the commits that have one", () => {
    const entries = foldLog(timed([null, 600, null, 30, null]), false);
    expect(entries[1] && foldedTimeInSet(entries[1])).toBe(630);
  });
});

describe("compareHref and the checkout command", () => {
  it("compares a commit's save with its parent's, and a first one with nothing", () => {
    expect(compareHref("/project/1/session/2/history", 10, 14)).toBe(
      "/project/1/session/2/history?from=10&to=14"
    );
    expect(compareHref("/project/1/session/2/history", null, 14)).toBe(
      "/project/1/session/2/history?to=14"
    );
  });

  it("keeps the rest of the query and replaces an earlier comparison", () => {
    expect(
      compareHref(
        "/project/1/session/2/history?commits=500&checkpoints=1&from=3&to=4",
        10,
        14
      )
    ).toBe(
      "/project/1/session/2/history?commits=500&checkpoints=1&from=10&to=14"
    );
  });

  it("clears a comparison and leaves the rest of the query", () => {
    expect(
      clearCompareHref("/project/1/session/2/history?checkpoints=1&from=3&to=4")
    ).toBe("/project/1/session/2/history?checkpoints=1");
    expect(clearCompareHref("/project/1/session/2/history?to=4")).toBe(
      "/project/1/session/2/history"
    );
  });

  it("copies dit's checkout of the short id as a new branch", () => {
    expect(ditCheckoutCommand("a1b2c3d4e5f60000")).toBe(
      "dit checkout a1b2c3d4 -b restore-a1b2c3d4"
    );
  });
});

describe("uncommittedSaves", () => {
  it("lists the saves after the newest commit's own save, newest first", () => {
    const s1 = save("u1", 0, "120");
    const s2 = save("u2", 5, "121");
    const s3 = save("u3", 10, "122");
    const only = commit("only", [s1], null);
    const rows = uncommittedSaves({ commits: [only], saves: [s1, s2, s3] });
    expect(rows.map((row) => row.id)).toEqual([s3.id, s2.id]);
    expect(rows[1]!.previousId).toBe(s1.id);
  });

  it("lists every save when there is no commit", () => {
    const s1 = save("n1", 0);
    const s2 = save("n2", 5);
    expect(
      uncommittedSaves({ commits: [], saves: [s1, s2] }).map((row) => row.id)
    ).toEqual([s2.id, s1.id]);
  });
});
