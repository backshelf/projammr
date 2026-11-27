/**
 * Derives a stable accent colour from a cover image so client pages never pay
 * an extraction cost at render.
 *
 * The most frequent colour in a cover is almost always a dark, desaturated
 * background, which makes a muddy accent. Instead this scores each colour bin by
 * chroma weighted by the square root of its share, penalising near-black and
 * near-white bins, then re-normalises the winner to a fixed lightness per theme
 * so contrast is predictable whatever the source looked like.
 */
import sharp from "sharp";

export type Palette = {
  accentHue: number | null;
  accentChroma: number;
  accentHex: string;
  light: string;
  dark: string;
  glowLight: string;
  glowDark: string;
};

/** RGB channels are bucketed to this granularity before histogramming. */
const QUANTISE_STEP = 2;
/** Below this OkLCH chroma the winning bin reads as neutral: emit no hue. */
const CHROMA_FLOOR = 0.04;

const srgbToLin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function rgbToOklch(r8: number, g8: number, b8: number) {
  const r = srgbToLin(r8 / 255);
  const g = srgbToLin(g8 / 255);
  const b = srgbToLin(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C: Math.hypot(A, B), h: (hue + 360) % 360 };
}

const toHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

/**
 * Bins the raw pixels of a downscaled image into a coarse RGB palette and
 * returns each bin's representative colour plus its pixel count.
 */
function binPixels(data: Buffer, channels: number) {
  const counts = new Map<
    number,
    { r: number; g: number; b: number; n: number }
  >();
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key =
      (Math.round(r / QUANTISE_STEP) << 16) |
      (Math.round(g / QUANTISE_STEP) << 8) |
      Math.round(b / QUANTISE_STEP);
    const bin = counts.get(key);
    if (bin) {
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n += 1;
    } else {
      counts.set(key, { r, g, b, n: 1 });
    }
  }
  return [...counts.values()].map((bin) => ({
    r: Math.round(bin.r / bin.n),
    g: Math.round(bin.g / bin.n),
    b: Math.round(bin.b / bin.n),
    count: bin.n,
  }));
}

function normalise(
  hue: number,
  chroma: number
): Omit<Palette, "accentHue" | "accentChroma" | "accentHex"> {
  const h = hue.toFixed(1);
  return {
    light: `oklch(0.55 ${Math.min(chroma * 1.3, 0.19).toFixed(3)} ${h})`,
    dark: `oklch(0.78 ${Math.min(chroma * 1.25, 0.17).toFixed(3)} ${h})`,
    glowLight: `oklch(0.72 ${Math.min(chroma, 0.14).toFixed(3)} ${h})`,
    glowDark: `oklch(0.45 ${Math.min(chroma, 0.14).toFixed(3)} ${h})`,
  };
}

const GRAYSCALE: Omit<Palette, "accentHue" | "accentChroma" | "accentHex"> = {
  light: "oklch(0.45 0 0)",
  dark: "oklch(0.80 0 0)",
  glowLight: "oklch(0.65 0 0)",
  glowDark: "oklch(0.38 0 0)",
};

export async function extractPalette(input: Buffer | string): Promise<Palette> {
  const { data, info } = await sharp(input)
    .resize(160, 160, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = binPixels(data, info.channels);
  const total = bins.reduce((a, b) => a + b.count, 0);

  const scored = bins
    .map((bin) => {
      const { L, C, h } = rgbToOklch(bin.r, bin.g, bin.b);
      const share = bin.count / total;
      const usable = L > 0.12 && L < 0.95 ? 1 : 0.15;
      return { bin, L, C, h, score: C * Math.sqrt(share) * usable };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  const chromatic = top.C > CHROMA_FLOOR;
  const accentHex = toHex(top.bin.r, top.bin.g, top.bin.b);

  return {
    accentHue: chromatic ? top.h : null,
    accentChroma: top.C,
    accentHex,
    ...(chromatic ? normalise(top.h, top.C) : GRAYSCALE),
  };
}
