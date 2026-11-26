import { describe, expect, it } from "bun:test";
import { rawMemberRoleEnum } from "../schema/enums.js";
import { type MemberRole, roleSatisfies } from "./authorization.js";

/**
 * The whole matrix rather than a sample: this decides who may write to a
 * project, so a rank added or reordered in `rawMemberRoleEnum` should fail
 * here rather than quietly widen a gate.
 */
const RANKS: MemberRole[] = ["viewer", "editor", "admin", "owner"];

describe("roleSatisfies", () => {
  it("covers every role in the enum", () => {
    expect([...RANKS].sort()).toEqual([...rawMemberRoleEnum].sort());
  });

  it.each(
    RANKS.flatMap((role, held) =>
      RANKS.map((minRole, required) => ({
        role,
        minRole,
        expected: held >= required,
      }))
    )
  )("$role satisfies $minRole: $expected", ({ role, minRole, expected }) => {
    expect(roleSatisfies(role, minRole)).toBe(expected);
  });
});
