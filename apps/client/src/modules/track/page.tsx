import { roleSatisfies } from "@/lib/roles";
import { cn } from "@workspace/ui/lib/utils";
import { BODY, CANVAS, MASTHEAD_AREA, SPLIT } from "@/components/layout/shell";
import { getLabels } from "@/actions/labels";
import { getPriorityLevels } from "@/actions/priorities";
import { getProjectArtists, getSessionDaws } from "@/actions/projects";
import { getMachines, getSessionsPageForProject } from "@/actions/sessions";
import { getStatuses } from "@/actions/statuses";
import { getTracksForCollection } from "@/actions/tracks";
import {
  cachedCollection,
  cachedCustomFields,
  cachedProject,
  cachedTrack,
} from "@/lib/server-data";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { LinkToDialog } from "@/components/product-linking/LinkToDialog";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import CommentSection from "@/components/comments/CommentSection";
import Description from "@/components/editing/Description";
import { ImageUploader } from "@/components/uploads/ImageUploader";
import { CustomFieldsBlock } from "@/components/editing/CustomFieldsBlock";
import InlinePropertyEditor from "@/components/editing/InlinePropertyEditor";
import InlineTitleEditor from "@/components/editing/InlineTitleEditor";
import { ArtProvider } from "@/components/art/ArtProvider";
import { EntitySurfaceProvider } from "@/components/commands/entity-surface";
import { TrackLoudness } from "@/components/loudness/TrackLoudness";
import { TrackSpectrum } from "@/components/spectrum/TrackSpectrum";
import { Masthead } from "@/components/masthead/Masthead";
import { NowPlayingFlag } from "@/components/masthead/NowPlayingFlag";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { StatusChip } from "@workspace/ui/components/status-chip";

import RightSideBlur from "@/components/layout/RightSideBlur";
import { AppLink } from "@/components/navigation/AppLink";
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
import { EntityTable } from "@/components/tables/EntityTable";
import { SharingRail } from "@/components/sharing/SharingRail";
import { StatusDisplay } from "@/components/status/StatusDisplay";
import { StatusDropdown } from "@/components/status/StatusDropdown";
import { DetectedMeta } from "@/components/track-audio/DetectedMeta";
import { TrackAudioProvider } from "@/components/track-audio/TrackAudioContext";
import { TrackAudioSection } from "@/components/track-audio/TrackAudioSection";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { TrackArtists } from "@/components/track/TrackArtists";
import { TrackExplicitToggle } from "@/components/track/TrackExplicitToggle";
import { TrackLabelsSection } from "@/components/track/TrackLabelsSection";
import {
  TrackRailActions,
  UnarchiveAction,
} from "@/components/track/TrackLifecycle";
import { TrackLyrics } from "@/components/track/TrackLyrics";
import { TrackPrioritySection } from "@/components/track/TrackPrioritySection";
import { TrackRelationsSection } from "@/components/track/TrackRelationsSection";
import { TrackRunningOrder } from "@/components/track/TrackRunningOrder";
import { runningOrder } from "@/components/track/running-order";
import { TrackWorkHeatmap } from "@/components/work-heatmap/TrackWorkHeatmap";
import { getTrackRepos } from "@/actions/repos";
import { RepositoriesSection } from "@/components/repo/RepositoriesSection";
import { cachedFormatters } from "@/lib/formatters";
import { cachedPolicies } from "@/lib/policies/server";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { PageSections } from "@/components/layout/PageSections";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { IconPlus } from "@tabler/icons-react";
import { TableSkeleton } from "@/components/tables/TableSkeleton";
import type { Label, PriorityScaleLevel } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { Button } from "@workspace/ui/components/button";
import { type ReactNode, Suspense } from "react";
import { Arrive } from "@workspace/ui/components/layout/arrive";

