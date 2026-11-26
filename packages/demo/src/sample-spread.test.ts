import { describe, expect, it } from "bun:test";
import { spreadSamples } from "./sample-spread";

const paths = (count: number, dir = "/Users/someone/Samples"): string[] =>
  Array.from({ length: count }, (_, i) => `${dir}/s${i}.wav`);

describe("spreadSamples", () => {
  it("marks a library sample unknown and the rest present or missing, with at least two missing", () => {
    for (const count of [2, 5, 20, 60]) {
      const out = spreadSamples(paths(count));
      expect(
        out.every((s) =>
          s.kind === "library"
            ? s.status === "unknown"
            : s.status === "present" || s.status === "missing"
        )
      ).toBe(true);
      expect(
        out.filter((s) => s.status === "missing").length
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("marks every sample missing when the set has fewer than two", () => {
    expect(spreadSamples(paths(1)).map((s) => s.status)).toEqual(["missing"]);
    expect(spreadSamples([])).toEqual([]);
  });

  it("gives the same set on every run", () => {
    expect(spreadSamples(paths(40))).toEqual(spreadSamples(paths(40)));
  });

  it("makes most samples project, some library and a few outside", () => {
    const out = spreadSamples(paths(40));
    const count = (kind: string) => out.filter((s) => s.kind === kind).length;
    expect(count("outside")).toBeGreaterThan(0);
    expect(count("library")).toBeGreaterThan(0);
    expect(count("project")).toBeGreaterThan(
      count("library") + count("outside")
    );
  });

  it("assigns kinds by position whatever the paths say", () => {
    const kinds = (prefix: string) =>
      spreadSamples(paths(30, prefix)).map((s) => s.kind);
    expect(kinds("/Library/Packs")).toEqual(kinds("/Users/someone/Project"));
  });

  it("leaves paths alone", () => {
    const parsed = paths(9);
    expect(spreadSamples(parsed).map((s) => s.path)).toEqual(parsed);
  });
});
