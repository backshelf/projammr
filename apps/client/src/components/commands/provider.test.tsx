import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { FormEvent, ReactNode } from "react";
import type { ActionContext } from "@/components/commands/types";
import type { ParsedRoute } from "@/lib/route-parser";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@workspace/ui/components/sheet";

// `CommandProvider` (below) pulls in the app's real hooks through
// `@/components/commands/index`'s `COMMANDS`; these stand in for the ones a
// server-rendered surface or a browser API backs, so the module can load and
// render under bun test. `mock.module` is not hoisted, so it must run before
// the dynamic imports at the bottom load the module graph.
const current = {
  value: null as { projectId: number; route: ParsedRoute } | null,
};
mock.module("@/hooks/use-current-route", () => ({
  useCurrentRoute: () => current.value,
}));
mock.module("@/components/command-palette/command-palette-context", () => ({
  useCommandPalette: () => ({ open: false, setOpen: mock() }),
}));
mock.module("@/components/music-player/player-hooks", () => ({
  useMusicPlayerStore: () => ({ actions: {} }),
  useCurrentTrack: () => null,
  useDuration: () => 0,
  useLabSettings: () => DEFAULT_LAB,
}));
mock.module("@/components/music-player/now-playing-context", () => ({
  useNowPlaying: () => ({
    open: false,
    setOpen: mock(),
    setView: mock(),
    view: "player",
  }),
}));
const setTheme = mock();
mock.module("@/components/theme/AppThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock() }),
  usePathname: () => "/project/1",
}));
mock.module("@workspace/ui/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => false,
}));
const toggleSidebar = mock();
mock.module("@workspace/ui/components/sidebar", () => ({
  useSidebar: () => ({ toggleSidebar }),
}));

const { DIALOG_SCOPE, defineCommands, defineScope, GLOBAL, NOW_PLAYING_SCOPE } =
  await import("@/components/commands/define");
const NO_SURFACE = {};
const {
  CommandProvider,
  CommandRegistry,
  ModalScopeBridge,
  useActionContext,
  useCommandScope,
  useCommands,
  usePublishCommandContext,
  useRunCommand,
} = await import("@/components/commands/provider");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { hasUndo, toastActionResult, undoLast } =
  await import("@/lib/action-toast");

afterEach(cleanup);

const STUB_CONTEXT = {} as ActionContext;

const TEST_SCOPE = defineScope<{ value: string }>("test-scope");

const globalRun = mock();
const gatedRun = mock();
const scopedRun = mock();

const COMMANDS = [
  ...defineCommands(GLOBAL, [
    {
      id: "global-cmd",
      label: "Global",
      group: "General",
      keys: ["g"],
      run: globalRun,
    },
    {
      id: "gated-cmd",
      label: "Gated",
      group: "General",
      keys: ["x"],
      when: () => false,
      run: gatedRun,
    },
  ]),
  ...defineCommands(TEST_SCOPE, [
    {
      id: "scoped-cmd",
      label: "Scoped",
      group: "General",
      keys: ["s"],
      run: (ctx) => scopedRun(ctx.surface.value),
    },
  ]),
];

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function Registry({ children }: { children: ReactNode }) {
  return (
    <CommandRegistry commands={COMMANDS} context={STUB_CONTEXT}>
      {children}
    </CommandRegistry>
  );
}

/** Pushes `TEST_SCOPE` with `value` for as long as it renders. */
function Pusher({ value, onTop = false }: { value: string; onTop?: boolean }) {
  useCommandScope(TEST_SCOPE, { value }, true, { onTop });
  return null;
}

/** Pushes a modal scope no command answers in, for as long as it renders. */
function Modal() {
  useCommandScope(DIALOG_SCOPE, NO_SURFACE, true, { modal: true });
  return null;
}

function Commands() {
  const commands = useCommands();
  return (
    <span data-testid="available">
      {commands
        .filter((command) => command.available)
        .map((command) => command.id)
        .join(",")}
    </span>
  );
}

