import { cn } from "@workspace/ui/lib/utils";
import { BODY, CANVAS, MASTHEAD_AREA, SPLIT } from "@/components/layout/shell";
import {
  cachedCollectionSummaries,
  cachedCustomFields,
  cachedProject,
} from "@/lib/server-data";
import { getLabels } from "@/actions/labels";
import { getProjectMembers } from "@/actions/members";
import { getPriorityLevels } from "@/actions/priorities";
import {
  getCollectionsPageForProject,
  getCollectionSummaries,
  getProjectHeatmap,
  getProjectPlugins,
  getProjectToday,
  getSessionDaws,
} from "@/actions/projects";
import { getSessionsPageForProject } from "@/actions/sessions";
import { getStatuses } from "@/actions/statuses";
import { getTracksPageForProject } from "@/actions/tracks";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { ArtProvider } from "@/components/art/ArtProvider";
import { JobsSection } from "@/components/project-home/JobsSection";
import { NewSection } from "@/components/project-home/NewSection";
import { QuietSection } from "@/components/project-home/QuietSection";
import { RecentActivitySection } from "@/components/project-home/RecentActivitySection";
import { TodayReadout } from "@/components/project-home/TodayReadout";
import { AttachmentList } from "@/components/attachments/AttachmentList";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { EntityBoard } from "@/components/tables/EntityBoard";
import { EntityTable } from "@/components/tables/EntityTable";
import CommentSection from "@/components/comments/CommentSection";
import Description from "@/components/editing/Description";
import { PluginInventory } from "@/components/project/PluginInventory";
import { SamplesInventory } from "@/components/project/SamplesInventory";
import { ImageUploader } from "@/components/uploads/ImageUploader";
import InlineTitleEditor from "@/components/editing/InlineTitleEditor";
import { LinkFormDialog } from "@/components/project/LinkFormDialog";
import LinkItems from "@/components/project/LinkItems";
import { TableSkeleton } from "@/components/tables/TableSkeleton";
import { ViewSwitcher } from "@/components/tables/ViewSwitcher";
import { Masthead } from "@/components/masthead/Masthead";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import { ProjectRailCounts } from "@/components/project/ProjectRailCounts";
import { ProjectByline } from "@/components/project/ProjectStats";
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
  SectionAdd,
  SectionFold,
} from "@workspace/ui/components/layout/empty-section";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { isBlankStoredDocument } from "@workspace/ui/lib/block-document";
import { WorkHeatmap } from "@/components/work-heatmap/WorkHeatmap";
import { hasSaves, yearHeatmapQuery } from "@/lib/heatmap-range";
import type { TableSearchParams } from "@/lib/table-params";
import { cachedFormatters } from "@/lib/formatters";
import { cachedPolicies } from "@/lib/policies/server";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { PageSections } from "@/components/layout/PageSections";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { pluralizeCount } from "@workspace/session-diff/format";
import { IconPlus } from "@tabler/icons-react";
import type { Link as LinkType } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { Button } from "@workspace/ui/components/button";
import { type ReactNode, Suspense } from "react";
import { Arrive } from "@workspace/ui/components/layout/arrive";

