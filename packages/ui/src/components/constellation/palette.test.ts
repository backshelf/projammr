import { afterEach, describe, expect, it } from "bun:test";
import { css, gl, mix, readPalette, samePalette, type Rgba } from "./palette";

describe("mix", () => {
  it("moves each channel, alpha included, by the fraction given", () => {
    expect(mix([0, 0, 0, 0], [200, 100, 50, 1], 0.5)).toEqual([
      100, 50, 25, 0.5,
    ]);
    expect(mix([10, 20, 30, 1], [90, 80, 70, 1], 0)).toEqual([10, 20, 30, 1]);
  });
});

describe("css", () => {
  it("writes a straight rgba colour, scaled by the extra alpha", () => {
    expect(css([250, 250, 250, 1])).toBe("rgba(250, 250, 250, 1)");
    expect(css([250, 250, 250, 1], 0.85)).toBe("rgba(250, 250, 250, 0.85)");
  });
});

describe("gl", () => {
  it("premultiplies a translucent colour, since the renderer blends as premultiplied", () => {
    expect(gl([200, 100, 50, 1], 0.5)).toBe("rgba(100, 50, 25, 0.5)");
    expect(gl([255, 255, 255, 0.11])).toBe("rgba(28, 28, 28, 0.11)");
  });

  it("leaves an opaque colour as it is", () => {
    expect(gl([12, 34, 56, 1])).toBe("rgba(12, 34, 56, 1)");
  });
});

describe("samePalette", () => {
  const black: Rgba = [0, 0, 0, 1];
  const palette = {
    ink: black,
    inkSoft: black,
    inkFaint: black,
    rule: black,
    paper: [255, 255, 255, 1] as Rgba,
    art: black,
    warn: black,
  };

  it("compares every channel of every colour", () => {
    expect(samePalette(palette, { ...palette })).toBe(true);
    expect(samePalette(palette, { ...palette, art: [0, 0, 1, 1] })).toBe(false);
  });
});

describe("readPalette", () => {
  const getContext = HTMLCanvasElement.prototype.getContext;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = getContext;
  });

  it("reads each token off the element and lets the browser convert it to sRGB", () => {
    // The browser's own conversion, stood in for: each token's value maps to
    // the pixel a 2D canvas would paint for it.
    const pixels: Record<string, number[]> = {
      "oklch(0.09 0 0)": [9, 9, 9, 255],
      "oklch(0.55 0.1 30)": [180, 90, 70, 255],
      "oklch(1 0 0 / 11%)": [255, 255, 255, 28],
    };
    let painted: number[] = [0, 0, 0, 0];
    const context = {
      fillStyle: "",
      clearRect() {
        painted = [0, 0, 0, 0];
      },
      fillRect() {
        painted = pixels[this.fillStyle] ?? [0, 0, 0, 255];
      },
      getImageData: () => ({ data: painted }),
    };
    HTMLCanvasElement.prototype.getContext = (() =>
      context) as unknown as typeof getContext;

    const element = document.createElement("div");
    element.style.setProperty("--ink", "oklch(0.09 0 0)");
    element.style.setProperty("--art", "oklch(0.55 0.1 30)");
    element.style.setProperty("--rule", "oklch(1 0 0 / 11%)");
    document.body.append(element);

    const palette = readPalette(element);
    expect(palette.ink).toEqual([9, 9, 9, 1]);
    expect(palette.art).toEqual([180, 90, 70, 1]);
    expect(palette.rule[3]).toBeCloseTo(28 / 255);
    element.remove();
  });
});
