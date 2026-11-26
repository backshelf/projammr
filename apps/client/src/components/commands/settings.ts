import { defineCommands, GLOBAL } from "@/components/commands/define";
import { IconSun } from "@tabler/icons-react";

/** The viewer's own preferences. Signed out, the ui theme provider binds `d`
 *  itself: there is no registry there. */
export const SETTINGS_COMMANDS = defineCommands(GLOBAL, [
  {
    id: "toggle-theme",
    label: "Toggle theme",
    group: "General",
    keys: ["d"],
    run: (ctx) => ctx.setTheme(ctx.resolvedTheme === "dark" ? "light" : "dark"),
    palette: { icon: IconSun },
  },
]);
