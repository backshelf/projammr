import { useEffect } from "react";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import {
  createKeymap,
  type Binding,
  type Keymap,
} from "@workspace/ui/lib/keymap";

export type BackfillCommand = "choose" | "primary" | "back" | "close";

/** Which of the window's keys answer right now; each is as if unbound while its answer is false. */
export type BackfillKeyScope = {
  /** "Choose folders…": the Find step. */
  choose: () => boolean;
  /** The step's primary action (Next, Start, Done) is there to press. */
  primary: () => boolean;
  /** The step has a way back (Check). */
  back: () => boolean;
  /** Closing the window leaves nothing behind (Find, Check); on Bring in it would pause the run. */
  close: () => boolean;
};

/**
 * The window's keys. Every one fires while a field has focus: the pickers are fields, and `⌘↩` and `Esc` must work
 * from inside them. `↩` and `Space` on a folder row are the row's own keys (`folder-list.tsx`), not the window's:
 * a keymap leaves `Enter` to a control that activates on it, and a row is one.
 */
function backfillBindings(
  scope: BackfillKeyScope
): readonly Binding<BackfillCommand>[] {
  return [
    {
      id: "choose",
      keys: ["mod+o"],
      scope: "global",
      label: "Choose folders…",
      allowInInput: true,
      when: scope.choose,
    },
    {
      id: "primary",
      keys: ["mod+Enter"],
      scope: "global",
      label: "Next, Start or Done",
      allowInInput: true,
      when: scope.primary,
    },
    {
      id: "back",
      keys: ["mod+["],
      scope: "global",
      label: "Back",
      allowInInput: true,
      when: scope.back,
    },
    {
      id: "close",
      keys: ["Escape"],
      scope: "global",
      label: "Close",
      allowInInput: true,
      when: scope.close,
    },
  ];
}

export function createBackfillKeymap(
  scope: BackfillKeyScope,
  onRun: (command: BackfillCommand) => void
): Keymap<BackfillCommand> {
  return createKeymap({ bindings: backfillBindings(scope), onRun });
}

/** What each key does; a command with no handler is inert. */
export type BackfillKeyHandlers = Partial<Record<BackfillCommand, () => void>>;

/**
 * Runs the handlers for the window's keys while it is mounted. `scope` and `handlers` are read afresh at each
 * press, so a step that changes what answers needs no new listener.
 */
export function useBackfillKeys(
  scope: BackfillKeyScope,
  handlers: BackfillKeyHandlers
): void {
  const latestScope = useLatestRef(scope);
  const latestHandlers = useLatestRef(handlers);

  useEffect(() => {
    const keymap = createBackfillKeymap(
      {
        choose: () => latestScope.current.choose(),
        primary: () => latestScope.current.primary(),
        back: () => latestScope.current.back(),
        close: () => latestScope.current.close(),
      },
      (command) => latestHandlers.current[command]?.()
    );
    function onKeyDown(event: KeyboardEvent): void {
      keymap.dispatch(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [latestScope, latestHandlers]);
}
