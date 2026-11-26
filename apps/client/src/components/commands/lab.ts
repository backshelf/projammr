import {
  defineCommands,
  defineScope,
  GLOBAL,
  NOW_PLAYING_SCOPE,
} from "@/components/commands/define";
import type { ActionContext } from "@/components/commands/types";
import type { CompareState } from "@/components/music-player/player-store";
import {
  toggleLabAudition,
  type LabAuditionKey,
} from "@/lib/dsp/lab-auditions";
import { IconFlask } from "@tabler/icons-react";

/** A track's Audio section while it shows the compare controls. */
export const TRACK_AUDIO_SCOPE = defineScope<{
  /** The comparison, when its A side is the selected version. */
  comparing: CompareState | null;
}>("track-audio");

/** Opens the sheet on the Lab view, or leaves it for the player pane if the
 *  sheet is already showing it. */
function toggleLabView({ nowPlaying }: ActionContext) {
  if (!nowPlaying.open) {
    nowPlaying.setView("lab");
    nowPlaying.setOpen(true);
    return;
  }
  nowPlaying.setView(nowPlaying.view === "lab" ? "player" : "lab");
}

function toggleAudition(key: LabAuditionKey) {
  return (ctx: ActionContext) =>
    ctx.playerActions.setAudition(
      toggleLabAudition(ctx.player.getSnapshot().lab.settings, key)
    );
}

/**
 * The Lab's keys. Mono and dim sit on an `h` chord (for "Hear it as", the
 * section they live in) rather than `shift+m` and `shift+d`, a stretch of the
 * hand away from the `m` and `d` they would sit beside.
 */
export const LAB_COMMANDS = [
  ...defineCommands(
    GLOBAL,
    [
      {
        id: "toggle-lab",
        label: "Toggle the Lab",
        group: "Lab",
        keys: ["l"],
        run: toggleLabView,
      },
      {
        id: "toggle-mono",
        label: "Toggle mono",
        group: "Lab",
        keys: ["h m"],
        run: toggleAudition("mono"),
      },
      {
        id: "toggle-dim",
        label: "Toggle dim",
        group: "Lab",
        keys: ["h d"],
        run: toggleAudition("dim"),
      },
      {
        id: "open-lab",
        label: "Open the Lab",
        group: "Lab",
        when: (ctx) => ctx.currentTrack !== null,
        run: (ctx) => ctx.openLab(),
        palette: { icon: IconFlask },
      },
    ],
    { alsoIn: [NOW_PLAYING_SCOPE] }
  ),
  // The sheet's Lab shows the compare a track page started, so `v` swaps it
  // from inside the now-playing sheet too; its surface is still the page's push.
  ...defineCommands(
    TRACK_AUDIO_SCOPE,
    [
      {
        id: "swap-compare",
        label: "Swap A/B",
        group: "Lab",
        keys: ["v"],
        when: (ctx) => ctx.surface.comparing?.phase === "ready",
        run: (ctx) => ctx.playerActions.swapCompare(),
      },
    ],
    { alsoIn: [NOW_PLAYING_SCOPE] }
  ),
];
