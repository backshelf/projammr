"use client";

import { fieldKind } from "@/fields";
import { FloatingFieldError } from "@/fields/input";
import type { FieldValue } from "@/fields/types";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useState } from "react";

import type { CellValue, EditableCellConfig } from "./generic-table-types";

export interface EditableCellProps {
  value: FieldValue;
  /**
   * What the cell shows while not editing — the column's own rendered output
   * (a thumbnail and link, a badge), so an editable column keeps its
   * treatment. Falls back to the kind's `Display`, then to the formatted value.
   */
  display?: ReactNode;
  /** The column's field kind and its config; the kind supplies the editor. */
  config: EditableCellConfig;
  /**
   * Persists the edit. Returns whether the save succeeded — a `false` result
   * keeps the cell in edit mode and surfaces a validation message.
   */
  onSave: (value: CellValue) => Promise<boolean>;
  /**
   * Whether the cell is currently in edit mode. Owned by the table so keyboard
   * navigation (Enter on the focused cell), a double click, and a click on the
   * already-selected cell all open the same editor, and only one cell edits at
   * a time.
   */
  isEditing: boolean;
  /**
   * The text the current edit starts from in place of the value's own — the
   * character typed on the cell to open it. Read when the editor mounts, so it
   * only matters while `isEditing`.
   */
  seed?: string;
  /** Leave edit mode — after a save, an Escape, or a click elsewhere. */
  onEditEnd: () => void;
}

/**
 * Which editor mount this is, and the text it starts from. A rejected save
 * starts a new one, seeded with what was rejected, so the editor is ready for
 * another try whatever state it had settled into.
 */
type EditorMount = { attempt: number; seed?: string };

const FIRST_MOUNT: EditorMount = { attempt: 0 };

export default function EditableCell({
  value,
  display,
  config,
  onSave,
  isEditing,
  seed,
  onEditEnd,
}: EditableCellProps) {
  const kind = fieldKind(config.type);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mount, setMount] = useState(FIRST_MOUNT);

  const text = kind.format(value, config);
  const isEmpty = text === "";

  // Start each edit clean, using the render-phase previous-value pattern
  // rather than an effect.
  const [wasEditing, setWasEditing] = useState(isEditing);
  if (isEditing !== wasEditing) {
    setWasEditing(isEditing);
    if (isEditing) {
      setError(null);
      setMount(FIRST_MOUNT);
    }
  }

  const commit = async (committed: FieldValue) => {
    setError(null);
    setIsSaving(true);
    try {
      const ok = await onSave(committed);
      if (!ok) {
        setError("Save failed — try again");
        setMount((prev) => ({
          attempt: prev.attempt + 1,
          seed: kind.format(committed, config),
        }));
        return;
      }
      onEditEnd();
    } finally {
      setIsSaving(false);
    }
  };

  // A save in flight decides the edit; a blur or Escape meanwhile changes nothing.
  const cancelEdit = () => {
    if (isSaving) return;
    setError(null);
    onEditEnd();
  };

  if (!isEditing) {
    const Display = kind.Display;
    return (
      <div
        className={cn(
          "-mx-1.5 flex h-full items-center rounded-sm px-1.5 motion-ink fine:hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]",
          isSaving ? "pointer-events-none opacity-50" : ""
        )}
        title={isEmpty ? undefined : text}
      >
        {isEmpty ? (
          <span className="truncate text-body">—</span>
        ) : (
          (display ??
          (Display ? (
            <Display value={value} config={config} />
          ) : (
            <span className="truncate text-body">{text}</span>
          )))
        )}
      </div>
    );
  }

  const Editor = kind.Editor;
  return (
    <div
      className={cn(
        "relative flex w-full items-center",
        isSaving ? "pointer-events-none opacity-50" : ""
      )}
    >
      {Editor && (
        <Editor
          key={mount.attempt}
          value={value}
          config={config}
          seed={mount.seed ?? seed}
          onCommit={(committed) => void commit(committed)}
          onCancel={cancelEdit}
        />
      )}
      {error && <FloatingFieldError message={error} />}
    </div>
  );
}
