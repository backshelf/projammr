/**
 * The parametric EQ's frequency response, for {@link EqCurve} to draw over
 * the live spectrum. A visual estimate rather than the chain's own DSP: the
 * standard RBJ Audio EQ Cookbook biquad coefficients at a fixed sample rate,
 * which is all a curve drawn for the eye needs — the wasm chain is what
 * actually shapes the sound.
 */

import type { EqFilter } from "@/lib/dsp/lab-settings";

export type EqBandResponse = {
  kind: EqFilter;
  hz: number;
  gainDb: number;
  q: number;
};

/** Every curve is drawn as if the chain ran at this rate; the response of a
 *  parametric band barely moves across the rates the chain actually runs at. */
const VISUAL_SAMPLE_RATE = 48000;

type Coeffs = {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
};

const FLAT: Coeffs = { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };

function coeffsFor(band: EqBandResponse, sampleRate: number): Coeffs {
  const w0 = (2 * Math.PI * band.hz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * band.q);

  switch (band.kind) {
    case "off":
      return FLAT;
    case "peaking": {
      const A = Math.pow(10, band.gainDb / 40);
      return {
        b0: 1 + alpha * A,
        b1: -2 * cosW0,
        b2: 1 - alpha * A,
        a0: 1 + alpha / A,
        a1: -2 * cosW0,
        a2: 1 - alpha / A,
      };
    }
    case "lowShelf": {
      const A = Math.pow(10, band.gainDb / 40);
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha),
        b1: 2 * A * (A - 1 - (A + 1) * cosW0),
        b2: A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha),
        a0: A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha,
        a1: -2 * (A - 1 + (A + 1) * cosW0),
        a2: A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha,
      };
    }
    case "highShelf": {
      const A = Math.pow(10, band.gainDb / 40);
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha),
        b1: -2 * A * (A - 1 + (A + 1) * cosW0),
        b2: A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha),
        a0: A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha,
        a1: 2 * (A - 1 - (A + 1) * cosW0),
        a2: A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha,
      };
    }
    case "lowPass":
      return {
        b0: (1 - cosW0) / 2,
        b1: 1 - cosW0,
        b2: (1 - cosW0) / 2,
        a0: 1 + alpha,
        a1: -2 * cosW0,
        a2: 1 - alpha,
      };
    case "highPass":
      return {
        b0: (1 + cosW0) / 2,
        b1: -(1 + cosW0),
        b2: (1 + cosW0) / 2,
        a0: 1 + alpha,
        a1: -2 * cosW0,
        a2: 1 - alpha,
      };
  }
}

/** One band's contribution to the response at `hz`, in dB. */
export function bandMagnitudeDb(
  band: EqBandResponse,
  hz: number,
  sampleRate = VISUAL_SAMPLE_RATE
): number {
  if (band.kind === "off") return 0;
  const { b0, b1, b2, a0, a1, a2 } = coeffsFor(band, sampleRate);
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -b1 * sin1 - b2 * sin2;
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -a1 * sin1 - a2 * sin2;

  const numMag = Math.hypot(numRe, numIm);
  const denMag = Math.hypot(denRe, denIm);
  if (denMag === 0) return 0;
  return 20 * Math.log10(numMag / denMag);
}

/** The rack's combined response at every `hz`: each active band's decibels
 *  summed, the way biquads in series combine on a log scale. */
export function eqResponseDb(
  bands: readonly EqBandResponse[],
  hz: readonly number[]
): number[] {
  return hz.map((f) =>
    bands.reduce(
      (total, band) => total + bandMagnitudeDb(band, f, VISUAL_SAMPLE_RATE),
      0
    )
  );
}