export default async function ProjectPage({
  projectId,
  query = {},
  library: libraryParam,
}: {
  projectId: number;
  query?: TableSearchParams;
  /** The URL's say on the samples section's Library toggle, if any. */
  library?: boolean;
}) {
  const [projectResult, format, { shell }, settings] = await Promise.all([
    cachedProject(projectId),
    cachedFormatters(projectId),
    cachedPolicies(projectId),
    cachedEffectiveSettings(projectId),
  ]);
  const library = libraryParam ?? shell.inventoryDefaults.samples.library;

  const project = loaded(projectResult);

  // The byline, the collections table and the members rail all fetch behind
  // their own boundaries, so the masthead paints without waiting on them.
  const statusesPromise = getStatuses(projectId);
  // The rail counts every collection in the project, which the paginated table
  // feed deliberately does not.
  const collectionsPromise = cachedCollectionSummaries(projectId);
  const labelsPromise = getLabels(projectId);
  const collectionsPagePromise = getCollectionsPageForProject(projectId, {
    pageSize: settings.values["tables.rowsPerLoad"],
  });
  // Only the total matters here; a single row is enough to carry it.
  const sessionCountPromise = getSessionsPageForProject(projectId, {
    pageSize: 1,
  });
  const trackCountPromise = getTracksPageForProject(projectId, { pageSize: 1 });
  const archivedTrackCountPromise = getTracksPageForProject(projectId, {
    pageSize: 1,
    archived: "only",
  });
  // One read feeds the readout, the NEW block and the GONE QUIET block.
  const todayPromise = getProjectToday(projectId);

  const view = query.view === "board" ? "board" : "list";

  const createdAt = new Date(project.createdAt);
  const updatedAt = new Date(project.updatedAt);
  const canEdit = project.role !== "viewer";
  const links = (project.links as LinkType[]) || [];

  const collectionsAction = (
    <div className={"flex items-center gap-2"}>
      <ViewSwitcher current={view} />
      {canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-ink-soft"
          asChild
        >
          <AppLink
            href={hrefFromParsedRoute({ kind: "collection-new" }, projectId)}
            aria-label="New collection"
          >
            <IconPlus size={14} />
          </AppLink>
        </Button>
      )}
    </div>
  );

  return (
    <ArtProvider
      artwork={project.artwork}
      className={cn(CANVAS, "h-full w-full max-w-full overflow-y-auto")}
    >
      <Masthead
        className={MASTHEAD_AREA}
        crumbs={<Breadcrumbs crumbs={createBreadcrumbs(project)} />}
        eyebrow={"Project"}
        title={
          <InlineTitleEditor
            value={project.name}
            entityType="project"
            entityId={projectId}
            fieldName="name"
          />
        }
        byline={
          <Suspense fallback={null}>
            <ProjectBylineSection
              collectionsPromise={collectionsPromise}
              trackCountPromise={trackCountPromise}
              archivedTrackCountPromise={archivedTrackCountPromise}
              sessionCountPromise={sessionCountPromise}
            />
          </Suspense>
        }
      >
        <TodayReadout projectId={projectId} today={todayPromise} />
      </Masthead>
      <div className={BODY}>
        <SectionFold>
          <PageSections
            order={shell.projectHomeSections}
            sections={{
              new: (
                <Suspense fallback={null}>
                  <NewSection projectId={projectId} today={todayPromise} />
                </Suspense>
              ),
              quiet: (
                <Suspense fallback={null}>
                  <QuietSection projectId={projectId} today={todayPromise} />
                </Suspense>
              ),
              jobs: <JobsSection />,
              "recent-activity": (
                <Suspense fallback={null}>
                  <RecentActivitySection projectId={projectId} />
                </Suspense>
              ),
              overview: (
                <section className={SPLIT}>
                  <div className={"min-w-0 wrap-anywhere"}>
                    <EmptySection
                      label={"DESCRIPTION"}
                      empty={isBlankStoredDocument(project.description)}
                      add={canEdit ? "Description" : undefined}
                    >
                      <Description
                        entityType="project"
                        entityId={project.id}
                        fieldName="description"
                        text={
                          project.description
                            ? JSON.stringify(project.description)
                            : ""
                        }
                      />
                    </EmptySection>
                  </div>
                  <div className={"stack:max-w-56"}>
                    <EmptySection
                      label={"ARTWORK"}
                      empty={!project.image}
                      add={canEdit ? "Artwork" : undefined}
                    >
                      <ImageUploader
                        kind={"project"}
                        parentId={projectId}
                        currentImage={project.image}
                      />
                    </EmptySection>
                  </div>
                </section>
              ),
              collections: (
                <Suspense
                  fallback={
                    <section>
                      <SectionHead action={collectionsAction}>
                        COLLECTIONS
                      </SectionHead>
                      <TableSkeleton />
                    </section>
                  }
                >
                  <ProjectCollectionsSection
                    projectId={projectId}
                    view={view}
                    query={query}
                    canEdit={canEdit}
                    action={collectionsAction}
                    collectionsPromise={collectionsPromise}
                    pagePromise={collectionsPagePromise}
                    statusesPromise={statusesPromise}
                    labelsPromise={labelsPromise}
                  />
                </Suspense>
              ),
              plugins: (
                <Suspense fallback={null}>
                  <PluginInventorySection
                    projectId={projectId}
                    sessionCountPromise={sessionCountPromise}
                  />
                </Suspense>
              ),
              samples: (
                <Suspense fallback={null}>
                  <SamplesInventorySection
                    projectId={projectId}
                    library={library}
                  />
                </Suspense>
              ),
              heatmap: (
                <Suspense fallback={null}>
                  <WorkHeatmapSection
                    projectId={projectId}
                    collectionsPromise={collectionsPromise}
                    labelsPromise={labelsPromise}
                  />
                </Suspense>
              ),
              links: (
                <EmptySection
                  label={"LINKS"}
                  empty={links.length === 0}
                  addControl={
                    canEdit ? (
                      <LinkFormDialog projectId={projectId} links={links}>
                        <SectionAdd>Link</SectionAdd>
                      </LinkFormDialog>
                    ) : undefined
                  }
                >
                  <section>
                    <SectionHead
                      action={
                        canEdit ? (
                          <LinkFormDialog projectId={projectId} links={links}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-ink-soft"
                              aria-label="Add link"
                            >
                              <IconPlus size={14} />
                            </Button>
                          </LinkFormDialog>
                        ) : undefined
                      }
                    >
                      LINKS
                    </SectionHead>
                    <LinkItems
                      links={links}
                      projectId={projectId}
                      canEdit={canEdit}
                    />
                  </section>
                </EmptySection>
              ),
              attachments: (
                <EmptySection
                  label={"ATTACHMENTS"}
                  empty={project.attachments.length === 0}
                  add={canEdit ? "Attachment" : undefined}
                >
                  <section>
                    <SectionHead>ATTACHMENTS</SectionHead>
                    <AttachmentList
                      attachments={project.attachments}
                      attachTo={"project"}
                      parentId={projectId}
                    />
                  </section>
                </EmptySection>
              ),
              comments: (
                <Suspense fallback={null}>
                  <CommentSection entityType="project" entityId={projectId} />
                </Suspense>
              ),
              add: <AddLine label={"Add to this project"} />,
              activity: (
                <Suspense fallback={null}>
                  <ActivityFeed projectId={projectId} />
                </Suspense>
              ),
            }}
          />
        </SectionFold>
      </div>
      <RightSideBlur>
        <Suspense fallback={<RailIdentity title={project.name} />}>
          <ProjectRailCounts
            name={project.name}
            collectionsPromise={collectionsPromise}
          />
        </Suspense>
        <RailBlock>
          <RailLabel>LINKS</RailLabel>
          <MetadataItem>{pluralizeCount(links.length, "link")}</MetadataItem>
        </RailBlock>
        <RailBlock>
          <RailLabel>MEMBERS</RailLabel>
          <Suspense fallback={<MetadataItem />}>
            <ProjectMembers projectId={projectId} />
          </Suspense>
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
      </RightSideBlur>
    </ArtProvider>
  );
}

