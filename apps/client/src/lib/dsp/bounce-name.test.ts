import { describe, expect, it } from "bun:test";
import { DEFAULT_LAB_POLICY } from "@/lib/policies/lab";
import { DEFAULT_LAB } from "./lab-settings";
import { bounceName } from "./bounce-name";

const policy = DEFAULT_LAB_POLICY;

describe("bounceName", () => {
  it("is the plain title with no parenthetical at every default setting", () => {
    expect(bounceName("Idea", undefined, DEFAULT_LAB, policy)).toBe(
      "Idea — Lab bounce.flac"
    );
  });

  it("lists the version and the non-default settings in the Lab's own order", () => {
    const settings = {
      ...DEFAULT_LAB,
      speed: 0.85,
      pitch: 2,
      auditions: { ...DEFAULT_LAB.auditions, stereo: "mono" as const },
    };

    expect(bounceName("Idea", 3, settings, policy)).toBe(
      "Idea — Lab bounce (v3, 0.85×, +2 st, Mono).flac"
    );
  });

  it("lists an active rack block by name", () => {
    const settings = {
      ...DEFAULT_LAB,
      rack: {
        ...DEFAULT_LAB.rack,
        comp: { ...DEFAULT_LAB.rack.comp, on: true },
      },
    };

    expect(bounceName("Idea", undefined, settings, policy)).toBe(
      "Idea — Lab bounce (Comp).flac"
    );
  });

  it("omits the version when the track has none", () => {
    const settings = { ...DEFAULT_LAB, pitch: -1 };

    expect(bounceName("Idea", undefined, settings, policy)).toBe(
      "Idea — Lab bounce (-1 st).flac"
    );
  });

  it("names normalise by the policy's target", () => {
    const settings = {
      ...DEFAULT_LAB,
      auditions: { ...DEFAULT_LAB.auditions, normalise: true },
    };

    expect(bounceName("Idea", undefined, settings, policy)).toBe(
      "Idea — Lab bounce (−14 LUFS).flac"
    );
    expect(
      bounceName("Idea", undefined, settings, {
        ...policy,
        normaliseTargetLufs: -16,
      })
    ).toBe("Idea — Lab bounce (−16 LUFS).flac");
  });

  it("fills the policy's template, token by token", () => {
    const settings = { ...DEFAULT_LAB, speed: 0.85 };

    expect(
      bounceName("Idea", 3, settings, {
        ...policy,
        bounceNameTemplate: "{version} {title} [{settings}]",
      })
    ).toBe("v3 Idea [0.85×].flac");
  });
});
