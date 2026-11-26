import { describe, expect, it } from "bun:test";
import { landingHref } from "./landing";

const projects = [{ id: 1 }, { id: 2 }];

describe("landingHref", () => {
  it("opens the notebook, ignoring cookie and projects", () => {
    expect(
      landingHref({
        landing: "notebook",
        defaultProject: null,
        cookieProjectId: 1,
        projects,
      })
    ).toBe("/notes");
  });

  it("always lists, even with a cookie and a chosen project", () => {
    expect(
      landingHref({
        landing: "projects",
        defaultProject: 1,
        cookieProjectId: 2,
        projects,
      })
    ).toBe("/projects");
  });

  it("opens the chosen project", () => {
    expect(
      landingHref({
        landing: "project",
        defaultProject: 2,
        cookieProjectId: 1,
        projects,
      })
    ).toBe("/project/2");
  });

  it("falls back to the list when the chosen project was left", () => {
    expect(
      landingHref({
        landing: "project",
        defaultProject: 5,
        cookieProjectId: null,
        projects,
      })
    ).toBe("/projects");
  });

  it("falls back to the list when no project is chosen", () => {
    expect(
      landingHref({
        landing: "project",
        defaultProject: null,
        cookieProjectId: 1,
        projects,
      })
    ).toBe("/projects");
  });

  it("opens the cookie's project", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: 2,
        projects,
      })
    ).toBe("/project/2");
  });

  it("lists when there is no cookie and more than one project", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: null,
        projects,
      })
    ).toBe("/projects");
  });

  it("skips the list when there is no cookie and exactly one project", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: null,
        projects: [{ id: 9 }],
      })
    ).toBe("/project/9");
  });

  it("treats a stale cookie as absent, applying the one-project shortcut", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: 404,
        projects: [{ id: 9 }],
      })
    ).toBe("/project/9");
  });

  it("treats a stale cookie as absent, listing with more than one project", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: 404,
        projects,
      })
    ).toBe("/projects");
  });

  it("never opens the last project's shortcut for an empty projects list", () => {
    expect(
      landingHref({
        landing: "last-project",
        defaultProject: null,
        cookieProjectId: null,
        projects: [],
      })
    ).toBe("/projects");
  });
});
