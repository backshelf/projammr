"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import { Input } from "@workspace/ui/components/input";
import * as React from "react";

type PeekTitleEditorProps = {
  /** The row's current title: the input's seed and what "unchanged" means. */
  title: string;
  /** Persists the trimmed title; resolves `false` when the save failed. */
  onSave: (title: string) => Promise<boolean>;
  /** The editor is done, whether it saved, was dismissed or had nothing to save. */
  onEnd: () => void;
};

/**
 * The panel title as an input: Enter saves, Escape and blur put the text back.
 * A failed save stays open with its error so the draft is not lost.
 *
 * The panel names its dialog through a visually hidden `SheetTitle`, so this
 * is only the visible face and carries its own label.
 */
export function PeekTitleEditor({
  title,
  onSave,
  onEnd,
}: PeekTitleEditorProps) {
  const [draft, setDraft] = React.useState(title);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const errorId = React.useId();
  // A ref rather than state: a second Enter in the same tick must see it.
  const savingRef = React.useRef(false);
  const endedRef = React.useRef(false);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // A save that outlives its dismissal has nobody left to tell.
  const end = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEnd();
  };

  const submit = async () => {
    if (savingRef.current) return;
    const next = draft.trim();
    if (next === "") {
      setError("Title is required");
      return;
    }
    if (next === title) {
      end();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (await onSave(next)) end();
      else setError("Save failed");
    } catch {
      setError("Save failed");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      // The sheet closes on Escape; here it only ends the rename.
      event.preventDefault();
      event.stopPropagation();
      end();
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={end}
        readOnly={saving}
        aria-label="Title"
        aria-invalid={error != null}
        aria-describedby={error ? errorId : undefined}
        aria-busy={saving}
        className={
          error
            ? "h-9 border-danger bg-danger/20 text-lead"
            : "h-9 bg-paper/80 text-lead"
        }
      />
      {error && (
        <div
          id={errorId}
          role="alert"
          className="mt-1 flex items-center gap-1 text-small text-danger"
        >
          <IconAlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
