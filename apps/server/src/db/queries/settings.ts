import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SETTING_LOCK_SCOPES,
  SETTING_SCOPES,
  SETTING_SOURCES,
  SETTINGS,
  isSettingKey,
  resolveSetting,
  settingsFor,
  settingsReceivedBy,
  valuesSchema,
  type SettingDefinition,
  type SettingKey,
  type SettingLayers,
  type SettingLockScope,
  type SettingLocks,
  type SettingScope,
  type SettingSource,
  type SettingsValues,
} from "@workspace/settings";
import type { RegistrationMode } from "@workspace/settings/groups/instance-access";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  sql,
  type Column,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { mcpEnabled } from "../../lib/env.js";
import { ApiError, invalidRequest, parseRequest } from "../../lib/http.js";
import {
  instancePolicy,
  policySource,
  refreshInstancePolicy,
  runningInstancePolicy,
  settingsRefusedBy,
  settingValueIn,
} from "../../lib/instance-policy.js";
import { errorFields, log } from "../../lib/log.js";
import { db } from "../index.js";
import { publicUserSchema, users, type InstanceRole } from "../schema/auth.js";
import {
  instanceSettingValues,
  projectSettings,
  settingsAudit,
  settingsAuditSchema,
  userSettings,
  type SettingsAuditScope,
} from "../schema/settings.js";
import { roleSatisfies, type MemberRole } from "./authorization.js";
import { hasOpenInviteFor } from "./invites.js";
import { envLayer } from "./settings-env.js";

/** The pool, or a transaction on it. */
type Executor = Pick<
  typeof db,
  "select" | "insert" | "update" | "delete" | "execute"
>;

/** A drizzle instance a caller can open its own transaction on. */
type Database = Pick<typeof db, "transaction">;

const ALL_SETTINGS: readonly SettingDefinition[] = Object.values(SETTINGS);