export default async function TrackPage({
  projectId,
  trackId,
  collectionId,
}: {
  projectId: number;
  trackId: number;
  collectionId?: number;
}) {
  const [
    projectResult,
    trackResult,
    collectionResult,
    labelsResult,
    levelsResult,
    customFields,
    siblingTracksResult,
    format,
    { shell },
    settings,
  ] = await Promise.all([
    cachedProject(projectId),
    cachedTrack(trackId),
    collectionId ? cachedCollection(collectionId) : undefined,
    getLabels(projectId),
    getPriorityLevels(projectId),
    cachedCustomFields(projectId, "track"),
    // The track's position belongs to its membership of a collection, not to
    // the track, so it only exists when the page was reached through one.
    collectionId ? getTracksForCollection(collectionId) : undefined,
    cachedFormatters(projectId),
    cachedPolicies(projectId),
    cachedEffectiveSettings(projectId),
  ]);

  const project = loaded(projectResult);
  const track = loaded(trackResult);
  const collection = collectionResult ? loaded(collectionResult) : undefined;

  // The sessions table and the collection picker fetch behind their own
  // boundaries, so the masthead and rail paint without waiting on them.
  const statusProm = getStatuses(projectId);
  // The track's own sessions list, so an archived track still shows them.
  const sessionsPagePromise = getSessionsPageForProject(projectId, {
    track: trackId,
    archived: "include",
    pageSize: settings.values["tables.rowsPerLoad"],
  });
  const dawsPromise = getSessionDaws(projectId);
  const machinesPromise = getMachines();
  const reposPromise = getTrackRepos(trackId);

  const projectLabels = isActionError(labelsResult) ? [] : labelsResult;
  const priorityLevels = isActionError(levelsResult) ? [] : levelsResult;

  const canEdit = roleSatisfies(project.role, "editor");
  const archived = track.archivedAt !== null;
  const trackRef = { projectId, trackId, title: track.title };

  const sessionsAction = canEdit ? (
    <Button variant="ghost" size={"icon-sm"} className="h-fit" asChild>
      <AppLink
        href={hrefFromParsedRoute(
          { kind: "session-new", collectionId, trackId },
          projectId
        )}
        aria-label="New session"
      >
        <IconPlus />
      </AppLink>
    </Button>
  ) : undefined;

  const createdAt = new Date(track.createdAt);
  const updatedAt = new Date(track.updatedAt);

  // The listing is already ordered by track number, so the index is the
  // position whether or not every track in the collection has been numbered.
  const siblingTracks = Array.isArray(siblingTracksResult)
    ? siblingTracksResult
    : [];
  const { position, previous, next } = runningOrder(siblingTracks, trackId);
  const neighbourHref = (neighbour: typeof previous) =>
    neighbour && collectionId !== undefined
      ? hrefFromParsedRoute(
          { kind: "track", trackId: neighbour.id, collectionId },
          projectId
        )
      : null;

  // The masthead byline already carries the artists, so the rail places the
  // track instead: which collection it sits in, and where in that running order.
  const railCollectionTitle =
    collection?.title ?? track.collections?.[0]?.title;
  const railSubtitle =
    railCollectionTitle && position !== null
      ? `${railCollectionTitle} · track ${position}`
      : (railCollectionTitle ?? track.artists?.join(", "));

  return (
    <ArtProvider
      artwork={track.artwork}
      playing={{ kind: "track", id: trackId }}
      className={cn(CANVAS, "h-full w-full max-w-full overflow-y-auto")}
    >
      <EntitySurfaceProvider
        previousHref={neighbourHref(previous)}
        nextHref={neighbourHref(next)}
      >
        <TrackAudioProvider
          audios={track.audios}
          primaryAudio={track.primaryAudio}
        >
          <Masthead
            className={MASTHEAD_AREA}
            crumbs={
              <Breadcrumbs
                crumbs={createBreadcrumbs(project, { collection, track })}
              />
            }
            eyebrow={
              <TrackRunningOrder
                projectId={projectId}
                collectionId={collectionId}
                trackId={trackId}
                siblings={siblingTracks}
              />
            }
            title={
              <InlineTitleEditor
                value={track.title}
                entityType="track"
                entityId={trackId}
                fieldName="title"
              />
            }
            byline={
              <>
                <TrackArtists
                  trackId={trackId}
                  artists={track.artists ?? []}
                  vocabulary={
                    canEdit ? getProjectArtists(projectId) : undefined
                  }
                />
                {track.status && <StatusDisplay status={track.status} />}
                <NowPlayingFlag
                  owner={{ kind: "track", id: trackId }}
                  projectId={projectId}
                />
                {track.explicit && (
                  <StatusChip flag colour="var(--ink-soft)">
                    Explicit
                  </StatusChip>
                )}
                {archived && <ArchivedFlag />}
                {archived && canEdit && <UnarchiveAction {...trackRef} />}
              </>
            }
          >
            <div className={"mt-6"}>
              <TrackAudioSection
                trackId={trackId}
                title={track.title}
                artists={track.artists}
              />
            </div>
          </Masthead>
          {/* The listening block above carries the page, so the paperwork
            below starts a section's gap further down than its own rhythm. */}
          <div className={cn(BODY, "pt-11 stack:pt-0")}>
            <SectionFold>
              <PageSections
                order={shell.entityPageSections.track}
                sections={{
                  overview: (
                    <section className={SPLIT}>
                      <div className={"min-w-0"}>
                        <EmptySection
                          label={"NOTES"}
                          empty={isBlankStoredDocument(track.notes)}
                          add={canEdit ? "Notes" : undefined}
                        >
                          <CollapsibleSection label={"NOTES"}>
                            <Description
                              entityType="track"
                              entityId={track.id}
                              fieldName="notes"
                              text={
                                track.notes ? JSON.stringify(track.notes) : ""
                              }
                            />
                          </CollapsibleSection>
                        </EmptySection>
                      </div>
                      <div className={"stack:max-w-56"}>
                        <EmptySection
                          label={"ARTWORK"}
                          empty={!track.image}
                          add={canEdit ? "Artwork" : undefined}
                        >
                          <section>
                            <SectionHead>ARTWORK</SectionHead>
                            <ImageUploader
                              kind={"track"}
                              parentId={trackId}
                              currentImage={track.image}
                            />
                          </section>
                        </EmptySection>
                      </div>
                    </section>
                  ),
                  lyrics: (
                    <Suspense fallback={null}>
                      <TrackLyrics trackId={trackId} note={track.note} />
                    </Suspense>
                  ),
                  sessions: (
                    <Suspense
                      fallback={
                        <section>
                          <SectionHead action={sessionsAction}>
                            SESSIONS
                          </SectionHead>
                          <TableSkeleton rows={4} />
                        </section>
                      }
                    >
                      <TrackSessionsSection
                        pagePromise={sessionsPagePromise}
                        dawsPromise={dawsPromise}
                        machinesPromise={machinesPromise}
                        projectId={projectId}
                        collectionId={collectionId}
                        trackId={trackId}
                        projectLabels={projectLabels}
                        priorityLevels={priorityLevels}
                        canEdit={canEdit}
                        action={sessionsAction}
                      />
                    </Suspense>
                  ),
                  repositories: (
                    <Suspense fallback={null}>
                      <RepositoriesSection
                        reposPromise={reposPromise}
                        projectId={projectId}
                      />
                    </Suspense>
                  ),
                  relations: (
                    <TrackRelationsSection
                      trackId={trackId}
                      relations={track.relations}
                    />
                  ),
                  attachments: (
                    <EmptySection
                      label={"ATTACHMENTS"}
                      empty={track.attachments.length === 0}
                      add={canEdit ? "Attachment" : undefined}
                    >
                      <section>
                        <SectionHead>ATTACHMENTS</SectionHead>
                        <AttachmentList
                          attachments={track.attachments}
                          attachTo={"track"}
                          parentId={trackId}
                          trackId={trackId}
                        />
                      </section>
                    </EmptySection>
                  ),
                  comments: (
                    <Suspense fallback={null}>
                      <CommentSection
                        entityType="track"
                        entityId={trackId}
                        prominence={"primary"}
                        hint={
                          "About the song as a whole. Timestamped mix notes go on an audio version."
                        }
                      />
                    </Suspense>
                  ),
                  add: <AddLine label={"Add to this track"} />,
                  activity: (
                    <Suspense fallback={null}>
                      <ActivityFeed
                        projectId={projectId}
                        entityType="track"
                        entityId={trackId}
                        limit={15}
                      />
                    </Suspense>
                  ),
                }}
              />
            </SectionFold>
          </div>
          {/* Inside the provider so the rail's loudness block follows the
            version picked in the masthead. */}
          <RightSideBlur
            more={
              <>
                <DetectedMeta
                  ownKey={{ tonic: track.keyTonic, scale: track.keyScale }}
                  ownBpm={track.bpm}
                  detectedKey={track.primaryAudio?.musicalKey ?? null}
                  keyConfidence={track.primaryAudio?.keyConfidence ?? null}
                  detectedBpm={track.primaryAudio?.bpm ?? null}
                  bpmConfidence={track.primaryAudio?.bpmConfidence ?? null}
                  mainSessionId={
                    track.sessions.find((session) => session.main)?.id ?? null
                  }
                />
                {track.audios.length > 0 && (
                  <>
                    <RailBlock>
                      <TrackLoudness trackId={trackId} />
                    </RailBlock>
                    <RailBlock>
                      <TrackSpectrum trackId={trackId} />
                    </RailBlock>
                  </>
                )}
                <RailBlock>
                  <RailLabel>WORKED ON</RailLabel>
                  <TrackWorkHeatmap projectId={projectId} trackId={trackId} />
                </RailBlock>
                {canEdit && (
                  <RailBlock>
                    <Suspense fallback={<RailLabel>SHARING</RailLabel>}>
                      <SharingRail entityType="track" entityId={trackId} />
                    </Suspense>
                  </RailBlock>
                )}
                <RailBlock grid>
                  <InlinePropertyEditor
                    label="ISRC"
                    value={track.isrc || undefined}
                    type="text"
                    entityType="track"
                    entityId={trackId}
                    fieldName="isrc"
                    placeholder="e.g. US-ABC-12-34567"
                  />
                  <InlinePropertyEditor
                    label="ISWC"
                    value={track.iswc || undefined}
                    type="text"
                    entityType="track"
                    entityId={trackId}
                    fieldName="iswc"
                    placeholder="e.g. T-12345678900"
                  />
                </RailBlock>
                <CustomFieldsBlock
                  fields={customFields}
                  values={track.fields}
                  entityType="track"
                  entityId={trackId}
                  format={format}
                />
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
                {canEdit && (
                  <RailBlock>
                    <TrackRailActions {...trackRef} archived={archived} />
                  </RailBlock>
                )}
              </>
            }
          >
            <RailIdentity title={track.title} subtitle={railSubtitle} />
            <RailBlock>
              <RailLabel>STATUS</RailLabel>
              <StatusDropdown
                statuses={statusProm}
                targetId={trackId}
                targetKind={"track"}
                className={"w-full"}
                current={track.status}
                variant={"icon-title"}
              />
            </RailBlock>
            <RailBlock>
              <RailLabel>PRIORITY</RailLabel>
              <TrackPrioritySection
                trackId={trackId}
                level={track.priority}
                levels={priorityLevels}
              />
            </RailBlock>
            <RailBlock>
              <TrackExplicitToggle
                trackId={trackId}
                explicit={track.explicit}
              />
            </RailBlock>
            <RailBlock>
              <RailLabel
                action={
                  <LinkToDialog
                    targetKind="track"
                    targetId={trackId}
                    defaultTab="collection"
                    linkedCollectionIds={track.collections?.map((c) => c.id)}
                  />
                }
              >
                COLLECTIONS
              </RailLabel>
              {track.collections?.map((col) => (
                <MetadataItem key={col.id}>
                  <AppLink
                    href={hrefFromParsedRoute(
                      {
                        kind: "collection",
                        collectionId: col.id,
                      },
                      projectId
                    )}
                  >
                    {col.title}
                  </AppLink>
                </MetadataItem>
              ))}
            </RailBlock>
            <RailBlock>
              <TrackLabelsSection
                projectId={projectId}
                trackId={trackId}
                labels={track.labels}
                projectLabels={projectLabels}
              />
            </RailBlock>
          </RightSideBlur>
        </TrackAudioProvider>
      </EntitySurfaceProvider>
    </ArtProvider>
  );
}

