import { useMemo, useState, type JSX } from "react";
import { IconFolderPlus, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Input } from "@workspace/ui/components/input";
import { Kbd } from "@workspace/ui/components/kbd";

import type { BackfillView } from "../backfill-ipc";
import type { BackfillActions } from "./actions";
import { Frame } from "./frame";
import { FolderList, type FolderListRow } from "./folder-list";
import { findLine, folderFacts, tickable, tickedPaths, toggled } from "./model";
import { ChosenHead, Notice, SetNames } from "./panes";

/** The roots Find searches under, each removable, and the button that adds more. */
function Roots({
  roots,
  actions,
}: {
  roots: readonly string[];
  actions: BackfillActions;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-rule p-3">
      {roots.length > 0 && (
        <ul aria-label="Folders searched" className="flex flex-col gap-1">
          {roots.map((root) => (
            <li key={root} className="flex items-start gap-1">
              <span className="min-w-0 flex-1 pt-1 font-mono text-micro break-all text-ink-soft">
                {root}
              </span>
              <IconButton
                aria-label={`Remove ${root}`}
                onClick={() => void actions.removeRoot(roots, root)}
              >
                <IconX />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        size="lg"
        autoFocus
        aria-keyshortcuts="Meta+O"
        className="self-start"
        onClick={() => void actions.chooseRoots(roots)}
      >
        <IconFolderPlus />
        Choose folders…
        <Kbd variant="bare" aria-hidden className="text-inherit opacity-70">
          ⌘O
        </Kbd>
      </Button>
    </div>
  );
}

/** What Find says when the list has nothing to choose from, or nothing to tick. */
function emptyNotice(view: BackfillView): string | null {
  if (view.roots.length === 0) {
    return "Choose the folders your Live projects are in.";
  }
  if (view.folders.length === 0) {
    return view.searching ? null : "No Live projects under these folders.";
  }
  return tickable(view.folders).length === 0
    ? "Everything here is already in dit."
    : null;
}

/**
 * Find: the roots above the list, the ` Project` folders found under them (ticked until unticked) and the chosen
 * folder's sets. "Next" goes on with the ticked folders.
 */
export function Find({
  view,
  unticked,
  onUnticked,
  actions,
}: {
  view: BackfillView;
  unticked: ReadonlySet<string>;
  onUnticked: (next: Set<string>) => void;
  actions: BackfillActions;
}): JSX.Element {
  const format = useFormat();
  const [filter, setFilter] = useState("");
  const tickableFolders = useMemo(
    () => tickable(view.folders),
    [view.folders]
  );
  const ticked = useMemo(
    () => tickedPaths(view.folders, unticked),
    [view.folders, unticked]
  );
  const allTicked =
    tickableFolders.length > 0 && ticked.length === tickableFolders.length;
  const rows = useMemo<FolderListRow[]>(
    () =>
      view.folders.map((folder) => ({
        path: folder.path,
        title: folder.title,
        meta: folder.already ? "Already in dit" : folderFacts(folder, format),
        tickable: !folder.already,
      })),
    [view.folders, format]
  );
  const query = filter.trim().toLowerCase();
  const shownRows = useMemo(
    () =>
      query === ""
        ? rows
        : rows.filter(
            (row) =>
              row.title.toLowerCase().includes(query) ||
              row.path.toLowerCase().includes(query)
          ),
    [rows, query]
  );
  const next = (): void => void actions.check(ticked);
  const notice = emptyNotice(view);
  const chosen =
    view.chosen !== null &&
    view.folders.some((folder) => folder.path === view.chosen?.folder)
      ? view.chosen
      : null;

  return (
    <Frame
      step="find"
      list={
        <>
          <Roots roots={view.roots} actions={actions} />
          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
                <Input
                  type="search"
                  aria-label="Filter folders"
                  placeholder="Filter folders"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  spellCheck={false}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="ghost"
                  disabled={tickableFolders.length === 0}
                  onClick={() =>
                    onUnticked(
                      allTicked
                        ? new Set(tickableFolders.map((folder) => folder.path))
                        : new Set()
                    )
                  }
                >
                  {allTicked ? "Untick all" : "Tick all"}
                </Button>
              </div>
              {shownRows.length === 0 ? (
                <p className="p-3 text-small text-ink-soft">
                  No folder matches “{filter.trim()}”.
                </p>
              ) : (
                <FolderList
                  label="Folders found"
                  rows={shownRows}
                  chosen={chosen?.folder ?? null}
                  onChoose={(folder) => void actions.choose(folder)}
                  ticks={{
                    unticked,
                    onToggle: (path) => onUnticked(toggled(unticked, path)),
                  }}
                  onPrimary={ticked.length > 0 ? next : undefined}
                />
              )}
            </>
          )}
        </>
      }
      detail={
        <>
          {notice !== null && <Notice>{notice}</Notice>}
          {chosen !== null && (
            <>
              <ChosenHead name={chosen.name} path={chosen.folder} />
              <SetNames sets={chosen.sets} />
            </>
          )}
        </>
      }
      line={findLine(view, ticked.length)}
      actions={
        <Button
          size="lg"
          disabled={ticked.length === 0}
          aria-keyshortcuts="Meta+Enter"
          onClick={next}
        >
          Next
          <Kbd variant="bare" aria-hidden className="text-inherit opacity-70">
            {"\u2318\u21a9"}
          </Kbd>
        </Button>
      }
    />
  );
}
