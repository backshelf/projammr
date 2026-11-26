import { describe, expect, it } from "bun:test";
import {
  bandLevels,
  blobColour,
  fadeBlobs,
  restingBlobs,
  stepBlobs,
} from "@/components/music-player/lava-field";
import type { PaletteColour } from "@/lib/cover-palette";

const FRAME = 16;

function run(
  blobs: ReturnType<typeof restingBlobs>,
  levels: number[],
  frames: number,
  from = 0
) {
  const arr = new Float32Array(levels);
  for (let i = 0; i < frames; i++) {
    stepBlobs(blobs, arr, (from + i) * FRAME, FRAME);
  }
  return from + frames;
}

describe("bandLevels", () => {
  it("averages each band", () => {
    const data = new Uint8Array(128);
    data.fill(255);
    const out = new Float32Array(5);
    bandLevels(data, out);
    expect(out.every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
  });
});

describe("stepBlobs", () => {
  it("attacks fast and releases slow", () => {
    const blobs = restingBlobs();
    run(blobs, [1, 1, 1, 1, 1], 2);
    const afterAttack = blobs[0]!.env;
    expect(afterAttack).toBeGreaterThan(0.3);

    // The glow lingers, then eases off — still there a quarter second on.
    run(blobs, [0, 0, 0, 0, 0], 15, 2);
    expect(blobs[0]!.env).toBeLessThan(afterAttack);
    expect(blobs[0]!.env).toBeGreaterThan(0.05);
  });

  it("keeps a sustained loud section short of fully lit", () => {
    const blobs = restingBlobs();
    run(blobs, [0.8, 0.8, 0.8, 0.8, 0.8], 600);
    // A held level is all section and no transient, so the transient's share
    // of the energy stays unspent — that is the headroom a kick lights up.
    expect(blobs[0]!.env).toBeGreaterThan(0.4);
    expect(blobs[0]!.env).toBeLessThan(0.65);
  });

  it("shows a kick inside a section that is already loud", () => {
    const blobs = restingBlobs();
    const loud = 0.8;
    let t = run(blobs, [loud, 0, 0, 0, 0], 600);
    const held = blobs[0]!.env;

    // A 6 dB lift over the section level, held for a few frames.
    t = run(blobs, [loud + 6 / 90, 0, 0, 0, 0], 4, t);
    const hit = blobs[0]!.env;
    expect(hit - held).toBeGreaterThan(0.2);

    // …and it falls back again, rather than ratcheting the ceiling.
    run(blobs, [loud, 0, 0, 0, 0], 60, t);
    expect(blobs[0]!.env).toBeLessThan(held + 0.05);
  });

  it("reacts to each band independently, not to one aggregate volume", () => {
    const blobs = restingBlobs();
    // Band 0 (sub) hits, then rests; band 4 (treble) rests, then hits — the
    // two blobs' envelopes should track their own band, not move in lockstep.
    const t = run(blobs, [1, 0, 0, 0, 0], 20);
    const subHot = blobs[0]!.env;
    const trebleCold = blobs[4]!.env;
    expect(subHot).toBeGreaterThan(trebleCold);

    run(blobs, [0, 0, 0, 0, 1], 40, t);
    expect(blobs[4]!.env).toBeGreaterThan(blobs[0]!.env);
  });
});

describe("fadeBlobs", () => {
  it("eases the energy down over many frames and reports when settled", () => {
    const blobs = restingBlobs();
    const t = run(blobs, [1, 1, 1, 1, 1], 30);
    const lit = blobs[0]!.env;
    expect(lit).toBeGreaterThan(0.3);

    expect(fadeBlobs(blobs, (t + 1) * FRAME)).toBe(false);
    // One frame of fading keeps most of the glow.
    expect(blobs[0]!.env).toBeGreaterThan(lit * 0.9);

    let settled = false;
    let frames = 0;
    while (!settled && frames < 1000) {
      settled = fadeBlobs(blobs, (t + 2 + frames) * FRAME);
      frames++;
    }
    expect(settled).toBe(true);
    // Somewhere between one and five seconds at 60 fps.
    expect(frames).toBeGreaterThan(60);
    expect(frames).toBeLessThan(300);
    expect(blobs.every((b) => b.env === 0)).toBe(true);
    expect(blobs[0]!.r).toBeCloseTo(blobs[0]!.rest);
  });
});

describe("restingBlobs", () => {
  it("is deterministic and inside the field", () => {
    const a = restingBlobs();
    const b = restingBlobs();
    expect(a).toEqual(b);
    for (const blob of a) {
      expect(blob.x).toBeGreaterThanOrEqual(0);
      expect(blob.x).toBeLessThanOrEqual(1);
      expect(blob.y).toBeGreaterThanOrEqual(0);
      expect(blob.y).toBeLessThanOrEqual(1);
    }
    const radii = a.map((b) => b.rest);
    expect([...radii]).toEqual([...radii].sort((x, y) => y - x));
  });
});

describe("blobColour", () => {
  const colour: PaletteColour = { L: 0.9, C: 0.35, h: 20, share: 1 };

  it("clamps per theme", () => {
    const light = blobColour(colour, "light");
    expect(light.L).toBeGreaterThanOrEqual(0.55);
    expect(light.L).toBeLessThanOrEqual(0.8);
    expect(light.C).toBeLessThanOrEqual(0.2);

    const dark = blobColour(colour, "dark");
    expect(dark.L).toBeGreaterThanOrEqual(0.35);
    expect(dark.L).toBeLessThanOrEqual(0.6);
    expect(dark.C).toBeLessThanOrEqual(0.2);
  });
});
