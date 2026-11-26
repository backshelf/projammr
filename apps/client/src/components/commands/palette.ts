import {
  defineCommands,
  defineScope,
  GLOBAL,
} from "@/components/commands/define";
import { IconKeyboard } from "@tabler/icons-react";

/**
 * Pushed modal, above any dialog's scope, while the shortcuts overlay is open,
 * so the `?` that opened it closes it again.
 */
export const SHORTCUTS_SCOPE = defineScope("shortcuts");

export const KEYBOARD_SHORTCUTS_COMMAND_ID = "keyboard-shortcuts";

/** The palette's own keys and the shortcuts overlay's. */
export const PALETTE_COMMANDS = [
  ...defineCommands(GLOBAL, [
    {
      id: "command-palette",
      label: "Command palette",
      group: "General",
      keys: ["mod+k"],
      run: ({ palette }) => palette.setOpen(!palette.open),
    },
    {
      id: "search",
      label: "Search",
      group: "General",
      keys: ["/"],
      run: ({ palette }) => palette.setOpen(true),
    },
    {
      id: KEYBOARD_SHORTCUTS_COMMAND_ID,
      label: "Keyboard shortcuts",
      group: "Help",
      keys: ["?"],
      // A touchscreen has no keyboard to list.
      when: (ctx) => !ctx.coarsePointer,
      run: (ctx) => ctx.setShortcutsOpen((open) => !open),
      palette: { icon: IconKeyboard },
    },
  ]),
  ...defineCommands(SHORTCUTS_SCOPE, [
    {
      id: "close-keyboard-shortcuts",
      label: "Close keyboard shortcuts",
      group: "Help",
      keys: ["?"],
      run: (ctx) => ctx.setShortcutsOpen(false),
    },
  ]),
];
