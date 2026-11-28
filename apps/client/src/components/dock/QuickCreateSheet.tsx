"use client";

import {
  BottomSheet,
  SHEET_ROW,
  SheetCancelRow,
} from "@/components/dock/BottomSheet";
import { AppLink } from "@/components/navigation/AppLink";
import { hrefFromParsedRoute, NEW_NOTE_HREF } from "@/lib/utils";
import {
  IconDisc,
  IconFileMusic,
  IconMusic,
  IconNotes,
  IconPlus,
} from "@tabler/icons-react";
import { SheetClose } from "@workspace/ui/components/sheet";

/**
 * Phone top-strip "+" menu: creates a track, collection, or session in the
 * active project (when the member can edit it) or a personal note anywhere.
 */
export function QuickCreateSheet({
  projectId,
  canEdit,
}: {
  projectId: number | null;
  canEdit: boolean;
}) {
  return (
    <BottomSheet
      title={"Quick create"}
      trigger={
        <button
          type={"button"}
          className={
            "flex size-11 shrink-0 items-center justify-center text-ink-soft hover:text-ink"
          }
          aria-label={"Quick create"}
        >
          <IconPlus className={"size-5"} />
        </button>
      }
    >
      {projectId != null && canEdit && (
        <>
          <SheetClose asChild nativeButton={false}>
            <AppLink
              href={hrefFromParsedRoute({ kind: "track-new" }, projectId)}
              className={SHEET_ROW}
            >
              <IconMusic className={"size-5 shrink-0 text-ink-soft"} />
              New Track
            </AppLink>
          </SheetClose>
          <SheetClose asChild nativeButton={false}>
            <AppLink
              href={hrefFromParsedRoute({ kind: "collection-new" }, projectId)}
              className={SHEET_ROW}
            >
              <IconFileMusic className={"size-5 shrink-0 text-ink-soft"} />
              New Collection
            </AppLink>
          </SheetClose>
          <SheetClose asChild nativeButton={false}>
            <AppLink
              href={hrefFromParsedRoute({ kind: "session-new" }, projectId)}
              className={SHEET_ROW}
            >
              <IconDisc className={"size-5 shrink-0 text-ink-soft"} />
              New Session
            </AppLink>
          </SheetClose>
        </>
      )}
      <SheetClose asChild nativeButton={false}>
        <AppLink href={NEW_NOTE_HREF} className={SHEET_ROW}>
          <IconNotes className={"size-5 shrink-0 text-ink-soft"} />
          New Note
        </AppLink>
      </SheetClose>
      <SheetCancelRow />
    </BottomSheet>
  );
}
