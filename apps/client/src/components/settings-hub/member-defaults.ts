import type { SettingsWriteScope } from "@/lib/settings/provider";
import { GROUPS, SETTINGS, type RegisteredSetting } from "@workspace/settings";
import type { HubGroupEntry } from "./layout";

/** The generated group's id, its URL segment in its section. */
const MEMBER_DEFAULTS = "member-defaults";

/** After every group a section declares. */
const MEMBER_DEFAULTS_ORDER = 1000;

const DEFINITIONS: readonly RegisteredSetting[] = Object.values(SETTINGS);

const PERSONAL_GROUPS = new Set(
  GROUPS.filter((group) => group.section === "personal").map(({ id }) => id)
);

/**
 * The "Member defaults" group a section generates from the registry: every
 * personal setting that takes a value at `scope`, written there, each with
 * the lock that holds it for everyone below. Rows the caller does not
 * receive are left out; with none left the group has no rows, and the hub
 * shows no group with no rows.
 */
export function memberDefaultsGroup(
  scope: SettingsWriteScope,
  description: string,
  visible: ReadonlySet<string>
): HubGroupEntry {
  return {
    kind: "group",
    id: MEMBER_DEFAULTS,
    label: "Member defaults",
    description,
    order: MEMBER_DEFAULTS_ORDER,
    rows: DEFINITIONS.filter(
      (definition) =>
        PERSONAL_GROUPS.has(definition.group) &&
        definition.scopes.includes(scope) &&
        visible.has(definition.key)
    ).map((definition) => ({ key: definition.key, scope })),
  };
}
