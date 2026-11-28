import { type JSX, type RefObject } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@workspace/ui/components/popover";

import type { RenderSet } from "../ipc";

/**
 * "Wrong set…": the repo's other sets that are on the hub, to add the bounce to one of them instead. The app has
 * no per-set rejection, so the answer is a different set or nothing; the picker says so when there is none.
 */
export function NotThisSet({
  sets,
  open,
  anchor,
  onOpenChange,
  onPick,
}: {
  sets: readonly RenderSet[];
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen set's hub session id; the picker closes first. */
  onPick: (sessionId: number) => void;
}): JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent align="end" anchor={anchor} className="w-64 gap-2">
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
                    onOpenChange(false);
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
