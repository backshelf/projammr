import { ENTITY_COMMANDS } from "@/components/commands/entity";
import { EntitySurfaceProvider } from "@/components/commands/entity-surface";
import type { CommentBackend } from "@/components/comments/comment-backend";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { useState } from "react";

mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));
mock.module("sonner", () => ({ toast: { error: mock() } }));

mock.module("@/components/music-player/player-hooks", () => ({
  useCurrentAssetId: () => 9,
  useMusicPlayerStore: () => ({ getProgress: () => 0 }),
  usePlayerActions: () => ({ seek: mock() }),
  useCurrentTrack: () => null,
  useDuration: () => 0,
  useLabSettings: () => ({}),
}));

let hasSelected = true;
mock.module("@/components/track-audio/TrackAudioContext", () => ({
  useTrackAudio: () => {
    const [commentsOpen, setCommentsOpen] = useState(false);
    return {
      selected: hasSelected ? { id: 5, assetId: 9, version: 1 } : null,
      comments: [],
      reloadComments: () => {},
      registerScrollTarget: () => {},
      commentsOpen,
      setCommentsOpen,
    };
  },
}));

const { CommentBackendProvider } =
  await import("@/components/comments/comment-backend");
const { CommandRegistry } = await import("@/components/commands/provider");
const { AudioCommentPanel } = await import("./AudioCommentPanel");

const originalWidth = window.innerWidth;
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  cleanup();
  hasSelected = true;
  setViewportWidth(originalWidth);
});

const backend = {
  list: mock(),
  create: mock(),
  update: mock(),
  remove: mock(),
} as unknown as CommentBackend;

function renderPage({ withProvider = true } = {}) {
  const panel = (
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <CommentBackendProvider backend={backend}>
        <AudioCommentPanel />
      </CommentBackendProvider>
    </PoliciesProvider>
  );
  render(
    <CommandRegistry
      commands={ENTITY_COMMANDS}
      context={{ router: { push: mock() } } as never}
    >
      {withProvider ? (
        <EntitySurfaceProvider previousHref={null} nextHref={null}>
          {panel}
        </EntitySurfaceProvider>
      ) : (
        panel
      )}
    </CommandRegistry>
  );
}

function pressC() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  });
}

const composer = () => screen.queryByPlaceholderText("Write a comment…");

describe("the open popover", () => {
  it("is a dialog named for the version it holds comments on", async () => {
    setViewportWidth(1024);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /comment/i }));

    expect(
      await screen.findByRole("dialog", { name: "Comments on v1" })
    ).toBeTruthy();
  });

  it("opens as a 55dvh bottom sheet on mobile while preserving pill copy", async () => {
    setViewportWidth(390);
    renderPage();

    const trigger = screen.getByRole("button", { name: "Comments on v1" });
    expect(trigger.textContent).toBe("Comments");

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Comments on v1",
    });
    expect(dialog.getAttribute("data-side")).toBe("bottom");
    expect(dialog.className).toContain("max-h-[55dvh]");
  });
});

describe("the comment key", () => {
  it("opens the closed popover with the composer focused", async () => {
    renderPage();
    expect(composer()).toBeNull();

    pressC();

    const input = await screen.findByPlaceholderText("Write a comment…");
    await act(async () => {});
    expect(document.activeElement).toBe(input);
  });

  it("focuses the composer when the popover is already open", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));
    const input = await screen.findByPlaceholderText("Write a comment…");
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).not.toBe(input);

    pressC();

    expect(document.activeElement).toBe(input);
  });

  it("registers nothing when no audio version is selected", () => {
    hasSelected = false;
    renderPage();

    pressC();

    expect(composer()).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a no-op on a page without the entity provider", () => {
    renderPage({ withProvider: false });

    pressC();

    expect(composer()).toBeNull();
  });
});
