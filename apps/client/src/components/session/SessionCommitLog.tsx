import { CommitRowActions } from "@/components/session/CommitRowActions";
import { SaveRowActions } from "@/components/session/SaveRowActions";
import {
  CommitLog,
  SaveLog,
} from "@workspace/ui/components/session-structure/commit-log";
import type { LogEntry, LogSave } from "@workspace/ui/lib/commit-log";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The commit log with this app's row actions: the history page's whole log and
 * the session page's first six rows draw through it, so a row offers the same
 * thing wherever it sits.
 */
export function SessionCommitLog({
  entries,
  uncommitted,
  historyHref,
  canEdit,
  restoreOn,
  retentionDays,
  format,
  marked,
}: {
  entries: readonly LogEntry[];
  uncommitted?: readonly LogSave[];
  historyHref: string;
  canEdit: boolean;
  restoreOn: string | null;
  retentionDays: number;
  format: Formatters;
  marked?: { from?: number | null; to?: number | null };
}) {
  return (
    <CommitLog
      entries={entries}
      uncommitted={uncommitted}
      format={format}
      marked={marked}
      renderCommitActions={(commit) => (
        <CommitRowActions
          commit={commit}
          historyHref={historyHref}
          canEdit={canEdit}
          restoreOn={restoreOn}
        />
      )}
      renderSaveActions={(save) => (
        <SaveRowActions
          save={save}
          historyHref={historyHref}
          retentionDays={retentionDays}
        />
      )}
    />
  );
}

/** Saves with no commit, as rows with this app's save actions. */
export function SessionSaveLog({
  saves,
  historyHref,
  retentionDays,
  format,
  marked,
}: {
  saves: readonly LogSave[];
  historyHref: string;
  retentionDays: number;
  format: Formatters;
  marked?: { from?: number | null; to?: number | null };
}) {
  return (
    <SaveLog
      saves={saves}
      format={format}
      marked={marked}
      renderSaveActions={(save) => (
        <SaveRowActions
          save={save}
          historyHref={historyHref}
          retentionDays={retentionDays}
        />
      )}
    />
  );
}
