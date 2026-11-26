"use client";

import { deletePriorityLevel } from "@/actions/priorities";
import {
  fallbackLevel,
  levelRowId,
  levelUsage,
  usageSentence,
} from "@/components/settings/priority-scale";
import { PriorityBadge } from "@/components/tables/Priority";
import { PriorityMenu } from "@/fields/priority";
import { toastActionResult } from "@/lib/action-toast";
import type { PriorityScaleLevel } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

/** What carries a level's delete out, and where focus goes once it has. */
export type LevelDeletion = {
  /** Moves the level's rows to `replacement` and deletes it, in one write. */
  remove: (
    level: PriorityScaleLevel,
    replacement: PriorityScaleLevel | undefined
  ) => Promise<void>;
  /**
   * Where focus goes as the confirm closes. Once the level is gone its bin
   * goes with it, so it moves to the row that took the level's rows rather
   * than back to the bin.
   */
  finalFocus: (
    replacement: PriorityScaleLevel | undefined
  ) => HTMLElement | true;
};

/** The write behind a level's delete, its toasts included. */
export function useLevelDeletion(projectId: number): LevelDeletion {
  const router = useRouter();
  const deletedRef = useRef(false);

  const remove: LevelDeletion["remove"] = async (level, replacement) => {
    deletedRef.current = false;
    if (!replacement) return;
    const result = await deletePriorityLevel(
      projectId,
      level.id,
      replacement.id
    );
    if (isActionError(result)) {
      toastActionResult({ ok: false, message: result.error });
      // Most refusals mean the scale changed elsewhere (the replacement
      // deleted, say); reload it so the next try starts from the server's.
      router.refresh();
      return;
    }
    deletedRef.current = true;
    const { total, words } = levelUsage(level.counts);
    toastActionResult({
      ok: true,
      message:
        total === 0
          ? `Deleted “${level.name}”`
          : `Deleted “${level.name}” and moved its ${words} to “${replacement.name}”`,
    });
  };

  const finalFocus: LevelDeletion["finalFocus"] = (replacement) =>
    (deletedRef.current &&
      replacement &&
      document.getElementById(levelRowId(replacement.id))) ||
    true;

  return { remove, finalFocus };
}

/**
 * The confirm behind a level's bin. It says how many tracks, collections and
 * sessions hold the level and asks which level takes them, the default
 * preselected; with one other level there is nothing to pick, so it is named
 * instead, and a level nothing holds asks nothing. `onConfirm` gets the level
 * that takes the rows. Never opened for the default, which cannot go.
 */
export function DeleteLevelDialog({
  level,
  levels,
  open,
  onOpenChange,
  onConfirm,
  finalFocus,
}: {
  level: PriorityScaleLevel;
  /** The whole scale, bottom level first. */
  levels: readonly PriorityScaleLevel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (replacement: PriorityScaleLevel | undefined) => Promise<void>;
  finalFocus: LevelDeletion["finalFocus"];
}) {
  const others = levels.filter((other) => other.id !== level.id);
  const fallback = fallbackLevel(levels, level);
  const [pickedId, setPickedId] = useState(fallback?.id);
  const replacement = others.find((other) => other.id === pickedId) ?? fallback;
  const { total } = levelUsage(level.counts);
  const pickerId = useId();

  const moveLabel = total === 1 ? "Move it to" : "Move them to";

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${level.name}”?`}
      description={usageSentence(level)}
      confirmLabel="Delete level"
      onConfirm={() => onConfirm(replacement)}
      finalFocus={() => finalFocus(replacement)}
    >
      {total > 0 &&
        replacement &&
        (others.length > 1 ? (
          <Field>
            <FieldLabel htmlFor={pickerId}>{moveLabel}</FieldLabel>
            <PriorityMenu
              id={pickerId}
              levels={others}
              value={replacement}
              onChange={(picked) => setPickedId(picked.id)}
              className="w-full md:text-small"
            />
          </Field>
        ) : (
          <p className="flex items-center gap-2">
            <span className={cn(LABEL, "text-ink-soft")}>{moveLabel}</span>
            <PriorityBadge level={replacement} />
          </p>
        ))}
    </ConfirmDeleteDialog>
  );
}
