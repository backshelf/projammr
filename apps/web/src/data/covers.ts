import type { ImageMetadata } from "astro";

import magenta from "@/assets/covers/magenta.jpg";
import mono from "@/assets/covers/mono.jpg";
import sunset from "@/assets/covers/sunset.jpg";
import teal from "@/assets/covers/teal.jpg";
import { artVarsFromAccent, type ArtVars } from "@workspace/ui/lib/art";

/** The four covers that light the site, and the accent each one gives a page.
 *
 * Each image is a copy of `fixtures/covers/<key>.jpg`, the fixtures
 * `apps/server/src/lib/palette.test.ts` loads, which also light the demo
 * catalogue the screenshots are taken from. Each accent is what the server
 * stores on an uploaded image's row: `extractPalette` in
 * `apps/server/src/lib/palette.ts` run over the same file, at the single
 * precision the `accentHue`/`accentChroma` columns keep. `mono` has too little
 * chroma for the extractor to name a hue, so a page it lights stays grey. */
export const COVERS = {
  teal: { image: teal, hue: 220.76811, chroma: 0.13283354 },
  magenta: { image: magenta, hue: 297.23593, chroma: 0.17990021 },
  sunset: { image: sunset, hue: 38.094948, chroma: 0.21126293 },
  mono: { image: mono, hue: null, chroma: 0.007720997 },
} satisfies Record<
  string,
  { image: ImageMetadata; hue: number | null; chroma: number }
>;

export type CoverKey = keyof typeof COVERS;

/** The accent variables a cover lights an element with, as its inline style.
 * `image` is the URL the masthead blurs, when the element draws the cover. */
export const coverArt = (cover: CoverKey, image?: string): ArtVars =>
  artVarsFromAccent(COVERS[cover].hue, COVERS[cover].chroma, image);
