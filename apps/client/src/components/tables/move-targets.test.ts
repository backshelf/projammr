import { describe, expect, it } from "bun:test";

import { movableTargets } from "./move-targets";

const projects = [
  { id: 3, name: "Vespers" },
  { id: 1, name: "Aubade" },
  { id: 2, name: "Nocturne" },
];

describe("movableTargets", () => {
  it("drops the project the row is already in", () => {
    expect(movableTargets(projects, 2).map((p) => p.id)).toEqual([1, 3]);
  });

  it("lists the rest by name", () => {
    expect(movableTargets(projects, 99).map((p) => p.name)).toEqual([
      "Aubade",
      "Nocturne",
      "Vespers",
    ]);
  });

  it("leaves the input untouched", () => {
    const input = [...projects];
    movableTargets(input, 1);
    expect(input).toEqual(projects);
  });

  it("has nothing to offer a user with one project", () => {
    expect(movableTargets([{ id: 1, name: "Aubade" }], 1)).toEqual([]);
  });
});
