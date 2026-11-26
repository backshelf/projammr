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

const Page = (await import("./[[...tab]]/page")).default;

/** Where `/admin[/<tab>…]` sends the reader. */
async function redirectOf(tab?: string[]): Promise<string> {
  try {
    await Page({ params: Promise.resolve(tab === undefined ? {} : { tab }) });
  } catch (error) {
    if (error instanceof RedirectError) return error.url;
    throw error;
  }
  throw new Error("the page rendered instead of redirecting");
}

describe("the admin URLs", () => {
  it("send /admin to the Instance section of the settings hub", async () => {
    expect(await redirectOf()).toBe("/settings/instance");
  });

  it("send the registration tab to the Access group that holds it", async () => {
    expect(await redirectOf(["registration"])).toBe(
      "/settings/instance/instance-access"
    );
  });

  it("send every other tab to the pane of the same name", async () => {
    expect(await redirectOf(["users"])).toBe("/settings/instance/users");
    expect(await redirectOf(["storage"])).toBe("/settings/instance/storage");
    expect(await redirectOf(["about"])).toBe("/settings/instance/about");
  });

  it("read a tab as a name, never as a property of the renaming table", async () => {
    expect(await redirectOf(["constructor"])).toBe(
      "/settings/instance/constructor"
    );
  });

  it("are a 404 deeper than a tab", async () => {
    await expect(
      Page({ params: Promise.resolve({ tab: ["users", "extra"] }) })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
