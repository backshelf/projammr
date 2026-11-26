import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

// The registry declares no admin-audience setting yet, so this file's copy of
// it gains one, in the Personal section's editor group.
const registry = await import("@workspace/settings");
const trace = registry.defineSetting({
  key: "editor.trace",
  group: "editor",
  label: "Trace the editor",
  description: "Logs every editor transaction.",
  keywords: ["debug"],
  scopes: ["user"],
  schema: z.boolean(),
  default: false,
  control: { kind: "toggle" },
  audience: "admin",
});
const SETTINGS = { ...registry.SETTINGS, [trace.key]: trace };
mock.module("@workspace/settings", () => ({
  ...registry,
  SETTINGS,
  settingsReceivedBy: (isAdmin: boolean) =>
    Object.values(SETTINGS).filter(
      ({ audience }) => isAdmin || audience !== "admin"
    ),
}));

const { matchSettingResults, settingResults } =
  await import("./settings-results");

/** The keys offered, as plain strings: the added key is not a `SettingKey`. */
const keysFor = (isAdmin: boolean): string[] =>
  settingResults({ isAdmin, project: null }).map(({ key }) => key);

describe("settingResults", () => {
  it("offers a member their personal settings, each at its row in its group", () => {
    const results = settingResults({ isAdmin: false, project: null });
    const rhyme = results.find(({ key }) => key === "editor.rhymePrefix");

    expect(results.length).toBeGreaterThan(0);
    for (const { key, href } of results) {
      const { group } = SETTINGS[key as keyof typeof SETTINGS];
      expect(href).toBe(`/settings/personal/${group}#${key}`);
    }
    expect(rhyme).toEqual({
      key: "editor.rhymePrefix",
      label: "Rhyme prefix",
      group: "Editor",
      href: "/settings/personal/editor#editor.rhymePrefix",
    });
  });

  it("offers the instance's settings to an instance admin only", () => {
    expect(keysFor(false)).not.toContain("instance-access.registration");

    const registration = settingResults({ isAdmin: true, project: null }).find(
      ({ key }) => key === "instance-access.registration"
    );
    expect(registration).toEqual({
      key: "instance-access.registration",
      label: "Registration",
      group: "Access",
      href: "/settings/instance/instance-access#instance-access.registration",
    });
  });

  it("offers an admin-audience setting to an instance admin only", () => {
    expect(keysFor(false)).not.toContain("editor.trace");
    expect(keysFor(true)).toContain("editor.trace");
  });

  it("offers each setting once, at its own group rather than a member default", () => {
    const keys = keysFor(true);

    expect(new Set(keys).size).toBe(keys.length);
    expect(
      settingResults({ isAdmin: true, project: null }).find(
        ({ key }) => key === "editor.rhymePrefix"
      )?.href
    ).toBe("/settings/personal/editor#editor.rhymePrefix");
  });

  it("leaves the personal settings where they are with a current project", () => {
    const personalHrefs = (
      project: Parameters<typeof settingResults>[0]["project"]
    ) =>
      settingResults({ isAdmin: false, project })
        .map(({ href }) => href)
        .filter((href) => href.startsWith("/settings/personal/"));

    expect(personalHrefs({ id: 7, name: "Low Tide", role: "viewer" })).toEqual(
      personalHrefs(null)
    );
  });

  it("offers the Project section's settings once a project is current, to any member", () => {
    expect(keysFor(false)).not.toContain("project-defaults.trackStatusId");

    const results = settingResults({
      isAdmin: false,
      project: { id: 7, name: "Low Tide", role: "viewer" },
    });
    const trackStatus = results.find(
      ({ key }) => key === "project-defaults.trackStatusId"
    );

    expect(trackStatus).toEqual({
      key: "project-defaults.trackStatusId",
      label: "New track status",
      group: "Defaults",
      href: "/settings/project/7/project-defaults#project-defaults.trackStatusId",
    });
  });
});

describe("matchSettingResults", () => {
  const results = settingResults({ isAdmin: true, project: null });

  it("matches every word of the query against a setting's label, description and keywords", () => {
    // "rhyme" also finds the rhyme settings around the prefix and the rhyme
    // lookup's rate limits, an admin's.
    const rhymes = matchSettingResults(results, "rhyme").map(({ key }) => key);
    expect(rhymes).toContain("editor.rhymePrefix");
    expect(rhymes).not.toContain("editor.synonymPrefix");
    expect(
      matchSettingResults(results, "Lyrics TRIGGER").map(({ key }) => key)
    ).toEqual(["editor.rhymePrefix", "editor.synonymPrefix"]);
    // "sign up" alone also finds the Instance access rules and rate limits.
    expect(
      matchSettingResults(results, "sign up register").map(({ key }) => key)
    ).toEqual(["instance-access.registration"]);
  });

  it("matches nothing for an empty query", () => {
    expect(matchSettingResults(results, "  ")).toEqual([]);
  });
});
