import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import type { LogCommit } from "@workspace/ui/lib/commit-log";
import type { Compare } from "@workspace/ui/lib/commit-ruler";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { CommitRuler } from "./commit-ruler";

afterEach(cleanup);

const T0 = Date.UTC(2026, 5, 1);
const HOUR = 3_600_000;
const iso = (hours: number) => new Date(T0 + hours * HOUR).toISOString();
const format = defaultFormatters("UTC");
const asOf = new Date(T0 + 200 * HOUR);

const commit = (
  id: number,
  hours: number,
  saveId: number,
  over: Partial<LogCommit> = {}
): LogCommit => ({
  id,
  hash: `${id}`.padEnd(64, "a"),
  shortId: `${id}`.padEnd(8, "a"),
  message: `commit ${id}`,
  kind: "user",
  branch: "main",
  committedAt: iso(hours),
  machineName: "studio",
  authorName: "Alex",
  saveId,
  baselineSaveId: null,
  chips: [],
  chipsKnown: true,
  saves: [],
  samplesReferenced: 0,
  samplesHeld: 0,
  timeInSet: null,
  ...over,
});

const COMMITS = [
  commit(12, 100, 4, { baselineSaveId: 3, kind: "checkpoint" }),
  commit(11, 20, 3, { baselineSaveId: 1, machineName: "laptop" }),
  commit(10, 0, 1),
];
const SAVES = [
  { id: 1, fileUpdatedAt: iso(0), machineName: "studio" },
  { id: 3, fileUpdatedAt: iso(20), machineName: "laptop" },
  { id: 4, fileUpdatedAt: iso(100), machineName: "studio" },
];

function setup(marked?: { from?: number | null; to?: number | null }) {
  const log = {
    revealed: [] as string[],
    compares: [] as Compare[],
    cleared: 0,
  };
  render(
    <CommitRuler
      commits={COMMITS}
      saves={SAVES}
      marked={marked}
      format={format}
      asOf={asOf}
      onReveal={(id) => log.revealed.push(id)}
      onCompare={(c) => log.compares.push(c)}
      onClear={() => (log.cleared += 1)}
    />
  );
  const mark = (key: string) =>
    document.querySelector(`[data-state="${key}"]`) as HTMLButtonElement;
  return { log, mark, toolbar: screen.getByRole("toolbar") };
}

describe("CommitRuler", () => {
  it("draws a lane per machine, a mark per commit with a lighter checkpoint and a tick per save", () => {
    const { mark } = setup();
    expect(screen.getByText("studio")).toBeTruthy();
    expect(screen.getByText("laptop")).toBeTruthy();
    expect(mark("commit:10").dataset.kind).toBe("commit");
    expect(mark("commit:12").dataset.kind).toBe("checkpoint");
    expect(mark("save:3").dataset.kind).toBe("save");
    // Non-interactive save ticks under commits render as decorative spans, not buttons.
    expect(mark("save:3").tagName).toBe("SPAN");
    expect(mark("save:3").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("button")).toHaveLength(COMMITS.length);
  });

  it("names a mark on hover with its message, author, machine and time", () => {
    const { mark } = setup();
    expect(mark("commit:11").title).toBe(
      `commit 11 · Alex · laptop · ${format.dateTime(T0 + 20 * HOUR)}`
    );
  });

  it("scrolls the log to a mark that is clicked", () => {
    const { mark, log } = setup();
    fireEvent.click(mark("commit:11"));
    expect(log.revealed).toEqual(["commit-11"]);
    expect(log.compares).toEqual([]);
  });

  it("compares the clicked mark with a shift-clicked one, older as From", () => {
    const { mark, log } = setup();
    fireEvent.click(mark("commit:12"));
    fireEvent.click(mark("commit:10"), { shiftKey: true });
    expect(log.compares).toEqual([{ fromId: 1, toId: 4 }]);
  });

  it("supports mobile tap-to-compare without requiring Shift", () => {
    const { mark, log } = setup();
    fireEvent.pointerDown(mark("commit:12"), { pointerType: "touch" });
    fireEvent.click(mark("commit:12"));
    expect(log.compares).toEqual([]);

    fireEvent.pointerDown(mark("commit:10"), { pointerType: "touch" });
    fireEvent.click(mark("commit:10"));
    expect(log.compares).toEqual([{ fromId: 1, toId: 4 }]);
  });

  it("walks between the commits with the arrows and sets From then To with Enter", () => {
    const { mark, log, toolbar } = setup();
    // One tab stop, on the newest mark.
    expect(mark("commit:12").tabIndex).toBe(0);
    expect(mark("commit:10").tabIndex).toBe(-1);

    mark("commit:12").focus();
    fireEvent.keyDown(toolbar, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(mark("commit:11"));
    fireEvent.keyDown(toolbar, { key: "Enter" });
    expect(log.compares).toEqual([]);

    fireEvent.keyDown(toolbar, { key: "Home" });
    expect(document.activeElement).toBe(mark("commit:10"));
    fireEvent.keyDown(toolbar, { key: "Enter" });
    expect(log.compares).toEqual([{ fromId: 1, toId: 3 }]);
  });

  it("clears with Escape", () => {
    const { log, toolbar, mark } = setup();
    mark("commit:12").focus();
    fireEvent.keyDown(toolbar, { key: "Escape" });
    expect(log.cleared).toBe(1);
  });

  it("marks the two saves of the open compare", () => {
    const { mark } = setup({ from: 1, to: 3 });
    expect(mark("commit:10").dataset.marked).toBe("from");
    expect(mark("commit:11").dataset.marked).toBe("to");
    expect(mark("commit:12").dataset.marked).toBeUndefined();
  });

  it("is one tab stop with a described, announced role for a screen reader", () => {
    setup();
    const toolbar = screen.getByRole("toolbar", { name: "Commit ruler" });
    expect(toolbar).toBeTruthy();
    const help = document.getElementById(
      toolbar.getAttribute("aria-describedby") ?? ""
    );
    expect(help?.textContent).toContain("Enter sets From, then To");
  });

  it("draws nothing for a session with no history", () => {
    const { container } = render(
      <CommitRuler
        commits={[]}
        saves={[]}
        asOf={asOf}
        onReveal={() => {}}
        onCompare={() => {}}
        onClear={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
