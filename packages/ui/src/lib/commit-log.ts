import type { SessionCommit, SessionSave } from "@workspace/api/api";
import { diffSaves, type DiffChip } from "@workspace/session-diff";
import type { Formatters } from "@workspace/ui/lib/formatters";
import { pluralizeCount } from "@workspace/session-diff/format";

/**
 * The commit log's model: a session's dit commits as rows of the history page
 * and the session page's History section. Pure, so the folding and the
 * comparison addresses can be checked without a DOM; the chips are computed
 * here, so a save's `meta` never has to reach the client.
 */

/** One save of a session as a log row draws it. */
export type LogSave = {
  id: number;
  fileUpdatedAt: string;
  machineName: string | null;
  source: SessionSave["source"];
  /** Whether the hub still holds the save's set: `pruned` once retention dropped it. */
  contentState: SessionSave["contentState"];
  /** Against the save before it on its branch; empty when that is not known. */
  chips: DiffChip[];
  /** The save before it on its branch, the `from` of its compare; null for the first. */
  previousId: number | null;
};

export type LogCommit = {
  id: number;
  hash: string;
  /** dit's eight hex characters. */
  shortId: string;
  message: string;
  kind: SessionCommit["kind"];
  /** The branch the commit is on. */
  branch: string;
  committedAt: string;
  machineName: string | null;
  authorName: string | null;
  /** The save the commit names as its own. */
  saveId: number;
  /** The previous commit's own save: the `from` of the commit's compare; null for the first. */
  baselineSaveId: number | null;
  /** The commit's difference from the previous commit's own save. */
  chips: DiffChip[];
  /** Whether `chips` could be worked out: false when the baseline lies beyond what was loaded. */
  chipsKnown: boolean;
  /** The saves the commit covers, newest first. */
  saves: LogSave[];
  samplesReferenced: number;
  samplesHeld: number;
  /** Seconds in the set over the commit's span; null when no time was counted for it. */
  timeInSet: number | null;
};

/** What a log row stands for: a named commit with the checkpoints folded under it, or a checkpoint on its own. */
export type LogEntry =
  | { kind: "commit"; commit: LogCommit; checkpoints: LogCommit[] }
  | { kind: "checkpoint"; commit: LogCommit };

/** How many commits the log loads at first, and the most "Older commits" ever loads. */
export const FIRST_COMMITS = 30;
export const MOST_COMMITS = 500;

/** The branch the history log shows; a commit on another has no row in it. */
export const LOG_BRANCH = "main";

/** The DOM id a commit's row carries, so the ruler can scroll the log to it. */
export const commitRowId = (commitId: number) => `commit-${commitId}`;

/** The DOM id a save's row carries. */
export const saveRowId = (saveId: number) => `save-${saveId}`;

export const shortId = (hash: string) => hash.slice(0, 8);

/** The command that brings a commit back as a new branch, as dit checks one out. */
export const ditCheckoutCommand = (hash: string) =>
  `dit checkout ${shortId(hash)} -b restore-${shortId(hash)}`;

/**
 * `historyHref` with two saves compared: `to` is the save the row stands for
 * and `from` the one before it, or just `to` when there is none (the page then
 * compares it with nothing). `historyHref` is the page's address as it is
 * shown, so any query it carries (`commits`, `checkpoints`) stays.
 */
export function compareHref(
  historyHref: string,
  fromId: number | null,
  toId: number
): string {
  return withCompare(historyHref, { fromId, toId });
}

/** `historyHref` with no comparison: `from` and `to` dropped, the rest kept. */
export function clearCompareHref(historyHref: string): string {
  return withCompare(historyHref, null);
}