/** One stored row at any scope. A user's rows are never locked. */
export interface StoredSetting {
  key: string;
  value: unknown;
  locked: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Who is reading or writing, and what they may do. */
export interface SettingsActor {
  userId: string;
  /** The actor's role in the project a read or a write names; absent outside one. */
  role?: MemberRole;
  isAdmin: boolean;
}

/** Whose settings a read resolves: the caller's own, the project's they name, the instance's. */
export interface SettingsContext extends SettingsActor {
  projectId?: number;
}

/**
 * One place settings are stored — a user's rows, a project's, the instance's —
 * with everything the reads and writes below need to know about it. A scope is
 * one constructor here; nothing else branches on which one it is.
 */
export interface SettingTarget {
  readonly scope: SettingScope;
  /** The per-target advisory lock's name: writes to one target queue behind each other. */
  readonly lockName: string;
  /** How `settings_audit` names the target; absent where changes go unrecorded. */
  readonly audit?: { scope: SettingsAuditScope; scopeId: string | null };
  /** Whether a key can be locked here. */
  readonly lockable: boolean;
  /**
   * Whether an instance lock refuses a write here. Every scope but the
   * instance's own sits above it in every cascade. A project lock refuses
   * nothing: it pins a user's value only inside that project, and a user's
   * row is written with no project in view.
   */
  readonly yieldsToInstanceLock: boolean;
  /** Whether `actor` may write `definition` here, on top of the route's own gate. */
  mayWrite(definition: SettingDefinition, actor: SettingsActor): boolean;
  /**
   * Whether `actor` may set or lift a lock here. Clearing a locked row lifts
   * its lock, so that write needs it too, whatever the key's `minRole` allows.
   */
  mayLock(actor: SettingsActor): boolean;
  /** The target's rows, or only those of `keys`. */
  rows(executor: Executor, keys?: readonly string[]): Promise<StoredSetting[]>;
  /** Writes a key's value; `locked`, when given, sets the lock too. */
  write(
    executor: Executor,
    row: { key: string; value: unknown; locked?: boolean },
    actorId: string | null
  ): Promise<void>;
  remove(executor: Executor, key: string): Promise<void>;
  /**
   * Refuses, by throwing, a write whose values the target cannot hold
   * together, though each passes its own schema. Runs inside the write's
   * transaction, once its rows have changed; `written` is the keys the write
   * set or cleared.
   */
  check?(executor: Executor, written: readonly string[]): Promise<void>;
  /** Runs once a transaction that changed the target's rows has committed. */
  committed?(): void | Promise<void>;
}

/** No filter when `keys` is absent; otherwise the rows of those keys only. */
const onlyKeys = (column: Column, keys?: readonly string[]) =>
  keys === undefined ? undefined : inArray(column, [...keys]);

/** A user's own rows. The route only ever addresses the caller's. */
export function userTarget(userId: string): SettingTarget {
  const owned = eq(userSettings.userId, userId);
  return {
    scope: "user",
    lockName: `user:${userId}`,
    lockable: false,
    yieldsToInstanceLock: true,
    mayWrite: () => true,
    mayLock: () => false,
    async rows(executor, keys) {
      const rows = await executor
        .select({
          key: userSettings.key,
          value: userSettings.value,
          updatedAt: userSettings.updatedAt,
        })
        .from(userSettings)
        .where(and(owned, onlyKeys(userSettings.key, keys)));
      return rows.map((row) => ({ ...row, locked: false, updatedBy: userId }));
    },
    async write(executor, { key, value }) {
      const updatedAt = new Date();
      await executor
        .insert(userSettings)
        .values({ userId, key, value, updatedAt })
        .onConflictDoUpdate({
          target: [userSettings.userId, userSettings.key],
          set: { value, updatedAt },
        });
    },
    async remove(executor, key) {
      await executor
        .delete(userSettings)
        .where(and(owned, eq(userSettings.key, key)));
    },
  };
}

const PROJECT_STORAGE_CAP = SETTINGS["project-audio.storageCapGb"];

const INSTANCE_PROJECT_CAP = SETTINGS["instance-limits.projectCapGb"];

/** Says nothing of the instance's cap: only an admin is shown it. */
const STORAGE_CAP_REFUSAL =
  "A project's storage cap can't be above this instance's cap.";

/**
 * A project's rows. Writing a key needs the key's `minRole`, `admin` when it
 * names none: a project setting speaks for every member. A write that sets
 * the project's storage cap above the instance's is refused with a 400, read
 * from the instance's rows inside the transaction so a stale cache never
 * decides it; no cap on either side leaves nothing to compare.
 */
export function projectTarget(projectId: number): SettingTarget {
  const owned = eq(projectSettings.projectId, projectId);
  return {
    scope: "project",
    lockName: `project:${projectId}`,
    audit: { scope: "project", scopeId: String(projectId) },
    lockable: true,
    yieldsToInstanceLock: true,
    mayWrite: (definition, { role }) =>
      role !== undefined && roleSatisfies(role, definition.minRole ?? "admin"),
    mayLock: ({ role }) => role !== undefined && roleSatisfies(role, "admin"),
    async rows(executor, keys) {
      return executor
        .select({
          key: projectSettings.key,
          value: projectSettings.value,
          locked: projectSettings.locked,
          updatedAt: projectSettings.updatedAt,
          updatedBy: projectSettings.updatedBy,
        })
        .from(projectSettings)
        .where(and(owned, onlyKeys(projectSettings.key, keys)));
    },
    async write(executor, { key, value, locked }, updatedBy) {
      const updatedAt = new Date();
      await executor
        .insert(projectSettings)
        .values({ projectId, key, value, locked, updatedAt, updatedBy })
        .onConflictDoUpdate({
          target: [projectSettings.projectId, projectSettings.key],
          set: {
            value,
            updatedAt,
            updatedBy,
            ...(locked === undefined ? {} : { locked }),
          },
        });
    },
    async remove(executor, key) {
      await executor
        .delete(projectSettings)
        .where(and(owned, eq(projectSettings.key, key)));
    },
    async check(executor, written) {
      // Only a write to the cap is held to the ceiling: a project whose cap an
      // instance change has since undercut can still change everything else.
      if (!written.includes(PROJECT_STORAGE_CAP.key)) return;
      const [row] = await this.rows(executor, [PROJECT_STORAGE_CAP.key]);
      const cap =
        row === undefined ? null : PROJECT_STORAGE_CAP.schema.parse(row.value);
      if (cap === null) return;
      const { layers } = layersOf({
        instance: await instanceTarget.rows(executor, [
          INSTANCE_PROJECT_CAP.key,
        ]),
      });
      const ceiling = resolveSetting(INSTANCE_PROJECT_CAP, layers).value;
      if (ceiling === null || cap <= ceiling) return;
      throw invalidRequest(
        [{ path: [PROJECT_STORAGE_CAP.key], message: STORAGE_CAP_REFUSAL }],
        STORAGE_CAP_REFUSAL
      );
    },
  };
}

/**
 * The id the one instance is addressed by where a route names a scope and an
 * id: `/settings/instance/instance`.
 */
export const INSTANCE_TARGET_ID = "instance";

/**
 * The instance's rows. Only an instance admin may write them. A write that
 * would leave the instance policy unable to take them (a pair out of order)
 * is refused with a 400 naming every setting involved, so the rows a refresh
 * reads always make a policy; a committed change drops the process cache
 * below and reloads it, and this process's policy with it, before the write
 * answers.
 */
export const instanceTarget: SettingTarget = {
  scope: "instance",
  lockName: "instance",
  audit: { scope: "instance", scopeId: null },
  lockable: true,
  yieldsToInstanceLock: false,
  mayWrite: (_, { isAdmin }) => isAdmin,
  mayLock: ({ isAdmin }) => isAdmin,
  async rows(executor, keys) {
    return executor
      .select({
        key: instanceSettingValues.key,
        value: instanceSettingValues.value,
        locked: instanceSettingValues.locked,
        updatedAt: instanceSettingValues.updatedAt,
        updatedBy: instanceSettingValues.updatedBy,
      })
      .from(instanceSettingValues)
      .where(onlyKeys(instanceSettingValues.key, keys));
  },
  async write(executor, { key, value, locked }, updatedBy) {
    const updatedAt = new Date();
    await executor
      .insert(instanceSettingValues)
      .values({ key, value, locked, updatedAt, updatedBy })
      .onConflictDoUpdate({
        target: instanceSettingValues.key,
        set: {
          value,
          updatedAt,
          updatedBy,
          ...(locked === undefined ? {} : { locked }),
        },
      });
  },
  async remove(executor, key) {
    await executor
      .delete(instanceSettingValues)
      .where(eq(instanceSettingValues.key, key));
  },
  async check(executor) {
    const refused = settingsRefusedBy(
      policyOf(await instanceTarget.rows(executor))
    );
    if (refused.length === 0) return;
    throw invalidRequest(
      refused.map(({ key, message }) => ({ path: [key], message })),
      [...new Set(refused.map(({ message }) => message))].join(". ")
    );
  },
  async committed() {
    forgetInstanceRows();
    await reloadInstanceSettings();
  },
};

/**
 * The instance's rows, behind a process cache for the readers that do not
 * need them to the moment: every effective read, `GET /api/instance`, and the
 * synchronous `cachedRegistrationMode`. A write, a lock and the sign-up gate
 * read the rows themselves inside their own transaction, so a stale entry
 * never decides one. The TTL is what lets a second server process converge on
 * a change it did not make itself, and the same interval paces the reload
 * that brings its instance policy along (`startInstanceSettingsRefresh`).
 */
const CACHE_TTL_MS = 30_000;

const logger = log("settings");

let cached: { rows: readonly StoredSetting[]; readAt: number } | null = null;

/** Bumped by every forget, so a read that started before one does not cache what it read. */
let generation = 0;

/** Drops the cached instance rows, so the next read goes to the database. */
export function forgetInstanceRows(): void {
  cached = null;
  generation += 1;
}

/** The instance's rows through the process cache. */
export async function instanceRows(): Promise<readonly StoredSetting[]> {
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.rows;
  const started = generation;
  const rows = await instanceTarget.rows(db);
  if (started === generation) cached = { rows, readAt: Date.now() };
  return rows;
}

/**
 * The instance policy the instance's rows give, unchecked: each policy value's
 * setting resolved over the rows, the `env` layer and the defaults.
 */
const policyOf = (rows: readonly StoredSetting[]) => {
  const { layers } = layersOf({ instance: rows });
  return policySource((definition) => resolveSetting(definition, layers).value);
};

/**
 * Reads the instance's rows afresh into the cache and refreshes this
 * process's instance policy from them: once at boot, before the app is
 * imported; on every tick of `startInstanceSettingsRefresh`, which is how a
 * process converges on a change another one made; and in the writing process
 * as soon as an instance write commits. A read that a forget overtook — a
 * write committed while it was in flight — changes nothing, since that write
 * reloads after it. A read that fails changes nothing; rows the policy refuses
 * (a pair out of order stored around the write check) still reach the cache,
 * which shows what is stored, but leave the policy as it was. Either is
 * logged, and the process carries on.
 */
export async function reloadInstanceSettings(): Promise<void> {
  const started = generation;
  try {
    const rows = await instanceTarget.rows(db);
    if (started !== generation) return;
    cached = { rows, readAt: Date.now() };
    refreshInstancePolicy(policyOf(rows));
  } catch (error) {
    logger.error("could not refresh the instance settings", errorFields(error));
  }
}

/**
 * Reloads the instance settings every {@link CACHE_TTL_MS}, for as long as the
 * process lives, so the policy every consumer reads follows a change made in
 * another process within that interval. Started by the server once it
 * listens, never by an import, so a test or typegen that imports the app
 * reads nothing. The timer does not hold the event loop open. Returns the stop.
 */
export function startInstanceSettingsRefresh(): () => void {
  const timer = setInterval(
    () => void reloadInstanceSettings(),
    CACHE_TTL_MS
  ).unref();
  return () => clearInterval(timer);
}

/** Stored rows by scope, as a read or a write has gathered them. */
type StoredLayers = Partial<Record<SettingScope, readonly StoredSetting[]>>;

/**
 * What the resolver takes from stored rows: each scope's values, the keys
 * locked at each scope that can lock, and the `env` seed below them all.
 */
function layersOf(stored: StoredLayers): {
  layers: SettingLayers;
  locks: SettingLocks;
} {
  const layers: SettingLayers = { env: envLayer() };
  const locks: SettingLocks = {};
  for (const scope of SETTING_SCOPES) {
    const rows = stored[scope];
    if (rows) {
      layers[scope] = Object.fromEntries(
        rows.map((row) => [row.key, row.value])
      );
    }
  }
  for (const scope of SETTING_LOCK_SCOPES) {
    const rows = stored[scope];
    if (rows) {
      locks[scope] = new Set(
        rows.filter((row) => row.locked).map((row) => row.key)
      );
    }
  }
  return { layers, locks };
}

/** The targets a read in `context` layers, by scope. */
function targetsOf(context: SettingsContext) {
  return {
    user: userTarget(context.userId),
    project:
      context.projectId === undefined
        ? undefined
        : projectTarget(context.projectId),
    instance: instanceTarget,
  } satisfies Partial<Record<SettingScope, SettingTarget>>;
}

/** Every stored row a read in `context` resolves over; the instance's come from the cache. */
async function readStored(context: SettingsContext): Promise<StoredLayers> {
  const { user, project } = targetsOf(context);
  const [userRows, projectRows, instance] = await Promise.all([
    user.rows(db),
    project?.rows(db),
    instanceRows(),
  ]);
  return {
    user: userRows,
    project: projectRows,
    instance,
  };
}

/** The definition of a key a request's schema has already admitted. */
function definitionOf(key: string): SettingDefinition {
  if (!isSettingKey(key)) throw new Error(`Unregistered setting "${key}"`);
  return SETTINGS[key];
}

/**
 * A zod object with one member per registered setting, built from the
 * registry so each key carries its own schema. An admin-only key is optional:
 * it is absent for everyone else.
 */
const perSetting = (member: (definition: SettingDefinition) => z.ZodType) =>
  z.object(
    Object.fromEntries(
      ALL_SETTINGS.map((definition) => [
        definition.key,
        definition.audience === "admin"
          ? member(definition).optional()
          : member(definition),
      ])
    )
  );

/** A zod object with an optional member per scope. */
const perScope = (member: z.ZodType) =>
  z.object(
    Object.fromEntries(
      SETTING_SCOPES.map((scope) => [scope, member.optional()])
    )
  );

export const effectiveSettingsSchema = z.object({
  values: perSetting((definition) => definition.schema),
  /**
   * Changes whenever any value in `values` does, or whenever a key's source
   * or lock moves without its value changing: a digest of each key's
   * resolved value, source and lock, so a cleared row counts as a change as
   * much as a written one does.
   */
  version: z.string(),
});

export type EffectiveSettings = z.infer<typeof effectiveSettingsSchema>;

const versionOf = (digest: Record<string, unknown>) =>
  createHash("sha256")
    .update(JSON.stringify(digest))
    .digest("hex")
    .slice(0, 16);

/**
 * The caller's effective value for every setting they receive: their own
 * rows over the project's they name over the instance's, then the `env`
 * layer and the registry's defaults, with the project's and the instance's
 * locks applied. The caller's membership in the project is the route's to
 * check.
 */
export async function effectiveFor(
  context: SettingsContext
): Promise<EffectiveSettings> {
  const { layers, locks } = layersOf(await readStored(context));
  const resolved = settingsReceivedBy(context.isAdmin).map(
    (definition) =>
      [definition.key, resolveSetting(definition, layers, locks)] as const
  );
  const values = Object.fromEntries(
    resolved.map(([key, { value }]) => [key, value])
  );
  const digest = Object.fromEntries(
    resolved.map(([key, { value, source, lockedBy }]) => [
      key,
      lockedBy === undefined ? { value, source } : { value, source, lockedBy },
    ])
  );
  return { values, version: versionOf(digest) };
}

const hubRowSchema = (definition: SettingDefinition) =>
  z.object({
    effective: definition.schema,
    source: z.enum(SETTING_SOURCES),
    lockedBy: z.enum(SETTING_LOCK_SCOPES).optional(),
    /**
     * For each scope the key accepts and this read can address, whether the
     * caller may write it there now: their role and the key's `minRole`, and
     * no lock below that scope pinning the key in this read's context.
     */
    writable: perScope(z.boolean()),
    /**
     * For each scope the key accepts and this read can address, whether the
     * caller may set, lift or clear a lock there: the role the scope's target
     * requires, whatever the key's `minRole`. A lock set at a scope the caller
     * cannot lock at is refused, and so is clearing a value that lock holds.
     */
    lockable: perScope(z.boolean()),
    /** What each scope holds for the key; a scope holding nothing, or a value the key's schema rejects, is absent. */
    values: perScope(definition.schema),
    /** When each scope's row was last written; present at exactly the scopes `values` holds one for. */
    updatedAt: perScope(z.iso.datetime()),
    /**
     * For a `restartRequired` key, the value the server is running with: what
     * it read as it started. The effective value applies at the next restart
     * wherever the two differ.
     */
    ...(definition.restartRequired
      ? {
          running: definition.schema.optional(),
          /**
           * Present and true when the deployment keeps the key off whatever it
           * is set to (`running` then reports what the process serves), so a
           * restart will not apply the effective value.
           */
          deploymentOff: z.literal(true).optional(),
        }
      : {}),
  });

/** The hub's view of every setting the caller receives. */
export const hubRowsSchema = perSetting(hubRowSchema);

/** The hub's view of the settings a write named. */
export const changedHubRowsSchema = hubRowsSchema.partial();

type HubRow = {
  effective: unknown;
  source: SettingSource;
  lockedBy?: SettingLockScope;
  writable: Partial<Record<SettingScope, boolean>>;
  lockable: Partial<Record<SettingScope, boolean>>;
  values: Partial<Record<SettingScope, unknown>>;
  updatedAt: Partial<Record<SettingScope, string>>;
  running?: unknown;
  deploymentOff?: true;
};

/** The one restart-required key the deployment can hold off (`mcpEnabled` in `env.ts`). */
const MCP_KEY = "instance-integrations.mcpEnabled";

/** Whether a lock at `lockedBy` pins `definition` for a write at `scope`. */
const pinnedBelow = (
  definition: SettingDefinition,
  scope: SettingScope,
  lockedBy: SettingLockScope | undefined
) =>
  lockedBy !== undefined &&
  definition.scopes.indexOf(lockedBy) > definition.scopes.indexOf(scope);

/**
 * Every setting the caller receives as the hub shows it: the effective value
 * and where it came from, the lock pinning it, where the caller may write it,
 * what each scope holds, and for a restart-required key the value this
 * process is running with (`runningInstancePolicy`). `keys` narrows it to the
 * settings a write named.
 */
export async function hubRowsFor(
  context: SettingsContext,
  keys?: readonly string[]
): Promise<Record<string, HubRow>> {
  const stored = await readStored(context);
  const { layers, locks } = layersOf(stored);
  const targets: Partial<Record<SettingScope, SettingTarget>> =
    targetsOf(context);
  const byScope = Object.fromEntries(
    SETTING_SCOPES.map((scope) => [
      scope,
      new Map(stored[scope]?.map((row) => [row.key, row])),
    ])
  ) as Record<SettingScope, Map<string, StoredSetting>>;

  const definitions = settingsReceivedBy(context.isAdmin).filter(
    (definition) => keys === undefined || keys.includes(definition.key)
  );

  return Object.fromEntries(
    definitions.map((definition) => {
      const { value, source, lockedBy } = resolveSetting(
        definition,
        layers,
        locks
      );
      const writable: HubRow["writable"] = {};
      const lockable: HubRow["lockable"] = {};
      const values: HubRow["values"] = {};
      const updatedAt: HubRow["updatedAt"] = {};
      for (const scope of definition.scopes) {
        const target = targets[scope];
        if (target) {
          writable[scope] =
            target.mayWrite(definition, context) &&
            !pinnedBelow(definition, scope, lockedBy);
          lockable[scope] = target.mayLock(context);
        }
        const stored = byScope[scope].get(definition.key);
        if (stored) {
          const held = definition.schema.safeParse(stored.value);
          if (held.success) {
            values[scope] = held.data;
            updatedAt[scope] = stored.updatedAt.toISOString();
          }
        }
      }
      const row: HubRow = {
        effective: value,
        source,
        writable,
        lockable,
        values,
        updatedAt,
      };
      if (lockedBy !== undefined) row.lockedBy = lockedBy;
      if (definition.restartRequired) {
        const running = settingValueIn(runningInstancePolicy(), definition.key);
        if (definition.key === MCP_KEY && !mcpEnabled) {
          // What the process serves (`mcpServed` in `auth.ts`), not the policy.
          row.running = false;
          row.deploymentOff = true;
        } else if (running !== undefined) row.running = running;
      }
      return [definition.key, row];
    })
  );
}

/**
 * Namespaces the per-target lock every settings write takes (the two-key
 * `pg_advisory_xact_lock`): "SETT" in hex. Writes to one target queue, so
 * each audit row's old value is the one its write replaced, and two writes of
 * the same key land last-write-wins with a row each.
 */
const SETTINGS_LOCK_CLASS = 0x53455454;

const lockTarget = (executor: Executor, target: SettingTarget) =>
  executor.execute(
    sql`select pg_advisory_xact_lock(${SETTINGS_LOCK_CLASS}::int, hashtext(${target.lockName}))`
  );

/** What a key's lock at the instance does to a write elsewhere. */
function lockedError(target: SettingTarget, key: string) {
  return new ApiError(409, {
    code: "setting_locked",
    message: `${definitionOf(key).label} is locked by the instance`,
    details: { scope: target.scope, by: "instance", key },
  });
}

/** A 403 for a write that would lift `key`'s lock by one who may not lock it. */
function lockForbidden(key: string) {
  return new HTTPException(403, {
    message: `${definitionOf(key).label} is locked; clearing it needs a role that can lock it`,
  });
}

/**
 * Whether `row` still matches a write's precondition: `expected` is the
 * `updatedAt` the writer last saw there, ISO to the millisecond same as the
 * hub row gave it, or `null` for "no row yet". Compared by instant, not by
 * string, so the hub row's own formatting is never a second source of truth.
 */
function matchesPrecondition(
  row: StoredSetting | undefined,
  expected: string | null
): boolean {
  if (expected === null) return row === undefined;
  return (
    row !== undefined &&
    row.updatedAt.getTime() === new Date(expected).getTime()
  );
}

/** A 409 for a write whose precondition no longer matches what is stored. */
function preconditionFailed(target: SettingTarget, key: string) {
  return new ApiError(409, {
    code: "setting_modified",
    message: `${definitionOf(key).label} changed since it was last read`,
    details: { scope: target.scope, key },
  });
}

/**
 * The keys among `keys` an instance lock refuses a write of at `target`, read
 * inside the write's own transaction. The lock rule is the resolver's: a lock
 * counts on a lockable key the instance scope accepts, over a row that exists.
 */
async function instanceLocked(
  executor: Executor,
  target: SettingTarget,
  keys: readonly string[]
): Promise<Set<string>> {
  if (!target.yieldsToInstanceLock || keys.length === 0) return new Set();
  const { layers, locks } = layersOf({
    instance: await instanceTarget.rows(executor, keys),
  });
  return new Set(
    keys.filter(
      (key) =>
        isSettingKey(key) &&
        resolveSetting(definitionOf(key), layers, locks).lockedBy === "instance"
    )
  );
}

/** One change a write made, as `settings_audit` records it. */
interface AuditEntry {
  key: string;
  old: unknown;
  new: unknown;
  lockedBefore: boolean;
  lockedAfter: boolean;
}

async function recordAudit(
  executor: Executor,
  target: SettingTarget,
  entries: readonly AuditEntry[],
  actorId: string | null
): Promise<void> {
  if (!target.audit || entries.length === 0) return;
  const { scope, scopeId } = target.audit;
  await executor.insert(settingsAudit).values(
    entries.map((entry) => ({
      scope,
      scopeId,
      key: entry.key,
      old: entry.old,
      new: entry.new,
      lockedBefore: entry.lockedBefore,
      lockedAfter: entry.lockedAfter,
      actorId,
    }))
  );
}

/**
 * Writes each value (`null` clears the key's row) and returns what changed. A
 * value equal to the stored one changes nothing and is not recorded; clearing
 * a locked row lifts its lock with it, since a lock is a flag on the row, and
 * is refused (403) unless `mayLift`: the writer may lock at this target. A key
 * `preconditions` names is checked against the current row before anything is
 * written (409, nothing written): the caller never sends one it does not
 * carry, so only they narrow what this checks.
 */
async function applyValues(
  executor: Executor,
  target: SettingTarget,
  changes: readonly (readonly [string, unknown])[],
  actorId: string | null,
  mayLift = false,
  preconditions: ReadonlyMap<string, string | null> = new Map()
): Promise<AuditEntry[]> {
  const current = new Map(
    (
      await target.rows(
        executor,
        changes.map(([key]) => key)
      )
    ).map((row) => [row.key, row])
  );
  for (const [key] of changes) {
    if (!preconditions.has(key)) continue;
    const expected = preconditions.get(key) ?? null;
    if (!matchesPrecondition(current.get(key), expected)) {
      throw preconditionFailed(target, key);
    }
  }
  const entries: AuditEntry[] = [];
  for (const [key, value] of changes) {
    const row = current.get(key);
    if (value === null) {
      if (!row) continue;
      if (row.locked && !mayLift) throw lockForbidden(key);
      await target.remove(executor, key);
      entries.push({
        key,
        old: row.value,
        new: null,
        lockedBefore: row.locked,
        lockedAfter: false,
      });
      continue;
    }
    if (row && isDeepStrictEqual(row.value, value)) continue;
    await target.write(executor, { key, value }, actorId);
    entries.push({
      key,
      old: row?.value ?? null,
      new: value,
      lockedBefore: row?.locked ?? false,
      lockedAfter: row?.locked ?? false,
    });
  }
  return entries;
}

/** A 403 naming the role a key needs, when `actor` may not write it at `target`. */
function requireWritable(
  target: SettingTarget,
  keys: readonly string[],
  actor: SettingsActor
): void {
  for (const key of keys) {
    const definition = definitionOf(key);
    if (!target.mayWrite(definition, actor)) {
      throw new HTTPException(403, {
        message: `Changing ${definition.label} needs a higher role`,
      });
    }
  }
}

/**
 * A write's body: `valuesSchema`'s patch, plus each key's optional
 * precondition — the `updatedAt` the writer last saw at this scope for it, or
 * `null` for "no row yet". A key the patch does not name one for is written
 * unconditionally; the route's validator and `writeSettings` share this one
 * schema, scoped to the caller's whole registry and then to the target.
 */
export const patchSchema = (definitions: readonly SettingDefinition[]) =>
  valuesSchema(definitions).extend({
    ifUnmodifiedSince: z
      .object(
        Object.fromEntries(
          definitions.map((definition) => [
            definition.key,
            z.iso.datetime().nullable().optional(),
          ])
        )
      )
      .optional(),
  });

/**
 * Writes a patch of values to one target: `{[key]: value | null}`, `null`
 * clearing the key's row. The patch is checked against the keys the target's
 * scope accepts (a 400 for any other), each key against what the actor may
 * write there (403), and each value against the instance's locks (409
 * `setting_locked`, nothing written); then every row changes in one
 * transaction, with an audit row per change at a scope that records them,
 * unless the target's `check` refuses the rows the patch leaves (400, nothing
 * written). Clearing a key the instance locks is allowed: the row is inert
 * under the lock, so deleting it changes no effective value. Clearing a row
 * locked at this target lifts the lock, so it needs `mayLock` (403 otherwise).
 * A key `ifUnmodifiedSince` names is checked against the row's own `updatedAt`
 * before anything is written (409 `setting_modified`, nothing written): a key
 * the patch does not carry a precondition for is written exactly as before.
 * Returns the keys the patch named, once the target's `committed` has run.
 */
export async function writeSettings(
  target: SettingTarget,
  patch: unknown,
  actor: SettingsActor
): Promise<string[]> {
  const { ifUnmodifiedSince, ...values } = parseRequest(
    patchSchema(settingsFor(target.scope)),
    patch
  );
  const changes = Object.entries(values).filter(
    ([, value]) => value !== undefined
  );
  const keys = changes.map(([key]) => key);
  if (keys.length === 0) return keys;
  requireWritable(target, keys, actor);
  const setting = changes
    .filter(([, value]) => value !== null)
    .map(([key]) => key);
  const preconditions = new Map(
    Object.entries(ifUnmodifiedSince ?? {}).filter(
      (entry): entry is [string, string | null] => entry[1] !== undefined
    )
  );

  await db.transaction(async (tx) => {
    await lockTarget(tx, target);
    const [locked] = await instanceLocked(tx, target, setting);
    if (locked !== undefined) throw lockedError(target, locked);
    const entries = await applyValues(
      tx,
      target,
      changes,
      actor.userId,
      target.mayLock(actor),
      preconditions
    );
    await target.check?.(tx, keys);
    await recordAudit(tx, target, entries, actor.userId);
  });
  await target.committed?.();
  return keys;
}

/** A lock patch for `definitions`: strict, each lockable key a boolean. */
const locksSchema = (definitions: readonly SettingDefinition[]) =>
  z.strictObject(
    Object.fromEntries(
      definitions
        .filter((definition) => definition.lockable !== false)
        .map((definition) => [definition.key, z.boolean().optional()])
    )
  );

/** A lock patch for any lockable key: what the locks route documents. */
export const anyLocksSchema = locksSchema(ALL_SETTINGS);

/**
 * Sets or lifts locks at a target that can lock: `{[key]: boolean}`. Locking
 * a key the target holds no row for first writes the value the key resolves
 * to there — what the scopes below give it — so the lock pins what everyone
 * already sees. Lifting one keeps the row, and the rows it had pinned above it
 * apply again. A key a lock refuses, the scope does not accept, or that is
 * declared `lockable: false` is a 400; the rest is as `writeSettings`.
 */
export async function setLocks(
  target: SettingTarget,
  patch: unknown,
  actor: SettingsActor
): Promise<string[]> {
  if (!target.lockable) throw new HTTPException(404);
  if (!target.mayLock(actor)) {
    throw new HTTPException(403, {
      message: "Locking settings needs an admin",
    });
  }
  const values = parseRequest(locksSchema(settingsFor(target.scope)), patch);
  const changes = Object.entries(values).filter(
    (change): change is [string, boolean] => change[1] !== undefined
  );
  const keys = changes.map(([key]) => key);
  if (keys.length === 0) return keys;
  requireWritable(target, keys, actor);

  await db.transaction(async (tx) => {
    await lockTarget(tx, target);
    const [locked] = await instanceLocked(tx, target, keys);
    if (locked !== undefined) throw lockedError(target, locked);

    const current = new Map(
      (await target.rows(tx, keys)).map((row) => [row.key, row])
    );
    const below = layersOf({ instance: await instanceTarget.rows(tx, keys) });
    const entries: AuditEntry[] = [];
    for (const [key, lock] of changes) {
      const row = current.get(key);
      if ((row?.locked ?? false) === lock) continue;
      const value =
        row?.value ?? resolveSetting(definitionOf(key), below.layers).value;
      await target.write(tx, { key, value, locked: lock }, actor.userId);
      entries.push({
        key,
        old: row?.value ?? null,
        new: value,
        lockedBefore: !lock,
        lockedAfter: lock,
      });
    }
    await recordAudit(tx, target, entries, actor.userId);
  });
  await target.committed?.();
  return keys;
}

/** The export file's format; an import takes this one only. */
const SETTINGS_EXPORT_VERSION = 1;

/** A user's own settings as a file: what an export gives and an import takes. */
export const settingsExportSchema = z.object({
  version: z.literal(SETTINGS_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  /** Keyed by setting key; an import skips what it cannot apply rather than refusing the file. */
  values: z.record(z.string(), z.unknown()),
});

export type SettingsExport = z.infer<typeof settingsExportSchema>;

/**
 * Every valid value the user holds for a key that still takes one, in the
 * registry's order, so two exports of the same settings read the same.
 */
export async function exportUserSettings(
  userId: string
): Promise<SettingsExport> {
  const held = new Map(
    (await userTarget(userId).rows(db)).map((row) => [row.key, row.value])
  );
  const values: Record<string, unknown> = {};
  for (const definition of settingsFor("user")) {
    if (!held.has(definition.key)) continue;
    const parsed = definition.schema.safeParse(held.get(definition.key));
    if (parsed.success) values[definition.key] = parsed.data;
  }
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    values,
  };
}

/** Why an import left a key out. */
const IMPORT_SKIP_REASONS = ["unknown", "scope", "invalid", "locked"] as const;

export const importReportSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(
    z.object({ key: z.string(), reason: z.enum(IMPORT_SKIP_REASONS) })
  ),
});

