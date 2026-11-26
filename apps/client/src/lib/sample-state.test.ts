import { describe, expect, it } from "bun:test";
import {
  offersSamplesZip,
  sampleDownloadHref,
  sampleState,
  samplesIncluded,
} from "./sample-state";

const project = { kind: "project", status: "present" } as const;

describe("sampleState", () => {
  it("reads each state", () => {
    expect(sampleState({ ...project, held: true }, true)).toBe("on the hub");
    expect(sampleState({ ...project, held: false }, true)).toBe("not pushed");
    expect(
      sampleState({ kind: "outside", status: "present", held: false }, true)
    ).toBe("outside the project folder");
    expect(
      sampleState({ kind: "library", status: "unknown", held: false }, true)
    ).toBe("outside the project folder");
  });
  it("lets Live's missing win, and says nothing for a set with no repo", () => {
    expect(
      sampleState({ kind: "project", status: "missing", held: false }, true)
    ).toBe("missing");
    expect(
      sampleState({ kind: "project", status: "missing", held: false }, false)
    ).toBe("missing");
    expect(sampleState({ ...project, held: false }, false)).toBeNull();
  });
});

describe("sample downloads", () => {
  it("builds the one-file href only with a repo and an object", () => {
    expect(sampleDownloadHref(4, "ab")).toBe("/api/samples/ab?repo=4");
    expect(sampleDownloadHref(null, "ab")).toBeNull();
    expect(sampleDownloadHref(4, null)).toBeNull();
  });
  it("counts the zip's samples and hides it at none held", () => {
    expect(samplesIncluded(12, 15)).toBe("12 of 15 samples included");
    expect(samplesIncluded(1, 1)).toBe("1 of 1 sample included");
    expect(samplesIncluded(1, 3)).toBe("1 of 3 samples included");
    expect(offersSamplesZip(0)).toBe(false);
    expect(offersSamplesZip(1)).toBe(true);
  });
});
