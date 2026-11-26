"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

/**
 * Names and persists the table's current filter/sort/layout/grouping state as
 * a saved view. Shared by the desktop toolbar's saved-views popover and the
 * phone filter sheet, so there is exactly one place a view gets named and
 * saved rather than two forms that could drift.
 */
export function SaveViewForm({
  onSave,
  className,
}: {
  /** Persists the current view under `name`. Returns whether it saved. */
  onSave: (name: string) => Promise<boolean>;
  className?: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      if (await onSave(trimmed)) setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex gap-1", className)}>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Save current view as…"
        className="h-8 md:text-small"
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      <Button
        size="sm"
        disabled={busy || !name.trim()}
        onClick={() => void save()}
      >
        Save
      </Button>
    </div>
  );
}
