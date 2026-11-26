import { useState, type JSX } from "react";

import type { BackfillFolder, BackfillView } from "../backfill-ipc";
import { useBackfillActions } from "./actions";
import { Check } from "./check";
import { Done } from "./done";
import { Find } from "./find";
import { ReportedProvider } from "./reported";
import { useBackfillKeys } from "./keys";
import { announcement, stateKinds, tickedPaths } from "./model";
import { Run } from "./run";
import { useBackfill, type BackfillStore } from "./store";

/**
 * What the live region says: a folder finishing, failing or pausing, said once, and nothing for a count that only
 * moved. It keeps the last thing said until there is something new, so a re-render never repeats it.
 */
function useAnnouncement(folders: readonly BackfillFolder[]): string {
  const [seen, setSeen] = useState(() => ({
    folders,
    kinds: stateKinds(folders),
    message: "",
  }));
  if (seen.folders !== folders) {
    setSeen({
      folders,
      kinds: stateKinds(folders),
      message: announcement(seen.kinds, folders) ?? seen.message,
    });
  }
  return seen.message;
}

/**
 * The backfill window for one view of the app's: the step it names, the window's keys, and the live region. The
 * ticks (which found folders go on to Check) are the window's own, since a folder that turns up while Find is
 * walking arrives ticked and "Back" must find them as they were left.
 */
export function BackfillWindow({ view }: { view: BackfillView }): JSX.Element {
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [reported, setReported] = useState<string | null>(null);
  const actions = useBackfillActions(setReported);
  const spoken = useAnnouncement(view.folders);

  const ticked = tickedPaths(view.folders, unticked);
  useBackfillKeys(
    {
      choose: () => view.step === "find",
      primary: () =>
        view.step === "find"
          ? ticked.length > 0
          : view.step === "check"
            ? view.canStart
            : view.step === "done",
      back: () => view.step === "check",
      close: () => view.step === "find" || view.step === "check",
    },
    {
      choose: () => void actions.chooseRoots(view.roots),
      primary: () => {
        if (view.step === "find") void actions.check(ticked);
        else if (view.step === "check") void actions.start();
        else void actions.close();
      },
      back: () => void actions.back(),
      close: () => void actions.close(),
    }
  );

  return (
    <ReportedProvider value={reported ?? view.error}>
      {view.step === "find" && (
        <Find
          view={view}
          unticked={unticked}
          onUnticked={setUnticked}
          actions={actions}
        />
      )}
      {view.step === "check" && <Check view={view} actions={actions} />}
      {view.step === "bring-in" && <Run view={view} actions={actions} />}
      {view.step === "done" && <Done view={view} actions={actions} />}
      <p role="status" aria-live="polite" className="sr-only">
        {spoken}
      </p>
    </ReportedProvider>
  );
}

/** The window as the app loads it: the store's view once there is one, and what is wrong until then. */
export function BackfillRoot({
  store,
}: {
  store?: BackfillStore;
}): JSX.Element {
  const { view, error } = useBackfill(store);
  if (view === null) {
    return (
      <p className="p-4 text-small text-ink-soft">
        {error ?? "Waiting for the app…"}
      </p>
    );
  }
  return <BackfillWindow view={view} />;
}
