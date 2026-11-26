import { describe, expect, it, mock } from "bun:test";

let session: { kind: string } = { kind: "member" };
mock.module("@/lib/session", () => ({ getCachedSession: async () => session }));
mock.module("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
mock.module("@/components/auth/SignInPrompt", () => ({
  SignInPrompt: () => <p>sign in</p>,
}));

const { default: SignInPage } = await import("./page");

const visit = (query: Record<string, string>) =>
  SignInPage({ searchParams: Promise.resolve(query) });

/** The exact message of the redirect the page throws. */
const redirectedTo = async (query: Record<string, string>) => {
  try {
    await visit(query);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("the page did not redirect");
};

describe("/sign-in for a member", () => {
  it("returns to the page named by next, query intact", async () => {
    expect(await redirectedTo({ next: "/device?user_code=ABCD1234" })).toBe(
      "redirect:/device?user_code=ABCD1234"
    );
  });

  it("goes home with no next", async () => {
    expect(await redirectedTo({})).toBe("redirect:/");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/..//evil.example",
  ])("goes home rather than to %j", async (next) => {
    expect(await redirectedTo({ next })).toBe("redirect:/");
  });

  it("leaves an OAuth provider's signed query to resume the authorization", async () => {
    const page = await visit({ next: "/device", client_id: "mcp", sig: "x" });

    expect(page).toBeTruthy();
  });
});

describe("/sign-in for a visitor who is not signed in", () => {
  it("shows the sign-in card whatever next says", async () => {
    session = { kind: "signed-out" };

    const page = await visit({ next: "/device?user_code=ABCD1234" });

    expect(page).toBeTruthy();
  });
});
