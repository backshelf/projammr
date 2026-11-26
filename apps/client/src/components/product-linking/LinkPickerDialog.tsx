"use client";

import {
  EntityPicker,
  type PickerLoad,
} from "@/components/product-linking/EntityPicker";
import type { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import type { ReactNode } from "react";
import { toast } from "sonner";

/**
 * A dialog whose whole body is a picker: search the records that can be
 * linked, pick one, and the dialog closes. Each link the app offers supplies
 * what to load, how a row reads and what a pick persists, including whatever
 * that pick needs to refresh; the chrome and the failure toast are the same
 * for every one of them.
 */
export function LinkPickerDialog<T extends { id: number }>({
  open,
  onOpenChange,
  title,
  description,
  scope,
  scopeKey,
  load,
  matches,
  renderRow,
  placeholder,
  emptyLabel,
  link,
  linkedLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Controls above the picker that narrow what it loads. */
  scope?: ReactNode;
  /** Remounts the picker when the scope it loads from changes. */
  scopeKey?: string;
  /** Null while the scope is still unchosen, so there is nothing to search. */
  load: PickerLoad<T> | null;
  matches: (item: T, query: string) => boolean;
  renderRow: (item: T) => ReactNode;
  placeholder: string;
  emptyLabel: string;
  /** Persists the link. Its failure is reported and the dialog stays open. */
  link: (item: T) => Promise<unknown | ActionError>;
  linkedLabel: (item: T) => string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={"bg-paper"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {scope}

        {load && (
          <EntityPicker
            key={scopeKey}
            load={load}
            matches={matches}
            renderRow={renderRow}
            placeholder={placeholder}
            emptyLabel={emptyLabel}
            onPick={async (item) => {
              const result = await link(item);
              if (isActionError(result)) {
                toast.error(result.error);
                return false;
              }
              toast.success(linkedLabel(item));
              onOpenChange(false);
              return true;
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
