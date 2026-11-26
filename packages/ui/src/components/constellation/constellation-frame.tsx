import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";

/** The web's box: most of a desktop view, capped, a shorter band on a phone
 *  so the rows below always show, and a hairline above and below like a
 *  section. The placeholder and the drawing share it, so nothing shifts when
 *  the drawing arrives. */
export const CONSTELLATION_FRAME =
  "relative h-[min(70vh,720px)] border-y border-rule phone:h-[60vh]";

/** Holds the web's place while it streams in or its renderer loads. */
export function ConstellationPlaceholder({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(CONSTELLATION_FRAME, "grid place-items-center", className)}
    >
      <Spinner className="text-ink-faint" />
    </div>
  );
}
