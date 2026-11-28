import { STEP_NEXT, STEP_PREV } from "@/components/motion/morph-keys";
import { AppLink } from "@/components/navigation/AppLink";
import { runningOrder, type Neighbour } from "@/components/track/running-order";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

const chevronLinkClasses =
  "motion-ink relative text-ink-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/30 rounded-sm coarse:inline-flex coarse:size-11 coarse:items-center coarse:justify-center";

function ChevronLink({
  direction,
  neighbour,
  collectionId,
  projectId,
}: {
  direction: "previous" | "next";
  neighbour: Neighbour;
  collectionId: number;
  projectId: number;
}) {
  const label = `${direction === "previous" ? "Previous" : "Next"}: ${neighbour.title}`;
  return (
    <AppLink
      href={hrefFromParsedRoute(
        { kind: "track", trackId: neighbour.id, collectionId },
        projectId
      )}
      // Tells the masthead and its art to step sideways the way the running
      // order goes, rather than swap in place.
      transitionTypes={[direction === "previous" ? STEP_PREV : STEP_NEXT]}
      aria-label={label}
      title={label}
      className={chevronLinkClasses}
    >
      {direction === "previous" ? (
        <IconChevronLeft size={14} />
      ) : (
        <IconChevronRight size={14} />
      )}
    </AppLink>
  );
}

/**
 * The eyebrow's "Track N of M" text, plus links to the collection's
 * neighbouring tracks when the track was reached through a collection. A
 * missing neighbour renders nothing rather than a disabled control.
 */
export function TrackRunningOrder({
  projectId,
  collectionId,
  trackId,
  siblings,
}: {
  projectId: number;
  collectionId?: number;
  trackId: number;
  siblings: Neighbour[];
}) {
  const { position, total, previous, next } = runningOrder(siblings, trackId);

  return (
    <>
      {position !== null ? `Track ${position} of ${total}` : "Track"}
      {collectionId !== undefined && (previous || next) && (
        <nav
          aria-label="Running order"
          className="ml-2 inline-flex items-center gap-1 align-middle coarse:gap-2"
        >
          {previous && (
            <ChevronLink
              direction="previous"
              neighbour={previous}
              collectionId={collectionId}
              projectId={projectId}
            />
          )}
          {next && (
            <ChevronLink
              direction="next"
              neighbour={next}
              collectionId={collectionId}
              projectId={projectId}
            />
          )}
        </nav>
      )}
    </>
  );
}
