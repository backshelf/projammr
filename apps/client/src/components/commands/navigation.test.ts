import { describe, expect, it, mock } from "bun:test";
import { NAVIGATION_COMMANDS } from "@/components/commands/navigation";
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

const command = (id: string) => NAVIGATION_COMMANDS.find((c) => c.id === id)!;

describe.each([
  ["go-to-project", "/project/7"],
  ["go-to-collections", "/project/7/collection/all"],
  ["go-to-tracks", "/project/7/track/all"],
  ["go-to-sessions", "/project/7/session/all"],
])("%s command", (id, href) => {
  it("is available only inside a project", () => {
    expect(command(id).when!(makeContext({ projectId: null }))).toBe(false);
    expect(
      command(id).when!(
        makeContext({ projectId: 7, route: { kind: "project" } })
      )
    ).toBe(true);
  });

  it("pushes its route's href", () => {
    const push = mock();
    command(id).run(
      makeContext({
        projectId: 7,
        router: { push } as unknown as ActionContext["router"],
      })
    );
    expect(push).toHaveBeenCalledWith(href);
  });
});

describe("go-to-archived-tracks command", () => {
  it("is offered to every role in a project, on any page", () => {
    expect(
      command("go-to-archived-tracks").when!(
        makeContext({ projectId: 7, route: { kind: "project" } })
      )
    ).toBe(true);
    expect(
      command("go-to-archived-tracks").when!(
        makeContext({
          projectId: 7,
          route: { kind: "track", trackId: 5 },
          routeTrack: { id: 5, title: "Low Tide", archived: true },
          canEdit: true,
        })
      )
    ).toBe(true);
  });

  it("is not offered outside a project", () => {
    expect(
      command("go-to-archived-tracks").when!(makeContext({ projectId: null }))
    ).toBe(false);
  });

  it("pushes the archived tracks route's href", () => {
    const push = mock();
    command("go-to-archived-tracks").run(
      makeContext({
        projectId: 7,
        router: { push } as unknown as ActionContext["router"],
      })
    );
    expect(push).toHaveBeenCalledWith("/project/7/track/archived");
  });
});

describe.each([
  ["go-to-archived-tracks", "g a"],
  ["go-to-samples", "g l"],
  ["go-to-plugins", "g u"],
])("%s command", (id, chord) => {
  it(`is bound to ${chord}`, () => {
    expect(command(id).keys).toEqual([chord]);
  });
});

describe("go-to-settings command", () => {
  it("has no gate: available everywhere", () => {
    expect(command("go-to-settings").when).toBeUndefined();
  });

  it("opens the settings hub from a page with no project", () => {
    const push = mock();
    command("go-to-settings").run(
      makeContext({ router: { push } as unknown as ActionContext["router"] })
    );
    expect(push).toHaveBeenCalledWith("/settings/personal");
  });
});

describe("binds a project's own pages only inside one", () => {
  it("gates go-to-tracks's g t binding on being inside a project", () => {
    const outside = makeContext({ projectId: null });
    const inside = makeContext({ projectId: 7, route: { kind: "project" } });
    expect(command("go-to-tracks").when!(outside)).toBe(false);
    expect(command("go-to-tracks").when!(inside)).toBe(true);
    expect(command("go-to-tracks").keys).toContain("g t");
  });

  it("leaves go-to-notebook bound and available with no project", () => {
    expect(command("go-to-notebook").when).toBeUndefined();
    expect(command("go-to-notebook").keys).toContain("g n");
  });
});
