import { SETTINGS, type SettingsValues } from "@workspace/settings";

/**
 * A caller's settings as the client holds them: a value for every registered
 * key, and the version of the read they came from. The server resolves every
 * value; the client adds nothing but the registry defaults for the keys the
 * server did not send.
 */
export type EffectiveSettings = {
  readonly values: SettingsValues;
  readonly version: string;
};

/** Every registered key at its registry default. */
export const DEFAULT_SETTINGS: SettingsValues = Object.freeze(
  Object.fromEntries(
    Object.values(SETTINGS).map((definition) => [
      definition.key,
      definition.default,
    ])
  )
) as SettingsValues;

/**
 * The values a read answered with, over the registry defaults. The server
 * leaves out the keys the caller does not receive (admin-only keys for anyone
 * else, every non-public key when signed out); those read as their default.
 */
export const effectiveSettings = (
  values: Partial<SettingsValues>,
  version: string
): EffectiveSettings => ({
  values: { ...DEFAULT_SETTINGS, ...values },
  version,
});

/** What a page renders from when no read could answer. */
export const DEFAULT_EFFECTIVE_SETTINGS = effectiveSettings({}, "defaults");
