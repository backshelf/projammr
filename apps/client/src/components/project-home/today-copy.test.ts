import { describe, expect, it } from "bun:test";

import { newWindowLabel, todaySentence } from "./today-copy";

const counts = { renders: 3, saves: 5, running: 2, quiet: 4, newHours: 24 };

describe("newWindowLabel", () => {
  it("reads 24 hours as since yesterday", () => {
    expect(newWindowLabel(24)).toBe("since yesterday");
  });

  it("reads a whole multiple of a day above 24 as days", () => {
    expect(newWindowLabel(48)).toBe("in the last 2 days");
  });

  it("reads anything else as hours", () => {
    expect(newWindowLabel(12)).toBe("in the last 12 hours");
    expect(newWindowLabel(36)).toBe("in the last 36 hours");
  });

  it("reads one hour in the singular", () => {
    expect(newWindowLabel(1)).toBe("in the last hour");
  });
});

describe("todaySentence", () => {
  it("reads every clause in order", () => {
    expect(todaySentence(counts)).toBe(
      "3 renders and 5 saves since yesterday · 2 jobs running · 4 tracks gone quiet"
    );
  });

  it("follows a non-24 window", () => {
    expect(todaySentence({ ...counts, newHours: 48 })).toBe(
      "3 renders and 5 saves in the last 2 days · 2 jobs running · 4 tracks gone quiet"
    );
  });

  it("drops the renders when there are none", () => {
    expect(todaySentence({ ...counts, renders: 0 })).toBe(
      "5 saves since yesterday · 2 jobs running · 4 tracks gone quiet"
    );
  });

  it("drops the saves when there are none", () => {
    expect(todaySentence({ ...counts, saves: 0 })).toBe(
      "3 renders since yesterday · 2 jobs running · 4 tracks gone quiet"
    );
  });

  it("drops the window clause when neither landed", () => {
    expect(todaySentence({ ...counts, renders: 0, saves: 0 })).toBe(
      "2 jobs running · 4 tracks gone quiet"
    );
  });

  it("drops the jobs clause at zero running", () => {
    expect(todaySentence({ ...counts, running: 0 })).toBe(
      "3 renders and 5 saves since yesterday · 4 tracks gone quiet"
    );
  });

  it("drops the quiet clause at zero", () => {
    expect(todaySentence({ ...counts, quiet: 0 })).toBe(
      "3 renders and 5 saves since yesterday · 2 jobs running"
    );
  });

  it("says nothing is new when every count is zero", () => {
    expect(
      todaySentence({
        renders: 0,
        saves: 0,
        running: 0,
        quiet: 0,
        newHours: 24,
      })
    ).toBe("nothing new since yesterday");
  });

  it("says nothing is new in the configured window", () => {
    expect(
      todaySentence({
        renders: 0,
        saves: 0,
        running: 0,
        quiet: 0,
        newHours: 12,
      })
    ).toBe("nothing new in the last 12 hours");
  });

  it("uses singulars at one", () => {
    expect(
      todaySentence({
        renders: 1,
        saves: 1,
        running: 1,
        quiet: 1,
        newHours: 24,
      })
    ).toBe(
      "1 render and 1 save since yesterday · 1 job running · 1 track gone quiet"
    );
  });
});
