import { useCallback, useMemo, useRef, useState, type JSX } from "react";

import { BackfillProvider } from "./backfill-item";
import { call } from "./bridge";
import {
  CommitShortcutProvider,
  useCommitShortcutSlot,
} from "./commit-shortcut";
import { ErrorLine } from "./error-line";
import { FocusTargetProvider, useFocusOnShow } from "./focus-target";
import type { Snapshot } from "./ipc";
import { usePanelKeys } from "./keymap";
import { Notices } from "./notices";
import { PanelActionsProvider, type PanelActions } from "./panel-actions";
import { isRestoring, screenOf, type Nav, type Screen } from "./screen";
import { Adopt } from "./screens/adopt";
import { Adopting } from "./screens/adopting";
import { MachineName } from "./screens/machine-name";
import { Repos } from "./screens/repos";
import { Restore } from "./screens/restore";
import { SetScreen } from "./screens/set";
import { Settings } from "./screens/settings";
import { SignIn } from "./screens/sign-in";
import { UpdateProvider } from "./update-offer";
import { usePanelHeight } from "./use-panel-height";
import { useSnapshot } from "./use-snapshot";

/** The panel: the app's snapshot, the one screen it and the person's navigation pick, and the panel's keys. */
export function Panel(): JSX.Element {
  const { snapshot, error } = useSnapshot();
  const [nav, setNav] = useState<Nav>("home");
  const contentRef = useRef<HTMLDivElement>(null);
  usePanelHeight(contentRef);
  const focusTarget = useFocusOnShow();
  const commitShortcut = useCommitShortcutSlot();
  const [reported, setReported] = useState<string | null>(null);

  const screen = snapshot ? screenOf(snapshot, nav) : null;
  const go = useCallback((to: Nav) => {
    setNav(to);
    setReported(null);
  }, []);
  const actions = useMemo<PanelActions>(
    () => ({
      nav,
      go,
      back: () => go("home"),
      report: setReported,
    }),
    [nav, go]
  );

  usePanelKeys({
    commit: commitShortcut.run,
    back: () => {
      if (screen?.kind === "restore") {
        // Esc is Cancel on the restore screen, until a restore is running: that one cannot be stopped, so the
        // panel only gets out of the way and the screen is there when it opens again.
        if (snapshot && isRestoring(snapshot.restore)) {
          void call("hide_panel");
        } else {
          void call("cancel_restore");
        }
        return;
      }
      if (nav !== "home" && screen?.kind === nav) {
        go("home");
      } else {
        void call("hide_panel");
      }
    },
    settings: () => {
      if (snapshot?.auth.state === "signed-in") go("settings");
    },
  });

  const hasBanner =
    (screen?.kind !== "machine-name" && (snapshot?.notices.length ?? 0) > 0) ||
    reported !== null;

  return (
    <FocusTargetProvider value={focusTarget}>
      <CommitShortcutProvider value={commitShortcut.claim}>
        <PanelActionsProvider value={actions}>
          <main className="h-screen w-[400px] overflow-y-auto">
            <div ref={contentRef} className="flex min-h-56 flex-col gap-4 p-4">
              {snapshot && screen ? (
                <>
                  {screen.kind !== "machine-name" && (
                    <Notices notices={snapshot.notices} />
                  )}
                  <ErrorLine error={reported} />
                  <UpdateProvider value={snapshot.update}>
                    <BackfillProvider value={snapshot.backfill}>
                      <ScreenView
                        snapshot={snapshot}
                        screen={screen}
                        flushTop={!hasBanner}
                      />
                    </BackfillProvider>
                  </UpdateProvider>
                </>
              ) : (
                <p className="text-small text-ink-soft">
                  {error ?? "Waiting for the app…"}
                </p>
              )}
            </div>
          </main>
        </PanelActionsProvider>
      </CommitShortcutProvider>
    </FocusTargetProvider>
  );
}

function ScreenView({
  snapshot,
  screen,
  flushTop,
}: {
  snapshot: Snapshot;
  screen: Screen;
  flushTop: boolean;
}): JSX.Element {
  switch (screen.kind) {
    case "sign-in":
      return <SignIn auth={snapshot.auth} />;
    case "machine-name":
      return (
        <MachineName
          refused={screen.refused}
          current={snapshot.settings.machineName}
        />
      );
    case "adopt":
      return <Adopt key={screen.offer.folder} offer={screen.offer} />;
    case "adopting":
      return (
        <Adopting key={screen.adopting.folder} adopting={screen.adopting} />
      );
    case "restore":
      return (
        <Restore
          key={screen.pending.commitId}
          pending={screen.pending}
          restore={snapshot.restore}
          liveOpen={snapshot.open?.path ?? null}
        />
      );
    case "set":
      return (
        <SetScreen snapshot={snapshot} open={screen.open} flushTop={flushTop} />
      );
    case "repos":
      return <Repos repos={snapshot.repos} renders={snapshot.renders} />;
    case "settings":
      return <Settings snapshot={snapshot} />;
  }
}
