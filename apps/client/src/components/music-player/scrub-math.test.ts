import { describe, expect, it } from "bun:test";
import {
  clampPosition,
  keyboardSeek,
  progressReadout,
} from "@/components/music-player/scrub-math";
import { DEFAULT_PLAYBACK, seekStep } from "@/lib/policies/playback";

const DURATION = 200;

describe("clampPosition", () => {
  it("maps a ratio across the track to seconds", () => {
    expect(clampPosition(0.25, DURATION)).toBe(50);
  });

  it("holds a drag past the start at zero", () => {
    expect(clampPosition(-0.4, DURATION)).toBe(0);
  });

  it("holds a drag past the end at the duration", () => {
    expect(clampPosition(1.8, DURATION)).toBe(DURATION);
  });

  it("stays at zero while the duration is unknown", () => {
    expect(clampPosition(0.5, 0)).toBe(0);
  });
});

describe("keyboardSeek", () => {
  const small = seekStep(DEFAULT_PLAYBACK, false);
  const large = seekStep(DEFAULT_PLAYBACK, true);

  it("steps the policy's small step either way, five seconds by default", () => {
    expect(keyboardSeek("ArrowRight", 100, DURATION, small)).toBe(105);
    expect(keyboardSeek("ArrowLeft", 100, DURATION, small)).toBe(95);
  });

  it("steps the policy's large step when shifted, thirty seconds by default", () => {
    expect(keyboardSeek("ArrowRight", 100, DURATION, large)).toBe(130);
    expect(keyboardSeek("ArrowLeft", 100, DURATION, large)).toBe(70);
  });

  it("steps whatever the policy sets", () => {
    const step = seekStep(
      { ...DEFAULT_PLAYBACK, seekSmallSeconds: 2, seekLargeSeconds: 60 },
      true
    );

    expect(keyboardSeek("ArrowLeft", 100, DURATION, step)).toBe(40);
  });

  it("jumps to the ends", () => {
    expect(keyboardSeek("Home", 100, DURATION, small)).toBe(0);
    expect(keyboardSeek("End", 100, DURATION, small)).toBe(DURATION);
  });

  it("clamps a step that would run off either end", () => {
    expect(keyboardSeek("ArrowLeft", 2, DURATION, small)).toBe(0);
    expect(keyboardSeek("ArrowRight", DURATION - 2, DURATION, large)).toBe(
      DURATION
    );
  });

  it("leaves keys it does not answer to the page", () => {
    expect(keyboardSeek("Tab", 100, DURATION, small)).toBeNull();
    expect(keyboardSeek("ArrowUp", 100, DURATION, small)).toBeNull();
  });
});

describe("progressReadout", () => {
  const read = (seconds: number, duration: number) =>
    progressReadout(seconds, duration, "elapsed-remaining");

  it("reads a position inside the track as elapsed and remaining", () => {
    expect(read(50, DURATION)).toEqual({
      position: 50,
      fraction: 0.25,
      lead: "0:50",
      trail: "-2:30",
      valueText: "0:50 of 3:20",
    });
  });

  it("shows the placeholder while the duration is unknown", () => {
    expect(read(12, 0)).toEqual({
      position: 12,
      fraction: 0,
      lead: "0:12",
      trail: "--:--",
      valueText: "0:12",
    });
  });

  it("holds a position past the end at the duration", () => {
    expect(read(DURATION + 0.4, DURATION)).toEqual({
      position: DURATION,
      fraction: 1,
      lead: "3:20",
      trail: "-0:00",
      valueText: "3:20 of 3:20",
    });
  });

  it("starts at zero", () => {
    const readout = read(0, DURATION);
    expect(readout.fraction).toBe(0);
    expect(readout.lead).toBe("0:00");
    expect(readout.trail).toBe("-3:20");
  });

  it("puts the total after the bar for elapsed and total", () => {
    const readout = progressReadout(50, DURATION, "elapsed-total");
    expect([readout.lead, readout.trail]).toEqual(["0:50", "3:20"]);
    expect(readout.valueText).toBe("0:50 of 3:20");
  });

  it("leads with the time left for remaining", () => {
    const readout = progressReadout(50, DURATION, "remaining");
    expect([readout.lead, readout.trail]).toEqual(["-2:30", "3:20"]);
  });

  it("shows the placeholder for any time the unknown duration decides", () => {
    const total = progressReadout(12, 0, "elapsed-total");
    expect([total.lead, total.trail]).toEqual(["0:12", "--:--"]);
    const left = progressReadout(12, 0, "remaining");
    expect([left.lead, left.trail]).toEqual(["--:--", "--:--"]);
  });
});
