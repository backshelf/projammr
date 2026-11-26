import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";
import { describe, expect, it, mock } from "bun:test";

const trackToPlayable = mock();
mock.module("@/components/music-player/play-track", () => ({
  trackToPlayable,
}));

const { PLAYER_COMMANDS } = await import("@/components/commands/player");

const TRACK = { id: 1 } as unknown as NonNullable<
  ActionContext["currentTrack"]
>;

function makeContext(overrides: Record<string, unknown> = {}): CommandContext {
  return {
    player: {
      getSnapshot: () => ({
        current: TRACK,
        duration: 200,
        prefs: { volume: 0.5 },
      }),
    },
    playerActions: {},
    currentTrack: TRACK,
    duration: 200,
    labSettings: { speed: 1 },
    nowPlaying: {},
    ...overrides,
    count: 1,
    surface: undefined,
  } as unknown as CommandContext;
}

const command = (id: string) => PLAYER_COMMANDS.find((c) => c.id === id)!;

describe("play-pause command", () => {
  const ITEMS = [{ id: "a" }];
  const onTrackPage = { route: { kind: "track", trackId: 9 } };
  const nothingLoaded = (overrides: Record<string, unknown> = {}) =>
    makeContext({
      player: { getSnapshot: () => ({ current: null }) },
      ...overrides,
    });

  it("toggles playback when something is loaded", async () => {
    trackToPlayable.mockReset();
    const togglePlay = mock();
    const playNow = mock();
    await command("play-pause").run(
      makeContext({ ...onTrackPage, playerActions: { togglePlay, playNow } })
    );
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(playNow).not.toHaveBeenCalled();
    expect(trackToPlayable).not.toHaveBeenCalled();
  });

  it("plays the route's track when nothing is loaded on a track page", async () => {
    trackToPlayable.mockReset();
    trackToPlayable.mockResolvedValue(ITEMS);
    const togglePlay = mock();
    const playNow = mock();
    const playback = { seekStep: 5 };
    await command("play-pause").run(
      nothingLoaded({
        ...onTrackPage,
        playback,
        playerActions: { togglePlay, playNow },
      })
    );
    expect(trackToPlayable).toHaveBeenCalledWith(9, playback);
    expect(playNow).toHaveBeenCalledWith(ITEMS);
    expect(togglePlay).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is loaded off a track page", async () => {
    trackToPlayable.mockReset();
    const togglePlay = mock();
    const playNow = mock();
    await command("play-pause").run(
      nothingLoaded({
        route: { kind: "track-all" },
        playerActions: { togglePlay, playNow },
      })
    );
    expect(trackToPlayable).not.toHaveBeenCalled();
    expect(playNow).not.toHaveBeenCalled();
    expect(togglePlay).not.toHaveBeenCalled();
  });
});

describe("volume commands", () => {
  it("steps the volume down and up by five percent", () => {
    const setVolume = mock();
    const ctx = makeContext({ playerActions: { setVolume } });
    command("volume-down").run(ctx);
    command("volume-up").run(ctx);
    expect(setVolume).toHaveBeenNthCalledWith(1, 0.45);
    expect(setVolume).toHaveBeenNthCalledWith(2, 0.55);
  });

  it("is unavailable with nothing loaded", () => {
    const ctx = makeContext({ currentTrack: null });
    expect(command("volume-down").when!(ctx)).toBe(false);
    expect(command("volume-up").when!(ctx)).toBe(false);
  });
});

describe("speed commands", () => {
  it("steps the speed down and up by five percent", () => {
    const setSpeed = mock();
    const ctx = makeContext({ playerActions: { setSpeed } });
    command("speed-down").run(ctx);
    command("speed-up").run(ctx);
    expect(setSpeed).toHaveBeenNthCalledWith(1, 0.95);
    expect(setSpeed).toHaveBeenNthCalledWith(2, 1.05);
  });

  it("is unavailable with nothing loaded", () => {
    const ctx = makeContext({ currentTrack: null });
    expect(command("speed-down").when!(ctx)).toBe(false);
    expect(command("speed-up").when!(ctx)).toBe(false);
  });
});

describe("shuffle and repeat commands", () => {
  it("toggles shuffle on shift+s and cycles repeat on shift+r", () => {
    const toggleShuffle = mock();
    const cycleRepeat = mock();
    const ctx = makeContext({ playerActions: { toggleShuffle, cycleRepeat } });
    command("toggle-shuffle").run(ctx);
    command("cycle-repeat").run(ctx);
    expect(command("toggle-shuffle").keys).toEqual(["shift+s"]);
    expect(command("cycle-repeat").keys).toEqual(["shift+r"]);
    expect(toggleShuffle).toHaveBeenCalledTimes(1);
    expect(cycleRepeat).toHaveBeenCalledTimes(1);
  });
});

describe("toggle-now-playing command", () => {
  it("opens the sheet on the player pane when it is closed", () => {
    const setOpen = mock();
    const setView = mock();
    command("toggle-now-playing").run(
      makeContext({ nowPlaying: { open: false, setOpen, setView } })
    );
    expect(setView).toHaveBeenCalledWith("player");
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("closes the sheet when it is open", () => {
    const setOpen = mock();
    const setView = mock();
    command("toggle-now-playing").run(
      makeContext({ nowPlaying: { open: true, setOpen, setView } })
    );
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(setView).not.toHaveBeenCalled();
  });

  it("is unavailable with nothing loaded", () => {
    expect(
      command("toggle-now-playing").when!(makeContext({ currentTrack: null }))
    ).toBe(false);
  });
});

describe("seek-to-tenth commands", () => {
  const tenths = PLAYER_COMMANDS.filter((c) => c.id.startsWith("seek-to-"));

  it("declares one command per digit, each yielding to a count", () => {
    expect(tenths.map((c) => c.keys)).toEqual(
      Array.from({ length: 10 }, (_, i) => [`${i}`])
    );
    expect(tenths.every((c) => c.yieldsToCount === true)).toBe(true);
    expect(tenths.every((c) => c.palette?.hidden === true)).toBe(true);
  });

  it("labels each with its percentage", () => {
    expect(command("seek-to-3").label).toBe("Seek to 30%");
  });

  it("seeks to that tenth of the duration", () => {
    const seek = mock();
    const ctx = makeContext({ playerActions: { seek } });
    command("seek-to-0").run(ctx);
    command("seek-to-3").run(ctx);
    command("seek-to-9").run(ctx);
    expect(seek.mock.calls).toEqual([[0], [60], [180]]);
  });

  it("is unavailable with nothing loaded or no known duration", () => {
    const cmd = command("seek-to-5");
    expect(cmd.when!(makeContext({ currentTrack: null }))).toBe(false);
    expect(cmd.when!(makeContext({ duration: 0 }))).toBe(false);
    expect(cmd.when!(makeContext())).toBe(true);
  });
});
