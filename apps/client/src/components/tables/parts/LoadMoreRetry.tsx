"use client";

import { Button } from "@workspace/ui/components/button";

/** The grid and the card list's answer to a failed page fetch: the same copy
 *  and the same retry affordance, in whatever wrapper each one's markup needs. */
export function LoadMoreRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 text-ink-soft">
      <span>Couldn&apos;t load more rows</span>
      <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
