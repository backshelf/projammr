import "dotenv/config";
import {
  SETTINGS,
  type SettingDefinition,
  type SettingKey,
} from "@workspace/settings";
import { MAX_UPLOAD_CEILING_MB } from "@workspace/settings/bounds";
import {
  RATE_BUCKET_NAMES,
  type RateBucketName,
} from "@workspace/settings/groups/instance-rate-limits";
import { z } from "zod";

/*
 * Everything an instance admin can set about how this server behaves: access
 * and accounts, limits and storage, background work, integrations and the
 * rate buckets. Each value is an instance setting (the `instance-*` groups of
 * `@workspace/settings`), tied to it in one place, `POLICY_SETTINGS` below:
 * the policy's schema is built from those settings' schemas, its defaults from
 * their defaults and the environment, and a refresh from their effective
 * values (`db/queries/settings.ts` feeds it the stored rows).
 *
 * Every consumer reads the current snapshot through `instancePolicy()` at the
 * moment it acts, so `refreshInstancePolicy` replacing the snapshot reaches the
 * next upload, sign-in or request without a restart. The few values Better
 * Auth and the MCP mount can only take at construction (`sessionLifetimeDays`,
 * `mcpEnabled`, `mcpAccessTokenHours`, `mcpRefreshTokenDays`) are read once,
 * through `runningInstancePolicy()`.
 *
 * `DEFAULT_INSTANCE_POLICY` is the seed: the environment's values where an
 * operator sets one, the settings' defaults otherwise. A malformed variable
 * stops the process at import, with the variable named, rather than failing
 * at the first request that reads it.
 *
 * This module imports only the settings registry, which imports nothing of
 * the server's, so any module — `lib/log.ts` included — can read the policy
 * without an import cycle.
 */

const MIB = 1024 * 1024;

/**
 * Room above the file for the rest of an upload request: the multipart
 * boundaries and part headers (a few hundred bytes each) and the form's text
 * fields (ids, timestamps, a file path, a fingerprint), which come to a few
 * kilobytes at most. A mebibyte covers them many times over.
 */
export const UPLOAD_ENVELOPE_BYTES = MIB;

/**
 * The largest request body the server will receive at all (`Bun.serve`'s
 * `maxRequestBodySize`), which Bun answers with a bare 413 before the app
 * runs: the upload ceiling (`MAX_UPLOAD_CEILING_MB`) and the envelope, so a
 * file at the largest limit an instance can set can reach the upload route.
 * It is not what any route reads — `middleware/body-limit.ts` holds an upload
 * route to the instance's own limit and every other route to
 * {@link REQUEST_BODY_CAP_BYTES}, per request and before a handler reads the
 * body.
 */
export const MAX_REQUEST_BODY_BYTES =
  MAX_UPLOAD_CEILING_MB * MIB + UPLOAD_ENVELOPE_BYTES;

/**
 * The largest body a route that takes no upload reads: 128 MiB and the
 * envelope, the cap every route had before uploads could be set past it.
 * Fixed, so raising the upload limit, or the ceiling, never raises what a
 * JSON route will buffer.
 */
export const REQUEST_BODY_CAP_BYTES = 128 * MIB + UPLOAD_ENVELOPE_BYTES;

/**
 * An environment variable that seeds a setting, and how its text becomes a
 * value for the setting's schema to check.
 */
type EnvSeed = {
  readonly variable: string;
  readonly read: (raw: string) => unknown;
};

/** One policy value: the instance setting that holds it, and the variable that seeds it, if any. */
type PolicySetting = { readonly key: SettingKey; readonly env?: EnvSeed };

type PolicySection = Readonly<Record<string, PolicySetting>>;

const asNumber = (raw: string): unknown => Number(raw);
const asWord = (raw: string): unknown => raw.toLowerCase();

/** One value per bucket, built by `each` from the bucket's name. */
const perBucket = <T>(
  each: (name: RateBucketName) => T
): Record<RateBucketName, T> =>
  Object.fromEntries(
    RATE_BUCKET_NAMES.map((name) => [name, each(name)])
  ) as Record<RateBucketName, T>;

