import { pluralizeCount } from "@workspace/session-diff/format";
import type { ActionError, CollectionSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The faint line under a live track count when some tracks are archived:
 * "3 archived · 15 total". Renders nothing when none are.
 */
export function ArchivedCountNote({
  live,
  archived,
}: {
  live: number;
  archived: number;
}) {
  if (archived <= 0) return null;

  return (
    <span className="block text-micro text-ink-soft">
      {archived} archived · {live + archived} total
    </span>
  );
}

/** The masthead's one-line summary of what the project holds. */
export async function ProjectByline({
  collectionsPromise,
  sessionCount,
  trackCount,
  archivedTrackCount,
}: {
  collectionsPromise: Promise<CollectionSummary[] | ActionError>;
  sessionCount: number;
  trackCount: number;
  archivedTrackCount: number;
}) {
  const collections = await collectionsPromise;

  if (isActionError(collections)) return null;

  return (
    <span>
      {[
        pluralizeCount(collections.length, "collection"),
        pluralizeCount(trackCount, "track"),
        pluralizeCount(sessionCount, "session"),
      ].join(" · ")}
      <ArchivedCountNote live={trackCount} archived={archivedTrackCount} />
    </span>
  );
}
