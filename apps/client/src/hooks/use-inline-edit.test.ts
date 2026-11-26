import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { CLEAR as ClearMarker } from "./use-inline-edit";

const patchField = mock(async () => ({ id: 1 }));
mock.module("@/actions/patch-field", () => ({ patchField }));

const { CLEAR, useInlineEdit } = await import("./use-inline-edit");

afterEach(() => {
  patchField.mockClear();
});

describe("useInlineEdit", () => {
  it("saves null when prepare returns CLEAR", async () => {
    const { result } = renderHook(() =>
      useInlineEdit({
        entityType: "collection",
        entityId: 1,
        fieldName: "releaseDate",
        value: "2026-01-01",
        prepare: (draft): string | typeof ClearMarker =>
          draft ? draft : (CLEAR as typeof ClearMarker),
      })
    );

    act(() => result.current.setDraft(""));
    await act(async () => {
      await result.current.submit();
    });

    expect(patchField).toHaveBeenCalledWith(
      "collection",
      1,
      "releaseDate",
      null
    );
  });

  it("still refuses a blank draft when prepare returns null", async () => {
    const { result } = renderHook(() =>
      useInlineEdit({
        entityType: "collection",
        entityId: 1,
        fieldName: "title",
        value: "Old title",
      })
    );

    act(() => result.current.begin());
    act(() => result.current.setDraft(""));
    await act(async () => {
      await result.current.submit();
    });

    expect(patchField).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(true);
  });
});
