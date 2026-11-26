import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/components/command-palette/command-palette-context";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CommandPaletteProvider>{children}</CommandPaletteProvider>
);

describe("command palette context", () => {
  it("opens with an empty initial query on a plain open", () => {
    const { result } = renderHook(() => useCommandPalette(), { wrapper });
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    expect(result.current.initialQuery).toBe("");
  });

  it("opens with the seed from openWith", () => {
    const { result } = renderHook(() => useCommandPalette(), { wrapper });
    act(() => result.current.openWith("status "));
    expect(result.current.open).toBe(true);
    expect(result.current.initialQuery).toBe("status ");
  });

  it("drops the seed when the next open is plain", () => {
    const { result } = renderHook(() => useCommandPalette(), { wrapper });
    act(() => result.current.openWith("label "));
    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    expect(result.current.initialQuery).toBe("");
  });
});
