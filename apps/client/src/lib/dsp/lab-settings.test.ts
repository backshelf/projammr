import { describe, expect, it } from "bun:test";
import { Block, Param } from "@workspace/dsp/params";
import {
  chainParams,
  changedParams,
  DEFAULT_LAB,
  elementRate,
  labWanted,
  paramRange,
  settingsNeedLab,
  withoutDangerousAuditions,
  type LabLoudness,
  type LabSettings,
} from "./lab-settings";

/** What `normalise` reads: `lufs` stored, brought to `targetLufs`. */
const loudness = (lufs: number | null, targetLufs = -14): LabLoudness => ({
  lufs,
  targetLufs,
});

const withAuditions = (patch: Partial<LabSettings["auditions"]>) => ({
  ...DEFAULT_LAB,
  auditions: { ...DEFAULT_LAB.auditions, ...patch },
});

const idle = { pinned: false, comparing: false };

describe("labWanted", () => {
  it("is not wanted at the defaults", () => {
    expect(labWanted({ settings: DEFAULT_LAB, ...idle })).toBe(false);
  });

  it("is wanted while pinned with every setting at its default", () => {
    expect(
      labWanted({ settings: DEFAULT_LAB, pinned: true, comparing: false })
    ).toBe(true);
  });

  it("is wanted for speed with pitch held, but not for linked speed the element plays", () => {
    const speed = { ...DEFAULT_LAB, speed: 0.8 };
    expect(labWanted({ settings: speed, ...idle })).toBe(true);
    expect(labWanted({ settings: { ...speed, mode: "linked" }, ...idle })).toBe(
      false
    );
  });

  it("is wanted for a pitch shift in the modes that apply one", () => {
    const pitch = { ...DEFAULT_LAB, pitch: 2 };
    expect(settingsNeedLab({ ...pitch, mode: "pitch" })).toBe(true);
    expect(settingsNeedLab({ ...pitch, mode: "independent" })).toBe(true);
    expect(settingsNeedLab({ ...pitch, mode: "speed" })).toBe(false);
  });

  it("is wanted for an audition or a rack block switched on", () => {
    expect(settingsNeedLab(withAuditions({ stereo: "mono" }))).toBe(true);
    expect(settingsNeedLab(withAuditions({ bands: ["low"] }))).toBe(true);
    expect(
      settingsNeedLab({
        ...DEFAULT_LAB,
        rack: {
          ...DEFAULT_LAB.rack,
          comp: { ...DEFAULT_LAB.rack.comp, on: true },
        },
      })
    ).toBe(true);
  });

  it("is wanted while a comparison runs, with every setting at its default", () => {
    expect(
      labWanted({ settings: DEFAULT_LAB, pinned: false, comparing: true })
    ).toBe(true);
  });
});

describe("withoutDangerousAuditions", () => {
  it("resets stereo, bands, device and dim and keeps the rest", () => {
    const settings = withAuditions({
      stereo: "side",
      bands: ["air"],
      device: "car",
      dim: true,
      crossfeed: true,
      normalise: true,
    });

    const safe = withoutDangerousAuditions({ ...settings, speed: 0.9 });

    expect(safe.auditions).toEqual({
      ...DEFAULT_LAB.auditions,
      crossfeed: true,
      normalise: true,
    });
    expect(safe.speed).toBe(0.9);
  });
});

describe("elementRate", () => {
  it("passes speed to the element only in linked mode", () => {
    expect(elementRate({ ...DEFAULT_LAB, mode: "linked", speed: 1.5 })).toBe(
      1.5
    );
    expect(elementRate({ ...DEFAULT_LAB, mode: "speed", speed: 1.5 })).toBe(1);
  });
});

describe("chainParams", () => {
  const value = (params: ReturnType<typeof chainParams>, param: number) =>
    params.values.find(([id]) => id === param)?.[1];

  it("offsets the gain to the target from the stored loudness when normalising", () => {
    const normalising = withAuditions({ normalise: true });

    expect(
      value(chainParams(normalising, loudness(-9)), Param.GainNormaliseDb)
    ).toBe(-5);
    expect(
      value(chainParams(normalising, loudness(-9, -16)), Param.GainNormaliseDb)
    ).toBe(-7);
    expect(
      value(chainParams(normalising, loudness(null)), Param.GainNormaliseDb)
    ).toBe(0);
  });

  it("bypasses the blocks nothing switched on", () => {
    const bypass = new Map(chainParams(DEFAULT_LAB, loudness(null)).bypass);
    expect(bypass.get(Block.Eq)).toBe(true);
    expect(bypass.get(Block.Device)).toBe(true);
    const on = new Map(
      chainParams(
        withAuditions({ device: "car", bands: ["mid"] }),
        loudness(null)
      ).bypass
    );
    expect(on.get(Block.Device)).toBe(false);
    expect(on.get(Block.BandSolo)).toBe(false);
  });

  it("keeps every range value inside its domain", () => {
    const params = chainParams(
      { ...DEFAULT_LAB, speed: 9, pitch: -40 },
      loudness(null)
    );
    expect(value(params, Param.TimeSpeed)).toBe(2);
    expect(value(params, Param.TimePitchSemitones)).toBe(-12);
  });
});

describe("changedParams", () => {
  it("sends only what moved", () => {
    const before = chainParams(DEFAULT_LAB, loudness(null));
    const after = chainParams({ ...DEFAULT_LAB, speed: 0.75 }, loudness(null));

    expect(changedParams(before, after)).toEqual({
      values: [[Param.TimeSpeed, 0.75]],
      bypass: [],
    });
  });

  it("resends the pre-delay after a preset change, which resets it", () => {
    const before = chainParams(DEFAULT_LAB, loudness(null));
    const after = chainParams(
      {
        ...DEFAULT_LAB,
        rack: {
          ...DEFAULT_LAB.rack,
          reverb: { ...DEFAULT_LAB.rack.reverb, preset: "hall" },
        },
      },
      loudness(null)
    );

    expect(changedParams(before, after).values.map(([id]) => id)).toEqual([
      Param.ReverbPreset,
      Param.ReverbPreDelayMs,
    ]);
  });
});

describe("paramRange", () => {
  it("reads a range parameter's bounds off the generated table", () => {
    expect(paramRange(Param.CompThresholdDb)).toEqual({ min: -60, max: 0 });
    expect(paramRange(Param.CompRatio)).toEqual({ min: 1, max: 20 });
  });

  it("throws for a parameter that is not a range", () => {
    expect(() => paramRange(Param.ReverbPreset)).toThrow(
      "ReverbPreset is not a range parameter"
    );
  });
});
