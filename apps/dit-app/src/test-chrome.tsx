import { useMemo, useState, type ReactElement } from "react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

import {
  CommitShortcutProvider,
  useCommitShortcutSlot,
} from "./commit-shortcut";
import { ErrorLine } from "./error-line";
import { FocusTargetProvider, useFocusOnShow } from "./focus-target";
import { PanelActionsProvider, type PanelActions } from "./panel-actions";
import { usePanelKeys } from "./keymap";
import type { Nav } from "./screen";

/**
 * The panel's navigation and its `⌘↩`, as the panel holds them, for a screen rendered on its own: a key pressed in
 * the screen reaches the same keymap the panel installs.
 */
export function Chrome({
  nav: start,
  children,
}: {
  nav: Nav;
  children: ReactElement;
}): ReactElement {
  const [nav, setNav] = useState<Nav>(start);
  const [reported, setReported] = useState<string | null>(null);
  const focusTarget = useFocusOnShow();
  const commitShortcut = useCommitShortcutSlot();
  usePanelKeys({ commit: commitShortcut.run });
  const actions = useMemo<PanelActions>(
    () => ({
      nav,
      go: setNav,
      back: () => setNav("home"),
      report: setReported,
    }),
    [nav]
  );
  return (
    <MotionProvider>
      <FocusTargetProvider value={focusTarget}>
        <CommitShortcutProvider value={commitShortcut.claim}>
          <PanelActionsProvider value={actions}>
            <ErrorLine error={reported} />
            {children}
          </PanelActionsProvider>
        </CommitShortcutProvider>
      </FocusTargetProvider>
    </MotionProvider>
  );
}
