"use client";

import { PriorityBadge } from "@/components/tables/Priority";
import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import type { PriorityLevel } from "@workspace/api/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useState } from "react";
import { toast } from "sonner";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The track rail's priority: the level the track holds, opening a menu of the
 * project's scale. The trigger draws the track's own level, so it shows even
 * while the scale is unread.
 */
export function TrackPrioritySection({
  trackId,
  level,
  levels,
}: {
  trackId: number;
  level: PriorityLevel;
  /** The project's scale, bottom level first. */
  levels: PriorityLevel[];
}) {
  const mutate = useMutate();
  const [saving, setSaving] = useState(false);

  async function onSelect(picked: PriorityLevel) {
    if (picked.id === level.id) return;
    setSaving(true);
    const result = await mutate(
      patchEntityFields("track", trackId, { priorityId: picked.id })
    );
    setSaving(false);
    if (isActionError(result)) {
      toast.error(`Failed to update priority: ${result.error}`);
      return;
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={saving}
        className="-mx-1 mb-2 flex w-full items-center rounded-md px-1 py-0.5 motion-ink hover:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-none disabled:opacity-50"
      >
        <PriorityBadge level={level} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {levels.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onSelect(option)}>
            <PriorityBadge level={option} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