async function ProjectBylineSection({
  collectionsPromise,
  trackCountPromise,
  archivedTrackCountPromise,
  sessionCountPromise,
}: {
  collectionsPromise: ReturnType<typeof getCollectionSummaries>;
  trackCountPromise: ReturnType<typeof getTracksPageForProject>;
  archivedTrackCountPromise: ReturnType<typeof getTracksPageForProject>;
  sessionCountPromise: ReturnType<typeof getSessionsPageForProject>;
}) {
  const [tracksPage, archivedPage, sessionsPage] = await Promise.all([
    trackCountPromise,
    archivedTrackCountPromise,
    sessionCountPromise,
  ]);

  return (
    <Arrive>
      <ProjectByline
        collectionsPromise={collectionsPromise}
        trackCount={isActionError(tracksPage) ? 0 : tracksPage.rowCount}
        archivedTrackCount={
          isActionError(archivedPage) ? 0 : archivedPage.rowCount
        }
        sessionCount={isActionError(sessionsPage) ? 0 : sessionsPage.rowCount}
      />
    </Arrive>
  );
}

async function ProjectCollectionsSection({
  projectId,
  view,
  query,
  canEdit,
  action,
  collectionsPromise,
  pagePromise,
  statusesPromise,
  labelsPromise,
}: {
  projectId: number;
  view: "list" | "board";
  query: TableSearchParams;
  canEdit: boolean;
  action: ReactNode;
  collectionsPromise: ReturnType<typeof getCollectionSummaries>;
  pagePromise: ReturnType<typeof getCollectionsPageForProject>;
  statusesPromise: ReturnType<typeof getStatuses>;
  labelsPromise: ReturnType<typeof getLabels>;
}) {
  const collections = await collectionsPromise;

  return (
    <EmptySection
      label={"COLLECTIONS"}
      empty={!isActionError(collections) && collections.length === 0}
      add={canEdit ? "Collection" : undefined}
    >
      <Arrive>
        <section>
          <SectionHead action={action}>COLLECTIONS</SectionHead>
          <Suspense fallback={<TableSkeleton />}>
            <Arrive>
              {view === "board" ? (
                <ProjectCollectionsBoard
                  projectId={projectId}
                  statusesPromise={statusesPromise}
                  query={query}
                />
              ) : (
                <ProjectCollectionsTable
                  projectId={projectId}
                  pagePromise={pagePromise}
                  statusesPromise={statusesPromise}
                  labelsPromise={labelsPromise}
                />
              )}
            </Arrive>
          </Suspense>
        </section>
      </Arrive>
    </EmptySection>
  );
}

