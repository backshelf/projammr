"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { LinkToDialog } from "@/components/product-linking/LinkToDialog";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import type { PropsWithChildren } from "react";

/**
 * A cell of linked records (a track's collections, relations) as chips, with a
 * trailing "+" that opens the link dialog for the row. The chips stay on one
 * line and clip: a row with many links must not grow taller than its
 * neighbours, and the full set is reachable from the record itself.
 */
export function TrackTags({
  children,
  trackId,
  defaultTab,
  linkedCollectionIds,
}: PropsWithChildren<{
  trackId: number;
  defaultTab?: "collection" | "session" | "relation";
  linkedCollectionIds?: number[];
}>) {
  const canEdit = useProjectRole()?.can("editor") ?? true;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {children}
      </div>
      {canEdit && (
        <LinkToDialog
          targetKind="track"
          targetId={trackId}
          defaultTab={defaultTab}
          linkedCollectionIds={linkedCollectionIds}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Link to another item"
            className="size-6 flex-none text-ink-soft hover:text-ink"
          >
            <IconPlus size={14} />
          </Button>
        </LinkToDialog>
      )}
    </div>
  );
}

/** One linked record: a chip carrying a link, with an optional remove. */
export function Tag({
  href,
  children,
  onRemove,
}: PropsWithChildren<{ href: string; onRemove?: () => void }>) {
  return (
    <StatusChip
      flag
      colour="var(--ink-soft)"
      className="max-w-48 flex-none gap-1 pr-1.5"
    >
      <AppLink href={href} className="min-w-0 truncate hover:underline">
        {children}
      </AppLink>
      {onRemove && (
        <button
          type="button"
          aria-label="Unlink"
          className="shrink-0 text-ink-soft hover:text-danger"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconX size={12} />
        </button>
      )}
    </StatusChip>
  );
}
