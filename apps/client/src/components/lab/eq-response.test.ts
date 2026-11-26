import { describe, expect, test } from "bun:test";
import {
  bandMagnitudeDb,
  eqResponseDb,
  type EqBandResponse,
} from "./eq-response";

const band = (patch: Partial<EqBandResponse>): EqBandResponse => ({
  kind: "off",
  hz: 1000,
  gainDb: 0,
  q: 0.9,
  ...patch,
});

describe("bandMagnitudeDb", () => {
  test("an off band contributes nothing at any frequency", () => {
    const off = band({ kind: "off", gainDb: 12 });
    expect(bandMagnitudeDb(off, 100)).toBe(0);
    expect(bandMagnitudeDb(off, 10000)).toBe(0);
  });

  test("a peaking band peaks at its own frequency", () => {
    const peak = band({ kind: "peaking", hz: 1000, gainDb: 6, q: 1 });
    const atCentre = bandMagnitudeDb(peak, 1000);
    const anOctaveBelow = bandMagnitudeDb(peak, 500);
    const anOctaveAbove = bandMagnitudeDb(peak, 2000);

    expect(atCentre).toBeCloseTo(6, 1);
    expect(atCentre).toBeGreaterThan(anOctaveBelow);
    expect(atCentre).toBeGreaterThan(anOctaveAbove);
  });

  test("a cut peaking band dips at its own frequency", () => {
    const cut = band({ kind: "peaking", hz: 1000, gainDb: -6, q: 1 });
    expect(bandMagnitudeDb(cut, 1000)).toBeCloseTo(-6, 1);
  });

  test("a low shelf lifts everything below its frequency and leaves the top alone", () => {
    const shelf = band({ kind: "lowShelf", hz: 200, gainDb: 6, q: 0.7 });
    expect(bandMagnitudeDb(shelf, 20)).toBeCloseTo(6, 0);
    expect(bandMagnitudeDb(shelf, 20000)).toBeCloseTo(0, 0);
  });

  test("a high shelf lifts everything above its frequency and leaves the bottom alone", () => {
    const shelf = band({ kind: "highShelf", hz: 5000, gainDb: 6, q: 0.7 });
    expect(bandMagnitudeDb(shelf, 20)).toBeCloseTo(0, 0);
    expect(bandMagnitudeDb(shelf, 20000)).toBeCloseTo(6, 0);
  });

  test("a low pass leaves the bottom alone and cuts well above its frequency", () => {
    const filter = band({ kind: "lowPass", hz: 1000, q: 0.707 });
    expect(bandMagnitudeDb(filter, 100)).toBeCloseTo(0, 0);
    expect(bandMagnitudeDb(filter, 8000)).toBeLessThan(-20);
  });

  test("a high pass leaves the top alone and cuts well below its frequency", () => {
    const filter = band({ kind: "highPass", hz: 1000, q: 0.707 });
    expect(bandMagnitudeDb(filter, 8000)).toBeCloseTo(0, 0);
    expect(bandMagnitudeDb(filter, 100)).toBeLessThan(-20);
  });
});

describe("eqResponseDb", () => {
  test("sums every band's contribution in decibels", () => {
    const bands = [
      band({ kind: "peaking", hz: 1000, gainDb: 3, q: 5 }),
      band({ kind: "peaking", hz: 1000, gainDb: 3, q: 5 }),
    ];
    const [response] = eqResponseDb(bands, [1000]);
    expect(response).toBeCloseTo(6, 1);
  });

  test("is flat with every band off", () => {
    const bands = Array.from({ length: 8 }, () => band({}));
    expect(eqResponseDb(bands, [20, 1000, 20000])).toEqual([0, 0, 0]);
  });
});
