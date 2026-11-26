import { createContext, use, type JSX } from "react";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";

import type { BackfillStanding } from "./ipc";
import { useOpenBackfill } from "./use-open-backfill";

const BackfillContext = createContext<BackfillStanding | null>(null);

/** How the backfill run stands, for the menu on whichever screen is showing. Without a run, there is nothing to say. */
export const BackfillProvider = BackfillContext.Provider;

const STANDING = { running: "Running", paused: "Paused" } as const;

/** The menu's "Bring in projects…", with "Running" or "Paused" under it while a run exists. */
export function BackfillItem(): JSX.Element {
  const standing = use(BackfillContext);
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