export type ImportReport = z.infer<typeof importReportSchema>;

/**
 * Applies an export to the user's own settings, skipping — never refusing the
 * file for — a key the registry does not know (`unknown`), one that takes no
 * personal value (`scope`), a value its schema rejects (`invalid`), and a key
 * the instance locks (`locked`). A dry run answers the same report and writes
 * nothing.
 */
export async function importUserSettings(
  userId: string,
  file: SettingsExport,
  { dryRun }: { dryRun: boolean }
): Promise<ImportReport> {
  const target = userTarget(userId);
  const report = await db.transaction(async (tx) => {
    await lockTarget(tx, target);
    const keys = Object.keys(file.values);
    const locked = await instanceLocked(tx, target, keys);
    const found: ImportReport = { applied: [], skipped: [] };
    const changes: [string, unknown][] = [];

    for (const [key, value] of Object.entries(file.values)) {
      const skip = (reason: ImportReport["skipped"][number]["reason"]) =>
        found.skipped.push({ key, reason });
      if (!isSettingKey(key)) {
        skip("unknown");
        continue;
      }
      const definition: SettingDefinition = SETTINGS[key];
      if (!definition.scopes.includes(target.scope)) {
        skip("scope");
        continue;
      }
      const parsed = definition.schema.safeParse(value);
      if (!parsed.success) {
        skip("invalid");
        continue;
      }
      if (locked.has(key)) {
        skip("locked");
        continue;
      }
      found.applied.push(key);
      changes.push([key, parsed.data]);
    }

    if (!dryRun) await applyValues(tx, target, changes, userId);
    return found;
  });
  if (!dryRun) await target.committed?.();
  return report;
}

