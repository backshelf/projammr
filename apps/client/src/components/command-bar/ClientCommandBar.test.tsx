import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { useState, type ReactNode } from "react";

import {
  defineCommands,
  defineScope,
  GLOBAL,
} from "@/components/commands/define";
import { COMMAND_BAR_COMMANDS } from "@/components/commands/command-bar";
import { PALETTE_COMMANDS } from "@/components/commands/palette";
import {
  CommandRegistry,
  ShortcutsOverlayContext,
  useCommandScope,
} from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";

// The bar's prompt reaches the prefix commands, which import server actions
// that load `server-only`; `mock.module` is not hoisted, so it runs before the
// dynamic import.
mock.module("server-only", () => ({}));
const { ClientCommandBar } =
  await import("@/components/command-bar/ClientCommandBar");

/**
 * `useIsMobile` reads `window.matchMedia` to subscribe and `innerWidth` for its
 * answer, and the test DOM provides the first of them not at all.
 */
function stubViewport(phone: boolean) {
  stubGlobal("innerWidth", phone ? 400 : 1024);
  stubGlobal("matchMedia", () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => stubViewport(false));
afterEach(() => {
  cleanup();
  unstubAllGlobals();
});

const SCOPED = defineScope<undefined>("bar-test-scope");

const COMMANDS = [
  ...PALETTE_COMMANDS,
  ...COMMAND_BAR_COMMANDS,
  ...defineCommands(GLOBAL, [
    {
      id: "go-tracks",
      label: "Tracks",
      group: "Go to",
      keys: ["g t"],
      run: mock(),
    },
    {
      id: "go-home",
      label: "Home",
      group: "Go to",
      keys: ["g h"],
      run: mock(),
    },
    {
      id: "next-row",
      label: "Next row",
      group: "Table",
      keys: ["j"],
      countable: true,
      run: mock(),
    },
    { id: "no-keys", label: "Nothing bound", group: "General", run: mock() },
    {
      id: "unavailable",
      label: "Cannot run",
      group: "General",
      keys: ["u"],
      when: () => false,
      run: mock(),
    },
  ]),
  ...defineCommands(SCOPED, [
    {
      id: "scoped-cmd",
      label: "Scoped",
      group: "General",
      keys: ["s"],
      run: mock(),
    },
  ]),
];

const CONTEXT = {
  coarsePointer: false,
  projectId: null,
  route: { kind: "not-found" },
} as unknown as ActionContext;

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

function PushScope() {
  useCommandScope(SCOPED, undefined, true);
  return null;
}

type Bar = {
  enabled?: boolean;
  position?: "top" | "bottom";
  mode?: "always" | "pending";
};

/** The bar under a registry, the shortcuts overlay's state made visible, and
 *  the shell policy's `commandBar` set as given. */
function Harness({
  bar = {},
  scoped = false,
}: {
  bar?: Bar;
  scoped?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const policies = {
    ...DEFAULT_POLICIES,
    shell: {
      ...DEFAULT_POLICIES.shell,
      commandBar: {
        ...DEFAULT_POLICIES.shell.commandBar,
        enabled: true,
        ...bar,
      },
    },
  };
  const context = {
    ...CONTEXT,
    setShortcutsOpen: setOpen,
  } as unknown as ActionContext;

  return (
    <PoliciesProvider policies={policies}>
      <ShortcutsOverlayContext value={{ open, setOpen }}>
        <CommandRegistry commands={COMMANDS} context={context}>
          {scoped && <PushScope />}
          <ClientCommandBar edge="top" />
          <div data-testid="page" />
          <ClientCommandBar edge="bottom" />
          <output data-testid="overlay">{open ? "open" : "closed"}</output>
        </CommandRegistry>
      </ShortcutsOverlayContext>
    </PoliciesProvider>
  );
}

/** The labels of the hints in the bar, in order. */
function hintLabels(): string[] {
  return [
    ...document.querySelectorAll(
      '[data-slot="command-bar"] [data-slot="command-hint"] > span:last-child'
    ),
  ].map((label) => label.textContent ?? "");
}

describe("ClientCommandBar", () => {
  it("lists the commands a press would run, the scope on top first and the global scope after", () => {
    render(<Harness scoped />);

    const labels = hintLabels();
    expect(labels).toContain("Scoped");
    expect(labels).toContain("Tracks");
    expect(labels.indexOf("Scoped")).toBeLessThan(labels.indexOf("Tracks"));
    expect(labels.at(-1)).toBe("Keys");
  });

  it("leaves out a command with no keys, one that cannot run, one whose scope is not pushed, and the shortcuts command", () => {
    render(<Harness />);

    const labels = hintLabels();
    expect(labels).not.toContain("Nothing bound");
    expect(labels).not.toContain("Cannot run");
    expect(labels).not.toContain("Scoped");
    expect(labels).not.toContain("Keyboard shortcuts");
    expect(labels.filter((label) => label === "Keys")).toHaveLength(1);
  });

  it("shows a pending chord and the commands that continue it", () => {
    render(<Harness />);

    press("g");

    expect(hintLabels().filter((label) => label !== "Keys")).toEqual([
      "Tracks",
      "Home",
    ]);
    expect(screen.getByText("g")).toBeTruthy();
  });

  it("shows a count as it is typed, in place of the rest", () => {
    render(<Harness />);

    press("5");

    expect(screen.getByText("5")).toBeTruthy();
    expect(hintLabels()).not.toContain("Tracks");
  });

  it("renders nothing when the command bar is off", () => {
    render(<Harness bar={{ enabled: false }} />);

    expect(document.querySelector('[data-slot="command-bar"]')).toBeNull();
  });

  it("renders nothing on a phone", () => {
    stubViewport(true);
    render(<Harness />);

    expect(document.querySelector('[data-slot="command-bar"]')).toBeNull();
  });

  it("in pending mode is hidden at rest and shown while a chord is pending", () => {
    render(<Harness bar={{ mode: "pending" }} />);

    expect(document.querySelector('[data-slot="command-bar"]')).toBeNull();

    press("g");
    expect(document.querySelector('[data-slot="command-bar"]')).not.toBeNull();

    press("Escape");
    expect(document.querySelector('[data-slot="command-bar"]')).toBeNull();
  });

  it("renders only at the edge the live policy names", () => {
    const page = () => screen.getByTestId("page");
    const bars = () => document.querySelectorAll('[data-slot="command-bar"]');

    const { unmount } = render(<Harness bar={{ position: "bottom" }} />);
    expect(bars()).toHaveLength(1);
    const bottom = bars()[0];
    expect(bottom?.tagName).toBe("FOOTER");
    expect(bottom?.getAttribute("data-position")).toBe("bottom");
    expect(
      page().compareDocumentPosition(bottom as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    unmount();

    render(<Harness bar={{ position: "top" }} />);
    expect(bars()).toHaveLength(1);
    const top = bars()[0];
    expect(top?.tagName).toBe("HEADER");
    expect(top?.getAttribute("data-position")).toBe("top");
    expect(
      page().compareDocumentPosition(top as Node) &
        Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();
  });

  describe("the command prompt", () => {
    const promptInput = () => document.querySelector("input");

    it("opens on `:`", () => {
      render(<Harness />);
      expect(promptInput()).toBeNull();

      press(":");

      expect(promptInput()).not.toBeNull();
    });

    it("does nothing on `:` when the bar is off", () => {
      render(<Harness bar={{ enabled: false }} />);

      press(":");

      expect(promptInput()).toBeNull();
    });

    it("does nothing on `:` on a phone", () => {
      stubViewport(true);
      render(<Harness />);

      press(":");

      expect(promptInput()).toBeNull();
    });

    it("silences the keys beneath it while open", () => {
      const nextRow = COMMANDS.find((c) => c.id === "next-row")!
        .run as ReturnType<typeof mock>;
      nextRow.mockClear();
      render(<Harness />);

      press("j");
      expect(nextRow).toHaveBeenCalledTimes(1);

      press(":");
      press("j");
      expect(nextRow).toHaveBeenCalledTimes(1);

      fireEvent.change(promptInput()!, { target: { value: "j" } });
      expect((promptInput() as HTMLInputElement).value).toBe("j");
    });

    it("closes on Escape and gives the keys back", () => {
      const nextRow = COMMANDS.find((c) => c.id === "next-row")!
        .run as ReturnType<typeof mock>;
      nextRow.mockClear();
      render(<Harness />);
      press(":");

      fireEvent.keyDown(promptInput()!, { key: "Escape" });
      expect(promptInput()).toBeNull();

      press("j");
      expect(nextRow).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the shortcuts overlay from the Keys hint", () => {
    render(<Harness />);
    expect(screen.getByTestId("overlay").textContent).toBe("closed");

    fireEvent.click(screen.getByRole("button", { name: /Keys/ }));

    expect(screen.getByTestId("overlay").textContent).toBe("open");
  });
});
