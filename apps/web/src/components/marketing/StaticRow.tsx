import type { TimelineLink } from "@workspace/ui/components/session-structure/save-timeline";

/** What `SaveTimeline` draws each entry with on a static page: the row's
 * own shape, but not a link, since there is no save page to open. The
 * hover plate goes with the link: a row that goes nowhere does not light up
 * under the pointer. */
export const StaticRow: TimelineLink = ({ className, children }) => (
  <div
    className={className
      ?.split(" ")
      .filter((name) => !name.startsWith("hover:"))
      .join(" ")}
  >
    {children}
  </div>
);