async function ProjectCollectionsTable({
  projectId,
  pagePromise,
  statusesPromise,
  labelsPromise,
}: {
  projectId: number;
  pagePromise: ReturnType<typeof getCollectionsPageForProject>;
  statusesPromise: ReturnType<typeof getStatuses>;
  labelsPromise: ReturnType<typeof getLabels>;
}) {
  const [pageResult, statusesResult, labelsResult, levelsResult, customFields] =
    await Promise.all([
      pagePromise,
      statusesPromise,
      labelsPromise,
      getPriorityLevels(projectId),
      cachedCustomFields(projectId, "collection"),
    ]);

  const collectionsPage = isActionError(pageResult) ? null : pageResult;

  return (
    <EntityTable
      kind="collection"
      rows={collectionsPage?.rows ?? []}
      rowCount={collectionsPage?.rowCount ?? 0}
      pageSize={collectionsPage?.pageSize}
      facets={collectionsPage?.facets}
      groups={collectionsPage?.groups}
      projectId={projectId}
      statuses={isActionError(statusesResult) ? [] : statusesResult}
      projectLabels={isActionError(labelsResult) ? [] : labelsResult}
      priorityLevels={isActionError(levelsResult) ? [] : levelsResult}
      customFields={customFields}
      embedded
      scope={{}}
    />
  );
}

async function WorkHeatmapSection({
  projectId,
  collectionsPromise,
  labelsPromise,
}: {
  projectId: number;
  collectionsPromise: ReturnType<typeof getCollectionSummaries>;
  labelsPromise: ReturnType<typeof getLabels>;
}) {
  const [collectionsResult, labelsResult, heatmapResult, dawsResult] =
    await Promise.all([
      collectionsPromise,
      labelsPromise,
      cachedFormatters(projectId).then(({ timeZone }) =>
        getProjectHeatmap(projectId, yearHeatmapQuery(timeZone))
      ),
      getSessionDaws(projectId),
    ]);

  // A grid with no saves on it says nothing, so the section is left out.
  if (isActionError(heatmapResult) || !hasSaves(heatmapResult)) return null;

  return (
    <Arrive>
      <section>
        <WorkHeatmap
          projectId={projectId}
          collections={
            isActionError(collectionsResult) ? [] : collectionsResult
          }
          labels={isActionError(labelsResult) ? [] : labelsResult}
          daws={isActionError(dawsResult) ? [] : dawsResult}
        />
      </section>
    </Arrive>
  );
}

async function PluginInventorySection({
  projectId,
  sessionCountPromise,
}: {
  projectId: number;
  sessionCountPromise: ReturnType<typeof getSessionsPageForProject>;
}) {
  const [pluginsResult, sessionsResult] = await Promise.all([
    getProjectPlugins(projectId),
    sessionCountPromise,
  ]);

  return (
    <Arrive>
      <PluginInventory
        projectId={projectId}
        plugins={isActionError(pluginsResult) ? [] : pluginsResult}
        sessionCount={
          isActionError(sessionsResult) ? 0 : sessionsResult.rowCount
        }
      />
    </Arrive>
  );
}

async function SamplesInventorySection({
  projectId,
  library,
}: {
  projectId: number;
  library: boolean;
}) {
  return (
    <Arrive>
      <SamplesInventory projectId={projectId} library={library} />
    </Arrive>
  );
}

async function ProjectCollectionsBoard({
  projectId,
  statusesPromise,
  query,
}: {
  projectId: number;
  statusesPromise: ReturnType<typeof getStatuses>;
  query: TableSearchParams;
}) {
  const statusesResult = await statusesPromise;

  return (
    <EntityBoard
      kind="collection"
      projectId={projectId}
      statuses={isActionError(statusesResult) ? [] : statusesResult}
      filters={{ q: query.q }}
    />
  );
}

async function ProjectMembers({ projectId }: { projectId: number }) {
  const result = await getProjectMembers(projectId);
  const members = Array.isArray(result) ? result : [];

  return (
    <MetadataItem>
      {members.length > 0
        ? members
            .map((member) => member.user?.name)
            .filter(Boolean)
            .join(" · ")
        : undefined}
    </MetadataItem>
  );
}
