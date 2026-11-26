import { describe, expect, it } from "bun:test";
import { GROUPS, SETTINGS, type SettingScope } from "@workspace/settings";
import { settingsHref } from "@/lib/settings/href";
import { hubLayout, type HubContext } from "./layout";

const EVERY_KEY = new Set(Object.keys(SETTINGS));
const PROJECT = { id: 7, name: "Night Bus", role: "viewer" } as const;

const PERSONAL_GROUP_IDS = new Set(
  GROUPS.filter((group) => group.section === "personal").map(({ id }) => id)
);

/** Every personal setting that takes a value at `scope`, as `hubLayout` rows them. */
const personalRowsAt = <S extends SettingScope>(scope: S) =>
  Object.values(SETTINGS)
    .filter(
      (setting) =>
        PERSONAL_GROUP_IDS.has(setting.group) && setting.scopes.includes(scope)
    )
    .map((setting) => ({ key: setting.key, scope }));

const layout = (context: Partial<HubContext> = {}) =>
  hubLayout({
    visible: EVERY_KEY,
    isAdmin: false,
    project: null,
    panes: [],
    ...context,
  });

const sectionIds = (context: Partial<HubContext>) =>
  layout(context).sections.map(({ id }) => id);

describe("hubLayout's sections", () => {
  it("shows every member Personal and Devices", () => {
    expect(sectionIds({})).toEqual(["personal", "devices"]);
  });

  it("shows Project when the page has a project, naming it", () => {
    const { sections } = layout({ project: PROJECT });
    const project = sections.find(({ id }) => id === "project");

    expect(sections.map(({ id }) => id)).toEqual([
      "personal",
      "project",
      "devices",
    ]);
    expect(project?.detail).toBe("Night Bus");
    expect(project?.href).toBe("/settings/project/7");
  });

  it("shows Instance to an instance admin only", () => {
    expect(sectionIds({ isAdmin: true })).toContain("instance");
    expect(sectionIds({ isAdmin: false })).not.toContain("instance");
  });

  it("keeps a section the caller cannot open out of the search", () => {
    const { index } = layout({ isAdmin: false });

    expect(index.every(({ section }) => section !== "Instance")).toBe(true);
    // Personal is the only section that writes at "user" scope, so its
    // index is exactly every personal setting that takes a value there.
    expect(new Set(index.map(({ key, scope }) => `${scope} ${key}`))).toEqual(
      new Set(personalRowsAt("user").map(({ key, scope }) => `${scope} ${key}`))
    );
  });
});

