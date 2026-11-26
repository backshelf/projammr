import {
  SETTING_LOCK_SCOPES,
  type SettingDefinition,
  type SettingLockScope,
  type SettingScope,
  type SettingSource,
} from "@workspace/settings";
import type { HubRow } from "./types";

/** What one row shows at the scope it writes, read off the server's hub row. */
export type RowView = {
  /** The value the row's control shows. */
  value: unknown;
  /** Where that value comes from. */
  source: SettingSource;
  /** The row's own scope holds a value, which Reset clears so the value is inherited again. */
  modified: boolean;
  /** The lock that pins the value from below the row's scope; the control is disabled while it holds. */
  lockedBy?: SettingLockScope;
  /** Whether the caller may change the value at the row's scope now. */
  editable: boolean;
  /** The row's own lock, where the caller may set or lift one at its scope. */
  lock?: { locked: boolean };
  /**
   * Whether Reset is offered: the row holds a value the caller may clear. A
   * row locked at its own scope is cleared only by a caller who may lock
   * there, since clearing lifts the lock.
   */
  resettable: boolean;
  /**
   * For a restart-required setting, whether the server already runs with the
   * value (`applied`) or waits on a restart for it (`pending`).
   */
  restart?: "applied" | "pending" | "deployment-off";
};

const LOCK_SCOPES: readonly SettingScope[] = SETTING_LOCK_SCOPES;

/**
 * Whether a restart-required setting's value is not the one the server runs
 * with: it changed since the server started, and the deployment does not hold
 * it off. Values are compared as the JSON the hub read carries them in.
 */
export const waitsOnRestart = (row: HubRow): boolean =>
  !row.deploymentOff &&
  row.running !== undefined &&
  JSON.stringify(row.running) !== JSON.stringify(row.effective);

/**
 * A row's view of a setting at `scope`. The server has already decided
 * everything but the value a lower scope would inherit: at the key's highest
 * scope the row shows the effective value and its source as they are, while
 * a row for a lower scope (a member default) shows what that scope holds, or,
 * holding nothing, the first value held below it, or the registry default.
 *
 * The default stands in for the `env` layer, which the hub read does not
 * list per scope; the server only seeds `env` for keys whose single scope is
 * the instance, whose rows take the first branch.
 */
export function rowView(
  definition: SettingDefinition,
  scope: SettingScope,
  row: HubRow
): RowView {
  const { scopes } = definition;
  const at = scopes.indexOf(scope);
  const lockedBy =
    row.lockedBy !== undefined && scopes.indexOf(row.lockedBy) > at
      ? row.lockedBy
      : undefined;
  const editable = row.writable[scope] === true;
  const mayLock = row.lockable[scope] === true;
  const modified = Object.hasOwn(row.values, scope);

  const view: RowView = {
    ...(at === 0
      ? { value: row.effective, source: row.source }
      : inherited(definition, lockedBy ?? scope, row)),
    modified,
    editable,
    resettable: modified && editable && (row.lockedBy !== scope || mayLock),
  };
  if (lockedBy !== undefined) view.lockedBy = lockedBy;
  // A lock pins the scopes above the one holding it, so it means something
  // only on a lockable key with a scope above this one, and is the caller's
  // to set only where the server lets them lock.
  if (
    editable &&
    mayLock &&
    at > 0 &&
    definition.lockable !== false &&
    LOCK_SCOPES.includes(scope)
  ) {
    view.lock = { locked: row.lockedBy === scope };
  }
  if (row.running !== undefined) {
    view.restart = row.deploymentOff
      ? "deployment-off"
      : waitsOnRestart(row)
        ? "pending"
        : "applied";
  }
  return view;
}

/** The first value held at `from` or below it, else the value the whole cascade fell through to. */
function inherited(
  definition: SettingDefinition,
  from: SettingScope,
  row: HubRow
): { value: unknown; source: SettingSource } {
  const { scopes } = definition;
  for (const scope of scopes.slice(scopes.indexOf(from))) {
    if (Object.hasOwn(row.values, scope)) {
      return { value: row.values[scope], source: scope };
    }
  }
  if (row.source === "env" || row.source === "default") {
    return { value: row.effective, source: row.source };
  }
  return { value: definition.default, source: "default" };
}
