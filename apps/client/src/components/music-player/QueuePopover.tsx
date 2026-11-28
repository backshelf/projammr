"use client";

import { CurrentTrackRow } from "@/components/music-player/CurrentTrackRow";
import {
  useCurrentTrack,
  usePlayerActions,
  useUpcoming,
} from "@/components/music-player/player-hooks";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Spinner } from "@workspace/ui/components/spinner";
import dynamic from "next/dynamic";

// The sortable list pulls in dnd-kit, which every page would otherwise load
// for a popover most visits never open.
const QueueList = dynamic(() => import("./QueueList"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-4">
      <Spinner />
    </div>
  ),
});

export function QueuePopover({ children }: { children: React.ReactNode }) {
  const current = useCurrentTrack();
  const upcoming = useUpcoming();
  const { clear } = usePlayerActions();

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={"end"} className={"w-80 p-0"}>
        <div
          className={
            "flex items-center justify-between border-b border-rule px-3 py-2 text-small font-medium"
          }
        >
          <span>Up next ({upcoming.length})</span>
          <Button
            variant={"ghost"}
            size={"xs"}
            onClick={clear}
            disabled={!current && upcoming.length === 0}
          >
            Clear
          </Button>
        </div>
        <div className={"max-h-80 overflow-y-auto py-1"}>
          {current && <CurrentTrackRow track={current} />}
          {upcoming.length > 0 ? (
            <QueueList size={"card"} />
          ) : (
            !current && (
              <p className={"px-3 py-6 text-center text-small text-ink-soft"}>
                Nothing queued
              </p>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
