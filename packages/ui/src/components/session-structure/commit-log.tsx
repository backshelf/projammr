import { DiffChipList } from "@workspace/ui/components/session-structure/diff-chip-list";
import { SaveRowBody } from "@workspace/ui/components/session-structure/save-row-body";
import {
  commitRowId,
  saveRowId,
  type LogCommit,
  type LogEntry,
  type LogSave,
  foldedTimeInSet,
  foldLabel,
} from "@workspace/ui/lib/commit-log";
import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import { pluralizeCount } from "@workspace/session-diff/format";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";

/** Which end of the comparison a row is, when it is one. */
export type CompareEnd = "from" | "to";

/** "From" and "To" on the rows being compared, in `--art` so they read as the page's marks. */
function EndMark({ end }: { end: CompareEnd | undefined }) {
  if (!end) return null;
  return (
    <span className={cn(LABEL, "text-art")}>
      {end === "from" ? "From" : "To"}
    </span>
  );
}

function SaveRow({
  save,
  format,
  end,
  actions,
}: {
  save: LogSave;
  format: Formatters;
  end: CompareEnd | undefined;
  actions: ReactNode;
}) {
  return (
    <li
      id={saveRowId(save.id)}
      className={cn(
        "flex scroll-mt-24 flex-col gap-1 py-2 pr-2 pl-3 motion-ink",
        end && "bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
      )}
    >
      <SaveRowBody
        at={save.fileUpdatedAt}
        stamp={format.dateTime(save.fileUpdatedAt)}
        machineName={save.machineName}
        source={save.source}
        chips={save.chips}
        trailing={
          <>
            <EndMark end={end} />
            <span className="ml-auto flex items-baseline gap-3">{actions}</span>
          </>
        }
      />
    </li>
  );
}

/** A list of saves, newest first, each with the actions the caller hands over. */
function SaveRows({
  saves,
  format,
  ends,
  renderSaveActions,
}: {
  saves: readonly LogSave[];
  format: Formatters;
  ends: ReadonlyMap<number, CompareEnd>;
  renderSaveActions: (save: LogSave) => ReactNode;
}) {
  return (
    <ul className="flex flex-col">
      {saves.map((save) => (
        <SaveRow
          key={save.id}
          save={save}
          format={format}
          end={ends.get(save.id)}
          actions={renderSaveActions(save)}
        />
      ))}
    </ul>
  );
}

/** "Name · machine · 2d ago", the line every commit's byline reads. */
function Byline({
  commit,
  timeInSet,
  format,
  asOf,
}: {
  commit: LogCommit;
  /** The time the row stands for, which a named row sums from its checkpoints. */
  timeInSet: number | null;
  format: Formatters;
  asOf: Date;
}) {
  // The same name as author and machine reads once.
  const parts = [
    ...new Set(
      [commit.authorName, commit.machineName].filter(
        (part): part is string => part != null && part !== ""
      )
    ),
  ];
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-micro text-ink-soft">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
      <time
        dateTime={commit.committedAt}
        title={format.dateTime(commit.committedAt)}
        className="tabular-nums"
      >
        {format.relative(commit.committedAt, asOf)}
      </time>
      {timeInSet != null && (
        <span className="tabular-nums">{format.timeInSet(timeInSet)}</span>
      )}
    </span>
  );
}

/** The disclosure a row's saves sit behind: a native `<details>`, so its state is announced with no script. */
function SavesFold({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="group/disclosure min-w-0">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-micro text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
        <IconChevronRight
          size={12}
          aria-hidden
          className="shrink-0 text-ink-faint motion-move group-open/disclosure:rotate-90"
        />
        {label}
      </summary>
      <div className="mt-1 ml-1 border-l border-rule">{children}</div>
    </details>
  );
}

