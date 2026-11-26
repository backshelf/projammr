"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { compareHref, type LogSave } from "@workspace/ui/lib/commit-log";

/**
 * Why a save's set cannot be downloaded, or null when it can. A pruned save's
 * content was dropped by retention and never returns; the message names the
 * instance's retention days, which every member is told with the session.
 */
export function unavailableReason(
  contentState: LogSave["contentState"],
  retentionDays: number
): string | null {
  if (contentState === "stored") return null;
  if (contentState === "pruned") {
    return `Content of uncommitted saves is kept for ${retentionDays} days; this one has expired.`;
  }
  return "This save was recorded without its content, so there is no set to download.";
}

/** Compare's tooltip: what the row is compared with. */
export function saveCompareTip(save: LogSave): string {
  return save.previousId != null
    ? "Compare with the save before it"
    : "Show what this save holds";
}

/** Download set's tooltip: the machine the save was made on, when it is known. */
export function saveDownloadTip(save: LogSave): string {
  return save.machineName
    ? `Download the set saved on ${save.machineName}`
    : "Download the set of this save";
}

/**
 * What a save row offers: Compare (with the save before it) and Download set,
 * which is disabled with the reason when the hub no longer holds the content.
 * A pruned save still compares: its chips and place stay. `historyHref` is the
 * history page's address as it is shown, so a compare keeps its query.
 */
export function SaveRowActions({
  save,
  historyHref,
  retentionDays,
}: {
  save: LogSave;
  historyHref: string;
  retentionDays: number;
}) {
  const reason = unavailableReason(save.contentState, retentionDays);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="xs" asChild>
            <AppLink
              href={compareHref(historyHref, save.previousId, save.id)}
              scroll={false}
            >
              Compare
            </AppLink>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{saveCompareTip(save)}</TooltipContent>
      </Tooltip>
      {reason == null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="xs" asChild>
              <a href={`/api/saves/${save.id}/set`} download>
                Download set
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{saveDownloadTip(save)}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="xs"
                disabled
                aria-label="Download set, unavailable"
              >
                Download set
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      )}
    </TooltipProvider>
  );
}
