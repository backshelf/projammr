import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const playInContext = mock(async () => {});
const queueNext = mock(async () => {});
const queueLast = mock(async () => {});

mock.module("@/components/music-player/use-playback", () => ({
  usePlayback: () => ({
    isLoaded: false,
    showPause: false,
    loading: false,
    toggle: mock(async () => {}),
    playInContext,
    queueNext,
    queueLast,
  }),
}));

const { ActionItems } = await import("./RowActions");
import type { ActionPrimitives, RowActionsConfig } from "./RowActions";

afterEach(() => {
  cleanup();
  for (const fn of [playInContext, queueNext, queueLast]) fn.mockClear();
});

const primitives: ActionPrimitives = {
  Item: ({ onSelect, variant, children }) => (
    <button
      type="button"
      role="menuitem"
      data-variant={variant}
      onClick={() => onSelect?.(new Event("select"))}
    >
      {children}
    </button>
  ),
  Separator: () => <hr role="separator" />,
  Sub: ({ children }) => <div>{children}</div>,
  SubTrigger: ({ children }) => <div role="menuitem">{children}</div>,
  SubContent: ({ children }) => <div>{children}</div>,
};

function renderMenu(
  config: RowActionsConfig,
  target = { count: 1, label: "track" }
) {
  return render(
    <div role="menu">
      <ActionItems config={config} target={target} primitives={primitives} />
    </div>
  );
}

describe("ActionItems unified row menu", () => {
  it("groups Playback, Inspect & Edit, and Move/Delete with clean separators and a single Delete", () => {
    const onDelete = mock();
    const onOpen = mock();
    const onDownload = mock();

    const { container } = renderMenu({
      playback: { kind: "track", id: 1, title: "Intro", collectionId: 5 },
      onOpen,
      onOpenPage: mock(),
      onRename: mock(),
      onCopyLink: mock(),
      onDownload,
      actions: [{ id: "archive", label: "Archive", onSelect: mock() }],
      onMove: mock(),
      onDelete,
    });

    const tokens = Array.from(
      container.querySelectorAll('[role="menuitem"], [role="separator"]')
    ).map((el) =>
      el.getAttribute("role") === "separator" ? "---" : el.textContent?.trim()
    );

    expect(tokens).toEqual([
      "Play from here",
      "Play next",
      "Add to queue",
      "---",
      "Open",
      "Open page",
      "Rename",
      "Copy link",
      "Download",
      "Archive",
      "---",
      "Move to project…",
      "Delete",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Play from here" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play next" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to queue" }));
    expect(playInContext).toHaveBeenCalledTimes(1);
    expect(queueNext).toHaveBeenCalledTimes(1);
    expect(queueLast).toHaveBeenCalledTimes(1);
  });

  it("uses collection playback labels for collection rows", () => {
    renderMenu(
      {
        playback: { kind: "collection", id: 3, title: "LP" },
        onCopyLink: mock(),
      },
      { count: 1, label: "collection" }
    );

    expect(
      screen.getByRole("menuitem", { name: "Play collection" })
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Queue collection" })
    ).toBeTruthy();
  });

  it("omits single-row playback items on multi-row selections", () => {
    renderMenu(
      {
        playback: { kind: "track", id: 1, title: "Intro" },
        onMove: mock(),
        onDelete: mock(),
      },
      { count: 3, label: "tracks" }
    );

    expect(screen.queryByRole("menuitem", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Play next" })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Delete 3 tracks" })
    ).toBeTruthy();
  });
});