/**
 * Where each policy value is set: the instance setting that holds it and, for
 * the few an operator can seed from the environment, the variable. A seeded
 * setting's variable gives it its value until an admin stores one (the
 * settings' `env` layer, {@link SEEDED_SETTINGS}), and only unsetting the
 * variable takes that value away.
 */
const POLICY_SETTINGS = {
  access: {
    closeAfterFirst: { key: "instance-access.closeAfterFirst" },
    invitesBypass: { key: "instance-access.invitesBypass" },
    requireVerifiedEmail: { key: "instance-access.requireVerifiedEmail" },
    sessionLifetimeDays: { key: "instance-access.sessionLifetimeDays" },
    passwordMin: { key: "instance-access.passwordMin" },
    passwordMax: { key: "instance-access.passwordMax" },
    lockoutFreeFailures: { key: "instance-access.lockoutFreeFailures" },
    lockoutBaseMinutes: { key: "instance-access.lockoutBaseMinutes" },
    lockoutMaxMinutes: { key: "instance-access.lockoutMaxMinutes" },
    linkLifetimeMinutes: { key: "instance-access.linkLifetimeMinutes" },
    guestAccess: { key: "instance-access.guestAccess" },
    selfDeletion: { key: "instance-access.selfDeletion" },
  },
  limits: {
    maxUploadMb: {
      key: "instance-limits.maxUploadMb",
      env: { variable: "MAX_UPLOAD_MB", read: asNumber },
    },
    projectCapGb: {
      key: "instance-limits.projectCapGb",
      env: { variable: "MAX_PROJECT_GB", read: asNumber },
    },
    userCapGb: {
      key: "instance-limits.userCapGb",
      env: { variable: "MAX_USER_GB", read: asNumber },
    },
    audioTypes: { key: "instance-limits.audioTypes" },
    imageTypes: { key: "instance-limits.imageTypes" },
    auditIntervalHours: { key: "instance-limits.auditIntervalHours" },
    orphanMode: { key: "instance-limits.orphanMode" },
    guestRetentionDays: { key: "instance-limits.guestRetentionDays" },
    longestAudioHours: { key: "instance-limits.longestAudioHours" },
    pushSamplesEverywhere: { key: "instance-limits.pushSamplesEverywhere" },
  },
  jobs: {
    analysisWorkers: {
      key: "instance-jobs.analysisWorkers",
      env: { variable: "MEDIA_CONCURRENCY", read: asNumber },
    },
    jobRetentionDays: { key: "instance-jobs.jobRetentionDays" },
    activityRetentionDays: { key: "instance-jobs.activityRetentionDays" },
    saveContentRetentionDays: {
      key: "instance-jobs.saveContentRetentionDays",
      env: { variable: "SAVE_CONTENT_RETENTION_DAYS", read: asNumber },
    },
  },
  integrations: {
    mcpEnabled: { key: "instance-integrations.mcpEnabled" },
    mcpToolGroups: { key: "instance-integrations.mcpToolGroups" },
    mcpAccessTokenHours: { key: "instance-integrations.mcpAccessTokenHours" },
    mcpRefreshTokenDays: { key: "instance-integrations.mcpRefreshTokenDays" },
    logLevel: {
      key: "instance-integrations.logLevel",
      env: { variable: "LOG_LEVEL", read: asWord },
    },
    updateCheck: { key: "instance-branding.updateCheck" },
  },
  rateLimits: perBucket((name) => ({
    burst: { key: `instance-rate-limits.${name}.burst` as const },
    perMinute: { key: `instance-rate-limits.${name}.perMinute` as const },
  })),
} as const satisfies Readonly<
  Record<string, PolicySection | Readonly<Record<string, PolicySection>>>
>;

/** A section's shape: each value checked by its own setting's schema. */
type SectionShape<S extends PolicySection> = {
  -readonly [F in keyof S]: (typeof SETTINGS)[S[F]["key"]]["schema"];
};

const sectionSchema = <S extends PolicySection>(section: S) =>
  z.object(
    Object.fromEntries(
      Object.entries(section).map(([field, { key }]) => [
        field,
        SETTINGS[key].schema,
      ])
    ) as SectionShape<S>
  );

