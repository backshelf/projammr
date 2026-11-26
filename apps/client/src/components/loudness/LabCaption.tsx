import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A live meter's caption, followed by "after the Lab" while the meter reads
 * the Lab's output rather than the file itself.
 */
export function LabCaption({
  caption,
  afterLab,
  className,
}: {
  caption: string;
  afterLab: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-baseline gap-x-2", className)}>
      <span className={LABEL}>{caption}</span>
      {afterLab && <span className="text-micro">after the Lab</span>}
    </span>
  );
}
