import { beforeEach, describe, expect, test } from "bun:test";

import { ANALYSIS_LOUDNESS, AnalysisSession } from "./analysis";
import { loadDsp } from "./host/bun";
import {
  alignFeatures,
  ANALYSIS_CLIPPING,
  ANALYSIS_CURVES,
  ANALYSIS_FEATURES,
  ANALYSIS_KEY,
  ANALYSIS_OFFLINE,
  ANALYSIS_PITCH,
  ANALYSIS_SILENCE,
  diffFeatures,
  FeatureSet,
  type Features,
  MEL_BANDS,
  OfflineAnalyses,
  sectionGroupLetter,
  SPECTROGRAM_BANDS,
  SPECTROGRAM_CEIL_DB,
  SPECTROGRAM_COLUMN_MS,
  SPECTROGRAM_FLOOR_DB,
  SPECTROGRAM_HIGH_HZ,
  SPECTROGRAM_LOW_HZ,
} from "./offline";
import { DspError, type Dsp } from "./runtime";

const RATE = 48_000;

let dsp: Dsp;

beforeEach(async () => {
  dsp = await loadDsp();
});

/** Mono samples of `seconds` of a 220 Hz tone with a click every half second. */
function toneWithClicks(seconds: number): Float32Array {
  const signal = new Float32Array(RATE * seconds);
  for (let i = 0; i < signal.length; i++) {
    const click = i % (RATE / 2) < 20 ? 0.4 : 0;
    signal[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) + click;
  }
  return signal;
}

/**
 * Plucked notes at irregular times over a steady low drone: onsets with no
 * period to misalign on, and a spectrum steady from one second to the next.
 */
function plucks(seconds: number, seed: number): Float32Array {
  const signal = new Float32Array(RATE * seconds).map(
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 110 * i) / RATE)
  );
  let state = seed;
  let at = 0;
  while (at < signal.length) {
    const hz = 220 * 2 ** ((state % 12) / 12);
    for (let i = 0; i < RATE / 10 && at + i < signal.length; i++) {
      signal[at + i]! +=
        0.5 * Math.exp(-i / 1200) * Math.sin((2 * Math.PI * hz * i) / RATE);
    }
    state = (state * 1664525 + 1013904223) >>> 0;
    at += RATE / 8 + (state % (RATE / 3));
  }
  return signal;
}

function stereo(mono: Float32Array): Float32Array {
  const out = new Float32Array(mono.length * 2);
  mono.forEach((sample, i) => {
    out[i * 2] = sample;
    out[i * 2 + 1] = sample;
  });
  return out;
}

function analyse(
  mono: Float32Array,
  flags: number
): { session: AnalysisSession; offline: OfflineAnalyses } {
  const session = new AnalysisSession(dsp, RATE, 2, flags);
  const interleaved = stereo(mono);
  for (let at = 0; at < interleaved.length; at += RATE) {
    session.push(interleaved.subarray(at, at + RATE));
  }
  session.finish();
  return { session, offline: new OfflineAnalyses(session) };
}

function featuresOf(mono: Float32Array): Features {
  const { session, offline } = analyse(mono, ANALYSIS_FEATURES);
  const features = offline.features!;
  session.free();
  return features;
}

describe("OfflineAnalyses", () => {
  test("reads every analysis a session computed from one stream", () => {
    const signal = toneWithClicks(12);
    signal.fill(0, RATE * 11);
    const { session, offline } = analyse(
      signal,
      ANALYSIS_LOUDNESS | ANALYSIS_OFFLINE
    );

    expect(offline.tempo?.bpm).toBeCloseTo(120, 0);
    expect(offline.key?.musicalKey).toMatch(/^[A-G]♯? (major|minor)$/);
    expect(offline.sections[0]).toMatchObject({ startMs: 0, group: "A" });
    expect(offline.sections.at(-1)?.endMs).toBe(12_000);
    const spectrogram = offline.spectrogram;
    expect(spectrogram.columns).toBe(240);
    expect(spectrogram.bytes.length).toBe(240 * SPECTROGRAM_BANDS);
    expect(SPECTROGRAM_BANDS).toBe(160);
    expect(SPECTROGRAM_COLUMN_MS).toBe(50);
    expect(SPECTROGRAM_LOW_HZ).toBe(20);
    expect(SPECTROGRAM_HIGH_HZ).toBe(20_000);
    expect(SPECTROGRAM_FLOOR_DB).toBe(-80);
    expect(SPECTROGRAM_CEIL_DB).toBe(0);
    expect(offline.loudnessCurve).toHaveLength(12);
    expect(offline.loudnessCurve[5]).toBeGreaterThan(-20);
    expect(offline.correlationCurve).toEqual(Array(12).fill(1));
    expect(offline.clipping).toEqual([]);
    expect(offline.silence).toEqual({ leadMs: 0, tailMs: 1000 });
    expect(offline.pitchTrack).toHaveLength(240);
    expect(offline.pitchTrack[100]).toBeCloseTo(220, -0.5);
    expect(offline.pitchTrack[239]).toBe(0);
    const features = offline.features!;
    expect(features.onset.bytes).toHaveLength(1200);
    expect(features.mel.bytes).toHaveLength(12 * MEL_BANDS);
    expect(features.onset.max).toBeGreaterThan(features.onset.min);
    expect(session.loudness.lufs).toBeGreaterThan(-20);
    session.free();
  });

  test("a gated second reads null in the loudness curve, and a clipped bin is reported", () => {
    const signal = new Float32Array(RATE * 5);
    signal.set(toneWithClicks(1), RATE * 4);
    signal.fill(1, RATE * 4 + 2400 * 3 + 10, RATE * 4 + 2400 * 3 + 20);
    const { session, offline } = analyse(
      signal,
      ANALYSIS_CURVES | ANALYSIS_CLIPPING | ANALYSIS_SILENCE
    );

    expect(offline.loudnessCurve.slice(0, 3)).toEqual([null, null, null]);
    expect(offline.clipping).toContainEqual({
      binIndex: 83,
      samples: 10,
      over: true,
    });
    expect(offline.silence).toEqual({ leadMs: 4000, tailMs: 0 });
    expect(session.loudness.lufs).toBe(-Infinity);
    session.free();
  });

  test("reads null and empty for analyses the session was not asked for, and before finish", () => {
    const session = new AnalysisSession(dsp, RATE, 1, ANALYSIS_KEY);
    session.push(toneWithClicks(2));
    const offline = new OfflineAnalyses(session);
    expect(offline.key).toBeNull();
    session.finish();

    expect(offline.key?.musicalKey).toMatch(/^A (major|minor)$/);
    expect(offline.tempo).toBeNull();
    expect(offline.sections).toEqual([]);
    expect(offline.spectrogram.columns).toBe(0);
    expect(offline.loudnessCurve).toEqual([]);
    expect(offline.silence).toBeNull();
    expect(offline.pitchTrack).toEqual([]);
    expect(offline.features).toBeNull();
    session.free();
  });

  test("the pitch track reads 220 Hz for a 220 Hz sine", () => {
    const sine = new Float32Array(RATE * 2).map((_, i) =>
      Math.sin((2 * Math.PI * 220 * i) / RATE)
    );
    const { session, offline } = analyse(sine, ANALYSIS_PITCH);
    for (const hz of offline.pitchTrack.slice(1, -1)) {
      expect(Math.abs(hz - 220)).toBeLessThanOrEqual(1);
    }
    session.free();
  });
});

