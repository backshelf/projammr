"use client";
import { deleteAsset } from "@/actions/assets";
import { linkTrackAudios } from "@/actions/track-audios";
import {
  AssetProvenanceNote,
  AssetProvenancePopover,
  provenanceLine,
  useMenuDetails,
} from "@/components/attachments/AssetProvenance";
import { ProvenanceGlyph } from "@/components/attachments/ProvenanceGlyph";
import { usePlayerActions } from "@/components/music-player/player-hooks";
import { DownloadAssetDialog } from "@/components/uploads/DownloadAssetDialog";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { mediaProxyUrl } from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  IconDotsVertical,
  IconDownload,
  IconFile,
  IconInfoCircle,
  IconMusic,
  IconMusicPlus,
  IconPlayerPlayFilled,
  IconTrash,
} from "@tabler/icons-react";
import type { AttachedAsset } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { isAudioFileName } from "@workspace/api/lib/upload";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { FingerprintMark } from "@workspace/ui/components/fingerprint-mark";
import { IconButton } from "@workspace/ui/components/icon-button";
import { rowPlay } from "@workspace/ui/components/table";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import Image from "next/image";
import { type FocusEvent, useState } from "react";
import { toast } from "sonner";

/** A file on the spine: a hairline under it rather than a card around it. */
export const TILE =
  "group/row flex h-full items-start gap-3 border-b border-rule py-3";
/** The leading kind slot: an image's thumbnail, or a bare glyph for audio and other files. */
export const TILE_KIND =
  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm text-ink-soft [&_svg]:size-5";
/** The file name wraps rather than truncating; it is how two bounces are told apart. */
export const TILE_NAME = "text-small text-ink [overflow-wrap:anywhere]";

/**
 * One attached file: its kind, name, where it came from, its fingerprint mark
 * and size, with playback and a menu of what can be done with it. Hovering or
 * focusing the tile shows the provenance note; Details in the menu opens the
 * same facts in a popover, which is the path on touch and for anything to act
 * on.
 */
export const AppAttachment = ({
  asset,
  attachTo,
  parentId,
  trackId,
}: {
  asset: AttachedAsset;
  attachTo: "project" | "collection" | "track" | "session";
  parentId: number;
  trackId?: number | null;
}) => {
  const { playNow, playNext, enqueue } = usePlayerActions();
  const format = useFormat();
  const [deleting, setDeleting] = useState(false);
  const [addingAudio, setAddingAudio] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    detailsOpen,
    setDetailsOpen,
    chooseDetails,
    onMenuOpenChangeComplete,
  } = useMenuDetails();
  const [noteAnchor, setNoteAnchor] = useState<HTMLElement | null>(null);
  // Set once the menu has opened or Escape was pressed, so focus coming back
  // to the tile from an overlay does not bring the note back with it; cleared
  // when the pointer or focus leaves the tile.
  const [noteQuiet, setNoteQuiet] = useState(false);

  const isAudio = isAudioFileName(asset.name);
  const isImage = asset.name.endsWith(".png") || asset.name.endsWith(".jpg");
  const playable = [{ asset, ownerType: attachTo, ownerId: parentId }];
  const busy = deleting || addingAudio;
  const overlayOpen = menuOpen || detailsOpen || downloadOpen;
  const note = noteQuiet || overlayOpen || deleting ? null : noteAnchor;

  const audioTrackId =
    attachTo === "track" ? parentId : attachTo === "session" ? trackId : null;

  const handleAddAsTrackAudio = async () => {
    if (audioTrackId == null) return;
    setAddingAudio(true);
    try {
      const result = await linkTrackAudios(audioTrackId, [asset.id]);
      if (isActionError(result)) toast.error(result.error);
      else toast.success("Added as track audio");
    } finally {
      setAddingAudio(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteAsset(asset.id);
    if (isActionError(result)) {
      toast.error(result.error);
      setDeleting(false);
      return;
    }
  };
  const deletion = useDeleteGate("attachment", handleDelete);

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) setNoteQuiet(true);
  };

  const leaveNote = () => {
    setNoteAnchor(null);
    setNoteQuiet(false);
  };

  // Focus inside the menu, the popover or a dialog reaches these handlers
  // through React's portals too; only the tile's own DOM counts as the tile.
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.target)) {
      setNoteAnchor(event.currentTarget);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (overlayOpen || event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    leaveNote();
  };

  return (
    <div
      className={TILE}
      data-state={busy ? "processing" : "done"}
      aria-busy={busy || undefined}
      onPointerEnter={(event) => setNoteAnchor(event.currentTarget)}
      onPointerLeave={leaveNote}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === "Escape") setNoteQuiet(true);
      }}
    >
      <div className={TILE_KIND}>
        {isImage ? (
          <Image
            src={mediaProxyUrl(asset.assetPath)}
            alt=""
            width={40}
            height={40}
            className="size-full object-cover"
          />
        ) : isAudio ? (
          <IconMusic aria-hidden />
        ) : (
          <IconFile aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={cn(TILE_NAME, busy && "shimmer")}>{asset.name}</p>
        <div className="flex items-center gap-2">
          <ProvenanceGlyph asset={asset} />
          <p
            className={cn(
              LABEL,
              "min-w-0 [overflow-wrap:anywhere] text-ink-soft"
            )}
          >
            {provenanceLine(asset)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-micro text-ink-soft tabular-nums">
          <FingerprintMark
            fingerprint={asset.fingerprint}
            className="text-ink-faint"
          />
          <span className="whitespace-nowrap">{format.bytes(asset.size)}</span>
        </div>
      </div>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={handleMenuOpenChange}
        onOpenChangeComplete={onMenuOpenChangeComplete}
      >
        <div
          className={cn("group/play flex items-center", rowPlay)}
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
              <IconButton
                aria-label={`Options for ${asset.name}`}
                disabled={deleting}
              >
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
          <DropdownMenuSeparator />
          {isAudio && (
            <>
              <DropdownMenuItem onSelect={() => playNow(playable)}>
                Play
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => playNext(playable)}>
                Play next
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => enqueue(playable)}>
                Add to queue
              </DropdownMenuItem>
              {audioTrackId != null && (
                <DropdownMenuItem
                  disabled={addingAudio}
                  onSelect={handleAddAsTrackAudio}
                >
                  <IconMusicPlus />
                  Add as track audio
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={deleting}
            onSelect={() => deletion.request()}
          >
            <IconTrash />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AssetProvenanceNote asset={asset} anchor={note} />
      <DownloadAssetDialog
        assetId={asset.id}
        assetPath={asset.assetPath}
        fileName={asset.name}
        allowConvert={isAudio}
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
      />
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete ${asset.name}?`}
        description="The file comes off everything it is attached to, and any track version made from it goes too."
        confirmLabel="Delete file"
      />
    </div>
  );
};
