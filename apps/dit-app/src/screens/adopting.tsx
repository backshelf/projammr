import type { JSX } from "react";
import { IconCheck } from "@tabler/icons-react";
import {
  Row,
  RowMain,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { Spinner } from "@workspace/ui/components/spinner";

import type { Adopting as AdoptingState } from "../ipc";
import { PanelHead } from "../panel-head";

/** "1 of 8 sets saved", "All 8 sets saved"; a folder of one set says "1 set". */
function progressLine(adopting: AdoptingState): string {
  const saved = adopting.sets.filter((set) => set.state === "saved").length;
  const total = adopting.setCount;
  if (saved >= total)
    return total === 1 ? "1 set saved" : `All ${total} sets saved`;
  return `${saved} of ${total} ${total === 1 ? "set" : "sets"} saved`;
}

/**
 * After "Track it": the folder's sets as their first saves land, each saving or saved. The app clears `adopting` once
 * the last one is in and the panel goes on to the set screen, so this screen only shows what the app says.
 */
export function Adopting({
  adopting,
}: {
  adopting: AdoptingState;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PanelHead
        title={`Tracking ${adopting.name}`}
        lede="dit records a save of every set as it stands."
      />
      <p role="status" className="text-small text-ink tabular-nums">
        {progressLine(adopting)}
      </p>
      {adopting.sets.length > 0 && (
        <Rows
          as="ul"
          aria-label="Sets in the folder"
          className="border-b border-rule"
        >
          {adopting.sets.map((set) => (
            <Row as="li" key={set.name} className="items-start px-0">
              <RowMain>
                <RowTitle>{set.name}</RowTitle>
              </RowMain>
              {set.state === "saved" ? (
                <span className="flex shrink-0 items-center gap-1.5 text-small text-ink-soft">
                  <IconCheck aria-hidden className="size-3.5 text-art" />
                  Saved
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-small text-ink-soft">
                  <Spinner
                    role="presentation"
                    aria-hidden
                    className="size-3.5"
                  />
                  Saving…
                </span>
              )}
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
