"use client";

import { CommitRuler } from "@workspace/ui/components/session-structure/commit-ruler";
import { useFormat } from "@workspace/ui/components/format-provider";
import { clearCompareHref, compareHref } from "@workspace/ui/lib/commit-log";
import type {
  Compare,
  RulerCommit,
  RulerSave,
} from "@workspace/ui/lib/commit-ruler";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

/**
 * The history page's commit ruler, wired to the router: a click on a mark
 * scrolls the log to its row (opening the fold it sits in; no animation under
 * reduced motion), a compare writes `?from=&to=`, Esc drops both. `now` comes
 * from the server render so the axis agrees between server HTML and hydration.
 */
export function HistoryRuler({
  commits,
  saves,
  marked,
  historyHref,
  now,
}: {
  commits: RulerCommit[];
  saves: RulerSave[];
  marked: { from?: number | null; to?: number | null };
  /** The history page's address as it is shown; a compare or a clear keeps whatever query it carries besides `from` and `to`. */
  historyHref: string;
  /** ISO timestamp from the server render anchoring the right edge of the axis. */
  now: string;
}) {
  const router = useRouter();
  const format = useFormat();
  const reduced = useReducedMotion();
  const asOf = useMemo(() => new Date(now), [now]);

  const reveal = (rowId: string) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    // A row inside a closed fold is in the document but not on screen.
    for (
      let fold = row.closest("details");
      fold;
      fold = fold.parentElement?.closest("details") ?? null
    ) {
      fold.open = true;
    }
    row.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
  };

  const compare = ({ fromId, toId }: Compare) => {
    router.replace(compareHref(historyHref, fromId, toId), { scroll: false });
  };

  return (
    <CommitRuler
      commits={commits}
      saves={saves}
      marked={marked}
      format={format}
      asOf={asOf}
      onReveal={reveal}
      onCompare={compare}
      onClear={() =>
        router.replace(clearCompareHref(historyHref), { scroll: false })
      }
    />
  );
}
