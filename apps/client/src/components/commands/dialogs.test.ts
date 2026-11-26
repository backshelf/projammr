import { describe, expect, it, mock } from "bun:test";
import { DIALOG_COMMANDS } from "@/components/commands/dialogs";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";

type DialogSurface = { confirm?: () => void };

function makeContext(
  surface: DialogSurface = {},
  overrides: Partial<ActionContext> = {}
): CommandContext<DialogSurface> {
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
    surface,
  };
}

const command = DIALOG_COMMANDS.find((c) => c.id === "confirm-dialog")!;

describe("confirm-dialog command", () => {
  it("is bound to mod+Enter, reachable while typing in the dialog", () => {
    expect(command.keys).toEqual(["mod+Enter"]);
    expect(command.allowInInput).toBe(true);
  });

  it("is available only while the surface has something to confirm", () => {
    expect(command.when!(makeContext({}))).toBe(false);
    expect(command.when!(makeContext({ confirm: () => {} }))).toBe(true);
  });

  it("runs the surface's confirm", () => {
    const confirm = mock();
    command.run(makeContext({ confirm }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the surface has no confirm to run", () => {
    expect(() => command.run(makeContext({}))).not.toThrow();
  });
});
