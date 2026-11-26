import { describe, expect, it, mock } from "bun:test";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";

const archiveTracks = mock();
const unarchiveTracks = mock();
mock.module("@/entities/track/archive", () => ({
  archiveTracks,
  unarchiveTracks,
}));
const toastActionResult = mock();
mock.module("@/lib/action-toast", () => ({ toastActionResult }));

const trackToPlayable = mock();
mock.module("@/components/music-player/play-track", () => ({
  trackToPlayable,
}));

const { TRACK_COMMANDS, playRouteTrack, routeTrackFrom } =
  await import("@/components/commands/tracks");

const UNDO_WINDOW_MS = 9000;

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
    undoWindowMs: UNDO_WINDOW_MS,
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

const archiveTrack = TRACK_COMMANDS.find((c) => c.id === "archive-track")!;
const unarchiveTrack = TRACK_COMMANDS.find((c) => c.id === "unarchive-track")!;

describe("routeTrackFrom", () => {
  const tracks = [
    { id: 5, title: "Low Tide", archived: true },
    { id: 6, title: "High Water", archived: false },
  ];

  it("is null off a track page", () => {
    expect(routeTrackFrom({ kind: "track-all" }, tracks)).toBeNull();
  });

  it("reads the route's track off the summaries", () => {
    expect(routeTrackFrom({ kind: "track", trackId: 5 }, tracks)).toEqual({
      id: 5,
      title: "Low Tide",
      archived: true,
    });
  });

  it("takes a track the summaries do not have yet to be live", () => {
    expect(routeTrackFrom({ kind: "track", trackId: 9 }, tracks)).toEqual({
      id: 9,
      archived: false,
    });
  });
});

describe("archive and unarchive track commands", () => {
  const liveTrack = { id: 5, title: "Low Tide", archived: false };
  const archivedTrack = { ...liveTrack, archived: true };
  const onTrackPage = (routeTrack: typeof liveTrack, canEdit: boolean) =>
    makeContext({
      projectId: 7,
      route: { kind: "track", trackId: routeTrack.id },
      routeTrack,
      canEdit,
    });

  it("offers an editor Archive track on a live track's page", () => {
    const ctx = onTrackPage(liveTrack, true);
    expect(archiveTrack.when!(ctx)).toBe(true);
    expect(unarchiveTrack.when!(ctx)).toBe(false);
  });

  it("offers an editor Unarchive track on an archived track's page", () => {
    const ctx = onTrackPage(archivedTrack, true);
    expect(unarchiveTrack.when!(ctx)).toBe(true);
    expect(archiveTrack.when!(ctx)).toBe(false);
  });

  it("offers a viewer neither command", () => {
    for (const track of [liveTrack, archivedTrack]) {
      const ctx = onTrackPage(track, false);
      expect(archiveTrack.when!(ctx)).toBe(false);
      expect(unarchiveTrack.when!(ctx)).toBe(false);
    }
  });

  it("offers neither off a track page", () => {
    const ctx = makeContext({
      projectId: 7,
      route: { kind: "track-all" },
      canEdit: true,
      routeTrack: null,
    });
    expect(archiveTrack.when!(ctx)).toBe(false);
    expect(unarchiveTrack.when!(ctx)).toBe(false);
  });

  it("archives the route's track by id with its title and toasts the result", async () => {
    archiveTracks.mockReset();
    toastActionResult.mockReset();
    const result = { ok: true, message: "Archived Low Tide" };
    archiveTracks.mockResolvedValue(result);
    const ctx = onTrackPage(liveTrack, true);

    await archiveTrack.run(ctx);

    expect(archiveTracks).toHaveBeenCalledWith({
      projectId: 7,
      selection: { ids: [5] },
      title: "Low Tide",
      router: ctx.router,
    });
    expect(toastActionResult).toHaveBeenCalledWith(result, UNDO_WINDOW_MS);
  });

  it("unarchives the route's track by id with its title and toasts the result", async () => {
    unarchiveTracks.mockReset();
    toastActionResult.mockReset();
    const result = { ok: false, message: "You need edit access" };
    unarchiveTracks.mockResolvedValue(result);
    const ctx = onTrackPage(archivedTrack, true);

    await unarchiveTrack.run(ctx);

    expect(unarchiveTracks).toHaveBeenCalledWith({
      projectId: 7,
      selection: { ids: [5] },
      title: "Low Tide",
      router: ctx.router,
    });
    expect(toastActionResult).toHaveBeenCalledWith(result, UNDO_WINDOW_MS);
  });

  it("binds `e` to Archive track and leaves Unarchive track keyless", () => {
    expect(archiveTrack.keys).toEqual(["e"]);
    expect(archiveTrack.repeatable).toBeUndefined();
    expect(unarchiveTrack.keys).toBeUndefined();
  });
});

describe("playRouteTrack", () => {
  const playCommand = TRACK_COMMANDS.find((c) => c.id === "play-this-track")!;

  it("plays the route's track now", async () => {
    trackToPlayable.mockReset();
    const items = [{ id: "a" }];
    trackToPlayable.mockResolvedValue(items);
    const playNow = mock();
    const playback = {} as ActionContext["playback"];
    const ctx = makeContext({
      route: { kind: "track", trackId: 5 },
      playback,
      playerActions: { playNow } as unknown as ActionContext["playerActions"],
    });

    await playRouteTrack(ctx);

    expect(trackToPlayable).toHaveBeenCalledWith(5, playback);
    expect(playNow).toHaveBeenCalledWith(items);
  });

  it("plays nothing when the track has no playable audio", async () => {
    trackToPlayable.mockReset();
    trackToPlayable.mockResolvedValue([]);
    const playNow = mock();

    await playRouteTrack(
      makeContext({
        route: { kind: "track", trackId: 5 },
        playerActions: { playNow } as unknown as ActionContext["playerActions"],
      })
    );

    expect(playNow).not.toHaveBeenCalled();
  });

  it("does nothing off a track page", async () => {
    trackToPlayable.mockReset();

    await playRouteTrack(makeContext({ route: { kind: "track-all" } }));

    expect(trackToPlayable).not.toHaveBeenCalled();
  });

  it("is what Play this track runs", () => {
    expect(playCommand.run).toBe(playRouteTrack);
  });
});
