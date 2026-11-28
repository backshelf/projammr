import type { Artwork } from "@workspace/api/api";
import { artVarsFromAccent, type ArtVars } from "@workspace/ui/lib/art";
import { imageUrl } from "./utils";

/**
 * The custom properties for one cover, as the API resolved it. A null
 * `accentHue` means the extractor found no usable chroma, so the page stays
 * grayscale.
 */
export function artVarsFromArtwork(
  artwork: Artwork | null | undefined
): ArtVars {
  return artVarsFromAccent(
    artwork?.accentHue,
    artwork?.accentChroma,
    artwork ? imageUrl(artwork.assetPath, 256) : null
  );
}

/**
 * Returns `artwork` only when it differs from a parent's fallback image path.
 * Sidebar rows use this so entities inheriting the project cover render as a
 * neutral hairline instead of repeating the project's hue down the whole list.
 */
export function distinctArtwork(
  artwork: Artwork | null | undefined,
  fallbackImage: string | null | undefined
): Artwork | null {
  if (!artwork) return null;
  if (fallbackImage && artwork.assetPath === fallbackImage) return null;
  return artwork;
}
