import { defineCommands, defineScope } from "@/components/commands/define";

/**
 * Live while a command bar is on screen, which is what gives `:` its meaning:
 * with the bar off, on the other edge or on a phone, nothing pushes it.
 */
export const COMMAND_BAR_SCOPE = defineScope<{
  /** Opens the bar's prompt. */
  openPrompt: () => void;
}>("command-bar");

/**
 * Pushed modal while the bar's prompt is open, so the keys a line is typed
 * with reach the input instead of firing commands beneath it. It declares no
 * commands of its own; the prompt closes itself on Escape.
 */
export const COMMAND_PROMPT_SCOPE = defineScope("command-prompt");

/** The command bar's own key. */
export const COMMAND_BAR_COMMANDS = defineCommands(COMMAND_BAR_SCOPE, [
  {
    id: "command-prompt",
    label: "Command prompt",
    group: "General",
    keys: [":"],
    run: ({ surface }) => surface.openPrompt(),
  },
]);