/** One audit row with the account that made the change, null once it is gone. */
const settingsAuditEntrySchema = settingsAuditSchema
  .omit({ actorId: true })
  .extend({
    /** The value before the change; null where the key had no row. */
    old: z.unknown(),
    /** The value after it; null where the change cleared the row. */
    new: z.unknown(),
    actor: publicUserSchema.pick({ id: true, name: true }).nullable(),
  });

export const settingsAuditPageSchema = z.array(settingsAuditEntrySchema);

/** The most rows one page of the audit answers with. */
export const AUDIT_PAGE_LIMIT = 100;

/**
 * A target's audit rows, newest first. `before` is the id of the oldest row a
 * previous page ended on; ids only grow, so it pages without skipping or
 * repeating a row written in between.
 */
export async function listAudit(
  target: SettingTarget,
  { limit, before }: { limit: number; before?: number }
): Promise<z.infer<typeof settingsAuditPageSchema>> {
  if (!target.audit) return [];
  const { scope, scopeId } = target.audit;
  return db
    .select({
      id: settingsAudit.id,
      scope: settingsAudit.scope,
      scopeId: settingsAudit.scopeId,
      key: settingsAudit.key,
      old: settingsAudit.old,
      new: settingsAudit.new,
      lockedBefore: settingsAudit.lockedBefore,
      lockedAfter: settingsAudit.lockedAfter,
      at: settingsAudit.at,
      actor: { id: users.id, name: users.name },
    })
    .from(settingsAudit)
    .leftJoin(users, eq(settingsAudit.actorId, users.id))
    .where(
      and(
        eq(settingsAudit.scope, scope),
        scopeId === null
          ? isNull(settingsAudit.scopeId)
          : eq(settingsAudit.scopeId, scopeId),
        before === undefined ? undefined : lt(settingsAudit.id, before)
      )
    )
    .orderBy(desc(settingsAudit.id))
    .limit(Math.min(limit, AUDIT_PAGE_LIMIT));
}

