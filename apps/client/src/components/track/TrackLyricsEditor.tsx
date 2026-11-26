"use client";

import { NoteEditor } from "@/components/notebook/NoteEditor";
import { LinkNoteAction } from "@/components/track/LinkNoteAction";
import { useProjectRole } from "@/hooks/use-project-role";
import type { NoteDetail } from "@workspace/api/api";
import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import { EmptySection } from "@workspace/ui/components/layout/empty-section";

/**
 * The track's LYRICS section: the linked note, or a draft of one, with the
 * note's save state and menu on the section's own head. The editor decides
 * for itself when a refresh has replaced the note underneath it. Until a
 * note is linked the section waits on the page's add line, offering to
 * write or link one.
 */
export function TrackLyricsEditor({
  trackId,
  note,
  author,
}: {
  trackId: number;
  note: NoteDetail | null;
  /** The note's author, when that is someone other than the viewer. */
  author: string | null;
}) {
  const role = useProjectRole();
  const mayEdit = role?.can("editor") ?? true;

  const source = note ? { note } : { draft: { trackId } };

  return (
    <EmptySection
      label={"LYRICS"}
      empty={!note}
      add={mayEdit ? "Lyrics" : undefined}
      addControl={
        mayEdit ? <LinkNoteAction trackId={trackId} collapsed /> : undefined
      }
    >
      <NoteEditor
        {...source}
        surface={"track"}
        layout={({ status, menu, editor }) => (
          <CollapsibleSection
            label={"LYRICS"}
            prominence={"primary"}
            keepMounted
            action={
              <div className={"flex items-center gap-2"}>
                {author && (
                  <span className={"text-micro text-ink-soft"}>{author}</span>
                )}
                {!note && <LinkNoteAction trackId={trackId} />}
                {status}
                {menu}
              </div>
            }
          >
            {editor}
          </CollapsibleSection>
        )}
      />
    </EmptySection>
  );
}