describe("CommandRegistry", () => {
  afterEach(() => {
    globalRun.mockClear();
    gatedRun.mockClear();
    scopedRun.mockClear();
  });

  it("dispatches a keydown to the command bound to its combo", () => {
    render(<Registry>{null}</Registry>);

    press("g");

    expect(globalRun).toHaveBeenCalledTimes(1);
  });

  it("answers a scoped command only while its scope is pushed, with the innermost push's surface", () => {
    const { rerender } = render(<Registry>{null}</Registry>);
    press("s");
    expect(scopedRun).not.toHaveBeenCalled();

    rerender(
      <Registry>
        <Pusher value="outer" />
      </Registry>
    );
    press("s");
    expect(scopedRun).toHaveBeenLastCalledWith("outer");

    rerender(
      <Registry>
        <Pusher value="outer" />
        <Pusher value="inner" />
      </Registry>
    );
    press("s");
    expect(scopedRun).toHaveBeenLastCalledWith("inner");
  });

  it("keeps a `when: false` command unavailable and never runs it", () => {
    const { getByTestId } = render(
      <Registry>
        <Commands />
      </Registry>
    );

    expect(getByTestId("available").textContent).not.toContain("gated-cmd");

    press("x");
    expect(gatedRun).not.toHaveBeenCalled();
  });

  it("silences every global command while a modal scope is pushed", () => {
    const { rerender } = render(
      <Registry>
        <Modal />
      </Registry>
    );

    press("g");
    expect(globalRun).not.toHaveBeenCalled();

    rerender(<Registry>{null}</Registry>);
    press("g");
    expect(globalRun).toHaveBeenCalledTimes(1);
  });

  it("keeps an `onTop` push innermost even after a modal push lands over it", () => {
    const { rerender } = render(
      <Registry>
        <Pusher value="outer" onTop />
      </Registry>
    );

    rerender(
      <Registry>
        <Pusher value="outer" onTop />
        <Modal />
      </Registry>
    );

    // The onTop push re-claims the top of the stack, so its own scope still
    // answers and the modal beneath it still silences the globals.
    press("s");
    expect(scopedRun).toHaveBeenLastCalledWith("outer");
    press("g");
    expect(globalRun).not.toHaveBeenCalled();
  });
});

