import { useEffect } from "react";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createKeymap,
  type Binding,
  type Keymap,
} from "@workspace/ui/lib/keymap";

export type PanelCommand = "commit" | "back" | "settings";

/**
 * The panel's keys. All three fire while a field has focus: the commit box is a field, Esc must leave a text input
 * as well as a button, and settings is a shortcut to reach from anywhere.
 */
export const PANEL_BINDINGS: readonly Binding<PanelCommand>[] = [
  {
    id: "commit",
    keys: ["mod+Enter"],
    scope: "global",
    label: "Commit",
    allowInInput: true,
  },
  {
    id: "back",
    keys: ["Escape"],
    scope: "global",
    label: "Close",
    allowInInput: true,
  },
  {
    id: "settings",
    keys: ["mod+,"],
    scope: "global",
    label: "Settings",
    allowInInput: true,
  },
];

/** What each key does; a command with no handler is inert. */
export type PanelKeyHandlers = Partial<Record<PanelCommand, () => void>>;

export function createPanelKeymap(
  onRun: (command: PanelCommand) => void
): Keymap<PanelCommand> {
  return createKeymap({ bindings: PANEL_BINDINGS, onRun });
}

/** Runs the handlers for the panel's keys while the panel is mounted. */
export function usePanelKeys(handlers: PanelKeyHandlers): void {
  const latest = useLatestRef(handlers);

  useEffect(() => {
    const keymap = createPanelKeymap((command) => latest.current[command]?.());
    function onKeyDown(event: KeyboardEvent): void {
      keymap.dispatch(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [latest]);
}
