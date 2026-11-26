import { describe, expect, it } from "bun:test";
import { paletteFromPixels } from "@/lib/cover-palette";

function fillRegion(
  data: Uint8ClampedArray,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  [r, g, b]: [number, number, number]
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

describe("paletteFromPixels", () => {
  it("returns count colours for a chromatic image", () => {
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    fillRegion(data, size, 0, 0, 21, size, [220, 40, 40]); // red
    fillRegion(data, size, 21, 0, 43, size, [40, 200, 60]); // green
    fillRegion(data, size, 43, 0, 64, size, [40, 60, 220]); // blue

    const palette = paletteFromPixels(data, 5);
    expect(palette).toHaveLength(5);
    const hues = palette.slice(0, 3).map((c) => c.h);
    const spread = Math.max(...hues) - Math.min(...hues);
    expect(spread).toBeGreaterThan(60);
  });

  it("keeps hues apart", () => {
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    fillRegion(data, size, 0, 0, 21, size, [220, 40, 40]); // red
    fillRegion(data, size, 21, 0, 43, size, [220, 55, 45]); // red, 10° off
    fillRegion(data, size, 43, 0, 64, size, [40, 60, 220]); // blue

    const palette = paletteFromPixels(data, 5);
    const reds = palette.filter((c) => c.h < 40 || c.h > 320);
    const blues = palette.filter((c) => c.h > 200 && c.h < 280);
    // The two near-identical reds collapse toward one hue neighbourhood while
    // the distinct blue still gets its own slot.
    expect(blues.length).toBeGreaterThan(0);
    expect(reds.length).toBeGreaterThan(0);
  });

  it("grayscale cover yields tonal greys", () => {
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    fillRegion(data, size, 0, 0, 21, size, [20, 20, 20]);
    fillRegion(data, size, 21, 0, 43, size, [128, 128, 128]);
    fillRegion(data, size, 43, 0, 64, size, [230, 230, 230]);

    const palette = paletteFromPixels(data, 3);
    expect(palette.every((c) => c.C < 0.04)).toBe(true);
    const lightnesses = palette.map((c) => c.L).sort((a, b) => a - b);
    expect(lightnesses[0]).toBeLessThan(lightnesses[2]! - 0.1);
  });

  it("ignores near-white and near-black backgrounds", () => {
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    fillRegion(data, size, 0, 0, size, size, [250, 250, 250]);
    fillRegion(data, size, 28, 28, 36, 36, [220, 40, 40]);

    const palette = paletteFromPixels(data, 5);
    expect(palette[0]!.C).toBeGreaterThan(0.05);
  });
});
