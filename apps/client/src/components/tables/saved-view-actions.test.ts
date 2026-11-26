import { describe, expect, it } from "bun:test";

import type { MemberRole } from "@workspace/api/api";
import { savedViewActions } from "./saved-view-actions";

const canFor =
  (role: MemberRole) =>
  (minRole: MemberRole): boolean => {
    const rank: Record<MemberRole, number> = {
      viewer: 0,
      editor: 1,
      admin: 2,
      owner: 3,
    };
    return rank[role] >= rank[minRole];
  };

const OWNED = { ownerId: "me" };
const OTHERS = { ownerId: "them" };

describe("savedViewActions", () => {
  it("offers share and delete on an own view when the caller can edit", () => {
    expect(savedViewActions(OWNED, "me", canFor("editor"))).toEqual({
      share: true,
      delete: true,
    });
  });

  it("withholds both on an own view for a viewer, even though they own it", () => {
    expect(savedViewActions(OWNED, "me", canFor("viewer"))).toEqual({
      share: false,
      delete: false,
    });
  });

  it("offers only delete on another member's view for an admin", () => {
    expect(savedViewActions(OTHERS, "me", canFor("admin"))).toEqual({
      share: false,
      delete: true,
    });
  });

  it("offers neither on another member's view for an editor", () => {
    expect(savedViewActions(OTHERS, "me", canFor("editor"))).toEqual({
      share: false,
      delete: false,
    });
  });

  it("withholds both, admin delete included, when the caller id is unreadable", () => {
    expect(savedViewActions(OWNED, "", canFor("admin"))).toEqual({
      share: false,
      delete: false,
    });
  });

  it("withholds both outside a project route, where the role is null", () => {
    expect(savedViewActions(OWNED, "me", null)).toEqual({
      share: false,
      delete: false,
    });
  });
});
