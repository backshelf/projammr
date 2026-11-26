"use client";
import { ArtSwatch } from "@/components/art/ArtSwatch";
import { AppLink } from "@/components/navigation/AppLink";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useState } from "react";

/** One collection in the sidebar: a link, and its tracks behind a disclosure. */
export function SidebarCollectionItem({
  collection,
  projectId,
  swatch = null,
}: {
  collection: CollectionSummary;
  projectId: number;
  /** The collection's own artwork. Its tracks carry theirs, falling back to
   *  this collection's. */
  swatch?: Artwork | null;
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

  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1">
          <CollapsibleTrigger
            className="flex items-center"
            aria-label={
              open
                ? `Collapse ${collection.title}`
                : `Expand ${collection.title}`
            }
          >
            <CollapsibleChevron />
          </CollapsibleTrigger>
          <SidebarMenuButton asChild>
            <AppLink
              href={hrefFromParsedRoute(
                { kind: "collection", collectionId: collection.id },
                projectId
              )}
              title={collection.title}
              className={"flex items-center gap-2 truncate"}
            >
              <ArtSwatch artwork={swatch} />
              <span className={"truncate"}>{collection.title}</span>
            </AppLink>
          </SidebarMenuButton>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub>
            {tracks === null ? (
              <SidebarMenuSubItem>
                <Spinner className="w-4" />
              </SidebarMenuSubItem>
            ) : (
              tracks.map((track) => (
                <SidebarMenuSubItem key={track.id}>
                  <SidebarMenuSubButton asChild>
                    <AppLink
                      href={hrefFromParsedRoute(
                        {
                          kind: "track",
                          trackId: track.id,
                          collectionId: collection.id,
                        },
                        projectId
                      )}
                      title={track.title}
                      className="flex items-center gap-2 truncate text-ink-soft hover:text-ink"
                    >
                      <ArtSwatch artwork={track.artwork} />
                      <span className={"truncate"}>{track.title}</span>
                    </AppLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
