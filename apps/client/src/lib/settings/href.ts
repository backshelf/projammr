import { parseId } from "@/lib/route-pattern";
import type { SettingSection } from "@workspace/settings";

/** A place in the settings hub. */
export type SettingsLocation = {
  section: SettingSection;
  /**
   * The project the Project section is for. Without one, `/settings/project`
   * sends the reader on to the current project's.
   */
  projectId?: number;
  /** A group or a pane of the section; the Devices section has neither in its URL. */
  group?: string;
  /** A setting's key, the row the hub scrolls to. */
  key?: string;
};

/**
 * The hub's URL for a section, one of its groups or panes, and a row:
 * `/settings/personal/<group>#<key>`, `/settings/project/<id>/<group>`,
 * `/settings/instance/<group>`, `/settings/devices`.
 */
export function settingsHref({
  section,
  projectId,
  group,
  key,
}: SettingsLocation): string {
  const segments: string[] = ["settings", section];
  // A project's groups sit under its id, so without one there is nowhere to put the group.
  const project = section === "project";
  if (project && projectId !== undefined) segments.push(String(projectId));
  const groupable =
    section !== "devices" && (!project || projectId !== undefined);
  if (group !== undefined && groupable)
    segments.push(encodeURIComponent(group));
  const path = `/${segments.join("/")}`;
  return key === undefined ? path : `${path}#${encodeURIComponent(key)}`;
}

/** The id of a machine's row on the Devices page, which `#machine-<id>` names. */
export const machineAnchor = (machineId: string): string =>
  `machine-${machineId}`;

/** The hub's URL for a machine's row on the Devices page. */
export const machineHref = (machineId: string): string =>
  settingsHref({ section: "devices", key: machineAnchor(machineId) });

/** Where every "Settings" entry point opens the hub: the caller's own settings. */
export const SETTINGS_HREF = settingsHref({ section: "personal" });

/** Whether a pathname is in the settings hub, rather than merely starting like it. */
export const isSettingsPath = (pathname: string): boolean =>
  pathname === "/settings" || pathname.startsWith("/settings/");

/**
 * The project a hub pathname's Project section is for, the inverse of
 * `settingsHref`'s id segment: `7` for `/settings/project/7/assets`, `null`
 * for any other pathname.
 */
export function settingsProjectId(pathname: string): number | null {
  const [, root, section, id] = pathname.split("/");
  return root === "settings" && section === "project" ? parseId(id) : null;
}
