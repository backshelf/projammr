import { describe, expect, it } from "bun:test";
import { SIDEBAR_COMMANDS } from "@/components/commands/sidebar";
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

describe("toggle-sidebar command", () => {
  const command = SIDEBAR_COMMANDS.find((c) => c.id === "toggle-sidebar")!;

  it("is in the General group, bound to mod+b", () => {
    expect(command.group).toBe("General");
    expect(command.keys).toContain("mod+b");
  });

  it("toggles the sidebar through the context", () => {
    let called = false;
    command.run(makeContext({ toggleSidebar: () => (called = true) }));
    expect(called).toBe(true);
  });
});
