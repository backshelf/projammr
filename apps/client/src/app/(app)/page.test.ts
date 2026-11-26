import { beforeEach, describe, expect, it, mock } from "bun:test";

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

mock.module("server-only", () => ({}));

let cookieProject: string | undefined;
const headers = await import("next/headers");
mock.module("next/headers", () => ({
  ...headers,
  cookies: async () => ({
    get: (name: string) =>
      name === "currentProject" && cookieProject !== undefined
        ? { name, value: cookieProject }
        : undefined,
  }),
}));

const member = {
  kind: "member",
  user: { id: "u1", name: "Ada", isAnonymous: false },
  session: { id: "s1" },
};
const sessionState = await import("@/lib/session-state");
mock.module("@/lib/session", () => ({
  ...sessionState,
  getCachedSession: async () => member,
}));

let myProjects: { id: number; name: string }[] = [];
const serverData = await import("@/lib/server-data");
mock.module("@/lib/server-data", () => ({
  ...serverData,
  cachedMyProjects: async () => myProjects,
}));

let landing: "last-project" | "project" | "projects" | "notebook" =
  "last-project";
let defaultProject: number | null = null;
const settingsServer = await import("@/lib/settings/server");
const { effectiveSettings } = await import("@/lib/settings/effective");
mock.module("@/lib/settings/server", () => ({
  ...settingsServer,
  cachedEffectiveSettings: async () =>
    effectiveSettings(
      {
        "navigation.landing": landing,
        "navigation.defaultProject": defaultProject,
      },
      "test"
    ),
}));

const Page = (await import("./page")).default;

/** Where `/` sends the caller, or `null` when it renders a page. */
async function landingOf(): Promise<string | null> {
  try {
    await Page();
    return null;
  } catch (error) {
    if (error instanceof RedirectError) return error.url;
    throw error;
  }
}

beforeEach(() => {
  cookieProject = undefined;
  myProjects = [
    { id: 1, name: "One" },
    { id: 2, name: "Two" },
  ];
  landing = "last-project";
  defaultProject = null;
});

describe("the landing page", () => {
  it("lands on the projects list when the current project was deleted", async () => {
    cookieProject = "5";
    expect(await landingOf()).toBe("/projects");
  });

  it("opens the cookie's project for the last-project landing", async () => {
    cookieProject = "2";
    expect(await landingOf()).toBe("/project/2");
  });

  it("skips the list for a single project with no cookie", async () => {
    myProjects = [{ id: 1, name: "One" }];
    expect(await landingOf()).toBe("/project/1");
  });

  it("opens the chosen project for the project landing", async () => {
    landing = "project";
    defaultProject = 2;
    expect(await landingOf()).toBe("/project/2");
  });

  it("lists rather than guessing for the project landing with no chosen project left", async () => {
    landing = "project";
    defaultProject = 5;
    expect(await landingOf()).toBe("/projects");
  });

  it("always lists for the projects landing, even with a cookie", async () => {
    landing = "projects";
    cookieProject = "1";
    expect(await landingOf()).toBe("/projects");
  });

  it("opens the notebook for the notebook landing", async () => {
    landing = "notebook";
    expect(await landingOf()).toBe("/notes");
  });
});
