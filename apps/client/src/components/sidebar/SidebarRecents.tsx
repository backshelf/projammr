"use client";

import {
  RecentlyEdited,
  type RecentItem,
} from "@/components/sidebar/RecentlyEdited";
import { SidebarCollectionItem } from "@/components/sidebar/SidebarCollectionItem";
import {
  orderCollections,
  recentNotes,
  recentSessions,
  recentTracks,
} from "@/components/sidebar/sidebar-lists";
import { useShellPolicy } from "@/lib/policies/provider";
import type { CollectionSummary } from "@workspace/api/api";
import { SidebarMenu } from "@workspace/ui/components/sidebar";

type ListProps = { hrefAll: string; allLabel: string };

/**
 * The sidebar's recents and collection lists. The server hands each one its
 * whole list; the count, the skipping of archived items and the collection
 * order come from the shell policy here, so a change to the setting applies
 * at once instead of on the next server render.
 */
export function SidebarRecentTracks({
  tracks,
  ...list
}: ListProps & {
  tracks: (RecentItem & { archivedAt: string | null })[];
}) {
  const items = recentTracks(tracks, useShellPolicy());
  return <RecentlyEdited items={items} {...list} />;
}

export function SidebarRecentSessions({
  sessions,
  ...list
}: ListProps & { sessions: (RecentItem & { archived: boolean })[] }) {
  const items = recentSessions(sessions, useShellPolicy());
  return <RecentlyEdited items={items} {...list} />;
}

export function SidebarRecentNotes({
  notes,
  ...list
}: ListProps & { notes: (RecentItem & { updatedAt: string })[] }) {
  const items = recentNotes(notes, useShellPolicy());
  return <RecentlyEdited items={items} {...list} />;
}

export function SidebarCollections({
  collections,
  projectId,
}: {
  collections: CollectionSummary[];
  projectId: number;
}) {
  const { sidebarCollectionOrder } = useShellPolicy();
  return (
    <SidebarMenu>
      {orderCollections(collections, sidebarCollectionOrder).map(
        (collection) => (
          <SidebarCollectionItem
            key={collection.id}
            collection={collection}
            projectId={projectId}
            swatch={collection.artwork}
          />
        )
      )}
    </SidebarMenu>
  );
}
