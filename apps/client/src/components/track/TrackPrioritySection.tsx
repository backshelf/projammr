"use client";

import { PriorityBadge } from "@/components/tables/Priority";
import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProjectRole } from "@/hooks/use-project-role";
import type { PriorityLevel } from "@workspace/api/api";
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerItem,
  ResponsivePickerList,
  ResponsivePickerTrigger,
} from "@workspace/ui/components/responsive-picker";
import { useState } from "react";
import { toast } from "sonner";
import { isActionError } from "@workspace/api/lib/action-result";

/**
 * The track rail's priority: the level the track holds, opening a menu of the
 * project's scale. The trigger draws the track's own level, so it shows even
 * while the scale is unread. Viewers see the badge read-only.
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
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  const mutate = useMutate();
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <div className="mb-2 flex items-center py-0.5">
        <PriorityBadge level={level} />
      </div>
    );
  }

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
    <ResponsivePicker>
      <ResponsivePickerTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="-mx-1 mb-2 flex w-full items-center rounded-md px-1 py-0.5 motion-ink hover:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden disabled:opacity-50 coarse:min-h-11"
        >
          <PriorityBadge level={level} />
        </button>
      </ResponsivePickerTrigger>
      <ResponsivePickerContent
        title="Priority"
        align="start"
        desktopClassName="w-48 p-1"
      >
        <ResponsivePickerList>
          {levels.map((option) => (
            <ResponsivePickerItem
              key={option.id}
              selected={option.id === level.id}
              onSelect={() => void onSelect(option)}
            >
              <PriorityBadge level={option} />
            </ResponsivePickerItem>
          ))}
        </ResponsivePickerList>
      </ResponsivePickerContent>
    </ResponsivePicker>
  );
}
