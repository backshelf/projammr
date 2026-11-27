import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-context";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { DockTabId } from "@/lib/policies/shell";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import type { ComponentProps } from "react";

mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a href={typeof href === "string" ? href : ""} {...rest}>
        {children}
      </a>
    );
  },
  // Not a real hook, just a stub matching the shape `next/link` exports.
  useLinkStatus: () => ({ pending: false }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock() }),
}));
mock.module("@/hooks/use-tab-context", () => ({
  useTabContext: () => ({
    projectId: 7,
    route: { kind: "track-all" },
    pathname: "/project/7/track/all",
  }),
}));

const { TabBar } = await import("./TabBar");

afterEach(cleanup);

function renderBar(dockTabs?: DockTabId[]) {
  const policies = dockTabs
    ? { ...DEFAULT_POLICIES, shell: { ...DEFAULT_POLICIES.shell, dockTabs } }
    : DEFAULT_POLICIES;
  render(
    <PoliciesProvider policies={policies}>
      <CommandPaletteProvider>
        <MotionProvider>
          <TabBar />
        </MotionProvider>
      </CommandPaletteProvider>
    </PoliciesProvider>
  );
}

const tabNames = () =>
  Array.from(screen.getByRole("navigation", { name: "Sections" }).children).map(
    (tab) => tab.textContent
  );

describe("TabBar", () => {
  it("shows every tab in the order it has always stood, by default", () => {
    renderBar();

    expect(tabNames()).toEqual([
      "Collections",
      "Tracks",
      "Notes",
      "Sessions",
      "Search",
    ]);
  });

  it("shows the policy's tabs in the policy's order, however few", () => {
    renderBar(["search", "notes"]);
    expect(tabNames()).toEqual(["Search", "Notes"]);

    cleanup();
    renderBar(["tracks"]);
    expect(tabNames()).toEqual(["Tracks"]);
  });

  it("marks only tabs with a long-press shortcut with a quiet visual and accessible hint", () => {
    renderBar();

    const notes = screen.getByRole("link", { name: "Notes" });
    const tracks = screen.getByRole("link", { name: "Tracks" });

    expect(notes.querySelector('[data-slot="tab-shortcut-hint"]')).toBeTruthy();
    expect(notes.getAttribute("aria-description")).toBe("Hold for quick jump");
    expect(tracks.querySelector('[data-slot="tab-shortcut-hint"]')).toBeNull();
    expect(tracks.getAttribute("aria-description")).toBeNull();
  });
});
