"use client";

import { Button } from "@workspace/ui/components/button";
import type { FormEventHandler, ReactNode } from "react";

/**
 * The one-line form a colour list opens in place of a row (or above the list,
 * to add): its fields, then Save and Cancel. Escape cancels from any field.
 * The fields carry their own accessible names, since a line has no room for
 * visible labels; `error` is the first validation message, announced when it
 * appears.
 */
export function InlineForm({
  label,
  onSubmit,
  onCancel,
  submitting,
  error,
  children,
}: {
  /** Names the form for assistive tech, e.g. "Edit Mixing". */
  label: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel: () => void;
  submitting: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <form
      aria-label={label}
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="flex min-h-11 flex-wrap items-center gap-2 rounded-md bg-paper-sunk px-2 py-1.5"
    >
      {children}
      <div className="ml-auto flex items-center gap-1">
        <Button type="submit" size="sm" disabled={submitting}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-ink-soft"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="basis-full text-micro text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
