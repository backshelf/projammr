import { useId, type JSX } from "react";
import { useFormat } from "@workspace/ui/components/format-provider";
import { sectionTitle } from "@workspace/ui/components/layout/section-head";
import { cn } from "@workspace/ui/lib/utils";

import type { HeadCommit } from "../ipc";
import { PushDotMark } from "./saves-list";

/**
 * What the set has to say when there is nothing to commit: the words, then the last commit where the saves would be,
 * with its message, how long ago, and whether the hub has it.
 */
export function NothingToCommit({
  lastCommit,
}: {
  lastCommit: HeadCommit | null;
}): JSX.Element {
  const headingId = useId();
  const format = useFormat();

  return (
    <>
      <p className="text-body text-ink">Nothing to commit</p>
      {lastCommit !== null && (
        <section aria-labelledby={headingId} className="flex flex-col">
          <h2 id={headingId} className={cn(sectionTitle(), "mb-2 normal-case")}>
            Last commit
          </h2>
          <div className="flex items-start gap-2.5 border-t border-rule py-2.5">
            <PushDotMark push={lastCommit.push} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-small [overflow-wrap:anywhere] text-ink">
                {lastCommit.message}
              </p>
              <p className="text-micro text-ink-soft">
                <time dateTime={new Date(lastCommit.at).toISOString()}>
                  {format.relative(lastCommit.at)}
                </time>
                {lastCommit.push === "pushed"
                  ? " \u00b7 pushed"
                  : lastCommit.push === "pushing"
                    ? " \u00b7 pushing"
                    : " \u00b7 waiting to push"}
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
