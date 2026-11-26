import { describe, expect, it, mock } from "bun:test";

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
class NotFoundError extends Error {}

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
  notFound: () => {
    throw new NotFoundError("NOT_FOUND");
  },
}));

const loadTitle = mock(async () => "Loaded Title");

// Every route kind renders its own page; only which kind is asked for matters here.
mock.module("@/modules/routes", () => ({
  routeModuleFor: (kind: string) =>
    kind === "not-found"
      ? undefined
      : { Page: () => `page:${kind}`, loadTitle },
}));

const { default: ProjectRouter, generateMetadata } = await import("./page");

const request = (projectId: string, route: string[]) => ({
  params: Promise.resolve({ projectId, route }),
  searchParams: Promise.resolve({}),
});

/** Where the router sends the request, or `null` when it renders a page. */
async function redirectOf(page: Promise<unknown>): Promise<string | null> {
  try {
    await page;
    return null;
  } catch (error) {
    if (error instanceof RedirectError) return error.url;
    throw error;
  }
}

describe("a project's settings URL", () => {
  it("goes on to the project's section of the settings hub", async () => {
    expect(await redirectOf(ProjectRouter(request("7", ["settings"])))).toBe(
      "/settings/project/7"
    );
  });

  it("goes on to the pane its tab names", async () => {
    expect(
      await redirectOf(ProjectRouter(request("7", ["settings", "labels"])))
    ).toBe("/settings/project/7/labels");
    expect(
      await redirectOf(ProjectRouter(request("7", ["settings", "danger"])))
    ).toBe("/settings/project/7/danger");
  });

  it("is a 404 deeper than a tab", async () => {
    await expect(
      ProjectRouter(request("7", ["settings", "labels", "extra"]))
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("leaves every other project route to its page", async () => {
    expect(
      await redirectOf(ProjectRouter(request("7", ["track", "3"])))
    ).toBeNull();
    expect(await ProjectRouter(request("7", ["track", "3"]))).toBe(
      "page:track"
    );
  });
});

describe("generateMetadata", () => {
  it("returns empty metadata without calling loadTitle for non-numeric projectId", async () => {
    loadTitle.mockClear();

    expect(
      await generateMetadata(request("not-a-number", ["track", "3"]))
    ).toEqual({});
    expect(loadTitle).not.toHaveBeenCalled();
  });
});
