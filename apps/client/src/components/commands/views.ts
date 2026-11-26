import { defineCommands, defineScope } from "@/components/commands/define";

/**
 * What a `ViewSwitcher`'s push of the `view` scope attaches: which surface the
 * page shows and the switch to the other one.
 */
export type ViewSurface = {
  current: "list" | "board";
  /** Switches to the view the page is not showing. */
  toggle: () => void;
};

export const VIEW_SCOPE = defineScope<ViewSurface>("view");

/** The keys of a page that offers both a list and a board. */
export const VIEW_COMMANDS = defineCommands(VIEW_SCOPE, [
  {
    id: "toggle-board-view",
    label: "Board or list",
    group: "Table",
    keys: ["b"],
    run: (ctx) => ctx.surface.toggle(),
  },
]);
