import { getCommentsForTarget } from "@/actions/comments";
import { isActionError } from "@workspace/api/lib/action-result";
import { EmptySection } from "@workspace/ui/components/layout/empty-section";
import {
  SectionHead,
  type SectionProminence,
} from "@workspace/ui/components/layout/section-head";
import CommentCompose, { type CommentEntityType } from "./CommentCompose";
import CommentList from "./CommentList";
import { TrackCommentsSection } from "./TrackCommentsSection";
import { Arrive } from "@workspace/ui/components/layout/arrive";

export default async function CommentSection({
  entityType,
  entityId,
  prominence,
  hint,
}: {
  entityType: CommentEntityType;
  entityId: number;
  prominence?: SectionProminence;
  /** One line under the head saying what these comments are about, where the
   *  page carries another kind of comment beside them. */
  hint?: string;
}) {
  const comments = await getCommentsForTarget(entityType, entityId);
  const roots = isActionError(comments)
    ? comments
    : comments.filter((c) => c.parentId === null);

  return (
    <EmptySection
      label={"COMMENTS"}
      empty={!isActionError(roots) && roots.length === 0}
      add={"Comment"}
    >
      <section>
        <SectionHead
          count={isActionError(roots) ? undefined : roots.length}
          prominence={prominence}
        >
          COMMENTS
        </SectionHead>
        {hint && <p className={"mb-3.5 text-small text-ink-soft"}>{hint}</p>}
        <Arrive>
          <CommentList comments={roots} />
        </Arrive>
        <CommentCompose entityType={entityType} entityId={entityId} />
      </section>
    </EmptySection>
  );
}

/** Server wrapper that fetches the track's general comments and hands them to
 *  the unified client `TrackCommentsSection` inside `TrackAudioProvider`. */
export async function TrackCommentSection({
  trackId,
  trackTitle,
  artists,
}: {
  trackId: number;
  trackTitle: string;
  artists: string[];
}) {
  const comments = await getCommentsForTarget("track", trackId);
  const roots = isActionError(comments)
    ? comments
    : comments.filter((c) => c.parentId === null);

  return (
    <TrackCommentsSection
      trackId={trackId}
      trackTitle={trackTitle}
      artists={artists}
      generalComments={roots}
    />
  );
}
