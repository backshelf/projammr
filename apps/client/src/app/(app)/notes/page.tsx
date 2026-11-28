import { DesktopNoteIndex } from "@/components/notebook/DesktopNoteIndex";
import { cachedMyNotes } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notebook",
};

/**
 * The right pane when landing on `/notes`: on desktop, opens the latest note
 * automatically if one exists or shows a quick-compose prompt; below `md:` the
 * shell shows the list alone until a note is picked.
 */
export default async function Page() {
  const result = await cachedMyNotes();
  const notes = isActionError(result) ? [] : result;
  const latest =
    notes.length === 0
      ? null
      : notes.reduce(
          (best, current) =>
            Date.parse(current.updatedAt) > Date.parse(best.updatedAt)
              ? current
              : best,
          notes[0]!
        );

  return <DesktopNoteIndex latestNoteId={latest?.id ?? null} />;
}
