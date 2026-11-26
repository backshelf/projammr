import {
  defineCommands,
  defineScope,
  GLOBAL,
  NOW_PLAYING_SCOPE,
} from "@/components/commands/define";
import type { ActionContext } from "@/components/commands/types";
import { IconPlaylist } from "@tabler/icons-react";

/**
 * What the queue list's push attaches: the cursor's moves over the upcoming
 * entries, each `null` when there is nothing for it to act on. Pushed while
 * the list is mounted.
 */
export type QueueSurface = {
  next: (() => void) | null;
  previous: (() => void) | null;
  remove: (() => void) | null;
  jump: (() => void) | null;
};

export const QUEUE_SCOPE = defineScope<QueueSurface>("queue");

/** Opens the now-playing sheet on its queue view, or closes it if the sheet
 *  is already showing that view. */
function toggleQueueView({ nowPlaying }: ActionContext) {
  if (nowPlaying.open && nowPlaying.view === "queue") {
    nowPlaying.setOpen(false);
    return;
  }
  nowPlaying.setView("queue");
  nowPlaying.setOpen(true);
}

export const QUEUE_COMMANDS = [
  ...defineCommands(
    GLOBAL,
    [
      {
        id: "show-queue",
        label: "Show queue",
        group: "Queue",
        keys: ["q"],
        run: toggleQueueView,
        palette: { icon: IconPlaylist },
      },
    ],
    { alsoIn: [NOW_PLAYING_SCOPE] }
  ),
  ...defineCommands(QUEUE_SCOPE, [
    {
      id: "queue-next",
      label: "Next queue entry",
      group: "Queue",
      keys: ["j"],
      when: (ctx) => ctx.surface.next !== null,
      run: (ctx) => ctx.surface.next?.(),
    },
    {
      id: "queue-previous",
      label: "Previous queue entry",
      group: "Queue",
      keys: ["k"],
      when: (ctx) => ctx.surface.previous !== null,
      run: (ctx) => ctx.surface.previous?.(),
    },
    {
      id: "queue-remove",
      label: "Remove from queue",
      group: "Queue",
      keys: ["x"],
      when: (ctx) => ctx.surface.remove !== null,
      run: (ctx) => ctx.surface.remove?.(),
    },
    {
      id: "queue-jump",
      label: "Play queue entry",
      group: "Queue",
      keys: ["Enter"],
      when: (ctx) => ctx.surface.jump !== null,
      run: (ctx) => ctx.surface.jump?.(),
    },
  ]),
];
