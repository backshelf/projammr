import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { waitFor } from "@workspace/test/wait-for";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import type { ComponentProps } from "react";
import type {
  CollectionSummary,
  CollectionTrackSummary,
} from "@workspace/api/api";

// `mock.module` is not hoisted: it must run before `./SidebarCollectionItem` is
// imported, since that import is what evaluates `next/link` and `client-api`.
mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a
        href={typeof href === "string" ? href : JSON.stringify(href)}
        {...rest}
      >
        {children}
      </a>
    );
  },
  // Not a real hook, just a stub matching the shape `next/link` exports.
  useLinkStatus: () => ({ pending: false }),
}));

const clientGetCollectionTrackSummaries = mock();
mock.module("@/lib/client-api", () => ({ clientGetCollectionTrackSummaries }));

const { SidebarCollectionItem } = await import("./SidebarCollectionItem");
const { applyMutation } = await import("@/lib/mutation");
const { collectionTracksChanged } = await import("@/entities/mutations");

afterEach(cleanup);

const collection: CollectionSummary = {
  id: 1,
  title: "Demos",
  image: null,
  projectId: 7,
  statusId: null,
  releaseDate: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  trackCount: 1,
  artwork: null,
};

const track: CollectionTrackSummary = {
  id: 11,
  title: "Track One",
  trackNumber: null,
  image: null,
  archivedAt: null,
  artwork: null,
};

function renderItem() {
  return render(
    <SidebarProvider>
      <SidebarCollectionItem collection={collection} projectId={7} />
    </SidebarProvider>,
    { wrapper: MotionProvider }
  );
}

/** Opens the disclosure by driving its trigger — there is no `open` prop. */
async function openItem() {
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("Track One");
}

describe("SidebarCollectionItem", () => {
  beforeEach(() => {
    clientGetCollectionTrackSummaries.mockReset();
  });

  it("names its disclosure after the collection and what pressing it does", async () => {
    clientGetCollectionTrackSummaries.mockResolvedValue([track]);
    renderItem();

    const expand = screen.getByRole("button", { name: "Expand Demos" });
    expect(expand.className).toContain("size-6");
    fireEvent.click(expand);
    await screen.findByText("Track One");

    expect(screen.getByRole("button", { name: "Collapse Demos" })).toBeTruthy();
  });

  it("refetches its tracks when collection-tracks is invalidated", async () => {
    clientGetCollectionTrackSummaries.mockResolvedValue([track]);
    renderItem();

    await openItem();
    expect(clientGetCollectionTrackSummaries).toHaveBeenCalledTimes(1);

    await act(async () => {
      await applyMutation(collectionTracksChanged(), { refresh() {} });
    });

    await waitFor(() =>
      expect(clientGetCollectionTrackSummaries).toHaveBeenCalledTimes(2)
    );
  });

  it("unsubscribes on unmount", async () => {
    clientGetCollectionTrackSummaries.mockResolvedValue([track]);
    const { unmount } = renderItem();

    await openItem();
    expect(clientGetCollectionTrackSummaries).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await applyMutation(collectionTracksChanged(), { refresh() {} });
    });

    // No listener survives the unmount, so the key firing reads nothing again.
    expect(clientGetCollectionTrackSummaries).toHaveBeenCalledTimes(1);
  });

  it("shows a quiet empty state when a collection has no tracks", async () => {
    clientGetCollectionTrackSummaries.mockResolvedValue([]);
    renderItem();

    fireEvent.click(screen.getByRole("button", { name: "Expand Demos" }));
    expect(await screen.findByText("No tracks")).toBeTruthy();
  });

  it("renders a coloured spine only for nested tracks with distinct artwork", async () => {
    const collectionArt = {
      assetPath: "covers/collection.jpg",
      accentHue: 220,
      accentChroma: 0.14,
    };
    const ownTrackArt = {
      assetPath: "covers/track.jpg",
      accentHue: 45,
      accentChroma: 0.15,
    };
    clientGetCollectionTrackSummaries.mockResolvedValue([
      { ...track, id: 11, title: "Inherited", artwork: collectionArt },
      { ...track, id: 12, title: "Own Cover", artwork: ownTrackArt },
    ]);

    const { container } = render(
      <SidebarProvider>
        <SidebarCollectionItem
          collection={{ ...collection, artwork: collectionArt }}
          projectId={7}
          swatch={collectionArt}
        />
      </SidebarProvider>,
      { wrapper: MotionProvider }
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Demos" }));
    await screen.findByText("Own Cover");

    const spines = container.querySelectorAll('[data-variant="spine"]');
    expect(spines).toHaveLength(3);
    // Collection spine carries its own hue
    expect(spines[0]?.hasAttribute("data-fallback")).toBe(false);
    // Track inheriting the collection's cover drops to a neutral hairline
    expect(spines[1]?.hasAttribute("data-fallback")).toBe(true);
    // Track with its own cover keeps its hue
    expect(spines[2]?.hasAttribute("data-fallback")).toBe(false);
  });
});