/** Access values that come in pairs, the first never above the second. */
const ORDERED_ACCESS = [
  ["passwordMin", "passwordMax"],
  ["lockoutBaseMinutes", "lockoutMaxMinutes"],
] as const;

const labelOf = (field: keyof typeof POLICY_SETTINGS.access) =>
  SETTINGS[POLICY_SETTINGS.access[field].key].label;

/**
 * The policy's shape and every value's range. `refreshInstancePolicy` parses
 * its source with this, so a consumer never reads a value outside it. A pair
 * out of order is refused at both of its values, so whichever setting a write
 * changed carries the reason.
 */
export const instancePolicySchema = z.object({
  access: sectionSchema(POLICY_SETTINGS.access).superRefine(
    (access, context) => {
      for (const [lower, upper] of ORDERED_ACCESS) {
        if (access[lower] <= access[upper]) continue;
        const message = `${labelOf(lower)} must not be more than the ${labelOf(upper).toLowerCase()}`;
        for (const field of [lower, upper]) {
          context.addIssue({ code: "custom", path: [field], message });
        }
      }
    }
  ),
  limits: sectionSchema(POLICY_SETTINGS.limits),
  jobs: sectionSchema(POLICY_SETTINGS.jobs),
  integrations: sectionSchema(POLICY_SETTINGS.integrations),
  rateLimits: z.object(
    perBucket((name) => sectionSchema(POLICY_SETTINGS.rateLimits[name]))
  ),
});

export type InstancePolicy = z.output<typeof instancePolicySchema>;

type PolicyNode = PolicySetting | { readonly [field: string]: PolicyNode };

const isSetting = (node: PolicyNode): node is PolicySetting =>
  typeof node.key === "string";

type PolicyValue = { path: readonly string[]; setting: PolicySetting };

function valuesUnder(node: PolicyNode, path: readonly string[]): PolicyValue[] {
  return isSetting(node)
    ? [{ path, setting: node }]
    : Object.entries(node).flatMap(([field, child]) =>
        valuesUnder(child, [...path, field])
      );
}

/** Every policy value, by its path through the policy, with its setting. */
const POLICY_VALUES = valuesUnder(POLICY_SETTINGS, []);

const pathOfKey = new Map<string, readonly string[]>(
  POLICY_VALUES.map(({ path, setting }) => [setting.key, path])
);

const keyOfPath = new Map<string, SettingKey>(
  POLICY_VALUES.map(({ path, setting }) => [path.join("."), setting.key])
);

/**
 * A policy source, unchecked, with each value taken from its setting by
 * `valueOf`: what {@link refreshInstancePolicy} and {@link settingsRefusedBy}
 * take, from whatever layers the caller resolves the settings over.
 */
export function policySource(
  valueOf: (definition: SettingDefinition) => unknown
): z.input<typeof instancePolicySchema> {
  const build = (node: PolicyNode): unknown =>
    isSetting(node)
      ? valueOf(SETTINGS[node.key])
      : Object.fromEntries(
          Object.entries(node).map(([field, child]) => [field, build(child)])
        );
  return build(POLICY_SETTINGS) as z.input<typeof instancePolicySchema>;
}

/**
 * The settings behind every value `source` breaks, each with why, keyed as a
 * settings write names them: empty when the policy takes the source. A value
 * a setting's own schema accepts can still break a pair, which is what a
 * write is checked for before it commits.
 */
export function settingsRefusedBy(
  source: z.input<typeof instancePolicySchema>
): { key: SettingKey; message: string }[] {
  const parsed = instancePolicySchema.safeParse(source);
  if (parsed.success) return [];
  return parsed.error.issues.flatMap(({ path, message }) => {
    const key = keyOfPath.get(path.join("."));
    return key === undefined ? [] : [{ key, message }];
  });
}

/** The value `policy` holds for setting `key`; undefined for a key no policy value reads. */
export function settingValueIn(policy: InstancePolicy, key: string): unknown {
  const path = pathOfKey.get(key);
  if (path === undefined) return undefined;
  let value: unknown = policy;
  for (const field of path) value = (value as Record<string, unknown>)[field];
  return value;
}

/** A variable's value, or undefined when it is unset or blank. */
const envValue = (name: string): string | undefined =>
  process.env[name]?.trim() || undefined;

