import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { cardFieldsFrom } from "./card-fields";
import type { PeekRow } from "../PeekPanel";

const row: PeekRow = {
  id: 1,
  title: "Track",
  fields: [
    { id: "bpm", label: "BPM", value: 128 },
    { id: "key", label: "Key", value: "" },
    { id: "isrc", label: "ISRC", value: null },
    { id: "collections", label: "Collections", value: "Singles" },
    { id: "id", label: "ID", value: 1 },
  ],
};

describe("cardFieldsFrom", () => {
  it("returns the named fields in the order they were asked for", () => {
    expect(
      cardFieldsFrom(row, ["collections", "bpm"]).map((f) => f.value)
    ).toEqual(["Singles", 128]);
  });

  it("skips fields with no value so the next one takes its place", () => {
    expect(cardFieldsFrom(row, ["key", "isrc", "bpm", "id"])).toEqual([
      { id: "bpm", label: "BPM", value: 128 },
      { id: "id", label: "ID", value: 1 },
    ]);
  });

  it("never returns more than two fields", () => {
    expect(cardFieldsFrom(row, ["bpm", "collections", "id"])).toHaveLength(2);
  });

  it("ignores ids the row has no field for", () => {
    expect(cardFieldsFrom(row, ["daw"])).toEqual([]);
  });

  it("matches on the id, not the label", () => {
    expect(cardFieldsFrom(row, ["BPM", "Collections"])).toEqual([]);
  });

  it("returns nothing without key fields", () => {
    expect(cardFieldsFrom(row, undefined)).toEqual([]);
    expect(cardFieldsFrom({ id: 1, title: "t" }, ["bpm"])).toEqual([]);
  });

  describe("two fields sharing an id", () => {
    const duplicated: PeekRow = {
      id: 7,
      title: "Track",
      fields: [
        { id: "bpm", label: "BPM", value: 128 },
        { id: "bpm", label: "Tempo", value: 90 },
      ],
    };
    let error: ReturnType<typeof spyOn<Console, "error">>;

    beforeEach(() => {
      error = spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      error.mockRestore();
    });

    it("keeps the first and logs the collision", () => {
      expect(cardFieldsFrom(duplicated, ["bpm"])).toEqual([
        { id: "bpm", label: "BPM", value: 128 },
      ]);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("does not log for a row whose ids are unique", () => {
      cardFieldsFrom(row, ["bpm"]);
      expect(error).not.toHaveBeenCalled();
    });
  });
});
