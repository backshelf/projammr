import { describe, expect, it } from "bun:test";
import { rawMemberRoleEnum } from "../schema/enums.js";
import {
  createMembershipCache,
  MEMBERSHIP_CACHE_TTL_MS,
  type MemberRole,
  roleSatisfies,
} from "./authorization.js";

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

describe("createMembershipCache", () => {
  it("returns cached roles and cached non-member nulls until TTL expiry", async () => {
    let clock = 1_000;
    const cache = createMembershipCache({
      ttlMs: MEMBERSHIP_CACHE_TTL_MS,
      now: () => clock,
    });

    let loads = 0;
    const loadEditor = async (): Promise<MemberRole | null> => {
      loads++;
      return "editor";
    };

    expect(await cache.getOrLoad("u1", 10, loadEditor)).toBe("editor");
    expect(await cache.getOrLoad("u1", 10, loadEditor)).toBe("editor");
    expect(loads).toBe(1);

    // Non-member null results are cached too.
    let outsiderLoads = 0;
    const loadNull = async (): Promise<MemberRole | null> => {
      outsiderLoads++;
      return null;
    };
    expect(await cache.getOrLoad("u2", 10, loadNull)).toBeNull();
    expect(await cache.getOrLoad("u2", 10, loadNull)).toBeNull();
    expect(outsiderLoads).toBe(1);

    // Still fresh just before the 15s boundary.
    clock += MEMBERSHIP_CACHE_TTL_MS - 1;
    expect(await cache.getOrLoad("u1", 10, loadEditor)).toBe("editor");
    expect(loads).toBe(1);

    // Expired at the 15s boundary.
    clock += 1;
    expect(await cache.getOrLoad("u1", 10, loadEditor)).toBe("editor");
    expect(loads).toBe(2);
  });

  it("supports pair, per-user, per-project, and full invalidation", () => {
    const clock = 10_000;
    const cache = createMembershipCache({ now: () => clock });

    cache.set("u1", 1, "owner");
    cache.set("u1", 2, "viewer");
    cache.set("u2", 1, "editor");
    cache.set("u2", 2, "admin");

    // Pair invalidation removes only (u1, 1).
    cache.invalidate("u1", 1);
    expect(cache.get("u1", 1)).toBeUndefined();
    expect(cache.get("u1", 2)).toBe("viewer");
    expect(cache.get("u2", 1)).toBe("editor");

    // Per-project invalidation removes all entries for project 2.
    cache.invalidate(undefined, 2);
    expect(cache.get("u1", 2)).toBeUndefined();
    expect(cache.get("u2", 2)).toBeUndefined();
    expect(cache.get("u2", 1)).toBe("editor");

    // Per-user invalidation removes all entries for u2.
    cache.set("u1", 3, "admin");
    cache.set("u2", 3, "viewer");
    cache.invalidate("u2");
    expect(cache.get("u2", 1)).toBeUndefined();
    expect(cache.get("u2", 3)).toBeUndefined();
    expect(cache.get("u1", 3)).toBe("admin");

    // Full invalidation clears everything.
    cache.invalidate();
    expect(cache.size).toBe(0);
    expect(cache.get("u1", 3)).toBeUndefined();
  });

  it("enforces bounded maxEntries by evicting expired then oldest entries", () => {
    let clock = 5_000;
    const cache = createMembershipCache({
      ttlMs: 1_000,
      maxEntries: 2,
      now: () => clock,
    });

    cache.set("u1", 1, "viewer");
    clock += 500;
    cache.set("u2", 1, "editor");
    expect(cache.size).toBe(2);

    // Adding a third live entry evicts the oldest (u1, 1).
    cache.set("u3", 1, "admin");
    expect(cache.size).toBe(2);
    expect(cache.get("u1", 1)).toBeUndefined();
    expect(cache.get("u2", 1)).toBe("editor");
    expect(cache.get("u3", 1)).toBe("admin");
  });

  it("does not populate a stale entry if invalidated while a load is in flight", async () => {
    const cache = createMembershipCache();
    let resolveLoad!: (role: MemberRole | null) => void;
    const pending = cache.getOrLoad(
      "u1",
      7,
      () =>
        new Promise<MemberRole | null>((resolve) => {
          resolveLoad = resolve;
        })
    );

    // Mutation invalidates the cache while the earlier SELECT is still running.
    cache.invalidate("u1", 7);
    resolveLoad("owner");

    expect(await pending).toBe("owner");
    expect(cache.get("u1", 7)).toBeUndefined();
  });
});
