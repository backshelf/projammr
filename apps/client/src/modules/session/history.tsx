import {
  getSessionCommits,
  getSessionPresence,
  getSessionSaves,
} from "@/actions/sessions";
import { CompareControls } from "@/components/session/CompareControls";
import { holderOfSession } from "@/components/session/open-in-daw";
import { HistoryRuler } from "@/components/session/HistoryRuler";
import {
  OlderCommits,
  ShowCheckpointsToggle,
} from "@/components/session/LogControls";
import {
  SessionCommitLog,
  SessionSaveLog,
} from "@/components/session/SessionCommitLog";
import {
  buildCommits,
  FIRST_COMMITS,
  foldLog,
  knownSaves,
  LOG_BRANCH,
  MOST_COMMITS,
  uncommittedSaves,
} from "@workspace/ui/lib/commit-log";
import {
  SaveDiffCard,
  stampOf,
} from "@workspace/ui/components/session-structure/save-diff-card";
import {
  SaveDiffControls,
  SaveDiffModeSwitch,
  SaveDiffStepper,
} from "@workspace/ui/components/session-structure/save-diff-controls";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { artVarsFromArtwork } from "@/lib/art";
import { changedTrackCount, diffSave } from "@workspace/session-diff";
import {
  cachedCollection,
  cachedProject,
  cachedSession,
} from "@/lib/server-data";
import { cachedFormatters } from "@/lib/formatters";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { pluralizeCount } from "@workspace/session-diff/format";
import { searchParam, type RouteSearchParams } from "@/modules/route-module";
import type { SaveMeta, SessionSave } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { roleSatisfies } from "@/lib/roles";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { PAGE } from "@workspace/ui/lib/shell";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

/** The saves the page loads: the ruler and the compare pickers read them. */
const SAVES_LIMIT = 500;