/**
 * One instance-scope key as a caller outside any user's or project's context
 * reads it — the instance's row, then the `env` layer, then the default. Reads
 * through the cache.
 */
export async function instanceSetting<V>(
  definition: SettingDefinition<V>
): Promise<V> {
  const rows = await instanceRows();
  return resolveSetting(definition, layersOf({ instance: rows }).layers).value;
}

/**
 * Several instance-scope keys read as `instanceSetting` reads one, each typed
 * by its key. Reads through the cache.
 */
export async function instanceValues<const K extends SettingKey>(
  keys: readonly K[]
): Promise<{ [P in K]: SettingsValues[P] }> {
  const { layers } = layersOf({ instance: await instanceRows() });
  return Object.fromEntries(
    keys.map((key) => [key, resolveSetting(definitionOf(key), layers).value])
  ) as { [P in K]: SettingsValues[P] };
}

/**
 * Several project-scope keys as a caller in project `projectId` reads them,
 * each typed by its key: the project's row, then the instance's, then the
 * `env` layer and the default. The project's rows are read fresh, the
 * instance's through the cache. An instance lock beats the project's row.
 */
export async function projectValues<const K extends SettingKey>(
  projectId: number,
  keys: readonly K[]
): Promise<{ [P in K]: SettingsValues[P] }> {
  const [project, instance] = await Promise.all([
    projectTarget(projectId).rows(db, keys),
    instanceRows(),
  ]);
  const { layers, locks } = layersOf({ instance, project });
  return Object.fromEntries(
    keys.map((key) => [
      key,
      resolveSetting(definitionOf(key), layers, locks).value,
    ])
  ) as { [P in K]: SettingsValues[P] };
}

