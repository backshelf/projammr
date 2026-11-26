"use client";

import type { PaletteRecents } from "@/components/command-palette/CommandPalette";
import type { SettingResult } from "@/components/command-palette/settings-results";
import { usePublishCommandContext } from "@/components/commands/provider";
import {
  recentSessions,
  recentTracks,
} from "@/components/sidebar/sidebar-lists";
import { useShellPolicy } from "@/lib/policies/provider";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const CommandPalette = dynamic(
  () =>
    import("@/components/command-palette/CommandPalette").then(
      (mod) => mod.CommandPalette
    ),
  { ssr: false }
);

/** What the server hands over: the project's whole track and session lists,
 *  newest first, which the shell policy slices here. */
export type UnslicedPaletteRecents = Omit<
  PaletteRecents,
  "tracks" | "sessions"
> & {
  tracks: (PaletteRecents["tracks"][number] & { archivedAt: string | null })[];
  sessions: (PaletteRecents["sessions"][number] & { archived: boolean })[];
};

/**
 * Mounts the command palette on the client only. The palette renders nothing
 * until opened, so the browser never needs server-rendered markup for it —
 * this keeps cmdk, the prefix-command machinery and `collection-op.ts` out of
 * every page's first-load bundle.
 *
 * The recents are sliced here rather than on the server, so the shell policy's
 * count and archived-skipping apply as the setting changes.
 */
export function CommandPaletteMount({
  recents,
  settings,
}: {
  recents?: UnslicedPaletteRecents;
  settings?: readonly SettingResult[];
}) {
  const shell = useShellPolicy();
  const sliced = useMemo<PaletteRecents | undefined>(
    () =>
      recents && {
        ...recents,
        tracks: recentTracks(recents.tracks, shell).map(({ id, title }) => ({
          id,
          title,
        })),
        sessions: recentSessions(recents.sessions, shell).map(
          ({ id, name, trackId }) => ({ id, name, trackId })
        ),
      },
    [recents, shell]
  );
  usePublishCommandContext(sliced ?? null);
  return <CommandPalette recents={sliced} settings={settings} />;
}
