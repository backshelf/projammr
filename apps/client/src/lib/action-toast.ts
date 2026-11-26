import type { TableActionResult } from "@/components/tables/generic-table-types";
import { toast } from "sonner";

/** A toast that is offering Undo right now. */
type UndoEntry = {
  toastId: string;
  /** Runs the action's undo and shows its own result, as the button does. */
  run: () => void;
};

/** The live Undo toasts, oldest first; an entry lives exactly as long as its toast. */
let undoStack: readonly UndoEntry[] = [];
let nextToastId = 0;
const undoListeners = new Set<() => void>();

function setUndoStack(next: readonly UndoEntry[]) {
  undoStack = next;
  for (const listener of undoListeners) listener();
}

function closeEntry(entry: UndoEntry) {
  if (undoStack.includes(entry)) {
    setUndoStack(undoStack.filter((live) => live !== entry));
  }
}

/** Whether a toast is offering Undo. */
export function hasUndo(): boolean {
  return undoStack.length > 0;
}

/** Tells `listener` whenever a toast starts or stops offering Undo. */
export function subscribeUndo(listener: () => void): () => void {
  undoListeners.add(listener);
  return () => {
    undoListeners.delete(listener);
  };
}

/**
 * Closes the newest toast still offering Undo and runs what its Undo button
 * runs. Does nothing when no toast offers one.
 */
export function undoLast(): void {
  const entry = undoStack.at(-1);
  if (!entry) return;
  toast.dismiss(entry.toastId);
  entry.run();
}

/**
 * Shows a table action's result: a success toast, with an Undo button when the
 * result carries one (its own result is shown the same way), or an error toast.
 * A toast offering Undo stays up for `undoWindowMs`, the feedback policy's
 * undo window, so the Undo is on offer for exactly that long; a caller whose
 * results never carry an Undo leaves it out. While it is up, `undoLast` can
 * run that Undo too.
 */
export function toastActionResult(
  result: TableActionResult,
  undoWindowMs?: number
): void {
  if (!result.ok) {
    toast.error(result.message);
    return;
  }
  const { undo } = result;
  if (!undo) {
    toast.success(result.message, undefined);
    return;
  }
  const entry: UndoEntry = {
    toastId: `undo-${nextToastId++}`,
    run() {
      closeEntry(entry);
      void undo().then((undone) => toastActionResult(undone, undoWindowMs));
    },
  };
  const close = () => closeEntry(entry);
  toast.success(result.message, {
    id: entry.toastId,
    duration: undoWindowMs,
    action: { label: "Undo", onClick: entry.run },
    onDismiss: close,
    onAutoClose: close,
  });
  setUndoStack([...undoStack, entry]);
}
