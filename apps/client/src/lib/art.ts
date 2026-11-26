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
