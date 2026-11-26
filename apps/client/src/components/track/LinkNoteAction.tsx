"use client";

import { getMyNotes, linkNote } from "@/actions/notes";
import type { PickerLoad } from "@/components/product-linking/EntityPicker";
import { LinkPickerDialog } from "@/components/product-linking/LinkPickerDialog";
import { NoteRow } from "@/components/product-linking/pickers";
import { noteMatches, noteTitle } from "@/lib/utils";
import type { NoteSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { SectionAction } from "@workspace/ui/components/layout/empty-section";
import { useCallback, useState } from "react";

/**
 * Gives a track lyrics the viewer has already written: one of their own notes,
 * picked from the notebook. The section only offers it to someone who can
 * edit the project. `collapsed` draws the trigger as a text action on the page's
 * add line, beside the empty sections' adds.
 */
export function LinkNoteAction({
  trackId,
  collapsed = false,
}: {
  trackId: number;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const load = useCallback<PickerLoad<NoteSummary>>(async () => {
    const result = await getMyNotes();
    if (isActionError(result)) return result;
    // A note is at most one track's lyrics, so the ones already spoken for
    // are not offered.
    return { items: result.filter((note) => note.track === null) };
  }, []);

  return (
    <>
      {collapsed ? (
        <SectionAction onClick={() => setOpen(true)}>Link a note</SectionAction>
      ) : (
        <Button
          variant={"ghost"}
          size={"xs"}
          className={"coarse:min-h-11"}
          onClick={() => setOpen(true)}
        >
          Link a note
        </Button>
      )}

      <LinkPickerDialog
        open={open}
        onOpenChange={setOpen}
        title={"Link a note"}
        description={
          <>
            The note becomes this track&rsquo;s lyrics, and everyone on the
            project can read it.
          </>
        }
        load={load}
        matches={noteMatches}
        renderRow={(note) => <NoteRow note={note} />}
        placeholder={"Search your notes…"}
        emptyLabel={"Every note you have written is already linked."}
        link={(note) => linkNote(note.id, trackId)}
        linkedLabel={(note) => `Linked "${noteTitle(note.title)}"`}
      />
    </>
  );
}
