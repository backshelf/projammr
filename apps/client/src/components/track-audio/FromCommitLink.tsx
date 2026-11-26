import { AppLink } from "@/components/navigation/AppLink";
import {
  fromCommitHref,
  fromCommitLabel,
} from "@/components/track-audio/version-rows";
import type { TrackAudioWithAsset } from "@workspace/api/api";

/**
 * "from commit 'added strings'", linking the selected version to its row in
 * the session's history; nothing for a version no commit recorded, and plain
 * text for a commit the history does not list.
 */
export function FromCommitLink({
  audio,
  trackId,
}: {
  audio: TrackAudioWithAsset;
  trackId: number;
}) {
  const label = fromCommitLabel(audio.bouncedFrom);
  if (label == null) return null;

  const href = fromCommitHref(audio.bouncedFrom, {
    projectId: audio.asset.projectId,
    trackId,
  });
  if (href == null) return <span className="min-w-0 truncate">{label}</span>;

  return (
    <AppLink href={href} className="min-w-0 truncate motion-ink hover:text-ink">
      {label}
    </AppLink>
  );
}
