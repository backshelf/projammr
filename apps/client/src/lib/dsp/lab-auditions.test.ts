import { describe, expect, test } from "bun:test";
import {
  LAB_AUDITIONS,
  labAudition,
  labAuditionOn,
  toggleLabAudition,
} from "./lab-auditions";
import { DEFAULT_LAB, type LabSettings } from "./lab-settings";

const withAuditions = (
  patch: Partial<LabSettings["auditions"]>
): LabSettings => ({
  ...DEFAULT_LAB,
  auditions: { ...DEFAULT_LAB.auditions, ...patch },
});

describe("LAB_AUDITIONS", () => {
  test("names every key exactly once", () => {
    const keys = LAB_AUDITIONS.map((audition) => audition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("labAuditionOn", () => {
  test("reads a stereo mode off the shared `stereo` field", () => {
    const settings = withAuditions({ stereo: "mono" });
    expect(labAuditionOn(settings, "mono")).toBe(true);
    expect(labAuditionOn(settings, "side")).toBe(false);
  });

  test("reads a device off the shared `device` field", () => {
    const settings = withAuditions({ device: "car" });
    expect(labAuditionOn(settings, "car")).toBe(true);
    expect(labAuditionOn(settings, "phone")).toBe(false);
  });

  test("reads a flag straight off its own field", () => {
    expect(labAuditionOn(DEFAULT_LAB, "dim")).toBe(false);
    expect(labAuditionOn(DEFAULT_LAB, "crossfeed")).toBe(false);
    expect(labAuditionOn(DEFAULT_LAB, "normalise")).toBe(false);
  });
});

describe("toggleLabAudition", () => {
  test("turns a stereo mode on, then back to plain stereo", () => {
    expect(toggleLabAudition(DEFAULT_LAB, "mono")).toEqual({
      stereo: "mono",
    });
    const engaged = withAuditions({ stereo: "mono" });
    expect(toggleLabAudition(engaged, "mono")).toEqual({ stereo: "stereo" });
  });

  test("switching to a different stereo mode replaces the current one", () => {
    const engaged = withAuditions({ stereo: "mono" });
    expect(toggleLabAudition(engaged, "side")).toEqual({ stereo: "side" });
  });

  test("turns a device on, then back to none", () => {
    expect(toggleLabAudition(DEFAULT_LAB, "car")).toEqual({ device: "car" });
    const engaged = withAuditions({ device: "car" });
    expect(toggleLabAudition(engaged, "car")).toEqual({ device: null });
  });

  test("flips a flag by name", () => {
    expect(toggleLabAudition(DEFAULT_LAB, "dim")).toEqual({ dim: true });
    expect(toggleLabAudition(withAuditions({ dim: true }), "dim")).toEqual({
      dim: false,
    });
  });
});

describe("labAudition", () => {
  test("throws for a key the table does not carry", () => {
    // @ts-expect-error - exercising the guard against an unknown key
    expect(() => labAudition("polarityRight")).toThrow(
      "Unknown Lab audition: polarityRight"
    );
  });
});
