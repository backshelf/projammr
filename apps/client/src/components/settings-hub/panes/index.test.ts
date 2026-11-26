import { describe, expect, it, mock } from "bun:test";
import type { MemberRole } from "@workspace/api/api";

mock.module("server-only", () => ({}));

const { HUB_PANES } = await import("./index");
const { hubLayout } = await import("../layout");

const VISIBLE = new Set<string>([
  "editor.rhymePrefix",
  "editor.synonymPrefix",
  "instance-access.registration",
]);

const sectionAs = (
  section: "project" | "instance",
  role: MemberRole,
  isAdmin = false
) =>
  hubLayout({
    visible: VISIBLE,
    isAdmin,
    project: { id: 7, name: "Low Tide", role },
    panes: HUB_PANES,
  }).sections.find(({ id }) => id === section);

describe("the hub's panes", () => {
  it("lists the project's panes in their tab order for a viewer, without the danger zone", () => {
    expect(sectionAs("project", "viewer")?.entries.map(({ id }) => id)).toEqual(
      [
        "statuses",
        "labels",
        "relation-types",
        "priorities",
        "fields",
        "images",
        "assets",
        "members",
      ]
    );
  });

  it("adds the danger zone for the project's owner, and only for them", () => {
    expect(sectionAs("project", "admin")?.entries.map(({ id }) => id)).toEqual([
      "statuses",
      "labels",
      "relation-types",
      "priorities",
      "fields",
      "images",
      "assets",
      "members",
    ]);
    expect(sectionAs("project", "owner")?.entries.map(({ id }) => id)).toEqual([
      "statuses",
      "labels",
      "relation-types",
      "priorities",
      "fields",
      "images",
      "assets",
      "members",
      "danger",
    ]);
  });

  it("gives each project pane its own page under the project", () => {
    expect(
      sectionAs("project", "owner")?.entries.find(({ id }) => id === "labels")
        ?.href
    ).toBe("/settings/project/7/labels");
  });

  it("places the instance's panes after its access group", () => {
    expect(
      sectionAs("instance", "viewer", true)?.entries.map(({ id }) => id)
    ).toEqual([
      "instance-access",
      "users",
      "machines",
      "storage",
      "about",
      "member-defaults",
    ]);
  });

  it("leaves a gap between neighbouring panes' orders, so another slots in between", () => {
    for (const section of ["project", "instance"] as const) {
      const orders = HUB_PANES.filter((pane) => pane.section === section)
        .map(({ order }) => order)
        .toSorted((a, b) => a - b);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]! - orders[i - 1]!).toBeGreaterThan(1);
      }
    }
  });
});
