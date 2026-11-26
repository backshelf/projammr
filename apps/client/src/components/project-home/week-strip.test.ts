import { weekStripCaption } from "@/components/project-home/week-strip";
import { describe, expect, it } from "bun:test";

const today = new Date(Date.UTC(2026, 8, 26));

const dayAgo = (n: number) =>
  new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const saves = (...ago: number[]) =>
  ago.map((n) => ({ day: dayAgo(n), saves: 2, sessions: 1 }));

describe("weekStripCaption", () => {
  it("says there were no saves when no day has one", () => {
    expect(weekStripCaption([], today)).toBe("no saves in the last 7 days");
  });

  it("ignores days listed with no saves", () => {
    expect(
      weekStripCaption([{ day: dayAgo(0), saves: 0, sessions: 0 }], today)
    ).toBe("no saves in the last 7 days");
  });

  it("counts four active days", () => {
    expect(weekStripCaption(saves(0, 2, 4, 5), today)).toBe(
      "saved 4 of the last 7 days · last save today"
    );
  });

  it("counts a full week", () => {
    expect(weekStripCaption(saves(0, 1, 2, 3, 4, 5, 6), today)).toBe(
      "saved 7 of the last 7 days · last save today"
    );
  });

  it("names a save yesterday", () => {
    expect(weekStripCaption(saves(1, 3), today)).toBe(
      "saved 2 of the last 7 days · last save yesterday"
    );
  });

  it("names a save three days ago", () => {
    expect(weekStripCaption(saves(3, 5), today)).toBe(
      "saved 2 of the last 7 days · last save 3 days ago"
    );
  });
});
