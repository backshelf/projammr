"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { LinkToDialog } from "@/components/product-linking/LinkToDialog";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { StatusChip } from "@workspace/ui/components/status-chip";
import type { PropsWithChildren, ReactNode } from "react";

import { OverflowChipList } from "./OverflowChipList";

/**
 * A cell of linked records (a track's collections, relations) as chips, with a
 * trailing "+" that opens the link dialog for the row. The chips stay on one
 * line with a `+N` popover for overflow so a row with many links never grows
 * taller than `--table-row-h`.
 */
export function TrackTags<T>({
  items,
  getKey,
  renderItem,
  trackId,
  defaultTab,
  linkedCollectionIds,
}: {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  trackId: number;
  defaultTab?: "collection" | "session" | "relation";
  linkedCollectionIds?: number[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? true;
  return (
    <OverflowChipList
      items={items}
      maxVisible={2}
      getKey={getKey}
      overflowLabel={defaultTab === "relation" ? "relations" : "collections"}
      renderItem={renderItem}
      listClassName="flex-1"
      trailing={
        canEdit ? (
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
        ) : undefined
      }
    />
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
