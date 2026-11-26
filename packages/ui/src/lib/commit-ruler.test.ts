import { describe, expect, it } from "bun:test";
import type { LogCommit } from "@workspace/ui/lib/commit-log";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { timeRuler } from "@workspace/ui/lib/ruler-scale";
import {
  brushed,
  compareOf,
  compareOfBrush,
  lanesOf,
  navigable,
  placeOf,
  rulerSpan,
  rulerStates,
  step,
} from "./commit-ruler";

const T0 = Date.UTC(2026, 5, 1);
const HOUR = 3_600_000;
const iso = (hours: number) => new Date(T0 + hours * HOUR).toISOString();
const format = defaultFormatters("UTC");

const save = (
  id: number,
  hours: number,
  machineName: string | null = "studio"
) => ({
  id,
  fileUpdatedAt: iso(hours),
  machineName,
});

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

const describe_ = ({ kind, message }: { kind: string; message?: string }) =>
  message ?? kind;

const SAVES = [save(1, 0), save(2, 10), save(3, 20, "laptop"), save(4, 100)];
const COMMITS = [
  commit(12, 100, 4, { baselineSaveId: 3, kind: "checkpoint" }),
  commit(11, 20, 3, { baselineSaveId: 1, machineName: "laptop" }),
  commit(10, 0, 1),
];

const states = () =>
  rulerStates({ commits: COMMITS, saves: SAVES, describe: describe_ });

describe("the span and mark placement", () => {
  it("runs from the first state to now and places a mark at its share of the span", () => {
    const all = states();
    const [from, to] = rulerSpan(all, T0 + 200 * HOUR);
    expect(from).toBe(T0);
    expect(to).toBe(T0 + 200 * HOUR);

    const config = timeRuler(from, to, format);
    const at = (key: string) =>
      placeOf(
        all.find((s) => s.key === key)!,
        config
      );
    expect(at("save:1")).toBe(0);
    expect(at("save:2")).toBeCloseTo(5, 5);
    expect(at("commit:12")).toBeCloseTo(50, 5);
  });

  it("ends at the newest state when that is later than now, and stands a lone state in a day", () => {
    const [, to] = rulerSpan(states(), T0 + 1 * HOUR);
    expect(to).toBe(T0 + 100 * HOUR);
    expect(rulerSpan([], 5)).toEqual([5, 5]);
    const lone = timeRuler(T0, T0, format);
    expect(lone.max - lone.min).toBe(24 * HOUR);
  });

  it("numbers five stops across the span, in times for a day and dates for longer", () => {
    const week = timeRuler(T0, T0 + 7 * 24 * HOUR, format);
    expect(week.stops).toHaveLength(5);
    expect(week.stops[0]).toBe(T0);
    expect(week.stops.at(-1)).toBe(T0 + 7 * 24 * HOUR);
    expect(week.format(T0)).toBe("1 Jun 2026");
    const day = timeRuler(T0, T0 + 12 * HOUR, format);
    expect(day.format(T0)).toBe("00:00");
  });

  it("orders states by time, then by save, a save's tick before the commit that names it", () => {
    expect(states().map((s) => s.key)).toEqual([
      "save:1",
      "commit:10",
      "save:2",
      "save:3",
      "commit:11",
      "save:4",
      "commit:12",
    ]);
  });
});

describe("lanes", () => {
  it("gives each machine a lane, the busiest first, an unnamed machine last", () => {
    const withUnknown = rulerStates({
      commits: COMMITS,
      saves: [...SAVES, save(5, 5, null)],
      describe: describe_,
    });
    expect(lanesOf(withUnknown).map((lane) => lane.machine)).toEqual([
      "studio",
      "laptop",
      null,
    ]);
    expect(lanesOf(states())[1]!.states.map((s) => s.key)).toEqual([
      "save:3",
      "commit:11",
    ]);
  });

  it("types a checkpoint apart from a named commit and a save", () => {
    const kinds = Object.fromEntries(states().map((s) => [s.key, s.kind]));
    expect(kinds).toMatchObject({
      "commit:10": "commit",
      "commit:12": "checkpoint",
      "save:1": "save",
    });
  });
});

describe("the brush and the compare it makes", () => {
  const config = timeRuler(T0, T0 + 200 * HOUR, format);

  it("moves among the commits when there are any, and among the saves when there are none", () => {
    expect(navigable(states()).map((s) => s.key)).toEqual([
      "commit:10",
      "commit:11",
      "commit:12",
    ]);
    const only = rulerStates({
      commits: [],
      saves: SAVES,
      describe: describe_,
    });
    expect(navigable(only)).toHaveLength(4);
  });

  it("takes the marks inside a drag, whichever way it went", () => {
    // commit 11 sits at 10%, commit 12 at 50%
    expect(brushed(states(), config, 5, 60).map((s) => s.key)).toEqual([
      "commit:11",
      "commit:12",
    ]);
    expect(brushed(states(), config, 60, 5)).toHaveLength(2);
    expect(brushed(states(), config, 20, 40)).toEqual([]);
  });

  it("counts a mark whose edge a drag starts on, by the padding it is given", () => {
    // commit 11 sits at 10%
    expect(brushed(states(), config, 11, 60)).toHaveLength(1);
    expect(brushed(states(), config, 11, 60, 2)).toHaveLength(2);
  });

  it("maps a drag across two marks to ?from= the older save &to= the newer", () => {
    expect(compareOfBrush(states(), config, 0, 60)).toEqual({
      fromId: 1,
      toId: 4,
    });
    expect(compareOfBrush(states(), config, 60, 0)).toEqual({
      fromId: 1,
      toId: 4,
    });
  });

  it("maps a drag round one mark to that commit against its baseline, and an empty one to nothing", () => {
    expect(compareOfBrush(states(), config, 8, 12)).toEqual({
      fromId: 1,
      toId: 3,
    });
    expect(compareOfBrush(states(), config, 20, 40)).toBeNull();
  });

  it("orders a click and a shift-click by time whichever was first", () => {
    const [first, , , second] = states();
    expect(compareOf(first!, second!)).toEqual({ fromId: 1, toId: 3 });
    expect(compareOf(second!, first!)).toEqual({ fromId: 1, toId: 3 });
  });

  it("leaves the From to the page for a lone save with no known baseline", () => {
    const lone = states().find((s) => s.key === "save:2")!;
    expect(compareOf(lone, lone)).toEqual({ fromId: null, toId: 2 });
  });
});

describe("the keyboard walk", () => {
  const marks = () => navigable(states());

  it("steps to the neighbours and stays put at the ends", () => {
    expect(step(marks(), "commit:11", 1)!.key).toBe("commit:12");
    expect(step(marks(), "commit:11", -1)!.key).toBe("commit:10");
    expect(step(marks(), "commit:12", 1)!.key).toBe("commit:12");
    expect(step(marks(), "commit:10", -1)!.key).toBe("commit:10");
  });

  it("jumps to the ends and lands on the newest from nowhere", () => {
    expect(step(marks(), "commit:11", "first")!.key).toBe("commit:10");
    expect(step(marks(), "commit:11", "last")!.key).toBe("commit:12");
    expect(step(marks(), null, 1)!.key).toBe("commit:12");
    expect(step([], null, 1)).toBeNull();
  });
});
