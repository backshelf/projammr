/**
 * Samples a handful of visually distinct colours out of a cover image, for
 * the now-playing lava field to paint its blobs in. The server's
 * `extractPalette` (apps/server/src/lib/palette.ts) picks a single accent and
 * never has to worry about its winner looking like its runner-up — this picks
 * several, so it needs its own diversity pass on top of the same scoring idea.
 */

export type PaletteColour = { L: number; C: number; h: number; share: number };

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

/** RGB channels bucketed to 32 levels: at 64×64 finer bins are all singletons. */
const STEP = 8;
/** Two bins closer than this in OkLCH hue are the same colour mass. */
const HUE_APART = 28;
/** A bin below this chroma is a grey; greys are only kept when nothing chromatic beat them. */
const CHROMA_FLOOR = 0.04;

export function paletteFromPixels(
  data: Uint8ClampedArray,
  count = 5
): PaletteColour[] {
  const bins = new Map<
    number,
    { r: number; g: number; b: number; n: number }
  >();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    const key = ((r / STEP) << 10) | ((g / STEP) << 5) | (b / STEP);
    const bin = bins.get(key);
    if (bin) {
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n++;
    } else bins.set(key, { r, g, b, n: 1 });
  }
  const total = data.length / 4;

  const scored = [...bins.values()]
    .map(({ r, g, b, n }) => {
      const { L, C, h } = rgbToOklch(r / n, g / n, b / n);
      const share = n / total;
      const usable = L > 0.1 && L < 0.95 ? 1 : 0.15;
      return { L, C, h, share, score: (C + 0.02) * Math.sqrt(share) * usable };
    })
    .sort((a, b) => b.score - a.score);

  // Greedy pick: take the best bin, then the best bin not within HUE_APART of
  // any taken chromatic bin. Greys (C below the floor) never block each other
  // on hue, so a grayscale cover still yields `count` tonal masses rather
  // than one.
  const picked: PaletteColour[] = [];
  for (const c of scored) {
    if (picked.length === count) break;
    const clash = picked.some(
      (p) =>
        c.C >= CHROMA_FLOOR &&
        p.C >= CHROMA_FLOOR &&
        Math.min(Math.abs(p.h - c.h), 360 - Math.abs(p.h - c.h)) < HUE_APART
    );
    // Two greys are distinct only by lightness.
    const greyClash =
      c.C < CHROMA_FLOOR &&
      picked.some((p) => p.C < CHROMA_FLOOR && Math.abs(p.L - c.L) < 0.15);
    if (!clash && !greyClash)
      picked.push({ L: c.L, C: c.C, h: c.h, share: c.share });
  }
  // A flat cover may not fill `count`; repeat the winners so every blob has a
  // colour.
  while (picked.length < count && picked.length > 0)
    picked.push(picked[picked.length % picked.length]!);
  return picked;
}

type Context2DLike = {
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
};
type CanvasLike = { getContext(id: "2d"): Context2DLike | null };

function makeCanvas(size: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(size, size) as unknown as CanvasLike;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

const CACHE_LIMIT = 20;
const cache = new Map<string, Promise<PaletteColour[]>>();

/**
 * Draws a cover to a small offscreen canvas and reads its palette back. Every
 * upload goes through the same-origin `/media` proxy, so this never taints
 * the canvas for a same-origin cover; an off-origin `https:` cover can still
 * throw on `getImageData`, which resolves to `[]` — the caller treats that as
 * "draw nothing".
 *
 * The result is cached per URL and shared by every caller, so it depends on
 * the URL and nothing else. A caller that no longer wants the palette by the
 * time it arrives — a cover that changed, a component that unmounted — drops
 * it on its own side; cancelling here would poison the cache entry for
 * everyone who asks for that cover later.
 */
export function loadCoverPalette(url: string): Promise<PaletteColour[]> {
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = new Promise<PaletteColour[]>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const size = 64;

    const settle = (colours: PaletteColour[]) => resolve(colours);

    image.onload = () => {
      try {
        const canvas = makeCanvas(size);
        const ctx = canvas.getContext("2d");
        if (!ctx) return settle([]);
        ctx.drawImage(image, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        settle(paletteFromPixels(data));
      } catch {
        settle([]);
      }
    };
    image.onerror = () => settle([]);
    image.src = url;
  });

  cache.set(url, promise);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return promise;
}
