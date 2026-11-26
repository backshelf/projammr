import { describe, expect, it } from "bun:test";
import { heatmapCells, streaks } from "@workspace/ui/lib/heatmap";
import { hasSaves, trailingWeekRange, yearHeatmapQuery } from "./heatmap-range";

describe("hasSaves", () => {
  it("is false for a grid with no days", () => {
    expect(hasSaves([])).toBe(false);
  });

  it("is false when every day counts zero saves", () => {
    expect(hasSaves([{ saves: 0 }, { saves: 0 }])).toBe(false);
  });

  it("is true once any day holds a save", () => {
    expect(hasSaves([{ saves: 0 }, { saves: 3 }])).toBe(true);
  });
});

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

describe("trailingWeekRange", () => {
  describe.each([
    {
      zone: "Australia/Sydney (east of UTC)",
      tz: "Australia/Sydney",
      // 08:00 local on the 25th is still the 24th in UTC.
      asOf: Date.UTC(2026, 8, 24, 22, 0),
      today: "2026-09-25",
      save: Date.UTC(2026, 8, 24, 22, 0),
      windowStart: Date.UTC(2026, 8, 25 - 7, 14, 0),
      windowEnd: Date.UTC(2026, 8, 25, 14, 0),
    },
    {
      zone: "America/Los_Angeles (west of UTC)",
      tz: "America/Los_Angeles",
      // 21:00 local on the 24th is already the 25th in UTC.
      asOf: Date.UTC(2026, 8, 25, 4, 0),
      today: "2026-09-24",
      save: Date.UTC(2026, 8, 25, 3, 0),
      windowStart: Date.UTC(2026, 8, 24 - 6, 7, 0),
      windowEnd: Date.UTC(2026, 8, 25, 7, 0),
    },
  ])("in $zone", ({ tz, asOf, today, save, windowStart, windowEnd }) => {
    const range = trailingWeekRange(1, new Date(asOf), tz);

    it("ends the grid on the viewer's local date", () => {
      const cells = heatmapCells([], range.from, range.to);
      const last = cells[cells.length - 1];

      expect(last && "day" in last ? last.day : null).toBe(today);
      expect(dayKey(range.today)).toBe(today);
      expect(dayKey(range.to)).toBe(
        dayKey(new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 3600 * 1000))
      );
    });

    it("queries from local midnight at the start to local midnight after the last day", () => {
      expect(range.query).toEqual({
        from: windowStart,
        to: windowEnd,
        tz,
      });
    });

    it("fetches a save made this morning and counts it as today's", () => {
      expect(save).toBeGreaterThanOrEqual(range.query.from);
      expect(save).toBeLessThan(range.query.to);

      const days = [{ day: today, saves: 1, sessions: 1 }];
      const cells = heatmapCells(days, range.from, range.to);
      const last = cells[cells.length - 1];

      expect(last).toMatchObject({ day: today, saves: 1 });
      expect(streaks(days, range.today).since).toBe(0);
    });
  });

  it("cuts the window on local midnights across a daylight-saving change", () => {
    // Los Angeles falls back on 2026-11-01: the window is 14 days of which
    // one is 25 hours long.
    const { from, to, query } = trailingWeekRange(
      2,
      new Date(Date.UTC(2026, 10, 10, 20, 0)),
      "America/Los_Angeles"
    );

    expect(dayKey(from)).toBe("2026-10-28");
    expect(dayKey(to)).toBe("2026-11-11");
    expect(query.from).toBe(Date.UTC(2026, 9, 28, 7, 0));
    expect(query.to).toBe(Date.UTC(2026, 10, 11, 8, 0));
  });

  it("reads UTC as the identity between the grid's days and the query's instants", () => {
    const { from, to, query } = trailingWeekRange(
      1,
      new Date(Date.UTC(2026, 8, 14, 18, 30)),
      "UTC"
    );

    expect(query).toEqual({
      from: from.getTime(),
      to: to.getTime(),
      tz: "UTC",
    });
  });
});

describe("yearHeatmapQuery", () => {
  it("asks for the window the year grid draws in the viewer's zone", () => {
    const asOf = new Date(Date.UTC(2026, 8, 14, 18, 30));

    expect(yearHeatmapQuery("UTC", asOf)).toEqual(
      trailingWeekRange(53, asOf, "UTC").query
    );
    const tokyo = yearHeatmapQuery("Asia/Tokyo", asOf);
    expect(tokyo).toEqual(trailingWeekRange(53, asOf, "Asia/Tokyo").query);
    expect(tokyo.tz).toBe("Asia/Tokyo");
  });
});
