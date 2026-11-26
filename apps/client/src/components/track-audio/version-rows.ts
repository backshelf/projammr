import { hrefFromParsedRoute } from "@/lib/utils";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import {
  commitRowId,
  LOG_BRANCH,
  MOST_COMMITS,
} from "@workspace/ui/lib/commit-log";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * What a version row reads off a track audio: how loud it is and when the file
 * was made. `TrackAudioWithAsset` satisfies it.
 */
export type VersionRowAudio = {
  lufs?: number | null;
  asset: { localFileCreatedAt?: string | null; createdAt: string };
};

/**
 * The meta of one version — "−16.3 LUFS · 14 Sept 2026" — as the version menu
 * and the phone sheet both say it. The loudness is missing until the scan has
 * run, and the date is the one the file carries from the DAW where it has one.
 */
export function versionRowLine(
  audio: VersionRowAudio,
  format: Formatters
): string {
  const when = format.date(
    audio.asset.localFileCreatedAt ?? audio.asset.createdAt
  );
  return audio.lufs == null
    ? when
    : `${format.lufs(audio.lufs)} LUFS · ${when}`;
}

/** Newest version first, the order every version list is read in. */
export function byNewest<T extends { version: number }>(
  audios: readonly T[]
): T[] {
  return [...audios].sort((a, b) => b.version - a.version);
}

/** The star's accessible name, which says in words what the filled mark says. */
export function primaryStarLabel(version: number, isPrimary: boolean): string {
  return isPrimary
    ? `v${version} is the primary version`
    : `Make v${version} the primary version`;
}

/** The flag text a duplicate version wears: "same audio as v3". */
export function duplicateFlagLabel(version: number): string {
  return `same audio as v${version}`;
}

/**
 * The version number `duplicateOfId` names, among a track's own audios; null
 * when the id is unset, or names a version outside the given list (a version
 * the caller has not loaded).
 */
export function duplicateOfVersion<T extends { id: number; version: number }>(
  duplicateOfId: number | null | undefined,
  audios: readonly T[]
): number | null {
  if (duplicateOfId == null) return null;
  return audios.find((audio) => audio.id === duplicateOfId)?.version ?? null;
}

type BouncedFrom = NonNullable<TrackAudioWithAsset["bouncedFrom"]>;

/** The commit a version was bounced from, which only a bounce recorded by a commit has. */
type FromCommit = Pick<BouncedFrom, "sessionId"> & {
  commit: NonNullable<BouncedFrom["commit"]>;
};

const fromCommitOf = (
  bouncedFrom: TrackAudioWithAsset["bouncedFrom"] | undefined
): FromCommit | null =>
  bouncedFrom?.commit
    ? { sessionId: bouncedFrom.sessionId, commit: bouncedFrom.commit }
    : null;

/** "from commit 'added strings'"; null for a version no commit recorded. */
export function fromCommitLabel(
  bouncedFrom: TrackAudioWithAsset["bouncedFrom"] | undefined
): string | null {
  const from = fromCommitOf(bouncedFrom);
  return from ? `from commit '${from.commit.message}'` : null;
}

/**
 * The history row of the commit a version was bounced from; null when the
 * commit is on a branch the log does not show. The log shows its first 30
 * commits and folds checkpoints away, so the link asks for the whole
 * log and, for a checkpoint, the unfolded one, or the anchor would not exist.
 */
export function fromCommitHref(
  bouncedFrom: TrackAudioWithAsset["bouncedFrom"] | undefined,
  { projectId, trackId }: { projectId: number; trackId: number }
): string | null {
  const from = fromCommitOf(bouncedFrom);
  if (!from || from.commit.branch !== LOG_BRANCH) return null;
  const query = new URLSearchParams({ commits: String(MOST_COMMITS) });
  if (from.commit.kind === "checkpoint") query.set("checkpoints", "1");
  const history = hrefFromParsedRoute(
    { kind: "session-history", sessionId: from.sessionId, trackId },
    projectId
  );
  return `${history}?${query}#${commitRowId(from.commit.id)}`;
}
