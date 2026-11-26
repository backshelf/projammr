import { describe, expect, it } from "bun:test";
import {
  isSettingsPath,
  SETTINGS_HREF,
  settingsHref,
  settingsProjectId,
} from "./href";

describe("SETTINGS_HREF", () => {
  it("opens the hub on the caller's own settings", () => {
    expect(SETTINGS_HREF).toBe("/settings/personal");
  });
});

describe("isSettingsPath", () => {
  it("is true across the hub", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings/personal/editor")).toBe(true);
    expect(isSettingsPath("/settings/project/7/labels")).toBe(true);
  });

  it("is false for a path merely prefixed like it, or a project's own pages", () => {
    expect(isSettingsPath("/settingsx")).toBe(false);
    expect(isSettingsPath("/project/7/settings")).toBe(false);
    expect(isSettingsPath("/profile")).toBe(false);
  });
});

describe("settingsProjectId", () => {
  it("reads the project a Project section URL names", () => {
    expect(settingsProjectId("/settings/project/7")).toBe(7);
    expect(settingsProjectId("/settings/project/7/assets")).toBe(7);
    expect(
      settingsProjectId(
        settingsHref({ section: "project", projectId: 12, group: "labels" })
      )
    ).toBe(12);
  });

  it("is null for every other pathname", () => {
    expect(settingsProjectId("/settings/project")).toBeNull();
    expect(settingsProjectId("/settings/project/new")).toBeNull();
    expect(settingsProjectId("/settings/personal/editor")).toBeNull();
    expect(settingsProjectId("/project/7/settings")).toBeNull();
    expect(settingsProjectId("/")).toBeNull();
  });
});

describe("settingsHref", () => {
  it("builds a section's URL", () => {
    expect(settingsHref({ section: "personal" })).toBe("/settings/personal");
    expect(settingsHref({ section: "instance" })).toBe("/settings/instance");
    expect(settingsHref({ section: "devices" })).toBe("/settings/devices");
  });

  it("puts a group or a pane after the section", () => {
    expect(settingsHref({ section: "personal", group: "editor" })).toBe(
      "/settings/personal/editor"
    );
    expect(
      settingsHref({ section: "instance", group: "member-defaults" })
    ).toBe("/settings/instance/member-defaults");
  });

  it("puts a project's groups under its id", () => {
    expect(settingsHref({ section: "project", projectId: 7 })).toBe(
      "/settings/project/7"
    );
    expect(
      settingsHref({ section: "project", projectId: 7, group: "labels" })
    ).toBe("/settings/project/7/labels");
  });

  it("leaves the project to the current one when none is named", () => {
    expect(settingsHref({ section: "project", group: "labels" })).toBe(
      "/settings/project"
    );
  });

  it("anchors a row by its key", () => {
    expect(
      settingsHref({
        section: "personal",
        group: "editor",
        key: "editor.rhymePrefix",
      })
    ).toBe("/settings/personal/editor#editor.rhymePrefix");
    expect(settingsHref({ section: "devices", key: "device.volume" })).toBe(
      "/settings/devices#device.volume"
    );
  });

  it("escapes what a path segment cannot carry", () => {
    expect(settingsHref({ section: "personal", group: "a/b" })).toBe(
      "/settings/personal/a%2Fb"
    );
  });
});
