"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { NoteEditor, type NoteSource } from "@/components/notebook/NoteEditor";
import { NOTES_HREF } from "@/lib/utils";
import { IconChevronLeft } from "@tabler/icons-react";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A note as the notebook's right pane: a slim header — the way back to the
 * list on a phone, where the list is off screen, then the save state and the
 * menu — over the editor.
 */
export function NotebookNote(props: NoteSource) {
  return (
    <NoteEditor
      {...props}
      surface={"notebook"}
      layout={({ status, menu, editor }) => (
        <div
          className={"flex min-h-full w-full max-w-full flex-col px-(--gutter)"}
        >
          <div
            className={
              "sticky top-0 z-10 -mx-(--gutter) flex items-center justify-between gap-3 border-b border-rule bg-paper/95 px-(--gutter) py-2 backdrop-blur-sm"
            }
          >
            <AppLink
              href={NOTES_HREF}
              className={cn(
                LABEL,
                "flex min-h-11 items-center gap-1 text-ink md:hidden"
              )}
            >
              <IconChevronLeft className={"size-4"} />
              Notes
            </AppLink>
            <div className={"ml-auto flex items-center gap-2"}>
              {status}
              {menu}
            </div>
          </div>
          {editor}
        </div>
      )}
    />
  );
}
