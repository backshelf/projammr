import type { z } from "zod";
import { buildRegistry, type GroupModule } from "./define.js";
import * as groups from "./groups/index.js";
import type { SettingDefinition, SettingGroup, SettingScope } from "./types.js";

type GroupModules = typeof groups;

/** Every registered definition, each with its own key and value type. */
export type RegisteredSetting =
  GroupModules[keyof GroupModules]["settings"][number];

/** Every registered key. */
export type SettingKey = RegisteredSetting["key"];

type SettingsRecord = {
  readonly [D in RegisteredSetting as D["key"]]: D;
};

const registry = buildRegistry(groups satisfies Record<string, GroupModule>);

/** Every group, in `order`. */
export const GROUPS: readonly SettingGroup[] = registry.groups;

/**
 * Every setting by key, frozen. A group is one file under `groups/` and one
 * line in `groups/index.ts`; this record is built from that index, so nothing
 * here changes when a group is added.
 */
export const SETTINGS = registry.settings as SettingsRecord;

/** Each key's value type, from its schema. */
export type SettingsValues = {
  [K in keyof typeof SETTINGS]: z.infer<(typeof SETTINGS)[K]["schema"]>;
};

const ALL: readonly SettingDefinition[] = Object.values(SETTINGS);

/** Whether `key` names a registered setting, narrowing it to a `SettingKey`. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

/** The settings that accept a value at `scope`, in registry order. */
export function settingsFor(scope: SettingScope): SettingDefinition[] {
  return ALL.filter((definition) => definition.scopes.includes(scope));
}

/**
 * The settings a signed-in caller receives, in registry order: every key but
 * the operational ones (`audience: "admin"`), which only an instance admin
 * reads.
 */
export function settingsReceivedBy(isAdmin: boolean): SettingDefinition[] {
  return ALL.filter((definition) => isAdmin || definition.audience !== "admin");
}
