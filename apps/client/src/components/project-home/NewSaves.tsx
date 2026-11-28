"use client";

import { AppLink } from "@/components/navigation/AppLink";
import type { SaveEntry } from "@/components/work-heatmap/save-entries";
import { pluralizeCount } from "@workspace/session-diff/format";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { useFormat } from "@workspace/ui/components/format-provider";
import { SaveTimeline } from "@workspace/ui/components/session-structure/save-timeline";

/**
 * The NEW block's raw DAW saves, folded behind a single summary line by
 * default so song renders lead and producers can expand the underlying set
 * activity on demand.
 */
export function NewSaves({
  entries,
  asOf,
}: {
  entries: SaveEntry[];
  asOf: Date;
}) {
  const format = useFormat();
  const setCount = new Set(entries.map((entry) => entry.title ?? entry.id))
    .size;

  return (
    <Collapsible defaultOpen={false} className="pt-1">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1.5 text-left text-small text-ink-soft motion-ink hover:text-ink">
        <CollapsibleChevron />
        <span>
          {pluralizeCount(entries.length, "DAW save")} across{" "}
          {pluralizeCount(setCount, "set")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SaveTimeline
          entries={entries}
          hrefFor={(entry) => entry.href}
          link={AppLink}
          asOf={asOf}
          format={format}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
