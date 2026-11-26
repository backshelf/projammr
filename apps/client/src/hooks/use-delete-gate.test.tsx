import { describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { ReactNode } from "react";
import { useDeleteGate } from "./use-delete-gate";

const withStatusConfirm =
  (confirm: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <PoliciesProvider
      policies={{
        ...DEFAULT_POLICIES,
        feedback: {
          ...DEFAULT_POLICIES.feedback,
          confirmDeletes: {
            ...DEFAULT_POLICIES.feedback.confirmDeletes,
            status: confirm,
          },
        },
      }}
    >
      {children}
    </PoliciesProvider>
  );

describe("useDeleteGate", () => {
  it("opens the confirm for a request and deletes nothing until confirmed", async () => {
    const remove = mock();
    const { result } = renderHook(() =>
      useDeleteGate<number>("status", remove)
    );

    act(() => result.current.request(7));

    expect(result.current.dialog.open).toBe(true);
    expect(result.current.pending).toBe(7);
    expect(remove).not.toHaveBeenCalled();

    await act(() => result.current.dialog.onConfirm());

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("deletes nothing once dismissed, keeping the target for the copy as it closes", async () => {
    const remove = mock();
    const { result } = renderHook(() =>
      useDeleteGate<number>("status", remove)
    );

    act(() => result.current.request(7));
    act(() => result.current.dialog.onOpenChange(false));

    expect(result.current.dialog.open).toBe(false);
    expect(result.current.pending).toBe(7);

    await act(() => result.current.dialog.onConfirm());

    expect(remove).not.toHaveBeenCalled();
  });

  it("asks about the latest request after an earlier one was dismissed", async () => {
    const remove = mock();
    const { result } = renderHook(() =>
      useDeleteGate<number>("status", remove)
    );

    act(() => result.current.request(7));
    act(() => result.current.dialog.onOpenChange(false));
    act(() => result.current.request(8));
    await act(() => result.current.dialog.onConfirm());

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(8);
  });

  it("opens for a single thing to delete, requested with no target", () => {
    const { result } = renderHook(() => useDeleteGate<void>("status", mock()));

    act(() => result.current.request());

    expect(result.current.dialog.open).toBe(true);
  });

  it("deletes at once, with no confirm, when the kind's confirm is off", () => {
    const remove = mock();
    const { result } = renderHook(
      () => useDeleteGate<number>("status", remove),
      { wrapper: withStatusConfirm(false) }
    );

    act(() => result.current.request(7));

    expect(remove).toHaveBeenCalledWith(7);
    expect(result.current.dialog.open).toBe(false);
  });

  it("still asks for another kind while one kind's confirm is off", () => {
    const remove = mock();
    const { result } = renderHook(() => useDeleteGate<void>("label", remove), {
      wrapper: withStatusConfirm(false),
    });

    act(() => result.current.request());

    expect(result.current.dialog.open).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps its request stable across renders", () => {
    const { result, rerender } = renderHook(() =>
      useDeleteGate("status", () => {})
    );
    const first = result.current.request;

    rerender();

    expect(result.current.request).toBe(first);
  });
});
