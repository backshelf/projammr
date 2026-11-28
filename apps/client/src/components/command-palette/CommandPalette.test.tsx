import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/components/command-palette/command-palette-context";
import { CommandRegistry } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { browserApi } from "@/lib/browser-api";
import type { Artwork } from "@workspace/api/api";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { useEffect } from "react";

mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mock(() => {}),
    replace: mock(() => {}),
    refresh: mock(() => {}),
  }),
  usePathname: () => "/project/1/tracks",
  useParams: () => ({ projectId: "1", route: ["tracks"] }),
  useSearchParams: () => new URLSearchParams(),
}));

const { CommandPalette } =
  await import("@/components/command-palette/CommandPalette");
const { CommandPaletteMount } =
  await import("@/components/command-palette/CommandPaletteMount");

type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

const ARTWORK: Artwork = {
  assetPath: "artwork/track-9.webp",
  accentHue: 24,
  accentChroma: 0.14,
};

const SESSION_ARTWORK: Artwork = {
  assetPath: "artwork/project-1.webp",
  accentHue: 190,
  accentChroma: 0.12,
};

function OpenOnMount() {
  const { setOpen } = useCommandPalette();
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  return null;
}

let restoreGet: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restoreGet?.();
  restoreGet = null;
  happyDOM.setURL(START_URL);
});

describe("CommandPalette", () => {
  it("passes real artwork through CommandPaletteMount to recent track and session swatches", async () => {
    happyDOM.setURL("http://localhost/project/1/tracks");

    render(
      <CommandRegistry
        commands={[]}
        context={
          {
            projectId: 1,
            route: { kind: "tracks" },
          } as unknown as ActionContext
        }
      >
        <CommandPaletteProvider>
          <OpenOnMount />
          <CommandPaletteMount
            recents={{
              projectId: 1,
              canEdit: true,
              allTracks: [{ id: 9, title: "Nightfall", archived: false }],
              tracks: [
                {
                  id: 9,
                  title: "Nightfall",
                  archivedAt: null,
                  artwork: ARTWORK,
                },
              ],
              sessions: [
                {
                  id: 14,
                  name: "Nightfall v3.als",
                  trackId: 9,
                  archived: false,
                  artwork: SESSION_ARTWORK,
                },
              ],
            }}
          />
        </CommandPaletteProvider>
      </CommandRegistry>
    );

    const trackItem = await screen.findByText("Nightfall");
    const trackSwatch = trackItem
      .closest("[cmdk-item]")
      ?.querySelector('[data-slot="art-swatch"]') as HTMLElement | null;
    expect(trackSwatch).not.toBeNull();
    expect(trackSwatch?.style.getPropertyValue("--art-light")).toContain("24");
    expect(trackSwatch?.style.getPropertyValue("--art-dark")).toContain("24");

    const sessionItem = screen.getByText("Nightfall v3.als");
    const sessionSwatch = sessionItem
      .closest("[cmdk-item]")
      ?.querySelector('[data-slot="art-swatch"]') as HTMLElement | null;
    expect(sessionSwatch).not.toBeNull();
    expect(sessionSwatch?.style.getPropertyValue("--art-light")).toContain(
      "190"
    );
    expect(sessionSwatch?.style.getPropertyValue("--art-dark")).toContain(
      "190"
    );
  });

  it("renders result.subtitle in search results to disambiguate duplicate titles", async () => {
    happyDOM.setURL("http://localhost/project/1/tracks");

    const spy = spyOn(browserApi, "GET").mockResolvedValue({
      data: [
        {
          type: "track",
          id: 101,
          title: "Intro",
          subtitle: "Album One",
          projectId: 1,
          matchedField: "title",
          image: ARTWORK,
          archived: false,
          score: 10,
        },
        {
          type: "track",
          id: 102,
          title: "Intro",
          subtitle: "EP Two",
          snippet: "opening synth",
          projectId: 1,
          matchedField: "notes",
          image: null,
          archived: false,
          score: 8,
        },
      ],
      response: new Response(null, { status: 200 }),
    } as never);
    restoreGet = () => spy.mockRestore();

    render(
      <CommandRegistry
        commands={[]}
        context={
          {
            projectId: 1,
            route: { kind: "tracks" },
          } as unknown as ActionContext
        }
      >
        <CommandPaletteProvider>
          <OpenOnMount />
          <CommandPalette
            recents={{
              projectId: 1,
              canEdit: true,
              allTracks: [],
              tracks: [],
              sessions: [],
            }}
          />
        </CommandPaletteProvider>
      </CommandRegistry>
    );

    const input = await screen.findByPlaceholderText("Search this project…");
    act(() => {
      fireEvent.change(input, { target: { value: "Intro" } });
    });

    await waitFor(() => {
      expect(screen.getByText("Album One")).toBeTruthy();
      expect(screen.getByText("EP Two · opening synth")).toBeTruthy();
    });
  });
});
