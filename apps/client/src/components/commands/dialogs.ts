import { defineCommands, DIALOG_SCOPE } from "@/components/commands/define";

/** What an open dialog's `mod+Enter` confirms: a generic `Dialog`'s form, or
 *  whatever `AlertDialogContent` was given as its `confirm`. */
export const DIALOG_COMMANDS = [
  ...defineCommands(DIALOG_SCOPE, [
    {
      id: "confirm-dialog",
      label: "Confirm",
      group: "General",
      keys: ["mod+Enter"],
      allowInInput: true,
      when: (ctx) => !!ctx.surface.confirm,
      run: (ctx) => ctx.surface.confirm?.(),
    },
  ]),
];
