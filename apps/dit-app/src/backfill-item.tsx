import type { JSX } from "react";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";

import { useBackfillStanding } from "./panel-actions";
import { useOpenBackfill } from "./use-open-backfill";

const STANDING = { running: "Running", paused: "Paused" } as const;

/** The menu's "Bring in projects…", with "Running" or "Paused" under it while a run exists. */
export function BackfillItem(): JSX.Element {
  const standing = useBackfillStanding();
  const open = useOpenBackfill();

  return (
    <DropdownMenuItem
      onClick={() => void open()}
      className="flex-col items-start gap-0.5"
    >
      Bring in projects…
      {standing && (
        <span className="text-micro text-pretty text-ink-soft">
          {STANDING[standing.state]}
        </span>
      )}
    </DropdownMenuItem>
  );
}
