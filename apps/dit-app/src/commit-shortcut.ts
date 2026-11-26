import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";

/** What a screen with something to commit hands the panel: take `⌘↩`, and let go of it when the screen goes. */
export type ClaimCommit = (run: () => void) => () => void;

/**
 * Holds the one handler `⌘↩` runs. The panel owns the window's single keymap, which treats a key it matched as
 * handled, so the commit box cannot listen for the key itself: it claims the key here, and the panel runs the claim.
 * Returns the claim to provide below and the function the keymap's `commit` command calls.
 */
export function useCommitShortcutSlot(): {
  claim: ClaimCommit;
  run: () => void;
} {
  const heldRef: RefObject<(() => void) | null> = useRef(null);

  const claim = useCallback<ClaimCommit>(
    (run) => {
      heldRef.current = run;
      return () => {
        if (heldRef.current === run) heldRef.current = null;
      };
    },
    [heldRef]
  );
  const run = useCallback(() => heldRef.current?.(), [heldRef]);
  return { claim, run };
}

const CommitShortcutContext = createContext<ClaimCommit | null>(null);

/** Provides the claim `useCommitShortcutSlot` returned to every screen below it. */
export const CommitShortcutProvider = CommitShortcutContext.Provider;

/** Makes `⌘↩` run `run` for as long as the caller is mounted. */
export function useCommitShortcut(run: () => void): void {
  const claim = use(CommitShortcutContext);
  if (!claim) throw new Error("CommitShortcutProvider is missing.");
  const latest = useLatestRef(run);
  useEffect(() => claim(() => latest.current()), [claim, latest]);
}
