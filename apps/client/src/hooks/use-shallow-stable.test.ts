import { useShallowStable } from "@/hooks/use-shallow-stable";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "bun:test";

describe("useShallowStable", () => {
  it("holds the first object while every member matches", () => {
    const columns = ["title"];
    const first = { columns, embedded: false };
    const { result, rerender } = renderHook(
      (value: object) => useShallowStable(value),
      { initialProps: first }
    );

    rerender({ columns, embedded: false });

    expect(result.current).toBe(first);
  });

  it("takes the new object when a member changes", () => {
    const { result, rerender } = renderHook(
      (value: object) => useShallowStable(value),
      { initialProps: { columns: ["title"] } }
    );

    const changed = { columns: ["title", "priority"] };
    rerender(changed);

    expect(result.current).toBe(changed);
  });

  it("takes the new object when a member is added or removed", () => {
    // One `columns` array throughout, so only the added or removed key sets
    // the objects apart.
    const columns = ["title"];
    const { result, rerender } = renderHook(
      (value: object) => useShallowStable(value),
      { initialProps: { columns } as Record<string, unknown> }
    );

    const widened = { columns, subRows: {} };
    rerender(widened);
    expect(result.current).toBe(widened);

    const narrowed = { columns };
    rerender(narrowed);
    expect(result.current).toBe(narrowed);
  });

  it("distinguishes a missing key from one holding undefined", () => {
    const first: Record<string, unknown> = { a: undefined };
    const { result, rerender } = renderHook(
      (value: object) => useShallowStable(value),
      { initialProps: first }
    );

    const other = { b: undefined };
    rerender(other);

    expect(result.current).toBe(other);
  });
});
