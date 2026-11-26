"use client";

import { forgetRejection } from "@/lib/machine-mutations";
import { Button } from "@workspace/ui/components/button";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useId, useState } from "react";
import { useMachineMutation } from "./use-machine-mutation";

/** One thing the user told dit to leave alone: what to call it, and a longer form for a hover. */
export type RejectionEntry = {
  id: number;
  label: string;
  title?: string;
};

/**
 * A titled list of rejections, each with its own Remove. The button's name
 * says which entry and which list it takes it out of, so a screen reader
 * hears more than "Remove" a dozen times over. Removal asks nothing first: it
 * only lets dit look at the file or folder again, and puts it back the same
 * way it was marked.
 */
export function RejectionList({
  heading,
  items,
  className,
}: {
  /** The list's title, which also names each Remove: "Not a bounce", "Never here". */
  heading: string;
  items: readonly RejectionEntry[];
  className?: string;
}) {
  const headingId = useId();
  const run = useMachineMutation();
  const [removing, setRemoving] = useState<number | null>(null);

  const remove = async (entry: RejectionEntry) => {
    setRemoving(entry.id);
    await run(forgetRejection(entry.id), `Took ${entry.label} back`);
    setRemoving(null);
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <h4 id={headingId} className={cn(LABEL, "text-ink-faint")}>
        {heading}
      </h4>
      <ul aria-labelledby={headingId} className="flex flex-col">
        {items.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3">
            <span
              title={entry.title}
              className="min-w-0 flex-1 text-small break-all text-ink-soft"
            >
              {entry.label}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-soft hover:text-danger"
              disabled={removing === entry.id}
              aria-busy={removing === entry.id || undefined}
              aria-label={`Remove ${entry.label} from ${heading}`}
              onClick={() => void remove(entry)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
