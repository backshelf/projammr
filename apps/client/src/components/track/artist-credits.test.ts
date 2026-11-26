import { describe, expect, it } from "bun:test";
import { artistOptions, creditArtist, keyedCredits } from "./artist-credits";

describe("keyedCredits", () => {
  it("keys an artist credited twice by its occurrence", () => {
    expect(
      keyedCredits(["Ada Vale", "Juno Park", "Ada Vale"]).map((c) => c.key)
    ).toEqual(["Ada Vale", "Juno Park", "Ada Vale#2"]);
  });
});

const vocabulary = ["Ada Vale", "Juno Park", "Marlow Reed"];

describe("artistOptions", () => {
  it("offers every uncredited artist for a blank draft, and nothing to create", () => {
    expect(artistOptions(vocabulary, ["Juno Park"], "  ")).toEqual({
      matches: ["Ada Vale", "Marlow Reed"],
      create: null,
    });
  });

  it("filters by the draft ignoring case", () => {
    expect(artistOptions(vocabulary, [], "re").matches).toEqual([
      "Marlow Reed",
    ]);
  });

  it("offers the draft as a new artist only when no existing name matches it", () => {
    expect(artistOptions(vocabulary, [], " Iris Hale ").create).toBe(
      "Iris Hale"
    );
    expect(artistOptions(vocabulary, [], "ada vale").create).toBeNull();
    expect(artistOptions([], ["Iris Hale"], "iris hale").create).toBeNull();
  });
});

describe("creditArtist", () => {
  it("appends the project's own spelling of a name that differs only in case", () => {
    expect(creditArtist(vocabulary, ["Juno Park"], "ada VALE")).toEqual([
      "Juno Park",
      "Ada Vale",
    ]);
  });

  it("appends a new name as typed, trimmed", () => {
    expect(creditArtist(vocabulary, [], "  Iris Hale ")).toEqual(["Iris Hale"]);
  });

  it("returns the same credits for a blank or already credited name", () => {
    const credited = ["Ada Vale"];
    expect(creditArtist(vocabulary, credited, " ")).toBe(credited);
    expect(creditArtist(vocabulary, credited, "ADA VALE")).toBe(credited);
  });
});
