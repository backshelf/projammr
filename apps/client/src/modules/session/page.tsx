import { cn } from "@workspace/ui/lib/utils";
import { roleSatisfies } from "@/lib/roles";
import { BODY, CANVAS, MASTHEAD_AREA } from "@/components/layout/shell";
import { getProjectSamples } from "@/actions/projects";
import {
  getSessionCommits,
  getSessionPresence,
  getSessionSaves,
} from "@/actions/sessions";
import {
  cachedCollection,
  cachedProject,
  cachedSession,
} from "@/lib/server-data";
import { IconStarFilled } from "@tabler/icons-react";
import { ArtProvider } from "@/components/art/ArtProvider";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import CommentSection from "@/components/comments/CommentSection";
import Description from "@/components/editing/Description";
import InlinePropertyEditor from "@/components/editing/InlinePropertyEditor";
import InlineTitleEditor from "@/components/editing/InlineTitleEditor";
import MainToggle from "@/components/session/MainToggle";
import { SessionSamples } from "@/components/session/SessionSamples";
import { Masthead } from "@/components/masthead/Masthead";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { OpenInDawButton } from "@/components/session/OpenInDawButton";
import { OpenInLiveFlag } from "@/components/session/OpenInLiveFlag";
import { holderOfSession } from "@/components/session/open-in-daw";
import RightSideBlur from "@/components/layout/RightSideBlur";
import { AppLink } from "@/components/navigation/AppLink";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import {
  RailBlock,
  RailIdentity,
  RailLabel,
} from "@workspace/ui/components/layout/rail";
import {
  AddLine,
  EmptySection,
  SectionFold,
} from "@workspace/ui/components/layout/empty-section";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { isBlankStoredDocument } from "@workspace/ui/lib/block-document";
import { cachedFormatters } from "@/lib/formatters";
import { cachedPolicies } from "@/lib/policies/server";
import { PageSections } from "@/components/layout/PageSections";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { changedTrackCount, diffSave } from "@workspace/session-diff";
import { dawCanReport, structureEmptyLabel } from "@/lib/daw";
import { saveBefore } from "@/lib/save-before";
import {
  SessionCommitLog,
  SessionSaveLog,
} from "@/components/session/SessionCommitLog";
import {
  buildCommits,
  FIRST_COMMITS,
  foldLog,
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
import type { SaveMeta } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { Suspense } from "react";

/** How many saves the session page shows before pointing at the history page. */
const VISIBLE_SAVES = 6;

/** How many log rows the History section shows before pointing at the history page. */
const LOG_ROWS = 6;

export default async function SessionPage({
  projectId,
  collectionId,
  trackId,
  sessionId,
}: {
  projectId: number;
  collectionId?: number;
  trackId?: number;
  sessionId: number;
}) {
  const projectProm = cachedProject(projectId);
  const collectionProm = collectionId
    ? cachedCollection(collectionId)
    : undefined;
  const sessionProm = cachedSession(sessionId);
  // One extra save is fetched only to be the last shown save's baseline; the
  // structure card and the history share the one list.
  const savesProm = getSessionSaves(sessionId, VISIBLE_SAVES + 1);
  // The History section's log: the commits of `main`, beside the session.
  const commitsProm = getSessionCommits(sessionId, {
    branch: "main",
    limit: FIRST_COMMITS,
  });
  // Who on this user's machines tracks the repo and can open or restore it.
  const presenceProm = getSessionPresence(sessionId);

  // Started here so the reach counts load beside the session, not after it.
  const samplesProm = getProjectSamples(projectId);

  const [
    projectResult,
    sessionResult,
    collectionResult,
    savesResult,
    commitsResult,
    presenceResult,
    samplesResult,
    format,
    { shell },
  ] = await Promise.all([
    projectProm,
    sessionProm,
    collectionProm,
    savesProm,
    commitsProm,
    presenceProm,
    samplesProm,
    cachedFormatters(projectId),
    cachedPolicies(projectId),
  ]);

  const project = loaded(projectResult);
  const session = loaded(sessionResult);
  const collection = collectionResult ? loaded(collectionResult) : undefined;
  const saves = isActionError(savesResult) ? [] : savesResult;
  const commits = isActionError(commitsResult) ? [] : commitsResult;
  const holder = holderOfSession(presenceResult);

  const canEdit = roleSatisfies(project.role, "editor");
  const createdAt = new Date(session.createdAt);
  const updatedAt = new Date(session.updatedAt);

  // A session is not always assigned to a track.
  const track = session.track ?? undefined;

  const musicalKey = format.key(session.rootNote, session.scale);
  const tempo =
    session.tempo == null ? null : format.tempo(session.tempo, { unit: true });

  const dawDisplayName = session.dawName ?? session.daw;

  // A field a DAW never reports stays off the rail entirely — showing it
  // with "Not set" reads as pending, as though scanning again could fill it
  // in. `SCENES` folds away on the same reasoning, but by whether the DAW
  // actually reported a count rather than by its declared capabilities.
  const dawMetadata: { label: string; value: string | number | null }[] = [
    { label: "DAW", value: dawDisplayName },
    ...(dawCanReport(session, "tempo")
      ? [{ label: "TEMPO", value: tempo }]
      : []),
    ...(dawCanReport(session, "timeSignature")
      ? [{ label: "TIME SIGNATURE", value: session.timeSignature }]
      : []),
    ...(dawCanReport(session, "key")
      ? [{ label: "KEY", value: musicalKey }]
      : []),
    ...(dawCanReport(session, "structure")
      ? [{ label: "TRACKS", value: session.tracksCount }]
      : []),
    ...(session.scenesCount == null
      ? []
      : [{ label: "SCENES", value: session.scenesCount }]),
    ...(dawCanReport(session, "dawVersion")
      ? [{ label: "DAW VERSION", value: session.dawVersion }]
      : []),
  ];

  const samplePaths = session.samples?.map((s) => s.path) ?? [];
  const hasSamples = samplePaths.length > 0;
  const usage = isActionError(samplesResult) ? undefined : samplesResult;

  // A session is a file in a DAW, so the DAW is what identifies it; the
  // tempo and key say what is in the file without opening it.
  // A set dit records has no local file time, so its newest save's time says
  // when it was last saved.
  const savedAt = session.localFileUpdatedAt ?? saves[0]?.fileUpdatedAt;
  const byline = [
    dawDisplayName,
    tempo,
    musicalKey,
    savedAt ? `saved ${format.relative(savedAt)}` : null,
  ].filter(Boolean);

  const sessionAsMeta: SaveMeta = {
    tempo: session.tempo,
    timeSignature: session.timeSignature,
    rootNote: session.rootNote,
    scale: session.scale,
    tracksCount: session.tracksCount,
    scenesCount: session.scenesCount,
    dawVersion: session.dawVersion,
    samplePaths,
    structure: session.structure,
  };

  const historyHref = hrefFromParsedRoute(
    { kind: "session-history", sessionId, trackId, collectionId },
    projectId
  );

  // The set as the session holds it, against the save recorded before its
  // current file. The session is what the section's count and clip totals
  // read, and a rescan refreshes it even when the file's save time has not
  // moved, where a recorded save keeps the reading it was first given. A
  // save with nothing recorded before it (or no metadata to compare) is a
  // first save.
  const previous = saveBefore(saves, session.localFileUpdatedAt);
  const comparable = previous?.meta != null;
  const latestSave = diffSave(
    comparable ? previous.meta : null,
    sessionAsMeta,
    session.dawCapabilities,
    format
  );
  const latestSaves = {
    before: comparable ? stampOf(previous) : null,
    after: {
      at: session.localFileUpdatedAt ?? session.updatedAt,
      machine: session.localFileMachineName,
    },
  };

  return (
    <ArtProvider
      artwork={session.artwork}
      className={cn(CANVAS, "h-full w-full max-w-full overflow-y-auto")}
    >
      <Masthead
        className={MASTHEAD_AREA}
        crumbs={
          <Breadcrumbs
            crumbs={createBreadcrumbs(project, { collection, track, session })}
          />
        }
        eyebrow={
          session.main ? (
            <>
              <IconStarFilled
                size={11}
                aria-hidden
                className="mr-1 inline-block align-[-1px]"
              />
              Main session
            </>
          ) : (
            "Session"
          )
        }
        compact
        title={
          <InlineTitleEditor
            value={session.name}
            entityType="session"
            entityId={sessionId}
            fieldName="name"
          />
        }
        byline={
          <>
            {byline.length > 0 && <span>{byline.join(" · ")}</span>}
            <OpenInLiveFlag openOn={session.openOn} />
            {session.archived && <ArchivedFlag />}
          </>
        }
      />
      <div className={BODY}>
        <SectionFold>
          <PageSections
            order={shell.entityPageSections.session}
            sections={{
              notes: (
                <EmptySection
                  label={"NOTES"}
                  empty={isBlankStoredDocument(session.notes)}
                  add={canEdit ? "Notes" : undefined}
                >
                  <Description
                    entityType="session"
                    entityId={session.id}
                    fieldName="notes"
                    text={session.notes ? JSON.stringify(session.notes) : ""}
                    label="NOTES"
                  />
                </EmptySection>
              ),
              structure: (
                <EmptySection
                  label={"STRUCTURE"}
                  empty={!session.structure}
                  emptyLabel={structureEmptyLabel(session)}
                >
                  {session.structure && (
                    <section>
                      <SectionHead
                        count={session.structure.tracks.length}
                        action={
                          session.structure.clips && (
                            <span className="text-micro text-ink-soft">
                              {format.number(session.structure.clips.audio)}{" "}
                              audio ·{" "}
                              {format.number(session.structure.clips.midi)} midi
                              clips
                            </span>
                          )
                        }
                      >
                        STRUCTURE
                      </SectionHead>
                      <SaveDiffControls
                        key={`${previous?.id ?? "first"}:${session.localFileUpdatedAt ?? "none"}`}
                        changes={changedTrackCount(latestSave.structure)}
                        defaultMode="whole"
                      >
                        <SaveDiffCard
                          diff={latestSave}
                          saves={latestSaves}
                          daw={session.dawVersion ?? dawDisplayName}
                          format={format}
                          actions={
                            <>
                              <SaveDiffModeSwitch />
                              <SaveDiffStepper />
                            </>
                          }
                        />
                      </SaveDiffControls>
                    </section>
                  )}
                </EmptySection>
              ),
              attachments: (
                <EmptySection
                  label={"ATTACHMENTS"}
                  empty={session.attachments.length === 0}
                  add={canEdit ? "Attachment" : undefined}
                >
                  <section>
                    <SectionHead>ATTACHMENTS</SectionHead>
                    <AttachmentList
                      attachments={session.attachments}
                      attachTo={"session"}
                      parentId={sessionId}
                      trackId={session.trackId}
                    />
                  </section>
                </EmptySection>
              ),
              samples: (
                <EmptySection
                  label={"SAMPLES"}
                  empty={
                    // A set in a dit repo reports its references whatever its
                    // DAW's module says it can.
                    (!dawCanReport(session, "samplePaths") &&
                      session.repoId == null) ||
                    !hasSamples
                  }
                >
                  <SessionSamples
                    session={session}
                    usage={usage}
                    defaults={shell.inventoryDefaults.samples}
                  />
                </EmptySection>
              ),
              history: (
                <EmptySection
                  label={"HISTORY"}
                  empty={session.saveCount === 0}
                  emptyLabel={"No saves yet"}
                >
                  <section>
                    <SectionHead
                      count={
                        commits.length > 0
                          ? session.history.commits
                          : session.saveCount
                      }
                      action={
                        (commits.length > 0
                          ? session.history.commits > LOG_ROWS
                          : session.saveCount > VISIBLE_SAVES) && (
                          <AppLink
                            href={historyHref}
                            className="text-micro text-ink-soft hover:text-ink"
                          >
                            {commits.length > 0
                              ? `All ${session.history.commits} commits`
                              : `All ${session.saveCount} saves`}
                          </AppLink>
                        )
                      }
                    >
                      HISTORY
                    </SectionHead>
                    {commits.length > 0 ? (
                      <SessionCommitLog
                        entries={foldLog(
                          buildCommits({
                            commits,
                            capabilities: session.dawCapabilities,
                            format,
                          }),
                          false
                        ).slice(0, LOG_ROWS)}
                        historyHref={historyHref}
                        canEdit={canEdit}
                        restoreOn={holder?.name ?? null}
                        retentionDays={session.history.contentRetentionDays}
                        format={format}
                      />
                    ) : (
                      <SessionSaveLog
                        saves={uncommittedSaves({
                          commits,
                          saves,
                          capabilities: session.dawCapabilities,
                          format,
                        }).slice(0, VISIBLE_SAVES)}
                        historyHref={historyHref}
                        retentionDays={session.history.contentRetentionDays}
                        format={format}
                      />
                    )}
                  </section>
                </EmptySection>
              ),
              comments: (
                <Suspense fallback={null}>
                  <CommentSection entityType="session" entityId={sessionId} />
                </Suspense>
              ),
              add: <AddLine label={"Add to this session"} />,
            }}
          />
        </SectionFold>
      </div>
      <RightSideBlur
        more={
          <>
            <RailBlock>
              <InlinePropertyEditor
                label="LOCAL FILEPATH"
                value={session.localFilepath || undefined}
                type="text"
                entityType="session"
                entityId={sessionId}
                fieldName="localFilepath"
                placeholder="/path/to/project"
                copyable
              />
              <RailLabel>FILE CREATED AT</RailLabel>
              <MetadataItem>
                {session.localFileCreatedAt &&
                  format.dateTime(session.localFileCreatedAt)}
              </MetadataItem>
            </RailBlock>
            <RailBlock rows>
              <div>
                <RailLabel>CREATED</RailLabel>
                <MetadataItem>{format.dateTime(createdAt)}</MetadataItem>
              </div>
              <div>
                <RailLabel>UPDATED</RailLabel>
                <MetadataItem>{format.dateTime(updatedAt)}</MetadataItem>
              </div>
            </RailBlock>
          </>
        }
      >
        <RailIdentity
          title={session.name}
          subtitle={
            track ? (
              <AppLink
                href={hrefFromParsedRoute(
                  { kind: "track", trackId: track.id, collectionId },
                  projectId
                )}
                className="motion-ink hover:text-ink"
              >
                {track.title}
              </AppLink>
            ) : (
              dawDisplayName
            )
          }
        />
        <RailBlock>
          <MainToggle
            sessionId={sessionId}
            isMain={session.main}
            canEdit={canEdit}
          />
        </RailBlock>
        <RailBlock grid>
          <div>
            <RailLabel>MACHINE</RailLabel>
            <MetadataItem>{session.localFileMachineName}</MetadataItem>
          </div>
          <div>
            <RailLabel>FILE MODIFIED</RailLabel>
            <MetadataItem>
              {session.localFileUpdatedAt &&
                format.dateTime(session.localFileUpdatedAt)}
            </MetadataItem>
          </div>
        </RailBlock>
        <RailBlock grid>
          {dawMetadata.map(({ label, value }) => (
            <div key={label}>
              <RailLabel>{label}</RailLabel>
              <MetadataItem>{value}</MetadataItem>
            </div>
          ))}
        </RailBlock>
        {session.repoId != null && session.repoName != null && (
          <RepositoryRail
            projectId={projectId}
            repoId={session.repoId}
            repoName={session.repoName}
          />
        )}
        {session.history.timeInSet > 0 && (
          <TimeInSetRail label={format.timeInSet(session.history.timeInSet)} />
        )}
        <RailBlock>
          <OpenInDawButton sessionId={sessionId} holder={holder} />
        </RailBlock>
      </RightSideBlur>
    </ArtProvider>
  );
}

/** The rail's Time in the set row: what dit has counted across every commit of the set. */
function TimeInSetRail({ label }: { label: string }) {
  return (
    <RailBlock>
      <RailLabel>TIME IN THE SET</RailLabel>
      <MetadataItem>{label}</MetadataItem>
    </RailBlock>
  );
}

/** The rail's Repository row: the dit repo holding this session's set, linked to its page. */
function RepositoryRail({
  projectId,
  repoId,
  repoName,
}: {
  projectId: number;
  repoId: number;
  repoName: string;
}) {
  return (
    <RailBlock>
      <RailLabel>REPOSITORY</RailLabel>
      <MetadataItem>
        <AppLink
          href={hrefFromParsedRoute({ kind: "repo", repoId }, projectId)}
          className="motion-ink hover:text-ink-soft"
        >
          {repoName}
        </AppLink>
      </MetadataItem>
    </RailBlock>
  );
}
