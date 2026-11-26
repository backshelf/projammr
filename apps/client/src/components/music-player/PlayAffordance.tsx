"use client";

import { DownloadAssetDialog } from "@/components/uploads/DownloadAssetDialog";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import { usePlayback } from "@/components/music-player/use-playback";
import { PlayGlyph } from "@/components/music-player/PlayGlyph";
import { IconDotsVertical, IconDownload, IconTrash } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useState } from "react";

export function PlayAffordance({
  kind,
  id,
  title,
  collectionId,
  playable,
  className,
  menuClassName,
  hero = false,
  onDelete,
  deleteLabel = "Delete",
}: {
  kind: "track" | "collection";
  id: number;
  title?: string;
  collectionId?: number;
  playable?: MusicPlayerTrack;
  className?: string;
  /** Extra classes for the options (dots) button — e.g. hover-reveal. */
  menuClassName?: string;
  /**
   * A page's own transport rather than one row of many: on a coarse pointer
   * the marks themselves grow to 44px instead of relying on the halo.
   */
  hero?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const { showPause, loading, toggle, playInContext, queueNext, queueLast } =
    usePlayback({ kind, id, title, collectionId, playable });
  const size = useCoarsePointer() && hero ? "touch" : "default";
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        className={cn("group/play flex items-center", className)}
        // The hover-revealed treatment on a table row must not hide the control
        // for the row that is actually playing, or the one whose menu is open.
        data-active={showPause || menuOpen || undefined}
      >
        <IconButton
          variant="play"
          size={size}
          aria-label={`${showPause ? "Pause" : "Play"} ${title ?? kind}`}
          disabled={loading}
          onClick={() => void toggle()}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          <PlayGlyph playing={showPause} loading={loading} />
        </IconButton>
        <DropdownMenuTrigger asChild>
          <IconButton
            size={size}
            className={menuClassName}
            aria-label="Playback options"
            disabled={loading}
          >
            <IconDotsVertical />
          </IconButton>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void playInContext()}>
          {kind === "collection"
            ? "Play collection"
            : collectionId !== undefined
              ? "Play from here"
              : "Play"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void queueNext()}>
          Play next
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void queueLast()}>
          {kind === "collection" ? "Queue collection" : "Add to queue"}
        </DropdownMenuItem>
        {playable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDownloadOpen(true)}>
              <IconDownload />
              Download
            </DropdownMenuItem>
          </>
        )}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete()}>
              <IconTrash />
              {deleteLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      {playable && (
        <DownloadAssetDialog
          assetId={playable.asset.id}
          assetPath={playable.asset.assetPath}
          fileName={playable.asset.name}
          open={downloadOpen}
          onOpenChange={setDownloadOpen}
        />
      )}
    </DropdownMenu>
  );
}
