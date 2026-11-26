import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { ModalScopeProvider } from "@workspace/ui/lib/modal-scope";
import type { PeekPanelProps, PeekRow } from "./PeekPanel";

// next/link updates state as it mounts, outside any act() the test can wrap.
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
const { PeekPanel } = await import("./PeekPanel");

afterEach(cleanup);

const rowA: PeekRow = { id: 1, title: "Blue Hour" };
const rowB: PeekRow = { id: 2, title: "Golden Hour" };

function setup(rename?: PeekPanelProps["rename"], row: PeekRow = rowA) {
  const onClose = mock<() => void>();
  const props = (next: PeekRow, nextRename = rename): PeekPanelProps => ({
    row: next,
    onClose,
    href: "/track/1",
    rename: nextRename,
  });
  const view = render(<PeekPanel {...props(row)} />, {
    wrapper: MotionProvider,
  });
  return {
    onClose,
    // The panel crosses rows with an exit animation that settles after the
    // render, so the act has to outlive it.
    rerender: (next: PeekRow, nextRename = rename) =>
      act(async () => {
        view.rerender(<PeekPanel {...props(next, nextRename)} />);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
  };
}

const rename = (active: boolean) => ({
  active,
  onSave: mock(async () => true),
  onEnd: mock<() => void>(),
});

describe("PeekPanel rename", () => {
  it("shows the title as text and no editor when rename is omitted", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Blue Hour" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the title as text while rename is inactive", () => {
    setup(rename(false));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("replaces the visible title with the editor and keeps the dialog named", () => {
    setup(rename(true));

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Title",
    });
    expect(input.value).toBe("Blue Hour");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("dialog", { name: "Blue Hour" })).toBeTruthy();
    expect(
      document.querySelector('[data-slot="sheet-title"]')?.className
    ).toContain("sr-only");
  });

  it("saves through the caller's onSave", async () => {
    const r = rename(true);
    setup(r);

    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Golden Hour" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(r.onSave).toHaveBeenCalledWith("Golden Hour");
    expect(r.onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the rename without closing the panel on Escape", async () => {
    const r = rename(true);
    const { onClose } = setup(r);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Title" }), {
        key: "Escape",
      });
    });

    expect(r.onEnd).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ends the rename when the peeked row changes", async () => {
    const r = rename(true);
    const { rerender } = setup(r);

    await rerender(rowB, r);

    expect(r.onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not end a rename that opens together with a new row", async () => {
    const off = rename(false);
    const { rerender } = setup(off);
    const on = rename(true);

    await rerender(rowB, on);

    expect(on.onEnd).not.toHaveBeenCalled();
  });

  it("does not end the rename when the same row re-renders", async () => {
    const r = rename(true);
    const { rerender } = setup(r);

    await rerender({ ...rowA, subtitle: "Mara" }, r);

    expect(r.onEnd).not.toHaveBeenCalled();
  });
});

describe("PeekPanel modal scope", () => {
  it("leaves the page's keys live while open by pushing no modal scope", () => {
    const push = mock<() => () => void>(() => () => {});

    render(
      <ModalScopeProvider push={push}>
        <PeekPanel row={rowA} onClose={mock()} href="/track/1" />
      </ModalScopeProvider>,
      { wrapper: MotionProvider }
    );

    expect(screen.getByRole("dialog", { name: "Blue Hour" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