async function TrackSessionsSection({
  pagePromise,
  dawsPromise,
  machinesPromise,
  projectId,
  collectionId,
  trackId,
  projectLabels,
  priorityLevels,
  canEdit,
  action,
}: {
  pagePromise: ReturnType<typeof getSessionsPageForProject>;
  dawsPromise: ReturnType<typeof getSessionDaws>;
  machinesPromise: ReturnType<typeof getMachines>;
  projectId: number;
  collectionId?: number;
  trackId: number;
  projectLabels: Label[];
  priorityLevels: PriorityScaleLevel[];
  canEdit: boolean;
  action: ReactNode;
}) {
  const [result, dawsResult, machines] = await Promise.all([
    pagePromise,
    dawsPromise,
    machinesPromise,
  ]);
  const sessionsPage = isActionError(result) ? null : result;

  return (
    <EmptySection
      label={"SESSIONS"}
      empty={sessionsPage?.rowCount === 0}
      add={canEdit ? "Session" : undefined}
    >
      <Arrive>
        <section>
          <SectionHead action={action}>SESSIONS</SectionHead>
          <EntityTable
            kind="session"
            rows={sessionsPage?.rows ?? []}
            rowCount={sessionsPage?.rowCount ?? 0}
            pageSize={sessionsPage?.pageSize}
            facets={sessionsPage?.facets}
            groups={sessionsPage?.groups}
            projectId={projectId}
            projectLabels={projectLabels}
            priorityLevels={priorityLevels}
            embedded
            scope={{
              trackId,
              collectionId,
              tracks: [],
              daws: isActionError(dawsResult) ? [] : dawsResult,
              machines,
            }}
          />
        </section>
      </Arrive>
    </EmptySection>
  );
}
