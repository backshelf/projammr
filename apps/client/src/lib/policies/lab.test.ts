import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LAB,
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
} from "@/lib/dsp/lab-settings";
import { clampToRange, DEFAULT_LAB_POLICY, labSettingsFrom } from "./lab";

describe("DEFAULT_LAB_POLICY", () => {
  it("is the Lab as it has always behaved", () => {
    expect(DEFAULT_LAB_POLICY).toEqual({
      timePitchMode: "speed",
      speedRange: { min: SPEED_MIN, max: SPEED_MAX },
      pitchRange: { min: PITCH_MIN, max: PITCH_MAX },
      rememberAuditions: true,
      keepEngaged: false,
      releaseDelayMs: 2000,
      normaliseTargetLufs: -14,
      compressor: DEFAULT_LAB.rack.comp,
      reverb: DEFAULT_LAB.rack.reverb,
      eqPreset: DEFAULT_LAB.rack.eq,
      bounceFormat: "flac-24",
      bounceNameTemplate: "{title} — Lab bounce{details}",
    });
  });

  it("starts a fresh browser's Lab exactly where DEFAULT_LAB is", () => {
    expect(labSettingsFrom(DEFAULT_LAB_POLICY)).toEqual(DEFAULT_LAB);
  });
});

describe("labSettingsFrom", () => {
  it("starts the mode and the rack from the policy and leaves the rest at the defaults", () => {
    const compressor = { ...DEFAULT_LAB.rack.comp, on: true, ratio: 8 };
    const reverb = { ...DEFAULT_LAB.rack.reverb, on: true, wet: 0.4 };

    const settings = labSettingsFrom({
      ...DEFAULT_LAB_POLICY,
      timePitchMode: "linked",
      compressor,
      reverb,
    });

    expect(settings).toEqual({
      ...DEFAULT_LAB,
      mode: "linked",
      rack: { eq: DEFAULT_LAB.rack.eq, comp: compressor, reverb },
    });
  });
});

describe("clampToRange", () => {
  it("holds a value inside the range and leaves one inside it alone", () => {
    const range = { min: 0.75, max: 1.25 };

    expect(clampToRange(2, range)).toBe(1.25);
    expect(clampToRange(0.5, range)).toBe(0.75);
    expect(clampToRange(1.1, range)).toBe(1.1);
  });
});
