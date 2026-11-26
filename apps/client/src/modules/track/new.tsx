import { PAGE } from "@workspace/ui/lib/shell";
import { cachedCustomFields, cachedProject } from "@/lib/server-data";
import { getCollection } from "@/actions/collections";
import { getStatuses } from "@/actions/statuses";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { TrackForm } from "@/components/forms/TrackForm";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { loaded } from "@/lib/loaded";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

export default async function NewTrack({
  projectId,
  collectionId,
  initialTitle,
}: {
  projectId: number;
  collectionId?: number;
  initialTitle?: string;
}) {
  const statuses = getStatuses(projectId);
  const [projectResult, collectionResult, customFields] = await Promise.all([
    cachedProject(projectId),
    collectionId ? getCollection(collectionId) : undefined,
    cachedCustomFields(projectId, "track"),
  ]);

  const project = loaded(projectResult);
  const collection = collectionResult ? loaded(collectionResult) : undefined;

  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[
              ...createBreadcrumbs(project, { collection }),
              {
                label: "New track",
                href: hrefFromParsedRoute(
                  { kind: "track-new", collectionId },
                  projectId
                ),
              },
            ]}
          />
        }
        title={"New track"}
        lede={
          collection
            ? `A new track in ${collection.title}.`
            : "A song, with its own sessions, audio and notes."
        }
      />
      <TrackForm
        projectId={projectId}
        collectionId={collectionId}
        statusesProm={statuses}
        initialTitle={initialTitle}
        customFields={customFields}
      />
    </ScrollRoot>
  );
}
