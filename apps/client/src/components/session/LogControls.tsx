"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { MOST_COMMITS } from "@workspace/ui/lib/commit-log";
import { useParamWriter } from "@/hooks/use-param-writer";

/**
 * Show checkpoints at the head of the log: puts every checkpoint in line
 * instead of folded under the named commit after it. The choice lives in the
 * address (`?checkpoints=1`), so it survives a reload and a shared link.
 */
export function ShowCheckpointsToggle({
  shown,
  shallow,
}: {
  shown: boolean;
  shallow?: boolean;
}) {
  const { write } = useParamWriter({ shallow });
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={shown}
      onClick={() => write({ checkpoints: shown ? null : "1" })}
    >
      Show checkpoints
    </Button>
  );
}

/**
 * The foot of the log: "Older commits" grows what the page loads to the most
 * it ever shows, with its progress in place; at that ceiling it says so and
 * stops offering more. A page that loaded fewer commits than it asked for has
 * them all.
 */
export function OlderCommits({
  shown,
  limit,
}: {
  /** How many commits the page loaded. */
  shown: number;
  /** How many it asked for. */
  limit: number;
}) {
  const { write, pending } = useParamWriter();
  if (shown < limit) return null;

  if (limit >= MOST_COMMITS) {
    return (
      <p className="px-2 py-3 text-center text-micro text-ink-soft">
        Showing the latest {MOST_COMMITS} commits.
      </p>
    );
  }

  return (
    <div className="flex justify-center py-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        onClick={() => write({ commits: String(MOST_COMMITS) })}
      >
        {pending && (
          <IconLoader2 data-icon="inline-start" className="animate-spin" />
        )}
        Older commits
      </Button>
    </div>
  );
}