const PUBLIC_SETTINGS = ALL_SETTINGS.filter(
  (definition) => definition.audience === "public"
);

/** The settings a signed-out page receives, each with its own schema. */
export const publicSettingsSchema = z.object(
  Object.fromEntries(
    PUBLIC_SETTINGS.map((definition) => [definition.key, definition.schema])
  )
);

/** Every `audience: "public"` key at the instance, through the cache. */
export async function publicSettings(): Promise<Record<string, unknown>> {
  const { layers } = layersOf({ instance: await instanceRows() });
  return Object.fromEntries(
    PUBLIC_SETTINGS.map((definition) => [
      definition.key,
      resolveSetting(definition, layers).value,
    ])
  );
}

const REGISTRATION = SETTINGS["instance-access.registration"];

/**
 * The registration mode as of the last read of the instance rows, for a
 * caller that cannot await one — `auth.ts`'s `requireEmailVerification` is
 * read by Better Auth as a plain property on every request, not called, so it
 * can only ever be as fresh as a synchronous read allows. It reads the same
 * cache the effective reads keep warm rather than opening a second one, so the
 * two can never disagree; it can lag a write by up to {@link CACHE_TTL_MS}.
 *
 * With nothing cached yet it answers the registry's default, `open` — the
 * safer of the two failure modes: an unnecessary verification costs a
 * legitimate sign-up a few seconds, where skipping a needed one lets a
 * self-registered account through unverified.
 */
