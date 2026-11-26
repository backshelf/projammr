import { describe, expect, it } from "bun:test";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import type { TrackAudioDiff } from "@workspace/api/api";
import {
  compareAnnouncement,
  compareControlsView,
  compareStripProps,
  hearSideLabel,
  loudnessMatchable,
  unmatchedCompareLine,
} from "./compare-view";

const b = {
  title: "Take",
  asset: { id: 2, name: "take-v4.wav", assetPath: "a/take-v4.wav" },
  ownerId: 1,
  ownerType: "track",
  trackAudio: { id: 12, version: 4, isPrimary: false, lufs: -10 },
} as MusicPlayerTrack;

const diff: TrackAudioDiff = {
  fromId: 11,
  toId: 12,
  aligned: true,
  offsetMs: 1500,
  change: [0, 0.5, 1],
  loudnessDelta: [],
  summary: {
    changedSeconds: 2,
    changedShare: 0.67,
    loudestChange: { startMs: 1000, endMs: 3000 },
  },
  analysisVersion: 2,
};

describe("compareControlsView", () => {
  it("shows the compared version and the percent while preparing", () => {
    expect(
      compareControlsView({ phase: "preparing", reason: null }, 4, 0.624)
    ).toEqual({
      kind: "preparing",
      label: "Preparing comparison",
      percent: 62,
      line: "Preparing comparison · v4 62%",
    });
  });

  it("offers the swap once ready", () => {
    expect(compareControlsView({ phase: "ready", reason: null }, 4, 1)).toEqual(
      { kind: "ready" }
    );
  });

  it("gives the reason when the comparison cannot run", () => {
    expect(
      compareControlsView(
        { phase: "unavailable", reason: "This format cannot be decoded here" },
        4,
        0.3
      )
    ).toEqual({
      kind: "unavailable",
      line: "This format cannot be decoded here",
    });
  });
});

describe("compareAnnouncement", () => {
  it("announces each phase once, never the percent", () => {
    expect(compareAnnouncement({ phase: "preparing", reason: null })).toBe(
      "Preparing comparison"
    );
    expect(compareAnnouncement({ phase: "ready", reason: null })).toBe(
      "Comparison ready"
    );
    expect(
      compareAnnouncement({ phase: "unavailable", reason: "No memory" })
    ).toBe("Comparison unavailable: No memory");
  });
});

describe("the A·B pill", () => {
  it("names each side with its version", () => {
    expect(hearSideLabel("a", 3)).toBe("Hear A, v3");
    expect(hearSideLabel("b", 4)).toBe("Hear B, v4");
  });

  it("matches loudness only when both versions are measured", () => {
    expect(loudnessMatchable(-12, -10)).toBe(true);
    expect(loudnessMatchable(-12, null)).toBe(false);
    expect(loudnessMatchable(undefined, -10)).toBe(false);
  });
});

describe("unmatchedCompareLine", () => {
  it("names the louder side and its margin when both are measured", () => {
    expect(unmatchedCompareLine(-12, -10)).toBe(
      "Levels not matched · B is +2.0 LU"
    );
    expect(unmatchedCompareLine(-10, -12)).toBe(
      "Levels not matched · A is +2.0 LU"
    );
  });

  it("gives just the bare label when either version has no LUFS", () => {
    expect(unmatchedCompareLine(-12, null)).toBe("Levels not matched");
    expect(unmatchedCompareLine(undefined, -10)).toBe("Levels not matched");
  });
});

describe("compareStripProps", () => {
  it("passes the pair's change map and summary, labelled with B's version", () => {
    expect(compareStripProps({ b, diff })).toEqual({
      label: "Change to v4",
      change: [0, 0.5, 1],
      summary: diff.summary,
    });
  });

  it("draws nothing without a diff or with an empty map", () => {
    expect(compareStripProps(null)).toBeNull();
    expect(compareStripProps({ b, diff: null })).toBeNull();
    expect(compareStripProps({ b, diff: { ...diff, change: [] } })).toBeNull();
  });
});
