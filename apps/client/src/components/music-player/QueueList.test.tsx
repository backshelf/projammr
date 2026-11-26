import { QUEUE_COMMANDS } from "@/components/commands/queue";
import { CommandRegistry } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { useMemo, useSyncExternalStore } from "react";

type Entry = {
  key: string;
  qIndex: number;
  track: { id: string; title: string };
};

const entry = (qIndex: number, title: string): Entry => ({
  key: `k${qIndex}`,
  qIndex,
  track: { id: `t${qIndex}`, title },
});

let entries: Entry[] = [];
const listeners = new Set<() => void>();
const setEntries = (next: Entry[]) => {
  entries = next;
  listeners.forEach((l) => l());
};

const jump = mock<(qIndex: number) => void>();
const remove = mock((qIndex: number) => {
  setEntries(entries.filter((e) => e.qIndex !== qIndex));
});
const actions = { jump, remove, move: mock() };

function useEntries() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => entries
  );
}

function useActions() {
  return useMemo(() => actions, []);
}

mock.module("@/components/music-player/player-hooks", () => ({
  useUpcoming: useEntries,
  usePlayerActions: useActions,
}));
mock.module("@/components/music-player/types", () => ({
  artistLabel: () => "",
  trackLabel: (t: { title: string }) => t.title,
  versionLabel: () => "",
}));

const { default: QueueList } = await import("./QueueList");

function makeContext(): ActionContext {
  return {} as unknown as ActionContext;
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

/** Whether the row showing `text` carries the cursor. Asserted per row: a row
 *  leaving the list keeps its ring while it fades, so "the" cursor row is not
 *  unique mid-removal. */
const hasCursor = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("[data-cursor]")].some((row) =>
    row.textContent?.includes(text)
  );

function renderInRegistry() {
  return render(
    <CommandRegistry commands={QUEUE_COMMANDS} context={makeContext()}>
      <QueueList size="card" />
    </CommandRegistry>
  );
}

beforeEach(() => {
  entries = [entry(1, "one"), entry(2, "two"), entry(3, "three")];
  jump.mockClear();
  remove.mockClear();
});

afterEach(cleanup);

describe("QueueList keys", () => {
  it("starts the cursor on the first upcoming entry", () => {
    const { container } = renderInRegistry();
    expect(hasCursor(container, "one")).toBe(true);
    expect(container.querySelectorAll("[data-cursor]")).toHaveLength(1);
  });

  it("moves the cursor with j and k", () => {
    const { container } = renderInRegistry();
    press("j");
    expect(hasCursor(container, "two")).toBe(true);
    press("j");
    expect(hasCursor(container, "three")).toBe(true);
    press("k");
    expect(hasCursor(container, "two")).toBe(true);
    expect(container.querySelectorAll("[data-cursor]")).toHaveLength(1);
  });

  it("clamps at both ends", () => {
    const { container } = renderInRegistry();
    press("k");
    expect(hasCursor(container, "one")).toBe(true);
    press("j");
    press("j");
    press("j");
    press("j");
    expect(hasCursor(container, "three")).toBe(true);
  });

  it("jumps to the cursor's entry on Enter", () => {
    renderInRegistry();
    press("j");
    press("Enter");
    expect(jump).toHaveBeenCalledWith(2);
  });

  it("removes the cursor's entry on x and keeps the cursor on the entry that took its place", () => {
    const { container } = renderInRegistry();
    press("j");
    press("x");
    expect(remove).toHaveBeenCalledWith(2);
    expect(hasCursor(container, "three")).toBe(true);
  });

  it("moves the cursor to the new last entry when the last one is removed", () => {
    const { container } = renderInRegistry();
    press("j");
    press("j");
    press("x");
    expect(remove).toHaveBeenCalledWith(3);
    expect(hasCursor(container, "two")).toBe(true);
  });

  it("does nothing on x or Enter with an empty upcoming list", () => {
    entries = [];
    renderInRegistry();
    press("x");
    press("Enter");
    expect(remove).not.toHaveBeenCalled();
    expect(jump).not.toHaveBeenCalled();
  });
});

describe("QueueList inside a modal sheet", () => {
  it("still answers its keys above the sheet's own modal scope", () => {
    render(
      <CommandRegistry commands={QUEUE_COMMANDS} context={makeContext()}>
        <Sheet open>
          <SheetContent>
            <SheetTitle>Now playing</SheetTitle>
            <QueueList size="full" />
          </SheetContent>
        </Sheet>
      </CommandRegistry>
    );

    press("j");

    // The sheet portals its content out of the render container.
    expect(hasCursor(document.body, "two")).toBe(true);
  });
});

describe("QueueList without a command registry", () => {
  it("renders its rows and jumps on a click", () => {
    const { getByText } = render(<QueueList size="card" />);
    fireEvent.click(getByText("two"));
    expect(jump).toHaveBeenCalledWith(2);
  });
});
