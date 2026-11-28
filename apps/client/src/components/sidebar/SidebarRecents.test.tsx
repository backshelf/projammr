import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import type { CollectionSummary } from "@workspace/api/api";
import type { ComponentProps, ReactNode } from "react";

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
mock.module("@/lib/client-api", () => ({
  clientGetCollectionTrackSummaries: mock(),
}));

const {
  SidebarCollections,
  SidebarRecentNotes,
  SidebarRecentSessions,
  SidebarRecentTracks,
} = await import("./SidebarRecents");
const { DEFAULT_POLICIES } = await import("@/lib/policies/policies");
const { PoliciesProvider } = await import("@/lib/policies/provider");
type ShellPolicy = import("@/lib/policies/shell").ShellPolicy;

afterEach(cleanup);

function Shell({
  shell,
  children,
}: {
  shell: Partial<ShellPolicy>;
  children: ReactNode;
}) {
  const policies = {
    ...DEFAULT_POLICIES,
    shell: { ...DEFAULT_POLICIES.shell, ...shell },
  };
  return (
    <MotionProvider>
      <SidebarProvider>
        <PoliciesProvider policies={policies}>{children}</PoliciesProvider>
      </SidebarProvider>
    </MotionProvider>
  );
}

const track = (id: number, archived = false) => ({
  id,
  label: `Track ${id}`,
  href: `/t/${id}`,
  archivedAt: archived ? "2026-09-01T00:00:00.000Z" : null,
});
const tracks = [track(1), track(2, true), track(3), track(4)];

const labels = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => !text?.startsWith("Show all"));

function renderTracks(shell: Partial<ShellPolicy>) {
  const list = (
    <SidebarRecentTracks
      tracks={tracks}
      hrefAll="/t"
      allLabel="Show all tracks"
    />
  );
  const view = render(<Shell shell={shell}>{list}</Shell>);
  return (next: Partial<ShellPolicy>) =>
    view.rerender(<Shell shell={next}>{list}</Shell>);
}

describe("SidebarRecentTracks", () => {
  it("re-slices to the new count when the policy changes, without a new list", () => {
    const update = renderTracks({ recentItems: 2 });
    expect(labels()).toEqual(["Track 1", "Track 3"]);

    update({ recentItems: 3 });
    expect(labels()).toEqual(["Track 1", "Track 3", "Track 4"]);
  });

  it("brings archived tracks back when the policy stops skipping them", () => {
    const update = renderTracks({ recentItems: 2, recentsSkipArchived: true });
    expect(labels()).toEqual(["Track 1", "Track 3"]);

    update({ recentItems: 2, recentsSkipArchived: false });
    expect(labels()).toEqual(["Track 1", "Track 2"]);
  });
});

describe("SidebarRecentSessions", () => {
  it("skips the sessions of archived tracks before counting", () => {
    const sessions = [
      { id: 1, label: "Session 1", href: "/s/1", archived: true },
      { id: 2, label: "Session 2", href: "/s/2", archived: false },
      { id: 3, label: "Session 3", href: "/s/3", archived: false },
    ];
    render(
      <Shell shell={{ recentItems: 2, recentsSkipArchived: true }}>
        <SidebarRecentSessions
          sessions={sessions}
          hrefAll="/s"
          allLabel="Show all sessions"
        />
      </Shell>
    );

    expect(labels()).toEqual(["Session 2", "Session 3"]);
  });
});

describe("SidebarCollections", () => {
  const collection = (id: number, title: string, updatedAt: string) =>
    ({
      id,
      title,
      releaseDate: null,
      updatedAt,
      artwork: null,
    }) as unknown as CollectionSummary;
  const collections = [
    collection(1, "Bravo", "2026-09-01T00:00:00.000Z"),
    collection(2, "Alpha", "2026-08-01T00:00:00.000Z"),
    collection(3, "Charlie", "2026-09-10T00:00:00.000Z"),
  ];

  it("re-orders when the policy's collection order changes", () => {
    const list = <SidebarCollections collections={collections} projectId={7} />;
    const view = render(
      <Shell shell={{ sidebarCollectionOrder: "title" }}>{list}</Shell>
    );
    expect(labels()).toEqual(["Alpha", "Bravo", "Charlie"]);

    view.rerender(
      <Shell shell={{ sidebarCollectionOrder: "edited" }}>{list}</Shell>
    );
    expect(labels()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("holds every collection as an item of one list", () => {
    render(
      <Shell shell={{ sidebarCollectionOrder: "title" }}>
        <SidebarCollections collections={collections} projectId={7} />
      </Shell>
    );

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(
      collections.length
    );
  });

  it("colours spines only for collections with covers distinct from the project cover", () => {
    const projectCover = "covers/project.jpg";
    const items = [
      {
        ...collection(1, "Own Cover", "2026-09-01T00:00:00.000Z"),
        artwork: {
          assetPath: "covers/ep.jpg",
          accentHue: 210,
          accentChroma: 0.14,
        },
      },
      {
        ...collection(2, "Project Fallback", "2026-09-02T00:00:00.000Z"),
        artwork: {
          assetPath: projectCover,
          accentHue: 15,
          accentChroma: 0.16,
        },
      },
    ];

    const { container } = render(
      <Shell shell={{ sidebarCollectionOrder: "title" }}>
        <SidebarCollections
          collections={items}
          projectId={7}
          projectImage={projectCover}
        />
      </Shell>
    );

    const spines = container.querySelectorAll('[data-variant="spine"]');
    expect(spines).toHaveLength(2);
    expect(spines[0]?.hasAttribute("data-fallback")).toBe(false);
    expect(spines[1]?.hasAttribute("data-fallback")).toBe(true);
  });
});

describe("SidebarRecentNotes", () => {
  it("renders linked tracks on a second line without a redundant caption", () => {
    render(
      <Shell shell={{ recentItems: 5 }}>
        <SidebarRecentNotes
          notes={[
            {
              id: 1,
              label: "When we met did you know",
              href: "/notes/1",
              updatedAt: "2026-09-02T00:00:00.000Z",
              badge: "Deep Breath",
            },
            {
              id: 2,
              label: "Loose bridge ideas",
              href: "/notes/2",
              updatedAt: "2026-09-01T00:00:00.000Z",
              badge: null,
            },
          ]}
          hrefAll="/notes"
          allLabel="Show all notes"
        />
      </Shell>
    );

    expect(screen.queryByText(/recently edited/i)).toBeNull();
    expect(screen.getByText("When we met did you know")).toBeTruthy();
    expect(screen.getByText("Deep Breath")).toBeTruthy();
    expect(screen.getByText("Loose bridge ideas")).toBeTruthy();
  });
});
