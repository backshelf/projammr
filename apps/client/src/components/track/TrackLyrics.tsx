import { LyricsProvider } from "@/components/editing/LyricsProvider";
import { TrackLyricsEditor } from "@/components/track/TrackLyricsEditor";
import { cachedMe, cachedNote } from "@/lib/server-data";
import type { GetTrack } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";

/**
 * A track's lyrics: the note linked to it, or a blank editor whose first
 * keystroke writes one. The note is a notebook row of its author's, so the
 * track carries only the link and the body is read on its own.
 */
export async function TrackLyrics({
  trackId,
  note,
}: {
  trackId: number;
  note: GetTrack["note"];
}) {
  const [me, linked] = await Promise.all([
    cachedMe(),
    note ? cachedNote(note.id) : undefined,
  ]);

  // The author can delete the note between the track's read and this one,
  // which leaves the track pointing at nothing; the section then offers a new
  // one rather than reporting a note nobody can do anything about.
  const detail = linked && !isActionError(linked) ? linked : null;
  const viewerId = isActionError(me) ? null : me.id;
  const author =
    detail && detail.author.id !== viewerId ? detail.author.name : null;

  return (
    <Arrive>
      <LyricsProvider>
        <TrackLyricsEditor trackId={trackId} note={detail} author={author} />
      </LyricsProvider>
    </Arrive>
  );
}
