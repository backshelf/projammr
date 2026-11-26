/** An sRGB colour, channels 0–255 and alpha 0–1. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** The tokens a Constellation draws with, resolved for the active theme. */
export type Palette = {
  ink: Rgba;
  inkSoft: Rgba;
  inkFaint: Rgba;
  rule: Rgba;
  paper: Rgba;
  art: Rgba;
  warn: Rgba;
};

const TOKENS: Record<keyof Palette, string> = {
  ink: "--ink",
  inkSoft: "--ink-soft",
  inkFaint: "--ink-faint",
  rule: "--rule",
  paper: "--paper",
  art: "--art",
  warn: "--warn",
};

/**
 * Reads the palette off `element`'s computed style. The tokens are `oklch()`
 * and the renderer takes sRGB, so each one is painted onto a one-pixel canvas
 * and read back: the browser does the conversion, and a theme or an artwork
 * accent resolves exactly as the page around it does.
 */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const resolve = (token: string): Rgba => {
    const value = style.getPropertyValue(token).trim();
    if (!context || value === "") return [0, 0, 0, 1];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1
    ).data;
    return [r, g, b, a / 255];
  };

  return Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [name, resolve(token)])
  ) as Palette;
}

/** Whether two readings of the palette are the same colours. */
export function samePalette(a: Palette, b: Palette): boolean {
  return (Object.keys(a) as (keyof Palette)[]).every((name) =>
    a[name].every((channel, i) => channel === b[name][i])
  );
}

/** `a` moved towards `b` by `t` (0 to 1), alpha included. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const at = (i: 0 | 1 | 2 | 3) => a[i] + (b[i] - a[i]) * t;
  return [at(0), at(1), at(2), at(3)];
}

/** A CSS colour for the 2D canvas the labels are drawn on. */
export function css([r, g, b, a]: Rgba, alpha = 1): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+(a * alpha).toFixed(3)})`;
}

/**
 * A colour for the WebGL layers. The renderer blends as premultiplied alpha
 * (`ONE, ONE_MINUS_SRC_ALPHA`) but hands its shaders straight colours, so a
 * translucent colour is premultiplied here or it would draw brighter than it
 * is.
 */
export function gl([r, g, b, a]: Rgba, alpha = 1): string {
  const k = a * alpha;
  return `rgba(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}, ${+k.toFixed(3)})`;
}
