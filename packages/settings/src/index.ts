export type * from "./types.js";
export {
  SETTING_LOCK_SCOPES,
  SETTING_SCOPES,
  SETTING_SOURCES,
} from "./types.js";
export { defineGroup, defineSetting } from "./define.js";
export {
  GROUPS,
  SETTINGS,
  isSettingKey,
  settingsFor,
  settingsReceivedBy,
  type RegisteredSetting,
  type SettingKey,
  type SettingsValues,
} from "./registry.js";
export { valuesSchema, type ValuesShape } from "./values.js";
export {
  resolve,
  resolveSetting,
  type ResolvedSettings,
  type SettingLayers,
  type SettingLocks,
} from "./resolve.js";
export {
  canonicalCombo,
  isValidCombo,
  parseCombo,
  type Combo,
  type KeyEventLike,
} from "./keymap.js";
export { documentAttributes, documentProperties } from "./document.js";
