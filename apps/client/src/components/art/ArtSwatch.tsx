import type { CSSProperties } from "react";
import type { Artwork } from "@workspace/api/api";
import { artVarsFromArtwork } from "@/lib/art";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A small accent chip standing in for an item's artwork.
 *
 * The colour is the item's own extracted accent rather than the surrounding
 * page's: each chip carries its accent as a local `--art-light` / `--art-dark`
 * pair (never `--art` inline — that would pin it to one theme), which the
 * rules in `globals.css` resolve to `--art` for whichever theme is active, so
 * a list of them reads as a column of covers. Items with no usable artwork
 * fall back to the grayscale accent, which keeps the row rhythm intact instead
 * of leaving a hole.
 */
export function ArtSwatch({
  artwork,
  className,
}: {
  artwork: Artwork | null;
  className?: string;
}) {
  const { "--art-light": artLight, "--art-dark": artDark } =
    artVarsFromArtwork(artwork);

  return (
    <span
      aria-hidden
      data-slot="art-swatch"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-[0.1875rem] bg-art",
        "shadow-[0_0_0_1px_color-mix(in_oklab,var(--ink)_12%,transparent)]",
        className
      )}
      style={
        {
          "--art-light": artLight,
          "--art-dark": artDark,
        } as CSSProperties
      }
    />
  );
}
