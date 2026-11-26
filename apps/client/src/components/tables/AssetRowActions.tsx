"use client";

import {
  AssetProvenancePopover,
  useMenuDetails,
} from "@/components/attachments/AssetProvenance";
import { DownloadAssetDialog } from "@/components/uploads/DownloadAssetDialog";
import { usePlayerActions } from "@/components/music-player/player-hooks";
import type { MusicPlayerTrack } from "@/components/music-player/types";
import {
  IconDotsVertical,
  IconDownload,
  IconInfoCircle,
  IconPlayerPlayFilled,
  IconTrash,
} from "@tabler/icons-react";
import type { AssetWithContext } from "@workspace/api/api";
import { isAudioFileName } from "@workspace/api/lib/upload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconButton } from "@workspace/ui/components/icon-button";
import { rowPlay, rowPlayAlways } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

import { useSetting } from "@/lib/settings/provider";
import { useRequestRowDelete } from "./row-delete";

/**
 * The files table's leading cell: playback for an audio asset, and the menu
 * covering download, queueing and deletion. Deletion runs through the table's
 * confirmation dialog so a one-row delete and a bulk one take the same path.
 */
export function AssetRowActions({
  asset,
  projectId,
}: {
  asset: AssetWithContext;
  projectId: number;
}) {
  const { playNow, playNext, enqueue } = usePlayerActions();
  const requestDelete = useRequestRowDelete();
  const hoverPlay = useSetting("tables.hoverPlay");
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const {
    detailsOpen,
    setDetailsOpen,
    chooseDetails,
    onMenuOpenChangeComplete,
  } = useMenuDetails();

  const isAudio = isAudioFileName(asset.name);
  const playable: MusicPlayerTrack[] = [
    { asset, ownerType: "project", ownerId: projectId, projectId },
  ];

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onOpenChangeComplete={onMenuOpenChangeComplete}
    >
      <div
        className={cn(
          "group/play flex items-center",
          hoverPlay === "always" ? rowPlayAlways : rowPlay
        )}
        data-active={menuOpen || detailsOpen || undefined}
      >
        {isAudio && (
          <IconButton
            variant="play"
            aria-label={`Play ${asset.name}`}
            onClick={() => playNow(playable)}
          >
            <IconPlayerPlayFilled />
          </IconButton>
        )}
        <AssetProvenancePopover
          asset={asset}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        >
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={`Options for ${asset.name}`}>
              <IconDotsVertical />
            </IconButton>
          </DropdownMenuTrigger>
        </AssetProvenancePopover>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setDownloadOpen(true)}>
          <IconDownload />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={chooseDetails}>
          <IconInfoCircle />
          Details
        </DropdownMenuItem>
        {isAudio && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => playNow(playable)}>
              Play
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => playNext(playable)}>
              Play next
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => enqueue(playable)}>
              Add to queue
            </DropdownMenuItem>
          </>
        )}
        {requestDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => requestDelete([asset.id], `"${asset.name}"`)}
            >
              <IconTrash />
              Delete file
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      <DownloadAssetDialog
        assetId={asset.id}
        assetPath={asset.assetPath}
        fileName={asset.name}
        allowConvert={isAudio}
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
      />
    </DropdownMenu>
  );
}
