import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import type { db } from "../index.js";
import { withMigratedDatabase } from "../../test/database.js";
import { users } from "../schema/auth.js";
import { adminAudit } from "../schema/admin-audit.js";
import { recordAdminAction } from "./admin-audit.js";
import { changeInstanceUser } from "./instance-users.js";
import { deleteAccount } from "./account-deletion.js";

type Database = typeof db;

/** An account written straight to the row, the way Better Auth's adapter would. */
async function mkUser(
  database: Database,
  overrides: { instanceRole?: "admin" | "user"; disabled?: boolean } = {}
): Promise<string> {
  const id = randomUUID();
  await database.insert(users).values({
    id,
    name: id.slice(0, 8),
    email: `${id}@example.com`,
    instanceRole: overrides.instanceRole ?? "user",
    disabledAt: overrides.disabled ? new Date() : null,
  });
  return id;
}

const rowsAbout = (database: Database, targetUserId: string) =>
  database
    .select()
    .from(adminAudit)
    .where(eq(adminAudit.targetUserId, targetUserId));

describe("recordAdminAction", () => {
  it("writes a row naming the actor and the target", async () => {
    await withMigratedDatabase(async (database) => {
      const admin = await mkUser(database, { instanceRole: "admin" });
      const target = await mkUser(database);

      await recordAdminAction(
        { action: "reset_link_issued", actorId: admin, targetUserId: target },
        database
      );

      const [row] = await rowsAbout(database, target);
      expect(row).toMatchObject({
        action: "reset_link_issued",
        actorId: admin,
        targetUserId: target,
      });
      expect(row?.actorEmail).toContain(admin);
      expect(row?.targetEmail).toContain(target);
    });
  }, 30_000);

  it("survives the target account being deleted, still naming who it was about", async () => {
    await withMigratedDatabase(async (database) => {
      const admin = await mkUser(database, { instanceRole: "admin" });
      const target = await mkUser(database);
      const targetEmail = `${target}@example.com`;

      await recordAdminAction(
        {
          action: "account_disabled",
          actorId: admin,
          targetUserId: target,
        },
        database
      );

      await database.delete(users).where(eq(users.id, target));

      // targetUserId is now unset by the FK's own ON DELETE SET NULL; the row
      // is found by its snapshot instead.
      const [row] = await database
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.targetEmail, targetEmail));
      expect(row).toBeTruthy();
      expect(row?.targetUserId).toBeNull();
      expect(row?.targetEmail).toBe(targetEmail);
    });
  }, 30_000);
});

describe("changeInstanceUser audit trail", () => {
  it("writes a role_changed row and a disabled row for a combined patch", async () => {
    await withMigratedDatabase(async (database) => {
      const admin = await mkUser(database, { instanceRole: "admin" });
      const target = await mkUser(database);

      await changeInstanceUser(
        target,
        { instanceRole: "admin", disabled: true },
        admin,
        database
      );

      const rows = await rowsAbout(database, target);
      const actions = rows.map((row) => row.action).sort();
      expect(actions).toEqual(["account_disabled", "role_changed"]);
      expect(rows.every((row) => row.actorId === admin)).toBe(true);
    });
  }, 30_000);

  it("audits the enable beside the promotion when a disabled account is made admin", async () => {
    await withMigratedDatabase(async (database) => {
      const target = await mkUser(database, { disabled: true });

      // The patch `scripts/make-admin.ts` sends: the un-disable rides along
      // with the promotion rather than going in as a direct `disabledAt`
      // write, which this function cannot see and so cannot audit.
      await changeInstanceUser(
        target,
        { instanceRole: "admin", disabled: false },
        target,
        database
      );

      const rows = await rowsAbout(database, target);
      expect(rows.map((row) => row.action).sort()).toEqual([
        "account_enabled",
        "role_changed",
      ]);
      expect(rows.every((row) => row.actorId === target)).toBe(true);

      const [row] = await database
        .select({
          instanceRole: users.instanceRole,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(eq(users.id, target));
      expect(row).toMatchObject({ instanceRole: "admin", disabledAt: null });
    });
  }, 30_000);

  it("writes nothing when the patch changes neither role nor disabled state", async () => {
    await withMigratedDatabase(async (database) => {
      const admin = await mkUser(database, { instanceRole: "admin" });
      const target = await mkUser(database, { instanceRole: "user" });

      await changeInstanceUser(
        target,
        { instanceRole: "user" },
        admin,
        database
      );

      expect(await rowsAbout(database, target)).toHaveLength(0);
    });
  }, 30_000);
});

describe("deleteAccount audit trail", () => {
  it("records a self-deletion that survives the account actually going", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUser(database, { instanceRole: "admin" });
      const target = await mkUser(database);
      const targetEmail = `${target}@example.com`;

      await deleteAccount(target, database);
      // deleteAccount is the beforeDelete hook body: Better Auth drops the
      // `users` row itself right after it returns.
      await database.delete(users).where(eq(users.id, target));

      const [row] = await database
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.targetEmail, targetEmail));
      expect(row).toMatchObject({
        action: "account_self_deleted",
        targetUserId: null,
        actorId: null,
        targetEmail,
        actorEmail: targetEmail,
      });
    });
  }, 30_000);
});
