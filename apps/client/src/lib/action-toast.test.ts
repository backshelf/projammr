import type { TableActionResult } from "@/components/tables/generic-table-types";
import { beforeEach, describe, expect, it, mock } from "bun:test";

type ToastOptions = {
  id?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  onAutoClose?: () => void;
};
const toastSuccess = mock<(message: string, options?: ToastOptions) => void>();
const toastError = mock<(message: string) => void>();
const toastDismiss = mock<(id: string) => void>();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, dismiss: toastDismiss },
}));

const { hasUndo, subscribeUndo, toastActionResult, undoLast } =
  await import("@/lib/action-toast");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const UNDO_WINDOW_MS = 9000;

const undoing = (message: string) =>
  mock(async (): Promise<TableActionResult> => ({ ok: true, message }));

/** Closes every toast still offering Undo, as sonner does when each times out. */
function autoCloseAll() {
  for (const call of [...toastSuccess.mock.calls]) {
    call[1]?.onAutoClose?.();
  }
}

beforeEach(() => {
  autoCloseAll();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastDismiss.mockClear();
});

describe("toastActionResult", () => {
  it("shows a success toast without an Undo when the result has none", () => {
    toastActionResult({ ok: true, message: "Archived" }, UNDO_WINDOW_MS);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("Archived");
    expect(toastSuccess.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("shows an error toast for a failed result", () => {
    toastActionResult({ ok: false, message: "Nope" }, UNDO_WINDOW_MS);
    expect(toastError).toHaveBeenCalledWith("Nope");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps a toast offering Undo up for the undo window", () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Back",
    }));
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    expect(toastSuccess.mock.calls[0]?.[1]?.duration).toBe(UNDO_WINDOW_MS);
  });

  it("runs the undo from its button and shows that result", async () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Restored",
    }));
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    const action = toastSuccess.mock.calls[0]?.[1]?.action;
    expect(action?.label).toBe("Undo");
    action?.onClick();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[1]?.[0]).toBe("Restored");
  });

  it("shows an error toast when the undo fails, without retrying", async () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: false,
      message: "Could not restore",
    }));
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    toastSuccess.mock.calls[0]?.[1]?.action?.onClick();
    await flush();
    expect(toastError).toHaveBeenCalledWith("Could not restore");
    expect(undo).toHaveBeenCalledTimes(1);
  });
});

describe("the undo stack", () => {
  it("holds nothing until a toast offers Undo", () => {
    toastActionResult({ ok: true, message: "Archived" }, UNDO_WINDOW_MS);
    toastActionResult({ ok: false, message: "Nope" }, UNDO_WINDOW_MS);
    expect(hasUndo()).toBe(false);
    undoLast();
    expect(toastDismiss).not.toHaveBeenCalled();
  });

  it("gains an entry when a toast offering Undo is shown", () => {
    toastActionResult(
      { ok: true, message: "Archived", undo: undoing("Back") },
      UNDO_WINDOW_MS
    );
    expect(hasUndo()).toBe(true);
  });

  it("loses the entry when its toast is dismissed", () => {
    toastActionResult(
      { ok: true, message: "Archived", undo: undoing("Back") },
      UNDO_WINDOW_MS
    );
    toastSuccess.mock.calls[0]?.[1]?.onDismiss?.();
    expect(hasUndo()).toBe(false);
  });

  it("loses the entry when its toast times out", () => {
    toastActionResult(
      { ok: true, message: "Archived", undo: undoing("Back") },
      UNDO_WINDOW_MS
    );
    toastSuccess.mock.calls[0]?.[1]?.onAutoClose?.();
    expect(hasUndo()).toBe(false);
  });

  it("loses the entry when the button runs its Undo", async () => {
    const undo = undoing("Back");
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    toastSuccess.mock.calls[0]?.[1]?.action?.onClick();
    expect(hasUndo()).toBe(false);
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("runs the newest live entry's undo, closes its toast and shows the result", async () => {
    const older = undoing("Older back");
    const newer = undoing("Newer back");
    toastActionResult(
      { ok: true, message: "First", undo: older },
      UNDO_WINDOW_MS
    );
    toastActionResult(
      { ok: true, message: "Second", undo: newer },
      UNDO_WINDOW_MS
    );
    const newerToastId = toastSuccess.mock.calls[1]?.[1]?.id;

    undoLast();
    await flush();

    expect(toastDismiss).toHaveBeenCalledWith(newerToastId);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
    expect(toastSuccess.mock.calls[2]?.[0]).toBe("Newer back");
    expect(hasUndo()).toBe(true);
  });

  it("falls back to the older entry once the newest is gone", async () => {
    const older = undoing("Older back");
    toastActionResult(
      { ok: true, message: "First", undo: older },
      UNDO_WINDOW_MS
    );
    toastActionResult(
      { ok: true, message: "Second", undo: undoing("Newer back") },
      UNDO_WINDOW_MS
    );
    toastSuccess.mock.calls[1]?.[1]?.onAutoClose?.();

    undoLast();
    await flush();

    expect(older).toHaveBeenCalledTimes(1);
  });

  it("gives the undo's own toast an entry when that result offers an Undo", async () => {
    const redo = undoing("Done again");
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Back",
      undo: redo,
    }));
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    undoLast();
    await flush();
    expect(hasUndo()).toBe(true);
    undoLast();
    await flush();
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("runs the undo once when the button and `undoLast` both fire", async () => {
    const undo = undoing("Back");
    toastActionResult({ ok: true, message: "Archived", undo }, UNDO_WINDOW_MS);
    toastSuccess.mock.calls[0]?.[1]?.action?.onClick();
    undoLast();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("tells subscribers when an entry is added and when it goes, and stops after unsubscribe", () => {
    const listener = mock();
    const unsubscribe = subscribeUndo(listener);
    toastActionResult(
      { ok: true, message: "Archived", undo: undoing("Back") },
      UNDO_WINDOW_MS
    );
    expect(listener).toHaveBeenCalledTimes(1);
    toastSuccess.mock.calls[0]?.[1]?.onDismiss?.();
    expect(listener).toHaveBeenCalledTimes(2);
    toastSuccess.mock.calls[0]?.[1]?.onDismiss?.();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toastActionResult(
      { ok: true, message: "Again", undo: undoing("Back") },
      UNDO_WINDOW_MS
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
