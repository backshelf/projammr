import type { HeatmapDay } from "@workspace/api/api";
import { describe, expect, it } from "bun:test";
import { heatmapCells, heatmapDays, levelFor, streaks } from "./heatmap";

const day = (day: string, saves: number): HeatmapDay => ({
  day,
  saves,
  sessions: 0,
});

describe("levelFor", () => {
  it("returns 0 for no saves", () => {
    expect(levelFor(0)).toBe(0);
  });

  it("returns 1 for exactly one save", () => {
    expect(levelFor(1)).toBe(1);
  });

  it("returns 2 at the low and high end of its band", () => {
    expect(levelFor(2)).toBe(2);
    expect(levelFor(3)).toBe(2);
  });

  it("returns 3 at the low and high end of its band", () => {
    expect(levelFor(4)).toBe(3);
    expect(levelFor(6)).toBe(3);
  });

  it("returns 4 once saves exceed the level-3 band", () => {
    expect(levelFor(7)).toBe(4);
  });
});

describe("heatmapDays", () => {
  it("lists exactly the days in [from, to) with no Sunday padding", () => {
    // 2026-01-01 is a Thursday: heatmapCells would pad four cells before it.
    const cells = heatmapDays(
      [day("2026-01-02", 4)],
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 0, 4))
    );

    expect(cells).toEqual([
      { day: "2026-01-01", level: 0, saves: 0 },
      { day: "2026-01-02", level: 3, saves: 4 },
      { day: "2026-01-03", level: 0, saves: 0 },
    ]);
  });

  it("is empty for an empty range", () => {
    const at = new Date(Date.UTC(2026, 0, 1));
    expect(heatmapDays([], at, at)).toEqual([]);
  });
});

describe("heatmapCells", () => {
  it("left-pads to the Sunday starting the range across a year boundary", () => {
    // 2026-01-01 is a Thursday, so the grid needs 4 padding cells before it.
    const cells = heatmapCells(
      [day("2026-01-01", 1)],
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 0, 2))
    );

    expect(cells).toHaveLength(5);
    expect(cells.slice(0, 4)).toEqual([
      { day: null },
      { day: null },
      { day: null },
      { day: null },
    ]);
    expect(cells[4]).toEqual({ day: "2026-01-01", level: 1, saves: 1 });
  });

  it("left-pads to the Monday or Saturday a week starts on instead", () => {
    // 2026-01-01 is a Thursday: three days after Monday, five after Saturday.
    const from = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(Date.UTC(2026, 0, 2));
    const padding = (weekStart: number) =>
      heatmapCells([], from, to, weekStart).filter((c) => c.day == null).length;

    expect(padding(0)).toBe(4);
    expect(padding(1)).toBe(3);
    expect(padding(6)).toBe(5);
  });

  it("needs no padding when the range opens on the week's first day", () => {
    // 2026-11-02 is a Monday.
    const cells = heatmapCells(
      [],
      new Date(Date.UTC(2026, 10, 2)),
      new Date(Date.UTC(2026, 10, 9)),
      1
    );
    expect(cells[0]).toEqual({ day: "2026-11-02", level: 0, saves: 0 });
  });

  it("keeps a year-long window's days whichever day the week starts on", () => {
    const from = new Date(Date.UTC(2025, 8, 21));
    const to = new Date(Date.UTC(2026, 8, 27));
    const dated = (weekStart: number) =>
      heatmapCells([], from, to, weekStart).filter((c) => c.day != null);

    expect(dated(1)).toEqual(dated(0));
    expect(dated(0)).toHaveLength(53 * 7);
  });

  it("pads correctly across a DST change, since every day is a fixed 24h UTC step", () => {
    // US DST ended 2026-11-01; a local-time implementation could slide this
    // range by an hour and drop or duplicate a day.
    const cells = heatmapCells(
      [],
      new Date(Date.UTC(2026, 10, 1)),
      new Date(Date.UTC(2026, 10, 8))
    );

    // 2026-11-01 is a Sunday, so there is no padding, and the week holds
    // exactly 7 real days.
    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.day)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
  });

  it("marks a day with no saves as a real level-0 cell, not padding", () => {
    const cells = heatmapCells(
      [],
      new Date(Date.UTC(2026, 10, 1)),
      new Date(Date.UTC(2026, 10, 2))
    );

    expect(cells[0]).toEqual({
      day: "2026-11-01",
      level: 0,
      saves: 0,
    });
  });
});

describe("streaks", () => {
  it("returns a zero-length streak and a null since for an empty list", () => {
    expect(streaks([], new Date("2026-01-01"))).toEqual({
      longest: 0,
      since: null,
      current: 0,
    });
  });

  it("treats a gap in the dates as breaking the streak, not just an array gap", () => {
    const result = streaks(
      [
        day("2026-01-01", 1),
        day("2026-01-02", 1),
        day("2026-01-04", 1),
        day("2026-01-05", 1),
        day("2026-01-06", 1),
      ],
      new Date("2026-01-06")
    );

    expect(result.longest).toBe(3);
  });

  it("counts days since the most recent active day", () => {
    const result = streaks([day("2026-01-05", 2)], new Date("2026-01-08"));

    expect(result.since).toBe(3);
  });

  it("counts a save on the reference day as no days since", () => {
    const result = streaks([day("2026-01-08", 1)], new Date("2026-01-08"));

    expect(result.since).toBe(0);
  });

  it("counts the current streak through today", () => {
    const result = streaks(
      [day("2026-01-06", 1), day("2026-01-07", 1), day("2026-01-08", 1)],
      new Date("2026-01-08")
    );

    expect(result.current).toBe(3);
  });

  it("keeps the current streak alive through yesterday", () => {
    const result = streaks(
      [day("2026-01-06", 1), day("2026-01-07", 1)],
      new Date("2026-01-08")
    );

    expect(result.current).toBe(2);
  });

  it("zeroes the current streak once the last save is two or more days back", () => {
    const result = streaks([day("2026-01-05", 1)], new Date("2026-01-08"));

    expect(result.current).toBe(0);
  });

  it("counts a single save today as a one-day current streak", () => {
    const result = streaks([day("2026-01-08", 1)], new Date("2026-01-08"));

    expect(result.current).toBe(1);
  });

  it("returns zero current streak for no activity", () => {
    expect(streaks([], new Date("2026-01-08")).current).toBe(0);
  });
});
