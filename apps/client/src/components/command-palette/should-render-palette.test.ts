import { describe, expect, it } from "bun:test";
import { shouldRenderPalette } from "./should-render-palette";

const NO_ROUTE = { kind: "not-found" } as const;

describe("shouldRenderPalette", () => {
  it("renders inside a project on a resolvable route", () => {
    expect(shouldRenderPalette(1, { kind: "project" })).toBe(true);
    expect(shouldRenderPalette(1, { kind: "track", trackId: 9 })).toBe(true);
  });

  it("hides an unresolvable route inside a project", () => {
    expect(shouldRenderPalette(1, NO_ROUTE)).toBe(false);
  });

  // Off `/project/:id` there is no route to resolve: `/profile`, `/settings`,
  // `/notes`, `/` and `/invite/*` all reach the palette with no project.
  it("renders on every signed-in page outside a project", () => {
    expect(shouldRenderPalette(undefined, NO_ROUTE)).toBe(true);
  });
});
