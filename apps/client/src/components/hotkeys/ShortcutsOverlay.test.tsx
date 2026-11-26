import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { useMemo, useState } from "react";

import { NAVIGATION_COMMANDS } from "@/components/commands/navigation";
import { TABLE_COMMANDS } from "@/components/commands/tables";
import { PALETTE_COMMANDS } from "@/components/commands/palette";
import {
  CommandRegistry,
  ShortcutsOverlayContext,
} from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { ShortcutsOverlay } from "@/components/hotkeys/ShortcutsOverlay";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

afterEach(cleanup);

const COMMANDS = [
  ...PALETTE_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...TABLE_COMMANDS,
];

/** A page with no table on it, and no palette or theme wired up: enough
 *  context for the overlay's own commands and the greyed table ones. */
function Harness() {
  const [open, setOpen] = useState(false);
  const context = useMemo(
    () =>
      ({
        coarsePointer: false,
        setShortcutsOpen: setOpen,
      }) as unknown as ActionContext,
    []
  );

  return (
    <ShortcutsOverlayContext value={{ open, setOpen }}>
      <CommandRegistry commands={COMMANDS} context={context}>
        <ShortcutsOverlay />
      </CommandRegistry>
    </ShortcutsOverlayContext>
  );
}

function pressQuestionMark() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
  });
}

describe("ShortcutsOverlay", () => {
  it("opens on `?` and closes on a second `?`", async () => {
    render(<Harness />, { wrapper: MotionProvider });

    expect(screen.queryByRole("dialog")).toBeNull();

    pressQuestionMark();
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Keyboard shortcuts" })
      ).toBeTruthy()
    );

    pressQuestionMark();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lists a table command, greyed, on a page with no table pushing the scope", async () => {
    render(<Harness />, { wrapper: MotionProvider });

    pressQuestionMark();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const row = screen.getByText("Next row").closest("li");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-available")).toBe("false");
    expect(row?.textContent).toContain("(not available on this page)");
  });

  it("gives each group a heading and a list it labels, global groups first", async () => {
    render(<Harness />, { wrapper: MotionProvider });

    pressQuestionMark();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const headings = screen.getAllByRole("heading", { level: 3 });
    const names = headings.map((heading) => heading.textContent);
    expect(names).toContain("Table");
    expect(names.indexOf("General")).toBeLessThan(names.indexOf("Table"));
    for (const heading of headings) {
      const section = heading.closest("section");
      expect(section?.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(section?.querySelector("ul")).not.toBeNull();
    }
  });

  it("reads a chord to a screen reader with `then` between its steps", async () => {
    render(<Harness />, { wrapper: MotionProvider });

    pressQuestionMark();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const row = screen.getByText("Collections").closest("li");
    expect(row?.textContent).toContain("GthenC");
  });
});
