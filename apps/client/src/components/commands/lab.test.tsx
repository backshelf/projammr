import {
  defineCommands,
  GLOBAL,
  NOW_PLAYING_SCOPE,
} from "@/components/commands/define";
import {
  CommandRegistry,
  ModalScopeBridge,
  useCommandScope,
} from "@/components/commands/provider";
import { LAB_COMMANDS, TRACK_AUDIO_SCOPE } from "@/components/commands/lab";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";
import type { CompareState } from "@/components/music-player/player-store";
import { DEFAULT_LAB } from "@/lib/dsp/lab-settings";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@workspace/ui/components/sheet";

function makeActionContext(
  overrides: Partial<ActionContext> = {}
): CommandContext {
  return {
    router: {} as ActionContext["router"],
    pathname: "/project/1",
    projectId: null,
    route: { kind: "not-found" },
    resolvedTheme: "light",
    setTheme: () => {},
    player: {} as ActionContext["player"],
    playerActions: {} as ActionContext["playerActions"],
    currentTrack: null,
    duration: 0,
    coarsePointer: false,
    setShortcutsOpen: () => {},
    palette: {} as ActionContext["palette"],
    nowPlaying: {} as ActionContext["nowPlaying"],
    labSettings: DEFAULT_LAB,
    openLab: () => {},
    canEdit: false,
    routeTrack: null,
    undoWindowMs: 9000,
    resultCap: 20,
    formatters: {} as ActionContext["formatters"],
    playback: {} as ActionContext["playback"],
    toggleSidebar: () => {},
    ...overrides,
    count: 1,
    repeatLast: () => {},
    surface: undefined,
  };
}

/**
 * Mono and dim sit on the `h` chord rather than `shift+m`/`shift+d`: under
 * the grammar, an uppercase letter reads as `shift+<letter>` off the key
 * value (`packages/ui/src/lib/keymap/parse.ts`), so `shift+M` is the distinct
 * combo `shift+m`, not the same combo as a bare `m` — moved from the Lab's
 * old, now-deleted hotkeys test file.
 */
function makeContext(): ActionContext {
  const setAudition = mock();
  return {
    playerActions: { setAudition },
    player: { getSnapshot: () => ({ lab: { settings: DEFAULT_LAB } }) },
  } as unknown as ActionContext;
}

afterEach(cleanup);

function press(key: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...options }));
}

describe("LAB_COMMANDS", () => {
  it("toggles mono on h m and dim on h d", () => {
    const context = makeContext();
    render(
      <CommandRegistry commands={LAB_COMMANDS} context={context}>
        {null}
      </CommandRegistry>
    );

    press("h");
    press("m");
    expect(context.playerActions.setAudition).toHaveBeenCalledTimes(1);
    expect(context.playerActions.setAudition).toHaveBeenLastCalledWith({
      stereo: "mono",
    });

    press("h");
    press("d");
    expect(context.playerActions.setAudition).toHaveBeenCalledTimes(2);
    expect(context.playerActions.setAudition).toHaveBeenLastCalledWith({
      dim: true,
    });
  });

  it("never fires from shift+m or shift+d, distinct combos under the grammar rather than the same as a bare m or d", () => {
    const context = makeContext();
    render(
      <CommandRegistry commands={LAB_COMMANDS} context={context}>
        {null}
      </CommandRegistry>
    );

    press("M", { shiftKey: true });
    press("D", { shiftKey: true });

    expect(context.playerActions.setAudition).not.toHaveBeenCalled();
  });
});

describe("toggle-lab under the now-playing sheet", () => {
  type View = "player" | "queue" | "lab";

  /** The sheet's state and the scope its content pushes, as `NowPlaying` wires
   *  them, with the Lab's and the page's commands beside a page-only key. With
   *  `swapCompare`, the page also has a track's Audio section comparing. */
  function Harness({
    pageRun,
    swapCompare,
  }: {
    pageRun: () => void;
    swapCompare?: () => void;
  }) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<View>("player");
    const context = {
      nowPlaying: { open, setOpen, view, setView },
      playerActions: { swapCompare },
    } as unknown as ActionContext;
    const page = defineCommands(GLOBAL, [
      {
        id: "page-key",
        label: "Page",
        group: "General",
        keys: ["e"],
        run: pageRun,
      },
    ]);
    return (
      <CommandRegistry commands={[...LAB_COMMANDS, ...page]} context={context}>
        <span data-testid="state">{open ? view : "closed"}</span>
        {swapCompare && <Comparing />}
        <ModalScopeBridge>
          <Sheet open={open}>
            <SheetContent>
              <SheetTitle>Now playing</SheetTitle>
              <InsideScope open={open} />
            </SheetContent>
          </Sheet>
        </ModalScopeBridge>
      </CommandRegistry>
    );
  }

  function InsideScope({ open }: { open: boolean }) {
    useCommandScope(NOW_PLAYING_SCOPE, undefined, open);
    return null;
  }

  const READY = { comparing: { phase: "ready" } as CompareState };

  /** A track page's Audio section with a comparison ready to swap. */
  function Comparing() {
    useCommandScope(TRACK_AUDIO_SCOPE, READY, true);
    return null;
  }

  it("opens the sheet on the Lab, then returns it to the player on the second press", () => {
    render(<Harness pageRun={() => {}} />);

    act(() => press("l"));
    expect(screen.getByTestId("state").textContent).toBe("lab");

    act(() => press("l"));
    expect(screen.getByTestId("state").textContent).toBe("player");
  });

  it("keeps a page key silent while the sheet is open", () => {
    const pageRun = mock();
    render(<Harness pageRun={pageRun} />);

    act(() => press("l"));
    act(() => press("e"));

    expect(pageRun).not.toHaveBeenCalled();
  });

  it("swaps the track page's comparison from inside the sheet", () => {
    const swapCompare = mock();
    render(<Harness pageRun={() => {}} swapCompare={swapCompare} />);

    // The page's push lands before the sheet opens, beneath its modal.
    act(() => press("l"));
    act(() => press("v"));

    expect(swapCompare).toHaveBeenCalledTimes(1);
  });
});

describe("open-lab command", () => {
  const command = LAB_COMMANDS.find((c) => c.id === "open-lab")!;
  const CURRENT_TRACK = { asset: { id: 1 } } as ActionContext["currentTrack"];

  it("needs a loaded track", () => {
    expect(command.when!(makeActionContext({ currentTrack: null }))).toBe(
      false
    );
    expect(
      command.when!(makeActionContext({ currentTrack: CURRENT_TRACK }))
    ).toBe(true);
  });

  it("opens the Lab through the context, not a route change", () => {
    let opened = false;
    command.run(makeActionContext({ openLab: () => (opened = true) }));
    expect(opened).toBe(true);
  });
});