function CommitRow({
  entry,
  format,
  asOf,
  ends,
  renderCommitActions,
  renderSaveActions,
}: {
  entry: Extract<LogEntry, { kind: "commit" }>;
  format: Formatters;
  asOf: Date;
  ends: ReadonlyMap<number, CompareEnd>;
  renderCommitActions: (commit: LogCommit) => ReactNode;
  renderSaveActions: (save: LogSave) => ReactNode;
}) {
  const { commit, checkpoints } = entry;
  const label = foldLabel(entry);
  const end = ends.get(commit.saveId);

  return (
    <li
      id={commitRowId(commit.id)}
      className={cn(
        "flex scroll-mt-24 flex-col gap-1.5 border-t border-rule px-2 py-3",
        end && "bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 text-body [overflow-wrap:anywhere] text-ink">
            {commit.message}
          </span>
          <EndMark end={end} />
        </span>
        <Byline
          commit={commit}
          timeInSet={foldedTimeInSet(entry)}
          format={format}
          asOf={asOf}
        />
      </span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        {commit.chips.length > 0 ? (
          <DiffChipList chips={commit.chips} />
        ) : commit.chipsKnown ? (
          <span className="text-micro text-ink-soft">
            Nothing the diff tracks changed
          </span>
        ) : (
          <span />
        )}
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {renderCommitActions(commit)}
        </span>
      </span>
      {label != null && (
        <SavesFold label={label}>
          <SaveRows
            saves={commit.saves}
            format={format}
            ends={ends}
            renderSaveActions={renderSaveActions}
          />
          {checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} id={commitRowId(checkpoint.id)}>
              <p className="flex flex-wrap items-baseline gap-x-2 px-3 pt-2 text-micro text-ink-faint">
                <span>checkpoint</span>
                <time
                  dateTime={checkpoint.committedAt}
                  title={format.dateTime(checkpoint.committedAt)}
                >
                  {format.relative(checkpoint.committedAt, asOf)}
                </time>
                {checkpoint.timeInSet != null && (
                  <span className="tabular-nums">
                    {format.timeInSet(checkpoint.timeInSet)}
                  </span>
                )}
              </p>
              <SaveRows
                saves={checkpoint.saves}
                format={format}
                ends={ends}
                renderSaveActions={renderSaveActions}
              />
            </div>
          ))}
        </SavesFold>
      )}
    </li>
  );
}

