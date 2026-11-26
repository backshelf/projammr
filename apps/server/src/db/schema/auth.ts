import { getTableColumns } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { instanceRoleEnum, rawInstanceRoleEnum } from "./enums.js";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").default(false),
  /**
   * What the account may do to the instance itself. Declared to Better Auth as
   * a read-only `additionalFields` entry, so nothing a sign-up sends can set
   * it: the only writes are the first-user bootstrap
   * (`db/queries/settings.ts`) and an admin's own
   * `PATCH /admin/users/:id`.
   */
  instanceRole: instanceRoleEnum("instance_role").notNull().default("user"),
  /**
   * When an admin disabled the account. A disabled account keeps its rows —
   * its tracks, comments and memberships all still name it — but its sessions
   * stop resolving and it cannot sign in again until the flag is cleared.
   */
  disabledAt: timestamp("disabled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export type InstanceRole = (typeof rawInstanceRoleEnum)[number];

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const userSchema = createSelectSchema(users);

/**
 * A user as anyone sharing a project with them may read it. An email address is
 * contact detail rather than public identity, so it stays out of member lists
 * and activity feeds; the admin-only invite list carries it because inviting by
 * address is what that list is for. How the account stands with the instance —
 * its role and whether it is disabled — is the administration surface's
 * business, not a collaborator's.
 */
export const publicUserSchema = userSchema.omit({
  email: true,
  instanceRole: true,
  disabledAt: true,
});

/** The `users` columns `publicUserSchema` describes, for a `select`. */
export const {
  email: _email,
  instanceRole: _instanceRole,
  disabledAt: _disabledAt,
  ...publicUserColumns
} = getTableColumns(users);

/** The same set as a relational-query `columns` mask. */
export const publicUserMask = {
  email: false,
  instanceRole: false,
  disabledAt: false,
} as const;

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /**
     * The name a caller volunteered for itself at sign-in (the `X-Device-Name`
     * header), for a client the User-Agent string alone does not label well —
     * the scanner's Electron shell. Declared to Better Auth as a
     * `session.additionalFields` entry with `input: false`: the only writer is
     * `databaseHooks.session.create.before` (`auth.ts`), never a request body.
     * Null for every browser session and for any caller that sends no header.
     */
    deviceName: text("device_name"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_userId_idx").on(table.userId)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull().default(""),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("accounts_userId_idx").on(table.userId)]
);

/**
 * Better Auth's own rate-limit counters, written by its `storage: "database"`
 * limiter. The property names are the ones the adapter looks for; only the
 * column names follow this schema's convention.
 */
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * A pending or decided RFC 8628 device authorization, written by Better Auth's
 * `deviceAuthorization` plugin: the device polls with `deviceCode`, the person
 * approving types `userCode`. The property names are the ones the adapter
 * looks for (`pollingInterval` is milliseconds); the plugin deletes a row once
 * it is redeemed, denied or found expired, and `userId` is set when the first
 * signed-in caller looks the code up.
 */
export const deviceCodes = pgTable("device_codes", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);
