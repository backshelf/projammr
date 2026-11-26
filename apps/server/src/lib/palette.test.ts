import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { extractPalette } from "./palette.js";

const designDir = fileURLToPath(
  new URL("../../../../fixtures/covers/", import.meta.url)
);

const load = (name: string) => readFile(`${designDir}${name}`);

// Hues validated against the four prototype covers (IMPLEMENTATION.md §1.5).
// The sharp binning here tracks the ImageMagick reference to within ~1°.
const cases = [
  { name: "teal", hue: 220.7 },
  { name: "sunset", hue: 37.1 },
  { name: "magenta", hue: 297.6 },
] as const;

describe("extractPalette", () => {
  for (const { name, hue } of cases) {
    it(`derives the ${name} accent hue`, async () => {
      const p = await extractPalette(await load(`${name}.jpg`));
      expect(p.accentHue).not.toBeNull();
      expect(Math.abs(p.accentHue! - hue)).toBeLessThan(1.5);
      expect(p.accentChroma).toBeGreaterThan(0.04);
      expect(p.light).toMatch(/^oklch\(0\.55 0\.\d+ \d/);
      expect(p.dark).toMatch(/^oklch\(0\.78 /);
      expect(p.glowLight).toMatch(/^oklch\(0\.72 /);
      expect(p.glowDark).toMatch(/^oklch\(0\.45 /);
    });
  }

  it("emits a null hue and grayscale vars for a mono cover", async () => {
    const p = await extractPalette(await load("mono.jpg"));
    expect(p.accentHue).toBeNull();
    expect(p.accentChroma).toBeLessThan(0.04);
    expect(p.light).toBe("oklch(0.45 0 0)");
    expect(p.dark).toBe("oklch(0.80 0 0)");
    expect(p.glowLight).toBe("oklch(0.65 0 0)");
    expect(p.glowDark).toBe("oklch(0.38 0 0)");
  });

  it("returns a hex string for the raw pick", async () => {
    const p = await extractPalette(await load("teal.jpg"));
    expect(p.accentHex).toMatch(/^#[0-9A-F]{6}$/);
  });
});