describe("comparing versions", () => {
  test("a version delayed by 2.5 s aligns at 2500 ms and reads unchanged", () => {
    const original = plucks(40, 7);
    const delayed = new Float32Array(original.length + RATE * 2.5);
    delayed.set(original, RATE * 2.5);
    const a = new FeatureSet(dsp, featuresOf(original), Array(40).fill(-14));
    const b = new FeatureSet(
      dsp,
      featuresOf(delayed),
      [null, null, -14].concat(Array(40).fill(-14))
    );
    const offset = alignFeatures(a, b);
    expect(offset).not.toBeNull();
    expect(Math.abs(offset! - 2500)).toBeLessThanOrEqual(20);

    const diff = diffFeatures(a, b, offset!);
    expect(diff.change).toHaveLength(40);
    expect(Math.max(...diff.change)).toBeLessThanOrEqual(0.02);
    expect(diff.loudnessDelta).toEqual(Array(40).fill(0));
    expect(diff.summary).toEqual({
      changedSeconds: 0,
      changedShare: 0,
      loudestChange: null,
    });
    // A half-second offset interpolates between seconds whose plucked notes
    // differ, so the chroma of this sparse material agrees to about 0.97.
    expect(diff.fingerprintSimilarity).toBeGreaterThan(0.95);
    expect(diffFeatures(a, a, 0).fingerprintSimilarity).toBe(1);
    a.free();
    b.free();
  });

  test("seconds the second version lacks read as wholly changed and summarise as the loudest change", () => {
    const original = plucks(20, 3);
    const a = new FeatureSet(dsp, featuresOf(original));
    const b = new FeatureSet(dsp, featuresOf(original.subarray(0, RATE * 10)));

    const diff = diffFeatures(a, b, 0);
    expect(diff.change.slice(12)).toEqual(Array(8).fill(1));
    expect(diff.loudnessDelta).toEqual([]);
    expect(diff.summary.loudestChange?.endMs).toBe(20_000);
    expect(diff.summary.changedShare).toBeGreaterThan(0.4);
    a.free();
    b.free();
  });

  test("unrelated versions do not align", () => {
    const a = new FeatureSet(dsp, featuresOf(plucks(60, 1)));
    const b = new FeatureSet(dsp, featuresOf(toneWithClicks(60)));
    expect(alignFeatures(a, b)).toBeNull();
    a.free();
    b.free();
  });

  test("a mel buffer that is not whole rows is refused, and the set is released", () => {
    const features = featuresOf(plucks(5, 2));
    const broken = {
      ...features,
      mel: { ...features.mel, bytes: features.mel.bytes.subarray(1) },
    };
    expect(() => new FeatureSet(dsp, broken)).toThrow(DspError);
  });

  test("rejects FeatureSets belonging to different Dsp instances", async () => {
    const otherDsp = await loadDsp();
    const features = featuresOf(plucks(5, 2));
    const a = new FeatureSet(dsp, features);
    const b = new FeatureSet(otherDsp, features);
    try {
      expect(() => alignFeatures(a, b)).toThrow(RangeError);
      expect(() => diffFeatures(a, b, 0)).toThrow(RangeError);
    } finally {
      a.free();
      b.free();
    }
  });
});

test("section groups letter A to Z, then AA onwards", () => {
  expect([0, 1, 25, 26, 27, 701, 702].map(sectionGroupLetter)).toEqual([
    "A",
    "B",
    "Z",
    "AA",
    "AB",
    "ZZ",
    "AAA",
  ]);
});
