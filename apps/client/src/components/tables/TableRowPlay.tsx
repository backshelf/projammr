"use client";

import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import { useSetting } from "@/lib/settings/provider";
import { rowPlay, rowPlayAlways } from "@workspace/ui/components/table";

/**
 * The leading play column's transport control for a top-level row. Queueing,
 * download and delete live in the row's single trailing action menu rather than
 * a second overflow button here.
 */
export function TableRowPlay({
  kind,
  id,
  title,
  collectionId,
}: {
  kind: "track" | "collection";
  id: number;
  title: string;
  /** The collection a track is listed inside, for contextual playback. */
  collectionId?: number;
}) {
  const hoverPlay = useSetting("tables.hoverPlay");
  return (
    <PlayAffordance
      kind={kind}
      id={id}
      title={title}
      collectionId={collectionId}
      hideMenu
      className={hoverPlay === "always" ? rowPlayAlways : rowPlay}
    />
  );
}
