import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-orm/zod";
import { users } from "./auth.js";
import { rawSettingsAuditScopeEnum, settingsAuditScopeEnum } from "./enums.js";
import { projects } from "./projects.js";

/**
 * The columns every per-scope settings table holds: one row per key the scope
 * sets, the value the registry's schema validates, and when it was written. A
 * key the scope leaves to the scope below it has no row, and a row never holds
 * a null: clearing a key deletes its row.
 */
const settingValueColumns = {
  key: text("key").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * What a scope an owner or an admin governs adds to its rows: the lock, which
 * pins the key for every scope above it, and who last wrote the row (null once
 * that account is gone, or when the instance wrote it itself).
 */
const lockableSettingColumns = {
  locked: boolean("locked").notNull().default(false),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
};

/** A user's own settings: the Personal section, for them alone. */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    ...settingValueColumns,
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })]
);

/** A project's settings, and the member defaults it sets or locks for its members. */
export const projectSettings = pgTable(
  "project_settings",
  {
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    ...settingValueColumns,
    ...lockableSettingColumns,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })]
);

/** The instance's settings, and the defaults it sets or locks for everyone. */
export const instanceSettingValues = pgTable(
  "instance_setting_values",
  {
    ...settingValueColumns,
    ...lockableSettingColumns,
  },
  (t) => [primaryKey({ columns: [t.key] })]
);

export type SettingsAuditScope = (typeof rawSettingsAuditScopeEnum)[number];

/**
 * One change to a shared scope's settings: a value written or cleared, or a
 * lock set or lifted. `old`/`new` are null where there was no row before or is
 * none after; a lock change carries the same value on both sides. `scopeId` is
 * text for the same reason `storage_usage.scope_id` is — a scope's id is
 * whatever that scope is keyed by — and is null for the one instance.
 *
 * `actorId` is set null when the account goes, like `admin_audit`'s: the row
 * still says what changed, and "a removed account" is who did it.
 */
export const settingsAudit = pgTable(
  "settings_audit",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    scope: settingsAuditScopeEnum("scope").notNull(),
    scopeId: text("scope_id"),
    key: text("key").notNull(),
    old: jsonb("old").$type<unknown>(),
    new: jsonb("new").$type<unknown>(),
    lockedBefore: boolean("locked_before").notNull(),
    lockedAfter: boolean("locked_after").notNull(),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    at: timestamp("at").notNull().defaultNow(),
  },
  (t) => [index("settings_audit_scope_id").on(t.scope, t.scopeId, t.id.desc())]
);

export const settingsAuditSchema = createSelectSchema(settingsAudit);
