import {
  defineCommands,
  GLOBAL,
  NOW_PLAYING_SCOPE,
  type CommandSpec,
} from "@/components/commands/define";
import { playRouteTrack } from "@/components/commands/tracks";
import type { ActionContext } from "@/components/commands/types";
import { seekStep } from "@/lib/policies/playback";
import { IconPlayerTrackNext } from "@tabler/icons-react";
import type { Combo } from "@workspace/ui/lib/keymap";

/**
 * Moves the loaded track by the playback policy's step: the small one is a
 * nudge, for finding the phrase you just missed; the large one a stride, for
 * skipping a verse. The position is read at the press, never subscribed to.
 */
function seekBy(direction: 1 | -1, large: boolean) {
  return (ctx: ActionContext) => {
    const { current, duration } = ctx.player.getSnapshot();
    if (!current) return;

    const seconds = direction * seekStep(ctx.playback, large);
    const target = Math.max(0, ctx.player.getProgress() + seconds);
    ctx.playerActions.seek(duration > 0 ? Math.min(target, duration) : target);
  };
}

/** How far one press moves the volume or the speed. The sliders step by
 *  hundredths, which is too fine for a key held down. */
const KEY_STEP = 0.05;

/** Rounds away the float drift a repeated step accumulates (`0.3 + 0.01`). */
const hundredths = (value: number) => Math.round(value * 100) / 100;

/** Steps the volume; the store clamps it. */
function stepVolume(direction: 1 | -1) {
  return (ctx: ActionContext) => {
    const { volume } = ctx.player.getSnapshot().prefs;
    ctx.playerActions.setVolume(hundredths(volume + direction * KEY_STEP));
  };
}

/** Steps the speed; the store clamps it. */
function stepSpeed(direction: 1 | -1) {
  return (ctx: ActionContext) =>
    ctx.playerActions.setSpeed(
      hundredths(ctx.labSettings.speed + direction * KEY_STEP)
    );
}

/** Opens the now-playing sheet on the player pane, or closes it. */
function toggleNowPlaying({ nowPlaying }: ActionContext) {
  if (nowPlaying.open) {
    nowPlaying.setOpen(false);
    return;
  }
  nowPlaying.setView("player");
  nowPlaying.setOpen(true);
}

const TENTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** `0`-`9` seek to that tenth of the loaded track. Each yields to a count
 *  being built, so `5j` on a list moves five rows rather than seeking. */
const seekToTenthCommands: CommandSpec<undefined>[] = TENTHS.map((tenth) => ({
  id: `seek-to-${tenth}`,
  label: `Seek to ${tenth * 10}%`,
  group: "Playback",
  keys: [`${tenth}` as Combo],
  yieldsToCount: true,
  when: (ctx) => ctx.currentTrack !== null && ctx.duration > 0,
  run: (ctx) => {
    const { current, duration } = ctx.player.getSnapshot();
    if (current && duration > 0)
      ctx.playerActions.seek((duration * tenth) / 10);
  },
  palette: { icon: IconPlayerTrackNext, hidden: true },
}));

/** Transport and queue for whatever is loaded. */
export const PLAYER_COMMANDS = defineCommands(
  GLOBAL,
  [
    {
      id: "play-pause",
      label: "Play / pause",
      group: "Playback",
      keys: ["space"],
      run: async (ctx) => {
        if (ctx.player.getSnapshot().current) ctx.playerActions.togglePlay();
        else await playRouteTrack(ctx);
      },
    },
    {
      id: "seek-back",
      label: "Seek back",
      group: "Playback",
      keys: ["ArrowLeft"],
      run: seekBy(-1, false),
    },
    {
      id: "seek-forward",
      label: "Seek forward",
      group: "Playback",
      keys: ["ArrowRight"],
      run: seekBy(1, false),
    },
    {
      id: "jump-back",
      label: "Jump back",
      group: "Playback",
      keys: ["shift+ArrowLeft"],
      run: seekBy(-1, true),
    },
    {
      id: "jump-forward",
      label: "Jump forward",
      group: "Playback",
      keys: ["shift+ArrowRight"],
      run: seekBy(1, true),
    },
    {
      id: "next-in-queue",
      label: "Next in queue",
      group: "Playback",
      keys: ["]"],
      run: (ctx) => ctx.playerActions.next(),
    },
    {
      id: "previous-in-queue",
      label: "Previous in queue",
      group: "Playback",
      keys: ["["],
      run: (ctx) => ctx.playerActions.prev(),
    },
    {
      id: "mute",
      label: "Mute",
      group: "Playback",
      keys: ["m"],
      run: (ctx) => ctx.playerActions.toggleMute(),
    },
    {
      id: "volume-down",
      label: "Volume down",
      group: "Playback",
      keys: ["-"],
      when: (ctx) => ctx.currentTrack !== null,
      run: stepVolume(-1),
    },
    {
      id: "volume-up",
      label: "Volume up",
      group: "Playback",
      keys: ["="],
      when: (ctx) => ctx.currentTrack !== null,
      run: stepVolume(1),
    },
    {
      id: "speed-down",
      label: "Speed down",
      group: "Playback",
      keys: ["<"],
      when: (ctx) => ctx.currentTrack !== null,
      run: stepSpeed(-1),
    },
    {
      id: "speed-up",
      label: "Speed up",
      group: "Playback",
      keys: [">"],
      when: (ctx) => ctx.currentTrack !== null,
      run: stepSpeed(1),
    },
    {
      id: "toggle-now-playing",
      label: "Toggle the now-playing sheet",
      group: "Playback",
      keys: ["p"],
      when: (ctx) => ctx.currentTrack !== null,
      run: toggleNowPlaying,
    },
    {
      id: "toggle-shuffle",
      label: "Toggle shuffle",
      group: "Playback",
      keys: ["shift+s"],
      run: (ctx) => ctx.playerActions.toggleShuffle(),
    },
    {
      id: "cycle-repeat",
      label: "Cycle repeat",
      group: "Playback",
      keys: ["shift+r"],
      run: (ctx) => ctx.playerActions.cycleRepeat(),
    },
    ...seekToTenthCommands,
  ],
  { alsoIn: [NOW_PLAYING_SCOPE] }
);
