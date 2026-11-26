import type { JSX } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { cn } from "@workspace/ui/lib/utils";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import type { OpenSet } from "../ipc";
import { PanelMenu } from "../panel-menu";
import { useCommand } from "../use-command";

/**
 * The set's masthead, the panel's one bold element: the set's name in the display face, over its track's blurred
 * cover when it has one, with the branch, the time spent in the set since the last commit and the way to its page
 * on the web. The cover is the `--art-image` its parent sets with the accent (`artVarsFromAccent`); a set with no
 * artwork draws no band and reads in the grayscale accent, as every page without a cover does.
 */
export function SetMasthead({
  open,
  hasArtwork,
  timeSinceCommit,
}: {
  open: OpenSet;
  hasArtwork: boolean;
  /** Seconds in the set since its last commit; null when none is counted. */
  timeSinceCommit: number | null;
}): JSX.Element {
  const format = useFormat();
  const { run, error } = useCommand();
  const time =
    timeSinceCommit === null
      ? null
      : `${format.timeInSet(timeSinceCommit)} in this set since the last commit`;
  const byline = [open.branch, time].filter((part) => part !== null);

  return (
    <section
      aria-label="The open set"
      className="relative isolate -mx-4 -mt-4 px-4 pt-4"
    >
      {hasArtwork && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-(--masthead-h) overflow-hidden [--masthead-h:12rem]"
        >
          <div className="masthead__art">
            <div className="masthead__tone">
              <div className="masthead__field bg-[image:var(--art-image)]" />
            </div>
          </div>
          <div className="masthead__scrim" />
        </div>
      )}
      <header className="flex flex-col gap-1.5">
        <div className="flex items-start gap-1">
          <h1 className="min-w-0 flex-1 font-heading text-title/[1.05] text-balance [overflow-wrap:anywhere] text-ink">
            {open.name}
          </h1>
          <PanelMenu signedIn />
        </div>
        {byline.length > 0 && (
          <p
            className={cn(
              "text-small text-pretty",
              hasArtwork ? "on-art-soft" : "text-ink-soft"
            )}
          >
            {byline.join(" \u00b7 ")}
          </p>
        )}
        {open.webPath !== null && (
          <div>
            <Button
              variant="link"
              className="-ml-1 gap-0.5 px-1 text-ink"
              onClick={() =>
                void run(() => call("open_web", { path: open.webPath }))
              }
            >
              Open on the web
              <IconArrowUpRight aria-hidden />
            </Button>
            <ErrorLine error={error} />
          </div>
        )}
      </header>
    </section>
  );
}
