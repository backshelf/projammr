/**
 * The now-playing lava field's simulation: turning analyser bytes into five
 * band energies, stepping each blob's position, size and alpha from them, and
 * drawing the result. Pure functions over plain numbers and a 2D context —
 * nothing here reads the DOM beyond the context it is handed, so the
 * component that owns the canvas and the rAF loop stays thin.
 */
import type { PaletteColour } from "@/lib/cover-palette";

const ANALYSER_FFT_SIZE = 512; // 256 bins; reduced to BANDS.length bands
/**
 * The byte range spans the whole usable dynamic range rather than the default
 * −100…−30 dB. Loud mixes sit well above −30 dBFS in the low bins, and against
 * the default ceiling they pin at 255 for whole sections, with no dynamics
 * left for the envelope to read.
 */
const ANALYSER_MIN_DB = -90;
const ANALYSER_MAX_DB = 0;
/** One byte unit is (MAX − MIN) / 255 dB; this is one dB in level units (0..1). */
const DB = 1 / (ANALYSER_MAX_DB - ANALYSER_MIN_DB);
/**
 * Light enough that a kick's magnitude collapses within a few frames of it
 * stopping; the blob envelopes do their own shaping, and the wider bands
 * average dozens of bins so the noise this lets through washes out.
 */
const ANALYSER_SMOOTHING = 0.5;

/** Sets up an analyser so `bandLevels` reads it the way the bands expect. */
export function configureAnalyser(analyser: AnalyserNode): void {
  analyser.fftSize = ANALYSER_FFT_SIZE;
  analyser.minDecibels = ANALYSER_MIN_DB;
  analyser.maxDecibels = ANALYSER_MAX_DB;
  analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
}

/**
 * Bin ranges [from, to) per blob, against `ANALYSER_FFT_SIZE` 512's ~86 Hz-wide
 * bins (44.1 kHz / 512). Bin 0 carries 0–86 Hz, so sub starts there rather
 * than at bin 1.
 */
export const BANDS: readonly [number, number][] = [
  [0, 2], // 0–172 Hz: sub
  [2, 6], // 172–517 Hz: low mids
  [6, 24], // 517 Hz–2.07 kHz: mids
  [24, 70], // 2.07–6.03 kHz: high mids
  [70, 256], // 6.03 kHz and up: treble
];

/**
 * Mean byte level of each band, 0..1 — a dB-domain mean, since the bytes are
 * linear in dB. Mean not peak: peak makes the highs twitch on every transient
 * while the mean tracks what the ear hears.
 */
export function bandLevels(data: Uint8Array, out: Float32Array): void {
  for (let b = 0; b < BANDS.length; b++) {
    const [from, to] = BANDS[b]!;
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i] ?? 0;
    out[b] = sum / ((to - from) * 255);
  }
}

export type Blob = {
  home: [number, number]; // 0..1 of the field
  orbit: [number, number]; // radii of the idle drift ellipse
  phase: number; // idle drift phase offset
  rest: number; // resting radius, 0..1 of the field's short side
  fast: number; // the band level with a quick attack and a short release
  slow: number; // the band level averaged over the last second or so
  peak: number; // running ceiling of `fast`, the loudest this band has been lately
  env: number; // display energy 0..1: how loud the section is plus the transient on top
  x: number;
  y: number;
  r: number;
  a: number; // current render values
};

/**
 * Resting layout: home positions spread around the field so no corner is
 * dead and the sub blob sits low where the transport is. Also the still
 * frame under reduced motion.
 */
export function restingBlobs(): Blob[] {
  const homes: [number, number][] = [
    [0.3, 0.7],
    [0.7, 0.75],
    [0.5, 0.35],
    [0.2, 0.25],
    [0.8, 0.3],
  ];
  return homes.map((home, i) => ({
    home,
    orbit: [0.06 + i * 0.01, 0.04 + i * 0.012],
    phase: (i / homes.length) * Math.PI * 2,
    rest: 0.42 - i * 0.04, // sub biggest, treble smallest
    fast: 0,
    slow: 0,
    peak: PEAK_FLOOR,
    env: 0,
    x: home[0],
    y: home[1],
    r: 0.42 - i * 0.04,
    a: 0.55,
  }));
}

const FAST_ATTACK = 0.5; // fraction of the gap closed per frame going up
const FAST_RELEASE = 0.2; // going down — a kick's lift is gone in ~10 frames
const SLOW_RATE = 0.015; // ~1 s to settle on a section's level
const PEAK_DECAY = 0.7 * DB; // per frame (~42 dB/s): the ceiling follows a quieter section down within a few hundred ms
const PEAK_FLOOR = 27 * DB; // −63 dBFS: near-silence never normalises its own noise into a lit blob
/** How far below its recent peak a band's section level reads as fully dark. */
const BASE_RANGE = 18 * DB;
/** How far a transient must lift a band over its section level to read as a full hit. */
const ACCENT_RANGE = 6 * DB;
const BASE_WEIGHT = 0.55;
const ACCENT_WEIGHT = 0.45;
const ATTACK = 0.5; // fraction of the gap the display energy closes per frame going up
const RELEASE = 0.15; // going down — a hit's glow lingers ~15 frames
const FADE = 0.025; // release while paused: the field takes ~2 s to settle
const IDLE_RATE = 0.00025; // radians per ms: one lap of the orbit ≈ 25 s
const REF_FRAME_MS = 1000 / 60;
const MAX_DT_MS = 100;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

