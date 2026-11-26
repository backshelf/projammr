"use client";

import { useArrival } from "@workspace/ui/components/motion/arrival";
import { m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";

import { useMastheadScroll } from "@/components/motion/masthead-scroll";

/** How tall an entity page's masthead band is: the height the art fades out
 *  within and the scrim ends at, the token layer's `--masthead-band` (which
 *  the phone tier and `data-masthead` step). The frame itself (the bleed, the
 *  mask and the scrim's gradient) is `.masthead__art` and `.masthead__scrim`
 *  in the token layer's atmosphere.css, shared with the public site. */
const MASTHEAD_H = "[--masthead-h:var(--masthead-band)]";

export function MastheadArt() {
  return (
    <m.div
      {...useArrival("art")}
      style={useMastheadScroll("art")}
      aria-hidden
      className={cn(
        // `masthead__art` is where globals.css frames and tunes the blurred
        // field; the layers inside inherit every custom property it sets.
        "masthead__art z-0",
        MASTHEAD_H
      )}
    >
      {/* The image lives on its own oversized layer so the drift can move it
          with `translate` instead of repainting the blurred field every frame
          through `background-position`. The tone layer clips it to the
          masthead before blurring, so the field still softens at its edges.
          It also carries the art's resting opacity — this outer layer's own
          opacity belongs to the entrance and then to the scroll — and the two
          multiply, so a receding field still breathes. Blur, saturation and
          both halves of the drift are in globals.css. */}
      <div className={"masthead__tone"}>
        <div className={"masthead__field bg-[image:var(--art-image)]"} />
      </div>
    </m.div>
  );
}

/** The legibility gradient between the art and the type. It thins as the art
 *  recedes, so the head keeps the same contrast the whole way down. */
export function MastheadScrim() {
  return (
    <m.div
      style={useMastheadScroll("scrim")}
      aria-hidden
      className={cn("masthead__scrim z-0", MASTHEAD_H)}
    />
  );
}
