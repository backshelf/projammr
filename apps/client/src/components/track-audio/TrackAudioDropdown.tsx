"use client";

import { setPrimaryTrackAudio } from "@/actions/track-audios";
import { BottomSheet, SHEET_ROW } from "@/components/dock/BottomSheet";
import { DuplicateFlag } from "@/components/track-audio/DuplicateFlag";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import {
  byNewest,
  duplicateOfVersion,
  fromCommitLabel,
  primaryStarLabel,
  versionRowLine,
} from "@/components/track-audio/version-rows";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconButton } from "@workspace/ui/components/icon-button";
import { SheetClose } from "@workspace/ui/components/sheet";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

const MANAGE_LABEL = "Manage track audios…";

/**
 * What one version says of itself: its badge, its filename, and the loudness
 * and date beside them. One line in the menu; stacked into two where a row is
 * touch-sized and the filename needs the width to itself.
 */
function VersionRowBody({
  audio,
  selected,
  duplicateVersion,
  stacked,
}: {
  audio: TrackAudioWithAsset;
  selected: boolean;
  /** The version this one's fingerprint matches, or null. */
  duplicateVersion: number | null;
  stacked?: boolean;
}) {
  const format = useFormat();
  const name = (
    <>
      <VersionBadge version={audio.version} active={selected} />
      {duplicateVersion != null && (
        <DuplicateFlag version={duplicateVersion} className="flex-none" />
      )}
      <span className="min-w-0 flex-1 truncate">{audio.asset.name}</span>
    </>
  );
  const meta = (
    <span
      className={cn(
        "text-micro text-ink-soft tabular-nums",
        !stacked && "shrink-0"
      )}
    >
      {versionRowLine(audio, format)}
    </span>
  );

  const from = fromCommitLabel(audio.bouncedFrom);
  const fromLine = from && (
    <span className="min-w-0 truncate text-micro text-ink-soft">{from}</span>
  );

  if (!stacked && !fromLine)
    return (
      <>
        {name}
        {meta}
      </>
    );

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2.5">{name}</span>
      {meta}
      {fromLine}
    </span>
  );
}

/** Everything the star carries in either shell but its size and its mark. */
function starProps(audio: TrackAudioWithAsset, promoting: number | null) {
  return {
    "aria-label": primaryStarLabel(audio.version, audio.isPrimary),
    "aria-pressed": audio.isPrimary,
    disabled: audio.isPrimary || promoting !== null,
  };
}

function StarMark({
  isPrimary,
  className,
}: {
  isPrimary: boolean;
  className?: string;
}) {
  return isPrimary ? (
    <IconStarFilled className={className} />
  ) : (
    <IconStar className={className} />
  );
}

type VersionShellProps = {
  versions: TrackAudioWithAsset[];
  selectedAudioId: number;
  onSelect: (audioId: number) => void;
  onManage?: () => void;
  promoting: number | null;
  promote: (audioId: number) => void;
  /** What opens the list, from the caller. */
  trigger: React.ReactNode;
};

/** Matches the comments popover: mono, accent-marked selection, hairline
 *  rules. The star is a mark inside the row a pointer already hovers. */