function withCompare(
  historyHref: string,
  compare: { fromId: number | null; toId: number } | null
): string {
  const [path = "", query = ""] = historyHref.split("?");
  const params = new URLSearchParams(query);
  params.delete("from");
  params.delete("to");
  if (compare) {
    if (compare.fromId != null) params.set("from", String(compare.fromId));
    params.set("to", String(compare.toId));
  }
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

const byTime = (a: SessionSave, b: SessionSave) =>
  a.fileUpdatedAt < b.fileUpdatedAt
    ? -1
    : a.fileUpdatedAt > b.fileUpdatedAt
      ? 1
      : a.id - b.id;

/** Saves grouped by branch (saves with none, recorded before dit, among them), oldest first. */
function byBranch(saves: Iterable<SessionSave>): Map<number, SessionSave[]> {
  const groups = new Map<number, SessionSave[]>();
  for (const save of saves) {
    const key = save.branchId ?? 0;
    const group = groups.get(key);
    if (group) group.push(save);
    else groups.set(key, [save]);
  }
  for (const group of groups.values()) group.sort(byTime);
  return groups;
}

/** The save before `save` on its branch, when `branches` holds it. */
function previousOn(
  branches: ReadonlyMap<number, readonly SessionSave[]>,
  save: SessionSave
): SessionSave | undefined {
  const group = branches.get(save.branchId ?? 0) ?? [];
  const at = group.findIndex((candidate) => candidate.id === save.id);
  return at > 0 ? group[at - 1] : undefined;
}

/** A save as a log row draws it, worded against the save before it. */
function toLogSave(
  save: SessionSave,
  previous: SessionSave | undefined,
  capabilities: readonly string[] | undefined,
  format: Formatters | undefined
): LogSave {
  return {
    id: save.id,
    fileUpdatedAt: save.fileUpdatedAt,
    machineName: save.machineName,
    source: save.source,
    contentState: save.contentState,
    previousId: previous?.id ?? null,
    chips: save.meta
      ? diffSaves(previous?.meta ?? null, save.meta, capabilities, format)
      : [],
  };
}

/**
 * Every save of the session that was loaded, once each, newest first: the
 * `saves` list and the saves the loaded commits cover (a commit older than the
 * list reaches still brings its own).
 */
export function knownSaves(
  saves: readonly SessionSave[],
  commits: readonly SessionCommit[]
): SessionSave[] {
  const known = new Map<number, SessionSave>();
  for (const save of saves) known.set(save.id, save);
  for (const commit of commits) {
    for (const save of commit.saves) known.set(save.id, save);
  }
  return [...known.values()].sort((a, b) => byTime(b, a));
}

/**
 * Commits (newest first, as `GET /sessions/:id/commits` answers them) as log
 * commits, each worded against the one before it. `saves` are further saves
 * of the session (the history page's whole list): a commit's baseline is
 * found among them and the saves the commits cover, and one that lies beyond
 * both leaves its chips unknown rather than wrong.
 */
export function buildCommits({
  commits,
  saves = [],
  capabilities,
  format,
}: {
  commits: readonly SessionCommit[];
  saves?: readonly SessionSave[];
  capabilities?: readonly string[];
  format?: Formatters;
}): LogCommit[] {
  const branches = byBranch(knownSaves(saves, commits));

  return commits.flatMap((commit): LogCommit[] => {
    const covered = [...commit.saves].sort(byTime);
    const first = covered[0];
    const own =
      covered.findLast((save) => save.hash === commit.saveHash) ??
      covered.at(-1);
    // A commit covers at least its own save; one answered without any has no
    // save to place or compare, so it has no row.
    if (!first || !own) return [];
    const baseline = previousOn(branches, first);
    const chipsKnown = baseline != null || commit.parentHash == null;

    return [
      {
        id: commit.id,
        hash: commit.hash,
        shortId: shortId(commit.hash),
        message: commit.message,
        kind: commit.kind,
        branch: commit.branch,
        committedAt: commit.committedAt,
        machineName: commit.machineName,
        authorName: commit.authorName,
        saveId: own.id,
        baselineSaveId: baseline?.id ?? null,
        chips:
          own.meta && chipsKnown
            ? diffSaves(baseline?.meta ?? null, own.meta, capabilities, format)
            : [],
        chipsKnown,
        saves: covered
          .map((save) =>
            toLogSave(save, previousOn(branches, save), capabilities, format)
          )
          .reverse(),
        samplesReferenced: commit.samplesReferenced,
        samplesHeld: commit.samplesHeld,
        timeInSet: commit.timeInSet,
      },
    ];
  });
}

/**
 * The saves no commit covers, as log saves: those of the saves list that come
 * after the newest commit's own save on its branch (or with no branch, as saves recorded before dit), and
 * every save when there is no commit at all. Newest first.
 */
export function uncommittedSaves({
  commits,
  saves,
  capabilities,
  format,
}: {
  commits: readonly SessionCommit[];
  saves: readonly SessionSave[];
  capabilities?: readonly string[];
  format?: Formatters;
}): LogSave[] {
  const newest = commits[0];
  const covered = new Set(
    commits.flatMap((commit) => commit.saves.map((save) => save.id))
  );
  const ownNewest = newest?.saves.findLast(
    (save) => save.hash === newest.saveHash
  );
  const branches = byBranch(saves);

  return saves
    .filter(
      (save) =>
        !covered.has(save.id) &&
        (ownNewest == null ||
          ((save.branchId == null || save.branchId === ownNewest.branchId) &&
            byTime(save, ownNewest) > 0))
    )
    .map((save) =>
      toLogSave(save, previousOn(branches, save), capabilities, format)
    )
    .sort((a, b) =>
      a.fileUpdatedAt < b.fileUpdatedAt
        ? 1
        : a.fileUpdatedAt > b.fileUpdatedAt
          ? -1
          : b.id - a.id
    );
}

/**
 * The log's rows. Checkpoints fold under the next named commit (the newer
 * one), so a run of them reads as part of the commit that followed; those
 * newer than the newest named commit have none to fold under and stay as rows
 * of their own, as every checkpoint does when `showCheckpoints` is on.
 * `commits` and the result are newest first.
 */
export function foldLog(
  commits: readonly LogCommit[],
  showCheckpoints: boolean
): LogEntry[] {
  if (showCheckpoints) {
    return commits.map((commit) =>
      commit.kind === "checkpoint"
        ? { kind: "checkpoint", commit }
        : { kind: "commit", commit, checkpoints: [] }
    );
  }

  const entries: LogEntry[] = [];
  let pending: LogCommit[] = [];
  // Oldest first, so each checkpoint is waiting when its named commit arrives.
  for (const commit of [...commits].reverse()) {
    if (commit.kind === "checkpoint") {
      pending.push(commit);
    } else {
      entries.push({ kind: "commit", commit, checkpoints: pending.reverse() });
      pending = [];
    }
  }
  // Whatever is left is newer than every named commit, still oldest first.
  const quiet = pending
    .reverse()
    .map((commit): LogEntry => ({ kind: "checkpoint", commit }));
  return [...quiet, ...entries.reverse()];
}

/** How many saves a row folds: its own and those of the checkpoints beneath it. */
export const foldedSaveCount = (entry: LogEntry): number =>
  entry.commit.saves.length +
  (entry.kind === "commit"
    ? entry.checkpoints.reduce((sum, commit) => sum + commit.saves.length, 0)
    : 0);

/**
 * The time a row stands for: its own and that of the checkpoints beneath it,
 * since a named row covers everything since the previous named commit. Null
 * when none of them has a time.
 */
export function foldedTimeInSet(entry: LogEntry): number | null {
  const times = [
    entry.commit,
    ...(entry.kind === "commit" ? entry.checkpoints : []),
  ].flatMap((commit) => (commit.timeInSet == null ? [] : [commit.timeInSet]));
  return times.length === 0 ? null : times.reduce((sum, t) => sum + t, 0);
}

/** "3 saves" or "2 checkpoints · 14 saves"; null when the row folds nothing. */
export function foldLabel(entry: LogEntry): string | null {
  const saves = foldedSaveCount(entry);
  if (saves === 0) return null;
  const count = pluralizeCount(saves, "save");
  return entry.kind === "commit" && entry.checkpoints.length > 0
    ? `${pluralizeCount(entry.checkpoints.length, "checkpoint")} · ${count}`
    : count;
}
