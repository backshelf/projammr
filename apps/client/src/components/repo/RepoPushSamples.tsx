"use client";

import { setRepoPushSamples } from "@/actions/repos";
import { isActionError } from "@workspace/api/lib/action-result";
import { Switch } from "@workspace/ui/components/switch";
import { useId, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

/**
 * The repo's "Push samples" switch, optimistic like the other page toggles. An
 * editor flips it and the hub answers; a viewer sees the setting read-only (the
 * server refuses their write), and an instance that forces samples on shows it
 * on and locked, with the reason beneath.
 */
export function RepoPushSamples({
  repoId,
  pushSamples,
  forced,
  canEdit,
}: {
  repoId: number;
  /** The effective setting: on whenever the instance forces it. */
  pushSamples: boolean;
  forced: boolean;
  canEdit: boolean;
}) {
  const labelId = useId();
  const noteId = useId();
  const [checked, setChecked] = useOptimistic(pushSamples);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) =>
    startTransition(async () => {
      setChecked(next);
      const result = await setRepoPushSamples(repoId, next);
      if (isActionError(result)) {
        toast.error(`Failed to update push samples: ${result.error}`);
      }
    });

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-3">
        <span id={labelId} className="text-small text-ink">
          Push samples
        </span>
        <Switch
          aria-labelledby={labelId}
          aria-describedby={forced ? noteId : undefined}
          checked={forced || checked}
          disabled={forced || !canEdit || pending}
          onCheckedChange={onChange}
        />
      </div>
      {forced && (
        <p id={noteId} className="text-micro text-ink-soft">
          On for every repository on this instance.
        </p>
      )}
    </div>
  );
}