describe("repeating the last command", () => {
  const repeatable = mock<(count: number) => void>();
  const plain = mock();
  const unavailable = mock();
  const gate = { open: true };

  const REPEAT_COMMANDS = defineCommands(GLOBAL, [
    {
      id: "repeatable-cmd",
      label: "Repeatable",
      group: "General",
      keys: ["r"],
      countable: true,
      repeatable: true,
      run: (ctx) => repeatable(ctx.count),
    },
    {
      id: "plain-cmd",
      label: "Plain",
      group: "General",
      keys: ["p"],
      run: plain,
    },
    {
      id: "gated-repeatable-cmd",
      label: "Gated repeatable",
      group: "General",
      keys: ["d"],
      repeatable: true,
      when: () => gate.open,
      run: unavailable,
    },
    {
      id: "repeat-cmd",
      label: "Repeat",
      group: "General",
      keys: ["."],
      run: (ctx) => ctx.repeatLast(),
    },
  ]);

  function RepeatRegistry({ children }: { children?: ReactNode }) {
    return (
      <CommandRegistry commands={REPEAT_COMMANDS} context={STUB_CONTEXT}>
        {children}
      </CommandRegistry>
    );
  }

  afterEach(() => {
    repeatable.mockClear();
    plain.mockClear();
    unavailable.mockClear();
    gate.open = true;
  });

  it("runs a repeatable command again with the count it last ran with", () => {
    render(<RepeatRegistry />);

    press("3");
    press("r");
    expect(repeatable).toHaveBeenLastCalledWith(3);

    press(".");
    expect(repeatable).toHaveBeenCalledTimes(2);
    expect(repeatable).toHaveBeenLastCalledWith(3);

    press("r");
    press(".");
    expect(repeatable).toHaveBeenLastCalledWith(1);
  });

  it("does nothing before any repeatable command has run", () => {
    render(<RepeatRegistry />);

    press(".");

    expect(repeatable).not.toHaveBeenCalled();
  });

  it("does not record a command that is not repeatable", () => {
    render(<RepeatRegistry />);

    press("r");
    press("p");
    press(".");

    expect(plain).toHaveBeenCalledTimes(1);
    expect(repeatable).toHaveBeenCalledTimes(2);
  });

  it("never records `.` itself", () => {
    render(<RepeatRegistry />);

    press("r");
    press(".");
    press(".");

    expect(repeatable).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the recorded command is unavailable now", () => {
    render(<RepeatRegistry />);

    press("d");
    expect(unavailable).toHaveBeenCalledTimes(1);

    gate.open = false;
    press(".");

    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it("records a command run from the palette's path with count 1", () => {
    function Runner() {
      const run = useRunCommand();
      return (
        <button type="button" onClick={() => run("repeatable-cmd")}>
          run
        </button>
      );
    }
    const { getByText } = render(
      <RepeatRegistry>
        <Runner />
      </RepeatRegistry>
    );

    getByText("run").click();
    press(".");

    expect(repeatable).toHaveBeenCalledTimes(2);
    expect(repeatable).toHaveBeenLastCalledWith(1);
  });
});

describe("commands gated on a toast offering Undo", () => {
  const undoable = defineCommands(GLOBAL, [
    {
      id: "undo-cmd",
      label: "Undo",
      group: "General",
      keys: ["u"],
      when: () => hasUndo(),
      run: () => undoLast(),
    },
  ]);

  it("becomes available while a toast offers Undo and unavailable once it is gone", async () => {
    const { getByTestId } = render(
      <CommandRegistry commands={undoable} context={STUB_CONTEXT}>
        <Commands />
      </CommandRegistry>
    );
    expect(getByTestId("available").textContent).toBe("");

    act(() => {
      toastActionResult({
        ok: true,
        message: "Archived",
        undo: async () => ({ ok: true, message: "Back" }),
      });
    });
    expect(getByTestId("available").textContent).toBe("undo-cmd");

    act(() => press("u"));
    expect(getByTestId("available").textContent).toBe("");
  });
});

describe("useCommandScope", () => {
  it("does nothing outside a CommandRegistry", () => {
    expect(() =>
      renderHook(() => useCommandScope(TEST_SCOPE, { value: "x" }, true))
    ).not.toThrow();
    expect(() =>
      renderHook(() =>
        useCommandScope(DIALOG_SCOPE, NO_SURFACE, true, { modal: true })
      )
    ).not.toThrow();
  });
});

describe("CommandProvider", () => {
  afterEach(() => {
    current.value = null;
  });

  /** Reads the live `ActionContext` and publishes recents fields, so a test
   *  can assert what the provider resolved without reaching into its internals. */
  function Probe({
    published,
  }: {
    published: { projectId: number; canEdit: boolean; allTracks: [] } | null;
  }) {
    usePublishCommandContext(published);
    const ctx = useActionContext();
    return <span data-testid="can-edit">{ctx.canEdit ? "true" : "false"}</span>;
  }

  it("ignores a published context whose project differs from the URL's", () => {
    current.value = { projectId: 7, route: { kind: "project" } };

    const { getByTestId } = render(
      <CommandProvider>
        <Probe published={{ projectId: 9, canEdit: true, allTracks: [] }} />
      </CommandProvider>
    );

    expect(getByTestId("can-edit").textContent).toBe("false");
  });

  it("uses the published context once its project matches the URL's", () => {
    current.value = { projectId: 7, route: { kind: "project" } };

    const { getByTestId } = render(
      <CommandProvider>
        <Probe published={{ projectId: 7, canEdit: true, allTracks: [] }} />
      </CommandProvider>
    );

    expect(getByTestId("can-edit").textContent).toBe("true");
  });
});

describe("keybindings.client under CommandProvider", () => {
  afterEach(() => toggleSidebar.mockClear());

  function renderWithKeys(keys: Record<string, string[]>) {
    return render(
      <SettingsProvider
        initial={effectiveSettings({ "keybindings.client": keys }, "test")}
        userId="u1"
      >
        <CommandProvider>
          <span />
        </CommandProvider>
      </SettingsProvider>
    );
  }

  it("runs a rebound command on its new key and not its old one", () => {
    renderWithKeys({ "toggle-sidebar": ["mod+j"] });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true })
    );
    expect(toggleSidebar).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true })
    );
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("ignores an override for an unknown command", () => {
    renderWithKeys({ nonsense: ["mod+j"] });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true })
    );
    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });
});

describe("mod+b under CommandProvider", () => {
  afterEach(() => toggleSidebar.mockClear());

  it("toggles the sidebar through useSidebar", () => {
    render(
      <CommandProvider>
        <span />
      </CommandProvider>
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true })
    );

    expect(toggleSidebar).toHaveBeenCalledTimes(1);
  });
});

