import { defineCommands, defineScope } from "@/components/commands/define";

/**
 * What the peek panel's push attaches: its own step through the loaded
 * page's rows, distinct from the table's cursor beneath it. Pushed only
 * while the panel shows a row, so its arrows outrank the global player seek
 * arrows for as long as the peek is open.
 */
export type PeekSurface = {
  previous?: () => void;
  next?: () => void;
  /** Whether `next` is loading the next page before it can step. */
  nextLoading: boolean;
};

export const PEEK_SCOPE = defineScope<PeekSurface>("peek");

/** The peek panel's row-to-row step. */
export const PEEK_COMMANDS = defineCommands(PEEK_SCOPE, [
  {
    id: "peek-previous",
    label: "Previous row",
    group: "Table",
    keys: ["ArrowLeft", "k"],
    when: (ctx) => ctx.surface.previous !== undefined,
    run: (ctx) => ctx.surface.previous?.(),
  },
  {
    id: "peek-next",
    label: "Next row",
    group: "Table",
    keys: ["ArrowRight", "j"],
    when: (ctx) => ctx.surface.next !== undefined && !ctx.surface.nextLoading,
    run: (ctx) => ctx.surface.next?.(),
  },
]);
