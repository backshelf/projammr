import { describe, expect, it } from "bun:test";
import { DEFAULT_PROJECT_POLICY } from "./project-policy.js";
import { settleKeyMode, settleTempoOctave } from "./track-audios.js";

/** `settleTempoOctave` within the window a project that sets nothing uses. */
const settle = (
  detected: { bpm: number; beatOffsetMs: number },
  sessionTempo: string | null
) =>
  settleTempoOctave(
    detected,
    sessionTempo,
    DEFAULT_PROJECT_POLICY.audio.tempoKeyCorrectionPercent
  );

describe("settleTempoOctave", () => {
  it("settles within the project's own window, narrower or wider than the default", () => {
    const detected = { bpm: 67.6, beatOffsetMs: 100 };
    expect(settleTempoOctave(detected, "135", 0.1).bpm).toBe(67.6);

    const slow = { bpm: 64, beatOffsetMs: 100 };
    expect(settle(slow, "135").bpm).toBe(64);
    expect(settleTempoOctave(slow, "135", 6).bpm).toBe(128);
  });

  it("doubles a detected tempo within 4% of double the session tempo", () => {
    const settled = settle({ bpm: 67.6, beatOffsetMs: 100 }, "135");
    expect(settled.bpm).toBe(135.2);
  });

  it("leaves a detected tempo already within 4% of the session tempo unchanged", () => {
    const settled = settle({ bpm: 136, beatOffsetMs: 100 }, "135");
    expect(settled.bpm).toBe(136);
  });

  it("leaves a detected tempo outside the octave window of the session tempo unchanged", () => {
    const settled = settle({ bpm: 90, beatOffsetMs: 100 }, "135");
    expect(settled.bpm).toBe(90);
  });

  it("leaves the tempo unchanged without a session", () => {
    const settled = settle({ bpm: 67.6, beatOffsetMs: 100 }, null);
    expect(settled.bpm).toBe(67.6);
  });

  it("leaves the tempo unchanged when the session tempo doesn't parse", () => {
    const settled = settle({ bpm: 67.6, beatOffsetMs: 100 }, "andante");
    expect(settled.bpm).toBe(67.6);
  });

  it("leaves the tempo unchanged when the session tempo is zero or negative", () => {
    expect(settle({ bpm: 67.6, beatOffsetMs: 100 }, "0").bpm).toBe(67.6);
    expect(settle({ bpm: 67.6, beatOffsetMs: 100 }, "-135").bpm).toBe(67.6);
  });

  it("halves a detected tempo within 4% of half the session tempo", () => {
    const settled = settle({ bpm: 270, beatOffsetMs: 100 }, "135");
    expect(settled.bpm).toBe(135);
  });

  it("reduces the beat offset modulo the new period when doubling", () => {
    // 500 ms at 67.6 bpm is past the doubled tempo's ~444 ms period.
    const settled = settle({ bpm: 67.6, beatOffsetMs: 500 }, "135");
    const periodMs = 60000 / settled.bpm;
    expect(settled.beatOffsetMs).toBeGreaterThanOrEqual(0);
    expect(settled.beatOffsetMs).toBeLessThan(periodMs);
    expect(settled.beatOffsetMs).toBe(Math.floor(500 % periodMs));
  });

  it("keeps the doubled beat offset a whole millisecond", () => {
    // 70 → 140 bpm: a ~428.57 ms period leaves 700 ms at ~271.43 ms.
    const settled = settle({ bpm: 70, beatOffsetMs: 700 }, "140");
    expect(settled.bpm).toBe(140);
    expect(settled.beatOffsetMs).toBe(271);
  });

  it("keeps the beat offset as is when halving", () => {
    const settled = settle({ bpm: 270, beatOffsetMs: 123 }, "135");
    expect(settled.beatOffsetMs).toBe(123);
  });
});

describe("settleKeyMode", () => {
  it("stores the session's major key when the detected minor is its relative", () => {
    const settled = settleKeyMode("A minor", {
      rootNote: "C",
      scale: "Major",
    });
    expect(settled).toBe("C major");
  });

  it("leaves a detected major key unchanged when the session names a non-relative major", () => {
    const settled = settleKeyMode("D major", {
      rootNote: "C",
      scale: "Major",
    });
    expect(settled).toBe("D major");
  });

  it("is case-insensitive on the session's scale", () => {
    const settled = settleKeyMode("A minor", {
      rootNote: "C",
      scale: "major",
    });
    expect(settled).toBe("C major");
  });

  it("leaves the key unchanged when the session scale isn't major or minor", () => {
    const settled = settleKeyMode("A minor", {
      rootNote: "C",
      scale: "Dorian",
    });
    expect(settled).toBe("A minor");
  });

  it("leaves the key unchanged without a session key", () => {
    const settled = settleKeyMode("A minor", {
      rootNote: null,
      scale: null,
    });
    expect(settled).toBe("A minor");
  });

  it("stores the session's minor key when the detected major is its relative", () => {
    const settled = settleKeyMode("C major", {
      rootNote: "A",
      scale: "Minor",
    });
    expect(settled).toBe("A minor");
  });
});