describe("hubLayout's groups", () => {
  it("lists a section's declared groups with their rows at the section's scope", () => {
    const personal = layout().sections[0]!;

    const expected = GROUPS.filter((group) => group.section === "personal")
      .map((group) => ({
        kind: "group" as const,
        id: group.id,
        label: group.label,
        ...(group.description === undefined
          ? {}
          : { description: group.description }),
        order: group.order,
        rows: Object.values(SETTINGS)
          .filter(
            (setting) =>
              setting.group === group.id && setting.scopes.includes("user")
          )
          .map((setting) => ({ key: setting.key, scope: "user" as const })),
      }))
      .filter((group) => group.rows.length > 0)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
      .map((group) => ({
        ...group,
        href: settingsHref({ section: "personal", group: group.id }),
      }));

    expect(personal.entries).toEqual(expected);
  });

  it("generates the instance's member defaults from every personal setting", () => {
    const instance = layout({ isAdmin: true }).sections.find(
      ({ id }) => id === "instance"
    )!;

    expect(instance.entries.map(({ id }) => id)).toEqual([
      "instance-access",
      "instance-branding",
      "instance-limits",
      "instance-jobs",
      "instance-integrations",
      "instance-rate-limits",
      "member-defaults",
      "project-defaults",
      "project-sharing",
      "project-conventions",
      "project-audio",
    ]);
    const defaults = instance.entries.find(
      ({ id }) => id === "member-defaults"
    )!;
    expect(defaults.kind === "group" && defaults.rows).toEqual(
      personalRowsAt("instance")
    );
    expect(defaults.href).toBe("/settings/instance/member-defaults");
  });

  it("lists the project groups in Instance at instance scope, without the per-project ids", () => {
    const instance = layout({ isAdmin: true }).sections.find(
      ({ id }) => id === "instance"
    )!;
    const rows = instance.entries.flatMap((entry) =>
      entry.kind === "group" && entry.id.startsWith("project-")
        ? entry.rows
        : []
    );
    const keys = rows.map(({ key }) => key);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(({ scope }) => scope === "instance")).toBe(true);
    expect(keys).not.toContain("project-defaults.trackStatusId");
    expect(keys).not.toContain("project-defaults.collectionStatusId");
    expect(keys).not.toContain("project-defaults.labelIds");
    expect(keys.some((key) => key.startsWith("project-defaults."))).toBe(true);
  });

  it("leaves the Project section's own groups unchanged", () => {
    const project = layout({ project: PROJECT }).sections.find(
      ({ id }) => id === "project"
    )!;
    const defaults = project.entries.find(
      ({ id }) => id === "project-defaults"
    );

    expect(defaults?.kind === "group" && defaults.rows).toContainEqual({
      key: "project-defaults.trackStatusId",
      scope: "project",
    });
    expect(
      project.entries.find(({ id }) => id === "project-audio")?.order
    ).toBe(100);
  });

  it("marks an advanced group, and only that one, for folding", () => {
    const instance = layout({ isAdmin: true }).sections.find(
      ({ id }) => id === "instance"
    )!;

    expect(
      instance.entries.flatMap((entry) =>
        entry.kind === "group" && entry.advanced ? [entry.id] : []
      )
    ).toEqual(["instance-rate-limits"]);
  });

  it("shows project member defaults for exactly the personal settings that take a value there", () => {
    const project = layout({ project: PROJECT }).sections.find(
      ({ id }) => id === "project"
    )!;
    const expectedRows = personalRowsAt("project");
    const defaults = project.entries.find(({ id }) => id === "member-defaults");

    if (expectedRows.length === 0) {
      // No personal setting takes a value at project scope: the hub shows
      // no group with no rows.
      expect(defaults).toBeUndefined();
    } else {
      expect(defaults?.kind === "group" && defaults.rows).toEqual(expectedRows);
    }
  });

  it("renders no group none of whose settings the caller receives", () => {
    const { sections, index } = layout({
      isAdmin: true,
      visible: new Set(["instance-access.registration"]),
    });

    expect(sections.find(({ id }) => id === "personal")!.entries).toEqual([]);
    expect(
      sections.find(({ id }) => id === "instance")!.entries.map(({ id }) => id)
    ).toEqual(["instance-access"]);
    expect(index.map(({ key }) => key)).toEqual([
      "instance-access.registration",
    ]);
  });
});

describe("hubLayout's panes", () => {
  const pane = (
    id: string,
    section: HubContext["panes"][number]["section"],
    order: number,
    minRole?: "viewer" | "editor" | "admin" | "owner"
  ) => ({ id, section, label: id, order, ...(minRole ? { minRole } : {}) });

  it("sorts a section's panes among its groups by order", () => {
    const personal = layout({
      // Orders well outside any personal group's own, so the pane's
      // position is unambiguous however many groups the section declares.
      panes: [
        pane("export", "personal", 10_000),
        pane("look", "personal", -10_000),
      ],
    }).sections[0]!;

    const ids = personal.entries.map(({ id, kind }) => `${kind} ${id}`);
    expect(ids[0]).toBe("pane look");
    expect(ids.at(-1)).toBe("pane export");
    expect(ids).toContain("group editor");
    expect(personal.entries[0]!.href).toBe("/settings/personal/look");
  });

  it("shows a project pane only to a role its minimum allows", () => {
    const panes = [
      pane("labels", "project", 10),
      pane("danger", "project", 90, "owner"),
    ];
    // Filtered to panes: some personal settings now write at project scope
    // too, so the section may also carry a "member-defaults" group here.
    const entriesFor = (role: "viewer" | "owner") =>
      layout({ project: { ...PROJECT, role }, panes })
        .sections.find(({ id }) => id === "project")!
        .entries.filter((entry) => entry.kind === "pane")
        .map(({ id }) => id);

    expect(entriesFor("viewer")).toEqual(["labels"]);
    expect(entriesFor("owner")).toEqual(["labels", "danger"]);
  });

  it("stacks the Devices section's panes on its one page", () => {
    const devices = layout({
      panes: [pane("this-browser", "devices", 10)],
    }).sections.find(({ id }) => id === "devices")!;

    expect(devices.stacked).toBe(true);
    expect(devices.entries.map(({ id }) => id)).toEqual(["this-browser"]);
  });

  it("refuses a pane whose id a group of its section already has", () => {
    expect(() => layout({ panes: [pane("editor", "personal", 1)] })).toThrow(
      'two groups or panes called "editor"'
    );
  });
});