function VersionMenu({
  versions,
  selectedAudioId,
  onSelect,
  onManage,
  promoting,
  promote,
  trigger,
}: VersionShellProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[min(24rem,calc(100vw-3rem))] p-0 font-mono"
      >
        <div className="max-h-80 overflow-y-auto py-1">
          {versions.map((audio) => (
            <DropdownMenuItem
              key={audio.id}
              onSelect={() => onSelect(audio.id)}
              aria-current={audio.id === selectedAudioId}
              className={cn(
                "flex items-center gap-2.5 rounded-none border-l-2 border-transparent",
                "px-2 py-[0.4375rem] pl-2.5 text-micro text-ink-soft",
                audio.id === selectedAudioId && "border-l-art text-ink"
              )}
            >
              <VersionRowBody
                audio={audio}
                selected={audio.id === selectedAudioId}
                duplicateVersion={duplicateOfVersion(
                  audio.duplicateOfId,
                  versions
                )}
              />
              <button
                type="button"
                {...starProps(audio, promoting)}
                className={cn(
                  "relative grid shrink-0 cursor-pointer place-items-center rounded-sm border-none",
                  "bg-transparent p-[0.1875rem] text-ink-soft motion-ink",
                  // The star stays a 20px mark; a finger gets the reach.
                  "coarse:after:absolute coarse:after:-inset-2 coarse:after:content-['']",
                  "not-disabled:hover:text-art",
                  audio.isPrimary && "text-art"
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!audio.isPrimary) promote(audio.id);
                }}
              >
                <StarMark isPrimary={audio.isPrimary} className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
        </div>
        {onManage && (
          <>
            <DropdownMenuSeparator className="my-0" />
            <DropdownMenuItem
              onSelect={onManage}
              className="m-1 rounded-sm font-mono text-micro text-ink-soft"
            >
              {MANAGE_LABEL}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same list on a phone: rows a thumb can hit, rising from the bottom edge
 * rather than over the transport that opened them. Choosing a version closes
 * the sheet; the star sits beside the row rather than inside it, so promoting
 * a version neither switches to it nor dismisses the list.
 */
function VersionSheet({
  versions,
  selectedAudioId,
  onSelect,
  onManage,
  promoting,
  promote,
  trigger,
}: VersionShellProps) {
  return (
    <BottomSheet title="Versions" trigger={trigger}>
      {versions.map((audio) => {
        const selected = audio.id === selectedAudioId;
        return (
          <div key={audio.id} className="flex items-center gap-1 pr-4">
            <SheetClose
              className={cn(
                SHEET_ROW,
                "min-w-0 flex-1 border-l-2 border-transparent py-2 pr-0 font-mono",
                selected ? "border-l-art text-ink" : "text-ink-soft"
              )}
              aria-current={selected}
              onClick={() => onSelect(audio.id)}
            >
              <VersionRowBody
                audio={audio}
                selected={selected}
                duplicateVersion={duplicateOfVersion(
                  audio.duplicateOfId,
                  versions
                )}
                stacked
              />
            </SheetClose>
            <IconButton
              size="touch"
              {...starProps(audio, promoting)}
              className={audio.isPrimary ? "text-art" : undefined}
              onClick={() => promote(audio.id)}
            >
              <StarMark isPrimary={audio.isPrimary} />
            </IconButton>
          </div>
        );
      })}
      {onManage && (
        <SheetClose
          className={cn(SHEET_ROW, "border-t border-rule text-ink-soft")}
          onClick={onManage}
        >
          {MANAGE_LABEL}
        </SheetClose>
      )}
    </BottomSheet>
  );
}

/**
 * The track's versions, from the trigger the caller gives: a menu under a
 * pointer, a bottom sheet on a phone.
 */
export function TrackAudioDropdown({
  audios,
  selectedAudioId,
  onSelect,
  onManage,
  children,
}: {
  audios: TrackAudioWithAsset[];
  selectedAudioId: number;
  onSelect: (audioId: number) => void;
  /** Offers "Manage track audios…" below the list when given. */
  onManage?: () => void;
  children: React.ReactNode;
}) {
  const [promoting, setPromoting] = useState<number | null>(null);
  const isPhone = useIsMobile();

  const promote = async (audioId: number) => {
    setPromoting(audioId);
    const result = await setPrimaryTrackAudio(audioId);
    setPromoting(null);

    if (isActionError(result)) {
      toast.error(`Couldn't set primary version: ${result.error}`);
      return;
    }
  };

  const shell = {
    versions: byNewest(audios),
    selectedAudioId,
    onSelect,
    onManage,
    promoting,
    promote,
    trigger: children,
  };

  return isPhone ? <VersionSheet {...shell} /> : <VersionMenu {...shell} />;
}