/** Freezes a value all the way down, so no reader can edit what every other reader sees. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Every seeded setting whose variable is set, by key, with the value its schema reads from it. */
function seedsFromEnvironment(): Record<string, unknown> {
  const seeds: Record<string, unknown> = {};
  for (const { setting } of POLICY_VALUES) {
    const { key, env } = setting;
    const raw = env && envValue(env.variable);
    if (env === undefined || raw === undefined) continue;
    const definition: SettingDefinition = SETTINGS[key];
    const parsed = definition.schema.safeParse(env.read(raw));
    if (!parsed.success) {
      throw new Error(
        `${env.variable} is not a valid ${definition.label.toLowerCase()}, got "${raw}":\n${z.prettifyError(parsed.error)}`
      );
    }
    seeds[key] = parsed.data;
  }
  return seeds;
}

/**
 * The seeded settings whose variable is set, by key, with the value the
 * variable gives: the settings' `env` layer, below a stored row and above the
 * default. A seeded setting whose variable is unset is absent.
 */
export const SEEDED_SETTINGS: Readonly<Record<string, unknown>> = deepFreeze(
  seedsFromEnvironment()
);

/** Every variable that seeds a setting, with the setting it seeds. */
export const SEED_VARIABLES: readonly { variable: string; key: SettingKey }[] =
  POLICY_VALUES.flatMap(({ setting: { key, env } }) =>
    env === undefined ? [] : [{ variable: env.variable, key }]
  );

function seedPolicy(): InstancePolicy {
  const parsed = instancePolicySchema.safeParse(
    policySource((definition) =>
      Object.hasOwn(SEEDED_SETTINGS, definition.key)
        ? SEEDED_SETTINGS[definition.key]
        : definition.default
    )
  );
  if (!parsed.success) {
    throw new Error(
      `The instance policy seeded from the environment is invalid:\n${z.prettifyError(parsed.error)}`
    );
  }
  return deepFreeze(parsed.data);
}

/** The policy an instance starts from: the environment's values, and the settings' defaults beneath them. */
export const DEFAULT_INSTANCE_POLICY: InstancePolicy = seedPolicy();

let current: InstancePolicy = DEFAULT_INSTANCE_POLICY;

let running: InstancePolicy | undefined;

type PolicyListener = (next: InstancePolicy, previous: InstancePolicy) => void;

const listeners = new Set<PolicyListener>();

/** The policy in force right now. Read it where the value is used, never into a module-level copy. */
export function instancePolicy(): InstancePolicy {
  return current;
}

/**
 * The policy this process runs its read-once values with: the snapshot in
 * force at the first call, kept until the process ends. `auth.ts` makes that
 * call as it is first evaluated, for the session lifetime and the MCP switch,
 * which Better Auth and the MCP mount take at construction; the server loads
 * the stored settings before it imports the app, so this is the policy they
 * held at boot. The settings hub reports a restart-required setting's value
 * from here as `running`.
 */
export function runningInstancePolicy(): InstancePolicy {
  running ??= current;
  return running;
}

/**
 * Replaces the snapshot with `source`, validated in full: a source outside
 * {@link instancePolicySchema} throws its `ZodError` and leaves the snapshot
 * as it was. Every reader sees the new values on its next read; the timers and
 * the job queue that hold a value between reads are told through
 * {@link onInstancePolicyChange}.
 */
export function refreshInstancePolicy(
  source: z.input<typeof instancePolicySchema>
): InstancePolicy {
  const next = deepFreeze(instancePolicySchema.parse(source));
  const previous = current;
  current = next;
  for (const listener of listeners) listener(next, previous);
  return next;
}

/**
 * Calls `listener` after every refresh with the new snapshot and the one it
 * replaced, for a holder of a value that cannot simply read it per use — an
 * armed timer, the job queue's concurrency. Returns the unsubscribe.
 */
export function onInstancePolicyChange(listener: PolicyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The largest file, in bytes, the upload routes accept under `policy`. */
export const uploadLimitBytes = (policy = instancePolicy()): number =>
  Math.floor(policy.limits.maxUploadMb * MIB);
