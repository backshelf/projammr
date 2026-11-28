import type { CSSProperties } from "react";
import type { Artwork } from "@workspace/api/api";
import { artVarsFromArtwork } from "@/lib/art";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A small artwork accent mark standing in for an item's cover.
 *
 * The colour is the item's own extracted accent rather than the surrounding
 * page's: each mark carries its accent as a local `--art-light` / `--art-dark`
 * pair (never `--art` inline — that would pin it to one theme), which the
 * rules in `globals.css` resolve to `--art` for whichever theme is active.
 *
 * - `"swatch"` (default): 10px rounded square for palette results and pickers.
 * - `"spine"`: 2px vertical bar for sidebar rows; renders as a quiet neutral
 *   hairline when the item carries no distinct hue of its own.
 */
export function ArtSwatch({
  artwork,
  variant = "swatch",
  className,
}: {
  artwork: Artwork | null;
  variant?: "swatch" | "spine";
  className?: string;
}) {
  if (variant === "spine") {
    const hasHue = artwork?.accentHue != null;
    if (!hasHue) {
      return (
        <span
          aria-hidden
          data-slot="art-swatch"
          data-variant="spine"
          data-fallback=""
          className={cn(
            "inline-block h-3.5 w-0.5 shrink-0 rounded-full bg-rule-strong motion-ink",
            "group-hover/menu-button:bg-ink-faint group-data-[active=true]/menu-button:bg-ink-soft",
            className
          )}
        />
      );
    }

    const { "--art-light": artLight, "--art-dark": artDark } =
      artVarsFromArtwork(artwork);

    return (
      <span
        aria-hidden
        data-slot="art-swatch"
        data-variant="spine"
        className={cn(
          "inline-block h-3.5 w-0.5 shrink-0 rounded-full bg-art",
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

  const { "--art-light": artLight, "--art-dark": artDark } =
    artVarsFromArtwork(artwork);

  return (
    <span
      aria-hidden
      data-slot="art-swatch"
      data-variant="swatch"
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
