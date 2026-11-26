import { describe, expect, it } from "bun:test";
import type { PriorityScaleLevel } from "@workspace/api/api";
import {
  levelUsage,
  reordered,
  usageSentence,
  withDefault,
} from "./priority-scale";

const level = (
  id: number,
  name: string,
  isDefault = false,
  counts = { tracks: 0, collections: 0, sessions: 0 }
): PriorityScaleLevel => ({
  id,
  name,
  // eslint-disable-next-line no-restricted-syntax -- a level's colour is a hex value in the payload
  colour: "#525252",
  rank: id,
  isDefault,
  counts,
});

const scale = [level(1, "None", true), level(2, "Low"), level(3, "High")];

describe("reordered", () => {
  it("puts the levels in the order the ids give", () => {
    expect(reordered([3, 1, 2])(scale).map(({ name }) => name)).toEqual([
      "High",
      "None",
      "Low",
    ]);
  });

  it("keeps a level the ids do not name, after the ones they do", () => {
    const grown = [...scale, level(4, "Urgent")];
    expect(reordered([3, 1, 2])(grown).map(({ id }) => id)).toEqual([
      3, 1, 2, 4,
    ]);
  });
});

describe("withDefault", () => {
  it("flags the one level and clears the old default", () => {
    expect(
      withDefault(3)(scale).map(({ name, isDefault }) => [name, isDefault])
    ).toEqual([
      ["None", false],
      ["Low", false],
      ["High", true],
    ]);
  });
});

describe("levelUsage", () => {
  it("names only the kinds that hold the level, tracks first", () => {
    expect(levelUsage({ tracks: 3, collections: 0, sessions: 1 })).toEqual({
      total: 4,
      words: "3 tracks and 1 session",
    });
    expect(levelUsage({ tracks: 2, collections: 1, sessions: 5 }).words).toBe(
      "2 tracks, 1 collection and 5 sessions"
    );
  });

  it("is empty when nothing holds the level", () => {
    expect(levelUsage({ tracks: 0, collections: 0, sessions: 0 })).toEqual({
      total: 0,
      words: "",
    });
  });
});

describe("usageSentence", () => {
  it("says what uses the level, agreeing with one row or several", () => {
    expect(
      usageSentence(
        level(3, "High", false, { tracks: 1, collections: 0, sessions: 0 })
      )
    ).toBe("1 track uses “High”.");
    expect(
      usageSentence(
        level(3, "High", false, { tracks: 1, collections: 0, sessions: 1 })
      )
    ).toBe("1 track and 1 session use “High”.");
  });

  it("says so when nothing uses the level", () => {
    expect(usageSentence(level(2, "Low"))).toBe(
      "No tracks, collections or sessions use “Low”."
    );
  });
});