export function cachedRegistrationMode(): RegistrationMode {
  return resolveSetting(
    REGISTRATION,
    layersOf({ instance: cached?.rows }).layers
  ).value;
}

/**
 * Opens or closes registration as the instance itself — outside the audited
 * admin path, the way the first-user bootstrap closes it — and drops the
 * cache. `updatedBy` names who asked, when anyone did.
 */
export async function setRegistration(
  registration: RegistrationMode,
  updatedBy: string | null
): Promise<void> {
  await instanceTarget.write(
    db,
    { key: REGISTRATION.key, value: registration },
    updatedBy
  );
  forgetInstanceRows();
}

/**
 * The key the first-user bootstrap serialises on — "BOOT" in hex, the same
 * convention `MIGRATION_LOCK` and `TRACK_ANALYSIS_LOCK_CLASS` follow, so no
 * other subsystem's lock can collide with it.
 */
const BOOTSTRAP_LOCK = 0x424f4f54;

/**
 * `users.isAnonymous` is nullable and defaults to false, so `= false` misses a
 * row that holds NULL. Every count of the instance's real accounts asks this
 * way instead.
 */
const nonAnonymous = sql`${users.isAnonymous} is not true`;

/**
 * Whether the instance has a real account on it. A share-page guest does not
 * count: an instance whose only rows are anonymous sessions has never been
 * claimed, and the next person to register is still its first user.
 */
