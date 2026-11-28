"use client";
import { ArtSwatch } from "@/components/art/ArtSwatch";
import {
  SidebarNavLink,
  SidebarSubNavLink,
} from "@/components/sidebar/SidebarNavLink";
import { distinctArtwork } from "@/lib/art";
import { clientGetCollectionTrackSummaries } from "@/lib/client-api";
import { onInvalidated } from "@/lib/mutation";
import { hrefFromParsedRoute } from "@/lib/utils";
import type {
  Artwork,
  CollectionSummary,
  CollectionTrackSummary,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar";
import { useEffect, useState } from "react";

/** One collection in the sidebar: a link, and its tracks behind a disclosure. */
export function SidebarCollectionItem({
  collection,
  projectId,
  swatch = null,
  projectImage = null,
}: {
  collection: CollectionSummary;
  projectId: number;
  /** The collection's own distinct artwork (null when inheriting the project cover). */
  swatch?: Artwork | null;
  /** Project cover key, used to suppress redundant fallback hues on nested tracks. */
  projectImage?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<CollectionTrackSummary[] | null>(null);

  // A project can hold hundreds of collections, so their tracks are fetched
  // the first time one is opened rather than with the sidebar itself.
  useEffect(() => {
    if (!open || tracks) return;

    let cancelled = false;
    clientGetCollectionTrackSummaries(collection.id).then((result) => {
      if (cancelled) return;
      setTracks(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [open, tracks, collection.id]);

  // A link or unlink elsewhere invalidates this collection's tracks; clearing
  // them lets the effect above refetch while the item stays open.
  useEffect(
    () => onInvalidated("collection-tracks", () => setTracks(null)),
    []
  );

  const parentImage = collection.artwork?.assetPath ?? projectImage;

  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-0.5 pr-0.5">
          <SidebarNavLink
            href={hrefFromParsedRoute(
              { kind: "collection", collectionId: collection.id },
              projectId
            )}
            title={collection.title}
            className={"min-w-0 flex-1 pr-1"}
          >
            <ArtSwatch artwork={swatch} variant="spine" />
            <span className={"truncate"}>{collection.title}</span>
          </SidebarNavLink>
          <CollapsibleTrigger
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-faint motion-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 focus-visible:outline-hidden"
            aria-label={
              open
                ? `Collapse ${collection.title}`
                : `Expand ${collection.title}`
            }
          >
            <CollapsibleChevron />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub>
            {tracks === null ? (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-micro text-ink-faint">
                  Loading…
                </span>
              </SidebarMenuSubItem>
            ) : tracks.length === 0 ? (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-micro text-ink-faint">
                  No tracks
                </span>
              </SidebarMenuSubItem>
            ) : (
              tracks.map((track) => (
                <SidebarMenuSubItem key={track.id}>
                  <SidebarSubNavLink
                    href={hrefFromParsedRoute(
                      {
                        kind: "track",
                        trackId: track.id,
                        collectionId: collection.id,
                      },
                      projectId
                    )}
                    title={track.title}
                  >
                    <ArtSwatch
                      artwork={distinctArtwork(track.artwork, parentImage)}
                      variant="spine"
                    />
                    <span className={"truncate"}>{track.title}</span>
                  </SidebarSubNavLink>
                </SidebarMenuSubItem>
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
