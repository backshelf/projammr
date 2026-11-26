"use client";

import type { PlayerSize } from "@/components/music-player/types";
import { imageUrl } from "@/lib/utils";
import { AnimatePresence, FADE, m } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";

/**
 * The cover as a colour field rather than a picture. A cover is a busy image —
 * the detail that makes it good artwork is exactly what makes small type on
 * top of it unreadable — so it is blurred hard until only its colour survives.
 * The scale is what keeps the blur's soft edges outside the surface.
 */
const ART_LAYER = cn(
  "absolute inset-0 -z-2 scale-[1.35]",
  "bg-[image:var(--art-image)] bg-cover bg-center blur-[28px] saturate-[1.6]",
  "[--art-opacity:0.85] dark:[--art-opacity:0.7]"
);

/**
 * Both directions are linear and equally long, so at every instant the two
 * layers' opacities sum to the resting one and the field never dips to show
 * the surface through. The arrival is markedly slower than the accent's: the
 * layer is a bitmap that may still be loading, and a long fade covers the load
 * instead of snapping once the image lands.
 */
const ART_IN = { ...FADE.arrive, ease: "linear" } as const;
const ART_OUT = { duration: FADE.arrive.duration, ease: "linear" } as const;

const SCRIM_BASE = "pointer-events-none absolute inset-0 -z-1";

/**
 * The legibility floor. The card is small enough that every part of it sits
 * under type, so unlike the masthead's scrim this one holds a floor across the
 * whole surface, deepening toward the base where the transport sits. A screen
 * of type wants a flatter floor: it is already dense enough that a gradient
 * steep enough for the card would bury the artwork it is drawn over.
 */
const SCRIMS: Record<PlayerSize, string> = {
  card: "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--paper)_40%,transparent)_0%,color-mix(in_oklab,var(--paper)_58%,transparent)_34%,color-mix(in_oklab,var(--paper)_74%,transparent)_62%,color-mix(in_oklab,var(--paper)_82%,transparent)_100%),linear-gradient(to_right,color-mix(in_oklab,var(--art-glow)_18%,transparent),transparent_70%)]",
  full: "bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--paper)_55%,transparent)_0%,color-mix(in_oklab,var(--paper)_70%,transparent)_100%),linear-gradient(to_right,color-mix(in_oklab,var(--art-glow)_18%,transparent),transparent_70%)]",
};

/**
 * The playing track's cover as the ground of a player surface, under a scrim
 * that keeps the type on top of it legible.
 *
 * A track change cross-fades because presence holds the outgoing cover on the
 * surface while the incoming one arrives over it: `background-image` cannot
 * animate, and a single layer would only fade the new cover in over the
 * surface's flat ground.
 */
export function ArtField({
  cover,
  scrim,
  field,
}: {
  cover: string | null;
  scrim: PlayerSize;
  /** Rendered after the cover layers and before the scrim — e.g. the
   *  now-playing sheet's lava field. */
  field?: ReactNode;
}) {
  return (
    <>
      {/* The first cover fades in as well: the field is the ground the surface
          arrives on, and a bitmap cutting in under it would read as a flash. */}
      <AnimatePresence>
        <m.span
          key={cover ?? "none"}
          className={ART_LAYER}
          initial={{ opacity: 0 }}
          animate={{ opacity: "var(--art-opacity)", transition: ART_IN }}
          exit={{ opacity: 0, transition: ART_OUT }}
          style={
            {
              "--art-image": cover ? `url("${imageUrl(cover, 256)}")` : "none",
            } as CSSProperties
          }
          aria-hidden
        />
      </AnimatePresence>
      {field}
      <span className={cn(SCRIM_BASE, SCRIMS[scrim])} aria-hidden />
    </>
  );
}
