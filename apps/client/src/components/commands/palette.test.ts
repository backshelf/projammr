import { describe, expect, it } from "bun:test";
import {
  KEYBOARD_SHORTCUTS_COMMAND_ID,
  PALETTE_COMMANDS,
} from "@/components/commands/palette";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";

function makeContext(overrides: Partial<ActionContext> = {}): CommandContext {
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
    labSettings: {} as ActionContext["labSettings"],
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

describe("keyboard-shortcuts command", () => {
  const command = PALETTE_COMMANDS.find(
    (c) => c.id === KEYBOARD_SHORTCUTS_COMMAND_ID
  )!;

  it("is offered on every route, in the Help group", () => {
    expect(command.group).toBe("Help");
    expect(command.when!(makeContext())).toBe(true);
  });

  it("is unavailable on a coarse pointer, which has no keyboard to show shortcuts for", () => {
    expect(command.when!(makeContext({ coarsePointer: true }))).toBe(false);
  });

  it("is available on a fine pointer", () => {
    expect(command.when!(makeContext({ coarsePointer: false }))).toBe(true);
  });

  it("opens the shortcuts overlay through the context, not a fetch or a route change", () => {
    let open = false;
    command.run(
      makeContext({
        setShortcutsOpen: (update) => {
          open =
            typeof update === "function"
              ? (update as (previous: boolean) => boolean)(open)
              : update;
        },
      })
    );
    expect(open).toBe(true);
  });
});
