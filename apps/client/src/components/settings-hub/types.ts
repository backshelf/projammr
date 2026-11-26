import type { SettingsWriteScope } from "@/lib/settings/provider";
import type {
  SettingKey,
  SettingLockScope,
  SettingScope,
  SettingSource,
} from "@workspace/settings";

/**
 * The hub's view of one setting, as `GET /settings` and every write and lock
 * answer carry it: the effective value and where it came from, the lock
 * pinning it, where the caller may write it and lock it now, what each scope holds, and
 * for a restart-required setting the value the server is running with.
 */
export type HubRow = {
  effective: unknown;
  source: SettingSource;
  lockedBy?: SettingLockScope;
  writable: Partial<Record<SettingScope, boolean>>;
  /** Where the caller may set, lift or clear a lock now; the server states the role rule once, here. */
  lockable: Partial<Record<SettingScope, boolean>>;
  values: Partial<Record<SettingScope, unknown>>;
  running?: unknown;
  /** The deployment keeps the setting off, so a restart will not apply its value. */
  deploymentOff?: true;
};

/** Hub rows by key; a key the caller does not receive is absent. */
export type HubRows = Partial<Record<SettingKey, HubRow>>;

/** One row of the hub: a setting, and the scope its control writes. */
export type HubRowRef = { key: SettingKey; scope: SettingsWriteScope };
