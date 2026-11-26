"use client";

import { getCollectionSummaries } from "@/actions/projects";
import { assignSessionToTrack, getSessionSummaries } from "@/actions/sessions";
import { getTrackSummaries } from "@/actions/tracks";
import { ArtSwatch } from "@/components/art/ArtSwatch";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { linkTracksToCollection } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProject } from "@/hooks/use-project-role";
import { clientGetCollectionTrackSummaries } from "@/lib/client-api";
import { noteTitle } from "@/lib/utils";
import type {
  CollectionSummary,
  NoteSummary,
  SessionSummary,
  TrackSummary,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { useCallback } from "react";
import { toast } from "sonner";

import { EntityPicker, PickerDetail, type PickerLoad } from "./EntityPicker";

/*
 * One picker per link the app offers. Each is the generic picker plus the
 * three things that differ: what to load, how a row reads, and what a pick
 * does.
 */

export const trackMatches = (track: TrackSummary, q: string) =>
  track.title.toLowerCase().includes(q) ||
  (track.artists ?? []).some((a) => a.toLowerCase().includes(q)) ||
  (track.bpm != null && String(track.bpm).includes(q)) ||
  (track.key?.toLowerCase().includes(q) ?? false);

/** One track as a picker row: swatch, title, archived flag, artists. */
export function TrackRow({ track }: { track: TrackSummary }) {
  return (
    <>
      <ArtSwatch artwork={null} />
      <span className="min-w-0 truncate font-medium">{track.title}</span>
      {track.archivedAt && <ArchivedFlag />}
      {(track.artists?.length ?? 0) > 0 && (
        <PickerDetail>{track.artists.join(", ")}</PickerDetail>
      )}
    </>
  );
}

/** One note as a picker row: title, then the opening of its text. */
export function NoteRow({ note }: { note: NoteSummary }) {
  return (
    <>
      <span className="min-w-0 truncate font-medium">
        {noteTitle(note.title)}
      </span>
      {note.preview && <PickerDetail>{note.preview}</PickerDetail>}
    </>
  );
}

/** Tracks in the project, to add to a collection. */
export function TrackPicker({ collectionId }: { collectionId: number }) {
  const { id: projectId } = useProject();
  const mutate = useMutate();
  const load = useCallback<PickerLoad<TrackSummary>>(async () => {
    const [tracks, members] = await Promise.all([
      getTrackSummaries(projectId),
      clientGetCollectionTrackSummaries(collectionId),
    ]);
    if (isActionError(tracks)) return tracks;
    return {
      items: tracks,
      linkedIds: isActionError(members) ? [] : members.map((t) => t.id),
    };
  }, [projectId, collectionId]);

  return (
    <EntityPicker
      load={load}
      matches={trackMatches}
      renderRow={(track) => <TrackRow track={track} />}
      placeholder="Search by title, artist, key or BPM…"
      emptyLabel="No tracks yet. Create one first."
      onPick={async (track) => {
        const result = await mutate(
          linkTracksToCollection(collectionId, [track.id])
        );
        if (isActionError(result)) {
          toast.error(result.error);
          return false;
        }
        toast.success(`Added "${track.title}" to collection`);
        return true;
      }}
    />
  );
}

/** Collections in the project, to add a track to. */
export function CollectionPicker({
  trackId,
  linkedIds = [],
}: {
  trackId: number;
  /** Collections the track is already in. */
  linkedIds?: number[];
}) {
  const { id: projectId } = useProject();
  const mutate = useMutate();
  // The caller's array is a fresh literal per render; its contents are what
  // matter, so the loader is keyed on them rather than on the array.
  const linkedKey = linkedIds.join(",");
  const load = useCallback<PickerLoad<CollectionSummary>>(async () => {
    const result = await getCollectionSummaries(projectId);
    return isActionError(result)
      ? result
      : {
          items: result,
          linkedIds: linkedKey ? linkedKey.split(",").map(Number) : [],
        };
  }, [projectId, linkedKey]);

  return (
    <EntityPicker
      load={load}
      matches={(c, q) => c.title.toLowerCase().includes(q)}
      renderRow={(c) => (
        <span className="min-w-0 truncate font-medium">{c.title}</span>
      )}
      placeholder="Search collections…"
      emptyLabel="No collections yet. Create one first."
      onPick={async (collection) => {
        const result = await mutate(
          linkTracksToCollection(collection.id, [trackId])
        );
        if (isActionError(result)) {
          toast.error(result.error);
          return false;
        }
        toast.success(`Added to "${collection.title}"`);
        return true;
      }}
    />
  );
}

/** Sessions in the project, to assign to a track. */
export function SessionPicker({ trackId }: { trackId: number }) {
  const { id: projectId } = useProject();
  const load = useCallback<PickerLoad<SessionSummary>>(async () => {
    const result = await getSessionSummaries(projectId);
    if (isActionError(result)) return result;
    return {
      items: result,
      linkedIds: result.filter((s) => s.trackId === trackId).map((s) => s.id),
    };
  }, [projectId, trackId]);

  return (
    <EntityPicker
      load={load}
      matches={(s, q) =>
        s.name.toLowerCase().includes(q) || s.daw.toLowerCase().includes(q)
      }
      renderRow={(session) => (
        <>
          <span className="min-w-0 truncate font-medium">{session.name}</span>
          <PickerDetail>{session.daw}</PickerDetail>
          {session.main && (
            <StatusChip flag colour="var(--ink-soft)" className="flex-none">
              Main
            </StatusChip>
          )}
        </>
      )}
      placeholder="Search by name or DAW…"
      emptyLabel="No sessions yet. Create one first."
      onPick={async (session) => {
        const result = await assignSessionToTrack(session.id, trackId);
        if (isActionError(result)) {
          toast.error(result.error);
          return false;
        }
        toast.success(`Assigned "${session.name}" to track`);
        return true;
      }}
    />
  );
}

/** Tracks in the project, to assign a session to. */
export function TrackPickerForSession({
  sessionId,
  currentTrackId,
}: {
  sessionId: number;
  /** The track the session already belongs to, shown as linked. */
  currentTrackId?: number | null;
}) {
  const { id: projectId } = useProject();
  const load = useCallback<PickerLoad<TrackSummary>>(async () => {
    const result = await getTrackSummaries(projectId);
    return isActionError(result)
      ? result
      : { items: result, linkedIds: currentTrackId ? [currentTrackId] : [] };
  }, [projectId, currentTrackId]);

  return (
    <EntityPicker
      load={load}
      matches={trackMatches}
      renderRow={(track) => <TrackRow track={track} />}
      placeholder="Search by title, artist, key or BPM…"
      emptyLabel="No tracks yet. Create one first."
      onPick={async (track) => {
        const result = await assignSessionToTrack(sessionId, track.id);
        if (isActionError(result)) {
          toast.error(result.error);
          return false;
        }
        toast.success(`Assigned session to "${track.title}"`);
        return true;
      }}
    />
  );
}
