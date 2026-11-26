import { hubLayout } from "@/components/settings-hub/layout";
import type { HubProject } from "@/components/settings-hub/panes/types";
import { searchSettings } from "@/components/settings-hub/search";
import { settingsHref } from "@/lib/settings/href";
import {
  SETTINGS,
  settingsReceivedBy,
  type SettingKey,
} from "@workspace/settings";

/** A setting as the palette offers it: its row in the hub, and the group it sits in. */
export type SettingResult = {
  key: SettingKey;
  label: string;
  /** The label of the setting's own group, the result's second line. */
  group: string;
  href: string;
};

/**
 * Every setting the caller can open in the hub, as a palette result that
 * opens the hub at its row in its own group. The hub's own layout for this
 * caller decides, so a setting is offered exactly where the hub would show
 * it: an admin-only setting, or one in the Instance section, to an instance
 * admin; one in the Project section with a project. `project` is the one
 * the hub resolves its pages with outside the Project section, the current
 * project.
 */
export function settingResults({
  isAdmin,
  project,
}: {
  isAdmin: boolean;
  project: HubProject | null;
}): SettingResult[] {
  const visible = new Set<string>(
    settingsReceivedBy(isAdmin).map(({ key }) => key)
  );
  const { sections } = hubLayout({ visible, isAdmin, project, panes: [] });

  return sections.flatMap((section) =>
    section.entries.flatMap((entry) =>
      entry.kind === "group"
        ? entry.rows
            .filter(({ key }) => SETTINGS[key].group === entry.id)
            .map(({ key }) => ({
              key,
              label: SETTINGS[key].label,
              group: entry.label,
              href: settingsHref({
                section: section.id,
                projectId: project?.id,
                group: entry.id,
                key,
              }),
            }))
        : []
    )
  );
}

/** The results whose setting matches `query`, as the hub's own search matches. */
export const matchSettingResults = (
  results: readonly SettingResult[],
  query: string
): SettingResult[] => searchSettings(results, query);
