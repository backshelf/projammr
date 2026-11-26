import { memo, useId, useMemo, type JSX } from "react";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";

import type {
  BackfillChosen,
  BackfillFolder,
  BackfillSet,
  BackfillView,
} from "../backfill-ipc";
import type { BackfillActions } from "./actions";
import { Frame } from "./frame";
import { FolderList, type FolderListRow } from "./folder-list";
import {
  backupsLabel,
  checkFacts,
  isReading,
  progressPercent,
  sessionOptions,
  sessionValue,
  setDoubtLine,
  storageLine,
  syncWarning,
  targetForSession,
  targetForTrack,
  trackChoice,
  type Choices,
} from "./model";
import { ChosenHead, Notice, SetNames } from "./panes";
import { Picker } from "./picker";
import { useFormat } from "@workspace/ui/components/format-provider";

/** The columns of the sets table when the pane is wide enough for one: set, backups, track, session. */
const WIDE_COLUMNS =
  "@xl/sets:grid-cols-[minmax(0,0.9fr)_4.5rem_minmax(0,1.15fr)_minmax(0,1.5fr)] @xl/sets:gap-x-3";

/** The grid every row of the sets table shares: wide, as a table; narrow, stacked under the set's name. */
const SET_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 @xl/sets:items-start ${WIDE_COLUMNS}`;

/** The column's name over its picker where the table is stacked and has no heading row; the picker names itself. */
function StackedLabel({ children }: { children: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className="mb-1 block font-sub text-micro tracking-[0.12em] text-ink-soft uppercase @xl/sets:hidden"
    >
      {children}
    </span>
  );
}

/** What the list row of a folder shows in front of its name on Check: that it was read, or that it is in doubt. */
function leadOf(folder: BackfillFolder): JSX.Element | null {
  const state = folder.state.state;
  if (state === "failed" || folder.doubt !== null) {
    return <IconAlertTriangle className="size-3.5" aria-hidden />;
  }
  return state === "checked" ? (
    <IconCheck className="size-3.5" aria-hidden />
  ) : null;
}

/**
 * One set of the chosen folder: its name and `Backup/` copies, the track and the session it goes to, and, when Check
 * could not take it whole, the line that says what happens to it. Memoised: the view is shared between pushes, so
 * a set that did not change is not drawn again while Check reads the next one.
 */
const SetRow = memo(function SetRow({
  folder,
  set,
  choices,
  actions,
}: {
  folder: string;
  set: BackfillSet;
  choices: Choices;
  actions: BackfillActions;
}): JSX.Element {
  const track = useMemo(() => trackChoice(set, choices), [set, choices]);
  const sessions = useMemo(() => sessionOptions(set, choices), [set, choices]);
  const doubt = setDoubtLine(set);

  return (
    <div role="row" className={`border-t border-rule py-2.5 ${SET_GRID}`}>
      <div role="cell" className="min-w-0">
        <p
          className="truncate text-body text-ink @xl/sets:pt-1"
          title={set.file}
        >
          {set.name}
        </p>
      </div>
      <div
        role="cell"
        className="text-right text-micro whitespace-nowrap text-ink-soft tabular-nums @xl/sets:pt-1.5 @xl/sets:text-left"
      >
        {backupsLabel(set.copies)}
      </div>
      {set.target === null ? (
        <div role="cell" className="col-span-full text-micro text-ink-soft">
          {doubt}
        </div>
      ) : (
        <>
          <div
            role="cell"
            className="col-span-full min-w-0 @xl/sets:col-span-1"
          >
            <StackedLabel>Track</StackedLabel>
            <Picker
              label={`Track for ${set.name}`}
              options={track.options}
              value={track.value}
              disabled={track.locked}
              onChange={(value) =>
                void actions.setTarget(
                  folder,
                  set.file,
                  targetForTrack(value, choices)
                )
              }
            />
          </div>
          <div
            role="cell"
            className="col-span-full min-w-0 @xl/sets:col-span-1"
          >
            <StackedLabel>Session</StackedLabel>
            <Picker
              label={`Session for ${set.name}`}
              options={sessions}
              value={sessionValue(set)}
              onChange={(value) =>
                void actions.setTarget(
                  folder,
                  set.file,
                  targetForSession(value, set, choices)
                )
              }
            />
          </div>
          {doubt !== null && (
            <div role="cell" className="col-span-full text-micro text-ink-soft">
              {doubt}
            </div>
          )}
        </>
      )}
    </div>
  );
});

function ColumnHeads(): JSX.Element {
  return (
    <div
      role="row"
      className={`hidden pb-2 font-sub text-micro tracking-[0.12em] text-ink-soft uppercase @xl/sets:grid ${WIDE_COLUMNS}`}
    >
      <div role="columnheader">Set</div>
      <div role="columnheader">Backups</div>
      <div role="columnheader">Track</div>
      <div role="columnheader">Session</div>
    </div>
  );
}

/** The chosen folder on Check: where it goes, and for each set the track and the session it goes to. */
function ChosenFolder({
  view,
  actions,
}: {
  view: BackfillView;
  actions: BackfillActions;
}): JSX.Element | null {
  return view.chosen === null ? null : (
    <ChosenBlock chosen={view.chosen} view={view} actions={actions} />
  );
}

function ChosenBlock({
  chosen,
  view,
  actions,
}: {
  chosen: BackfillChosen;
  view: BackfillView;
  actions: BackfillActions;
}): JSX.Element {
  const projectLabelId = useId();
  const { tracks, sessions, newTrack } = chosen;
  const projects = useMemo(
    () =>
      view.projects.map((project) => ({
        value: String(project.id),
        label: project.name,
      })),
    [view.projects]
  );
  const choices = useMemo<Choices>(
    () => ({ tracks, sessions, newTrack }),
    [tracks, sessions, newTrack]
  );
  const synced = view.folders.find((folder) => folder.path === chosen.folder)
    ?.doubt?.syncedBy;
  const proposals = chosen.project !== null && view.hubError === null;
  return (
    <>
      <ChosenHead name={chosen.name} path={chosen.folder}>
        <div className="flex w-52 shrink-0 flex-col gap-1">
          <span
            id={projectLabelId}
            className="font-sub text-micro tracking-[0.12em] text-ink-soft uppercase"
          >
            Goes into
          </span>
          <Picker
            label="Goes into"
            labelledBy={projectLabelId}
            options={projects}
            value={chosen.project === null ? null : String(chosen.project)}
            disabled={!proposals}
            onChange={(value) =>
              void actions.setProject(chosen.folder, Number(value))
            }
          />
        </div>
      </ChosenHead>
      {synced != null && <Notice>{syncWarning(synced)}</Notice>}
      {proposals ? (
        <div role="table" aria-label="Sets" className="@container/sets">
          <ColumnHeads />
          <div role="rowgroup" className="border-b border-rule">
            {chosen.sets.map((set) => (
              <SetRow
                key={set.file}
                folder={chosen.folder}
                set={set}
                choices={choices}
                actions={actions}
              />
            ))}
          </div>
        </div>
      ) : (
        <SetNames sets={chosen.sets} />
      )}
    </>
  );
}

/**
 * Check: the ticked folders as read, each with its set count and whether it is in doubt, and on the right the
 * chosen folder's project and every set's proposal. The footer holds the storage line, "Back" and "Start".
 */
export function Check({
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
        meta: checkFacts(folder),
        progress:
          folder.state.state === "reading"
            ? progressPercent(folder.state)
            : null,
        lead: leadOf(folder),
      })),
    [view.folders]
  );
  const start = (): void => void actions.start();
  const again = (): void =>
    void actions.check(view.folders.map((folder) => folder.path));
  const line =
    view.hubError !== null ? (
      <span className="flex flex-wrap items-center gap-x-3">
        {view.hubError}
        <Button variant="link" onClick={again}>
          Try again
        </Button>
      </span>
    ) : view.storage !== null && !isReading(view.folders) ? (
      storageLine(view.storage, format)
    ) : null;

  return (
    <Frame
      step="check"
      list={
        <FolderList
          label="Folders to bring in"
          rows={rows}
          chosen={view.chosen?.folder ?? null}
          onChoose={(folder) => void actions.choose(folder)}
          onPrimary={view.canStart ? start : undefined}
          autoFocus
        />
      }
      detail={<ChosenFolder view={view} actions={actions} />}
      line={line}
      actions={
        <>
          <Button
            variant="outline"
            size="lg"
            aria-keyshortcuts="Meta+["
            onClick={() => void actions.back()}
          >
            Back
            <Kbd variant="bare" aria-hidden className="text-inherit opacity-70">
              ⌘[
            </Kbd>
          </Button>
          <Button
            size="lg"
            disabled={!view.canStart}
            aria-keyshortcuts="Meta+Enter"
            onClick={start}
          >
            Start
            <Kbd variant="bare" aria-hidden className="text-inherit opacity-70">
              {"\u2318\u21a9"}
            </Kbd>
          </Button>
        </>
      }
    />
  );
}
