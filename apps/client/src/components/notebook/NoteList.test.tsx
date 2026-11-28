import { CommandRegistry } from "@/components/commands/provider";
import { NOTEBOOK_COMMANDS } from "@/components/commands/notebook";
import type { ActionContext } from "@/components/commands/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NoteSummary } from "@workspace/api/api";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const push = mock();
let pathname = "/notes";
let summaries: NoteSummary[] = [];

mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));
mock.module("@/components/notebook/NotebookShell", () => ({
  useNotebook: () => ({ summaries }),
}));
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
mock.module("@workspace/ui/components/format-provider", () => ({
  useFormat: () => ({ relative: () => "just now" }),
}));

const { NoteList } = await import("./NoteList");

function note(id: number, overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id,
    title: `Note ${id}`,
    preview: "",
    pinned: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    track: null,
    ...overrides,
  } as NoteSummary;
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function renderList() {
  return render(
    <CommandRegistry
      commands={NOTEBOOK_COMMANDS}
      context={{} as unknown as ActionContext}
    >
      <NoteList />
    </CommandRegistry>
  );
}

// Visible order is pinned first: 1, 3, then 2 and 4.
const NOTES = [note(1, { pinned: true }), note(2), note(3, { pinned: true })];

beforeEach(() => {
  pathname = "/notes";
  summaries = [...NOTES, note(4)];
});

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("NoteList keys", () => {
  it("opens the first note on j and the last on k when none is open", () => {
    renderList();

    press("j");
    expect(push).toHaveBeenLastCalledWith("/notes/1");
    press("k");
    expect(push).toHaveBeenLastCalledWith("/notes/4");
  });

  it("steps to the neighbour in pinned-then-rest order", () => {
    pathname = "/notes/3";
    renderList();

    press("j");
    expect(push).toHaveBeenLastCalledWith("/notes/2");
    press("k");
    expect(push).toHaveBeenLastCalledWith("/notes/1");
  });

  it("clamps at the ends", () => {
    pathname = "/notes/4";
    const { unmount } = renderList();
    press("j");
    expect(push).not.toHaveBeenCalled();
    unmount();

    pathname = "/notes/1";
    renderList();
    press("k");
    expect(push).not.toHaveBeenCalled();
  });

  it("walks only the notes the filter leaves", () => {
    pathname = "/notes/1";
    renderList();
    fireEvent.change(screen.getByPlaceholderText("Filter notes…"), {
      target: { value: "note 4" },
    });
    // Typing in the filter does not fire keys; move focus off it.
    (document.activeElement as HTMLElement | null)?.blur();

    press("j");
    expect(push).toHaveBeenLastCalledWith("/notes/4");
  });

  it("does nothing on j and k when nothing matches the filter", () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText("Filter notes…"), {
      target: { value: "zzz" },
    });
    (document.activeElement as HTMLElement | null)?.blur();

    press("j");
    press("k");
    expect(push).not.toHaveBeenCalled();
  });

  it("focuses the filter on f", () => {
    renderList();
    const filter = screen.getByPlaceholderText("Filter notes…");
    expect(document.activeElement).not.toBe(filter);

    press("f");
    expect(document.activeElement).toBe(filter);
  });

  it("does not fire while typing in the filter", () => {
    renderList();
    const filter = screen.getByPlaceholderText("Filter notes…");
    filter.focus();

    fireEvent.keyDown(filter, { key: "j" });
    expect(push).not.toHaveBeenCalled();
  });

  it("places a linked track chip inside RowMain alongside the timestamp", () => {
    summaries = [
      note(1, {
        title: "Chorus Hook Idea That Should Not Be Crushed",
        track: {
          id: 12,
          title: "Midnight Tape",
          projectId: 5,
          projectName: "Night Drive",
        },
      }),
    ];
    renderList();

    const noteLink = screen
      .getByText("Chorus Hook Idea That Should Not Be Crushed")
      .closest("a")!;
    const trackLink = screen.getByRole("link", { name: "Midnight Tape" });
    expect(noteLink.parentElement).toBe(
      trackLink.closest("span.min-w-0.flex-1")
    );
  });
});
