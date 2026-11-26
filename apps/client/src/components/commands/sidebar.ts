import { defineCommands, GLOBAL } from "@/components/commands/define";

export const SIDEBAR_COMMANDS = defineCommands(GLOBAL, [
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    group: "General",
    keys: ["mod+b"],
    run: (ctx) => ctx.toggleSidebar(),
  },
]);
