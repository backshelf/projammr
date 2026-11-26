import { describe, expect, it } from "bun:test";
import { SETTINGS } from "../registry.js";
import type { SettingDefinition } from "../types.js";

/**
 * The literal `DEFAULT_PROJECT_POLICY` replaces (this package cannot import
 * `apps/server`): a change to one without the other is a broken pin.
 */
const DEFAULT_PROJECT_POLICY = {
  defaults: {
    trackStatusId: 1,
    collectionStatusId: 1,
    labelIds: [],
    artists: [],
    explicit: false,
    newSessionMain: false,
  },
  sharing: {
    shareKind: "connected",
    shareExpiresDays: null,
    shareCommentPrivacy: "public",
    shareDownloads: false,
    guestComments: true,
    inviteRole: "viewer",
    inviteDays: 7,
    whoMayInvite: "admin",
  },
} as const;

const projectSettings: [string, SettingDefinition][] = Object.entries(
  SETTINGS
).filter(
  ([key]) =>
    key.startsWith("project-defaults.") || key.startsWith("project-sharing.")
);

const camelName = (key: string) => key.split(".")[1]!;

describe("the Project groups project-defaults and project-sharing", () => {
  it("are the project section's, scoped project over instance, admin-gated and open to every member", () => {
    for (const [key, definition] of projectSettings) {
      expect(definition.scopes).toEqual(["project", "instance"]);
      expect(definition.minRole).toBe("admin");
      expect(definition.audience).toBe("all");
      expect(key).toBe(`${definition.group}.${camelName(key)}`);
    }
  });

  it("default to the project policy's own default", () => {
    for (const [key, definition] of projectSettings) {
      const [group, name] = key.split(".") as [
        "project-defaults" | "project-sharing",
        string,
      ];
      const section = group === "project-defaults" ? "defaults" : "sharing";
      const expected =
        DEFAULT_PROJECT_POLICY[section][
          name as keyof (typeof DEFAULT_PROJECT_POLICY)[typeof section]
        ];
      expect(definition.default).toEqual(expected);
      expect(definition.schema.safeParse(definition.default).success).toBe(
        true
      );
    }
  });

  it("edit a status or the labels through the project's own custom controls", () => {
    expect(SETTINGS["project-defaults.trackStatusId"].control).toEqual({
      kind: "custom",
      component: "project-status",
    });
    expect(SETTINGS["project-defaults.collectionStatusId"].control).toEqual({
      kind: "custom",
      component: "project-status",
    });
    expect(SETTINGS["project-defaults.labelIds"].control).toEqual({
      kind: "custom",
      component: "project-labels",
    });
  });

  it("show a share link's expiry as a duration that never expires when empty", () => {
    const { control, schema } = SETTINGS["project-sharing.shareExpiresDays"];

    expect(control).toEqual({
      kind: "duration",
      unit: "d",
      min: 1,
      max: 3650,
      placeholder: "Never",
    });
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
  });
});
