import { PAGE } from "@workspace/ui/lib/shell";
import { cachedProject } from "@/lib/server-data";
import { getCollection } from "@/actions/collections";
import { getSessionDaws } from "@/actions/projects";
import { getTrack } from "@/actions/tracks";
import { SessionForm } from "@/components/forms/SessionForm";
import { Loading } from "@workspace/ui/components/layout/loading";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { isActionError } from "@workspace/api/lib/action-result";
import { loaded } from "@/lib/loaded";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

export default async function NewSession({
  projectId,
  collectionId,
  trackId,
  initialName,
}: {
  projectId: number;
  collectionId?: number;
  trackId?: number;
  initialName?: string;
}) {
  const projectProm = cachedProject(projectId);
  const collectionProm = collectionId ? getCollection(collectionId) : undefined;
  const trackProm = trackId ? getTrack(trackId) : undefined;
  const dawsProm = getSessionDaws(projectId);

  const [projectResult, collectionResult, trackResult, dawsResult] =
    await Promise.all([projectProm, collectionProm, trackProm, dawsProm]);

  const project = loaded(projectResult);
  const collection = collectionResult ? loaded(collectionResult) : undefined;
  const track = trackResult ? loaded(trackResult) : undefined;

  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[
              ...createBreadcrumbs(project, { collection, track }),
              {
                label: "New session",
                href: hrefFromParsedRoute(
                  { kind: "session-new", collectionId, trackId },
                  projectId
                ),
              },
            ]}
          />
        }
        title={"New session"}
        lede={
          track
            ? `A DAW session for ${track.title}.`
            : "A DAW session — the project file behind a track."
        }
      />
      <Loading>
        <SessionForm
          projectId={projectId}
          collectionId={collectionId}
          trackId={trackId}
          initialName={initialName}
          daws={isActionError(dawsResult) ? [] : dawsResult}
        />
      </Loading>
    </ScrollRoot>
  );
}
