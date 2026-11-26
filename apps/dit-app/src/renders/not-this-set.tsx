import { useState, type JSX } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

import type { RenderSet } from "../ipc";

/**
 * "Not this set": the repo's other sets that are on the hub, to add the bounce to one of them instead. The app has
 * no per-set rejection, so the answer is a different set or nothing; the picker says so when there is none.
 */
export function NotThisSet({
  sets,
  disabled,
  onPick,
}: {
  sets: readonly RenderSet[];
  disabled: boolean;
  /** Called with the chosen set's hub session id; the picker closes first. */
  onPick: (sessionId: number) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" disabled={disabled}>
          Not this set
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2">
        <PopoverHeader>
          <PopoverTitle>Add it to another set</PopoverTitle>
          {sets.length === 0 && (
            <PopoverDescription>
              No other set in this folder is on the hub yet.
            </PopoverDescription>
          )}
        </PopoverHeader>
        {sets.length > 0 && (
          <ul className="flex flex-col">
            {sets.map((set) => (
              <li key={set.sessionId}>
                <Button
                  variant="ghost"
                  className="h-auto min-h-7 w-full justify-start py-1 text-left [overflow-wrap:anywhere] whitespace-normal"
                  onClick={() => {
                    setOpen(false);
                    onPick(set.sessionId);
                  }}
                >
                  {set.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
