import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beatsToMs,
  formatBarsBeats,
  formatCueLabel,
  formatSelectionSummary,
  formatTimecode,
  hasMatchingCue,
  msToBeats,
} from "./time.js";

describe("time helpers", () => {
  it("converts beats and milliseconds cleanly at a given tempo", () => {
    assert.equal(beatsToMs(4, 120), 2000);
    assert.equal(msToBeats(2000, 120), 4);
    assert.equal(beatsToMs(16, 128), 7500);
    assert.equal(msToBeats(7500, 128), 16);
    assert.equal(beatsToMs(-5, 120), 0);
    assert.equal(msToBeats(1000, 0), 0);
  });

  it("formats 0-based beats into 1-based Ableton Bar.Beat labels", () => {
    assert.equal(formatBarsBeats(0), "1.1");
    assert.equal(formatBarsBeats(4), "2.1");
    assert.equal(formatBarsBeats(16), "5.1");
    assert.equal(formatBarsBeats(18.5), "5.3.5");
  });

  it("formats timecodes and selection summaries", () => {
    assert.equal(formatTimecode(0), "0:00");
    assert.equal(formatTimecode(65_400), "1:05");
    assert.deepEqual(formatSelectionSummary(16, 32, 120), {
      barRange: "Bars 5.1–9.1",
      timeRange: "0:08–0:16",
      positionMs: 8000,
    });
  });

  it("formats and deduplicates cue point labels", () => {
    assert.equal(
      formatCueLabel("bring   snare up", "spence"),
      "[projammr] spence: bring snare up"
    );
    const long = formatCueLabel("x".repeat(120));
    assert.ok(long.length <= 80);
    assert.ok(long.endsWith("…"));

    const existing = [{ time: 16.01, name: "[projammr] spence: bring snare up" }];
    assert.equal(
      hasMatchingCue(existing, 16, "[projammr] spence: bring snare up"),
      true
    );
    assert.equal(
      hasMatchingCue(existing, 20, "[projammr] spence: bring snare up"),
      false
    );
  });
});
