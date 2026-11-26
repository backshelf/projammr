import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const loadSharelink = mock(async (): Promise<unknown> => ({
  error: "Not signed in",
  status: 401,
}));
mock.module("@/lib/share-read", () => ({ loadSharelink }));
mock.module("@/lib/session", () => ({
  getCachedSession: async () => ({ kind: "anonymous" }),
  sessionUser: () => null,
}));
mock.module("@/actions/instance", () => ({ getInstance: mock() }));

const { default: SharePage } = await import("./page");
const { SignInPrompt } = await import("@/components/auth/SignInPrompt");

describe("the share page", () => {
  it("shows the sign-in prompt to a reader the instance turns away", async () => {
    // The prompt is an async server component, which a client render cannot
    // resolve; what the page hands back is the thing to check.
    const page = await SharePage({ params: Promise.resolve({ token: "tok" }) });

    expect((page as React.ReactElement).type).toBe(SignInPrompt);
  });
});
