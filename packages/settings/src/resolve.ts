import { SETTINGS, type SettingKey, type SettingsValues } from "./registry.js";
import type {
  Resolved,
  SettingDefinition,
  SettingLockScope,
  SettingScope,
  SettingSource,
} from "./types.js";

/**
 * Stored values by layer, each keyed by setting key: one record per scope for
 * the caller's context, plus the `env` seed that sits below every scope.
 */
export type SettingLayers = Partial<
  Record<SettingScope | "env", Readonly<Record<string, unknown>>>
>;

/** The keys locked at each scope a lock can be set at. */
export type SettingLocks = Partial<
  Record<SettingLockScope, ReadonlySet<string>>
>;

/** Every registered key's effective value, typed by key. */
export type ResolvedSettings = {
  [K in SettingKey]: Resolved<SettingsValues[K]>;
};

/** Instance authority is above project's, so its lock wins when both lock a key. */
const LOCK_PRECEDENCE: readonly SettingLockScope[] = ["instance", "project"];

const holds = (
  layer: Readonly<Record<string, unknown>> | undefined,
  key: string
): layer is Readonly<Record<string, unknown>> =>
  layer !== undefined && Object.hasOwn(layer, key);

/**
 * The scope whose lock pins `definition`, if any. A lock counts only on a
 * lockable key, at a scope the key accepts, over a row that exists there.
 */
function lockingScope(
  definition: SettingDefinition,
  layers: SettingLayers,
  locks: SettingLocks
): SettingLockScope | undefined {
  if (definition.lockable === false) return undefined;
  return LOCK_PRECEDENCE.find(
    (scope) =>
      definition.scopes.includes(scope) &&
      locks[scope]?.has(definition.key) === true &&
      holds(layers[scope], definition.key)
  );
}

/**
 * One key's effective value. The cascade walks the key's `scopes` in order and
 * takes the first stored value its schema accepts; a value it rejects is
 * skipped and its scope listed under `invalid`. A lock starts the walk at the
 * locking scope, so every scope above it is inert. Below the scopes come the
 * `env` layer and then the default. A layer holding a key its scopes do not
 * list is never read.
 */
export function resolveSetting<V>(
  definition: SettingDefinition<V>,
  layers: SettingLayers,
  locks: SettingLocks = {}
): Resolved<V> {
  const { key, scopes, schema } = definition;
  const lockedBy = lockingScope(definition, layers, locks);
  const walked =
    lockedBy === undefined ? scopes : scopes.slice(scopes.indexOf(lockedBy));
  const invalid: SettingScope[] = [];

  const settle = (value: V, source: SettingSource): Resolved<V> => {
    const resolved: Resolved<V> = { value, source };
    if (lockedBy !== undefined) resolved.lockedBy = lockedBy;
    if (invalid.length > 0) resolved.invalid = invalid;
    return resolved;
  };

  for (const scope of walked) {
    const layer = layers[scope];
    if (!holds(layer, key)) continue;
    const parsed = schema.safeParse(layer[key]);
    if (parsed.success) return settle(parsed.data, scope);
    invalid.push(scope);
  }
  if (holds(layers.env, key)) {
    const parsed = schema.safeParse(layers.env[key]);
    if (parsed.success) return settle(parsed.data, "env");
  }
  // Parsed like every other layer (`defineSetting` checked that it parses),
  // which hands each caller a copy rather than the registry's own object.
  return settle(schema.parse(definition.default), "default");
}

/** Every registered key's effective value over the same layers and locks. */
export function resolve(
  layers: SettingLayers,
  locks: SettingLocks = {}
): ResolvedSettings {
  const definitions: readonly SettingDefinition[] = Object.values(SETTINGS);
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      resolveSetting(definition, layers, locks),
    ])
  ) as ResolvedSettings;
}
