import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, jest, mock } from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import type { SidebarSection } from "@/lib/policies/shell";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { useState, type ComponentProps, type ReactNode } from "react";

const PATCH = mock(async () => ({
  data: {},
  response: new Response(null, { status: 200 }),
}));
mock.module("@/lib/browser-api", () => ({ browserApi: { PATCH } }));

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

const { CollapsibleGroup } = await import("./CollapsibleGroup");
const { SidebarSections } = await import("./SidebarSections");
const { DEFAULT_POLICIES } = await import("@/lib/policies/policies");
const { PoliciesProvider } = await import("@/lib/policies/provider");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { DEFAULT_EFFECTIVE_SETTINGS } = await import("@/lib/settings/effective");

afterEach(() => {
  cleanup();
  PATCH.mockClear();
  jest.useRealTimers();
});

function Shell({
  sidebarSections,
  children,
}: {
  sidebarSections?: SidebarSection[];
  children: ReactNode;
}) {
  const policies = sidebarSections
    ? {
        ...DEFAULT_POLICIES,
        shell: { ...DEFAULT_POLICIES.shell, sidebarSections },
      }
    : DEFAULT_POLICIES;
  return (
    <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId="u1">
      <PoliciesProvider policies={policies}>
        <MotionProvider>
          <TooltipProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </TooltipProvider>
        </MotionProvider>
      </PoliciesProvider>
    </SettingsProvider>
  );
}

const section = (label: string) => ({
  label,
  hrefAll: `/${label.toLowerCase()}`,
  children: <p>{label} list</p>,
});

const ALL = {
  collections: section("Collections"),
  tracks: section("Tracks"),
  notebook: section("Notebook"),
  sessions: section("Sessions"),
};

const headings = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => text && !text.endsWith("list"));

const toggle = (label: string) =>
  act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`(Collapse|Expand) ${label}`),
      })
    );
  });

describe("CollapsibleGroup", () => {
  it("shows what its owner holds, and hands the owner every toggle", async () => {
    const onCollapsedChange = mock();
    render(
      <Shell>
        <CollapsibleGroup
          label="Tracks"
          collapsed
          onCollapsedChange={onCollapsedChange}
        >
          <p>Tracks list</p>
        </CollapsibleGroup>
      </Shell>
    );

    expect(screen.getByRole("button", { name: "Expand Tracks" })).toBeTruthy();

    await toggle("Tracks");

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    // Controlled: nothing changes until the owner says so.
    expect(screen.getByRole("button", { name: "Expand Tracks" })).toBeTruthy();
  });

  it("round-trips a collapse through the state its owner keeps", async () => {
    function Owner() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <CollapsibleGroup
          label="Tracks"
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        >
          <p>Tracks list</p>
        </CollapsibleGroup>
      );
    }
    render(
      <Shell>
        <Owner />
      </Shell>
    );

    await toggle("Tracks");
    expect(screen.getByRole("button", { name: "Expand Tracks" })).toBeTruthy();

    await toggle("Tracks");
    expect(
      screen.getByRole("button", { name: "Collapse Tracks" })
    ).toBeTruthy();
    expect(screen.getByText("Tracks list")).toBeTruthy();
  });

  it("offers its create action as one link, not a link nested in a button", () => {
    render(
      <Shell>
        <CollapsibleGroup
          label="Tracks"
          hrefNew="/tracks/new"
          newLabel="New track"
          collapsed={false}
          onCollapsedChange={mock()}
        >
          <p>Tracks list</p>
        </CollapsibleGroup>
      </Shell>
    );

    const create = screen.getByRole("link", { name: "New track" });
    expect(create.getAttribute("href")).toBe("/tracks/new");
    expect(create.closest("button")).toBeNull();
  });
});

describe("SidebarSections", () => {
  it("lists every section open, in the order they have always stood, by default", () => {
    render(
      <Shell>
        <SidebarSections sections={ALL} />
      </Shell>
    );

    expect(headings()).toEqual([
      "Collections",
      "Tracks",
      "Notebook",
      "Sessions",
    ]);
    expect(screen.queryAllByRole("button", { name: /^Expand/ })).toHaveLength(
      0
    );
  });

  it("orders, hides and folds the sections as the policy says", () => {
    render(
      <Shell
        sidebarSections={[
          { id: "sessions", shown: true, collapsed: true },
          { id: "tracks", shown: true, collapsed: false },
          { id: "collections", shown: false, collapsed: false },
          { id: "notebook", shown: true, collapsed: false },
        ]}
      >
        <SidebarSections sections={ALL} />
      </Shell>
    );

    expect(headings()).toEqual(["Sessions", "Tracks", "Notebook"]);
    expect(
      screen.getByRole("button", { name: "Expand Sessions" })
    ).toBeTruthy();
  });

  it("shows only the sections it was given, whatever the policy lists", () => {
    render(
      <Shell>
        <SidebarSections sections={{ notebook: ALL.notebook }} />
      </Shell>
    );

    expect(headings()).toEqual(["Notebook"]);
  });

  it("folds a section at once and saves the fold to the viewer's setting, quick toggles as one write", async () => {
    jest.useFakeTimers();
    render(
      <Shell>
        <SidebarSections sections={ALL} />
      </Shell>
    );

    await toggle("Tracks");
    expect(screen.getByRole("button", { name: "Expand Tracks" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Collapse Sessions" })
    ).toBeTruthy();

    await toggle("Sessions");
    await toggle("Tracks");
    expect(
      screen.getByRole("button", { name: "Collapse Tracks" })
    ).toBeTruthy();
    expect(PATCH).not.toHaveBeenCalled();

    await act(async () => {
      await advanceTimersByTimeAsync(300);
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(PATCH.mock.calls[0]).toMatchObject([
      "/api/settings/{scope}/{id}",
      {
        params: { path: { scope: "user", id: "u1" } },
        body: {
          "layout.sidebarSections": [
            { id: "collections", shown: true, collapsed: false },
            { id: "tracks", shown: true, collapsed: false },
            { id: "notebook", shown: true, collapsed: false },
            { id: "sessions", shown: true, collapsed: true },
          ],
        },
      },
    ]);
  });
});
