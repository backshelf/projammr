import { describe, expect, it } from "bun:test";
import { STRIP_IDS } from "@/components/track-audio/strip-legend";
import { DEFAULT_VISUALS } from "./visuals";

describe("DEFAULT_VISUALS", () => {
  it("is the drawing as it has always been", () => {
    expect(DEFAULT_VISUALS).toEqual({
      loudnessReferenceLufs: -14,
      meterBallistics: 1,
      waveformDetail: 4,
      waveformHeight: "lg",
      strips: STRIP_IDS,
      lavaField: true,
      artBreathes: true,
    });
  });
});
