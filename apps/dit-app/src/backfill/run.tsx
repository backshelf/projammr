import { useMemo, type JSX } from "react";
import {
  IconAlertTriangle,
  IconCircle,
  IconCircleCheck,
  IconCircleDot,
  IconPlayerPause,
  IconWifiOff,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { Progress } from "@workspace/ui/components/progress";

import type {
  BackfillFolder,
  BackfillFolderState,
  BackfillView,
} from "../backfill-ipc";
import { ErrorLine } from "../error-line";
import type { BackfillActions } from "./actions";
import { Frame } from "./frame";
import { FolderList, type FolderListRow } from "./folder-list";
import { folderFigures, progressPercent, runLine, stateLine } from "./model";
import { ChosenHead } from "./panes";

/** The icon in front of a folder in the run: one drawn shape for each state, none of them moving. */
function stateIcon(state: BackfillFolderState): JSX.Element {
  const props = { className: "size-3.5", "aria-hidden": true } as const;
  switch (state.state) {
    case "committing":
    case "uploading":
      return <IconCircleDot {...props} />;
    case "waiting-for-hub":
      return <IconWifiOff {...props} />;
    case "done":
      return <IconCircleCheck {...props} />;
    case "paused":
      return <IconPlayerPause {...props} />;
    case "failed":
      return <IconAlertTriangle {...props} />;
    default:
      return <IconCircle {...props} />;
  }
}

/** The chosen folder in the run: how far it is, in the three figures the spec names; why it failed, and "Try again". */
function FolderProgress({
  folder,
  view,
  actions,
}: {
  folder: BackfillFolder;
  view: BackfillView;
  actions: BackfillActions;
}): JSX.Element {
  const format = useFormat();
  const totals =
    view.run?.folders.find((entry) => entry.path === folder.path)?.totals ??
    null;
  const figures = folderFigures(folder, totals, format);
  const percent = progressPercent(folder.state);
  const line = stateLine(folder.state, view, format);
  const failed = folder.state.state === "failed" ? folder.state.reason : null;

  return (
    <>
      <ChosenHead name={folder.name} path={folder.path} />
      {failed === null ? (
        <p className="text-small text-ink-soft">{line}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <ErrorLine error={failed} />
          <Button
            variant="outline"
            size="lg"
            onClick={() => void actions.retry(folder.path)}
          >
            Try again
          </Button>
        </div>
      )}
      {percent !== null && failed === null && (
        <Progress value={percent} aria-label={`${folder.title} progress`} />
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-small">
        <dt className="text-ink-soft">Sets committed</dt>
        <dd className="text-ink tabular-nums">{figures.committed}</dd>
        <dt className="text-ink-soft">Saves stored</dt>
        <dd className="text-ink tabular-nums">{figures.saves}</dd>
        <dt className="text-ink-soft">Data uploaded</dt>
        <dd className="text-ink tabular-nums">{figures.uploaded}</dd>
      </dl>
    </>
  );
}

/**
 * Bring in: every folder of the run with its state, the chosen folder's progress on the right, and "Pause" or
 * "Resume" for the whole run in the footer.
 */
export function Run({
  view,
  actions,
}: {
  view: BackfillView;
  actions: BackfillActions;
}): JSX.Element {
  const format = useFormat();
  const rows = useMemo<FolderListRow[]>(
    () =>
      view.folders.map((folder) => ({
        path: folder.path,
        title: folder.title,
        meta: stateLine(folder.state, view, format),
        progress:
          folder.state.state === "committing" ||
          folder.state.state === "uploading"
            ? progressPercent(folder.state)
            : null,
        lead: stateIcon(folder.state),
      })),
    [view, format]
  );
  const chosen = view.folders.find(
    (folder) => folder.path === view.chosen?.folder
  );
  const activeFolder = view.folders.find(
    (folder) =>
      folder.state.state === "committing" ||
      folder.state.state === "uploading" ||
      folder.state.state === "waiting-for-hub"
  );
  const overallPercent = useMemo(() => {
    if (view.folders.length === 0) return 0;
    const sum = view.folders.reduce((total, folder) => {
      if (folder.state.state === "done") return total + 100;
      return total + (progressPercent(folder.state) ?? 0);
    }, 0);
    return Math.min(100, Math.round(sum / view.folders.length));
  }, [view.folders]);
  const paused = view.run?.paused === true;

  return (
    <Frame
      step="bring-in"
      list={
        <FolderList
          label="Folders in the run"
          rows={rows}
          chosen={chosen?.path ?? null}
          onChoose={(folder) => void actions.choose(folder)}
          autoFocus
        />
      }
      detail={
        chosen === undefined ? null : (
          <FolderProgress folder={chosen} view={view} actions={actions} />
        )
      }
      line={
        <div className="flex flex-col gap-1.5">
          <Progress
            value={overallPercent}
            aria-label="Overall progress"
            aria-valuenow={overallPercent}
            indicatorClassName="bg-art"
          />
          <span>{runLine(view)}</span>
        </div>
      }
      actions={
        <>
          {activeFolder && activeFolder.path !== chosen?.path && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => void actions.choose(activeFolder.path)}
            >
              Jump to active
            </Button>
          )}
          {paused ? (
            <Button size="lg" onClick={() => void actions.resume()}>
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              disabled={view.run === null}
              onClick={() => void actions.pause()}
            >
              Pause
            </Button>
          )}
        </>
      }
    />
  );
}
