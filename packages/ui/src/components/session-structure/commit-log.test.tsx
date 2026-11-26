import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiffChip } from "@workspace/session-diff";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import {
  commitRowId,
  foldLog,
  type LogCommit,
  type LogSave,
} from "@workspace/ui/lib/commit-log";
import { CommitLog, SaveLog } from "./commit-log";

const format = defaultFormatters("UTC");
const asOf = new Date("2026-06-10T12:00:00Z");

const chip = (label: string): DiffChip => ({ kind: "tempo", label });

const save = (id: number, over: Partial<LogSave> = {}): LogSave => ({
  id,
  fileUpdatedAt: "2026-06-01T10:00:00.000Z",
  machineName: "studio",
  source: "dit",
  contentState: "stored",
  chips: [chip(`save ${id} chip`)],
  previousId: null,
  ...over,
});

const commit = (
  id: number,
  kind: LogCommit["kind"],
  saves: LogSave[],
  over: Partial<LogCommit> = {}
): LogCommit => ({
  id,
  hash: `${id}`.padEnd(64, "a"),
  shortId: `${id}`.padEnd(8, "a"),
  message: `commit ${id}`,
  kind,
  branch: "main",
  committedAt: "2026-06-08T12:00:00.000Z",
  machineName: "studio",
  authorName: "Alex",
  saveId: saves[0]?.id ?? 0,
  baselineSaveId: null,
  chips: [chip(`commit ${id} chip`)],
  chipsKnown: true,
  saves,
  samplesReferenced: 0,
  samplesHeld: 0,
  timeInSet: null,
  ...over,
});

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

const actions = () => <span>actions</span>;

describe("CommitLog", () => {
  const commits = [
    commit(4, "checkpoint", [save(14)]),
    commit(3, "user", [save(13)]),
    commit(2, "checkpoint", [save(12), save(11)]),
    commit(1, "user", [save(10)]),
  ];

  it("draws a named commit's message, author, machine, time since and chips, with its row id", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(out).toContain(`id="${commitRowId(3)}"`);
    expect(out).toContain("commit 3");
    expect(out).toContain("Alex");
    expect(out).toContain("2 days ago");
    expect(out).toContain("commit 3 chip");
  });

  it("folds a checkpoint under the next named commit and leaves the newest one quiet", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    // commit 3 folds checkpoint 2's saves; commit 4 is the newer quiet row; commit 1 has its own single save.
    expect(out).toContain("1 checkpoint · 3 saves");
    expect(out).not.toContain(">commit 2<");
    expect(out).toContain(`id="${commitRowId(4)}"`);
    expect(out).toContain("1 save");
  });

  it("reads the time in the set on a named row, summing its folded checkpoints", () => {
    const timed = [
      commit(4, "checkpoint", [save(14)], { timeInSet: 60 }),
      commit(3, "user", [save(13)], { timeInSet: 7_200 }),
      commit(2, "checkpoint", [save(12)], { timeInSet: 840 }),
      commit(1, "user", [save(10)], { timeInSet: null }),
    ];
    const out = html(
      <CommitLog
        entries={foldLog(timed, false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    // commit 3 stands for its own two hours and checkpoint 2's 14 minutes.
    expect(out).toContain("2h 14m");
    expect(out).toContain("1m");
  });

  it("shows no time for a row with none counted, never 0m", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(out).not.toContain("<1m");
    expect(out).not.toContain("0m");
  });

  it("marks the two saves being compared", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        format={format}
        asOf={asOf}
        marked={{ from: 10, to: 13 }}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(out).toContain(">From<");
    expect(out).toContain(">To<");
  });

  it("opens a fold with a native disclosure so its state is announced without script", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(out).toContain("<details");
    expect(out).toContain("<summary");
  });

  it("says nothing about changes it could not work out, and says so when there were none", () => {
    const unknown = html(
      <CommitLog
        entries={foldLog(
          [commit(5, "user", [save(15)], { chips: [], chipsKnown: false })],
          false
        )}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(unknown).not.toContain("Nothing the diff tracks changed");

    const none = html(
      <CommitLog
        entries={foldLog([commit(6, "user", [save(16)], { chips: [] })], false)}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(none).toContain("Nothing the diff tracks changed");
  });

  it("lists saves with no commit above the commits as their own fold", () => {
    const out = html(
      <CommitLog
        entries={foldLog(commits, false)}
        uncommitted={[save(20), save(21)]}
        format={format}
        asOf={asOf}
        renderCommitActions={actions}
        renderSaveActions={actions}
      />
    );
    expect(out).toContain("2 saves since the last commit");
  });
});

describe("SaveLog", () => {
  it("draws each save with its chips, or the plain line when the diff found none", () => {
    const out = html(
      <SaveLog
        saves={[save(1), save(2, { chips: [] })]}
        format={format}
        renderSaveActions={actions}
      />
    );
    expect(out).toContain("save 1 chip");
    expect(out).toContain("Saved, nothing tracked changed");
  });
});
