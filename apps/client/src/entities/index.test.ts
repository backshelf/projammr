import { ENTITIES, type StatusKind } from "@/entities";
import { describe, expect, it } from "bun:test";

describe("StatusKind", () => {
  it("is exactly the kinds whose module declares a status", () => {
    // Assignable both ways, so the type is pinned from both sides: a module
    // whose `hasStatus` widens to `boolean` collapses `StatusKind` to `never`
    // and fails the first line, and a kind leaking in fails the second.
    const declared: StatusKind[] = ["collection", "track"];
    const expected: ("collection" | "track")[] = declared;

    expect(
      (Object.keys(ENTITIES) as (keyof typeof ENTITIES)[]).filter(
        (kind) => ENTITIES[kind].hasStatus
      )
    ).toEqual(expected);
  });
});

describe("newRoute", () => {
  it("is declared by every kind that has a listRoute", () => {
    const missing = (Object.keys(ENTITIES) as (keyof typeof ENTITIES)[]).filter(
      (kind) => ENTITIES[kind].listRoute !== null && !ENTITIES[kind].newRoute
    );

    expect(missing).toEqual([]);
  });

  it("is null for project, which has no create page of its own", () => {
    expect(ENTITIES.project.newRoute).toBeNull();
  });
});
