import { AppLink } from "@/components/navigation/AppLink";
import {
  fromCommitHref,
  fromCommitLabel,
} from "@/components/track-audio/version-rows";
import { IconGitCommit } from "@tabler/icons-react";
import type { TrackAudioWithAsset } from "@workspace/api/api";

/**
 * Compact `IconGitCommit 'added strings'` link opening the track's Studio
 * history drawer on the commit the version was bounced from; nothing when no
 * commit recorded it, and plain text for an unlisted branch.
 */
export function FromCommitLink({
  audio,
  trackId,
}: {
  audio: TrackAudioWithAsset;
  trackId: number;
}) {
  const label = fromCommitLabel(audio.bouncedFrom);
  const message = audio.bouncedFrom?.commit?.message;
  if (label == null || message == null) return null;

  const href = fromCommitHref(audio.bouncedFrom, {
    projectId: audio.asset.projectId,
    trackId,
  });

  const content = (
    <>
      <IconGitCommit className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
      <span className="truncate">{`'${message}'`}</span>
    </>
  );

  if (href == null) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1 truncate"
        aria-label={label}
        title={label}
      >
        {content}
      </span>
    );
  }

  return (
    <AppLink
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex min-w-0 items-center gap-1 truncate motion-ink hover:text-ink"
    >
      {content}
    </AppLink>
  );
}
