import type { MemberRole } from "@workspace/api/api";

/** Roles ranked low to high, mirroring the server's own ordering. */
const roleRank: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Whether a role clears a requirement. Cosmetic only — every rule is enforced
 * again by the API, so a client that gets this wrong leaks no access.
 */
export function roleSatisfies(role: MemberRole, minRole: MemberRole): boolean {
  return roleRank[role] >= roleRank[minRole];
}
