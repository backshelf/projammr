"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { useCopied } from "@/hooks/use-copied";
import { IconCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  compareHref,
  ditCheckoutCommand,
  type LogCommit,
} from "@workspace/ui/lib/commit-log";
import { offersSamplesZip, samplesIncluded } from "@/lib/sample-state";
import { useOpenDeepLink } from "@/components/deep-link/DeepLinkProvider";
import { restoreHref } from "@/components/session/open-in-daw";

/** What Restore says: it is disabled until a dit on this user's machines can answer that one is online. */
export const RESTORE_UNAVAILABLE = "Needs dit on this computer.";

/** The command's tooltip: where the copied line is meant to run. */
const COPY_HINT =
  "Run it in the project folder on a computer that has this repo.";

/** Compare's tooltip: what the row is compared with. */
export function commitCompareTip(commit: LogCommit): string {
  return commit.baselineSaveId != null
    ? `Compare with the commit before it on ${commit.branch}`
    : `Show what the first commit on ${commit.branch} holds`;
}

/** Download set's tooltip: the branch and machine the set comes from. */
export function commitDownloadTip(commit: LogCommit): string {
  const from = [commit.branch, commit.machineName]
    .filter((part) => part != null && part !== "")
    .join(" · ");
  return `Download the set from ${from}`;
}

/**
 * Restore on this computer: disabled, saying why. It would open
 * `projammr://dit/checkout/<id>` only once a dit on this user's machines can
 * answer that one is online, and none can. Hidden from a viewer, who cannot
 * restore.
 */
function RestoreButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
        >
          Restore on this computer
        </Button>
      </TooltipTrigger>
      <TooltipContent>{RESTORE_UNAVAILABLE}</TooltipContent>
    </Tooltip>
  );
}

/** Restore on the machine that tracks the repo: opens the checkout for the commit. */
function RestoreOnButton({
  commit,
  machine,
}: {
  commit: LogCommit;
  machine: string;
}) {
  const open = useOpenDeepLink();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => open(restoreHref(commit.id))}
        >
          Restore on this computer
        </Button>
      </TooltipTrigger>
      <TooltipContent>{`Restores on ${machine}`}</TooltipContent>
    </Tooltip>
  );
}

/** Copies the `dit checkout` line for the commit and says "Copied". */
function CopyCommandButton({ commit }: { commit: LogCommit }) {
  const { copied, copy } = useCopied();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => copy(ditCheckoutCommand(commit.hash))}
          aria-label={`Copy dit command for commit ${commit.shortId}`}
        >
          {copied ? (
            <>
              <IconCheck data-icon="inline-start" />
              Copied
            </>
          ) : (
            "Copy dit command"
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : COPY_HINT}</TooltipContent>
    </Tooltip>
  );
}

/**
 * What a commit row offers: Compare (the row as To and the commit before it as
 * From), Download set (the file as dit pushed it), Download with samples (only while the hub holds one), Restore on this computer
 * (editors) and Copy dit command. Downloads and compare are open to every
 * member, viewers included. `historyHref` is the history page's address as it
 * is shown, so a compare keeps its query.
 */
export function CommitRowActions({
  commit,
  historyHref,
  canEdit,
  restoreOn,
}: {
  commit: LogCommit;
  historyHref: string;
  canEdit: boolean;
  restoreOn: string | null;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="xs" asChild>
            <AppLink
              href={compareHref(
                historyHref,
                commit.baselineSaveId,
                commit.saveId
              )}
              scroll={false}
              aria-label={`Compare commit ${commit.shortId}`}
            >
              Compare
            </AppLink>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{commitCompareTip(commit)}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="xs" asChild>
            <a
              href={`/api/commits/${commit.id}/set`}
              download
              aria-label={`Download set as of commit ${commit.shortId}`}
            >
              Download set
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{commitDownloadTip(commit)}</TooltipContent>
      </Tooltip>
      {offersSamplesZip(commit.samplesHeld) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="xs" asChild>
              <a
                href={`/api/commits/${commit.id}/archive`}
                download
                aria-label={`Download commit ${commit.shortId} with samples, ${samplesIncluded(commit.samplesHeld, commit.samplesReferenced)}`}
              >
                Download with samples
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {samplesIncluded(commit.samplesHeld, commit.samplesReferenced)}
          </TooltipContent>
        </Tooltip>
      )}
      {canEdit &&
        (restoreOn != null ? (
          <RestoreOnButton commit={commit} machine={restoreOn} />
        ) : (
          <RestoreButton />
        ))}
      <CopyCommandButton commit={commit} />
    </>
  );
}
