"use client";

import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProjectRole } from "@/hooks/use-project-role";
import { isActionError } from "@workspace/api/lib/action-result";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

export function TrackExplicitToggle({
  trackId,
  explicit,
}: {
  trackId: number;
  explicit: boolean;
}) {
  const canEdit = useProjectRole()?.can?.("editor") ?? true;
  const mutate = useMutate();
  const [checked, setChecked] = useOptimistic(explicit);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  const onChange = (next: boolean) =>
    startTransition(async () => {
      setChecked(next);
      const result = await mutate(
        patchEntityFields("track", trackId, { explicit: next })
      );
      if (isActionError(result)) {
        toast.error(`Failed to update explicit: ${result.error}`);
        return;
      }
    });

  return (
    <RailLabel
      action={
        <Checkbox
          aria-label="Explicit"
          checked={checked}
          disabled={pending}
          onChange={(e) => onChange(e.target.checked)}
        />
      }
    >
      EXPLICIT
    </RailLabel>
  );
}
