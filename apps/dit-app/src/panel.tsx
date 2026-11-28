import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";

import { call } from "./bridge";
import {
  CommitShortcutProvider,
  useCommitShortcutSlot,
} from "./commit-shortcut";
import { ErrorLine } from "./error-line";
import { FocusTargetProvider, useFocusController } from "./focus-target";
import type { Snapshot } from "./ipc";
import { usePanelKeys } from "./keymap";
import { Notices } from "./notices";
import {
  BackfillProvider,
  PanelActionsProvider,
  UpdateProvider,
  type PanelActions,
  type SettingsTab,
} from "./panel-actions";
import { isRestoring, screenOf, type Nav, type Screen } from "./screen";
import { Adopt } from "./screens/adopt";
import { Adopting } from "./screens/adopting";
import { MachineName } from "./screens/machine-name";
import { Repos } from "./screens/repos";
import { Restore } from "./screens/restore";
import { SetScreen } from "./screens/set";
import { Settings } from "./screens/settings";
import { SignIn } from "./screens/sign-in";
import { usePanelHeight } from "./use-panel-height";
import { useSnapshot } from "./use-snapshot";

/** The panel: the app's snapshot, the one screen it and the person's navigation pick, and the panel's keys. */
export function Panel(): JSX.Element {
  const { snapshot, error } = useSnapshot();
  const [nav, setNav] = useState<Nav>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const mainRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  usePanelHeight(contentRef);
  const focusController = useFocusController();
  const commitShortcut = useCommitShortcutSlot();
  const [reported, setReported] = useState<string | null>(null);

  const screen = snapshot ? screenOf(snapshot, nav) : null;
  const screenKind = screen?.kind ?? null;
  const prevScreenKindRef = useRef<Screen["kind"] | null>(null);

  useEffect(() => {
    const prev = prevScreenKindRef.current;
    prevScreenKindRef.current = screenKind;
    if (prev !== null && screenKind !== null && prev !== screenKind) {
      focusController.focusCurrent(mainRef.current);
    }
  }, [screenKind, focusController]);

  const go = useCallback((to: Nav, tab?: SettingsTab) => {
    setNav(to);
    if (to === "settings") setSettingsTab(tab ?? "general");
    setReported(null);
  }, []);
  const actions = useMemo<PanelActions>(
    () => ({
      nav,
      screen: screen?.kind,
      settingsTab,
      go,
      back: () => go("home"),
      report: setReported,
    }),
    [nav, screen?.kind, settingsTab, go]
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
      if (
        snapshot?.auth.state === "signed-in" &&
        screen?.kind !== "machine-name" &&
        screen?.kind !== "restore"
      ) {
        go("settings");
      }
    },
  });

  const hasBanner =
    (screen?.kind !== "machine-name" && (snapshot?.notices.length ?? 0) > 0) ||
    reported !== null;

  return (
    <FocusTargetProvider value={focusController.claim}>
      <CommitShortcutProvider value={commitShortcut.claim}>
        <PanelActionsProvider value={actions}>
          <main
            ref={mainRef}
            tabIndex={-1}
            className="h-screen w-[400px] overflow-y-auto overscroll-y-contain outline-none"
          >
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
                        settingsTab={settingsTab}
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
  settingsTab,
}: {
  snapshot: Snapshot;
  screen: Screen;
  flushTop: boolean;
  settingsTab: SettingsTab;
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
      return (
        <Adopt
          key={screen.offer.folder}
          offer={screen.offer}
          connection={snapshot.connection}
          home={snapshot.settings.home}
        />
      );
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
      return (
        <Repos
          repos={snapshot.repos}
          renders={snapshot.renders}
          flushTop={flushTop}
        />
      );
    case "settings":
      return (
        <Settings
          snapshot={snapshot}
          initialTab={settingsTab}
          flushTop={flushTop}
        />
      );
  }
}
