import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

mock.module("@/components/dock/BottomSheet", () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SHEET_ROW: "",
  SheetCancelRow: () => null,
}));
mock.module("@workspace/ui/components/sheet", () => ({
  SheetClose: ({ children }: { children: ReactNode }) => children,
}));
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

const { QuickCreateSheet } = await import("./QuickCreateSheet");

afterEach(cleanup);

describe("QuickCreateSheet", () => {
  it("lists New Track, New Collection, New Session, and New Note for project editors", () => {
    render(<QuickCreateSheet projectId={4} canEdit />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "New Track",
      "New Collection",
      "New Session",
      "New Note",
    ]);
    expect(
      screen.getByRole("link", { name: "New Track" }).getAttribute("href")
    ).toBe("/project/4/track/new");
    expect(
      screen.getByRole("link", { name: "New Collection" }).getAttribute("href")
    ).toBe("/project/4/collection/new");
    expect(
      screen.getByRole("link", { name: "New Session" }).getAttribute("href")
    ).toBe("/project/4/session/new");
    expect(
      screen.getByRole("link", { name: "New Note" }).getAttribute("href")
    ).toBe("/notes/new");
  });

  it("gates project creations for viewers while keeping New Note", () => {
    render(<QuickCreateSheet projectId={4} canEdit={false} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["New Note"]);
    expect(screen.queryByRole("link", { name: "New Track" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New Collection" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New Session" })).toBeNull();
  });
});