describe("a ui dialog under CommandProvider", () => {
  afterEach(() => setTheme.mockClear());

  function pressMod(key: string) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true }));
  }

  it("silences a global command while open, and mod+Enter submits its form", () => {
    const onSubmit = mock((e: FormEvent) => e.preventDefault());

    function TestDialog({ open }: { open: boolean }) {
      return (
        <Dialog open={open}>
          <DialogContent>
            <DialogTitle>Rename track</DialogTitle>
            <form onSubmit={onSubmit}>
              <button type="submit">Save</button>
            </form>
          </DialogContent>
        </Dialog>
      );
    }

    const { rerender } = render(
      <CommandProvider>
        <TestDialog open={false} />
      </CommandProvider>
    );

    press("d");
    expect(setTheme).toHaveBeenCalledTimes(1);
    setTheme.mockClear();

    rerender(
      <CommandProvider>
        <TestDialog open />
      </CommandProvider>
    );

    press("d");
    expect(setTheme).not.toHaveBeenCalled();

    pressMod("Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("a ui sheet under CommandProvider", () => {
  afterEach(() => setTheme.mockClear());

  function TestSheet({
    open,
    modalScope,
    children,
  }: {
    open: boolean;
    modalScope?: boolean;
    children?: ReactNode;
  }) {
    return (
      <Sheet open={open}>
        <SheetContent modalScope={modalScope}>
          <SheetTitle>Row actions</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  const inProvider = (sheet: ReactNode) => (
    <CommandProvider>{sheet}</CommandProvider>
  );

  it("silences a global command while open and restores it on close", () => {
    const { rerender } = render(inProvider(<TestSheet open={false} />));

    press("d");
    expect(setTheme).toHaveBeenCalledTimes(1);
    setTheme.mockClear();

    rerender(inProvider(<TestSheet open />));
    press("d");
    expect(setTheme).not.toHaveBeenCalled();

    rerender(inProvider(<TestSheet open={false} />));
    press("d");
    expect(setTheme).toHaveBeenCalledTimes(1);
  });

  it("leaves a global command live when it opts out of the modal scope", () => {
    render(inProvider(<TestSheet open modalScope={false} />));

    press("d");
    expect(setTheme).toHaveBeenCalledTimes(1);
  });

  it("answers a scope its own content pushes, above the sheet's modal push", () => {
    scopedRun.mockClear();
    render(
      <CommandRegistry commands={COMMANDS} context={STUB_CONTEXT}>
        <TestSheet open>
          <Pusher value="inside" />
        </TestSheet>
      </CommandRegistry>
    );

    press("s");
    expect(scopedRun).toHaveBeenCalledWith("inside");
  });

  describe("with a scope pushed inside the sheet that commands answer in through alsoIn", () => {
    const alsoInRun = mock();
    const WIDENED = defineCommands(
      GLOBAL,
      [
        {
          id: "widened-cmd",
          label: "Widened",
          group: "General",
          keys: ["w"],
          run: alsoInRun,
        },
      ],
      { alsoIn: [NOW_PLAYING_SCOPE] }
    );

    /** Pushes `NOW_PLAYING_SCOPE` for as long as it renders, as the sheet's own content does. */
    function InsideScope({ open }: { open: boolean }) {
      useCommandScope(NOW_PLAYING_SCOPE, undefined, open);
      return null;
    }

    const tree = (open: boolean, pushesScope = true) => (
      <CommandRegistry
        commands={[...COMMANDS, ...WIDENED]}
        context={STUB_CONTEXT}
      >
        <ModalScopeBridge>
          <TestSheet open={open}>
            <InsideScope open={open && pushesScope} />
          </TestSheet>
        </ModalScopeBridge>
      </CommandRegistry>
    );

    afterEach(() => {
      alsoInRun.mockClear();
      globalRun.mockClear();
    });

    it("answers the widened command and keeps a plain global command silent while open", () => {
      render(tree(true));

      press("w");
      press("g");

      expect(alsoInRun).toHaveBeenCalledTimes(1);
      expect(globalRun).not.toHaveBeenCalled();
    });

    it("answers both again once the sheet closes", () => {
      const { rerender } = render(tree(true));

      rerender(tree(false));
      press("w");
      press("g");

      expect(alsoInRun).toHaveBeenCalledTimes(1);
      expect(globalRun).toHaveBeenCalledTimes(1);
    });

    it("leaves the widened command silent while the sheet is open but its scope is not pushed", () => {
      render(tree(true, false));

      press("w");

      expect(alsoInRun).not.toHaveBeenCalled();
    });
  });
});