/** A checkpoint dit took itself, kept in line when it has no named commit to fold under: one quiet line. */
function CheckpointRow({
  commit,
  format,
  asOf,
  ends,
  renderCommitActions,
  renderSaveActions,
}: {
  commit: LogCommit;
  format: Formatters;
  asOf: Date;
  ends: ReadonlyMap<number, CompareEnd>;
  renderCommitActions: (commit: LogCommit) => ReactNode;
  renderSaveActions: (save: LogSave) => ReactNode;
}) {
  const end = ends.get(commit.saveId);
  return (
    <li
      id={commitRowId(commit.id)}
      className={cn(
        "flex scroll-mt-24 flex-col gap-1 border-t border-rule px-2 py-2",
        end && "bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-baseline gap-x-2 text-micro text-ink-faint">
          <span>checkpoint</span>
          <time
            dateTime={commit.committedAt}
            title={format.dateTime(commit.committedAt)}
            className="tabular-nums"
          >
            {format.relative(commit.committedAt, asOf)}
          </time>
          {commit.machineName != null && <span>{commit.machineName}</span>}
          {commit.timeInSet != null && (
            <span className="tabular-nums">
              {format.timeInSet(commit.timeInSet)}
            </span>
          )}
          <EndMark end={end} />
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {renderCommitActions(commit)}
        </span>
      </span>
      {commit.chips.length > 0 && (
        <span className="text-ink-soft">
          <DiffChipList chips={commit.chips} />
        </span>
      )}
      {commit.saves.length > 0 && (
        <SavesFold label={foldLabel({ kind: "checkpoint", commit })!}>
          <SaveRows
            saves={commit.saves}
            format={format}
            ends={ends}
            renderSaveActions={renderSaveActions}
          />
        </SavesFold>
      )}
    </li>
  );
}

/**
 * A session's dit commits, newest first: each named commit a row with its
 * message, author, machine and time since, its chips against the previous
 * commit, a fold of the saves it covers and the actions the caller hands over.
 * Checkpoints arrive already folded or as quiet rows (`foldLog`). The page's
 * two uses draw the same rows: the history page's whole log and the session
 * page's first six.
 *
 * Server-renderable: the folds are native `<details>`, and everything that
 * needs a router or a click (the row actions, the older-commits button, the
 * ruler) is handed in or sits beside it. `renderCommitActions` and
 * `renderSaveActions` answer what each row offers; `marked` names the saves
 * being compared (`from`/`to`) so their rows say so. `asOf` fixes what "now"
 * is for the relative times, as `SaveTimeline`'s does.
 */
export function CommitLog({
  entries,
  uncommitted = [],
  format,
  // A server render runs once per request, so the wall clock read here is
  // stable for that render; client callers pass a value fixed at mount.
  // eslint-disable-next-line @eslint-react/purity
  asOf = new Date(),
  marked,
  renderCommitActions,
  renderSaveActions,
}: {
  entries: readonly LogEntry[];
  /** Saves no commit covers yet, newest first; they sit above the commits as their own fold. */
  uncommitted?: readonly LogSave[];
  format?: Formatters;
  asOf?: Date;
  /** The saves being compared. */
  marked?: { from?: number | null; to?: number | null };
  renderCommitActions: (commit: LogCommit) => ReactNode;
  renderSaveActions: (save: LogSave) => ReactNode;
}) {
  const formats = format ?? defaultFormatters();
  const ends = new Map<number, CompareEnd>();
  if (marked?.from != null) ends.set(marked.from, "from");
  if (marked?.to != null) ends.set(marked.to, "to");

  return (
    <ol className="flex flex-col">
      {uncommitted.length > 0 && (
        <li className="flex flex-col gap-1.5 border-t border-rule px-2 py-3">
          <SavesFold
            label={`${pluralizeCount(uncommitted.length, "save")} since the last commit`}
          >
            <SaveRows
              saves={uncommitted}
              format={formats}
              ends={ends}
              renderSaveActions={renderSaveActions}
            />
          </SavesFold>
        </li>
      )}
      {entries.map((entry) =>
        entry.kind === "commit" ? (
          <CommitRow
            key={entry.commit.id}
            entry={entry}
            format={formats}
            asOf={asOf}
            ends={ends}
            renderCommitActions={renderCommitActions}
            renderSaveActions={renderSaveActions}
          />
        ) : (
          <CheckpointRow
            key={entry.commit.id}
            commit={entry.commit}
            format={formats}
            asOf={asOf}
            ends={ends}
            renderCommitActions={renderCommitActions}
            renderSaveActions={renderSaveActions}
          />
        )
      )}
    </ol>
  );
}

/**
 * Saves with no commit at all, newest first, as rows: a session recorded before dit,
 * or a dit set nobody has committed. The log's save rows without the
 * commits above them.
 */
export function SaveLog({
  saves,
  format,
  marked,
  renderSaveActions,
}: {
  saves: readonly LogSave[];
  format?: Formatters;
  marked?: { from?: number | null; to?: number | null };
  renderSaveActions: (save: LogSave) => ReactNode;
}) {
  const ends = new Map<number, CompareEnd>();
  if (marked?.from != null) ends.set(marked.from, "from");
  if (marked?.to != null) ends.set(marked.to, "to");
  return (
    <div className="border-t border-rule">
      <SaveRows
        saves={saves}
        format={format ?? defaultFormatters()}
        ends={ends}
        renderSaveActions={renderSaveActions}
      />
    </div>
  );
}
