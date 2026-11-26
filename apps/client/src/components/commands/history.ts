import { defineCommands, GLOBAL } from "@/components/commands/define";
import { hasUndo, undoLast } from "@/lib/action-toast";

export const HISTORY_COMMANDS = defineCommands(GLOBAL, [
  {
    id: "undo",
    label: "Undo",
    group: "General",
    keys: ["u"],
    when: () => hasUndo(),
    run: () => undoLast(),
  },
  {
    id: "repeat-last-command",
    label: "Repeat last command",
    group: "General",
    keys: ["."],
    run: (ctx) => ctx.repeatLast(),
  },
]);
