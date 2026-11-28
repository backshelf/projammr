import {
  SPECTROGRAM_CEIL_DB,
  SPECTROGRAM_FLOOR_DB,
  SPECTROGRAM_HIGH_HZ,
  SPECTROGRAM_LOW_HZ,
} from "@workspace/dsp/offline";

const SPECTROGRAM_DISPLAY_MIN_DB = -68;
const SPECTROGRAM_DISPLAY_MAX_DB = -6;
const SPECTROGRAM_GAMMA = 1.35;

export type OklchColor = { L: number; C: number; H: number };

const IS_LITTLE_ENDIAN = (() => {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, 0x01020304, true);
  return new Uint8Array(buf)[0] === 0x04;
})();

const srgbChannelToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const linearToSrgbByte = (c: number) => {
  const clamped = Math.min(1, Math.max(0, c));
  const encoded =
    clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

/** Converts sRGB bytes `[0..255]` into OKLCH using Björn Ottosson's Oklab matrices. */
export function srgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  );

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const ob = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(a, ob);
  const H = C < 1e-4 ? 0 : ((Math.atan2(ob, a) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

/** Converts OKLCH back to clamped sRGB bytes `[0..255]`. */
function oklchToSrgb(
  L: number,
  C: number,
  H: number
): [number, number, number] {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [linearToSrgbByte(r), linearToSrgbByte(g), linearToSrgbByte(bl)];
}

type RampStop = { u: number; L: number; C: number; alpha: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function packRgba(r: number, g: number, b: number, a: number): number {
  if (IS_LITTLE_ENDIAN) {
    return (
      ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)
    );
  }
  return (
    ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)
  );
}

/**
 * Unpacks an entry from the 256-entry LUT into `[r, g, b, a]` bytes,
 * endianness-independently.
 */
export function unpackLutEntry(
  packed: number
): [number, number, number, number] {
  if (IS_LITTLE_ENDIAN) {
    return [
      packed & 0xff,
      (packed >>> 8) & 0xff,
      (packed >>> 16) & 0xff,
      (packed >>> 24) & 0xff,
    ];
  }
  return [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ];
}

/** Converts a stored PNG grayscale byte `0..255` back to dBFS (`-80..0`). */
export function spectrogramByteToDb(byte: number): number {
  return (
    SPECTROGRAM_FLOOR_DB +
    (byte / 255) * (SPECTROGRAM_CEIL_DB - SPECTROGRAM_FLOOR_DB)
  );
}

/**
 * Builds a 256-entry RGBA LUT for painting decoded spectrogram PNG bytes onto
 * a transparent `<canvas>` using the room's computed OKLCH `--art` tone:
 * - Values <= -68 dB map to `alpha = 0` (transparent silence).
 * - Display window `[-68 dB, -6 dB]` with gamma `1.35`.
 * - Dark mode uses the incandescent darkroom ramp; light mode uses photogravure ink.
 * - Grayscale covers (`C < 0.005`) produce silver-gelatin monochrome (`C = 0`).
 */
export function buildSpectrogramLut({
  dark,
  artLch,
}: {
  dark: boolean;
  artLch: OklchColor;
}): Uint32Array {
  const C = artLch.C < 0.005 ? 0 : artLch.C;
  const H = artLch.H;

  const stops: RampStop[] = dark
    ? [
        { u: 0.0, L: 0.22, C: C * 0.35, alpha: 0.0 },
        { u: 0.2, L: 0.22, C: C * 0.35, alpha: 0.65 },
        { u: 0.52, L: 0.66, C: Math.min(C * 1.3, 0.19), alpha: 1.0 },
        { u: 0.8, L: 0.84, C: C * 0.9, alpha: 1.0 },
        { u: 1.0, L: 0.97, C: C * 0.18, alpha: 1.0 },
      ]
    : [
        { u: 0.0, L: 0.88, C: C * 0.35, alpha: 0.0 },
        { u: 0.2, L: 0.88, C: C * 0.35, alpha: 0.35 },
        { u: 0.52, L: 0.56, C: Math.min(C * 1.35, 0.2), alpha: 1.0 },
        { u: 0.8, L: 0.34, C: Math.min(C * 1.1, 0.15), alpha: 1.0 },
        { u: 1.0, L: 0.14, C: C * 0.15, alpha: 1.0 },
      ];

  const lut = new Uint32Array(256);
  const span = SPECTROGRAM_DISPLAY_MAX_DB - SPECTROGRAM_DISPLAY_MIN_DB;

  for (let byte = 0; byte < 256; byte++) {
    const db = spectrogramByteToDb(byte);
    if (db <= SPECTROGRAM_DISPLAY_MIN_DB) {
      lut[byte] = 0;
      continue;
    }
    const linear = Math.min(
      1,
      Math.max(0, (db - SPECTROGRAM_DISPLAY_MIN_DB) / span)
    );
    const u = Math.pow(linear, SPECTROGRAM_GAMMA);

    let lo = stops[0]!;
    let hi = stops[stops.length - 1]!;
    for (let s = 0; s < stops.length - 1; s++) {
      if (u <= stops[s + 1]!.u) {
        lo = stops[s]!;
        hi = stops[s + 1]!;
        break;
      }
    }
    const segSpan = hi.u - lo.u;
    const f = segSpan > 0 ? (u - lo.u) / segSpan : 0;
    const L = lerp(lo.L, hi.L, f);
    const c = lerp(lo.C, hi.C, f);
    const alpha = Math.round(lerp(lo.alpha, hi.alpha, f) * 255);
    const [r, g, b] = oklchToSrgb(L, c, H);
    lut[byte] = packRgba(r, g, b, alpha);
  }

  return lut;
}

/**
 * Peak-preserving horizontal downsampling (`0.75 * max + 0.25 * mean`) for
 * painting a decoded row-major grayscale spectrogram onto a DPR canvas.
 * Source `data` has row 0 = lowest frequency (20 Hz), while destination row 0
 * is the top of the canvas (20 kHz).
 */
export function renderSpectrogramToPixels({
  data,
  srcWidth,
  srcHeight,
  dstWidth,
  dstHeight,
  lut,
  out,
}: {
  data: Uint8Array;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  lut: Uint32Array;
  out: Uint32Array;
}): void {
  if (srcWidth <= 0 || srcHeight <= 0 || dstWidth <= 0 || dstHeight <= 0)
    return;

  for (let py = 0; py < dstHeight; py++) {
    // Flip vertically with pixel-centre alignment: py=0 (top) -> highest band (srcHeight - 1).
    const yNorm = 1 - (py + 0.5) / dstHeight;
    const syFloat = Math.min(
      srcHeight - 1,
      Math.max(0, yNorm * srcHeight - 0.5)
    );
    const sy0 = Math.floor(syFloat);
    const sy1 = Math.min(srcHeight - 1, sy0 + 1);
    const syFrac = syFloat - sy0;
    const row0Offset = sy0 * srcWidth;
    const row1Offset = sy1 * srcWidth;
    const dstRowOffset = py * dstWidth;

    for (let px = 0; px < dstWidth; px++) {
      const c0 = Math.floor((px / dstWidth) * srcWidth);
      const c1 = Math.min(
        srcWidth,
        Math.max(c0 + 1, Math.floor(((px + 1) / dstWidth) * srcWidth))
      );
      let maxVal = 0;
      let sumVal = 0;
      const count = c1 - c0;
      for (let c = c0; c < c1; c++) {
        const v0 = data[row0Offset + c]!;
        const v1 = data[row1Offset + c]!;
        const v = syFrac === 0 ? v0 : v0 + (v1 - v0) * syFrac;
        if (v > maxVal) maxVal = v;
        sumVal += v;
      }
      const combined = Math.min(
        255,
        Math.max(0, Math.round(0.75 * maxVal + 0.25 * (sumVal / count)))
      );
      out[dstRowOffset + px] = lut[combined]!;
    }
  }
}

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
] as const;