export async function hasAccounts(executor: Executor = db): Promise<boolean> {
  const [row] = await executor
    .select({ id: users.id })
    .from(users)
    .where(nonAnonymous)
    .limit(1);
  return row != null;
}

/**
 * How long a first-admin claim holds its slot before a sign-up for a
 * different email may take it. Long enough to cover a retry after a
 * transient failure in Better Auth's own insert; short enough that one
 * sign-up which never completes does not strand the instance without an
 * admin.
 */
const FIRST_ADMIN_CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * The key a first-admin claim is stored under: a row in
 * `instance_setting_values`, the table `instanceTarget` reads and writes, but
 * a key no settings group registers. `isSettingKey` never matches it, so the
 * hub read, the patch route and the lock route never see or accept it —
 * `admitSignUp` is its only reader and writer.
 */
const FIRST_ADMIN_CLAIM_KEY = "bootstrap.firstAdminClaim";

/** What a first-admin claim records: who it is held for. Its row's own `updatedAt` is when. */
interface FirstAdminClaim {
  email: string;
}

/**
 * The instance role a sign-up may have, or null when the instance refuses it
 * outright.
 *
 * The whole decision runs in one transaction under an advisory lock, which is
 * what makes "the first user" a single account rather than however many
 * sign-ups happen to arrive together. The lock is released when the
 * transaction commits — before Better Auth inserts the user row it asked
 * about — so the claim cannot be the user count alone: the second caller would
 * still read zero users and also call itself the first. A durable claim row
 * (`FIRST_ADMIN_CLAIM_KEY`) records who won the race instead, written
 * whenever the "open, no accounts" branch admits an admin, whether or not
 * `closeAfterFirst` also closes registration. A concurrent second sign-up
 * wakes up to that claim already held for a different, still-fresh email and
 * is admitted as `"user"` instead — the same instance a closed registration
 * would have given it. The same email retrying, or a claim older than
 * {@link FIRST_ADMIN_CLAIM_STALE_MS}, is treated as no claim at all, so a
 * first sign-up whose account never lands cannot strand the instance without
 * an admin forever.
 *
 * Read committed is what the re-read after the lock depends on: the
 * transaction takes its snapshot per statement, so the row the first caller
 * committed is visible to the second.
 */
export async function admitSignUp(
  email: string,
  database: Database = db
): Promise<InstanceRole | null> {
  const admission = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);

    const { value, invalid } = resolveSetting(
      REGISTRATION,
      layersOf({ instance: await instanceTarget.rows(tx, [REGISTRATION.key]) })
        .layers
    );
    // A stored mode the registry no longer accepts fails closed: the gate never
    // opens an instance on a row it cannot read, even though the readouts show
    // the default for it.
    const registration = invalid === undefined ? value : "closed";
    const { closeAfterFirst, invitesBypass } = instancePolicy().access;

    if (registration === "open") {
      if (await hasAccounts(tx)) return "user" as const;

      const [claimRow] = await instanceTarget.rows(tx, [FIRST_ADMIN_CLAIM_KEY]);
      const claim = claimRow?.value as FirstAdminClaim | undefined;
      const claimIsStale =
        claimRow !== undefined &&
        Date.now() - claimRow.updatedAt.getTime() > FIRST_ADMIN_CLAIM_STALE_MS;

      if (claim !== undefined && claim.email !== email && !claimIsStale) {
        return "user" as const;
      }

      await instanceTarget.write(
        tx,
        {
          key: FIRST_ADMIN_CLAIM_KEY,
          value: { email } satisfies FirstAdminClaim,
        },
        null
      );

      if (closeAfterFirst) {
        await instanceTarget.write(
          tx,
          { key: REGISTRATION.key, value: "closed" },
          null
        );
      }
      return "admin" as const;
    }

    return invitesBypass && (await hasOpenInviteFor(email, tx))
      ? ("user" as const)
      : null;
  });

  // The bootstrap closed registration; every reader's cached copy says open.
  if (admission === "admin") forgetInstanceRows();

  return admission;
}
