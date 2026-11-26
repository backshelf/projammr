"use client";

import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import { useSetting } from "@/lib/settings/provider";
import { rowPlay, rowPlayAlways } from "@workspace/ui/components/table";
import { useRequestRowDelete } from "./row-delete";

/**
 * The play column's affordance for a top-level row: playback controls plus a
 * delete entry that runs through the table's own confirmation dialog.
 */
export function TableRowPlay({
  kind,
  id,
  title,
  deleteLabel,
}: {
  kind: "track" | "collection";
  id: number;
  title: string;
  deleteLabel: string;
}) {
  const requestDelete = useRequestRowDelete();
  const hoverPlay = useSetting("tables.hoverPlay");
  return (
    <PlayAffordance
      kind={kind}
      id={id}
      title={title}
      deleteLabel={deleteLabel}
      className={hoverPlay === "always" ? rowPlayAlways : rowPlay}
      onDelete={
        requestDelete ? () => requestDelete([id], `"${title}"`) : undefined
      }
    />
  );
}
