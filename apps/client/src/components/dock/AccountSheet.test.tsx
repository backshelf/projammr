import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

// The sheet's rows render in place, without the sheet around them.
mock.module("@/components/dock/BottomSheet", () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SHEET_ROW: "",
  SheetCancelRow: () => null,
}));
mock.module("@workspace/ui/components/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => children,
}));
// next/link updates state as it mounts, outside any act() the test can wrap.
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
mock.module("@/components/theme/AppThemeProvider", () => ({
  useTheme: () => ({ theme: "system", setTheme: mock() }),
}));
mock.module("@/lib/sign-out", () => ({ signOut: mock() }));

const { AccountSheet } = await import("./AccountSheet");

afterEach(cleanup);

describe("AccountSheet", () => {
  it("reads Profile, then Settings, which opens the settings hub", () => {
    render(<AccountSheet user={{ name: "Juno", email: "juno@example.com" }} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Profile",
      "Settings",
    ]);
    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href")
    ).toBe("/settings/personal");
  });
});