function numberParam(value: string | string[] | undefined): number | undefined {
  const raw = searchParam(value);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function SessionHistoryPage({
  projectId,
  collectionId,
  trackId,
  sessionId,
  searchParams,
}: {
  projectId: number;
  collectionId?: number;
  trackId?: number;
  sessionId: number;
  searchParams: RouteSearchParams;
}) {
  // "Older commits" asks for the most the page ever shows; anything else is the first thirty.
  const commitLimit =
    numberParam(searchParams.commits) === MOST_COMMITS
      ? MOST_COMMITS
      : FIRST_COMMITS;
  const showCheckpoints = searchParam(searchParams.checkpoints) === "1";

  const [
    projectResult,
    sessionResult,
    collectionResult,
    savesResult,
    commitsResult,
    presenceResult,
    format,
  ] = await Promise.all([
    cachedProject(projectId),
    cachedSession(sessionId),
    collectionId ? cachedCollection(collectionId) : undefined,
    getSessionSaves(sessionId, SAVES_LIMIT),
    getSessionCommits(sessionId, { branch: LOG_BRANCH, limit: commitLimit }),
    getSessionPresence(sessionId),
    cachedFormatters(projectId),
  ]);

  const project = loaded(projectResult);
  const session = loaded(sessionResult);
  const collection = collectionResult ? loaded(collectionResult) : undefined;

  const track = session.track ?? undefined;
  const savesError = isActionError(savesResult) ? savesResult.error : null;
  const commitsError = isActionError(commitsResult)
    ? commitsResult.error
    : null;
  const historyError = commitsError ?? savesError;
  const saves: SessionSave[] = isActionError(savesResult) ? [] : savesResult;
  const commits = isActionError(commitsResult) ? [] : commitsResult;
  const renderedAt = new Date().toISOString();
  const holder = holderOfSession(presenceResult);
  const canEdit = roleSatisfies(project.role, "editor");

  // The saves the page loaded plus those its commits cover, so a compare of a
  // commit older than the saves list reaches still resolves.
  const known = knownSaves(saves, commits);
  const byId = new Map(known.map((save, index) => [save.id, index]));

  // An id that names no save of this session that was loaded is dropped
  // rather than trusted, so a stale or hand-edited link degrades to the plain
  // page instead of a broken compare.
  let toId = numberParam(searchParams.to);
  if (toId != null && !byId.has(toId)) toId = undefined;
  let fromId = numberParam(searchParams.from);
  if (fromId != null && !byId.has(fromId)) fromId = undefined;

  // `to` alone — or a `from` that is not actually older than `to` — falls
  // back to the save right before it, the next entry down in a newest-first
  // list.
  if (toId != null) {
    const toIndex = byId.get(toId)!;
    if (fromId != null && byId.get(fromId)! <= toIndex) fromId = undefined;
    if (fromId == null) fromId = known[toIndex + 1]?.id;
  }

  const toSave = toId != null ? known[byId.get(toId)!] : undefined;
  const fromSave = fromId != null ? known[byId.get(fromId)!] : undefined;

  const comparable = fromSave?.meta != null;
  const diff =
    toSave?.meta != null
      ? diffSave(
          comparable ? fromSave.meta : null,
          toSave.meta as SaveMeta,
          session.dawCapabilities,
          format
        )
      : undefined;

  const historyHref = hrefFromParsedRoute(
    { kind: "session-history", sessionId, trackId, collectionId },
    projectId
  );

  // The address as the page is shown, so a compare link keeps what the page
  // was opened with (`commits`, `checkpoints`) and swaps only `from` and `to`.
  const shownQuery = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const part of [value ?? []].flat()) shownQuery.append(name, part);
  }
  const shownHref =
    shownQuery.size > 0 ? `${historyHref}?${shownQuery}` : historyHref;

  const { history } = session;
  const lede = (() => {
    if (history.saves === 0) return "No saves yet.";
    const stats = [
      history.commits > 0 ? pluralizeCount(history.commits, "commit") : null,
      pluralizeCount(history.saves, "save"),
      history.machines > 0 ? pluralizeCount(history.machines, "machine") : null,
      history.firstSeenAt != null
        ? `first seen ${format.date(history.firstSeenAt)}`
        : null,
      history.timeInSet > 0
        ? `${format.timeInSet(history.timeInSet)} in the set`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return stats;
  })();

  const logCommits = buildCommits({
    commits,
    saves,
    capabilities: session.dawCapabilities,
    format,
  });
  const entries = foldLog(logCommits, showCheckpoints);
  const uncommitted = uncommittedSaves({
    commits,
    saves,
    capabilities: session.dawCapabilities,
    format,
  });
  const hasCheckpoints = logCommits.some(
    (commit) => commit.kind === "checkpoint"
  );

  const marked = { from: fromId, to: toId };

  // A commit's own save is named by the commit, so the pickers read as the log does.
  const commitOfSave = new Map(logCommits.map((c) => [c.saveId, c.message]));
  const compareOptions = known.map((save) => {
    const when = format.dateTime(save.fileUpdatedAt);
    const named = commitOfSave.get(save.id);
    return { id: save.id, label: named ? `${when} · ${named}` : when };
  });

  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[
              ...createBreadcrumbs(project, { collection, track, session }),
              { label: "History", href: historyHref },
            ]}
          />
        }
        title={session.name}
        lede={lede}
        action={
          hasCheckpoints && <ShowCheckpointsToggle shown={showCheckpoints} />
        }
      />
      {history.saves > 0 && (
        // The ruler's marks take the session's own colour, as the compare does.
        <div style={artVarsFromArtwork(session.artwork)}>
          <HistoryRuler
            commits={logCommits.map(
              ({
                id,
                kind,
                message,
                authorName,
                machineName,
                committedAt,
                saveId,
                baselineSaveId,
              }) => ({
                id,
                kind,
                message,
                authorName,
                machineName,
                committedAt,
                saveId,
                baselineSaveId,
              })
            )}
            saves={saves.map(({ id, fileUpdatedAt, machineName }) => ({
              id,
              fileUpdatedAt,
              machineName,
            }))}
            marked={marked}
            historyHref={shownHref}
            now={renderedAt}
          />
        </div>
      )}
      {diff && toSave && (
        // Lit by the session's own artwork, as the session page is, so the
        // additions read in its colour.
        <div style={artVarsFromArtwork(session.artwork)}>
          <SectionHead>COMPARING</SectionHead>
          <SaveDiffControls
            key={`${fromSave?.id ?? "first"}:${toSave.id}`}
            changes={changedTrackCount(diff.structure)}
            defaultMode="changes"
          >
            <SaveDiffCard
              diff={diff}
              saves={{
                before: comparable ? stampOf(fromSave) : null,
                after: stampOf(toSave),
              }}
              daw={toSave.meta?.dawVersion ?? session.dawName ?? session.daw}
              format={format}
              when={
                <CompareControls
                  options={compareOptions}
                  fromId={fromId}
                  toId={toId}
                />
              }
              actions={
                <>
                  <SaveDiffModeSwitch />
                  <SaveDiffStepper />
                </>
              }
            />
          </SaveDiffControls>
        </div>
      )}
      {(history.saves > 0 || historyError != null) && (
        <section>
          <SectionHead>LOG</SectionHead>
          {historyError != null ? (
            <p role="alert" className="text-small text-danger">
              Couldn&apos;t load session history: {historyError}
            </p>
          ) : commits.length === 0 ? (
            <>
              <p className="mb-3 text-small text-ink-soft">
                Every save is here. Name one with dit to make it a commit.
              </p>
              <SessionSaveLog
                saves={uncommitted}
                historyHref={shownHref}
                retentionDays={session.history.contentRetentionDays}
                format={format}
                marked={marked}
              />
            </>
          ) : (
            <>
              <SessionCommitLog
                entries={entries}
                uncommitted={uncommitted}
                historyHref={shownHref}
                canEdit={canEdit}
                restoreOn={holder?.name ?? null}
                retentionDays={session.history.contentRetentionDays}
                format={format}
                marked={marked}
              />
              <OlderCommits shown={commits.length} limit={commitLimit} />
            </>
          )}
        </section>
      )}
    </ScrollRoot>
  );
}
