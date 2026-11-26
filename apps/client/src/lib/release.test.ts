import { describe, expect, it } from "bun:test";
import { releasePhrase } from "./release";

describe("releasePhrase", () => {
  it("says 'Releases today' with a soon tone when the date is today", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-09", now)).toEqual({
      label: "Releases today",
      tone: "soon",
    });
  });

  it("says 'Releases tomorrow' with a soon tone", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-10", now)).toEqual({
      label: "Releases tomorrow",
      tone: "soon",
    });
  });

  it("counts 13 days as soon", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-22", now)).toEqual({
      label: "Releases in 13 days",
      tone: "soon",
    });
  });

  it("counts exactly 14 days as still soon", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-23", now)).toEqual({
      label: "Releases in 2 weeks",
      tone: "soon",
    });
  });

  it("counts 15 days as future", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-24", now)).toEqual({
      label: "Releases in 2 weeks",
      tone: "future",
    });
  });

  it("phrases six weeks out in weeks", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-10-21", now)).toEqual({
      label: "Releases in 6 weeks",
      tone: "future",
    });
  });

  it("phrases three months out in months", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-12-08", now)).toEqual({
      label: "Releases in 3 months",
      tone: "future",
    });
  });

  it("says 'Released ... ago' with a past tone for yesterday", () => {
    const now = new Date(2026, 8, 9);
    expect(releasePhrase("2026-09-08", now)).toEqual({
      label: "Released 1 day ago",
      tone: "past",
    });
  });

  it("counts whole local days across a DST boundary rather than 24-hour spans", () => {
    // Where this date pair straddles a clock change, the local day spans 23 or
    // 25 hours, and a naive ms-diff over 86400000 rounds to the wrong day count.
    const now = new Date(2026, 9, 31);
    expect(releasePhrase("2026-11-01", now)).toEqual({
      label: "Releases tomorrow",
      tone: "soon",
    });
  });
});
