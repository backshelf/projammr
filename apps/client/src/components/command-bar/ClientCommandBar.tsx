"use client";

import { useBarPrompt } from "@/components/command-bar/use-bar-prompt";
import {
  COMMAND_BAR_SCOPE,
  COMMAND_PROMPT_SCOPE,
} from "@/components/commands/command-bar";
import { KEYBOARD_SHORTCUTS_COMMAND_ID } from "@/components/commands/palette";
import {
  useActionContext,
  useCommands,
  useCommandScope,
  useKeymapState,
  useShortcutsOverlay,
} from "@/components/commands/provider";
import { useShellPolicy } from "@/lib/policies/provider";
import {
  CommandBar,
  CommandHint,
  type CommandBarCommand,
} from "@workspace/ui/components/command-bar/command-bar";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { GLOBAL_SCOPE } from "@workspace/ui/lib/keymap";
import { useCallback, useMemo, useState } from "react";

/**
 * The keys a press would run now, innermost scope first and the global scope
 * last. The keymap's candidates already leave out what is unavailable and what
 * a modal scope silences, so they decide which commands show; the registry
 * supplies each one's scope and its live keys. The shortcuts overlay's own key
 * is the bar's trailing hint, not a row.
 */
function barCommands(
  listed: ReturnType<typeof useCommands>,
  state: ReturnType<typeof useKeymapState>
): CommandBarCommand[] {
  const runnable = new Set(state.candidates.map((candidate) => candidate.id));
  const depth = (scope: string | undefined) =>
    state.scope.lastIndexOf(scope ?? GLOBAL_SCOPE);

  return listed
    .filter(
      (command) =>
        command.keys.length > 0 &&
        command.id !== KEYBOARD_SHORTCUTS_COMMAND_ID &&
        runnable.has(command.id)
    )
    .toSorted((a, b) => depth(b.scope) - depth(a.scope));
}

/**
 * The desktop command bar: the shell policy says whether it shows, on which
 * edge and when, and it names the keys that matter on this page. The layout
 * mounts one at each `edge` and only the one matching the live policy's
 * position renders, so a change in the hub moves it without a server render.
 * Below the `md` breakpoint the dock and the palette are the way around, so it
 * renders nothing there.
 */
export function ClientCommandBar({ edge }: { edge: "top" | "bottom" }) {
  const { enabled, position, mode } = useShellPolicy().commandBar;
  const isMobile = useIsMobile();

  if (!enabled || isMobile || position !== edge) return null;

  return <MountedCommandBar position={position} mode={mode} />;
}

/**
 * The bar that renders. It alone pushes the command-bar scope, so `:` opens a
 * prompt only where a bar is on screen, and it owns the prompt's line.
 */
function MountedCommandBar({
  position,
  mode,
}: {
  position: "top" | "bottom";
  mode: "always" | "pending";
}) {
  const { paletteAliases } = useShellPolicy();
  const state = useKeymapState();
  const commands = useCommands();
  const ctx = useActionContext();
  const { setOpen } = useShortcutsOverlay();
  const [promptOpen, setPromptOpen] = useState(false);
  const [line, setLine] = useState("");

  const openPrompt = useCallback(() => setPromptOpen(true), []);
  const surface = useMemo(() => ({ openPrompt }), [openPrompt]);
  useCommandScope(COMMAND_BAR_SCOPE, surface, true);
  useCommandScope(COMMAND_PROMPT_SCOPE, undefined, promptOpen, { modal: true });

  const close = useCallback(() => {
    setPromptOpen(false);
    setLine("");
  }, []);
  const { suggestions, onClose } = useBarPrompt({
    value: line,
    setValue: setLine,
    close,
    ctx,
    aliases: paletteAliases,
  });

  const shortcutKeys =
    commands.find((command) => command.id === KEYBOARD_SHORTCUTS_COMMAND_ID)
      ?.keys ?? [];

  return (
    <CommandBar
      state={state}
      commands={barCommands(commands, state)}
      position={position}
      mode={mode}
      prompt={{
        open: promptOpen,
        value: line,
        onChange: setLine,
        suggestions,
        onClose,
        placeholder: "Command",
      }}
    >
      {shortcutKeys.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <CommandHint keys={shortcutKeys} label="Keys" />
        </button>
      )}
    </CommandBar>
  );
}
