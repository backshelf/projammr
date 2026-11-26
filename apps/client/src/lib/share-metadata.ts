import { shareEntries } from "@/components/share/share-playables";
import { shareFacts, shareTitle } from "@/lib/share-links";
import type { Sharelink } from "@workspace/api/api";
import type { Metadata } from "next";

/** What a share that does not resolve unfurls as: a title and nothing to index. */
export const SHARE_UNAVAILABLE_METADATA: Metadata = {
  title: "This share link isn't available",
  robots: { index: false, follow: false },
};

/**
 * A share's unfurl. There is no `images` key on purpose: the poster route
 * beside the page is picked up by the file convention only while neither
 * `openGraph` nor `twitter` carries one.
 */
export function shareMetadata(sharelink: Sharelink, origin: string): Metadata {
  const title = shareTitle(sharelink);
  const description = shareFacts(sharelink);
  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: false },
  };
}

/**
 * The artwork the page lights itself with on arrival: the first playable
 * entry's, and none when that entry has no artwork of its own.
 */
export function posterCover(
  sharelink: Sharelink
): { trackAudioId: number } | null {
  const first = shareEntries(sharelink.token, sharelink.tracks)[0];
  if (!first?.playable.cover) return null;
  return { trackAudioId: first.trackAudioId };
}
