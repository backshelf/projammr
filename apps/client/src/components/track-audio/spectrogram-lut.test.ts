import { describe, expect, it } from "bun:test";
import {
  buildSpectrogramLut,
  formatSpectrogramReadout,
  hzForTopFraction,
  hzToNoteName,
  renderSpectrogramToPixels,
  srgbToOklch,
  topFractionForHz,
  unpackLutEntry,
} from "./spectrogram-lut";

describe("buildSpectrogramLut", () => {
  it("maps silence at or below -68 dB to transparent alpha = 0", () => {
    const lut = buildSpectrogramLut({
      dark: true,
      artLch: { L: 0.65, C: 0.14, H: 30 },
    });
    // -80 dB (byte 0) and -68 dB (byte ~38) must be transparent.
    expect(unpackLutEntry(lut[0]!)[3]).toBe(0);
    expect(unpackLutEntry(lut[38]!)[3]).toBe(0);
    // -6 dB (byte ~236) and 0 dB (byte 255) are opaque.
    expect(unpackLutEntry(lut[236]!)[3]).toBe(255);
    expect(unpackLutEntry(lut[255]!)[3]).toBe(255);
  });

  it("keeps grayscale covers achromatic across the whole ramp", () => {
    const lut = buildSpectrogramLut({
      dark: false,
      artLch: { L: 0.5, C: 0, H: 0 },
    });
    for (let i = 0; i < 256; i++) {
      const [r, g, b, a] = unpackLutEntry(lut[i]!);
      if (a > 0) {
        expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
        expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("renderSpectrogramToPixels", () => {
  it("flips bass to the bottom and preserves peaks on horizontal downsampling", () => {
    const lut = buildSpectrogramLut({
      dark: true,
      artLch: { L: 0.6, C: 0.12, H: 220 },
    });
    // 4 columns × 2 bands: band 0 (bass) has one loud transient in col 1 (240) and silence elsewhere.
    const data = new Uint8Array([
      0,
      240,
      0,
      0, // band 0 (20 Hz)
      0,
      0,
      0,
      0, // band 1 (20 kHz)
    ]);
    const out = new Uint32Array(1 * 2);
    renderSpectrogramToPixels({
      data,
      srcWidth: 4,
      srcHeight: 2,
      dstWidth: 1,
      dstHeight: 2,
      lut,
      out,
    });
    // Top pixel (py=0, treble) is silent; bottom pixel (py=1, bass) keeps 0.75*240 + 0.25*60 = 195.
    expect(unpackLutEntry(out[0]!)[3]).toBe(0);
    expect(out[1]).toBe(lut[195]);
  });
});

describe("frequency & readout helpers", () => {
  it("round-trips log frequencies and names A4 at 440 Hz", () => {
    const topFrac = topFractionForHz(440);
    expect(hzForTopFraction(topFrac)).toBeCloseTo(440, 4);
    expect(hzToNoteName(440)).toBe("A4");
    expect(formatSpectrogramReadout(84.3, 440, -24.2)).toBe(
      "1:24.3 · 440 Hz (A4) · −24.2 dB"
    );
    expect(formatSpectrogramReadout(59.99, 440, -24.2)).toBe(
      "1:00.0 · 440 Hz (A4) · −24.2 dB"
    );
  });

  it("extracts OKLCH from sRGB cleanly", () => {
    const gray = srgbToOklch(128, 128, 128);
    expect(gray.C).toBeLessThan(0.001);
  });
});
