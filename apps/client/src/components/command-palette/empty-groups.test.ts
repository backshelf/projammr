import { describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import { emptyQueryGroups } from "./empty-groups";

const full = { actions: 4, "recent-tracks": 5, "recent-sessions": 2 };

describe("emptyQueryGroups", () => {
  it("offers the actions, then recent tracks, then recent sessions, by default", () => {
    expect(emptyQueryGroups(DEFAULT_SHELL.paletteEmptyGroups, full)).toEqual({
      groups: ["actions", "recent-tracks", "recent-sessions"],
      none: false,
    });
  });

  it("offers the policy's groups in its order, and only those", () => {
    expect(
      emptyQueryGroups(["recent-sessions", "actions"], full).groups
    ).toEqual(["recent-sessions", "actions"]);
  });

  it("offers a group listed twice once", () => {
    expect(
      emptyQueryGroups(["recent-tracks", "recent-tracks"], full).groups
    ).toEqual(["recent-tracks"]);
  });

  it("leaves out a group with nothing in it", () => {
    expect(
      emptyQueryGroups(DEFAULT_SHELL.paletteEmptyGroups, {
        ...full,
        "recent-tracks": 0,
      }).groups
    ).toEqual(["actions", "recent-sessions"]);
  });

  it("says there is nothing when every listed group is empty, or none is listed", () => {
    expect(
      emptyQueryGroups(["recent-tracks"], { ...full, "recent-tracks": 0 }).none
    ).toBe(true);
    expect(emptyQueryGroups([], full).none).toBe(true);
  });
});
