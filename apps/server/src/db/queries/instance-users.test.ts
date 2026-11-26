import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import type { db } from "../index.js";
import { authSessions, users } from "../schema/auth.js";
import {
  oauthAccessTokens,
  oauthClients,
  oauthRefreshTokens,
} from "../schema/oauth.js";
import { mkUserRow, withMigratedDatabase } from "../../test/database.js";
import { changeInstanceUser } from "./instance-users.js";

/**
 * Every test here runs against a database of its own: a single-admin instance
 * is a state the shared development database left behind long ago and that no
 * test could restore without breaking every other one.
 */
type Database = typeof db;

const mkSessionRow = (database: Database, userId: string) =>
  database.insert(authSessions).values({
    id: randomUUID(),
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date(),
    userId,
  });

describe("changeInstanceUser", () => {
  it("refuses to demote or disable the last admin", async () => {
    await withMigratedDatabase(async (database) => {
      const admin = await mkUserRow(database, { instanceRole: "admin" });

      await expect(
        changeInstanceUser(admin, { instanceRole: "user" }, admin, database)
      ).rejects.toThrow(/at least one admin|keep one admin/i);
      await expect(
        changeInstanceUser(admin, { disabled: true }, admin, database)
      ).rejects.toThrow(/at least one admin|keep one admin/i);

      const [row] = await database
        .select({
          instanceRole: users.instanceRole,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(eq(users.id, admin));
      expect(row).toEqual({ instanceRole: "admin", disabledAt: null });
    });
  }, 30_000);

  it("demotes an admin while another one is left", async () => {
    await withMigratedDatabase(async (database) => {
      const first = await mkUserRow(database, { instanceRole: "admin" });
      await mkUserRow(database, { instanceRole: "admin" });

      const changed = await changeInstanceUser(
        first,
        { instanceRole: "user" },
        first,
        database
      );

      expect(changed.instanceRole).toBe("user");
      expect(changed.disabled).toBe(false);
    });
  }, 30_000);

  it("counts only admins who can sign in, so a disabled one is not the last", async () => {
    await withMigratedDatabase(async (database) => {
      const active = await mkUserRow(database, { instanceRole: "admin" });
      await mkUserRow(database, {
        instanceRole: "admin",
        disabledAt: new Date(),
      });

      await expect(
        changeInstanceUser(active, { instanceRole: "user" }, active, database)
      ).rejects.toThrow(/keep one admin/i);
    });
  }, 30_000);

  it("revokes every session and OAuth token of an account it disables", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { instanceRole: "admin" });
      const target = await mkUserRow(database);
      await mkSessionRow(database, target);
      await mkSessionRow(database, target);

      const clientId = `client-${randomUUID()}`;
      await database.insert(oauthClients).values({
        id: randomUUID(),
        clientId,
        redirectUris: ["http://localhost/callback"],
      });
      const refreshId = randomUUID();
      await database.insert(oauthRefreshTokens).values({
        id: refreshId,
        token: randomUUID(),
        clientId,
        userId: target,
        expiresAt: new Date(Date.now() + 60_000),
        scopes: ["read"],
      });
      await database.insert(oauthAccessTokens).values({
        id: randomUUID(),
        token: randomUUID(),
        clientId,
        userId: target,
        refreshId,
        expiresAt: new Date(Date.now() + 60_000),
        scopes: ["read"],
      });

      const changed = await changeInstanceUser(
        target,
        { disabled: true },
        target,
        database
      );

      expect(changed.disabled).toBe(true);
      const sessions = await database
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(eq(authSessions.userId, target));
      const accessTokens = await database
        .select({ id: oauthAccessTokens.id })
        .from(oauthAccessTokens)
        .where(eq(oauthAccessTokens.userId, target));
      const refreshTokens = await database
        .select({ id: oauthRefreshTokens.id })
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.userId, target));
      expect(sessions).toHaveLength(0);
      expect(accessTokens).toHaveLength(0);
      expect(refreshTokens).toHaveLength(0);
    });
  }, 30_000);

  it("clears the flag and lets a disabled account back in", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { instanceRole: "admin" });
      const target = await mkUserRow(database, { disabledAt: new Date() });

      const changed = await changeInstanceUser(
        target,
        { disabled: false },
        target,
        database
      );

      expect(changed.disabled).toBe(false);
    });
  }, 30_000);
});