function frameScale(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, MAX_DT_MS) / REF_FRAME_MS;
}

function stepEnvelope(ratePerFrame: number, scale: number): number {
  return scale <= 0 ? 0 : 1 - Math.pow(1 - ratePerFrame, scale);
}

function layoutBlob(b: Blob, t: number): void {
  const ang = t * IDLE_RATE + b.phase;
  b.x =
    b.home[0] + Math.cos(ang) * b.orbit[0] + b.env * 0.02 * Math.sin(ang * 3);
  b.y = b.home[1] + Math.sin(ang * 0.8) * b.orbit[1];
  b.r = b.rest * (1 + b.env * 0.45);
  b.a = 0.55 + b.env * 0.45;
}

/**
 * Each blob's energy is two things added: how loud its band's current section
 * is against the loudest the band has been lately, and how far the band is
 * lifted right now over that section's average. The first keeps a chorus
 * brighter than a verse; the second is what makes a kick visible inside a
 * chorus that is already loud, which a single normalised level cannot do —
 * once a section pins it near the ceiling there is nowhere left to go.
 *
 * `dt` scales every envelope step and peak decay relative to a 60 Hz frame
 * (clamped at 100 ms so a throttled tab never jumps), keeping physical motion
 * identical across 60 Hz and high-refresh displays.
 */
export function stepBlobs(
  blobs: Blob[],
  levels: Float32Array,
  t: number,
  dt: number
): void {
  const scale = frameScale(dt);
  const fastAttack = stepEnvelope(FAST_ATTACK, scale);
  const fastRelease = stepEnvelope(FAST_RELEASE, scale);
  const slowRate = stepEnvelope(SLOW_RATE, scale);
  const peakDecay = PEAK_DECAY * scale;
  const attack = stepEnvelope(ATTACK, scale);
  const release = stepEnvelope(RELEASE, scale);

  blobs.forEach((b, i) => {
    const raw = levels[i] ?? 0;
    b.fast += (raw - b.fast) * (raw > b.fast ? fastAttack : fastRelease);
    b.slow += (b.fast - b.slow) * slowRate;
    b.peak = Math.max(b.fast, b.peak - peakDecay, PEAK_FLOOR);

    const base = clamp01((b.slow - (b.peak - BASE_RANGE)) / BASE_RANGE);
    const accent = clamp01((b.fast - b.slow) / ACCENT_RANGE);
    const target = base * BASE_WEIGHT + accent * ACCENT_WEIGHT;
    b.env += (target - b.env) * (target > b.env ? attack : release);

    layoutBlob(b, t);
  });
}

/**
 * One frame of the field settling after playback stops: the blobs keep
 * drifting while their energy eases back to rest, so a pause reads as the
 * colour dimming rather than the picture being swapped. Returns true once
 * every blob has settled and the caller can stop drawing.
 */
export function fadeBlobs(
  blobs: Blob[],
  t: number,
  dt: number = REF_FRAME_MS
): boolean {
  const fade = stepEnvelope(FADE, frameScale(dt));
  let settled = true;
  for (const b of blobs) {
    b.fast = 0;
    b.slow = 0;
    b.env -= b.env * fade;
    if (b.env < 0.005) b.env = 0;
    else settled = false;
    layoutBlob(b, t);
  }
  return settled;
}

export type Theme = "light" | "dark";

const LIGHTNESS_RANGE: Record<Theme, [number, number]> = {
  light: [0.55, 0.8],
  dark: [0.35, 0.6],
};
const CHROMA_CAP = 0.2;

export type ClampedColour = { L: number; C: number; h: number };

/**
 * Resolves a sampled cover colour to the lightness band that keeps it legible
 * under the sheet's scrim in a given theme.
 */
export function blobColour(colour: PaletteColour, theme: Theme): ClampedColour {
  const [lo, hi] = LIGHTNESS_RANGE[theme];
  const L = Math.min(Math.max(colour.L, lo), hi);
  const C = Math.min(colour.C, CHROMA_CAP);
  return { L, C, h: colour.h };
}

function blobColourString(colour: PaletteColour, theme: Theme, alpha: number) {
  const { L, C, h } = blobColour(colour, theme);
  return `oklch(${L} ${C} ${h} / ${alpha})`;
}

/**
 * Clears the canvas and paints each blob as a radial gradient from its centre
 * (at its own alpha) to transparent at its radius. Bass first so the largest
 * blob sits underneath. Dark theme composites with `"lighter"` so overlapping
 * masses glow; light theme stays `"source-over"` since additive light on
 * paper goes white.
 */
export function drawField(
  ctx: CanvasRenderingContext2D,
  blobs: Blob[],
  colours: PaletteColour[],
  size: number,
  theme: Theme
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = theme === "dark" ? "lighter" : "source-over";

  blobs.forEach((b, i) => {
    const colour = colours[i % colours.length];
    if (!colour) return;
    const cx = b.x * size;
    const cy = b.y * size;
    const radius = b.r * size;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, blobColourString(colour, theme, b.a));
    gradient.addColorStop(1, blobColourString(colour, theme, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}
