import { describe, expect, it, mock } from "bun:test";

const { isSignedOut } = await import("@/lib/session-state");

let session: { kind: string } = { kind: "member" };
mock.module("@/lib/session", () => ({
  getCachedSession: async () => session,
  isSignedOut,
}));
mock.module("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
mock.module("@/components/auth/DeviceApproval", () => ({
  DeviceApproval: ({ initialCode }: { initialCode?: string }) => (
    <p>approval for {initialCode ?? "no code"}</p>
  ),
}));
mock.module("@/components/auth/CenteredPageShell", () => ({
  CenteredPageShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));

const { default: DevicePage } = await import("./page");

const visit = (query: Record<string, string>) =>
  DevicePage({ searchParams: Promise.resolve(query) });

describe("/device", () => {
  it("sends a signed-out visitor through sign-in and back to the same code", async () => {
    session = { kind: "signed-out" };

    await expect(visit({ user_code: "ABCD1234" })).rejects.toThrow(
      `redirect:/sign-in?next=${encodeURIComponent("/device?user_code=ABCD1234")}`
    );
  });

  it("treats a share-page guest as signed out", async () => {
    session = { kind: "guest" };

    await expect(visit({})).rejects.toThrow(
      `redirect:/sign-in?next=${encodeURIComponent("/device")}`
    );
  });

  it("hands a signed-in member's code to the approval", async () => {
    session = { kind: "member" };

    const page = await visit({ user_code: "ABCD1234" });

    expect(JSON.stringify(page)).toContain("ABCD1234");
    expect(JSON.stringify(page)).toContain("Connect dit");
  });
});
