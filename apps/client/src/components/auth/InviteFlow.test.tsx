import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_BRAND } from "@/lib/brand-defaults";

mock.module("@/lib/brand", () => ({ cachedBrand: async () => DEFAULT_BRAND }));

const acceptInvite = mock(async () => ({ projectId: 1 }));
const getInvitePreview = mock(async (): Promise<unknown> => ({
  projectName: "Night Drive",
  invitedByName: "Ada",
  role: "editor",
  email: "grace@example.com",
  accepted: false,
  expired: false,
}));
mock.module("@/actions/members", () => ({ acceptInvite, getInvitePreview }));
mock.module("@/actions/cookie", () => ({ setProjectCookie: mock() }));
mock.module("@/lib/server-data", () => ({
  cachedInstance: async () => ({
    registration: "closed",
    hasUsers: true,
    emailEnabled: false,
    version: "test",
    updateCheck: false,
    passwordMin: 12,
    passwordMax: 64,
    guestAccess: true,
    selfDeletion: true,
  }),
}));

const signedOut = { kind: "anonymous" };
mock.module("@/lib/session", () => ({
  getCachedSession: async () => signedOut,
  sessionUser: () => null,
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: mock(), replace: mock() }),
}));
mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { default: InviteFlow } = await import("./InviteFlow");
const { SignInPrompt } = await import("./SignInPrompt");
const { default: InvitePage, generateMetadata } =
  await import("../../app/(app)/invite/[token]/page");

afterEach(cleanup);

const renderFlow = (signedIn: boolean) =>
  render(
    <InviteFlow token="tok" email="grace@example.com" signedIn={signedIn} />,
    { wrapper: MotionProvider }
  );

const tabNames = () =>
  screen.queryAllByRole("tab").map((tab) => tab.textContent);

const emailField = () => screen.getByLabelText("Email") as HTMLInputElement;

describe("InviteFlow signed out", () => {
  it("leads with the register tab and no guest tab", () => {
    renderFlow(false);

    expect(tabNames()).toEqual(["Register", "Sign in"]);
    expect(
      screen.getByRole("tab", { name: "Register" }).getAttribute("data-active")
    ).not.toBeNull();
  });

  it("shows the invited address read-only on the register tab", () => {
    renderFlow(false);

    expect(emailField().value).toBe("grace@example.com");
    expect(emailField().readOnly).toBe(true);
  });

  it("shows the invited address read-only on the sign-in tab", () => {
    renderFlow(false);
    fireEvent.click(screen.getByRole("tab", { name: "Sign in" }));

    expect(emailField().value).toBe("grace@example.com");
    expect(emailField().readOnly).toBe(true);
  });

  it("describes the invited address in the card", () => {
    renderFlow(false);

    expect(
      screen.getByText(
        "Register with grace@example.com, or sign in if you already have an account."
      )
    ).not.toBeNull();
  });

  it("offers no accept button", () => {
    renderFlow(false);

    expect(screen.queryByRole("button", { name: "Accept invite" })).toBeNull();
  });
});

describe("InviteFlow signed in", () => {
  it("renders Accept in place of the forms", () => {
    renderFlow(true);

    expect(
      screen.getByRole("button", { name: "Accept invite" })
    ).not.toBeNull();
    expect(screen.queryAllByRole("tab")).toEqual([]);
  });
});

describe("the invite page", () => {
  const renderPage = async () =>
    render(await InvitePage({ params: Promise.resolve({ token: "tok" }) }), {
      wrapper: MotionProvider,
    });

  it("heads the signed-out page with the project's name and the invite", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Join Night Drive" })
    ).not.toBeNull();
    expect(
      screen.getByText("Ada invited you to Night Drive as an editor.")
    ).not.toBeNull();
  });

  it("holds the register form to the instance's password rule", async () => {
    await renderPage();

    expect(screen.getByText("At least 12 characters")).not.toBeNull();
  });

  it("shows the sign-in prompt to a caller the instance turns away", async () => {
    getInvitePreview.mockResolvedValueOnce({
      error: "Not signed in",
      status: 401,
    });
    // The prompt is an async server component, which a client render cannot
    // resolve; what the page hands back is the thing to check.
    const page = await InvitePage({
      params: Promise.resolve({ token: "tok" }),
    });

    expect((page as React.ReactElement).type).toBe(SignInPrompt);
  });

  it("titles the tab after the project when the preview resolves", async () => {
    expect(
      await generateMetadata({ params: Promise.resolve({ token: "tok" }) })
    ).toEqual({ title: "Invite to Night Drive" });
  });

  it("titles the tab generically when the preview does not resolve", async () => {
    getInvitePreview.mockResolvedValueOnce({ error: "not valid" });

    expect(
      await generateMetadata({ params: Promise.resolve({ token: "gone" }) })
    ).toEqual({ title: "Project invite" });
  });
});
