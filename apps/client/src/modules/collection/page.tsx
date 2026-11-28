import { roleSatisfies } from "@/lib/roles";
import { cn } from "@workspace/ui/lib/utils";
import { BODY, CANVAS, MASTHEAD_AREA, SPLIT } from "@/components/layout/shell";
import {
  cachedCollection,
  cachedCustomFields,
  cachedProject,
} from "@/lib/server-data";
import { getCollectionTotalStatus } from "@/actions/collections";
import { getLabels } from "@/actions/labels";
import { getPriorityLevels } from "@/actions/priorities";
import { getRelationTypes } from "@/actions/relation-types";
import { getStatuses } from "@/actions/statuses";
import { getTracksPageForProject } from "@/actions/tracks";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { AddTrackMenu } from "@/components/track/AddTrackMenu";
import { AudioAnalysisWatcher } from "@/components/track-audio/AudioAnalysisWatcher";
import { CollectionKeys } from "@/components/collection/CollectionKeys";
import { CollectionProgress } from "@/components/collection/CollectionProgress";
import { CollectionTempo } from "@/components/collection/CollectionTempo";
import { CollectionLoudness } from "@/components/loudness/CollectionLoudness";
import { CollectionSpectrum } from "@/components/spectrum/CollectionSpectrum";
import CommentSection from "@/components/comments/CommentSection";
import Description from "@/components/editing/Description";
import { ArtProvider } from "@/components/art/ArtProvider";
import { ImageUploader } from "@/components/uploads/ImageUploader";
import { CustomFieldsBlock } from "@/components/editing/CustomFieldsBlock";
import InlinePropertyEditor from "@/components/editing/InlinePropertyEditor";
import InlineTitleEditor from "@/components/editing/InlineTitleEditor";
import { Masthead } from "@/components/masthead/Masthead";
import { NowPlayingFlag } from "@/components/masthead/NowPlayingFlag";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import RightSideBlur from "@/components/layout/RightSideBlur";
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
import { SharingRail } from "@/components/sharing/SharingRail";
import { StatusDropdown } from "@/components/status/StatusDropdown";
import { EntityBoard } from "@/components/tables/EntityBoard";
import { EntityTable } from "@/components/tables/EntityTable";
import { ViewSwitcher } from "@/components/tables/ViewSwitcher";
import type { TableSearchParams } from "@/lib/table-params";
import { cachedFormatters } from "@/lib/formatters";
import { cachedPolicies } from "@/lib/policies/server";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { PageSections } from "@/components/layout/PageSections";
import { createBreadcrumbs } from "@/lib/utils";
import { pluralizeCount } from "@workspace/session-diff/format";
import { releasePhrase } from "@/lib/release";
import { TableSkeleton } from "@/components/tables/TableSkeleton";
import type { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { Suspense, type ReactNode } from "react";
import { Arrive } from "@workspace/ui/components/layout/arrive";

function actionFallback(message: string): ActionError {
  return { error: message };
}

/**
 * Prevents a streamed Suspense section from throwing an unhandled RSC error
 * chunk (`resolveErrorProd` / React #441) if an upstream read rejects mid-stream.
 */
async function SafeStreamSection({
  render,
  fallback = null,
}: {
  render: () => Promise<ReactNode>;
  fallback?: ReactNode;
}) {
  try {
    return await render();
  } catch {
    return fallback;
  }
}

export default async function CollectionPage({
  projectId,
  collectionId,
  query = {},
}: {
  projectId: number;
  collectionId: number;
  query?: TableSearchParams;
}) {
  const [
    projectResult,
    collectionResult,
    totalStatus,
    customFields,
    trackCustomFields,
    format,
    { shell },
    settings,
  ] = await Promise.all([
    cachedProject(projectId),
    cachedCollection(collectionId),
    getCollectionTotalStatus(collectionId),
    cachedCustomFields(projectId, "collection"),
    cachedCustomFields(projectId, "track"),
    cachedFormatters(projectId),
    cachedPolicies(projectId),
    cachedEffectiveSettings(projectId),
  ]);

  const project = loaded(projectResult);
  const collection = loaded(collectionResult);

  // The table and its filter menus fetch behind their own boundary, so the
  // masthead and rail paint without waiting on them. Guard against rejected
  // promises so an upstream failure never surfaces as an unhandled RSC #441 error.
  const statusesPromise = getStatuses(projectId).catch(() =>
    actionFallback("Failed to fetch statuses")
  );
  const tracksPagePromise = getTracksPageForProject(projectId, {
    collection: collectionId,
    archived: "include",
    pageSize: settings.values["tables.rowsPerLoad"],
  }).catch(() => actionFallback("Failed to fetch tracks"));

  const view = query.view === "board" ? "board" : "list";

  // Summed from the tracks' primary audio; zero until at least one has some.
  const runtimeMs = isActionError(totalStatus) ? 0 : totalStatus.runtimeMs;
  const trackCount = isActionError(totalStatus) ? 0 : totalStatus.trackCount;

  // Playing time is measured in the background as audio is uploaded, so until
  // every track has been analysed the sum so far is not the collection's
  // runtime and is never shown as though it were.
  const runtimePending =
    !isActionError(totalStatus) && !totalStatus.runtimeComplete;
  const runtimeLabel = runtimePending
    ? "Calculating…"
    : runtimeMs > 0
      ? format.duration(runtimeMs)
      : undefined;

  const loudness = isActionError(totalStatus) ? null : totalStatus.loudness;
  const loudnessPending =
    loudness != null && loudness.measured < loudness.total;

  const spectrum = isActionError(totalStatus) ? null : totalStatus.spectrum;
  const spectrumPending =
    spectrum != null && spectrum.measured < spectrum.total;

  const tempo = isActionError(totalStatus) ? null : totalStatus.tempo;
  const keys = isActionError(totalStatus) ? [] : totalStatus.keys;

  const canEdit = roleSatisfies(project.role, "editor");

  const createdAtDate = new Date(collection.createdAt);
  const updatedAtDate = new Date(collection.updatedAt);

  const release = collection.releaseDate
    ? releasePhrase(collection.releaseDate)
    : null;
  const readinessPct =
    isActionError(totalStatus) || totalStatus.trackCount === 0
      ? undefined
      : Math.round(
          (totalStatus.completeTrackCount / totalStatus.trackCount) * 100
        );
  const releaseNotReady =
    release?.tone === "soon" &&
    readinessPct !== undefined &&
    readinessPct < 100;

  return (
    <ArtProvider
      artwork={collection.artwork}
      playing={{ kind: "collection", id: collectionId }}
      className={cn(CANVAS, "h-full w-full max-w-full overflow-y-auto")}
    >
      {(runtimePending || loudnessPending || spectrumPending) && (
        <AudioAnalysisWatcher />
      )}
      <Masthead
        className={MASTHEAD_AREA}
        crumbs={
          <Breadcrumbs crumbs={createBreadcrumbs(project, { collection })} />
        }
        eyebrow={
          release ? (
            <>
              Collection ·{" "}
              <span className={cn(releaseNotReady && "text-warn")}>
                {release.label}
              </span>
            </>
          ) : (
            "Collection"
          )
        }
        title={
          <InlineTitleEditor
            value={collection.title}
            entityType="collection"
            entityId={collectionId}
            fieldName="title"
          />
        }
        byline={
          <>
            <span>
              {[
                pluralizeCount(trackCount, "track"),
                ...(runtimeLabel ? [runtimeLabel] : []),
              ].join(" · ")}
            </span>
            <NowPlayingFlag
              owner={{ kind: "collection", id: collectionId }}
              projectId={projectId}
            />
          </>
        }
      >
        <div className={"mt-6"}>
          <PlayAffordance
            kind={"collection"}
            id={collectionId}
            title={collection.title}
            hero
          />
        </div>
      </Masthead>
      <div className={BODY}>
        <SectionFold>
          <PageSections
            order={shell.entityPageSections.collection}
            sections={{
              overview: (
                <section className={SPLIT}>
                  <div className={"min-w-0"}>
                    <EmptySection
                      label={"NOTES"}
                      empty={isBlankStoredDocument(collection.notes)}
                      add={canEdit ? "Notes" : undefined}
                    >
                      <Description
                        entityType="collection"
                        entityId={collection.id}
                        fieldName="notes"
                        text={
                          collection.notes
                            ? JSON.stringify(collection.notes)
                            : ""
                        }
                        label="NOTES"
                      />
                    </EmptySection>
                  </div>
                  <div className={"stack:max-w-56"}>
                    <EmptySection
                      label={"ARTWORK"}
                      empty={!collection.image}
                      add={canEdit ? "Artwork" : undefined}
                    >
                      <section>
                        <SectionHead>ARTWORK</SectionHead>
                        <ImageUploader
                          kind={"collection"}
                          parentId={collectionId}
                          currentImage={collection.image}
                        />
                      </section>
                    </EmptySection>
                  </div>
                </section>
              ),
              tracks: (
                <EmptySection
                  label={"TRACKS"}
                  empty={
                    isActionError(totalStatus)
                      ? false
                      : totalStatus.trackCount === 0
                  }
                  add={canEdit ? "Track" : undefined}
                >
                  <section>
                    <SectionHead
                      action={
                        <div className={"flex items-center gap-2"}>
                          <ViewSwitcher current={view} />
                          <AddTrackMenu
                            projectId={projectId}
                            collectionId={collectionId}
                            statusesPromise={statusesPromise}
                            customFields={trackCustomFields}
                          />
                        </div>
                      }
                    >
                      TRACKS
                    </SectionHead>
                    <Suspense fallback={<TableSkeleton />}>
                      <Arrive>
                        {view === "board" ? (
                          <CollectionTracksBoard
                            projectId={projectId}
                            collectionId={collectionId}
                            statusesPromise={statusesPromise}
                            query={query}
                          />
                        ) : (
                          <CollectionTracksTable
                            projectId={projectId}
                            collectionId={collectionId}
                            pagePromise={tracksPagePromise}
                            statusesPromise={statusesPromise}
                          />
                        )}
                      </Arrive>
                    </Suspense>
                  </section>
                </EmptySection>
              ),
              attachments: (
                <EmptySection
                  label={"ATTACHMENTS"}
                  empty={collection.attachments.length === 0}
                  add={canEdit ? "Attachment" : undefined}
                >
                  <section>
                    <SectionHead>ATTACHMENTS</SectionHead>
                    <AttachmentList
                      attachments={collection.attachments}
                      attachTo={"collection"}
                      parentId={collectionId}
                    />
                  </section>
                </EmptySection>
              ),
              comments: (
                <Suspense fallback={null}>
                  <SafeStreamSection
                    render={() =>
                      CommentSection({
                        entityType: "collection",
                        entityId: collectionId,
                      })
                    }
                  />
                </Suspense>
              ),
              add: <AddLine label={"Add to this collection"} />,
              activity: (
                <Suspense fallback={null}>
                  <SafeStreamSection
                    render={() =>
                      ActivityFeed({
                        projectId,
                        entityType: "collection",
                        entityId: collectionId,
                      })
                    }
                  />
                </Suspense>
              ),
            }}
          />
        </SectionFold>
      </div>
      <RightSideBlur
        more={
          <>
            {loudness && (
              <RailBlock>
                <CollectionLoudness
                  collectionId={collectionId}
                  loudness={loudness}
                  format={format}
                />
              </RailBlock>
            )}
            {spectrum && (
              <RailBlock>
                <CollectionSpectrum
                  collectionId={collectionId}
                  spectrum={spectrum}
                />
              </RailBlock>
            )}
            {tempo && (
              <RailBlock>
                <CollectionTempo tempo={tempo} format={format} />
              </RailBlock>
            )}
            {keys.length > 0 && (
              <RailBlock>
                <CollectionKeys keys={keys} tempo={tempo} />
              </RailBlock>
            )}
            <RailBlock>
              <InlinePropertyEditor
                label="UPC"
                value={collection.upc || undefined}
                type="text"
                entityType="collection"
                entityId={collectionId}
                fieldName="upc"
                placeholder="e.g. 123456789012"
              />
            </RailBlock>
            <CustomFieldsBlock
              fields={customFields}
              values={collection.fields}
              entityType="collection"
              entityId={collectionId}
              format={format}
            />
            <RailBlock grid>
              <div>
                <RailLabel>TRACKS</RailLabel>
                <MetadataItem>{trackCount}</MetadataItem>
              </div>
              <div>
                <RailLabel>RUNTIME</RailLabel>
                <MetadataItem pending={runtimePending}>
                  {runtimeLabel}
                </MetadataItem>
              </div>
            </RailBlock>
            <RailBlock rows>
              <div>
                <RailLabel>CREATED</RailLabel>
                <MetadataItem>{format.dateTime(createdAtDate)}</MetadataItem>
              </div>
              <div>
                <RailLabel>UPDATED</RailLabel>
                <MetadataItem>{format.dateTime(updatedAtDate)}</MetadataItem>
              </div>
            </RailBlock>
          </>
        }
      >
        <RailIdentity
          title={collection.title}
          subtitle={[
            pluralizeCount(trackCount, "track"),
            ...(runtimeLabel ? [runtimeLabel] : []),
          ].join(" · ")}
        />
        <RailBlock>
          <RailLabel>STATUS</RailLabel>
          <StatusDropdown
            statuses={statusesPromise}
            targetId={collectionId}
            targetKind={"collection"}
            className={"w-full"}
            current={collection.status}
            variant={"icon-title"}
          />
        </RailBlock>
        {isActionError(totalStatus) || (
          <RailBlock>
            <CollectionProgress
              value={totalStatus.totalStatus}
              trackCount={totalStatus.trackCount}
              completeCount={totalStatus.completeTrackCount}
            />
          </RailBlock>
        )}
        <RailBlock>
          <InlinePropertyEditor
            label="RELEASE DATE"
            value={collection.releaseDate || undefined}
            displayValue={
              collection.releaseDate
                ? format.date(collection.releaseDate)
                : undefined
            }
            hint={release?.label}
            type="date"
            entityType="collection"
            entityId={collectionId}
            fieldName="releaseDate"
          />
        </RailBlock>
        {canEdit && (
          <RailBlock>
            <Suspense fallback={<RailLabel>SHARING</RailLabel>}>
              <SafeStreamSection
                fallback={<RailLabel>SHARING</RailLabel>}
                render={() =>
                  SharingRail({
                    entityType: "collection",
                    entityId: collectionId,
                  })
                }
              />
            </Suspense>
          </RailBlock>
        )}
      </RightSideBlur>
    </ArtProvider>
  );
}

async function CollectionTracksBoard({
  projectId,
  collectionId,
  statusesPromise,
  query,
}: {
  projectId: number;
  collectionId: number;
  statusesPromise: ReturnType<typeof getStatuses>;
  query: TableSearchParams;
}) {
  const statusesResult = await statusesPromise.catch(() =>
    actionFallback("Failed to fetch statuses")
  );

  return (
    <EntityBoard
      kind="track"
      projectId={projectId}
      statuses={isActionError(statusesResult) ? [] : statusesResult}
      filters={{
        q: query.q,
        relation: query.relation,
        label: query.label,
        artist: query.artist,
      }}
      scope={{ collectionId, collections: [] }}
    />
  );
}

async function CollectionTracksTable({
  projectId,
  collectionId,
  pagePromise,
  statusesPromise,
}: {
  projectId: number;
  collectionId: number;
  pagePromise: ReturnType<typeof getTracksPageForProject>;
  statusesPromise: ReturnType<typeof getStatuses>;
}) {
  const [
    tracksPageResult,
    statusesResult,
    labelsResult,
    levelsResult,
    relationTypesResult,
    customFields,
  ] = await Promise.all([
    pagePromise.catch(() => actionFallback("Failed to fetch tracks")),
    statusesPromise.catch(() => actionFallback("Failed to fetch statuses")),
    getLabels(projectId).catch(() => actionFallback("Failed to fetch labels")),
    getPriorityLevels(projectId).catch(() =>
      actionFallback("Failed to fetch priority levels")
    ),
    getRelationTypes(projectId).catch(() =>
      actionFallback("Failed to fetch relation types")
    ),
    cachedCustomFields(projectId, "track").catch(() => []),
  ]);

  const tracksPage = isActionError(tracksPageResult) ? null : tracksPageResult;

  return (
    <EntityTable
      kind="track"
      rows={tracksPage?.rows ?? []}
      rowCount={tracksPage?.rowCount ?? 0}
      pageSize={tracksPage?.pageSize}
      facets={tracksPage?.facets}
      groups={tracksPage?.groups}
      projectId={projectId}
      statuses={isActionError(statusesResult) ? [] : statusesResult}
      projectLabels={isActionError(labelsResult) ? [] : labelsResult}
      priorityLevels={isActionError(levelsResult) ? [] : levelsResult}
      relationTypes={
        isActionError(relationTypesResult) ? [] : relationTypesResult
      }
      customFields={customFields}
      embedded
      scope={{ collectionId, collections: [] }}
    />
  );
}
