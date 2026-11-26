"use client";

import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";

/**
 * The light the page's artwork throws across it: a fixed colour field behind
 * everything inside {@link ArtProvider}, coloured from the accent that wrapper
 * carries. It comes up with the artwork's bloom, over the same window, so the
 * page lights as one gesture rather than the wash sitting there before the
 * cover arrives. Its colours, shapes, dither and drift all live in globals.css
 * under `.wash`; this is only the skeleton the stylesheet keys on, with one
 * element for each part that moves on its own.
 */
export function PageWash() {
  return (
    <m.div {...useArrival("wash")} aria-hidden className="wash">
      <span className="wash__lobe wash__lobe--deep" />
      <span className="wash__lobe wash__lobe--lift" />
    </m.div>
  );
}