/** Normalized vertical fraction from top (`0` = 20 kHz, `1` = 20 Hz) for a log frequency. */
export function topFractionForHz(hz: number): number {
  const clamped = Math.min(
    SPECTROGRAM_HIGH_HZ,
    Math.max(SPECTROGRAM_LOW_HZ, hz)
  );
  const fromBottom =
    Math.log(clamped / SPECTROGRAM_LOW_HZ) /
    Math.log(SPECTROGRAM_HIGH_HZ / SPECTROGRAM_LOW_HZ);
  return 1 - fromBottom;
}

/** Log frequency in Hz for a normalized vertical position from top (`0` = 20 kHz, `1` = 20 Hz). */
export function hzForTopFraction(yRatio: number): number {
  const fromBottom = 1 - Math.min(1, Math.max(0, yRatio));
  return (
    SPECTROGRAM_LOW_HZ *
    Math.pow(SPECTROGRAM_HIGH_HZ / SPECTROGRAM_LOW_HZ, fromBottom)
  );
}

/** Nearest equal-temperament pitch name (`A4` for 440 Hz). */
export function hzToNoteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(Math.max(1, hz) / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function formatHz(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return khz >= 10 ? `${khz.toFixed(1)} kHz` : `${khz.toFixed(2)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

function formatTimecodeTenths(seconds: number): string {
  const totalTenths = Math.round(Math.max(0, seconds) * 10);
  const mins = Math.floor(totalTenths / 600);
  const remTenths = totalTenths % 600;
  const whole = Math.floor(remTenths / 10);
  const tenths = remTenths % 10;
  return `${mins}:${String(whole).padStart(2, "0")}.${tenths}`;
}

function formatDb(db: number): string {
  const rounded = Math.round(db * 10) / 10;
  if (rounded === 0) return "0.0 dB";
  return rounded < 0
    ? `−${Math.abs(rounded).toFixed(1)} dB`
    : `+${rounded.toFixed(1)} dB`;
}

/** Formats the studio crosshair pill: `1:24.3 · 440 Hz (A4) · −24.2 dB`. */
export function formatSpectrogramReadout(
  seconds: number,
  hz: number,
  db: number
): string {
  return `${formatTimecodeTenths(seconds)} · ${formatHz(hz)} (${hzToNoteName(hz)}) · ${formatDb(db)}`;
}
